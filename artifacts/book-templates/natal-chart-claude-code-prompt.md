# Natal-chart page — per-reader wheel generation handoff

> **Status:** Hand-off doc for the engineer/agent generating the dynamic per-reader
> natal-chart wheel image that gets stamped into the `10-natal-chart-editable.pdf`
> template. The text fields (name, date, time, place, page number) are already
> wired through the Node renderer (`buildNatalChartPage` in
> [render.ts](../api-server/src/routes/zodiac-orders/templatedPdf/render.ts)).
> The remaining work is **(a) generate a square transparent PNG of the reader's
> actual chart** and **(b) stamp it into the wheel widget at render time**.

> **Field-name caveat.** The PDF on disk currently labels the image widget
> `NATAL_CHART` and the birthplace widget `BIRTH_LOCATION`. This hand-off prompt
> uses the future-state names `NATAL_DIAGRAM` / `BIRTH_PLACE`. When the designer
> re-exports the template with the renamed widgets, run
> `pnpm --filter @workspace/scripts run extract-template-slots` to refresh the
> manifest, then update `buildNatalChartPage` to reference the new field names.

---

## ⚠️ READ THIS FIRST — there is NO chart image included

**No `natal_wheel.png` (or any chart raster) ships with this repo.** The name
`natal_wheel.png` that appears in [fill_natal_chart.py](fill_natal_chart.py)
notes is a *placeholder* for an image **you must generate yourself** from the
reader's birth data. Likewise there is no "wheel generator" binary in the repo
— that's software you install.

What the HTML preview shows in the center disc is a **hand-drawn decorative
stand-in** baked into the page art for layout purposes only. It is **not** a
real, computed chart and must not be shipped. The actual per-reader wheel is
dropped into the AcroForm image field **`NATAL_DIAGRAM`** (currently
`NATAL_CHART` — see field-name caveat above) at fill time — that field is
empty until you stamp your generated image into it.

So your job has two halves:

1. **Generate** a real natal-chart wheel image from the birth data.
2. **Stamp** it into the wheel widget's `/Rect` (and fill the 5 text fields —
   already done by `buildNatalChartPage`).

---

## 1 · Generate the wheel

You need software that (a) computes planetary + house + aspect positions from
birth data and (b) renders a wheel. Recommended, in order:

### Option A — Kerykeion (Python)

High-precision calculations via the Swiss Ephemeris, plus SVG rendering. It has
a **wheel-only** export, which is exactly what we want (no redundant outer
chrome — our page already supplies the decorative zodiac ring).

```bash
pip install kerykeion
```

```python
from pathlib import Path
from kerykeion import AstrologicalSubjectFactory
from kerykeion.chart_data_factory import ChartDataFactory
from kerykeion.charts.chart_drawer import ChartDrawer

subject = AstrologicalSubjectFactory.from_birth_data(
    "Chelsea Cardinal", 1981, 12, 13, 18, 30,   # year, month, day, hour, minute (24h, local)
    lng=-117.6028, lat=33.6406, tz_str="America/Los_Angeles",
    online=False,
)
chart_data = ChartDataFactory.create_natal_chart_data(subject)
drawer = ChartDrawer(chart_data=chart_data)
out = Path("charts_output"); out.mkdir(exist_ok=True)
# wheel-only = just the inner graphic, no labels/tables around it
drawer.save_wheel_only_svg_file(output_path=out, filename="chelsea-wheel")
```

> **License caveat (important for a commercial book product):** Kerykeion is
> **AGPL-3.0**. Importing it into a closed-source app makes that app subject to
> AGPL copyleft. For a commercial/closed product, use the hosted **Astrologer
> API** (RapidAPI) instead and consume it as an external service, or pick the
> MIT-licensed JS stack below.

### Option B — JavaScript (MIT-friendly, calculate + draw split)

- **Calculate:** `circular-natal-horoscope-js` — ascendant/MC, all major bodies,
  nodes, retrograde flags, house cusps in multiple systems.
- **Draw:** `@astrodraw/astrochart` or `Kibo/AstrologyChart2` — feed it `points`
  + `cusps`, get a wheel SVG back. (These only *draw*; they don't compute
  positions — hence the pairing.)

Option B fits the existing Node renderer better. The Node-native chain is:

```
birthday + birthTime + birthLocation
    │
    ▼  (geocode + tz resolve — Nominatim, Google, or pre-resolved in DB)
lat, lng, tz_str, datetime
    │
    ▼  (circular-natal-horoscope-js)
{ascendant, midheaven, planets[], houses[]}
    │
    ▼  (@astrodraw/astrochart or AstrologyChart2)
SVG string
    │
    ▼  (resvg-js or sharp)
square transparent PNG buffer
    │
    ▼  (pdf-lib: embedPng → drawImage into widget /Rect)
stamped into NATAL_DIAGRAM widget on page 2
```

---

## 2 · Turn it into a stampable image

Whatever generator you use, produce a **square, transparent PNG** (rasterize
the SVG, e.g. with `cairosvg`, `resvg-js`, or a headless browser):

- **Square** aspect ratio, e.g. 1200×1200 px (≈ 300 dpi for the 276 pt box).
- **Transparent background** — corners must be transparent so the page's
  parchment disc and gold rim show through. Render only the inner wheel; do
  **not** draw your own outer ring, zodiac names, or background fill.
- **Palette to match the page** (so it reads as part of the book, not a pasted
  screenshot):
  - ink / lines: `#1a1730` (and softer `#2a2540`)
  - gold accents: `#b08a3e`
  - aspect lines: red `#b0524a` (hard), blue `#4f6f9f` (soft), green `#5f7d4a` (minor)
  - keep the disc fill transparent — the page already provides the `#f3e9d2`
    parchment.
- Fit the artwork so the wheel's outer edge sits just inside the square (small
  margin), centered.

---

## 3 · Stamp it (Node, in `buildNatalChartPage`)

The Node renderer already reads `NATAL_CHART`'s `/Rect` from the manifest. The
work to add image-stamping is:

```ts
// inside buildNatalChartPage in render.ts
const wheelSlot = getSlot(pageType, "NATAL_CHART");
if (wheelSlot && ctx.order.birthday && ctx.order.birthLocation) {
  const pngBuf = await generateNatalWheelPng(ctx.order); // your new helper
  const img = await ctx.out.embedPng(pngBuf);
  // slot.y is the baseline; back out the rect's bottom and dimensions
  const rectY = wheelSlot.y - Math.max(wheelSlot.h - 12, 4);
  page.drawImage(img, {
    x: wheelSlot.x,
    y: rectY,
    width: wheelSlot.w,
    height: wheelSlot.h,
  });
}
```

`generateNatalWheelPng(order)` is the new helper that does the calculate →
draw → rasterize chain above. Cache the PNG buffer per-order so a regenerate
doesn't recompute.

---

## Python reference (one-off, for designer validation)

[fill_natal_chart.py](fill_natal_chart.py) in this folder is a designer-side
script that fills the AcroForm widgets with sample data and stamps an arbitrary
PNG into the wheel rect using pypdf + reportlab. It is **not** part of the
production pipeline — the Node renderer reproduces the same fill logic via
pdf-lib in `buildNatalChartPage`. Keep the Python script around for quick
visual validation when the designer re-exports the template.

---

## Definition of done

- [ ] Real wheel generated from the actual birth data (not the HTML stand-in).
- [ ] Exported as a square, transparent PNG with no self-drawn outer ring.
- [ ] PNG stamped into the wheel widget's `/Rect`; 5 text fields filled (text
      fields already work; only the image stamp is pending).
- [ ] Output PDF opens with the wheel centered on the parchment disc, corners
      showing parchment.
