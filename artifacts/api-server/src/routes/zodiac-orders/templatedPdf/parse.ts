/**
 * Markdown → structured book + manifest types.
 *
 * Input: the raw markdown emitted by the AI prompt at routes/zodiac-orders/index.ts:265.
 * Output: a typed `ParsedBook` the renderer can map onto template recipes.
 *
 * The parsing rules live in artifacts/book-templates/README.md (`Markdown →
 * placeholder parsing rules` section). Keep that doc and this file in sync.
 *
 * Tolerant of either `#` or `##` for chapter headings — the AI prompt is
 * inconsistent (formatting instructions say `##`, the prompt's own outline
 * uses `#`). We detect chapter-ness by the heading TEXT, not by hash count.
 */

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Manifest types ───────────────────────────────────────────────────────────

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontName: string;
}

export type SlotsBlock = Record<string, Slot | Slot[]>;

export interface PageType {
  file: string;
  purpose: string;
  facing: "recto" | "verso" | "either" | "full-bleed";
  placeholders: string[];
  slots: SlotsBlock;
}

export type PageTypeKey =
  | "chapter-opener"
  | "standard-body"
  | "standard-body-with-quotes"
  | "data-numerology"
  | "affirmations"
  | "section-divider"
  | "welcome-letter"
  | "closing-letter"
  | "body-continued"
  | "zodiac-moon"
  | "zodiac-rising"
  | "birthstone";

export type RecipeStep = PageTypeKey | "zodiac-sign" | "standard-body+";

export interface PartRecipe {
  section: "part";
  partNum: string;
  partTitle: string;
  partTagline: string;
  templates: RecipeStep[];
}

export interface ChapterRecipe {
  section: "chapter";
  chapter: number;
  title: string;
  templates: RecipeStep[];
  $note?: string;
}

export interface WelcomeRecipe {
  section: "welcome";
  title: string;
  templates: RecipeStep[];
}

export interface ClosingRecipe {
  section: "closing";
  title: string;
  templates: RecipeStep[];
}

export type Recipe = PartRecipe | ChapterRecipe | WelcomeRecipe | ClosingRecipe;

export interface Manifest {
  spec: {
    page: { widthPt: number; heightPt: number };
    safeMarginIn: number;
  };
  pageTypes: Record<PageTypeKey, PageType>;
  zodiacSigns: Record<string, string>;
  chapterRecipes: Recipe[];
}

// ── Manifest loading ─────────────────────────────────────────────────────────

/**
 * Locate `artifacts/book-templates/` at runtime. Two scenarios:
 *
 *   1. **Bundled** (production, `pm2`'s `dist/index.mjs`): `import.meta.url`
 *      lives at `artifacts/api-server/dist/index.mjs` → 2 dirs up to
 *      `artifacts/`, then `+book-templates`.
 *   2. **Source** (local smoke scripts via `tsx`): `import.meta.url` lives at
 *      `artifacts/api-server/src/routes/zodiac-orders/templatedPdf/parse.ts`
 *      → 5 dirs up to `artifacts/`, then `+book-templates`.
 *
 * The previous implementation hard-coded the 5-up offset, which silently
 * broke in production by landing at `/home/<server>/book-templates/`
 * (well outside the app's home dir). Fix is to probe both candidates and
 * use whichever has `manifest.json` present. Env override
 * (`BOOK_TEMPLATES_DIR=…`) wins if set, for ops-level recovery.
 */
function resolveTemplatesDir(): string {
  if (process.env.BOOK_TEMPLATES_DIR) return process.env.BOOK_TEMPLATES_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "book-templates"),                       // bundled  dist/index.mjs → artifacts/
    path.resolve(here, "..", "..", "..", "..", "..", "book-templates"),     // source   parse.ts → artifacts/
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "manifest.json"))) return c;
  }
  // Fall back to the first candidate so the eventual file-open error
  // surfaces with the canonical path (helps future debugging) — but log
  // loudly so an ops person knows the templates dir is missing.
  console.error(
    `[templates] artifacts/book-templates not found in either candidate location: ${candidates.join(", ")}`,
  );
  return candidates[0]!;
}

const TEMPLATES_DIR = resolveTemplatesDir();

let cachedManifest: Manifest | null = null;

export async function loadManifest(): Promise<Manifest> {
  if (cachedManifest) return cachedManifest;
  const raw = await fs.readFile(path.join(TEMPLATES_DIR, "manifest.json"), "utf8");
  cachedManifest = JSON.parse(raw) as Manifest;
  return cachedManifest;
}

export function templatePath(filename: string): string {
  return path.join(TEMPLATES_DIR, filename);
}

export function templatesDir(): string {
  return TEMPLATES_DIR;
}

// ── Parsed book structure ────────────────────────────────────────────────────

export interface ParsedSubsection {
  heading: string;
  paragraphs: string[];
}

export interface ParsedChapter {
  number: number;
  title: string;
  subtitle: string | null;
  lead: string;
  subsections: ParsedSubsection[];
  pullQuote: string | null;
  affirmations?: string[]; // pillar chapters 5/6/7
  mantras?: { morning: string[]; midday: string[]; evening: string[] }; // chapter 10
  monthlyForecast?: { month: string; text: string }[]; // chapter 12
}

export interface ParsedBook {
  welcome: { title: string; body: string };
  chapters: ParsedChapter[];
  closing: { title: string; body: string };
}

// ── Parser ───────────────────────────────────────────────────────────────────

/** Extract the chapter's featured pull quote — the LAST markdown blockquote
 *  in the chapter body. The system prompt (`book-prompt.md`) instructs the
 *  model to end every chapter with a single `> ...` line that becomes this
 *  quote, so taking the last one survives chapters that may have multiple
 *  blockquotes mid-body (model occasionally uses them for emphasis). Falls
 *  back to the last sentence of the lead paragraph if no blockquote exists. */
function extractPullQuote(body: string, fallbackLead: string): string | null {
  // Collect multi-line blockquotes (consecutive `>` lines joined with spaces)
  // so a quote that wraps onto a second line still parses cleanly.
  const blockquotes: string[] = [];
  let current: string[] = [];
  for (const line of body.split("\n")) {
    const m = /^>\s?(.*)$/.exec(line);
    if (m) {
      current.push(m[1] ?? "");
    } else if (current.length) {
      blockquotes.push(current.join(" ").replace(/\s+/g, " ").trim());
      current = [];
    }
  }
  if (current.length) blockquotes.push(current.join(" ").replace(/\s+/g, " ").trim());
  const last = blockquotes.filter(Boolean).pop();
  if (last) return last;
  // Heuristic: the last sentence of the lead paragraph, if reasonably short.
  const sentences = fallbackLead.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.length > 20 && s.length < 220);
  if (sentences.length === 0) return null;
  return sentences[sentences.length - 1]!.trim();
}

/** Split a chapter body into lead + subsections. */
function parseChapterBody(body: string): { lead: string; subsections: ParsedSubsection[] } {
  // Split on `##` or `###` (start-of-body OR after a newline). The previous
  // regex required `\n` before the marker, which silently dropped the first
  // subsection on chapters whose body began directly with `## Subsection`
  // (no lead paragraph). Anchoring with `(?:^|\n)` handles both forms.
  const parts = body.split(/(?:^|\n)(?=#{2,3}\s+)/);
  // First element is the lead paragraph(s) BEFORE any subsection. If the
  // body starts directly with `##`, the first part is the first subsection
  // (already starting with `##`) and there's no lead.
  const firstStartsWithSubheading = /^#{2,3}\s+/.test(parts[0] ?? "");
  const leadBlock = firstStartsWithSubheading ? "" : (parts.shift() ?? "");
  const lead = leadBlock.trim().split(/\n\n+/)[0]?.trim() ?? "";
  const subsections: ParsedSubsection[] = parts
    .map((part) => {
      const lines = part.split("\n");
      const headingLine = lines.shift() ?? "";
      const heading = headingLine.replace(/^#{2,3}\s+/, "").trim();
      const rest = lines.join("\n").trim();
      const paragraphs = rest
        .split(/\n\n+/)
        // Drop blockquote paragraphs (`> ...`) — these are chapter pull
        // quotes that may trail the last subsection without a `##` break.
        // `extractPullQuote` still finds them by scanning the raw body.
        .filter((p) => !/^\s*>/.test(p))
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      return { heading, paragraphs };
    })
    .filter((s) => s.heading.length > 0);
  return { lead, subsections };
}

/** Pull a numbered list (`1. ...` through `10. ...`) out of a subsection's
 *  paragraphs. Tolerates both newline-separated and space-separated items —
 *  `parseChapterBody` normalises whitespace inside paragraphs to single
 *  spaces, so by the time we see the list it may already be one long
 *  "1. ... 2. ... 3. ..." string.
 *
 *  Each item is also sanitised: stray markdown bolding (`**word**` or `* *commentary* *`),
 *  bracketed commentary, and trailing explanation past the first sentence are
 *  stripped. Gemini in particular likes to emit "1. I am light. * *Use this
 *  mantra when…*" — we want the bare "I am light." for the renderer. */
function extractNumberedList(subsection: ParsedSubsection): string[] {
  const out: string[] = [];
  const text = subsection.paragraphs.join(" ");
  // Match each "N." marker and lazily grab content until the next "N." or end.
  // The lookahead requires a digit-dot-space pattern AT a word boundary so we
  // don't trip on decimals like "2.5".
  const re = /\b(\d{1,2})\.\s+([^]+?)(?=\s+\d{1,2}\.\s+\S|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(cleanListItem(m[2]!));
  }
  return out.filter((s) => s.length > 0);
}

/** Strip markdown noise + verbose-AI commentary from a single list item.
 *  Used by both `extractNumberedList` and `extractList` so mantras /
 *  affirmations stay short and don't break the affirmation-page layout. */
function cleanListItem(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // Drop everything after the first " * " or " ** " — Gemini uses these
  // as a delimiter between the mantra and its explanatory commentary.
  // The split MUST be on whitespace-bounded asterisks so we don't
  // eat legitimate emphasis like "*you*" mid-sentence.
  s = s.split(/\s\*+\s/, 1)[0]!.trim();
  // Also drop bracketed commentary (some models do `[explanation: …]`).
  s = s.replace(/\s*\[[^\]]+\]\s*$/g, "").trim();
  // Strip surviving markdown bold / italic markers.
  s = s.replace(/\*+/g, "").trim();
  // Drop trailing colons / hyphens left over from "Mantra: text" splits.
  s = s.replace(/^[:\-—]\s*/, "").trim();
  return s;
}

/** Extract Morning/Midday/Evening mantra triplets from Chapter 10. */
function extractMantras(subsections: ParsedSubsection[]):
  | { morning: string[]; midday: string[]; evening: string[] }
  | undefined {
  const find = (label: string) =>
    subsections.find((s) => s.heading.toLowerCase().startsWith(label));
  const morning = find("morning");
  const midday = find("midday");
  const evening = find("evening");
  if (!morning && !midday && !evening) return undefined;
  return {
    morning: morning ? extractList(morning) : [],
    midday: midday ? extractList(midday) : [],
    evening: evening ? extractList(evening) : [],
  };
}

function extractList(s: ParsedSubsection): string[] {
  // Mantras may be a numbered list, a bulleted list, or just paragraphs.
  const numbered = extractNumberedList(s);
  if (numbered.length > 0) return numbered;
  const bullets = s.paragraphs
    .flatMap((p) => p.split("\n"))
    .filter((line) => /^\s*[-•*]\s+/.test(line))
    .map((line) => cleanListItem(line.replace(/^\s*[-•*]\s+/, "")));
  if (bullets.length > 0) return bullets.filter((b) => b.length > 0);
  return s.paragraphs.map(cleanListItem).filter((p) => p.length > 0);
}

/** Extract month-by-month forecast lines from Chapter 12. */
function extractMonthlyForecast(body: string): { month: string; text: string }[] {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const out: { month: string; text: string }[] = [];
  for (const m of months) {
    const re = new RegExp(`^\\s*\\*?\\*?${m}\\s*[:\\-—]\\s*(.+?)(?=\\n\\s*(?:${months.join("|")})\\s*[:\\-—]|\\n\\n|$)`, "ims");
    const match = re.exec(body);
    if (match && match[1]) {
      out.push({ month: m, text: match[1].replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

/** Heading detection: tolerant of `#` or `##`, and of "Chapter N:" / "Closing:" / "Welcome" / "Disclaimer" prefixes. */
// Top-level section breaks. The system prompt (`book-prompt.md`) uses
// `# Chapter N: ...` for chapter starts and `## ` for subsections inside
// chapter bodies, so we match ONLY a single `#` — including `##` here
// would eat every subsection as a fresh chapter and strip the body content
// (and the chapter's `> ` pull-quote) into separate sections.
const HEADING_RE = /^#\s+(.+)$/gm;

interface RawSection {
  kind: "welcome" | "chapter" | "closing";
  number?: number;
  title: string;
  body: string;
}

function splitIntoSections(content: string): RawSection[] {
  // Find every `# ...` or `## ...` heading and slice between them.
  const matches: { index: number; heading: string }[] = [];
  let m: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(content)) !== null) {
    matches.push({ index: m.index, heading: m[1]!.trim() });
  }
  if (matches.length === 0) {
    return [{ kind: "welcome", title: "Welcome", body: content.trim() }];
  }
  // Anything before the first heading is "pre-content" — usually nothing.
  const preface = content.slice(0, matches[0]!.index).trim();
  const sections: RawSection[] = [];
  if (preface.length > 50) {
    sections.push({ kind: "welcome", title: "Welcome", body: preface });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    const blockEnd = next ? next.index : content.length;
    const blockText = content.slice(cur.index, blockEnd);
    const bodyStart = blockText.indexOf("\n");
    const body = bodyStart >= 0 ? blockText.slice(bodyStart + 1).trim() : "";
    const headingText = cur.heading;

    const chapterMatch = /^Chapter\s+(\d+)\s*[:\-—]\s*(.+)$/i.exec(headingText);
    if (chapterMatch) {
      sections.push({
        kind: "chapter",
        number: parseInt(chapterMatch[1]!, 10),
        title: chapterMatch[2]!.trim(),
        body,
      });
      continue;
    }
    if (/^Closing\b/i.test(headingText)) {
      sections.push({ kind: "closing", title: headingText.replace(/^Closing\s*[:\-—]\s*/i, "").trim() || "Closing", body });
      continue;
    }
    if (/^(Welcome|Disclaimer|Introduction)/i.test(headingText)) {
      sections.push({ kind: "welcome", title: headingText, body });
      continue;
    }
    // Unknown heading — treat as chapter-like content with no number.
    sections.push({ kind: "chapter", title: headingText, body });
  }
  return sections;
}

export function parseBook(content: string): ParsedBook {
  const sections = splitIntoSections(content);

  const welcome = sections.find((s) => s.kind === "welcome");
  const closing = sections.find((s) => s.kind === "closing");
  const chapterSections = sections.filter((s) => s.kind === "chapter" && s.number !== undefined);

  const chapters: ParsedChapter[] = chapterSections.map((s) => {
    const fullTitle = s.title;
    const dashSplit = fullTitle.split(/\s—\s|\s-\s/);
    const title = dashSplit[0]!.trim();
    const subtitle = dashSplit.length > 1 ? dashSplit.slice(1).join(" — ").trim() : null;

    const { lead, subsections } = parseChapterBody(s.body);
    const pullQuote = extractPullQuote(s.body, lead);

    const result: ParsedChapter = {
      number: s.number!,
      title,
      subtitle,
      lead,
      subsections,
      pullQuote,
    };

    // Pillar chapter affirmations
    if (s.number === 5 || s.number === 6 || s.number === 7) {
      const affirmSection = subsections.find((sec) =>
        /your\s+\d+\s+\w+\s+affirmations?/i.test(sec.heading) ||
        /^affirmations?/i.test(sec.heading),
      );
      if (affirmSection) {
        const list = extractNumberedList(affirmSection);
        if (list.length > 0) result.affirmations = list;
      }
    }

    // Chapter 10 mantras
    if (s.number === 10) {
      const mantras = extractMantras(subsections);
      if (mantras) result.mantras = mantras;
    }

    // Chapter 12 monthly forecast
    if (s.number === 12) {
      const forecast = extractMonthlyForecast(s.body);
      if (forecast.length > 0) result.monthlyForecast = forecast;
    }

    return result;
  });

  // Sort by number (just in case the AI emits out of order)
  chapters.sort((a, b) => a.number - b.number);

  return {
    welcome: welcome
      ? { title: welcome.title, body: welcome.body }
      : { title: "Welcome", body: "" },
    chapters,
    closing: closing
      ? { title: closing.title, body: closing.body }
      : { title: "A Love Letter from the Universe", body: "" },
  };
}
