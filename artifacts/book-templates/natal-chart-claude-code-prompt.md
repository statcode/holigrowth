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

## 🔒 LOCKED: Option B (inner wheel only, transparent background)

> **The page art already provides the decorative zodiac ring with sign names
> AND glyphs printed around the gold rim.** Drawing AstroChart's own outer
> ring on top would produce a visible double-ring. So we render *only* the
> inner content (planet glyphs at true degrees, house spokes numbered 1–12,
> red/blue/green aspect lines) on a **transparent** background, and the
> page's existing rim stays visible.

This locks in concretely as:

- Strip AstroChart's outer ring (configure `SYMBOL_SCALE`, suppress sign-ring
  layer, or post-process by removing the outermost `<g>`).
- Export on **transparent** background — *not* `#f3e9d2` parchment fill.
- Suppress AstroChart's sign-glyph layer at the outer edge (the page already
  has its own gold glyphs at the outer rim).
- Keep the inner content: planets, house cusps + numbers, aspect lines.

If a future template redesign removes the baked-in zodiac ring, revisit this
and switch to Option A (full wheel with parchment fill).

---

## 1 · Generate the wheel — MIT/JS stack

Use a **two-library split**: one library *calculates* the positions, a second
one *draws* the wheel. Both are **MIT-licensed** (no copyleft, free for
commercial / closed-source use — no strings, no fees).

**Calculate — [`circular-natal-horoscope-js`](https://github.com/0xStarcat/CircularNatalHoroscopeJS)** (MIT)
Computes Ascendant / Midheaven, all major bodies + lunar nodes, retrograde
flags, and house cusps in multiple house systems (Placidus, Whole Sign, etc.).

**Draw — [`@astrodraw/astrochart`](https://github.com/AstroDraw/AstroChart)** (MIT, the maintained AstroChart fork)
Pure renderer: you hand it `planets` + `cusps`, it returns the SVG wheel —
glyphs, house spokes, and aspect lines drawn for you. It does **not** compute
anything itself, which is why it's paired with the calculator above.

```bash
pnpm --filter @workspace/api-server add \
  circular-natal-horoscope-js \
  @astrodraw/astrochart \
  sharp \
  jsdom \
  tz-lookup
```

`sharp` rasterises SVG → PNG. `jsdom` provides the DOM AstroChart needs when
running in Node. `tz-lookup` resolves IANA timezone name from lat/lng.

```ts
// artifacts/api-server/src/lib/natalWheel.ts
import { Origin, Horoscope } from "circular-natal-horoscope-js";
import { Chart } from "@astrodraw/astrochart";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import tzLookup from "tz-lookup";

export async function generateNatalWheelPng(
  birthday: string,    // "1981-12-13"
  birthTime: string,   // "18:30" (24h, local)
  lat: number,
  lng: number,
): Promise<Buffer> {
  // 1 · CALCULATE — note month is 0-indexed (December = 11)
  const [y, mo, d] = birthday.split("-").map(Number);
  const [hh, mm] = birthTime.split(":").map(Number);
  const origin = new Origin({
    year: y, month: mo - 1, date: d, hour: hh, minute: mm,
    latitude: lat, longitude: lng,
  });
  const horoscope = new Horoscope({
    origin,
    houseSystem: "placidus",
    zodiac: "tropical",
    aspectPoints: ["bodies", "points"],
    aspectWithPoints: ["bodies", "points"],
    language: "en",
  });

  // 2 · ADAPT — map the horoscope output into AstroChart's expected shape.
  //     planets: { Sun: [eclipticLongitudeDeg], Moon: [...], ... }
  //     cusps:   [12 house-cusp longitudes, in order]
  const planets: Record<string, number[]> = {};
  for (const b of horoscope.CelestialBodies.all) {
    planets[b.label] = [b.ChartPosition.Ecliptic.DecimalDegrees];
  }
  const cusps = horoscope.Houses.map(
    (h: any) => h.ChartPosition.StartPosition.Ecliptic.DecimalDegrees,
  );

  // 3 · DRAW into a jsdom-backed SVG element. AstroChart writes into a real
  //    DOM node, so we provide one through jsdom.
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="chart-root"></div></body></html>`,
  );
  const { window } = dom;
  (global as any).document = window.document;
  (global as any).window = window;

  const SIZE = 1200; // square px — 300 dpi for the 276 pt box
  const chart = new Chart("chart-root", SIZE, SIZE, {
    // Option B overrides — strip the outer ring + sign glyphs so only the
    // inner wheel renders. The page art supplies the decorative rim.
    SYMBOL_SCALE: 1,
    COLOR_BACKGROUND: "transparent",
    // Palette to match the page
    COLOR_LINES: "#1a1730",
    COLOR_SIGNS: "#b08a3e",
    COLOR_PLANETS: "#1a1730",
    COLOR_ASPECTS_HARD: "#b0524a",
    COLOR_ASPECTS_SOFT: "#4f6f9f",
    COLOR_ASPECTS_MINOR: "#5f7d4a",
  });
  const radix = chart.radix({ planets, cusps });
  radix.aspects();

  const svgEl = window.document.querySelector("svg");
  if (!svgEl) throw new Error("AstroChart didn't produce an SVG element");
  // Post-process: remove the outermost ring layer so only the inner content
  // remains. AstroChart's ring is the first <g> child of the SVG — adjust the
  // selector if the library version changes.
  const outerRing = svgEl.querySelector("g.outer-ring, g[class*='ring']");
  if (outerRing) outerRing.remove();

  const svgString = svgEl.outerHTML;

  // 4 · RASTERIZE to transparent PNG with sharp
  const pngBuf = await sharp(Buffer.from(svgString))
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return pngBuf;
}
```

> **Accuracy note (be honest with the user):** `circular-natal-horoscope-js`
> uses its own Moshier-style ephemeris — accurate to within ~1 arc-minute for
> modern dates, which is **more than enough for a natal book** (glyphs land in
> the correct sign and degree). If you ever need observatory-grade precision,
> swap *only the calculation step* for the Swiss-Ephemeris WASM port
> (`sweph` / `swisseph-wasm`) and feed its longitudes into the same AstroChart
> drawing step. ⚠️ Swiss Ephemeris is itself **dual-licensed AGPL/commercial**,
> so only reach for it if you accept that license — the pure-MIT stack above
> is the default.

---

## 2 · Geocoding the birth location

The customer enters `birthLocation` as free text (e.g. "San Diego, California,
USA"). Astrology calculations need precise **lat / lng + IANA timezone name**.

Use Nominatim (OpenStreetMap's free geocoder) with caching:

```ts
async function geocodeBirthLocation(location: string): Promise<{ lat: number; lng: number; tz: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "holigrowth-book-pipeline/1.0 (support@holigrowth.com)" },
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as Array<{ lat: string; lon: string }>;
  if (!data[0]) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  const tz = tzLookup(lat, lng); // resolves "America/Los_Angeles" etc.
  return { lat, lng, tz };
}
```

- Nominatim free tier: **1 req/sec**, requires a real user-agent. Cache the
  result on the order row (add columns `birthLatitude DECIMAL(9,6)`,
  `birthLongitude DECIMAL(9,6)`, `birthTimezone VARCHAR(64)` to
  `zodiac_orders`) so a re-render doesn't re-geocode.
- If the geocoder times out or returns nothing, **fall back to the stylized
  vector wheel** (`drawStylizedNatalWheel`) so the page is never blank.
- Commercial scale (>1 customer/sec) → swap Nominatim for a paid service
  (Google Maps Geocoding API, Mapbox, LocationIQ).

---

## 3 · Stamp it (Node, in `buildNatalChartPage`)

The Node renderer already reads `NATAL_CHART`'s `/Rect` from the manifest. The
remaining work is wiring the PNG into the existing builder:

```ts
// inside buildNatalChartPage in render.ts — replace the call to
// drawStylizedNatalWheel with the real-wheel path, with fallback.
const wheelSlot = getSlot(pageType, "NATAL_CHART");
let stamped = false;
if (wheelSlot && order.birthday && order.birthLocation) {
  try {
    const coords = await getOrCacheBirthCoords(ctx, order);
    if (coords) {
      const pngBuf = await generateNatalWheelPng(
        order.birthday, order.birthTime ?? "12:00",
        coords.lat, coords.lng,
      );
      const img = await ctx.out.embedPng(pngBuf);
      // The wheel widget is a small anchor (~107×14 pt); the actual visible
      // disc on the page is ~250 pt square centred horizontally at the page
      // mid-width. Stamp at the visible disc, not the widget rect.
      const discSize = 250;
      const discCx = 225;
      const discCy = 277; // see NATAL_WHEEL_CENTER_Y in render.ts
      page.drawImage(img, {
        x: discCx - discSize / 2,
        y: discCy - discSize / 2,
        width: discSize,
        height: discSize,
      });
      stamped = true;
    }
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "Natal wheel generation failed");
  }
}
if (!stamped) {
  // Fallback: stylized vector wheel from Sun/Moon/Rising signs only.
  drawStylizedNatalWheel(rc, order);
}
```

Cache the PNG buffer per-order (in `order.natalWheelPngUrl` if uploaded to
object storage, or in-memory for the lifetime of the build) so regenerating
PDFs doesn't recompute the chart.

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

- [ ] Real wheel computed from the actual birth data (not the HTML stand-in)
      with `circular-natal-horoscope-js`.
- [ ] Drawn with `@astrodraw/astrochart` — glyphs at true degrees, house
      numbers, red / blue / green aspect lines.
- [ ] Rasterized to a **square transparent PNG**; AstroChart's own outer ring
      stripped (Option B — see locked decision above) so the page's baked-in
      zodiac rim stays visible.
- [ ] Palette overridden to the page's ink / gold.
- [ ] Birth-location geocoded (Nominatim or paid service), result cached on
      the order row so a re-render doesn't re-geocode.
- [ ] PNG stamped into the wheel widget's visible disc area; 5 text fields
      already filled by `buildNatalChartPage`.
- [ ] Graceful fallback to `drawStylizedNatalWheel` when coords can't be
      resolved or wheel generation throws.
- [ ] Output PDF opens with the wheel centred on the parchment disc, the
      page's gold zodiac rim still visible around it (no double-ring).
