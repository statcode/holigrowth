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
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type PDFEmbeddedPage } from "pdf-lib";
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
  "closing-letter": TEMPLATE_CREAM,
  "body-continued": TEMPLATE_CREAM,
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
  "closing-letter": [0.13, 0.10, 0.18],
  "body-continued": [0.13, 0.10, 0.18],
};

const GOLD: [number, number, number] = [0.79, 0.66, 0.30];

const ZODIAC_GLYPHS: Record<string, string> = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋",
  Leo: "♌", Virgo: "♍", Libra: "♎", Scorpio: "♏",
  Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};

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
  PULL_QUOTE: { weight: "italic", size: 16, color: "gold", align: "center", wrapWidth: 320, leading: 1.4 },

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
  SIGN_GLYPH:  { weight: "display", size: 64, color: "gold", align: "left" },
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
    if (r.section === "welcome") {
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
function pickThreeBullets(ch: ParsedChapter): (string | null)[] {
  const pool: string[] = [];
  // 1. Use subsection headings first — they're already-distinct topic markers.
  for (const h of ch.subsections.map((s) => s.heading)) {
    if (pool.length >= 3) break;
    if (h && !pool.includes(h)) pool.push(h);
  }
  // 2. Top up from the lead's sentences (filter for scannable length).
  if (pool.length < 3) {
    const sentences = ch.lead
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25 && s.length < 95);
    for (const s of sentences) {
      if (pool.length >= 3) break;
      if (!pool.includes(s)) pool.push(s);
    }
  }
  // 3. Top up from each subsection's first sentence.
  if (pool.length < 3) {
    for (const sec of ch.subsections) {
      if (pool.length >= 3) break;
      const first = sec.paragraphs[0]?.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
      if (first.length > 25 && first.length < 95 && !pool.includes(first)) pool.push(first);
    }
  }
  return [pool[0] ?? null, pool[1] ?? null, pool[2] ?? null];
}

async function buildStandardBodyFlow(ctx: BuildCtx, ch: ParsedChapter, options?: { firstPageOnly?: boolean }): Promise<void> {
  const paragraphPool = ch.subsections.flatMap((s) => s.paragraphs);
  const headings = ch.subsections.map((s) => s.heading);

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
      if (headings[i]) fillSlot(rc, "SUBSECTION_HEADING", subSlots[i]!, headings[i]!);
      else maskSlot(rc, subSlots[i]!);
    }

    // 3 distinct bullets — never repeat the same line three times.
    const bullets = pickThreeBullets(ch);
    for (let i = 0; i < 3; i++) {
      const slot = getSlot(stdBody, `BULLET_${i + 1}`);
      if (!slot) continue;
      const text = bullets[i];
      if (text) fillSlot(rc, `BULLET_${i + 1}`, slot, text);
      else maskSlot(rc, slot);
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
 * Template layout (03-standard-body-with-quotes):
 *   - Header band (READER_FIRST_NAME, CHAPTER_TITLE)
 *   - SUBSECTION_HEADING band
 *   - Above-quote zone: BODY_PARAGRAPH_1 (top anchor) → ends at quote-band top
 *   - Quote band: two horizontal rules with ★ markers; PULL_QUOTE centered between
 *   - Below-quote zone: BODY_PARAGRAPH_3 (top anchor) → ends at safe bottom
 *
 * BODY_PARAGRAPH_2 and _4 are continuation-indent markers in the template
 * design; we ignore their positions and instead flow paragraphs with dynamic
 * stacking inside each zone. Any paragraphs that don't fit on this page are
 * returned so the caller can spill them onto body-continued pages.
 *
 * The pull quote auto-shrinks (font size + line count) so a long quote
 * stays inside the visible decorative band rather than crashing through it.
 *
 * Returns the number of paragraphs consumed from `paragraphs` so the caller
 * can advance its cursor and emit body-continued pages for any remainder.
 */
async function buildPullQuotePage(
  ctx: BuildCtx,
  ch: ParsedChapter,
  paragraphs?: string[],
): Promise<{ consumed: number; total: number }> {
  const { page, pageType } = await newPageFromTemplate(ctx, "standard-body-with-quotes");
  if (!pageType) return { consumed: 0, total: 0 };
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "standard-body-with-quotes" };

  // ── Cover the template's decorative band ──────────────────────────────
  // The user asked to remove the two horizontal gold rules + ★ markers in
  // the middle of the page (since we place the quote below them, the band
  // is empty content). Direct row-averaging of the template raster at the
  // rule positions (skipping the ★ glyph column) shows the surrounding bg
  // is uniformly `rgb(245, 241, 230)` ± 1 unit — so a strip painted at
  // EXACTLY that colour, only 2pt tall (just enough to cover the rule's
  // line thickness), blends invisibly into the surrounding bg.
  const RULE_BG = rgb(245/255, 241/255, 230/255);
  const ruleStrip = (x: number, y: number, w: number, h: number) =>
    page.drawRectangle({ x, y, width: w, height: h, color: RULE_BG });
  ruleStrip(40, 477, 372, 2); // top rule at y≈478
  ruleStrip(40, 434, 372, 2); // bottom rule at y≈435
  // ★ + badge squares centred on glyph positions
  drawMaskRect(rc, 210, 465, 30, 18);
  drawMaskRect(rc, 210, 447, 30, 18);
  // PULL_QUOTE widget rect (the small cream box between the rules)
  const quoteSlotBg = getSlot(pageType, "PULL_QUOTE");
  if (quoteSlotBg) drawMaskRect(rc, quoteSlotBg.x - 4, quoteSlotBg.y - 6, quoteSlotBg.w + 8, quoteSlotBg.h + 10);
  // SUBSECTION_HEADING widget rect (baked cream behind the heading)
  const subSlotBg = getSlot(pageType, "SUBSECTION_HEADING");
  if (subSlotBg) drawMaskRect(rc, subSlotBg.x - 2, subSlotBg.y - 6, subSlotBg.w + 4, subSlotBg.h + 8);

  const nameSlot = getSlot(pageType, "READER_FIRST_NAME");
  const titleSlot = getSlot(pageType, "CHAPTER_TITLE");
  if (nameSlot) fillSlot(rc, "READER_FIRST_NAME", nameSlot, firstName(ctx.order));
  if (titleSlot) fillSlot(rc, "CHAPTER_TITLE", titleSlot, headerLabel(ch));

  const subSlot = getSlot(pageType, "SUBSECTION_HEADING");
  const lastSub = ch.subsections[ch.subsections.length - 1];
  if (subSlot && lastSub?.heading) {
    fillSlot(rc, "SUBSECTION_HEADING", subSlot, lastSub.heading);
  }

  const bodySlots = getSlots(pageType, "BODY_PARAGRAPH");

  // ── Pull quote — placed BELOW the template's decorative band ──────────
  // The template has a fixed pull-quote band at y≈435-478 (two horizontal
  // gold rules with ★ markers between them). The space between the rules
  // is only ~43pt — a long quote at readable size needs 80-100pt and
  // can't fit. Previous attempts tried to MASK the rules with a flat-color
  // rectangle, but the template's raster has paper-grain texture that no
  // single RGB value can match, so the mask was always visible as a
  // "cutoff box" against the textured surroundings.
  //
  // The clean fix: position the quote ENTIRELY BELOW the decorative band
  // (centerY ≈ 365). The band remains visible above the quote as a small
  // ornament between the subsection heading and the quote text — its
  // original visual purpose preserved without any masking. Quote text
  // never intersects the rules or ★ glyphs, so no mask is needed.
  const quoteSlot = getSlot(pageType, "PULL_QUOTE");
  const quoteText = ch.pullQuote ?? ch.lead.split(/(?<=[.!?])\s+/)[0] ?? "";
  const QUOTE_CENTER_Y = 365; // below the bottom rule at y≈435
  const quoteExtent = quoteSlot
    ? drawPullQuoteCentered(rc, quoteText, QUOTE_CENTER_Y)
    : { topY: 408, bottomY: 322 };

  // ── Source paragraphs (caller may supply, else derive from the chapter) ─
  const source =
    paragraphs ??
    (lastSub?.paragraphs.length
      ? lastSub.paragraphs
      : ch.subsections.flatMap((s) => s.paragraphs).slice(-6));

  if (source.length === 0) return { consumed: 0, total: 0 };

  // ── Body zones ─────────────────────────────────────────────────────────
  // Above-zone sits between the subsection heading and the decorative band
  // (band top rule is at y≈478). Below-zone sits below the quote.
  const SAFE_BOTTOM = 45;
  const PARAGRAPH_GAP = 14;
  const DECORATIVE_BAND_TOP = 484; // 6pt buffer above top rule at y=478
  const bodyStyle = resolveStyle("BODY_PARAGRAPH", "standard-body-with-quotes");
  const leading = bodyStyle.size * (bodyStyle.leading ?? 1.45);
  const aboveStart = bodySlots[0]?.y ?? 545;
  const aboveCap = DECORATIVE_BAND_TOP;          // clear top of decorative band
  const belowStart = quoteExtent.bottomY - leading - 6;
  const belowCap = SAFE_BOTTOM;

  let consumed = 0;
  let aboveY: number | null = null;

  // Try to fit at least one paragraph above the quote. We measure its
  // height by counting wrapped lines; if it doesn't fit, push it to below.
  if (source[0]) {
    const lines = wrapText(source[0], pickFont(bodyStyle.weight, ctx.fonts), bodyStyle.size, bodySlots[0]?.w ?? 360);
    const linesAvailable = Math.max(1, Math.floor((aboveStart - aboveCap) / leading));
    // Fit only if the paragraph fits cleanly OR we can afford to take just
    // its top portion (clip with continuation flag).
    if (lines.length <= linesAvailable) {
      const { lastBaselineY } = fillFlowingBody(
        rc,
        "BODY_PARAGRAPH",
        bodySlots[0]!,
        source[0],
        ctx.manifest.spec.page.heightPt,
        aboveCap,
        { startY: aboveStart },
      );
      aboveY = lastBaselineY - leading - PARAGRAPH_GAP;
      consumed = 1;
    }
  }

  // Stack additional paragraphs above the quote while they fit.
  while (consumed < source.length && aboveY !== null) {
    const next = source[consumed]!;
    const lines = wrapText(next, pickFont(bodyStyle.weight, ctx.fonts), bodyStyle.size, bodySlots[0]?.w ?? 360);
    const linesAvailable = Math.max(0, Math.floor((aboveY - aboveCap) / leading));
    if (lines.length > linesAvailable || aboveY < aboveCap + leading) break;
    const { lastBaselineY } = fillFlowingBody(
      rc,
      "BODY_PARAGRAPH",
      bodySlots[0]!,
      next,
      ctx.manifest.spec.page.heightPt,
      aboveCap,
      { startY: aboveY },
    );
    aboveY = lastBaselineY - leading - PARAGRAPH_GAP;
    consumed++;
  }

  // ── Below-quote zone — remaining paragraphs stack dynamically ──────────
  // Only draw whole paragraphs that fit. If a paragraph would clip, stop
  // and leave it for the caller to render on a body-continued page.
  const font = pickFont(bodyStyle.weight, ctx.fonts);
  const wrap = bodySlots[2]?.w ?? 360;
  let belowY: number | null = null;
  while (consumed < source.length) {
    const next = source[consumed]!;
    const startY = belowY ?? belowStart;
    if (startY < belowCap + leading) break;
    const lines = wrapText(next, font, bodyStyle.size, wrap);
    const heightNeeded = lines.length * leading;
    if (heightNeeded > startY - belowCap) break;
    const { lastBaselineY } = fillFlowingBody(
      rc,
      "BODY_PARAGRAPH",
      bodySlots[2]!,
      next,
      ctx.manifest.spec.page.heightPt,
      belowCap,
      { startY },
    );
    belowY = lastBaselineY - leading - PARAGRAPH_GAP;
    consumed++;
  }

  return { consumed, total: source.length };
}

/**
 * Render the pull quote vertically centered on `centerY`.
 *
 * The template draws two decorative horizontal rules with ★ markers around
 * the quote anchor (top rule ~y=478, bottom rule ~y=448). They're only ~30pt
 * apart, which is too tight for a long quote at readable size — and when
 * the quote crosses into that band, the ★ markers visibly overlap text
 * glyphs. Rather than constraining the quote to that tiny window, we cover
 * the entire decorative band with a cream rectangle and let the quote
 * occupy whatever vertical space it needs.
 *
 * The font auto-shrinks from `style.size` down to `minSize` (11pt) until
 * the wrapped quote is at most `MAX_LINES` long. Returns the top/bottom Y
 * of the rendered block so callers can size body zones around it.
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
  const wrapWidth = style.wrapWidth ?? 320;
  const MAX_LINES = 6;
  const minSize = 11;

  // Shrink until the wrapped text fits in MAX_LINES (or we hit minSize).
  let size = style.size;
  let leading = size * (style.leading ?? 1.4);
  let lines = wrapText(text, font, size, wrapWidth);
  while (lines.length > MAX_LINES && size > minSize) {
    size -= 0.5;
    leading = size * (style.leading ?? 1.4);
    lines = wrapText(text, font, size, wrapWidth);
  }

  // Block geometry: vertical-center on centerY.
  const ascender = size * 0.78; // approx cap height in pdf-lib's default metrics
  const totalHeight = (lines.length - 1) * leading + size; // ascender + last descender
  const baseline0 = centerY + totalHeight / 2 - ascender;

  // No mask needed. The caller (`buildPullQuotePage`) positions the
  // quote BELOW the template's decorative band (centerY≈365), so the
  // quote text never intersects the rules or ★ glyphs at y≈435-478.
  // The band stays visible above the quote as a clean ornament.

  const pageWidth = rc.page.getSize().width;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const w = font.widthOfTextAtSize(line, size);
    const x = pageWidth / 2 - w / 2;
    const y = baseline0 - i * leading;
    rc.page.drawText(line, { x, y, size, font, color });
  }
  // Return the rendered quote's visual extent so callers can size body
  // zones around it. Add small padding for line ascender/descender.
  const topY = baseline0 + ascender + 4;
  const bottomY = baseline0 - (lines.length - 1) * leading - size * 0.25 - 4;
  return { topY, bottomY };
}

async function buildAffirmationPage(
  ctx: BuildCtx,
  ch: ParsedChapter,
  affirmation: string,
  placement: string,
): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "affirmations");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "affirmations" };
  const aSlot = getSlot(pageType, "AFFIRMATION_TEXT");
  const nSlot = getSlot(pageType, "READER_FIRST_NAME");
  const pSlot = getSlot(pageType, "PLACEMENT_REFERENCE");
  const tSlot = getSlot(pageType, "CHAPTER_TITLE");
  if (aSlot) fillSlot(rc, "AFFIRMATION_TEXT", aSlot, affirmation || "I am exactly where I need to be.");
  if (nSlot) fillSlot(rc, "READER_FIRST_NAME", nSlot, firstName(ctx.order));
  if (pSlot) fillSlot(rc, "PLACEMENT_REFERENCE", pSlot, placement);
  if (tSlot) fillSlot(rc, "CHAPTER_TITLE", tSlot, headerLabel(ch));
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
  fillOne("NUMBER", String(number));
  fillOne("ARCHETYPE_NAME", archetype);
  fillOne("CALCULATION", calc);
  fillOne("SHADOW", lifePathShadow(String(number)));
  fillOne("SIGN", sun);
  fillOne("HOUSE", houseLine);

  // Sign glyph (Unicode zodiac char — may not render if Cormorant subset
  // doesn't include U+2648-U+2653; the renderer will skip the glyph and the
  // template's surrounding artwork still reads as the cosmic data card).
  fillSignGlyph(rc, getSlot(pageType, "SIGN_GLYPH"), signGlyph);

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

/** Draw the zodiac glyph if the embedded font supports the codepoint. Falls
 *  back to drawing the sign's first letter (e.g. "L" for Leo) so the slot
 *  isn't blank when the font doesn't have U+2648-U+2653. */
function fillSignGlyph(rc: RenderCtx, slot: Slot | undefined, glyph: string): void {
  if (!slot) return;
  const style = resolveStyle("SIGN_GLYPH", rc.pageType);
  const font = pickFont(style.weight, rc.fonts);
  const size = style.size;
  const color = rgbColor(resolveColor(style, rc.pageType));
  maskSlot(rc, slot);
  if (!glyph) return;
  try {
    // widthOfTextAtSize throws if any glyph isn't encoded.
    font.widthOfTextAtSize(glyph, size);
    rc.page.drawText(glyph, { x: slot.x, y: slot.y, size, font, color });
  } catch {
    // Font lacks the zodiac codepoint — fall back to first initial.
    // (Drop in NotoSansSymbols.ttf into book-templates/fonts to enable the glyph.)
    const fallback = glyph.slice(0, 1); // unicode chars are 1 codepoint each
    try { font.widthOfTextAtSize(fallback, size); } catch { return; }
    rc.page.drawText(fallback, { x: slot.x, y: slot.y, size, font, color });
  }
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
    .map((p) => p.replace(/\s+/g, " ").trim())
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
  fill("WELCOME_BODY_PARAGRAPH_1", p1 ?? "");
  fill("WELCOME_BODY_PARAGRAPH_2", p2 ?? "");
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
  fill("CLOSING_BODY_PARAGRAPH_1", p1 ?? "");
  fill("CLOSING_BODY_PARAGRAPH_2", p2 ?? "");
  fill("CLOSING_BODY_PARAGRAPH_3", p3 ?? "");
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
  for (const step of recipe.templates) {
    if (step === "chapter-opener")            await buildChapterOpener(ctx, ch);
    else if (step === "zodiac-sign")          await buildZodiacSignPage(ctx);
    else if (step === "standard-body+")       await buildStandardBodyFlow(ctx, ch);
    else if (step === "standard-body")        await buildStandardBodyFlow(ctx, ch);
    else if (step === "standard-body-with-quotes") await buildPullQuotePage(ctx, ch);
    else if (step === "data-numerology")      await buildDataNumerologyPage(ctx, ch);
    else if (step === "welcome-letter")       await buildWelcomeLetter(ctx, ch.lead);
    else if (step === "closing-letter")       await buildClosingLetter(ctx, ch.lead);
    else if (step === "affirmations") {
      // Pillar chapters: signature affirmation. Chapter 10: Morning/Midday/Evening triplets.
      if (ch.number === 10 && ch.mantras) {
        const slot = recipe.templates.filter((s) => s === "affirmations").indexOf(step);
        const which = (["morning","midday","evening"] as const)[slot] ?? "morning";
        const list = ch.mantras[which];
        await buildAffirmationPage(ctx, ch, list[0] ?? "", which.toUpperCase());
      } else {
        const aff = ch.affirmations?.[0] ?? ch.lead.split(/(?<=[.!?])\s+/)[0] ?? "";
        await buildAffirmationPage(ctx, ch, aff, placementForChapter(ch));
      }
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
  | "body-stress";

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
    customAffirmations: null,
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
          "The deepest intimacy you will ever experience is the one you build with yourself first — that quiet, unhurried, lifelong conversation in which you stop performing the person you thought you should be and slowly, devotedly, learn the shape of the person you actually are, and choose her on purpose every single day.",
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
      await buildAffirmationPage(
        ctx,
        ch,
        "I trust the quiet wisdom of my own knowing — it has never led me astray.",
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
  }

  // Strip form widgets so the output is flat
  const form = out.getForm();
  for (const field of form.getFields()) {
    try { form.removeField(field); } catch {}
  }

  const bytes = await out.save({ updateFieldAppearances: false });
  return Buffer.from(bytes);
}
