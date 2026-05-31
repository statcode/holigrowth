"""
fill_natal_chart.py
====================
Fills the AcroForm fields in 10-natal-chart-editable.pdf and stamps
a natal-chart wheel image into the NATAL_CHART field rectangle.

Usage:
    python fill_natal_chart.py

Outputs:  10-natal-chart-filled.pdf  (original is untouched)
Optional: set FLATTEN = True to produce a flat, non-editable PDF.

Dependencies:
    pip install pypdf reportlab pillow
"""

# ── USER-CONFIGURABLE VALUES ──────────────────────────────────────────────────

READER_NAME  = "Chelsea Cardinal"
BIRTH_DATE   = "December 13, 1981"
BIRTH_TIME   = "6:30 PM"
BIRTH_LOCATION = "New York, NY"
PAGE_NUMBER  = "147"

# Path to the natal-chart wheel PNG (transparent background recommended).
# Set to None to skip image stamping.
WHEEL_IMAGE_PATH = "natal_wheel.png"   # ← replace with your file

INPUT_PDF    = "10-natal-chart-editable.pdf"
OUTPUT_PDF   = "10-natal-chart-filled.pdf"
FLATTEN      = False   # True = flatten to static PDF (no editable fields)

# ── IMPORTS ───────────────────────────────────────────────────────────────────

import io, os, sys
from copy import deepcopy

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    NameObject, NumberObject, ArrayObject,
    DictionaryObject, EncodedStreamObject, BooleanObject,
)
from pypdf.generic import create_string_object

try:
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.utils import ImageReader
    HAS_REPORTLAB = True
except ImportError:
    HAS_REPORTLAB = False

try:
    from PIL import Image as PILImage
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ── STEP 1: inspect and report fields ────────────────────────────────────────

print("=" * 60)
print(f"Reading:  {INPUT_PDF}")
reader = PdfReader(INPUT_PDF)
page   = reader.pages[0]
W_PAGE = float(page.mediabox.width)   # 450 pt
H_PAGE = float(page.mediabox.height)  # 666 pt

print(f"Page size: {W_PAGE:.0f} x {H_PAGE:.0f} pt "
      f"({W_PAGE/72:.3f}\" x {H_PAGE/72:.3f}\")")

annots = page.get("/Annots", [])
print(f"\nFound {len(annots)} annotation(s):\n")
print(f"  {'Field name':25s} {'FT':6s} {'Rect':40s} {'Ff':>6}")
print("  " + "-" * 80)

field_map = {}   # name → annotation object
for a_ref in annots:
    obj   = a_ref.get_object()
    name  = str(obj.get("/T", "(unnamed)"))
    ft    = str(obj.get("/FT", "(none)"))
    rect  = [round(float(v), 2) for v in obj["/Rect"]]
    ff    = int(obj.get("/Ff", 0))
    print(f"  {name:25s} {ft:6s} {str(rect):40s} {ff:6d}")
    field_map[name] = obj

print()

# ── STEP 2: build mapping of field name → value ───────────────────────────────

TEXT_VALUES = {
    "READER_NAME":    READER_NAME,
    "BIRTH_DATE":     BIRTH_DATE,
    "BIRTH_TIME":     BIRTH_TIME,
    "BIRTH_LOCATION": BIRTH_LOCATION,
    "PAGE_NUMBER":    PAGE_NUMBER,
}

# ── STEP 3: write the output PDF ──────────────────────────────────────────────

writer = PdfWriter()
writer.append(reader)          # copies all pages + AcroForm intact
out_page = writer.pages[0]

# 3a. Fill text fields directly on the annotation objects
print("Filling text fields …")
for a_ref in out_page["/Annots"]:
    obj  = a_ref.get_object()
    name = str(obj.get("/T", ""))
    if name in TEXT_VALUES:
        value = TEXT_VALUES[name]
        obj[NameObject("/V")]  = create_string_object(value)
        obj[NameObject("/DV")] = create_string_object(value)
        # Remove stale appearance so viewer regenerates from /V
        if "/AP" in obj:
            ap_obj = obj["/AP"].get_object()
            # Replace AP/N with an empty stream → transparent, viewer will
            # re-render using /DA + /V when NeedAppearances is true
            empty_ap = EncodedStreamObject()
            empty_ap[NameObject("/Type")]     = NameObject("/XObject")
            empty_ap[NameObject("/Subtype")]  = NameObject("/Form")
            empty_ap[NameObject("/FormType")] = NumberObject(1)
            rect  = [float(v) for v in obj["/Rect"]]
            bw, bh = rect[2]-rect[0], rect[3]-rect[1]
            empty_ap[NameObject("/BBox")] = ArrayObject([
                NumberObject(0), NumberObject(0),
                NumberObject(round(bw, 3)), NumberObject(round(bh, 3)),
            ])
            import zlib
            empty_ap[NameObject("/Filter")] = NameObject("/FlateDecode")
            empty_ap._data = zlib.compress(b"")
            ap_ref = writer._add_object(empty_ap)
            obj[NameObject("/AP")] = DictionaryObject({NameObject("/N"): ap_ref})
        print(f"  ✓ {name} = {value!r}")

# 3b. Enable NeedAppearances so viewers render /V with the /DA font
acroform = writer._root_object["/AcroForm"].get_object()
acroform[NameObject("/NeedAppearances")] = BooleanObject(True)

# ── STEP 4: stamp wheel image into NATAL_CHART rect ──────────────────────────

def stamp_image_into_rect(writer, page, rect, img_path):
    """
    Render img_path (PNG with transparency) into the given PDF rect
    by creating a new XObject and appending a content stream.

    rect: [x0, y0, x1, y1] in PDF user-space (origin bottom-left).
    """
    if not HAS_REPORTLAB:
        print("  ⚠ reportlab not installed — skipping image stamp.")
        print("    pip install reportlab")
        return
    if not HAS_PIL:
        print("  ⚠ Pillow not installed — skipping image stamp.")
        print("    pip install Pillow")
        return
    if not os.path.exists(img_path):
        print(f"  ⚠ Wheel image not found: {img_path!r} — skipping.")
        return

    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0

    # Build a tiny ReportLab PDF that draws only the image in the box
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(w, h))
    c.drawImage(ImageReader(img_path),
                x=0, y=0, width=w, height=h,
                preserveAspectRatio=True,
                anchor='c',
                mask='auto')   # honour PNG alpha
    c.save()
    buf.seek(0)

    # Pull the image XObject out of the RL PDF and graft it into our writer
    rl_reader = PdfReader(buf)
    rl_page   = rl_reader.pages[0]
    rl_res    = rl_page["/Resources"].get_object()
    rl_xobjs  = rl_res.get("/XObject", {}).get_object()

    # Merge RL resources into the output page resources
    out_res = page["/Resources"].get_object()
    if "/XObject" not in out_res:
        out_res[NameObject("/XObject")] = DictionaryObject()
    out_xobjs = out_res["/XObject"].get_object()

    # Copy every XObject from RL page (usually just one image)
    imported = []
    for xname, xref in rl_xobjs.items():
        xobj = xref.get_object()
        new_ref = writer._add_object(deepcopy(xobj))
        # pick a unique name
        base_name = f"/WheelIm{xname.lstrip('/')}"
        out_xobjs[NameObject(base_name)] = new_ref
        imported.append((base_name, rl_page))

    # Build a content stream that:
    #  1. saves graphics state
    #  2. sets CTM to place the image at (x0, y0) with size (w, h)
    #  3. draws each imported XObject
    #  4. restores graphics state
    draw_ops = [f"q", f"{w:.3f} 0 0 {h:.3f} {x0:.3f} {y0:.3f} cm"]
    for bname, _ in imported:
        draw_ops.append(f"{bname} Do")
    draw_ops.append("Q")
    overlay_bytes = ("\n".join(draw_ops) + "\n").encode("latin-1")

    # Append as an additional content stream
    import zlib
    ov = EncodedStreamObject()
    ov[NameObject("/Filter")] = NameObject("/FlateDecode")
    ov._data = zlib.compress(overlay_bytes)
    ov_ref = writer._add_object(ov)

    existing = page.get("/Contents")
    if existing is None:
        page[NameObject("/Contents")] = ov_ref
    else:
        existing_obj = existing.get_object()
        if hasattr(existing_obj, "get_data"):   # single stream
            arr = ArrayObject([page["/Contents"], ov_ref])
        else:                                    # already an array
            arr = ArrayObject(list(existing_obj) + [ov_ref])
        page[NameObject("/Contents")] = arr

    print(f"  ✓ Wheel image stamped at rect={[round(v,1) for v in rect]}")


if WHEEL_IMAGE_PATH and "NATAL_CHART" in field_map:
    print("\nStamping natal-chart wheel image …")
    natal_obj = None
    for a_ref in out_page["/Annots"]:
        obj = a_ref.get_object()
        if str(obj.get("/T", "")) == "NATAL_CHART":
            natal_obj = obj
            break
    if natal_obj is not None:
        rect = [float(v) for v in natal_obj["/Rect"]]
        stamp_image_into_rect(writer, out_page, rect, WHEEL_IMAGE_PATH)
    else:
        print("  ⚠ NATAL_CHART annotation not found on page.")

# ── STEP 5: optionally flatten ────────────────────────────────────────────────

if FLATTEN:
    print("\nFlattening …")
    # Move each widget's rendered appearance into the page content layer,
    # then remove all annotations.  Simple approach: strip /Annots and rely
    # on the viewer having already baked appearances (works after saving with
    # NeedAppearances=true and reopening). For a true flatten, use pikepdf:
    try:
        import pikepdf
        tmp_buf = io.BytesIO()
        writer.write(tmp_buf)
        tmp_buf.seek(0)
        pk = pikepdf.open(tmp_buf)
        # pikepdf can flatten forms via its API
        pk.make_stream   # just check it's available
        # flatten: remove form fields from page
        for pg in pk.pages:
            if "/Annots" in pg:
                del pg["/Annots"]
        if "/AcroForm" in pk.Root:
            del pk.Root["/AcroForm"]
        pk.save(OUTPUT_PDF)
        print(f"  Flattened → {OUTPUT_PDF}")
    except ImportError:
        print("  ⚠ pikepdf not installed; saving without flattening.")
        print("    pip install pikepdf")
        FLATTEN = False

if not FLATTEN:
    with open(OUTPUT_PDF, "wb") as fh:
        writer.write(fh)
    sz = os.path.getsize(OUTPUT_PDF)
    print(f"\n✅ Saved:  {OUTPUT_PDF}  ({sz // 1024} KB)")

print("=" * 60)
