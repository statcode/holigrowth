/**
 * Renderer: takes a ParsedBook + the manifest, and produces a Lulu-ready
 * interior PDF by embedding template pages and overlaying personalized text.
 *
 * Approach for each placeholder slot:
 *   1. Embed the template page into a fresh page in the output PDF.
 *   2. Draw a small fill rectangle in the page's background colour over the
 *      placeholder text to mask the visible `{{NAME}}` glyphs (the bytes
 *      remain in the embedded XObject but are visually covered).
 *   3. Draw the personalized text at the slot's (x, y) using a per-placeholder
 *      style preset — font size and weight chosen by the placeholder's NAME,
 *      not by the placeholder's own 8.5pt size (that's just a designer hint).
 *
 * Body prose that overruns one `02-standard-body` page falls through onto a
 * second `02-standard-body` page and so on until the chapter is exhausted.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument, rgb, degrees, StandardFonts, type PDFFont, type PDFPage, type PDFEmbeddedPage } from "pdf-lib";
import type { ZodiacOrder } from "@workspace/db";
import {
  loadManifest,
  templatePath,
  templatesDir,
  parseBook,
  type Manifest,
  type PageType,
  type PageTypeKey,
  type ParsedBook,
  type ParsedChapter,
  type Recipe,
  type Slot,
} from "./parse";

// ── Page background colours per template (designer hints — tune as needed) ──

// Sampled from the templates' raster backgrounds — the page-background cream
// is RGB ~(245, 242, 232) = [0.961, 0.949, 0.910]. The templates ALSO have
// slightly darker cream rectangles (~245, 241, 230) baked into the raster
// at every AcroForm widget position (Claude.ai's exporter rasterizes the
// widget fill colour). We deliberately match the PAGE bg here, not the
// widget bg, so our masks blend with the surrounding page rather than
// looking like extended widget rectangles. The small baked widget squares
// remain faintly visible inside our masked region, but they're covered by
// the personalized text we draw on top. Section-divider is midnight.
const TEMPLATE_CREAM: [number, number, number] = [0.961, 0.949, 0.910];
const PAGE_BG: Record<PageTypeKey, [number, number, number]> = {
  "chapter-opener": TEMPLATE_CREAM,
  "standard-body": TEMPLATE_CREAM,
  "standard-body-with-quotes": TEMPLATE_CREAM,
  "data-numerology": TEMPLATE_CREAM,
  "affirmations": TEMPLATE_CREAM,
  "section-divider": [0.04, 0.06, 0.10], // midnight — keep AcroForm mask skip elsewhere
  "welcome-letter": TEMPLATE_CREAM,
  // closing-letter was redesigned as a midnight purple "love letter from the
  // universe" card — sampled bg rgb(41, 35, 70). Body text must be light/
  // cream to read against it (see PAGE_FG below).
  "closing-letter": [41/255, 35/255, 70/255],
  "body-continued": TEMPLATE_CREAM,
  "zodiac-moon": TEMPLATE_CREAM,
  "zodiac-rising": TEMPLATE_CREAM,
  "birthstone": TEMPLATE_CREAM,
  "natal-chart": TEMPLATE_CREAM,
};

// Foreground text colours for each template's body copy.
const PAGE_FG: Record<PageTypeKey, [number, number, number]> = {
  "chapter-opener": [0.13, 0.10, 0.18],
  "standard-body": [0.13, 0.10, 0.18],
  "standard-body-with-quotes": [0.13, 0.10, 0.18],
  "data-numerology": [0.13, 0.10, 0.18],
  "affirmations": [0.13, 0.10, 0.18],
  "section-divider": [0.95, 0.92, 0.78],
  "welcome-letter": [0.13, 0.10, 0.18],
  // closing-letter is midnight purple — use light cream for body text so it
  // reads against the dark background (same approach as section-divider).
  "closing-letter": [0.95, 0.92, 0.78],
  "body-continued": [0.13, 0.10, 0.18],
  "zodiac-moon": [0.13, 0.10, 0.18],
  "zodiac-rising": [0.13, 0.10, 0.18],
  "birthstone": [0.13, 0.10, 0.18],
  "natal-chart": [0.13, 0.10, 0.18],
};

const GOLD: [number, number, number] = [0.79, 0.66, 0.30];

const ZODIAC_GLYPHS: Record<string, string> = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋",
  Leo: "♌", Virgo: "♍", Libra: "♎", Scorpio: "♏",
  Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};

/** Birthstone metadata keyed by birth month (1 = January … 12 = December).
 *  `slug` is the filename stem the renderer looks for under
 *  `artifacts/book-templates/birthstones/<slug>.png` when filling
 *  `BIRTHSTONE_IMAGE`. If the PNG is missing, the renderer falls back to a
 *  vector gemstone drawn with `color` — `colorHi` is the small highlight
 *  glint, `colorLo` is the inner shadow ring. Hex values pulled from common
 *  gem photography references. */
interface Birthstone {
  name: string;          // "Garnet"
  slug: string;          // "garnet" — filename stem for /birthstones/<slug>.png
  tagline: string;       // short one-liner shown beneath the gem visual
  color: [number, number, number];   // body fill (0..1 rgb)
  colorHi: [number, number, number]; // highlight glint
  colorLo: [number, number, number]; // inner shadow ring
}
const BIRTHSTONES: Record<number, Birthstone> = {
  1:  { name: "Garnet",      slug: "garnet",      tagline: "Symbolizes trust, strength, and protection.",        color: [0.45, 0.08, 0.12], colorHi: [0.78, 0.30, 0.32], colorLo: [0.30, 0.05, 0.08] },
  2:  { name: "Amethyst",    slug: "amethyst",    tagline: "Carries royal calm, intuition, and quiet wisdom.",   color: [0.42, 0.27, 0.62], colorHi: [0.74, 0.60, 0.90], colorLo: [0.28, 0.16, 0.45] },
  3:  { name: "Aquamarine",  slug: "aquamarine",  tagline: "Channels tranquility, hope, and clarity of mind.",   color: [0.50, 0.78, 0.86], colorHi: [0.78, 0.93, 0.96], colorLo: [0.32, 0.58, 0.68] },
  4:  { name: "Diamond",     slug: "diamond",     tagline: "Represents eternity, strength, and resilience.",     color: [0.92, 0.93, 0.96], colorHi: [1.00, 1.00, 1.00], colorLo: [0.72, 0.74, 0.80] },
  5:  { name: "Emerald",     slug: "emerald",     tagline: "A symbol of rebirth, devoted love, and growth.",     color: [0.10, 0.50, 0.36], colorHi: [0.42, 0.78, 0.55], colorLo: [0.05, 0.32, 0.22] },
  6:  { name: "Pearl",       slug: "pearl",       tagline: "Symbolizes purity, balance, and quiet wisdom.",      color: [0.95, 0.93, 0.88], colorHi: [1.00, 0.99, 0.96], colorLo: [0.78, 0.74, 0.68] },
  7:  { name: "Ruby",        slug: "ruby",        tagline: "Known for passion, courage, and vital aliveness.",   color: [0.72, 0.10, 0.20], colorHi: [0.96, 0.36, 0.42], colorLo: [0.48, 0.05, 0.12] },
  8:  { name: "Peridot",     slug: "peridot",     tagline: "Linked to prosperity, joy, and inner strength.",     color: [0.60, 0.76, 0.20], colorHi: [0.84, 0.94, 0.46], colorLo: [0.42, 0.54, 0.10] },
  9:  { name: "Sapphire",    slug: "sapphire",    tagline: "Embodies truth, loyalty, and sovereign wisdom.",     color: [0.08, 0.22, 0.55], colorHi: [0.30, 0.50, 0.84], colorLo: [0.04, 0.12, 0.36] },
  10: { name: "Opal",        slug: "opal",        tagline: "Represents creativity, hope, and emotional healing.", color: [0.90, 0.86, 0.80], colorHi: [1.00, 0.96, 0.92], colorLo: [0.72, 0.62, 0.78] },
  11: { name: "Citrine",     slug: "citrine",     tagline: "Radiates joy, abundance, and warm positivity.",      color: [0.92, 0.66, 0.18], colorHi: [1.00, 0.86, 0.42], colorLo: [0.66, 0.42, 0.08] },
  12: { name: "Turquoise",   slug: "turquoise",   tagline: "Represents good fortune and spiritual alignment.",   color: [0.20, 0.66, 0.66], colorHi: [0.50, 0.86, 0.86], colorLo: [0.10, 0.42, 0.46] },
};

/** Resolve a birthstone from a "YYYY-MM-DD" birthday. Returns January's stone
 *  as a benign default when the date is unparseable, so we never crash the
 *  whole book over a missing or malformed date. */
function birthstoneForBirthday(birthday: string | null | undefined): Birthstone {
  if (!birthday) return BIRTHSTONES[1]!;
  const m = /^\d{4}-(\d{2})-/.exec(birthday);
  const month = m ? parseInt(m[1]!, 10) : NaN;
  return BIRTHSTONES[month] ?? BIRTHSTONES[1]!;
}

// ── Font loader ──────────────────────────────────────────────────────────────

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  display: PDFFont; // for big titles
  $isCormorant: boolean;
}

async function tryLoadFont(doc: PDFDocument, file: string): Promise<PDFFont | null> {
  try {
    const buf = await fs.readFile(file);
    return await doc.embedFont(buf, { subset: true });
  } catch {
    return null;
  }
}

async function loadFonts(doc: PDFDocument): Promise<FontSet> {
  const dir = path.join(templatesDir(), "fonts");
  // Drop OFL-licensed Cormorant TTFs here for typography parity with the templates.
  const candidates = [
    { name: "regular",    files: ["CormorantGaramond-Regular.ttf",    "Cormorant-Regular.ttf"] },
    { name: "bold",       files: ["CormorantGaramond-Bold.ttf",       "Cormorant-Bold.ttf"] },
    { name: "italic",     files: ["CormorantGaramond-Italic.ttf",     "Cormorant-Italic.ttf"] },
    { name: "boldItalic", files: ["CormorantGaramond-BoldItalic.ttf", "Cormorant-BoldItalic.ttf"] },
  ] as const;

  const loaded: Partial<Record<typeof candidates[number]["name"], PDFFont>> = {};
  for (const c of candidates) {
    for (const f of c.files) {
      const font = await tryLoadFont(doc, path.join(dir, f));
      if (font) {
        loaded[c.name] = font;
        break;
      }
    }
  }

  const cormorantPresent = Boolean(loaded.regular && loaded.bold && loaded.italic);
  if (!cormorantPresent) {
    const regular = await doc.embedFont(StandardFonts.TimesRoman);
    const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
    const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
    const boldItalic = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
    return { regular, bold, italic, boldItalic, display: bold, $isCormorant: false };
  }

  return {
    regular: loaded.regular!,
    bold: loaded.bold!,
    italic: loaded.italic!,
    boldItalic: loaded.boldItalic ?? loaded.bold!,
    display: loaded.bold!,
    $isCormorant: true,
  };
}

// ── Per-placeholder style presets ────────────────────────────────────────────

type WeightKey = "regular" | "bold" | "italic" | "boldItalic" | "display";

interface PlaceholderStyle {
  weight: WeightKey;
  size: number;
  /** RGB triple in 0..1 or one of the magic strings to inherit page colour. */
  color: [number, number, number] | "fg" | "gold";
  /** Horizontal alignment relative to the slot's x. "center" treats x as the centre. */
  align: "left" | "center";
  /** Multi-line max width in points (only used for paragraph-type placeholders). */
  wrapWidth?: number;
  /** Line height multiplier for wrapped text. */
  leading?: number;
  /** Letter spacing in em units (rough approximation in pt). */
  characterSpacing?: number;
  /** Set true for the few placeholders that use ALL CAPS in the templates. */
  upper?: boolean;
  /** Indent text from slot.x (e.g. to clear a template-drawn bullet marker). */
  xIndent?: number;
  /** Auto-shrink font size to fit slot.w when text is too wide (single-line only). */
  autoShrink?: boolean;
  /** Minimum size when autoShrink is on. */
  minSize?: number;
}

const STYLES: Record<string, PlaceholderStyle> = {
  // Chapter opener (recto, midnight)
  CH_NUM:           { weight: "italic",  size: 26, color: "gold", align: "center" },
  // Header band CHAPTER_TITLE is narrow — long titles must shrink to fit.
  // Overridden on the chapter-opener page where it's the centered big title.
  CHAPTER_TITLE:    { weight: "bold",    size: 9,  color: "fg",   align: "left", characterSpacing: 1.2, upper: true, autoShrink: true, minSize: 6 },
  CHAPTER_SUBTITLE: { weight: "italic",  size: 13, color: "gold", align: "center", wrapWidth: 320 },

  // Body pages
  READER_FIRST_NAME:   { weight: "bold",    size: 9,    color: "fg",   align: "left",  upper: true, characterSpacing: 1.5, autoShrink: true, minSize: 6 },
  LEAD_PARAGRAPH:      { weight: "italic",  size: 12.5, color: "fg",   align: "left",  wrapWidth: 360, leading: 1.55 },
  SUBSECTION_HEADING:  { weight: "italic",  size: 12,   color: "gold", align: "left",  characterSpacing: 0.5 },
  BODY_PARAGRAPH:      { weight: "regular", size: 11.5, color: "fg",   align: "left",  wrapWidth: 360, leading: 1.55 },
  // BULLET_* indented past the template's ✶ marker (which is drawn at slot.x
  // — and at the marker's larger glyph size, often 14-16pt wide).
  BULLET_1:            { weight: "bold",    size: 10,   color: "gold", align: "left",  upper: true, characterSpacing: 0.8, xIndent: 32 },
  BULLET_2:            { weight: "bold",    size: 10,   color: "gold", align: "left",  upper: true, characterSpacing: 0.8, xIndent: 32 },
  BULLET_3:            { weight: "bold",    size: 10,   color: "gold", align: "left",  upper: true, characterSpacing: 0.8, xIndent: 32 },

  // Pull quote (recto)
  // Pull-quote is the lone focal element on `03-standard-body-with-quotes`,
  // so we render it large (20pt) with generous leading and a wider wrap so
  // each line has visual weight. drawPullQuoteCentered auto-shrinks if a
  // very long quote runs past MAX_LINES.
  PULL_QUOTE: { weight: "italic", size: 20, color: "gold", align: "center", wrapWidth: 360, leading: 1.45 },

  // Data card
  INTERPRETATION_BODY: { weight: "regular", size: 11, color: "fg", align: "left", wrapWidth: 360, leading: 1.5 },
  NUMBER:              { weight: "display", size: 56, color: "gold", align: "left" },
  ARCHETYPE_NAME:      { weight: "italic",  size: 16, color: "fg", align: "left" },
  CALCULATION:         { weight: "regular", size: 10, color: "fg", align: "left" },
  ELEMENT:             { weight: "regular", size: 10, color: "fg", align: "left" },
  KEYWORDS:            { weight: "regular", size: 10, color: "fg", align: "left" },
  SHADOW:              { weight: "regular", size: 10, color: "fg", align: "left" },
  SIGN:                { weight: "italic",  size: 14, color: "gold", align: "left" },
  HOUSE:               { weight: "regular", size: 10, color: "fg",   align: "left" },

  // Affirmation feature
  AFFIRMATION_TEXT:     { weight: "italic",  size: 18, color: "fg",   align: "center", wrapWidth: 320, leading: 1.4 },
  PLACEMENT_REFERENCE:  { weight: "regular", size: 9,  color: "gold", align: "left",  upper: true, characterSpacing: 1.3 },

  // Section divider
  PART_NUM:     { weight: "display", size: 60, color: "gold", align: "center" },
  PART_TITLE:   { weight: "italic",  size: 22, color: "fg",   align: "center" },
  PART_TAGLINE: { weight: "italic",  size: 12, color: "fg",   align: "center", wrapWidth: 320, leading: 1.4 },

  // Welcome letter
  WELCOME_BODY_PARAGRAPH_1: { weight: "regular", size: 11.5, color: "fg",   align: "left",   wrapWidth: 360, leading: 1.55 },
  WELCOME_BODY_PARAGRAPH_2: { weight: "regular", size: 11.5, color: "fg",   align: "left",   wrapWidth: 360, leading: 1.55 },
  WELCOME_SIGNOFF_LINE:     { weight: "italic",  size: 12,   color: "fg",   align: "left" },
  WELCOME_SIGNATURE:        { weight: "italic",  size: 16,   color: "gold", align: "left" },
  WELCOME_FOOTER:           { weight: "regular", size: 8,    color: "fg",   align: "center", upper: true, characterSpacing: 1.5 },
  DISCLAIMER_TEXT:          { weight: "italic",  size: 9,    color: "fg",   align: "left",   wrapWidth: 360, leading: 1.4 },

  // Closing letter
  CLOSING_BODY_PARAGRAPH_1: { weight: "regular", size: 11.5, color: "fg",   align: "left",   wrapWidth: 360, leading: 1.55 },
  CLOSING_BODY_PARAGRAPH_2: { weight: "regular", size: 11.5, color: "fg",   align: "left",   wrapWidth: 360, leading: 1.55 },
  CLOSING_BODY_PARAGRAPH_3: { weight: "regular", size: 11.5, color: "fg",   align: "left",   wrapWidth: 360, leading: 1.55 },
  CLOSING_FOOTER:           { weight: "regular", size: 8,    color: "fg",   align: "center", upper: true, characterSpacing: 1.5 },
  SUN_SIGN:                 { weight: "italic",  size: 14,   color: "gold", align: "left" },
  MOON_SIGN:                { weight: "italic",  size: 14,   color: "gold", align: "left" },
  RISING_SIGN:              { weight: "italic",  size: 14,   color: "gold", align: "left" },
  LIFE_PATH:                { weight: "italic",  size: 14,   color: "gold", align: "left" },
  PERSONAL_YEAR:            { weight: "italic",  size: 14,   color: "gold", align: "left" },

  // Universal — auto-filled on every page that has these slots
  PAGE_NUMBER: { weight: "italic",  size: 9,  color: "gold", align: "center" },
  SIGN_GLYPH:  { weight: "display", size: 38, color: "gold", align: "left" },

  // Moon / Rising feature pages (Chapter 3 / Chapter 4). Single-template per
  // chapter — the sign is filled at render time from order.moonSign /
  // .risingSign. BOOK_TITLE is the small top-left brand label (matches the
  // chapter-opener style). ZODIAC_NAME_* is the big centred sign name in the
  // middle of the page. ZODIAC_GLYPH_* is the small decorative flourish glyph
  // between the two gold rules near the bottom; drawn via
  // drawBigCenteredInRect so it occupies the visual space between the rules
  // even though the widget rect itself is only ~9pt tall.
  BOOK_TITLE:          { weight: "bold",    size: 9,  color: "gold", align: "left",  upper: true, characterSpacing: 1.5 },
  ZODIAC_NAME_MOON:    { weight: "display", size: 38, color: "fg",   align: "center", upper: true, characterSpacing: 4, autoShrink: true, minSize: 22 },
  ZODIAC_NAME_RISING:  { weight: "display", size: 38, color: "fg",   align: "center", upper: true, characterSpacing: 4, autoShrink: true, minSize: 22 },
  ZODIAC_GLYPH_MOON:   { weight: "display", size: 22, color: "gold", align: "center" },
  ZODIAC_GLYPH_RISING: { weight: "display", size: 22, color: "gold", align: "center" },

  // Birthstone feature page (Chapter 13). BIRTHSTONE_BODY is a 38pt-tall
  // caption beneath the gem visual — `drawBirthstoneCaption` lays out the
  // uppercase stone name (bold, slightly larger) on its own line and the
  // tagline below it in gold italic, so a single widget hosts two visually
  // distinct rows of copy.
  BIRTHSTONE_BODY:     { weight: "italic",  size: 11, color: "fg",   align: "center", wrapWidth: 240, leading: 1.3 },

  // Natal-chart feature page (page 2, right after the TOC). READER_NAME is
  // the prominent serif headline above the wheel. BIRTH_DATE / BIRTH_TIME /
  // BIRTH_LOCATION sit beneath the wheel in the "BORN AT … IN …" band — small
  // and italic, matching the engraved label look. The widgets are narrow
  // (BIRTH_TIME = 53pt, BIRTH_LOCATION = 58pt) so we keep them tight with
  // autoShrink: a long "San Diego, California, USA" location text gets
  // scaled down rather than overflowing left into the baked "IN" label or
  // right into the page margin. Left-aligned so the engraved-label reading
  // order ("IN [location]") stays intact. NATAL_CHART is the image-stamp
  // slot for the per-reader wheel PNG; no style needed since we draw the
  // stylized vector wheel directly (no text fill).
  READER_NAME:         { weight: "display", size: 26, color: "fg",   align: "center", autoShrink: true, minSize: 16 },
  BIRTH_DATE:          { weight: "italic",  size: 11, color: "fg",   align: "center", autoShrink: true, minSize: 8 },
  BIRTH_TIME:          { weight: "italic",  size: 10, color: "fg",   align: "left",   autoShrink: true, minSize: 7 },
  BIRTH_LOCATION:      { weight: "italic",  size: 10, color: "fg",   align: "left",   autoShrink: true, minSize: 6 },
};

const DEFAULT_STYLE: PlaceholderStyle = { weight: "regular", size: 11.5, color: "fg", align: "left" };

// Per-template overrides. Same placeholder name can mean different things in
// different templates (e.g. CHAPTER_TITLE is the BIG centered title on the
// chapter-opener page but a narrow right-justified header on body pages).
const STYLE_OVERRIDES: Partial<Record<PageTypeKey, Record<string, Partial<PlaceholderStyle>>>> = {
  "chapter-opener": {
    CHAPTER_TITLE: { weight: "bold", size: 22, color: "fg", align: "center", upper: true, characterSpacing: 0, autoShrink: true, minSize: 14 },
  },
};

function resolveStyle(name: string, pageType: PageTypeKey): PlaceholderStyle {
  const base = STYLES[name] ?? DEFAULT_STYLE;
  const override = STYLE_OVERRIDES[pageType]?.[name];
  return override ? { ...base, ...override } : base;
}

// ── Slot renderer ────────────────────────────────────────────────────────────

interface RenderCtx {
  page: PDFPage;
  fonts: FontSet;
  pageType: PageTypeKey;
}

function rgbColor(c: [number, number, number]) {
  return rgb(c[0]!, c[1]!, c[2]!);
}

function resolveColor(style: PlaceholderStyle, pageType: PageTypeKey): [number, number, number] {
  if (style.color === "fg") return PAGE_FG[pageType];
  if (style.color === "gold") return GOLD;
  return style.color;
}

function pickFont(weight: WeightKey, fonts: FontSet): PDFFont {
  return fonts[weight];
}

/** Mask a slot with a same-color rectangle to hide the visible {{NAME}} text.
 *
 *  AcroForm-extracted slots ($source/fontName === "acro-field") don't need
 *  masking — the editable templates have no visible placeholder text
 *  underneath, and the form widgets are stripped at end of render. Drawing
 *  a mask there only leaves a visible rectangle in a slightly-off background
 *  color (we can't perfectly match the template's true page color). For
 *  legacy text-extracted slots we still mask because their {{NAME}} text is
 *  baked into the template artwork. */
function maskSlot(ctx: RenderCtx, slot: Slot): void {
  if (slot.fontName === "acro-field") return;
  drawMaskRect(ctx, slot.x - 2, slot.y - 1, slot.w + 4, slot.h + 2);
}

function drawMaskRect(ctx: RenderCtx, x: number, y: number, w: number, h: number): void {
  ctx.page.drawRectangle({ x, y, width: w, height: h, color: rgbColor(PAGE_BG[ctx.pageType]) });
}

/** Wrap a long string into multiple lines fitting `maxWidth` at the given font/size. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur.length ? `${cur} ${w}` : w;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth) {
      cur = candidate;
    } else {
      if (cur.length) lines.push(cur);
      // Word longer than maxWidth — drop it on its own line and let it overflow.
      cur = w;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Measure the rendered width of `text` at `size` including character spacing. */
function measureWidth(font: PDFFont, text: string, size: number, characterSpacing = 0): number {
  const w = font.widthOfTextAtSize(text, size);
  if (!characterSpacing || text.length < 2) return w;
  return w + characterSpacing * (text.length - 1);
}

/** Shrink `size` down toward `minSize` (in 0.5pt steps) until `text` fits in
 *  `maxWidth`. If even `minSize` overflows, return `minSize` — caller decides
 *  whether to truncate-with-ellipsis. */
function shrinkToFit(
  font: PDFFont,
  text: string,
  size: number,
  minSize: number,
  maxWidth: number,
  characterSpacing = 0,
): number {
  let s = size;
  while (s > minSize && measureWidth(font, text, s, characterSpacing) > maxWidth) {
    s -= 0.5;
  }
  return Math.max(s, minSize);
}

/** Truncate `text` with a trailing ellipsis until it fits in `maxWidth`. */
function truncateWithEllipsis(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
  characterSpacing = 0,
): string {
  const ellipsis = "…";
  if (measureWidth(font, text, size, characterSpacing) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const candidate = text.slice(0, mid) + ellipsis;
    if (measureWidth(font, candidate, size, characterSpacing) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ellipsis;
}

/** Draw a single piece of text into a slot with the placeholder's style preset. */
function fillSlot(
  ctx: RenderCtx,
  placeholderName: string,
  slot: Slot,
  text: string,
): void {
  if (!text || text.length === 0) return;
  const style = resolveStyle(placeholderName, ctx.pageType);
  const font = pickFont(style.weight, ctx.fonts);
  const color = rgbColor(resolveColor(style, ctx.pageType));
  const display = style.upper ? text.toUpperCase() : text;
  const cspace = style.characterSpacing ?? 0;
  const xIndent = style.xIndent ?? 0;

  maskSlot(ctx, slot);

  if (!style.wrapWidth) {
    // Single-line draw. Apply autoShrink + ellipsis truncate when the text
    // is wider than the slot.
    const available = Math.max(slot.w - xIndent, 1);
    let size = style.size;
    let drawText = display;
    if (style.autoShrink) {
      size = shrinkToFit(font, display, style.size, style.minSize ?? 6, available, cspace);
      if (measureWidth(font, display, size, cspace) > available) {
        drawText = truncateWithEllipsis(font, display, size, available, cspace);
      }
    }
    let x = slot.x + xIndent;
    if (style.align === "center") {
      const width = measureWidth(font, drawText, size, cspace);
      x = slot.x + xIndent + (slot.w - xIndent) / 2 - width / 2;
    }
    ctx.page.drawText(drawText, {
      x,
      y: slot.y,
      size,
      font,
      color,
      ...(cspace ? { characterSpacing: cspace } : {}),
    });
    return;
  }

  // Multi-line: wrap then stack downward from the slot's baseline.
  const size = style.size;
  const lines = wrapText(display, font, size, style.wrapWidth);
  const lineGap = size * (style.leading ?? 1.45);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let x = slot.x + xIndent;
    if (style.align === "center") {
      const width = measureWidth(font, line, size, cspace);
      x = slot.x + xIndent + (style.wrapWidth ?? slot.w) / 2 - width / 2 - (style.wrapWidth ? (style.wrapWidth - slot.w) / 2 : 0);
    }
    ctx.page.drawText(line, {
      x,
      y: slot.y - i * lineGap,
      size,
      font,
      color,
      ...(cspace ? { characterSpacing: cspace } : {}),
    });
  }
}

/**
 * Multi-page text flow: render `text` starting at the slot's baseline,
 * wrapping at the slot's width. Stops when the next line would go below
 * `maxBottomY` (typically the top of the next slot, or the page safe margin
 * if there's nothing below). Returns whatever didn't fit so the caller can
 * spill onto another page, plus the baseline Y of the last line drawn so
 * the caller can stack a subsequent paragraph tightly below.
 *
 * `opts.startY` overrides the slot's baseline starting position (used by
 * `buildBodyContinuedPage` to flow paragraphs directly after the previous
 * paragraph ends instead of pinning each one to its slot's fixed top).
 */
function fillFlowingBody(
  ctx: RenderCtx,
  placeholderName: string,
  slot: Slot,
  text: string,
  pageHeightPt: number,
  maxBottomY: number = 45,
  opts?: { startY?: number },
): { remaining: string; lastBaselineY: number } {
  const style = resolveStyle(placeholderName, ctx.pageType);
  const font = pickFont(style.weight, ctx.fonts);
  const size = style.size;
  const color = rgbColor(resolveColor(style, ctx.pageType));
  // Use the slot's rect width as the wrap width (designer's intent),
  // falling back to the style's wrapWidth if the slot is narrower than expected.
  const wrapWidth = Math.max(slot.w, style.wrapWidth ?? 360);
  const leading = size * (style.leading ?? 1.45);

  maskSlot(ctx, slot);

  const startY = opts?.startY ?? slot.y;
  const lines = wrapText(text, font, size, wrapWidth);
  let usedLines = 0;
  let cursorY = startY;
  let lastBaselineY = startY;
  for (const line of lines) {
    if (cursorY < maxBottomY) break;
    ctx.page.drawText(line, { x: slot.x, y: cursorY, size, font, color });
    lastBaselineY = cursorY;
    cursorY -= leading;
    usedLines++;
  }
  if (usedLines === lines.length) return { remaining: "", lastBaselineY };
  const remaining = lines.slice(usedLines).join(" ");
  return { remaining, lastBaselineY };
}

/**
 * Compute a slot's approximate "rect top" — the Y of the topmost point its
 * text occupies. slot.y is the BASELINE of the first line (set by
 * `rectToSlot` to be near the top of the original AcroForm rect). For both
 * AcroForm and text-extracted slots, rect_top ≈ slot.y + (slot.h - baselineOffset)
 * where baselineOffset = max(slot.h - 12, 4) — the same formula used at
 * extraction time.
 */
function slotRectTop(s: Slot): number {
  const baselineOffset = Math.max(s.h - 12, 4);
  return s.y - baselineOffset + s.h;
}

/**
 * Given a slot and all other slots on the page, return the Y coordinate
 * (in PDF units, origin bottom-left) below which this slot's text must NOT
 * flow — i.e. the rect_top of the next slot whose rect sits below this one.
 * Falls back to the page's safe-bottom margin if nothing's below.
 */
function nextSlotTopBelow(slot: Slot, pageType: PageType, _ctx: BuildCtx): number {
  const SAFE_BOTTOM = 45;
  const myTop = slot.y; // approximate top of this slot's first text line
  let best = SAFE_BOTTOM;
  for (const v of Object.values(pageType.slots)) {
    const candidates: Slot[] = Array.isArray(v) ? v : [v];
    for (const other of candidates) {
      if (other === slot) continue;
      const otherTop = slotRectTop(other);
      // Same x neighbourhood? Width overlap test — only stop on slots that
      // share horizontal space, otherwise side-by-side slots would shortcut
      // each other.
      const aL = slot.x, aR = slot.x + slot.w;
      const bL = other.x, bR = other.x + other.w;
      const overlapsX = !(bR < aL || bL > aR);
      if (!overlapsX) continue;
      // Below this slot's text-start AND above current best?
      if (otherTop < myTop && otherTop > best) {
        best = otherTop + 4; // small breathing room
      }
    }
  }
  return best;
}

// ── Per-recipe-step page builder ─────────────────────────────────────────────

function getSlot(pt: PageType, name: string): Slot | undefined {
  const v = pt.slots[name];
  if (!v) return undefined;
  if (Array.isArray(v)) return v[0];
  return v;
}

function getSlots(pt: PageType, name: string): Slot[] {
  const v = pt.slots[name];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function firstName(order: ZodiacOrder): string {
  return (order.fullName ?? "").trim().split(/\s+/)[0] ?? "Friend";
}

function ch2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Short header label for the top-right CHAPTER_TITLE band. The book is
 * organized into three pillars (HEALTH · WEALTH · RELATIONSHIPS), and chapter
 * titles follow the pattern "Pillar — Chapter Subtitle" (e.g. "Relationships —
 * Love, Partnership & Soul Contracts"). Slot is narrow (~190pt), so we strip
 * everything after the em dash and use just the pillar word.
 *
 * Falls back to the title's first significant word if there's no em dash, then
 * to a generic "GUIDE" so we never render an empty header.
 */
function headerLabel(ch: ParsedChapter): string {
  const t = (ch.title ?? "").trim();
  if (!t) return "GUIDE";
  // Match em dash (—), en dash (–), or hyphen surrounded by spaces.
  const m = /^([^—–\-]+?)(?:\s*[—–\-]\s+|$)/.exec(t);
  const pillar = (m?.[1] ?? t).trim();
  return pillar || "GUIDE";
}

interface BuildCtx {
  out: PDFDocument;
  fonts: FontSet;
  manifest: Manifest;
  embedCache: Map<string, PDFEmbeddedPage>;
  order: ZodiacOrder;
  /** 1-indexed; incremented in `newPageFromTemplate`. */
  pageNumber: number;
  /** Chapter starts captured during render, used to fill the TOC. */
  chapterStarts: Map<string, number>;
  /** Reserved TOC page reference — filled in once chapter starts are known. */
  tocPage: PDFPage | null;
}

async function embedTemplate(
  ctx: BuildCtx,
  filename: string,
  pageIndex = 0,
): Promise<PDFEmbeddedPage> {
  const cacheKey = `${filename}#${pageIndex}`;
  const cached = ctx.embedCache.get(cacheKey);
  if (cached) return cached;
  const buf = await fs.readFile(templatePath(filename));
  const src = await PDFDocument.load(buf);
  const [embedded] = await ctx.out.embedPdf(src, [pageIndex]);
  ctx.embedCache.set(cacheKey, embedded!);
  return embedded!;
}

async function newPageFromTemplate(
  ctx: BuildCtx,
  pageTypeKey: PageTypeKey | "zodiac-sign",
  templateFile?: string,
): Promise<{ page: PDFPage; pageType: PageType | null; pageTypeKey: PageTypeKey | "zodiac-sign" }> {
  const file = templateFile ?? (pageTypeKey !== "zodiac-sign" ? ctx.manifest.pageTypes[pageTypeKey].file : undefined);
  if (!file) throw new Error(`No template file for ${pageTypeKey}`);
  const tmpl = await embedTemplate(ctx, file);
  const page = ctx.out.addPage([tmpl.width, tmpl.height]);
  page.drawPage(tmpl, { x: 0, y: 0, width: tmpl.width, height: tmpl.height });
  ctx.pageNumber++;

  // Auto-fill the page-number slot if this template has one — works for any
  // page type that the designer added a {{PAGE_NUMBER}} token to.
  if (pageTypeKey !== "zodiac-sign") {
    const pageType = ctx.manifest.pageTypes[pageTypeKey];
    const pnSlot = pageType.slots["PAGE_NUMBER"];
    if (pnSlot) {
      const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: pageTypeKey };
      const slot = Array.isArray(pnSlot) ? pnSlot[0]! : pnSlot;
      fillSlot(rc, "PAGE_NUMBER", slot, String(ctx.pageNumber));
    }
  }

  return {
    page,
    pageType: pageTypeKey === "zodiac-sign" ? null : ctx.manifest.pageTypes[pageTypeKey],
    pageTypeKey,
  };
}

// ── TOC ──────────────────────────────────────────────────────────────────────

/** Reserves a blank cream page at the front of the book for the TOC. The
 *  content is drawn later (in `drawTOCContent`) once all chapter start
 *  pages are known. */
function reserveTOCPage(ctx: BuildCtx): void {
  if (ctx.tocPage) return; // idempotent
  const { widthPt, heightPt } = ctx.manifest.spec.page;
  const page = ctx.out.addPage([widthPt, heightPt]);
  page.drawRectangle({
    x: 0, y: 0, width: widthPt, height: heightPt,
    color: rgbColor(PAGE_BG["standard-body"]), // cream
  });
  ctx.pageNumber++;
  ctx.tocPage = page;
}

/** Draws the chapter listing onto the reserved TOC page. Pulls chapter
 *  titles from the manifest's chapter recipes and start pages from
 *  `ctx.chapterStarts`. */
function drawTOCContent(ctx: BuildCtx): void {
  const page = ctx.tocPage;
  if (!page) return;
  const fg = rgbColor(PAGE_FG["standard-body"]);
  const gold = rgbColor(GOLD);
  const fonts = ctx.fonts;
  const { widthPt, heightPt } = ctx.manifest.spec.page;
  const SAFE = 45;

  // Title
  const titleFont = fonts.bold;
  const title = "Contents";
  const titleSize = 28;
  const titleWidth = titleFont.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: widthPt / 2 - titleWidth / 2,
    y: heightPt - SAFE - 50,
    size: titleSize,
    font: titleFont,
    color: fg,
  });

  // Gold rule under the title
  page.drawLine({
    start: { x: widthPt / 2 - 30, y: heightPt - SAFE - 64 },
    end:   { x: widthPt / 2 + 30, y: heightPt - SAFE - 64 },
    thickness: 0.75,
    color: gold,
  });

  // Build the row list directly from manifest recipes so the TOC mirrors the
  // actual book structure regardless of recipe edits.
  type Row = { kind: "section" | "part" | "chapter" | "closing"; label: string; page: number };
  const rows: Row[] = [];
  for (const r of ctx.manifest.chapterRecipes) {
    if (r.section === "natal-chart") {
      const p = ctx.chapterStarts.get("natal-chart");
      if (p) rows.push({ kind: "section", label: r.title || "Your Cosmic Blueprint", page: p });
    } else if (r.section === "welcome") {
      const p = ctx.chapterStarts.get("welcome");
      if (p) rows.push({ kind: "section", label: r.title || "Welcome", page: p });
    } else if (r.section === "part") {
      const p = ctx.chapterStarts.get(`part:${r.partNum}`);
      if (p) rows.push({ kind: "part", label: `Part ${r.partNum} — ${r.partTitle}`, page: p });
    } else if (r.section === "chapter") {
      const p = ctx.chapterStarts.get(`chapter:${r.chapter}`);
      if (p) {
        const title = `${r.chapter}.  ${r.title}`;
        rows.push({ kind: "chapter", label: title, page: p });
      }
    } else if (r.section === "closing") {
      const p = ctx.chapterStarts.get("closing");
      if (p) rows.push({ kind: "closing", label: r.title || "Closing", page: p });
    }
  }

  // Layout rows
  let y = heightPt - SAFE - 110;
  const leftX = SAFE + 10;
  const rightX = widthPt - SAFE - 10;
  const rowGap = 22;
  for (const row of rows) {
    const labelFont = row.kind === "part" ? fonts.italic : fonts.regular;
    const labelSize = row.kind === "part" ? 11 : 10.5;
    const labelColor = row.kind === "part" ? gold : fg;
    page.drawText(row.label, { x: leftX, y, size: labelSize, font: labelFont, color: labelColor });
    const pageNumStr = String(row.page);
    const pageNumWidth = fonts.regular.widthOfTextAtSize(pageNumStr, labelSize);
    page.drawText(pageNumStr, { x: rightX - pageNumWidth, y, size: labelSize, font: fonts.regular, color: fg });
    y -= rowGap;
    if (y < SAFE + 40) break;
  }

  // Page number on the TOC itself (page 1)
  const pnSize = 9;
  const pnStr = "1";
  const pnWidth = fonts.italic.widthOfTextAtSize(pnStr, pnSize);
  page.drawText(pnStr, {
    x: widthPt / 2 - pnWidth / 2,
    y: SAFE - 20,
    size: pnSize,
    font: fonts.italic,
    color: gold,
  });
}

async function buildChapterOpener(ctx: BuildCtx, ch: ParsedChapter): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "chapter-opener");
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "chapter-opener" };
  if (pageType) {
    const chNum = getSlot(pageType, "CH_NUM");
    const title = getSlot(pageType, "CHAPTER_TITLE");
    const subtitle = getSlot(pageType, "CHAPTER_SUBTITLE");
    if (chNum) fillSlot(rc, "CH_NUM", chNum, ch2(ch.number));
    if (title) fillSlot(rc, "CHAPTER_TITLE", title, ch.title);
    if (subtitle) fillSlot(rc, "CHAPTER_SUBTITLE", subtitle, ch.subtitle ?? "");
  }
}

async function buildZodiacSignPage(ctx: BuildCtx): Promise<void> {
  const sun = ctx.order.sunSign;
  if (!sun) return;
  const file = ctx.manifest.zodiacSigns[sun];
  if (!file) return;
  // Bring in just page 1 of the zodiac template (the visual; page 2 is decorative).
  await newPageFromTemplate(ctx, "zodiac-sign", file);
}

/** Chapter 3 (moon) and Chapter 4 (rising) feature page. Single template per
 *  chapter — the sign is filled at render time from order.moonSign /
 *  order.risingSign. The template has 4 widgets: BOOK_TITLE (top-left brand
 *  label), ZODIAC_NAME_{MOON|RISING} (big centred sign name), and
 *  ZODIAC_GLYPH_{MOON|RISING} (small decorative unicode glyph between the
 *  bottom gold rules — drawn via drawBigCenteredInRect so a 20pt glyph fits
 *  the visual band even though the widget rect is only ~9pt tall). */
async function buildZodiacGlyphPage(ctx: BuildCtx, kind: "moon" | "rising"): Promise<void> {
  const pageTypeKey: PageTypeKey = kind === "moon" ? "zodiac-moon" : "zodiac-rising";
  const { page, pageType } = await newPageFromTemplate(ctx, pageTypeKey);
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: pageTypeKey };

  const sign = (kind === "moon" ? ctx.order.moonSign : ctx.order.risingSign) ?? "";
  const nameField = kind === "moon" ? "ZODIAC_NAME_MOON" : "ZODIAC_NAME_RISING";
  const glyphField = kind === "moon" ? "ZODIAC_GLYPH_MOON" : "ZODIAC_GLYPH_RISING";

  const bookTitleSlot = getSlot(pageType, "BOOK_TITLE");
  if (bookTitleSlot) fillSlot(rc, "BOOK_TITLE", bookTitleSlot, "HOLISTIC GROWTH");

  const nameSlot = getSlot(pageType, nameField);
  if (nameSlot && sign) fillSlot(rc, nameField, nameSlot, sign);

  const glyphSlot = getSlot(pageType, glyphField);
  if (glyphSlot && sign) {
    const glyph = ZODIAC_GLYPHS[sign] ?? "";
    // Fallback to first letter of the sign name when the font can't encode
    // the unicode zodiac codepoint (Times-Roman fallback is WinAnsi-only;
    // Cormorant TTFs in fonts/ have full glyph coverage).
    drawBigCenteredInRect(rc, glyphField, glyphSlot, glyph, sign.charAt(0).toUpperCase());
  }
}

/** Chapter 13 (BONUS) birthstone feature page. Resolves the customer's stone
 *  from their birth month, fills the gem visual into the BIRTHSTONE_IMAGE
 *  widget (PNG if present, vector gem otherwise), and lays the stone name +
 *  tagline beneath via `drawBirthstoneCaption`. */
async function buildBirthstonePage(ctx: BuildCtx, ch: ParsedChapter): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "birthstone");
  if (!pageType) return;
  void ch; // chapter shape unused — page identity is the baked "YOUR BIRTHSTONE" header label
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "birthstone" };

  const stone = birthstoneForBirthday(ctx.order.birthday);

  // CHAPTER_TITLE intentionally left unfilled: the template artwork already
  // bakes "YOUR BIRTHSTONE" into the top-left of the header band. Filling
  // the right-hand CHAPTER_TITLE widget with the same label produces a
  // visible double-header in the rule. (The widget rect is masked anyway
  // because the renderer's per-slot mask runs only when fillSlot is called.)

  const imgSlot = getSlot(pageType, "BIRTHSTONE_IMAGE");
  if (imgSlot) await drawBirthstoneImage(ctx, rc, imgSlot, stone);

  const bodySlot = getSlot(pageType, "BIRTHSTONE_BODY");
  if (bodySlot) drawBirthstoneCaption(rc, bodySlot, stone);
}

/** "Your Cosmic Blueprint" page — page 2, right after the TOC. Fills the
 *  reader's name + birth date / time / location into the engraved-style band
 *  and draws a stylized natal-chart wheel using the customer's Sun, Moon, and
 *  Rising signs. The wheel is intentionally NOT astronomically accurate —
 *  it's a placeholder until the real chart-wheel image-generation pipeline
 *  ships (see `artifacts/book-templates/natal-chart-claude-code-prompt.md`).
 *  When that pipeline produces a per-reader PNG buffer, replace
 *  `drawStylizedNatalWheel` with a `page.drawImage(embedPng(buf), …)` call. */
async function buildNatalChartPage(ctx: BuildCtx): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "natal-chart");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "natal-chart" };

  const fullName = (ctx.order.fullName ?? "").trim();
  const birthDate = formatLongDate(ctx.order.birthday);
  const birthTime = (ctx.order.birthTime ?? "").trim();
  const birthLocation = (ctx.order.birthLocation ?? "").trim();

  const fill = (name: string, value: string) => {
    const slot = getSlot(pageType, name);
    if (slot && value) fillSlot(rc, name, slot, value);
    else if (slot) maskSlot(rc, slot);
  };

  fill("READER_NAME", fullName.toUpperCase());
  fill("BIRTH_DATE", birthDate);
  fill("BIRTH_TIME", birthTime);
  fill("BIRTH_LOCATION", birthLocation);

  // Try the real per-reader chart wheel first: geocode the birth location,
  // compute a real chart with circular-natal-horoscope-js, draw it with
  // @astrodraw/astrochart, rasterise with sharp, stamp via pdf-lib. Falls
  // back to the stylised vector wheel below if any step fails — Nominatim
  // returns no result, the birth time is missing, sharp's binary doesn't
  // match the host, etc. See `lib/natalWheel.ts` for the pipeline + the
  // full design notes in `artifacts/book-templates/natal-chart-claude-code-prompt.md`.
  const stamped = await drawRealNatalWheel(ctx, page, ctx.order);
  if (!stamped) {
    drawStylizedNatalWheel(rc, ctx.order);
  }
}

/** Stamp a real per-reader chart-wheel PNG onto the page. Returns true on
 *  success so the caller knows to skip the stylised fallback. Catches
 *  everything internally — book generation must never fail because of a
 *  geocoder or chart-library hiccup. */
async function drawRealNatalWheel(
  ctx: BuildCtx,
  page: PDFPage,
  order: ZodiacOrder,
): Promise<boolean> {
  const birthday = (order.birthday ?? "").trim();
  const birthLocation = (order.birthLocation ?? "").trim();
  if (!birthday || !birthLocation) return false;
  try {
    const { generateNatalWheelPng } = await import("../../../lib/natalWheel");
    const png = await generateNatalWheelPng(
      birthday,
      (order.birthTime ?? "12:00").trim() || "12:00",
      birthLocation,
    );
    if (!png) return false;

    // Mask the baked-in "planets · houses · aspect lines" stand-in text
    // first — same band the stylised wheel masks. Uses the disc parchment
    // cream so the patch blends invisibly into the disc.
    page.drawRectangle({
      x: 90,
      y: 255,
      width: 270,
      height: 45,
      color: rgb(243 / 255, 233 / 255, 210 / 255),
    });

    const img = await ctx.out.embedPng(png);
    // Stamp the PNG to fill the page's visible disc area. The page artwork
    // has a decorative gold rim at ~radius 145pt from (NATAL_WHEEL_CENTER_X,
    // NATAL_WHEEL_CENTER_Y); the AstroChart wheel (with its own outer ring
    // stripped via Option B in lib/natalWheel.ts) sits inside that. Total
    // discSize ≈ 290pt covers the page's existing rim and leaves
    // AstroChart's inner planet ring + house spokes + aspect lines at a
    // legible size for print.
    const discSize = 290;
    const cx = NATAL_WHEEL_CENTER_X;
    const cy = NATAL_WHEEL_CENTER_Y;
    page.drawImage(img, {
      x: cx - discSize / 2,
      y: cy - discSize / 2,
      width: discSize,
      height: discSize,
    });
    return true;
  } catch {
    return false;
  }
}

/** Math angle (in degrees, math convention with 0° pointing right and CCW
 *  positive) for each zodiac sign on the template's wheel. The artwork places
 *  Aries at 9 o'clock and the signs flow CW around the wheel — which
 *  corresponds to decreasing math angle. Calibrated empirically against
 *  10-natal-chart-editable.pdf; if the designer rotates the wheel, re-tune
 *  here rather than in every caller. */
const NATAL_WHEEL_SIGN_ANGLE_DEG: Record<string, number> = {
  Aries: 180, Taurus: 210, Gemini: 240, Cancer: 270, Leo: 300, Virgo: 330,
  Libra: 0,   Scorpio: 30, Sagittarius: 60, Capricorn: 90, Aquarius: 120, Pisces: 150,
};

/** Visual centre of the wheel artwork (the cream inner circle) in PDF user
 *  space. The NATAL_CHART AcroForm widget is positioned ~33pt ABOVE the
 *  actual visual centre — it's an anchor for where the future stamped wheel
 *  PNG should land, not where the existing "planets · houses · aspect
 *  lines" stand-in text sits. The real text + visual disc midpoint is at
 *  y ≈ 277, determined by drawing test rectangles at successive y-values
 *  and confirming when they fully covered the stand-in. */
const NATAL_WHEEL_CENTER_X = 225;
const NATAL_WHEEL_CENTER_Y = 277;
/** Radius (pt) where the Sun/Moon/Rising markers are placed. The visible
 *  cream disc has a radius of ≈ 130 pt; markers at 80 pt sit well inside
 *  the gold zodiac ring and leave room for the marker labels (which are
 *  pushed 9pt further outward by `drawStylizedNatalWheel`). */
const NATAL_WHEEL_MARKER_RADIUS = 80;

/** Draw the placeholder natal-chart wheel using only Sun, Moon, and Rising
 *  signs from the order. Three markers are placed at the angular positions
 *  of the customer's signs (e.g. Sun in Leo → 5 o'clock on the wheel), each
 *  with a short label, plus a thin aspect line connecting Sun and Moon to
 *  visually reinforce that every chart is unique. */
function drawStylizedNatalWheel(rc: RenderCtx, order: ZodiacOrder): void {
  // 1. Mask the baked-in "planets · houses · aspect lines" stand-in text so
  //    our markers don't overlap it. The artwork prints that label centred
  //    on the wheel (y ≈ 380), in a horizontal band ~12pt tall. We can't use
  //    drawMaskRect here because that paints PAGE_BG (the page's cream),
  //    which is slightly LIGHTER than the wheel's inner parchment disc and
  //    shows up as a visible cream stripe. Paint the disc's actual parchment
  //    colour (#f3e9d2 per the template's hand-off prompt) so the mask
  //    blends in.
  // Mask the baked-in "planets · houses · aspect lines" stand-in text. The
  // text was determined to sit between y=255 and y=300 by drawing
  // increasingly narrow test rectangles; centre is around y=278 with the
  // text band ~12pt tall. We paint a generous 45pt-tall band so antialias
  // halos don't leave a visible edge. Cream colour (#f3e9d2) matches the
  // disc's parchment fill so the mask blends invisibly into the disc.
  rc.page.drawRectangle({
    x: 90,
    y: 255,
    width: 270,
    height: 45,
    color: rgb(243/255, 233/255, 210/255),
  });

  const cx = NATAL_WHEEL_CENTER_X;
  const cy = NATAL_WHEEL_CENTER_Y;
  const r = NATAL_WHEEL_MARKER_RADIUS;
  const gold = rgb(GOLD[0], GOLD[1], GOLD[2]);
  const ink = rgb(...PAGE_FG["natal-chart"]);
  const labelFont = rc.fonts.bold;
  const labelSize = 7;

  // Resolve each marker's position from its sign. Default to the centre if
  // the sign is unknown — the chart still renders, just without that marker.
  type Marker = { label: string; sign: string | null };
  const markers: Marker[] = [
    { label: "SUN",  sign: order.sunSign ?? null },
    { label: "MOON", sign: order.moonSign ?? null },
    { label: "ASC",  sign: order.risingSign ?? null },
  ];

  const positions = markers.map((m) => {
    const angle = m.sign ? NATAL_WHEEL_SIGN_ANGLE_DEG[m.sign] : undefined;
    if (angle === undefined) return null;
    const rad = (angle * Math.PI) / 180;
    return { label: m.label, x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }).filter((p): p is { label: string; x: number; y: number } => p !== null);

  // 2. Thin aspect line connecting Sun and Moon (the two most meaningful
  //    luminaries in a natal chart). Drawn first so markers sit on top.
  const sun = positions.find((p) => p.label === "SUN");
  const moon = positions.find((p) => p.label === "MOON");
  if (sun && moon) {
    rc.page.drawLine({
      start: { x: sun.x, y: sun.y },
      end: { x: moon.x, y: moon.y },
      thickness: 0.4,
      color: gold,
      opacity: 0.45,
    });
  }

  // 3. Each marker: a small filled gold disc with a darker outline + a label
  //    placed just outside the disc, oriented toward the wheel centre so it
  //    never collides with the gold zodiac ring.
  for (const { label, x, y } of positions) {
    rc.page.drawCircle({ x, y, size: 3.5, color: gold });
    rc.page.drawCircle({ x, y, size: 3.5, borderColor: ink, borderWidth: 0.5 });

    // Place the label radially outward from the centre by ~9pt so it sits
    // adjacent to the marker without touching it.
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const lx = x + (dx / dist) * 9;
    const ly = y + (dy / dist) * 9;
    const labelW = labelFont.widthOfTextAtSize(label, labelSize);
    rc.page.drawText(label, {
      x: lx - labelW / 2,
      y: ly - labelSize / 2,
      size: labelSize,
      font: labelFont,
      color: ink,
    });
  }

  // 4. A small centre dot to anchor the eye and suggest the chart's origin.
  rc.page.drawCircle({ x: cx, y: cy, size: 1.5, color: ink });
}

/** "December 13, 1981" from "1981-12-13". Falls back to the raw value if it
 *  doesn't parse. Used by `buildNatalChartPage` to render BIRTH_DATE in the
 *  long-form engraved style the template's typography expects. */
function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = months[parseInt(mo!, 10) - 1] ?? mo;
  return `${monthName} ${parseInt(d!, 10)}, ${y}`;
}

/** Embed a birthstone PNG from disk if available, else draw a vector gem.
 *  Lookup path: `artifacts/book-templates/birthstones/<slug>.png`. Drop your
 *  hand-curated gem photos there to upgrade the visual; the page is never
 *  blank in the absence of a file. */
async function drawBirthstoneImage(
  ctx: BuildCtx,
  rc: RenderCtx,
  slot: Slot,
  stone: Birthstone,
): Promise<void> {
  // Recover the widget rect from slot.y (which is the AcroForm baseline).
  const baselineOffset = Math.max(slot.h - 12, 4);
  const rectY = slot.y - baselineOffset;
  const cx = slot.x + slot.w / 2;
  const cy = rectY + slot.h / 2;
  const radius = Math.min(slot.w, slot.h) / 2 - 4; // leave a tiny gutter for the cream mask

  // Mask the widget background first so a stray default-fill rectangle from
  // the AcroForm export doesn't show through the gem.
  maskSlot(rc, slot);

  // Try the PNG path. We resolve relative to TEMPLATES_DIR (templatesDir()
  // exported from parse.ts) so the file layout matches every other template
  // asset in the repo.
  const pngPath = path.join(templatesDir(), "birthstones", `${stone.slug}.png`);
  const bytes = await fs.readFile(pngPath).catch(() => null);
  if (bytes) {
    try {
      const img = await ctx.out.embedPng(bytes);
      const size = radius * 2;
      // Centre the image inside the widget rect.
      rc.page.drawImage(img, {
        x: cx - radius,
        y: cy - radius,
        width: size,
        height: size,
      });
      return;
    } catch {
      // Fall through to the vector gem on any decode failure (corrupt file,
      // non-PNG bytes, etc.) — never crash a whole book over one bad asset.
    }
  }

  // Vector fallback: a filled circle in the stone colour, with a darker
  // inner ring + a small pearly highlight glint. Reads as a tasteful
  // talisman gem at marketing-image resolutions.
  rc.page.drawCircle({
    x: cx, y: cy, size: radius,
    color: rgb(stone.color[0], stone.color[1], stone.color[2]),
  });
  rc.page.drawCircle({
    x: cx, y: cy, size: radius * 0.78,
    borderColor: rgb(stone.colorLo[0], stone.colorLo[1], stone.colorLo[2]),
    borderWidth: 1.2,
  });
  // Highlight glint — small, offset upper-left.
  rc.page.drawCircle({
    x: cx - radius * 0.32, y: cy + radius * 0.30, size: radius * 0.18,
    color: rgb(stone.colorHi[0], stone.colorHi[1], stone.colorHi[2]),
    opacity: 0.85,
  });
}

/** Two-row caption beneath the gem: uppercase stone name (display weight,
 *  large) on top, italic gold tagline below. Both centred inside the
 *  BIRTHSTONE_BODY widget rect. */
function drawBirthstoneCaption(rc: RenderCtx, slot: Slot, stone: Birthstone): void {
  maskSlot(rc, slot);
  const baselineOffset = Math.max(slot.h - 12, 4);
  const rectY = slot.y - baselineOffset;
  const rectTop = rectY + slot.h;
  const cx = slot.x + slot.w / 2;

  // Name — bold display, ~17pt, baseline near the top of the rect.
  const nameSize = 17;
  const nameFont = pickFont("display", rc.fonts);
  const nameText = stone.name.toUpperCase();
  const nameCspace = 3;
  const nameW = nameFont.widthOfTextAtSize(nameText, nameSize) + nameCspace * (nameText.length - 1);
  const fg = rgbColor(resolveColor({ color: "fg" } as PlaceholderStyle, rc.pageType));
  rc.page.drawText(nameText, {
    x: cx - nameW / 2,
    y: rectTop - nameSize + 1,
    size: nameSize,
    font: nameFont,
    color: fg,
    ...(nameCspace ? { characterSpacing: nameCspace } : {}),
  });

  // Tagline — gold italic, ~10pt, sits ~6pt below the name.
  const tagSize = 10;
  const tagFont = pickFont("italic", rc.fonts);
  const tagText = stone.tagline;
  const goldColor = rgbColor(GOLD);
  // Wrap if it gets long (the table values are all short — but be defensive).
  const lines = wrapText(tagText, tagFont, tagSize, slot.w - 10);
  let y = rectTop - nameSize - tagSize - 6;
  for (const line of lines) {
    const w = tagFont.widthOfTextAtSize(line, tagSize);
    rc.page.drawText(line, {
      x: cx - w / 2,
      y,
      size: tagSize,
      font: tagFont,
      color: goldColor,
    });
    y -= tagSize * 1.2;
  }
}

async function buildSectionDivider(
  ctx: BuildCtx,
  partNum: string,
  partTitle: string,
  partTagline: string,
): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "section-divider");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "section-divider" };
  for (const slot of getSlots(pageType, "PART_NUM")) {
    fillSlot(rc, "PART_NUM", slot, partNum);
  }
  const titleSlot = getSlot(pageType, "PART_TITLE");
  if (titleSlot) fillSlot(rc, "PART_TITLE", titleSlot, partTitle);
  const taglineSlot = getSlot(pageType, "PART_TAGLINE");
  if (taglineSlot) fillSlot(rc, "PART_TAGLINE", taglineSlot, partTagline);
  const nameSlot = getSlot(pageType, "READER_FIRST_NAME");
  if (nameSlot) fillSlot(rc, "READER_FIRST_NAME", nameSlot, firstName(ctx.order));
}

/**
 * Builds one or more `02-standard-body` pages until the chapter's prose is
 * exhausted. The first page also fills LEAD_PARAGRAPH, SUBSECTION_HEADING(s),
 * and BULLET_1/2/3. Continuation pages only fill BODY_PARAGRAPH.
 */
/** Fill a single body-continued page with up to 4 paragraphs of prose plus
 *  an optional mid-page subsection heading. Returns the number of paragraphs
 *  consumed so the caller can decide whether to spawn another page. */
async function buildBodyContinuedPage(
  ctx: BuildCtx,
  ch: ParsedChapter,
  paragraphs: string[],
  startIdx: number,
  midSubsectionHeading?: string,
): Promise<number> {
  const { page } = await newPageFromTemplate(ctx, "body-continued");
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "body-continued" };
  const pageType = ctx.manifest.pageTypes["body-continued"];

  const nameSlot = getSlot(pageType, "READER_FIRST_NAME");
  const titleSlot = getSlot(pageType, "CHAPTER_TITLE");
  if (nameSlot) fillSlot(rc, "READER_FIRST_NAME", nameSlot, firstName(ctx.order));
  if (titleSlot) fillSlot(rc, "CHAPTER_TITLE", titleSlot, headerLabel(ch));

  const subSlot = getSlot(pageType, "SUBSECTION_HEADING");
  if (subSlot) {
    if (midSubsectionHeading) fillSlot(rc, "SUBSECTION_HEADING", subSlot, midSubsectionHeading);
    // Force-mask the SUBSECTION_HEADING band AND the ★ glyph to its left.
    // The template artwork draws a ★ at x≈42 (the left page margin), but the
    // AcroForm widget for SUBSECTION_HEADING starts at x=56 — so a regular
    // slot-shaped mask leaves the ★ uncovered. Extend the mask 18pt leftward
    // to catch the marker. Tall pad covers any descender/leading variations.
    else {
      drawMaskRect(
        rc,
        subSlot.x - 20, // reach back past the ★ at x≈42 (slot.x=56)
        subSlot.y - 6,
        subSlot.w + 24,
        subSlot.h + 10,
      );
    }
  }

  // Dynamic paragraph stacking: 07-body-continued has 4 fixed-height body
  // slots (~115pt each) but a single paragraph usually fills only 60–90pt.
  // If we pin each paragraph to its slot.y, short paragraphs leave gaping
  // empty space. Instead, treat the FIRST slot as the start anchor and flow
  // every subsequent paragraph directly below the previous one's last line,
  // separated by `PARAGRAPH_GAP` — matches the tighter feel of
  // 02-standard-body. Bottom cap is the SAFE_BOTTOM (45pt above page
  // bottom), not each individual slot's natural cap.
  const PARAGRAPH_GAP = 14;
  const SAFE_BOTTOM = 45;
  const bodyStyle = resolveStyle("BODY_PARAGRAPH", "body-continued");
  const leading = bodyStyle.size * (bodyStyle.leading ?? 1.45);
  const bodySlots = getSlots(pageType, "BODY_PARAGRAPH");
  if (bodySlots.length === 0) return 0;

  // Mask every body slot up front so leftover {{...}} text doesn't peek
  // through when we end up filling fewer than 4 paragraphs.
  for (const s of bodySlots) maskSlot(rc, s);

  let consumed = 0;
  let nextY: number | null = null; // baseline for the next paragraph
  for (let i = 0; i < bodySlots.length; i++) {
    const text = paragraphs[startIdx + i];
    if (!text) continue;
    const slot = bodySlots[i]!;
    // Use the first slot's natural y as the starting baseline; subsequent
    // paragraphs flow from where the previous one ended.
    const startY = nextY ?? slot.y;
    if (startY < SAFE_BOTTOM) break;
    const { lastBaselineY } = fillFlowingBody(
      rc,
      "BODY_PARAGRAPH",
      slot,
      text,
      ctx.manifest.spec.page.heightPt,
      SAFE_BOTTOM,
      { startY },
    );
    consumed++;
    nextY = lastBaselineY - leading - PARAGRAPH_GAP;
  }
  return consumed;
}

/** Pick 3 distinct short sentences/phrases from chapter content for the
 *  BULLET_1/2/3 slots. Falls back gracefully (masks unfilled slots) rather
 *  than repeating the same line three times. */
/** Bullets are scannable topic markers — short, distinct, ALL-CAPS-renderable.
 *  We ONLY use subsection headings, because the previous "fall back to lead
 *  sentences" path produced uppercase blocks like
 *  "WELCOME, DSDSSDCSCS CDSS, TO A JOURNEY INTO THE HEART OF YOUR U…"
 *  which looked broken. If the chapter has fewer than 3 real headings, the
 *  unused bullet slots are masked entirely by the caller (no ◆ glyph leak).
 *
 *  Also: the affirmation section heading ("Your 10 Relationship Affirmations"
 *  and variants) is excluded — that subsection has its own dedicated
 *  affirmation page, so surfacing it as a body-page bullet duplicates
 *  navigation noise. */
const AFFIRMATION_HEADING_RE = /your\s+\d+\s+\w+\s+affirmations?|^affirmations?/i;
function pickThreeBullets(ch: ParsedChapter): (string | null)[] {
  const pool: string[] = [];
  for (const h of ch.subsections.map((s) => s.heading)) {
    if (pool.length >= 3) break;
    if (!h) continue;
    if (AFFIRMATION_HEADING_RE.test(h)) continue;
    if (pool.includes(h)) continue;
    // Skip headings that are clearly prose, not topic markers — anything over
    // ~60 chars probably won't render cleanly in tracked uppercase.
    if (h.length > 60) continue;
    pool.push(h);
  }
  return [pool[0] ?? null, pool[1] ?? null, pool[2] ?? null];
}

async function buildStandardBodyFlow(ctx: BuildCtx, ch: ParsedChapter, options?: { firstPageOnly?: boolean }): Promise<void> {
  // Exclude the affirmation subsection from the body-page flow. Pillar
  // chapters (5/6/7) deliver "Your 10 X Affirmations" as a normal subsection
  // in the markdown, but that content is destined for the dedicated
  // affirmation page later in the recipe — rendering it as standard-body
  // prose duplicates it AND looks broken when 10 inline numbered items get
  // chunked across body slots. Drop it here; the affirmation page reads
  // from `ch.affirmations`, not the subsection.
  const visibleSubsections = ch.subsections.filter((s) => !AFFIRMATION_HEADING_RE.test(s.heading));
  const paragraphPool = visibleSubsections.flatMap((s) => s.paragraphs);
  const headings = visibleSubsections.map((s) => s.heading);

  const stdBody = ctx.manifest.pageTypes["standard-body"];
  const firstBodySlots = getSlots(stdBody, "BODY_PARAGRAPH").length;
  const contSlots = getSlots(ctx.manifest.pageTypes["body-continued"], "BODY_PARAGRAPH").length;

  // ── First page: 02-standard-body (lead + subsections + bullets + body) ──
  {
    const { page } = await newPageFromTemplate(ctx, "standard-body");
    const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "standard-body" };

    const chTitleSlot = getSlot(stdBody, "CHAPTER_TITLE");
    const nameSlot = getSlot(stdBody, "READER_FIRST_NAME");
    if (chTitleSlot) fillSlot(rc, "CHAPTER_TITLE", chTitleSlot, headerLabel(ch));
    if (nameSlot) fillSlot(rc, "READER_FIRST_NAME", nameSlot, firstName(ctx.order));

    const subSlots = getSlots(stdBody, "SUBSECTION_HEADING");
    const leadSlot = getSlot(stdBody, "LEAD_PARAGRAPH");
    if (leadSlot) {
      const cap = nextSlotTopBelow(leadSlot, stdBody, ctx);
      fillFlowingBody(rc, "LEAD_PARAGRAPH", leadSlot, ch.lead, ctx.manifest.spec.page.heightPt, cap);
    }
    for (let i = 0; i < subSlots.length; i++) {
      if (headings[i]) {
        fillSlot(rc, "SUBSECTION_HEADING", subSlots[i]!, headings[i]!);
      } else {
        // Standard-body template bakes a ◆ glyph to the left of each
        // subsection widget. The default ±1pt maskSlot pad leaves that
        // diamond visible on an orphaned subsection, so we paint a wider
        // mask that reaches 20pt left of slot.x and a few pt above/below
        // the baseline. Same pattern used on body-continued for its ★.
        const s = subSlots[i]!;
        drawMaskRect(rc, s.x - 22, s.y - 8, s.w + 26, s.h + 14);
      }
    }

    // 3 distinct bullets — never repeat the same line three times. When a
    // bullet slot has no text, we paint a cream mask tightly centred on the
    // bullet's baseline (slot.y) to cover the gold ◆ glyph the template
    // artwork bakes at slot.x. The default ±1pt maskSlot pad only covers
    // the widget rect (which sits just above the baseline) and leaves the
    // lower half of the diamond visible. Bullet rows are stacked ~18pt
    // apart, so the mask height is kept to 16pt to avoid bleeding into the
    // adjacent bullet row above.
    const bullets = pickThreeBullets(ch);
    for (let i = 0; i < 3; i++) {
      const slot = getSlot(stdBody, `BULLET_${i + 1}`);
      if (!slot) continue;
      const text = bullets[i];
      if (text) {
        fillSlot(rc, `BULLET_${i + 1}`, slot, text);
      } else {
        drawMaskRect(rc, slot.x - 4, slot.y - 8, slot.w + 8, 16);
      }
    }

    const bodySlots = getSlots(stdBody, "BODY_PARAGRAPH");
    for (let i = 0; i < bodySlots.length; i++) {
      const paragraph = paragraphPool[i];
      if (paragraph) {
        const cap = nextSlotTopBelow(bodySlots[i]!, stdBody, ctx);
        fillFlowingBody(rc, "BODY_PARAGRAPH", bodySlots[i]!, paragraph, ctx.manifest.spec.page.heightPt, cap);
      } else {
        maskSlot(rc, bodySlots[i]!);
      }
    }
  }

  if (options?.firstPageOnly) return;

  // ── Continuation pages (07-body-continued) until prose is exhausted ──
  let paragraphIdx = firstBodySlots;
  let safetyHops = 0;
  while (paragraphIdx < paragraphPool.length && safetyHops < 10) {
    safetyHops++;
    const consumed = await buildBodyContinuedPage(ctx, ch, paragraphPool, paragraphIdx);
    if (consumed === 0) break;
    paragraphIdx += consumed;
    if (contSlots === 0) break; // safety
  }
}

/**
 * Render a pull-quote highlight page.
 *
 * The template (03-standard-body-with-quotes) is intentionally minimal:
 *   - Header band (READER_FIRST_NAME, CHAPTER_TITLE) with a thin gold rule
 *   - SUBSECTION_HEADING band just below the rule
 *   - A large centered PULL_QUOTE field occupying the upper-middle of the page
 *   - One small gold ornament centered above the quote (part of the template)
 *   - A two-segment gold rule near the bottom flanking PAGE_NUMBER
 *
 * There are NO body-paragraph fields on this page — the chapter's body
 * prose lives entirely on the preceding `02-standard-body` and following
 * `07-body-continued` pages. This builder ignores any paragraph content
 * passed in and returns it so the caller can route it elsewhere.
 *
 * Returns `{ consumed: 0, total: paragraphs.length }` — we never consume
 * body paragraphs here; everything passes through to the caller.
 */
async function buildPullQuotePage(
  ctx: BuildCtx,
  ch: ParsedChapter,
  paragraphs?: string[],
): Promise<{ consumed: number; total: number }> {
  const { page, pageType } = await newPageFromTemplate(ctx, "standard-body-with-quotes");
  if (!pageType) return { consumed: 0, total: paragraphs?.length ?? 0 };
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "standard-body-with-quotes" };

  const nameSlot = getSlot(pageType, "READER_FIRST_NAME");
  const titleSlot = getSlot(pageType, "CHAPTER_TITLE");
  if (nameSlot) fillSlot(rc, "READER_FIRST_NAME", nameSlot, firstName(ctx.order));
  if (titleSlot) fillSlot(rc, "CHAPTER_TITLE", titleSlot, headerLabel(ch));

  // NOTE: we intentionally do NOT render SUBSECTION_HEADING on this page —
  // having two italic-gold blocks (heading + quote) reads visually as
  // "two competing quotes" and confuses the layout. The page is a single
  // focal pull-quote feature. The SUBSECTION_HEADING widget remains in
  // the template for future flexibility but stays unfilled.

  const quoteSlot = getSlot(pageType, "PULL_QUOTE");
  const quoteText = ch.pullQuote ?? ch.lead.split(/(?<=[.!?])\s+/)[0] ?? "";
  if (quoteSlot) {
    // Center the quote vertically in its widget rect.
    const centerY = quoteSlot.y - quoteSlot.h / 2 + 6;
    drawPullQuoteCentered(rc, quoteText, centerY);
  }

  // Body paragraphs are not rendered on this page. Pass them through so
  // the caller can emit body-continued pages with the remaining prose.
  return { consumed: 0, total: paragraphs?.length ?? 0 };
}

/**
 * Render the pull quote vertically centered on `centerY`.
 *
 * Visual treatment:
 *   - Wraps the text in curly typographic double quotes (“ … ”)
 *   - Renders at the style's preferred size (typically 20pt for prominence)
 *     and auto-shrinks down toward `minSize` only if the quote runs over
 *     `MAX_LINES`
 *   - Draws a small celestial glyph row beneath the quote (✦ ☽ ✦ when the
 *     font supports the codepoints, falls back to · · · otherwise)
 *
 * Returns the top/bottom Y of the rendered block.
 */
function drawPullQuoteCentered(
  rc: RenderCtx,
  text: string,
  centerY: number,
): { topY: number; bottomY: number } {
  if (!text) return { topY: centerY + 8, bottomY: centerY - 8 };
  const style = resolveStyle("PULL_QUOTE", rc.pageType);
  const font = pickFont(style.weight, rc.fonts);
  const color = rgbColor(resolveColor(style, rc.pageType));
  const wrapWidth = style.wrapWidth ?? 360;
  const MAX_LINES = 8;
  const minSize = 13;

  // Wrap text in typographic curly double quotes for a "horoscope-magical"
  // pull-quote feel. Use U+201C and U+201D which Cormorant Garamond and
  // pdf-lib's standard Times fonts both support.
  const decorated = `“${text.trim()}”`;

  // Shrink until the wrapped text fits in MAX_LINES (or we hit minSize).
  let size = style.size;
  let leading = size * (style.leading ?? 1.4);
  let lines = wrapText(decorated, font, size, wrapWidth);
  while (lines.length > MAX_LINES && size > minSize) {
    size -= 0.5;
    leading = size * (style.leading ?? 1.4);
    lines = wrapText(decorated, font, size, wrapWidth);
  }

  // Block geometry: vertical-center on centerY (excluding the glyph row).
  const ascender = size * 0.78;
  const totalHeight = (lines.length - 1) * leading + size;
  const baseline0 = centerY + totalHeight / 2 - ascender;

  const pageWidth = rc.page.getSize().width;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const w = font.widthOfTextAtSize(line, size);
    const x = pageWidth / 2 - w / 2;
    const y = baseline0 - i * leading;
    rc.page.drawText(line, { x, y, size, font, color });
  }

  // ── Celestial decoration row beneath the quote ────────────────────────
  // Vector primitives (three small gold filled circles linked by thin
  // gold lines) so rendering is font-independent. Reads as a small
  // horoscope-style flourish under the quote.
  const bottomY = baseline0 - (lines.length - 1) * leading - size * 0.25;
  const decoY = bottomY - 22;
  const goldColor = rgbColor(GOLD);
  const dotR = 1.8;
  const lineLen = 26;
  const gap = 6;
  const totalW = 6 * dotR + 2 * lineLen + 4 * gap;
  let cursorX = pageWidth / 2 - totalW / 2;
  const drawDot = () => {
    rc.page.drawCircle({ x: cursorX + dotR, y: decoY, size: dotR, color: goldColor });
    cursorX += dotR * 2;
  };
  const drawLine = () => {
    rc.page.drawRectangle({ x: cursorX, y: decoY - 0.3, width: lineLen, height: 0.6, color: goldColor });
    cursorX += lineLen;
  };
  drawDot(); cursorX += gap;
  drawLine(); cursorX += gap;
  drawDot(); cursorX += gap;
  drawLine(); cursorX += gap;
  drawDot();

  return {
    topY: baseline0 + ascender + 4,
    bottomY: decoY - 8,
  };
}

/**
 * Render the affirmation feature page. Accepts an array so pillar chapters
 * (5/6/7) can show up to 5 affirmations stacked vertically, while Chapter 10
 * mantra pages pass a single-item array for the time-of-day mantra.
 *
 * For multi-item lists we shrink the font size and centre the block
 * vertically between the template's quote ornament (above) and the
 * reader-name / placement row (below).
 */
async function buildAffirmationPage(
  ctx: BuildCtx,
  ch: ParsedChapter,
  affirmations: string[],
  placement: string,
): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "affirmations");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "affirmations" };
  const aSlot = getSlot(pageType, "AFFIRMATION_TEXT");
  const nSlot = getSlot(pageType, "READER_FIRST_NAME");
  const pSlot = getSlot(pageType, "PLACEMENT_REFERENCE");
  const tSlot = getSlot(pageType, "CHAPTER_TITLE");

  const items = affirmations
    .filter((s) => s && s.trim().length > 0)
    .slice(0, 5);
  if (aSlot && items.length > 0) {
    drawAffirmationList(rc, aSlot, items);
  } else if (aSlot) {
    fillSlot(rc, "AFFIRMATION_TEXT", aSlot, "I am exactly where I need to be.");
  }
  if (nSlot) fillSlot(rc, "READER_FIRST_NAME", nSlot, firstName(ctx.order));
  if (pSlot) fillSlot(rc, "PLACEMENT_REFERENCE", pSlot, placement);
  if (tSlot) fillSlot(rc, "CHAPTER_TITLE", tSlot, headerLabel(ch));
}

/**
 * Stack up to 5 affirmations centred vertically around the AFFIRMATION_TEXT
 * slot's anchor. For a single item we use the slot's preferred size (~18pt);
 * for multiple items we shrink so the stack fits between the quote ornament
 * above and the reader-name row below (roughly y=515 down to y=455 = 60pt).
 */
function drawAffirmationList(rc: RenderCtx, slot: Slot, items: string[]): void {
  const style = resolveStyle("AFFIRMATION_TEXT", rc.pageType);
  const font = pickFont(style.weight, rc.fonts);
  const color = rgbColor(resolveColor(style, rc.pageType));
  const pageWidth = rc.page.getSize().width;
  // Vertical band: between the decorative 〝〝 ornament (~y=525) and ~20pt
  // above the READER_FIRST_NAME glyph tops (which start at ~y=445 — the
  // widget rect goes y=431-445). The previous floor of 450 left only a 5pt
  // gap between the last affirmation's descender and the SAMPLE row's
  // tallest glyphs, which read as overlap in the rendered PDF. Floor of
  // 458 keeps a comfortable 13pt visual clearance even when a 5-item stack
  // shrinks to ~10pt. Centre the list around y=493 (slightly above the
  // AFFIRMATION_TEXT anchor) so the visual centre lines up with the
  // ornament band.
  const BAND_TOP = 528;
  const BAND_BOTTOM = 458;
  const centerY = (BAND_TOP + BAND_BOTTOM) / 2;
  const bandHeight = BAND_TOP - BAND_BOTTOM;

  // Items are sanitised before this function (parse.ts → cleanListItem),
  // but defend in depth: a verbose mantra that slipped through truncation
  // would push the stack past the band. Hard-cap each item to 110 chars so
  // the stack always fits.
  const safeItems = items.map((t) => {
    const trimmed = t.trim();
    if (trimmed.length <= 110) return trimmed;
    const truncated = trimmed.slice(0, 107);
    // Don't break mid-word — back up to the last space.
    const lastSpace = truncated.lastIndexOf(" ");
    return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + "…";
  });

  // Leading is tight (1.25×) and the inter-item gap is small (0.2× leading)
  // so a 5-item stack lands at a readable ~11pt rather than the 8-9pt range
  // the older 0.5× gap forced. Single-item pages keep the style's full
  // preferred size for the focal-quote layout. Wrap is widened past the
  // AFFIRMATION_TEXT widget width so a long single-sentence affirmation
  // stays on one line instead of wrapping to two (which would push the
  // stack into the SAMPLE row below).
  const ITEM_LEADING_MULT = 1.25;
  const INTER_ITEM_GAP_MULT = 0.2;
  const minSize = safeItems.length === 1 ? style.size : 9.5;
  const maxSize = style.size;
  const wrapWidth = safeItems.length > 1 ? 380 : (style.wrapWidth ?? 320);
  let size = maxSize;
  let lineGap = 0;
  let wrapped: string[][] = [];
  while (size >= minSize) {
    const leading = size * ITEM_LEADING_MULT;
    lineGap = leading;
    wrapped = safeItems.map((t) => wrapText(t, font, size, wrapWidth));
    const totalLines = wrapped.reduce((sum, ls) => sum + ls.length, 0);
    const interGap = safeItems.length > 1 ? (safeItems.length - 1) * leading * INTER_ITEM_GAP_MULT : 0;
    const totalHeight = totalLines * leading + interGap;
    if (totalHeight <= bandHeight) break;
    size -= 0.5;
  }

  // Render stacked, vertically centred.
  const ascender = size * 0.78;
  const leading = lineGap;
  const interGap = safeItems.length > 1 ? leading * INTER_ITEM_GAP_MULT : 0;
  const totalLines = wrapped.reduce((sum, ls) => sum + ls.length, 0);
  const totalHeight = totalLines * leading + (safeItems.length > 1 ? (safeItems.length - 1) * interGap : 0);
  let cursorY = centerY + totalHeight / 2 - ascender;
  for (let i = 0; i < wrapped.length; i++) {
    const lines = wrapped[i]!;
    for (const line of lines) {
      const w = font.widthOfTextAtSize(line, size);
      rc.page.drawText(line, {
        x: pageWidth / 2 - w / 2,
        y: cursorY,
        size,
        font,
        color,
      });
      cursorY -= leading;
    }
    if (i < wrapped.length - 1) cursorY -= interGap;
  }
  void slot; // slot is referenced by anchor design, not by drawing math
}

async function buildDataNumerologyPage(ctx: BuildCtx, ch: ParsedChapter): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "data-numerology");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "data-numerology" };

  const order = ctx.order;
  const isLifePathChapter = ch.number === 8;
  const isYearAheadChapter = ch.number === 12;

  const number = isLifePathChapter
    ? order.lifePath ?? "?"
    : isYearAheadChapter
      ? String(personalYear(order.birthday))
      : "—";
  const archetype = isLifePathChapter
    ? lifePathArchetype(order.lifePath ?? "")
    : isYearAheadChapter
      ? yearArchetype(personalYear(order.birthday))
      : "Your Cosmic Card";
  const calc = isLifePathChapter
    ? `From birth date ${order.birthday}`
    : isYearAheadChapter
      ? `Personal year ${personalYear(order.birthday)} for ${new Date().getFullYear()}`
      : "";

  // Numerology values (first occurrence of duplicated slots)
  const numerologyElement = lifePathElement(String(number));
  const numerologyKeywords = lifePathKeywords(String(number));

  // Astrology values (second occurrence of duplicated slots)
  const sun = order.sunSign ?? "";
  const astrologyElement = signElement(sun);
  const astrologyKeywords = signKeywords(sun);
  const houseLine = "5th House"; // placeholder — TODO: derive from chart calculations
  const signGlyph = ZODIAC_GLYPHS[sun] ?? "";

  // Single-occurrence fills
  const fillOne = (name: string, val: string) => {
    const slot = getSlot(pageType, name);
    if (slot && val) fillSlot(rc, name, slot, val);
    else if (slot) maskSlot(rc, slot);
  };
  fillOne("CHAPTER_TITLE", headerLabel(ch));
  fillOne("READER_FIRST_NAME", firstName(order));
  fillOne("CALCULATION", calc);
  fillOne("SHADOW", lifePathShadow(String(number)));
  fillOne("SIGN", sun);
  fillOne("HOUSE", houseLine);

  // Big glyph slots (NUMBER, SIGN_GLYPH): the widget rects on this template
  // are sized for the small placeholder text — at our display sizes (40-64pt)
  // a text drawn at the rect's baseline would overflow upward into the
  // adjacent card heading. drawBigCenteredInRect centres the glyph
  // vertically inside its widget rect instead.
  const numberSlot = getSlot(pageType, "NUMBER");
  if (numberSlot) drawBigCenteredInRect(rc, "NUMBER", numberSlot, String(number));
  const glyphSlot = getSlot(pageType, "SIGN_GLYPH");
  if (glyphSlot && signGlyph) {
    // Fallback: sign name's first letter (e.g. "L" for Leo) if the embedded
    // font doesn't have the unicode zodiac codepoint.
    drawBigCenteredInRect(rc, "SIGN_GLYPH", glyphSlot, signGlyph, sun.charAt(0).toUpperCase());
  }

  // ARCHETYPE_NAME and INTERPRETATION_BODY_1 widgets in the new template
  // sit at the same y (~y=350) — drawing both would visibly overlap. The
  // archetype info is already conveyed by the big NUMBER + CALCULATION
  // pair in the numerology card, so we skip the standalone archetype.
  void archetype;

  // Multi-occurrence: numerology block (index 0) vs astrology block (index 1)
  const fillByIndex = (name: string, values: string[]) => {
    const slots = getSlots(pageType, name);
    for (let i = 0; i < slots.length; i++) {
      const v = values[i] ?? values[values.length - 1] ?? "";
      if (v) fillSlot(rc, name, slots[i]!, v);
      else maskSlot(rc, slots[i]!);
    }
  };
  fillByIndex("ELEMENT", [numerologyElement, astrologyElement]);
  fillByIndex("KEYWORDS", [numerologyKeywords, astrologyKeywords]);

  const interpBlock = getSlots(pageType, "INTERPRETATION_BODY");
  const interpTexts = [
    ch.lead || "Your numbers tell a story unique to your path.",
    `Your Sun in ${sun || "your sign"} colours how this energy moves through your daily life — the qualities you express most naturally and the places you grow.`,
  ];
  for (let i = 0; i < interpBlock.length; i++) {
    const cap = nextSlotTopBelow(interpBlock[i]!, pageType, ctx);
    fillFlowingBody(rc, "INTERPRETATION_BODY", interpBlock[i]!, interpTexts[i] ?? "", ctx.manifest.spec.page.heightPt, cap);
  }
}

/**
 * Draw a large glyph (NUMBER, SIGN_GLYPH) **centered vertically inside its
 * widget rect** — not anchored at slot.y like normal text. The widget rects
 * on the data-numerology template are sized for the small placeholder text
 * (8-10pt), so anchoring a 40-64pt glyph at slot.y would push its top edge
 * well above the rect, overlapping the adjacent card heading. Centering
 * inside the rect keeps the big glyph within the designer's intended visual
 * space.
 *
 * Falls back to the glyph's first character (e.g. "L" for "Leo") if the
 * embedded font lacks the codepoint (typical when the optional Cormorant
 * Garamond TTFs aren't installed and we use Times-Roman fallback).
 */
function drawBigCenteredInRect(
  rc: RenderCtx,
  styleName: string,
  slot: Slot,
  text: string,
  fallback?: string,
): void {
  const style = resolveStyle(styleName, rc.pageType);
  const font = pickFont(style.weight, rc.fonts);
  const size = style.size;
  const color = rgbColor(resolveColor(style, rc.pageType));

  // Recover the rect's bottom-left (y) and top from the slot's baseline-y
  // (slot.y = rect.y + max(rect.h - 12, 4) per rectToSlot).
  const baselineOffset = Math.max(slot.h - 12, 4);
  const rectY = slot.y - baselineOffset;          // rect bottom
  const rectCenterY = rectY + slot.h / 2;         // rect vertical centre

  // Place baseline so the glyph's optical centre lines up with rectCenterY.
  // For a typical font ascent/descent of 0.78/0.18 of size, the vertical
  // optical centre sits at baseline + (ascent - descent) / 2.
  const opticalShift = (size * 0.78 - size * 0.18) / 2;
  const baseline = rectCenterY - opticalShift;

  // Choose what to draw: the supplied glyph, the optional fallback (e.g.
  // the sign's first letter for zodiac glyphs), or the glyph's own first
  // char — whichever the font can encode. Unicode zodiac symbols
  // (U+264C ♌ etc.) typically aren't in WinAnsi, so without the optional
  // Cormorant TTFs installed we need the fallback to kick in.
  const candidates = [text, fallback, text.slice(0, 1)].filter(Boolean) as string[];
  let display: string | null = null;
  for (const c of candidates) {
    try {
      font.widthOfTextAtSize(c, size);
      display = c;
      break;
    } catch { /* try next */ }
  }
  if (!display) return;

  // Horizontal position: respect the style's align.
  let x = slot.x;
  if (style.align === "center") {
    const w = font.widthOfTextAtSize(display, size);
    x = slot.x + slot.w / 2 - w / 2;
  }

  rc.page.drawText(display, { x, y: baseline, size, font, color });
}

// ── Helpers for numerology data card ────────────────────────────────────────

function lifePathElement(n: string): string {
  return ({
    "1": "Fire", "2": "Water", "3": "Fire", "4": "Earth",
    "5": "Air",  "6": "Earth", "7": "Water", "8": "Earth", "9": "Fire",
    "11": "Air", "22": "Earth", "33": "Water",
  } as Record<string, string>)[n] ?? "—";
}

function signKeywords(sign: string): string {
  return ({
    Aries:       "drive · courage · spark",
    Taurus:      "steady · sensual · rooted",
    Gemini:      "curious · agile · witty",
    Cancer:      "tender · intuitive · loyal",
    Leo:         "radiant · generous · bold",
    Virgo:       "precise · service · discerning",
    Libra:       "balanced · relational · refined",
    Scorpio:     "deep · transformative · magnetic",
    Sagittarius: "expansive · seeking · honest",
    Capricorn:   "structured · enduring · masterful",
    Aquarius:    "visionary · independent · electric",
    Pisces:      "compassionate · dreaming · fluid",
  } as Record<string, string>)[sign] ?? "—";
}

// ── Tiny numerology / astrology helpers (used only by the data card) ────────

function personalYear(birthday: string | null): number {
  if (!birthday) return 1;
  const d = new Date(birthday);
  const md = d.getUTCMonth() + 1 + d.getUTCDate();
  const y = new Date().getUTCFullYear();
  const sum = String(md + y).split("").reduce((a, c) => a + parseInt(c, 10), 0);
  let r = sum;
  while (r > 9 && r !== 11 && r !== 22 && r !== 33) {
    r = String(r).split("").reduce((a, c) => a + parseInt(c, 10), 0);
  }
  return r;
}
function lifePathArchetype(n: string): string {
  return ({
    "1": "The Pioneer",
    "2": "The Diplomat",
    "3": "The Storyteller",
    "4": "The Builder",
    "5": "The Voyager",
    "6": "The Caretaker",
    "7": "The Mystic",
    "8": "The Sovereign",
    "9": "The Humanitarian",
    "11": "The Illuminator",
    "22": "The Master Builder",
    "33": "The Master Teacher",
  } as Record<string, string>)[n] ?? "The Seeker";
}
function yearArchetype(n: number): string {
  return ({
    1: "Year of Beginnings",
    2: "Year of Partnership",
    3: "Year of Expression",
    4: "Year of Foundations",
    5: "Year of Change",
    6: "Year of Devotion",
    7: "Year of Reflection",
    8: "Year of Mastery",
    9: "Year of Completion",
  } as Record<number, string>)[n] ?? "Year of Becoming";
}
function lifePathKeywords(n: string): string {
  return ({
    "1": "leadership · courage · drive",
    "2": "harmony · intuition · sensitivity",
    "3": "creativity · joy · expression",
    "4": "stability · craft · loyalty",
    "5": "freedom · curiosity · motion",
    "6": "love · service · beauty",
    "7": "depth · wisdom · solitude",
    "8": "power · abundance · structure",
    "9": "compassion · vision · release",
  } as Record<string, string>)[n] ?? "presence · purpose · power";
}
function lifePathShadow(n: string): string {
  return ({
    "1": "self-isolation",
    "2": "people-pleasing",
    "3": "scattered focus",
    "4": "rigidity",
    "5": "restlessness",
    "6": "over-giving",
    "7": "withdrawal",
    "8": "control",
    "9": "self-erasure",
  } as Record<string, string>)[n] ?? "self-doubt";
}
function signElement(sign: string | null | undefined): string {
  if (!sign) return "";
  const e: Record<string, string> = {
    Aries: "Fire", Leo: "Fire", Sagittarius: "Fire",
    Taurus: "Earth", Virgo: "Earth", Capricorn: "Earth",
    Gemini: "Air", Libra: "Air", Aquarius: "Air",
    Cancer: "Water", Scorpio: "Water", Pisces: "Water",
  };
  return e[sign] ?? "";
}

// ── Welcome / Closing letter builders ────────────────────────────────────────

/** Split a body string into N paragraphs, distributing roughly evenly. Used to
 *  fill the welcome letter's two-paragraph slots and the closing letter's
 *  three-paragraph slots. If the source has fewer paragraphs than `count`,
 *  later slots get empty strings (the renderer will mask them either way). */
function splitParagraphs(body: string, count: number): string[] {
  const paras = body
    .split(/\n\n+/)
    // Drop blockquote-only paragraphs (`> …`) — those are pull quotes that
    // belong on their own page or in a dedicated band, not in the letter
    // body. Without this, the closing letter showed "> The cosmos was
    // writing toward you…" literally inside paragraph 3.
    .filter((p) => !/^\s*>\s/.test(p))
    .map((p) => p.replace(/\s+/g, " ").trim())
    // Strip lightweight markdown emphasis (`*foo*`, `**foo**`, `_foo_`) so
    // we don't render the asterisks literally. The body slots are already
    // styled per-template; preserving emphasis markers in print would just
    // confuse the reader.
    .map((p) =>
      p
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?;:])/g, "$1$2"),
    )
    .filter(Boolean);
  if (paras.length === 0) return Array(count).fill("");
  if (paras.length >= count) {
    // Bucket extras into the last slot so nothing's lost.
    const out = paras.slice(0, count);
    if (paras.length > count) {
      out[count - 1] = [out[count - 1]!, ...paras.slice(count)].join(" ");
    }
    return out;
  }
  // Fewer paragraphs than slots — pad with empties.
  return [...paras, ...Array(count - paras.length).fill("")];
}

const WELCOME_DEFAULT_SIGNOFF = "With celestial love,";
const WELCOME_DEFAULT_SIGNATURE = "The Holistic Growth Team";
const WELCOME_DEFAULT_FOOTER = "Holistic Growth · Personalized for you";
const DEFAULT_DISCLAIMER =
  "This book is offered for entertainment, reflection, and personal exploration only. It is not a substitute for professional psychological, medical, financial, or legal advice. Trust your own discernment as you read.";
const CLOSING_DEFAULT_FOOTER = "With cosmic love · Holistic Growth";

async function buildWelcomeLetter(ctx: BuildCtx, body: string): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "welcome-letter");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "welcome-letter" };

  const [p1, p2] = splitParagraphs(body, 2);

  const fill = (name: string, val: string) => {
    const slot = getSlot(pageType, name);
    if (slot && val) fillSlot(rc, name, slot, val);
    else if (slot) maskSlot(rc, slot);
  };

  fill("READER_FIRST_NAME", firstName(ctx.order));

  // Body paragraphs use fillFlowingBody with a hard bottom cap so a long
  // welcome message doesn't flow past its slot's vertical boundary into
  // the next paragraph's region — and ultimately into the disclaimer /
  // signature slots below. Without the cap, paragraph 1 (slot at y=344,
  // h=80) routinely overflows into paragraph 2 (y=259) and the signature
  // line (y=110), which manifested as the visible "double text layer"
  // overlap on page 2. fillFlowingBody truncates with an ellipsis when it
  // would otherwise breach the cap.
  const pageH = ctx.manifest.spec.page.heightPt;
  const bodyP1Slot = getSlot(pageType, "WELCOME_BODY_PARAGRAPH_1");
  const bodyP2Slot = getSlot(pageType, "WELCOME_BODY_PARAGRAPH_2");
  if (bodyP1Slot && p1) {
    const cap = nextSlotTopBelow(bodyP1Slot, pageType, ctx);
    fillFlowingBody(rc, "WELCOME_BODY_PARAGRAPH_1", bodyP1Slot, p1, pageH, cap);
  } else if (bodyP1Slot) maskSlot(rc, bodyP1Slot);
  if (bodyP2Slot && p2) {
    const cap = nextSlotTopBelow(bodyP2Slot, pageType, ctx);
    fillFlowingBody(rc, "WELCOME_BODY_PARAGRAPH_2", bodyP2Slot, p2, pageH, cap);
  } else if (bodyP2Slot) maskSlot(rc, bodyP2Slot);

  fill("WELCOME_SIGNOFF_LINE", WELCOME_DEFAULT_SIGNOFF);
  fill("WELCOME_SIGNATURE", WELCOME_DEFAULT_SIGNATURE);
  fill("WELCOME_FOOTER", WELCOME_DEFAULT_FOOTER);
  fill("DISCLAIMER_TEXT", DEFAULT_DISCLAIMER);
}

async function buildClosingLetter(ctx: BuildCtx, body: string): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "closing-letter");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "closing-letter" };

  const [p1, p2, p3] = splitParagraphs(body, 3);
  const order = ctx.order;
  const personalYr = personalYear(order.birthday);

  const fill = (name: string, val: string) => {
    const slot = getSlot(pageType, name);
    if (slot && val) fillSlot(rc, name, slot, val);
    else if (slot) maskSlot(rc, slot);
  };

  fill("READER_FIRST_NAME", firstName(order));
  fill("SUN_SIGN", order.sunSign ?? "");
  fill("MOON_SIGN", order.moonSign ?? "");
  fill("RISING_SIGN", order.risingSign ?? "");
  fill("LIFE_PATH", order.lifePath ?? "");
  fill("PERSONAL_YEAR", String(personalYr)); // no-op until designer adds the {{PERSONAL_YEAR}} token's closing braces

  // Body paragraphs use fillFlowingBody with a hard bottom cap so a long
  // closing paragraph doesn't overflow into the next paragraph slot — the
  // visible "Your Life Path Number 7" double-layer overlap on page 52 was
  // paragraph 1 spilling past its bottom into paragraph 2's territory.
  const pageH = ctx.manifest.spec.page.heightPt;
  const slotP1 = getSlot(pageType, "CLOSING_BODY_PARAGRAPH_1");
  const slotP2 = getSlot(pageType, "CLOSING_BODY_PARAGRAPH_2");
  const slotP3 = getSlot(pageType, "CLOSING_BODY_PARAGRAPH_3");
  if (slotP1 && p1) {
    const cap = nextSlotTopBelow(slotP1, pageType, ctx);
    fillFlowingBody(rc, "CLOSING_BODY_PARAGRAPH_1", slotP1, p1, pageH, cap);
  } else if (slotP1) maskSlot(rc, slotP1);
  if (slotP2 && p2) {
    const cap = nextSlotTopBelow(slotP2, pageType, ctx);
    fillFlowingBody(rc, "CLOSING_BODY_PARAGRAPH_2", slotP2, p2, pageH, cap);
  } else if (slotP2) maskSlot(rc, slotP2);
  if (slotP3 && p3) {
    const cap = nextSlotTopBelow(slotP3, pageType, ctx);
    fillFlowingBody(rc, "CLOSING_BODY_PARAGRAPH_3", slotP3, p3, pageH, cap);
  } else if (slotP3) maskSlot(rc, slotP3);

  fill("CLOSING_FOOTER", CLOSING_DEFAULT_FOOTER);
}

// ── Recipe walker ────────────────────────────────────────────────────────────

async function processRecipe(ctx: BuildCtx, recipe: Recipe, book: ParsedBook): Promise<void> {
  // Special section kind that doesn't exist in the strict Recipe union but we
  // tolerate so the manifest can include a `{ "section": "toc" }` step.
  if ((recipe as { section: string }).section === "toc") {
    reserveTOCPage(ctx);
    return;
  }
  if (recipe.section === "natal-chart") {
    // Standalone "Your Cosmic Blueprint" page — page 2, right after the TOC.
    // Doesn't fan out across templates; the recipe's `templates: ["natal-chart"]`
    // is just for symmetry with other sections, the page is always single.
    ctx.chapterStarts.set("natal-chart", ctx.pageNumber + 1);
    await buildNatalChartPage(ctx);
    return;
  }
  if (recipe.section === "welcome") {
    ctx.chapterStarts.set("welcome", ctx.pageNumber + 1);
    // Recipe specifies which template to use — supports both the new
    // `welcome-letter` (default) and the legacy `standard-body` fallback.
    for (const step of recipe.templates) {
      if (step === "welcome-letter")   await buildWelcomeLetter(ctx, book.welcome.body);
      else if (step === "standard-body" || step === "standard-body+") {
        const ch: ParsedChapter = {
          number: 0, title: book.welcome.title || "Welcome", subtitle: null,
          lead: book.welcome.body.split(/\n\n+/)[0]?.trim() ?? "", subsections: [],
          pullQuote: null,
        };
        await buildStandardBodyFlow(ctx, ch);
      }
    }
    return;
  }
  if (recipe.section === "closing") {
    ctx.chapterStarts.set("closing", ctx.pageNumber + 1);
    for (const step of recipe.templates) {
      if (step === "closing-letter")   await buildClosingLetter(ctx, book.closing.body);
      else if (step === "standard-body-with-quotes") {
        const ch: ParsedChapter = {
          number: 99, title: book.closing.title || "A Love Letter from the Universe", subtitle: null,
          lead: book.closing.body.split(/\n\n+/)[0]?.trim() ?? "", subsections: [],
          pullQuote: extractClosingPullQuote(book.closing.body),
        };
        await buildPullQuotePage(ctx, ch);
      }
    }
    return;
  }
  if (recipe.section === "part") {
    ctx.chapterStarts.set(`part:${recipe.partNum}`, ctx.pageNumber + 1);
    await buildSectionDivider(ctx, recipe.partNum, recipe.partTitle, recipe.partTagline);
    return;
  }
  // Chapter recipe
  const ch = book.chapters.find((c) => c.number === recipe.chapter);
  if (!ch) return;
  ctx.chapterStarts.set(`chapter:${recipe.chapter}`, ctx.pageNumber + 1);
  // Track which affirmations call we're on within this chapter so Chapter 10's
  // three consecutive `affirmations` steps map to morning → midday → evening.
  // `filter().indexOf(step)` was returning 0 every time (since `step` is the
  // bare string "affirmations" it finds the first match), so all three pages
  // rendered the morning mantra.
  let affirmationIndex = 0;
  for (const step of recipe.templates) {
    if (step === "chapter-opener")            await buildChapterOpener(ctx, ch);
    else if (step === "zodiac-sign")          await buildZodiacSignPage(ctx);
    else if (step === "zodiac-moon")          await buildZodiacGlyphPage(ctx, "moon");
    else if (step === "zodiac-rising")        await buildZodiacGlyphPage(ctx, "rising");
    else if (step === "birthstone")           await buildBirthstonePage(ctx, ch);
    else if (step === "standard-body+")       await buildStandardBodyFlow(ctx, ch);
    else if (step === "standard-body")        await buildStandardBodyFlow(ctx, ch);
    else if (step === "standard-body-with-quotes") await buildPullQuotePage(ctx, ch);
    else if (step === "data-numerology")      await buildDataNumerologyPage(ctx, ch);
    else if (step === "welcome-letter")       await buildWelcomeLetter(ctx, ch.lead);
    else if (step === "closing-letter")       await buildClosingLetter(ctx, ch.lead);
    else if (step === "affirmations") {
      // Pillar chapters (5/6/7): show the first 5 affirmations as a stacked
      // list. Chapter 10: each page shows the time-of-day mantra triplet.
      if (ch.number === 10 && ch.mantras) {
        const which = (["morning","midday","evening"] as const)[affirmationIndex] ?? "morning";
        const list = ch.mantras[which];
        await buildAffirmationPage(ctx, ch, list.slice(0, 5), which.toUpperCase());
      } else {
        const affs = ch.affirmations && ch.affirmations.length > 0
          ? ch.affirmations.slice(0, 5)
          : [ch.lead.split(/(?<=[.!?])\s+/)[0] ?? ""];
        await buildAffirmationPage(ctx, ch, affs, placementForChapter(ch));
      }
      affirmationIndex++;
    }
    else if (step === "section-divider") {
      // Chapter recipes shouldn't normally include section dividers, but tolerate it.
      await buildSectionDivider(ctx, "·", ch.title, ch.subtitle ?? "");
    }
  }
}

function extractClosingPullQuote(body: string): string | null {
  const m = /^>\s+(.+?)$/m.exec(body);
  if (m && m[1]) return m[1].trim();
  const last = body.trim().split(/\n\n+/).pop() ?? "";
  return last.split(/(?<=[.!?])\s+/).pop()?.trim() ?? null;
}

function placementForChapter(ch: ParsedChapter): string {
  if (ch.number === 5) return "Venus & 7th House";
  if (ch.number === 6) return "Life Path & 10th House";
  if (ch.number === 7) return "Moon & 6th House";
  return "Your Chart";
}

// ── Top-level entry ──────────────────────────────────────────────────────────

export async function generateTemplatedInteriorPDF(
  order: ZodiacOrder,
  content: string,
  options?: { maxPages?: number },
): Promise<Buffer> {
  const manifest = await loadManifest();
  const book = parseBook(content);

  const out = await PDFDocument.create();
  out.setTitle(`Holistic Growth Life Path — ${order.fullName}`);
  out.setAuthor("Holigrowth");
  out.setSubject("Personalized Astrology & Numerology Book");

  const fonts = await loadFonts(out);
  const ctx: BuildCtx = {
    out,
    fonts,
    manifest,
    embedCache: new Map(),
    order,
    pageNumber: 0,
    chapterStarts: new Map(),
    tocPage: null,
  };

  for (const recipe of manifest.chapterRecipes) {
    if (options?.maxPages && out.getPageCount() >= options.maxPages) break;
    await processRecipe(ctx, recipe, book);
  }

  // Second pass: now that we know which page each chapter starts on, fill the
  // TOC page that was reserved during the first pass.
  if (ctx.tocPage) {
    drawTOCContent(ctx);
  }

  // Strip every AcroForm field. The embedded template pages carry interactive
  // form widgets (light-blue boxes in viewers). We've drawn personalized text
  // on top of each field's position, so the widgets are no longer needed —
  // removing them leaves a clean, flat print PDF with no interactivity.
  const form = out.getForm();
  for (const field of form.getFields()) {
    try {
      form.removeField(field);
    } catch {
      // Some PDFs have malformed field trees — skip and continue.
    }
  }

  const bytes = await out.save();
  return Buffer.from(bytes);
}

// ── Hardcover wrap renderer ─────────────────────────────────────────────────

/**
 * Build the hardcover case-wrap PDF for the printed book. This is a
 * standalone document — not part of the interior pipeline — sized to the
 * Lulu US Trade hardcover spec:
 *
 *   Total wrap (with bleed): 14.00" × 10.75" → 1008 × 774 pt
 *   Book hardcover size:      6.25" × 9.50"  (per side of the spread)
 *   Spine width:              0.25" minimum (varies by page count)
 *   Wrap area / bleed:        0.625" all around
 *
 * The cover template (`00-hardcover-editable.pdf`) has AcroForm widgets at:
 *   BACK COVER (left half)
 *     - BOOK_TITLE         "A book written..." subtitle, top of back cover
 *     - READER_FIRST_NAME  "For [Name]" in the body copy
 *     - DATE_OF_BIRTH      "born on [date]" in the body copy
 *     - BIRTH_PLACE        "in [place]" in the body copy
 *   SPINE (vertical strip in the centre)
 *     - READER_FIRST_NAME  (rotated 90° — narrow tall rect)
 *   FRONT COVER (right half)
 *     - FULL_NAME          big centred name beneath the title
 *     - DATE_OF_BIRTH      "BORN" line, lower right
 *     - BIRTH_PLACE        "IN"   line, lower right
 */
export async function buildHardcoverWrap(order: ZodiacOrder): Promise<Buffer> {
  const out = await PDFDocument.create();
  out.setTitle(`Holistic Growth — ${order.fullName} — Cover Wrap`);
  out.setAuthor("Holigrowth");
  const fonts = await loadFonts(out);

  // Embed the template wrap page (1008 × 774 pt).
  const tplPath = path.join(templatesDir(), "00-hardcover-editable.pdf");
  const tplBytes = await fs.readFile(tplPath);
  const tplDoc = await PDFDocument.load(tplBytes);
  const [embedded] = await out.embedPdf(tplDoc, [0]);
  if (!embedded) throw new Error("Failed to embed hardcover template");
  const page = out.addPage([embedded.width, embedded.height]);
  page.drawPage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });

  // Page bg is midnight purple — text should be cream to read against it.
  const COVER_CREAM = rgb(0.95, 0.92, 0.78);

  // Helper: draw centred or left-aligned text at a slot rect.
  const drawAt = (
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    opts: {
      size: number;
      font: PDFFont;
      align?: "left" | "center";
      rotate?: number; // degrees, applied around the slot's centre point
    },
  ) => {
    const { size, font, align = "left", rotate } = opts;
    if (!text) return;
    const baselineOffset = Math.max(h - 12, 4);
    const baselineY = y + baselineOffset;
    const textW = font.widthOfTextAtSize(text, size);
    let drawX = x;
    if (align === "center") drawX = x + w / 2 - textW / 2;
    if (rotate !== undefined) {
      // Rotated text — draw at slot's bottom-left, rotating around that pivot.
      // For a 90° rotation (vertical text reading bottom-to-top), shift the
      // baseline along the rotation axis so the text starts near the bottom
      // of the tall narrow slot and reads upward.
      const cx = x + w / 2;
      const cy = y + h / 2;
      // Draw text centered on the slot; rotation pivot is the bottom-left of
      // the drawn text. Compute pre-rotation position so post-rotation the
      // text is centered on the slot.
      page.drawText(text, {
        x: cx + size / 3,    // baseline offset along the new axis
        y: cy - textW / 2,   // centre vertically (post-rotation horizontal)
        size,
        font,
        color: COVER_CREAM,
        rotate: degrees(rotate),
      });
    } else {
      page.drawText(text, { x: drawX, y: baselineY, size, font, color: COVER_CREAM });
    }
  };

  // ── Compute mock-friendly display values ──────────────────────────────
  const firstName = (order.fullName ?? "").trim().split(/\s+/)[0] ?? "Reader";
  const fullName = (order.fullName ?? "").trim().toUpperCase() || "READER";
  const birthDate = formatBirthDate(order.birthday);
  const birthPlace = (order.birthLocation ?? "").trim();

  // ── Fill widget slots ─────────────────────────────────────────────────
  // Multiple widgets share the same field name (READER_FIRST_NAME has two
  // instances, etc.) — pdf-lib returns them in the order they appear in the
  // form tree, but rather than rely on that ordering we read every widget
  // rectangle and dispatch by its (x, y) position to the correct treatment.
  const tplFormDoc = await PDFDocument.load(tplBytes);
  const tplForm = tplFormDoc.getForm();
  for (const field of tplForm.getFields()) {
    const name = field.getName();
    for (const w of field.acroField.getWidgets()) {
      const r = w.getRectangle();
      const isSpine = r.width < 30 && r.height > 60; // narrow tall = spine
      if (name === "READER_FIRST_NAME" && isSpine) {
        // Vertical (rotated 90°) reader name on the spine, in cream caps.
        drawAt(firstName.toUpperCase(), r.x, r.y, r.width, r.height, {
          size: 9,
          font: fonts.bold,
          rotate: 90,
        });
      } else if (name === "READER_FIRST_NAME") {
        drawAt(firstName, r.x, r.y, r.width, r.height, { size: 10, font: fonts.italic });
      } else if (name === "FULL_NAME") {
        drawAt(fullName, r.x, r.y, r.width, r.height, { size: 14, font: fonts.bold, align: "center" });
      } else if (name === "BOOK_TITLE") {
        drawAt("HOLISTIC GROWTH", r.x, r.y, r.width, r.height, { size: 7, font: fonts.bold });
      } else if (name === "BIRTH_PLACE") {
        drawAt(birthPlace, r.x, r.y, r.width, r.height, { size: 9, font: fonts.italic });
      } else if (name === "DATE_OF_BIRTH") {
        drawAt(birthDate, r.x, r.y, r.width, r.height, { size: 9, font: fonts.italic });
      }
    }
  }

  // Strip form widgets so the output is flat.
  const form = out.getForm();
  for (const f of form.getFields()) {
    try { form.removeField(f); } catch { /* tolerate malformed entries */ }
  }

  const bytes = await out.save({ updateFieldAppearances: false });
  return Buffer.from(bytes);
}

/** Format a birthday string ("1990-05-15") into "May 15, 1990". */
function formatBirthDate(birthday: string | null): string {
  if (!birthday) return "";
  const d = new Date(birthday);
  if (Number.isNaN(d.getTime())) return birthday;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ── Single-template test renderer ───────────────────────────────────────────

/** Identifiers for `renderSingleTemplate`. Includes both pageType keys and
 *  the high-level section recipes (welcome, closing). */
export type SingleTemplateId =
  | "chapter-opener"
  | "standard-body"
  | "standard-body-with-quotes"
  | "data-numerology"
  | "affirmations"
  | "section-divider"
  | "body-continued"
  | "welcome-letter"
  | "closing-letter"
  | "body-stress"
  | "hardcover"
  | "zodiac-moon"
  | "zodiac-rising"
  | "birthstone"
  | "natal-chart";

function mockOrder(overrides?: Partial<ZodiacOrder>): ZodiacOrder {
  const base = {
    id: 9999,
    fullName: "Sample Reader",
    email: "sample@example.com",
    birthday: "1990-05-15",
    birthTime: "08:30",
    birthLocation: "San Diego, California, USA",
    gender: "female",
    intention: "self",
    sexualOrientation: "straight",
    relationshipStatus: "single",
    sunSign: "Leo",
    moonSign: "Cancer",
    risingSign: "Libra",
    lifePath: "7",
    luckyNumbers: "3, 7, 14, 21, 33",
    status: "generated",
    generatedContent: null,
    luluOrderId: null,
    luluStatus: null,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    priceUsd: 99.99,
    interiorPdfUrl: null,
    coverPdfUrl: null,
    shippingAddress: null,
    trackingNumber: null,
    trackingUrl: null,
    estimatedDelivery: null,
    referralCode: null,
    referredBy: null,
    referralCount: 0,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
  };
  return { ...base, ...overrides } as unknown as ZodiacOrder;
}

/** Long-form mock chapter — 5+ subsections, ~25 paragraphs, enough to spill
 *  across 1 × standard-body + several body-continued pages. Used by the
 *  `body-stress` test mode. */
function mockLongChapter(): ParsedChapter {
  return {
    number: 5,
    title: "Relationships — Love, Partnership & Soul Contracts",
    subtitle: "Venus, Mars, and the architecture of connection",
    lead:
      "Sample, the architecture of your connections is built from a precise constellation of placements that shape how you love, how you receive love, and how you tend to the bonds that matter most. Your Venus in Libra wants harmony at the cost of nothing real, and your Mars in Scorpio wants depth at the cost of nothing surface — and the dance between those two desires is the central drama of your relationship life.",
    subsections: [
      {
        heading: "Your Venus & how you give love",
        paragraphs: [
          "Venus in Libra is the planet of art, beauty, and partnership operating in the sign of balance and aesthetic intelligence. You love through making space. You make rooms more livable, conversations more two-sided, and small gestures more thoughtful. People near you often don't notice how much careful tending you do — and that invisibility is both your gift and your wound.",
          "What feels romantic to you isn't grand declarations. It's the noticing. It's someone who remembers what you said three weeks ago and brings it up at the right moment. It's someone who treats your friends with the same care they treat you. Libra Venus reads small acts as the truest love language, because in your inner taxonomy, anyone can say the words; only the people who really see you can pay attention to the details.",
          "The shadow of this Venus placement is the indecisive people-pleaser — the person who waits to see what their partner wants before naming their own preference, who polishes their opinions until they're palatable, who loses the thread of their own desire in the project of mirroring someone else. Watch for this in yourself. Your love is more lasting when it includes your difference, not despite it.",
        ],
      },
      {
        heading: "Your Mars & how you pursue",
        paragraphs: [
          "Mars in Scorpio gives you a depth of desire that surprises people who only know your Libra Venus surface. You are not a casual lover. The people who have known you intimately know that you go all the way in, all the way down, all the way through — and the people who haven't earned that depth see only the diplomat at the door.",
          "Your pursuit is patient. You wait. You watch. You let someone reveal themselves before you reveal yourself. This makes you maddeningly difficult to read for partners who are used to the standard early-relationship metabolism — but the ones who pass through your reading become the great loves, the great alliances, the great soul-contract attachments.",
          "Mars in Scorpio shadow: jealousy that you don't admit to, control that you don't name, and a tendency to test the people you love by withdrawing to see if they'll come after you. Be careful with this. The people most worth keeping are the ones who don't pass cruel tests — they pass kind ones.",
        ],
      },
      {
        heading: "The 5th House — your romantic timing",
        paragraphs: [
          "Your 5th house — the house of romance, creativity, and play — is tenanted by Jupiter, and that single placement is doing an enormous amount of work in how your love story moves. Jupiter expands what it touches. It says yes. It signals abundance, possibility, and a generous willingness to bet on something new.",
          "This is why your romantic life has had pronounced peaks — moments where everything aligned and you found yourself in something unexpectedly large and luminous. Jupiter doesn't deliver small love. It delivers love that asks you to grow, to stretch, to meet someone bigger than the partner you imagined for yourself.",
          "The work with a Jupiter 5th is not finding love — Jupiter overdelivers on that — it's discerning which of the many possibilities to commit to. Your job is editorial, not generative.",
        ],
      },
      {
        heading: "The 7th House — committed partnership",
        paragraphs: [
          "Your 7th house cusp is in Aries, with the ruling Mars in Scorpio — which means your committed partnerships often have a sharp initiating quality at the start, a clear pursuit dynamic that resolves into the deep Scorpionic bond once you're settled. The partners who last with you are the ones who can hold both energies — they can show up as warriors at the threshold and as mystics in the inner chamber.",
          "Aries on the 7th also means you often play the more receptive role in the early phase of committed relationships — letting your partner take the lead in courtship, even when you're the more emotionally intelligent of the pair. That's natural; that's the chart's design. It doesn't mean you've given up your power. It means you trust the timing.",
        ],
      },
      {
        heading: "The 8th House — deep intimacy",
        paragraphs: [
          "Your 8th house — the house of merged resources, sexuality, and transformation — is occupied by both your Sun and Mercury. This is unusual and significant. It means your core identity (Sun) and your way of thinking and communicating (Mercury) are both wired for depth, for the work that happens beneath the surface of polite life.",
          "You are someone who comes alive in difficult conversations. You are someone who would rather know than be comfortable. You are someone who, given the choice between a partner who is easy and a partner who is real, will choose real every time.",
          "This is also why surface relationships exhaust you. The cocktail party version of getting to know someone leaves you feeling like you've been handed a postcard of a country you wanted to visit. You want the full atlas.",
        ],
      },
      {
        heading: "Soul Urge Number 7 — what your heart truly seeks",
        paragraphs: [
          "Your Soul Urge Number 7 — calculated from the vowels in your full name — speaks to the deepest motivation of your heart in relationship. The 7 is the seeker, the contemplative, the one who wants meaning before company.",
          "What this means in love: you are drawn to partners with inner lives, with curiosities that don't depend on you, with private gardens of thought. You find shallow attraction tiring even when it's flattering. You can spend hours in silence with the right person and feel that you have been spoken to.",
          "It also means you sometimes withdraw mid-conversation, mid-evening, mid-life. The 7 retreats not because you don't love your partner but because you need to commune with yourself to remember what you bring back to them.",
        ],
      },
      {
        heading: "Patterns to watch for",
        paragraphs: [
          "You sometimes pick partners who are too easy in the early phase and then watch the relationship grow uncomfortable as your Scorpionic depth begins to ask for more than they came to give. The early-phase ease is not a green flag for you — it is a yellow flag. Look for partners whose initial offer matches the depth you know you will need later.",
          "You sometimes confuse harmony with health. A relationship without conflict is not necessarily a relationship with intimacy — it might just be a relationship with a great deal of skilled accommodation. Your Libra Venus will help you find the words; your Scorpio Mars wants you to use them on something real.",
        ],
      },
    ],
    pullQuote:
      "You are someone who, given the choice between a partner who is easy and a partner who is real, will choose real every time.",
  };
}

function mockChapter(): ParsedChapter {
  return {
    number: 3,
    title: "Your Moon Sign",
    subtitle: "Cancer · The Tender Heart",
    lead:
      "Within the soft chambers of your soul, you carry a deeply intuitive emotional intelligence, Sample. Your Cancer Moon is the keeper of memory and meaning — the part of you that remembers how every moment felt, long after the surface details have faded.",
    subsections: [
      {
        heading: "Your emotional landscape",
        paragraphs: [
          "The Moon in Cancer means you feel everything at full volume, and you've often had to learn to protect that sensitivity from a world that doesn't always honor it. Home, family, and the people you've chosen as your inner circle are the rooms where you become yourself most completely.",
          "When you feel safe, your imagination expands. When you feel unsafe, you retreat — and that retreat is a wisdom, not a weakness. The work is learning the difference between rest and hiding, and giving yourself permission to do both when each is what your body asks for.",
        ],
      },
      {
        heading: "What you need to feel nurtured",
        paragraphs: [
          "Slow mornings, water near you (a bath, the ocean, a long walk by a river), conversations with people who don't rush your sentences. Cooking for someone you love. Being cooked for. The smell of something simmering on a stove.",
          "You replenish through ritual more than through novelty. A Sunday that looks like the last Sunday is not boring to you — it is medicine.",
        ],
      },
    ],
    pullQuote:
      "You feel everything at full volume — and that sensitivity is not a flaw to manage, but a frequency you were tuned to.",
  };
}

/** Render a single template page for visual review. Useful while iterating
 *  on a specific template without regenerating the full 49-page book. */
export async function renderSingleTemplate(id: SingleTemplateId): Promise<Buffer> {
  const manifest = await loadManifest();
  const out = await PDFDocument.create();
  out.setTitle(`Template Test — ${id}`);
  out.setAuthor("Holigrowth");
  const fonts = await loadFonts(out);
  const ctx: BuildCtx = {
    out,
    fonts,
    manifest,
    embedCache: new Map(),
    order: mockOrder(),
    pageNumber: 0,
    chapterStarts: new Map(),
    tocPage: null,
  };

  const ch = mockChapter();
  switch (id) {
    case "chapter-opener":
      await buildChapterOpener(ctx, ch);
      break;
    case "standard-body":
      await buildStandardBodyFlow(ctx, ch, { firstPageOnly: true });
      break;
    case "standard-body-with-quotes": {
      // Stress-test: long pull quote + 5 long paragraphs under a single
      // subsection. The pull-quote page fits the subsection heading +
      // pull quote + as many paragraphs as the page can hold; remaining
      // paragraphs spill onto body-continued pages with matching header.
      // Verify no text is ever cut off and no content duplicates.
      const stressChapter: ParsedChapter = {
        ...mockLongChapter(),
        pullQuote:
          "The deepest intimacy you will ever experience is the one you build with yourself first — that quiet, unhurried, lifelong conversation in which you stop performing the person you thought you should be and slowly, devotedly, learn the shape of the person you actually are. Choose her on purpose, every single day, and watch what becomes possible when you finally stop bracing for permission to take up the space that has always been yours.",
        subsections: [
          {
            heading: "The slow, devoted return to yourself",
            paragraphs: [
              "Begin with the smallest acts of self-recognition. Notice when you say yes with your mouth and no with your shoulders. Notice when you laugh at a joke that hurt you. Notice the meals you skip when no one is watching, and the meals you make beautiful when someone is. Each of these is data — a sentence in the long, unfinished autobiography you are always writing whether you mean to or not.",
              "Then start to translate. The body keeps faithful records that the mind has been trained to overlook. When your jaw locks during a conversation, that is a sentence. When your breath gets shallow on a Sunday evening, that is a paragraph. When you wake at 3am with your heart pounding and no specific reason, that is an entire chapter that has been waiting for you to read it. The work of self-knowledge is, in large part, the work of becoming literate in your own body's language.",
              "Devotion looks different from discipline. Discipline is the cold parent who will not let you off the hook. Devotion is the patient one who notices what you need before you have to ask. Build the second kind of relationship with yourself, even if you have to practice in your own handwriting at first — leaving yourself notes, scheduling rest the way you schedule meetings, putting your name on the calendar with the same seriousness you give a doctor's appointment.",
              "There will be a season in this work that feels embarrassingly slow. Other people will be making big external moves while you are learning how to ask yourself what you actually want for dinner. Let that be what it is. The interior renovations are real work, even when they don't show up in anyone else's frame. You are not behind. You are building the foundation that everything else will be built upon.",
              "And eventually — not on any timeline you can set, but eventually — the chosen version of you starts to take up residence in your real life. You stop bracing for the other shoe. You start to notice that your yes is yours. Your no is yours. Your tiredness is information rather than failure. Your joy is no longer borrowed. This is what coming home looks like. It is quieter than you thought it would be, and more permanent.",
            ],
          },
        ],
      };
      const allParagraphs = stressChapter.subsections[0]!.paragraphs;
      const { consumed } = await buildPullQuotePage(ctx, stressChapter, allParagraphs);
      let cursor = consumed;
      while (cursor < allParagraphs.length) {
        const consumedHere = await buildBodyContinuedPage(ctx, stressChapter, allParagraphs, cursor);
        if (consumedHere === 0) break;
        cursor += consumedHere;
      }
      break;
    }
    case "data-numerology":
      await buildDataNumerologyPage(ctx, { ...ch, number: 8, title: "Your Numerological Fortune" });
      break;
    case "affirmations":
      // Smoke test: render 5 affirmations stacked to exercise the multi-item
      // layout. Pass a single-element array to test the focal-quote layout.
      await buildAffirmationPage(
        ctx,
        ch,
        [
          "I trust the quiet wisdom of my own knowing — it has never led me astray.",
          "I am soft enough to be moved, strong enough to stay.",
          "I belong to my own body and my own becoming.",
          "I am allowed to want what I want, on the timeline I want it.",
          "I receive what I have been quietly building toward.",
        ],
        "Cancer Moon · Life Path 7",
      );
      break;
    case "section-divider":
      await buildSectionDivider(ctx, "I", "Foundations", "Where your story is written in the stars");
      break;
    case "body-continued":
      await buildBodyContinuedPage(ctx, ch, ch.subsections.flatMap((s) => s.paragraphs), 0);
      break;
    case "welcome-letter": {
      const welcomeBody = [
        "Sample, welcome. The book you are about to read was written for you — for your specific birth, your specific sky, your specific name and the numbers it carries.",
        "Read it slowly. Some of it will feel like recognition; some will feel like an invitation; some will feel like a question. All of those are the right responses. The stars don't tell you what to do; they tell you what you already know, in language you can finally hear.",
      ].join("\n\n");
      await buildWelcomeLetter(ctx, welcomeBody);
      break;
    }
    case "closing-letter": {
      const closingBody = [
        "Dearest Sample, this is the last page of the book, but not the last page of you.",
        "Everything in this book was already true before you read it, and it will be true after. The work is not to memorize it — it is to live it, one ordinary morning at a time.",
        "I have loved making this for you. Go gently. The cosmos has your back.",
      ].join("\n\n");
      await buildClosingLetter(ctx, closingBody);
      break;
    }
    case "body-stress":
      // Stress test: long chapter with 5+ subsections, ~25 paragraphs.
      // Spans 1 × standard-body + several body-continued pages.
      await buildStandardBodyFlow(ctx, mockLongChapter());
      break;
    case "hardcover":
      // The hardcover wrap is a standalone PDF at 14×10.75" — not part of
      // the interior page-type system. Return its bytes directly, bypassing
      // the per-page interior accumulator.
      return buildHardcoverWrap(ctx.order);
    case "zodiac-moon":
      await buildZodiacGlyphPage(ctx, "moon");
      break;
    case "zodiac-rising":
      await buildZodiacGlyphPage(ctx, "rising");
      break;
    case "birthstone":
      // The mock order's birthday (1990-05-15) lands in May → Emerald.
      // Swap the mockOrder({ birthday: "..." }) to preview other stones.
      await buildBirthstonePage(ctx, { ...ch, title: "Your Birthstone", subtitle: "A Talisman Aligned to Your Birth Month" } as ParsedChapter);
      break;
    case "natal-chart":
      await buildNatalChartPage(ctx);
      break;
  }

  // Strip form widgets so the output is flat
  const form = out.getForm();
  for (const field of form.getFields()) {
    try { form.removeField(field); } catch {}
  }

  const bytes = await out.save({ updateFieldAppearances: false });
  return Buffer.from(bytes);
}
