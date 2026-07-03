/**
 * Per-reader natal-chart wheel generation pipeline.
 *
 * Renders the customer's actual chart (planet positions at their exact birth
 * time + location) as a square transparent PNG, ready to stamp into the
 * `NATAL_CHART` widget on page 2 of the book.
 *
 * Pipeline:
 *   1. Geocode the free-text `birthLocation` → lat / lng / IANA timezone
 *      (Nominatim, OpenStreetMap's free geocoder)
 *   2. Compute planet positions + house cusps with
 *      circular-natal-horoscope-js (MIT, Moshier-style ephemeris)
 *   3. Draw the wheel SVG with @astrodraw/astrochart (MIT) inside a jsdom DOM
 *   4. Strip AstroChart's own outer ring (Option B in
 *      natal-chart-claude-code-prompt.md — our page art already has the
 *      decorative zodiac rim with sign names + glyphs)
 *   5. Rasterise the SVG to a transparent PNG with sharp
 *
 * Returns `null` on any failure so the renderer falls back cleanly to the
 * stylised vector wheel.
 *
 * See artifacts/book-templates/natal-chart-claude-code-prompt.md for the
 * full design rationale.
 */
import { logger } from "./logger";

/** Result of geocoding the customer's birthplace. */
interface BirthCoords {
  lat: number;
  lng: number;
  /** IANA timezone name, e.g. "America/Los_Angeles". */
  tz: string;
}

/** Resolve an IANA timezone for a (lat, lng). Centralised so both
 *  Google and Nominatim paths share the same tz-lookup logic. */
async function resolveTimezone(lat: number, lng: number): Promise<string> {
  // tz-lookup is a CommonJS module exporting a single function. No
  // @types/tz-lookup ships on npm so we manually shape the type.
  const tzLookupMod = (await import("tz-lookup")) as unknown as { default?: (lat: number, lng: number) => string } | ((lat: number, lng: number) => string);
  const tzLookup = typeof tzLookupMod === "function"
    ? tzLookupMod
    : (tzLookupMod.default ?? ((_lat: number, _lng: number) => "UTC"));
  return tzLookup(lat, lng);
}

/** Google Geocoding API. Tolerates typos ("Bejin, China" → Beijing) and
 *  returns higher-quality matches than Nominatim. Requires
 *  GOOGLE_GEOCODING_API_KEY. Returns null on any failure so the caller
 *  can fall back to Nominatim. */
async function geocodeWithGoogle(location: string, apiKey: string): Promise<BirthCoords | null> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", location);
    url.searchParams.set("key", apiKey);
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) {
      logger.warn({ status: resp.status, location }, "Google Geocoding returned non-2xx");
      return null;
    }
    const data = (await resp.json()) as {
      status: string;
      error_message?: string;
      results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };
    if (data.status !== "OK") {
      logger.warn({ status: data.status, error: data.error_message, location }, "Google Geocoding non-OK");
      return null;
    }
    const hit = data.results[0];
    if (!hit) {
      logger.warn({ location }, "Google Geocoding returned no results");
      return null;
    }
    const { lat, lng } = hit.geometry.location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      logger.warn({ location, raw: hit }, "Google Geocoding returned non-numeric coords");
      return null;
    }
    const tz = await resolveTimezone(lat, lng);
    return { lat, lng, tz };
  } catch (err) {
    logger.warn({ err, location }, "Google Geocoding failed");
    return null;
  }
}

/** Nominatim (OpenStreetMap) fallback. Free, no key, but rate-limited to
 *  ~1 req/sec and strict about exact spelling. Requires a meaningful
 *  User-Agent header per their usage policy. */
async function geocodeWithNominatim(location: string): Promise<BirthCoords | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("q", location);
    url.searchParams.set("limit", "1");
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "holigrowth-book-pipeline/1.0 (support@holigrowth.com)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, location }, "Nominatim returned non-2xx");
      return null;
    }
    const data = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (!data[0]) {
      logger.warn({ location }, "Nominatim returned no results");
      return null;
    }
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      logger.warn({ location, raw: data[0] }, "Nominatim returned non-numeric coords");
      return null;
    }
    const tz = await resolveTimezone(lat, lng);
    return { lat, lng, tz };
  } catch (err) {
    logger.warn({ err, location }, "Nominatim geocoding failed");
    return null;
  }
}

/** Geocode a free-text birth location. Tries Google first (if
 *  GOOGLE_GEOCODING_API_KEY is set), falls back to Nominatim. Returns
 *  null only if both fail — the caller then falls back to the stylised
 *  wheel. Caching the resolved coords on the order row (future
 *  `birthLatitude` / `birthLongitude` / `birthTimezone` columns) would
 *  avoid re-geocoding on re-render. */
async function geocodeBirthLocation(location: string): Promise<BirthCoords | null> {
  if (!location || !location.trim()) return null;
  const trimmed = location.trim();
  const googleKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (googleKey) {
    const fromGoogle = await geocodeWithGoogle(trimmed, googleKey);
    if (fromGoogle) return fromGoogle;
    logger.info({ location: trimmed }, "Google geocoding miss — falling back to Nominatim");
  }
  return geocodeWithNominatim(trimmed);
}

/** Compute a natal chart's planet positions + house cusps from birth data.
 *  Returns the data shape AstroChart's `radix()` expects:
 *  `{ planets: { Sun: [deg], ... }, cusps: [12 longitudes] }`.
 *
 *  All angles are tropical ecliptic longitude in decimal degrees (0-360).
 *  We use Placidus houses, which is the most common modern default. */
async function computeChartData(
  birthday: string,         // "1981-12-13"
  birthTime: string,        // "18:30" — 24h, local at the birth location
  coords: BirthCoords,
): Promise<{ planets: Record<string, number[]>; cusps: number[] } | null> {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
    if (!m) {
      logger.warn({ birthday }, "Unparseable birthday");
      return null;
    }
    const year = parseInt(m[1]!, 10);
    const month = parseInt(m[2]!, 10) - 1; // Origin expects 0-indexed
    const date = parseInt(m[3]!, 10);

    // Birth time is optional; default to noon if missing or malformed.
    let hour = 12;
    let minute = 0;
    const tm = /^(\d{1,2}):(\d{2})/.exec(birthTime);
    if (tm) {
      hour = parseInt(tm[1]!, 10);
      minute = parseInt(tm[2]!, 10);
    }

    // The package is CommonJS — ESM import surfaces the constructors under
    // `.default`. tsx and esbuild both produce `{ default: { Origin, Horoscope } }`.
    const horoscopeMod = await import("circular-natal-horoscope-js");
    const ctor = (horoscopeMod as unknown as {
      default?: { Origin?: new (args: Record<string, unknown>) => unknown; Horoscope?: new (args: Record<string, unknown>) => unknown };
      Origin?: new (args: Record<string, unknown>) => unknown;
      Horoscope?: new (args: Record<string, unknown>) => unknown;
    });
    const Origin = ctor.Origin ?? ctor.default?.Origin;
    const Horoscope = ctor.Horoscope ?? ctor.default?.Horoscope;
    if (!Origin || !Horoscope) {
      logger.warn({ keys: Object.keys(horoscopeMod) }, "circular-natal-horoscope-js had no Origin/Horoscope export");
      return null;
    }

    const origin = new Origin({
      year, month, date, hour, minute,
      latitude: coords.lat,
      longitude: coords.lng,
    });
    const horoscope = new Horoscope({
      origin,
      houseSystem: "placidus",
      zodiac: "tropical",
      aspectPoints: ["bodies", "points"],
      aspectWithPoints: ["bodies", "points"],
      language: "en",
    }) as {
      CelestialBodies: { all: Array<{ label: string; ChartPosition: { Ecliptic: { DecimalDegrees: number } } }> };
      Houses: Array<{ ChartPosition: { StartPosition: { Ecliptic: { DecimalDegrees: number } } } }>;
    };

    const planets: Record<string, number[]> = {};
    for (const body of horoscope.CelestialBodies.all) {
      // AstroChart capitalises the first letter of planet names.
      const key = body.label.charAt(0).toUpperCase() + body.label.slice(1);
      planets[key] = [body.ChartPosition.Ecliptic.DecimalDegrees];
    }
    const cusps = horoscope.Houses.map((h) => h.ChartPosition.StartPosition.Ecliptic.DecimalDegrees);
    return { planets, cusps };
  } catch (err) {
    logger.warn({ err, birthday, birthTime }, "Horoscope computation failed");
    return null;
  }
}

/** Set up the global DOM shims AstroChart needs and import its `Chart`
 *  constructor. Each call creates a fresh jsdom — AstroChart writes into a
 *  real DOM node, and we don't want chart N's SVG to leak into chart N+1. */
async function loadAstroChartInDom(): Promise<{
  Chart: new (rootId: string, w: number, h: number, opts?: Record<string, unknown>) => unknown;
  dom: import("jsdom").JSDOM;
} | null> {
  try {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(
      `<!doctype html><html><body><div id="chart-root"></div></body></html>`,
      { pretendToBeVisual: true },
    );
    const g = globalThis as Record<string, unknown>;
    g.window = dom.window;
    g.document = dom.window.document;
    g.self = dom.window;
    g.SVGElement = dom.window.SVGElement;
    g.HTMLElement = dom.window.HTMLElement;
    g.Element = dom.window.Element;

    const mod = await import("@astrodraw/astrochart");
    const m = mod as unknown as {
      Chart?: typeof globalThis extends never ? never : (new (...a: unknown[]) => unknown);
      default?: { Chart?: new (...a: unknown[]) => unknown };
      astrochart?: { Chart?: new (...a: unknown[]) => unknown };
    };
    const Chart =
      m.Chart ??
      m.default?.Chart ??
      m.astrochart?.Chart ??
      (m.default as unknown as new (...a: unknown[]) => unknown);
    if (typeof Chart !== "function") {
      logger.warn({ keys: Object.keys(mod) }, "@astrodraw/astrochart had no Chart export");
      return null;
    }
    return { Chart: Chart as new (rootId: string, w: number, h: number, opts?: Record<string, unknown>) => unknown, dom };
  } catch (err) {
    logger.warn({ err }, "AstroChart DOM setup failed");
    return null;
  }
}

/** Strip AstroChart's outer ring (Option B). Our page art has its own
 *  decorative zodiac rim — keeping AstroChart's would double the rings.
 *  AstroChart wraps everything in `<g id="<root>-astrology">` with two
 *  direct children: `-aspects` (the aspect lines we want to keep) and
 *  `-radix` (which contains `radix-signs` = the outer ring + zodiac
 *  glyphs, plus everything else we want to keep). We selectively remove
 *  `radix-signs` so the inner content stays. */
function stripOuterRing(svg: {
  querySelector(s: string): { remove(): void } | null;
}): void {
  // Primary target: the named radix-signs group that holds the outer
  // coloured zodiac ring + glyphs.
  const signs = svg.querySelector('g[id$="-radix-signs"]');
  if (signs) {
    signs.remove();
    return;
  }
  // Fallback: nothing matched. Leave the SVG alone — a visible
  // double-ring is preferable to losing the chart content entirely.
}

/**
 * Generate a per-reader natal-chart wheel PNG.
 *
 * @param birthday      ISO date "YYYY-MM-DD"
 * @param birthTime     24h "HH:MM", local at the birth location. Defaults to
 *                      noon if missing — accuracy of the Asc/MC degrades but
 *                      planet signs are still correct (Sun/Moon rarely
 *                      change sign within a day).
 * @param birthLocation Free text — geocoded via Nominatim.
 * @param sizePx        Output PNG dimensions (square). 1200px ≈ 300 dpi for
 *                      the 250pt visible disc on page 2.
 *
 * @returns PNG Buffer on success; `null` on any failure (geocoding, math,
 *          DOM, AstroChart, sharp) so the caller can fall back to the
 *          stylised vector wheel.
 */
export async function generateNatalWheelPng(
  birthday: string,
  birthTime: string,
  birthLocation: string,
  sizePx = 1200,
): Promise<Buffer | null> {
  // 1. Geocode
  const coords = await geocodeBirthLocation(birthLocation);
  if (!coords) return null;

  // 2. Compute
  const chartData = await computeChartData(birthday, birthTime, coords);
  if (!chartData) return null;

  // 3. Draw (in jsdom)
  const astro = await loadAstroChartInDom();
  if (!astro) return null;
  const { Chart, dom } = astro;
  let svgString: string;
  try {
    // AstroChart palette overrides to match the book's ink + gold:
    //   - chart lines / borders → midnight ink
    //   - planet glyphs → midnight ink
    //   - aspect lines: red (hard), blue (soft), green (minor)
    //   - background: transparent (rasterised below)
    // IMPORTANT: instantiate exactly ONCE — each new Chart() appends a fresh
    // SVG to the root div, and `querySelector("svg")` below returns the
    // first one. A second instantiation would leave us with an empty SVG.
    const chart = new Chart("chart-root", sizePx, sizePx, {
      COLOR_BACKGROUND: "transparent",
      COLOR_LINE: "#1a1730",
      COLOR_PLANETS: "#1a1730",
      COLOR_NUMBERS: "#1a1730",
      COLOR_SIGNS: "#b08a3e",
      COLOR_ASPECTS_HARD: "#b0524a",
      COLOR_ASPECTS_SOFT: "#4f6f9f",
      COLOR_ASPECTS_MINOR: "#5f7d4a",
    }) as { radix: (data: { planets: Record<string, number[]>; cusps: number[] }) => { aspects: () => void } };
    const radix = chart.radix(chartData);
    radix.aspects();

    const svgEl = dom.window.document.querySelector("svg");
    if (!svgEl) {
      logger.warn("AstroChart produced no SVG");
      return null;
    }
    // 4. Option B trim — strip AstroChart's own outer ring so our page's
    //    decorative rim isn't doubled.
    stripOuterRing(svgEl);

    // Ensure the SVG has explicit xmlns (sharp's rasteriser is strict).
    if (!svgEl.getAttribute("xmlns")) {
      svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    svgString = svgEl.outerHTML;
  } catch (err) {
    logger.warn({ err }, "AstroChart draw failed");
    return null;
  } finally {
    // jsdom doesn't auto-clean its globals — leave them in place. They're
    // only used by AstroChart, and overwriting them per-call is fine.
  }

  // 5. Rasterise to transparent PNG
  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    const pngBuf = await sharp(Buffer.from(svgString), { density: 300 })
      .resize(sizePx, sizePx, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return pngBuf;
  } catch (err) {
    logger.warn({ err }, "SVG rasterisation failed");
    return null;
  }
}
