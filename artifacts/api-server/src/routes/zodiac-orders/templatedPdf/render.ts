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

const PAGE_BG: Record<PageTypeKey, [number, number, number]> = {
  "chapter-opener": [0.04, 0.06, 0.10], // midnight
  "standard-body": [0.96, 0.94, 0.88], // cream
  "standard-body-with-quotes": [0.96, 0.94, 0.88], // cream
  "data-numerology": [0.05, 0.03, 0.16], // deep purple
  "affirmations": [0.04, 0.06, 0.10], // midnight
  "section-divider": [0.04, 0.06, 0.10], // midnight
};

// Foreground text colours for each template's body copy.
const PAGE_FG: Record<PageTypeKey, [number, number, number]> = {
  "chapter-opener": [0.95, 0.92, 0.78],
  "standard-body": [0.13, 0.10, 0.18],
  "standard-body-with-quotes": [0.13, 0.10, 0.18],
  "data-numerology": [0.95, 0.92, 0.78],
  "affirmations": [0.95, 0.92, 0.78],
  "section-divider": [0.95, 0.92, 0.78],
};

const GOLD: [number, number, number] = [0.79, 0.66, 0.30];

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
}

const STYLES: Record<string, PlaceholderStyle> = {
  // Chapter opener (recto, midnight)
  CH_NUM:           { weight: "italic",  size: 26, color: "gold", align: "center" },
  CHAPTER_TITLE:    { weight: "bold",    size: 9,  color: "fg",   align: "left", characterSpacing: 1.2, upper: true },
  CHAPTER_SUBTITLE: { weight: "italic",  size: 13, color: "gold", align: "center", wrapWidth: 320 },

  // Body pages
  READER_FIRST_NAME:   { weight: "bold",    size: 9,    color: "fg",   align: "left",  upper: true, characterSpacing: 1.5 },
  LEAD_PARAGRAPH:      { weight: "italic",  size: 12.5, color: "fg",   align: "left",  wrapWidth: 360, leading: 1.55 },
  SUBSECTION_HEADING:  { weight: "italic",  size: 12,   color: "gold", align: "left",  characterSpacing: 0.5 },
  BODY_PARAGRAPH:      { weight: "regular", size: 11.5, color: "fg",   align: "left",  wrapWidth: 360, leading: 1.55 },
  BULLET_1:            { weight: "bold",    size: 10,   color: "gold", align: "left",  upper: true, characterSpacing: 0.8 },
  BULLET_2:            { weight: "bold",    size: 10,   color: "gold", align: "left",  upper: true, characterSpacing: 0.8 },
  BULLET_3:            { weight: "bold",    size: 10,   color: "gold", align: "left",  upper: true, characterSpacing: 0.8 },

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
};

const DEFAULT_STYLE: PlaceholderStyle = { weight: "regular", size: 11.5, color: "fg", align: "left" };

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

/** Mask a slot with a same-color rectangle to hide the visible {{NAME}} text. */
function maskSlot(ctx: RenderCtx, slot: Slot): void {
  const padX = 2;
  const padY = 1;
  ctx.page.drawRectangle({
    x: slot.x - padX,
    y: slot.y - padY,
    width: slot.w + padX * 2,
    height: slot.h + padY * 2,
    color: rgbColor(PAGE_BG[ctx.pageType]),
  });
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

/** Draw a single piece of text into a slot with the placeholder's style preset. */
function fillSlot(
  ctx: RenderCtx,
  placeholderName: string,
  slot: Slot,
  text: string,
): void {
  if (!text || text.length === 0) return;
  const style = STYLES[placeholderName] ?? DEFAULT_STYLE;
  const font = pickFont(style.weight, ctx.fonts);
  const size = style.size;
  const color = rgbColor(resolveColor(style, ctx.pageType));
  const display = style.upper ? text.toUpperCase() : text;

  maskSlot(ctx, slot);

  if (!style.wrapWidth) {
    // Single-line draw.
    let x = slot.x;
    if (style.align === "center") {
      const width = font.widthOfTextAtSize(display, size);
      x = slot.x + slot.w / 2 - width / 2;
    }
    ctx.page.drawText(display, {
      x,
      y: slot.y,
      size,
      font,
      color,
      ...(style.characterSpacing ? { characterSpacing: style.characterSpacing } : {}),
    });
    return;
  }

  // Multi-line: wrap then stack downward from the slot's baseline.
  const lines = wrapText(display, font, size, style.wrapWidth);
  const lineGap = size * (style.leading ?? 1.45);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let x = slot.x;
    if (style.align === "center") {
      const width = font.widthOfTextAtSize(line, size);
      x = slot.x + (style.wrapWidth ?? slot.w) / 2 - width / 2 - (style.wrapWidth ? (style.wrapWidth - slot.w) / 2 : 0);
    }
    ctx.page.drawText(line, {
      x,
      y: slot.y - i * lineGap,
      size,
      font,
      color,
      ...(style.characterSpacing ? { characterSpacing: style.characterSpacing } : {}),
    });
  }
}

/**
 * Multi-page text flow: render `text` starting at slot, returning whatever
 * didn't fit so the caller can spill onto another `02-standard-body` page.
 *
 * Estimates available vertical space by comparing the slot's baseline to the
 * page's bottom safe margin (45pt from page bottom by Lulu spec).
 */
function fillFlowingBody(
  ctx: RenderCtx,
  placeholderName: string,
  slot: Slot,
  text: string,
  pageHeightPt: number,
): { remaining: string } {
  const style = STYLES[placeholderName] ?? DEFAULT_STYLE;
  const font = pickFont(style.weight, ctx.fonts);
  const size = style.size;
  const color = rgbColor(resolveColor(style, ctx.pageType));
  const wrapWidth = style.wrapWidth ?? 360;
  const leading = size * (style.leading ?? 1.55);
  const safeBottom = 45; // 0.625 in safe margin

  maskSlot(ctx, slot);

  const lines = wrapText(text, font, size, wrapWidth);
  let usedLines = 0;
  let cursorY = slot.y;
  for (const line of lines) {
    if (cursorY < safeBottom + leading) break;
    ctx.page.drawText(line, { x: slot.x, y: cursorY, size, font, color });
    cursorY -= leading;
    usedLines++;
  }
  if (usedLines === lines.length) {
    return { remaining: "" };
  }
  // Reconstruct remaining text from the unrendered lines (joined with spaces).
  const remaining = lines.slice(usedLines).join(" ");
  return { remaining };
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

interface BuildCtx {
  out: PDFDocument;
  fonts: FontSet;
  manifest: Manifest;
  embedCache: Map<string, PDFEmbeddedPage>;
  order: ZodiacOrder;
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
  return {
    page,
    pageType: pageTypeKey === "zodiac-sign" ? null : ctx.manifest.pageTypes[pageTypeKey],
    pageTypeKey,
  };
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
async function buildStandardBodyFlow(ctx: BuildCtx, ch: ParsedChapter): Promise<void> {
  // Concatenate the chapter's running prose: lead + each subsection's prose.
  const allBody = [
    ch.subsections
      .filter((s) => !/^your\s+\d+\s+\w+\s+affirmations?/i.test(s.heading))
      .map((s) => s.paragraphs.join(" "))
      .join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\s+/g, " ")
    .trim();

  const headings = ch.subsections
    .filter((s) => !/^your\s+\d+\s+\w+\s+affirmations?/i.test(s.heading))
    .map((s) => s.heading);

  const pageType = ctx.manifest.pageTypes["standard-body"];
  let firstPage = true;
  let remaining = allBody;
  let safetyHops = 0;
  while ((remaining.length > 0 || firstPage) && safetyHops < 12) {
    safetyHops++;
    const { page } = await newPageFromTemplate(ctx, "standard-body");
    const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "standard-body" };

    // Always fill chapter-title + reader-first-name on every body page.
    const chTitleSlot = getSlot(pageType, "CHAPTER_TITLE");
    const nameSlot = getSlot(pageType, "READER_FIRST_NAME");
    if (chTitleSlot) fillSlot(rc, "CHAPTER_TITLE", chTitleSlot, ch.title);
    if (nameSlot) fillSlot(rc, "READER_FIRST_NAME", nameSlot, firstName(ctx.order));

    const subSlots = getSlots(pageType, "SUBSECTION_HEADING");
    if (firstPage) {
      // Lead paragraph
      const leadSlot = getSlot(pageType, "LEAD_PARAGRAPH");
      if (leadSlot) fillSlot(rc, "LEAD_PARAGRAPH", leadSlot, ch.lead);
      // First two subsection headings
      for (let i = 0; i < Math.min(2, headings.length); i++) {
        if (subSlots[i]) fillSlot(rc, "SUBSECTION_HEADING", subSlots[i]!, headings[i]!);
      }
      // Three bullets — synthesise from subsection headings if available, else from lead sentences.
      const bulletPool = headings.slice(0, 3);
      while (bulletPool.length < 3) {
        const sentences = ch.lead.split(/(?<=[.!?])\s+/).filter((s) => s.length > 25 && s.length < 90);
        if (sentences.length === 0) break;
        bulletPool.push(sentences[bulletPool.length] ?? sentences[0]!);
      }
      for (let i = 0; i < 3; i++) {
        const slot = getSlot(pageType, `BULLET_${i + 1}`);
        const text = bulletPool[i] ?? "";
        if (slot && text) fillSlot(rc, `BULLET_${i + 1}`, slot, text);
      }
    } else {
      // Continuation pages: clear the slots that don't apply.
      for (const name of ["LEAD_PARAGRAPH", "BULLET_1", "BULLET_2", "BULLET_3"]) {
        const slot = getSlot(pageType, name);
        if (slot) maskSlot(rc, slot);
      }
      for (const slot of subSlots) maskSlot(rc, slot);
    }

    const bodySlot = getSlot(pageType, "BODY_PARAGRAPH");
    if (bodySlot) {
      const result = fillFlowingBody(
        rc,
        "BODY_PARAGRAPH",
        bodySlot,
        remaining,
        ctx.manifest.spec.page.heightPt,
      );
      remaining = result.remaining;
    } else {
      // No body slot — bail, otherwise we'd spin forever.
      remaining = "";
    }
    firstPage = false;
  }
}

async function buildPullQuotePage(ctx: BuildCtx, ch: ParsedChapter): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "standard-body-with-quotes");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "standard-body-with-quotes" };
  const nameSlot = getSlot(pageType, "READER_FIRST_NAME");
  const subSlot = getSlot(pageType, "SUBSECTION_HEADING");
  const bodySlot = getSlot(pageType, "BODY_PARAGRAPH");
  const titleSlot = getSlot(pageType, "CHAPTER_TITLE");
  const quoteSlot = getSlot(pageType, "PULL_QUOTE");
  if (nameSlot) fillSlot(rc, "READER_FIRST_NAME", nameSlot, firstName(ctx.order));
  if (titleSlot) fillSlot(rc, "CHAPTER_TITLE", titleSlot, ch.title);
  // Pick the last subsection's heading + closing prose as the body content.
  const lastSub = ch.subsections[ch.subsections.length - 1];
  if (subSlot) fillSlot(rc, "SUBSECTION_HEADING", subSlot, lastSub?.heading ?? "");
  if (bodySlot) {
    const closingProse = (lastSub?.paragraphs ?? [ch.lead]).join(" ");
    fillFlowingBody(rc, "BODY_PARAGRAPH", bodySlot, closingProse, ctx.manifest.spec.page.heightPt);
  }
  if (quoteSlot) fillSlot(rc, "PULL_QUOTE", quoteSlot, ch.pullQuote ?? ch.lead.split(/(?<=[.!?])\s+/)[0] ?? "");
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
  if (tSlot) fillSlot(rc, "CHAPTER_TITLE", tSlot, ch.title);
}

async function buildDataNumerologyPage(ctx: BuildCtx, ch: ParsedChapter): Promise<void> {
  const { page, pageType } = await newPageFromTemplate(ctx, "data-numerology");
  if (!pageType) return;
  const rc: RenderCtx = { page, fonts: ctx.fonts, pageType: "data-numerology" };
  const slots = pageType.slots;

  // Pull values from the order; fall back to chapter-derived hints.
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
  const signLine = order.sunSign ?? "";
  const houseLine = "5th House"; // placeholder — TODO: derive from chart calculations
  const elementLine = signElement(order.sunSign);

  const fill = (name: string, val: string) => {
    const s = slots[name];
    if (!s) return;
    if (Array.isArray(s)) s.forEach((slot) => fillSlot(rc, name, slot, val));
    else fillSlot(rc, name, s, val);
  };
  fill("CHAPTER_TITLE", ch.title);
  fill("READER_FIRST_NAME", firstName(order));
  fill("NUMBER", String(number));
  fill("ARCHETYPE_NAME", archetype);
  fill("CALCULATION", calc);
  fill("ELEMENT", elementLine);
  fill("KEYWORDS", lifePathKeywords(String(number)));
  fill("SHADOW", lifePathShadow(String(number)));
  fill("SIGN", signLine);
  fill("HOUSE", houseLine);

  const interpSlot = getSlot(pageType, "INTERPRETATION_BODY");
  if (interpSlot) {
    const interp = ch.lead || "Your numbers tell a story unique to your path.";
    fillFlowingBody(rc, "INTERPRETATION_BODY", interpSlot, interp, ctx.manifest.spec.page.heightPt);
  }
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

// ── Recipe walker ────────────────────────────────────────────────────────────

async function processRecipe(ctx: BuildCtx, recipe: Recipe, book: ParsedBook): Promise<void> {
  if (recipe.section === "welcome") {
    const ch: ParsedChapter = {
      number: 0, title: book.welcome.title || "Welcome", subtitle: null,
      lead: book.welcome.body.split(/\n\n+/)[0]?.trim() ?? "", subsections: [],
      pullQuote: null,
    };
    await buildStandardBodyFlow(ctx, ch);
    return;
  }
  if (recipe.section === "closing") {
    const ch: ParsedChapter = {
      number: 99, title: book.closing.title || "A Love Letter from the Universe", subtitle: null,
      lead: book.closing.body.split(/\n\n+/)[0]?.trim() ?? "", subsections: [],
      pullQuote: extractClosingPullQuote(book.closing.body),
    };
    await buildPullQuotePage(ctx, ch);
    return;
  }
  if (recipe.section === "part") {
    await buildSectionDivider(ctx, recipe.partNum, recipe.partTitle, recipe.partTagline);
    return;
  }
  // Chapter recipe
  const ch = book.chapters.find((c) => c.number === recipe.chapter);
  if (!ch) return;
  for (const step of recipe.templates) {
    if (step === "chapter-opener")            await buildChapterOpener(ctx, ch);
    else if (step === "zodiac-sign")          await buildZodiacSignPage(ctx);
    else if (step === "standard-body+")       await buildStandardBodyFlow(ctx, ch);
    else if (step === "standard-body")        await buildStandardBodyFlow(ctx, ch);
    else if (step === "standard-body-with-quotes") await buildPullQuotePage(ctx, ch);
    else if (step === "data-numerology")      await buildDataNumerologyPage(ctx, ch);
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
  const ctx: BuildCtx = { out, fonts, manifest, embedCache: new Map(), order };

  for (const recipe of manifest.chapterRecipes) {
    if (options?.maxPages && out.getPageCount() >= options.maxPages) break;
    await processRecipe(ctx, recipe, book);
  }

  const bytes = await out.save();
  return Buffer.from(bytes);
}
