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

import { promises as fs } from "node:fs";
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
  | "body-continued";

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

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "book-templates",
);

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

/** Extract the first markdown blockquote from a body string, or null. */
function extractPullQuote(body: string, fallbackLead: string): string | null {
  const blockquote = /^>\s+(.+?)$/m.exec(body);
  if (blockquote && blockquote[1]) return blockquote[1].trim();
  // Heuristic: the last sentence of the lead paragraph, if reasonably short.
  const sentences = fallbackLead.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.length > 20 && s.length < 220);
  if (sentences.length === 0) return null;
  return sentences[sentences.length - 1]!.trim();
}

/** Split a chapter body into lead + subsections. */
function parseChapterBody(body: string): { lead: string; subsections: ParsedSubsection[] } {
  // Split on `##` (with leading newline) — also tolerate `### ` for subsections.
  const parts = body.split(/\n(?=#{2,3}\s+)/);
  const leadBlock = parts.shift() ?? "";
  const lead = leadBlock.trim().split(/\n\n+/)[0]?.trim() ?? "";
  const subsections: ParsedSubsection[] = parts
    .map((part) => {
      const lines = part.split("\n");
      const headingLine = lines.shift() ?? "";
      const heading = headingLine.replace(/^#{2,3}\s+/, "").trim();
      const rest = lines.join("\n").trim();
      const paragraphs = rest
        .split(/\n\n+/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      return { heading, paragraphs };
    })
    .filter((s) => s.heading.length > 0);
  return { lead, subsections };
}

/** Pull a numbered list (`1. ...` through `10. ...`) out of a subsection's paragraphs. */
function extractNumberedList(subsection: ParsedSubsection): string[] {
  const out: string[] = [];
  const text = subsection.paragraphs.join("\n");
  const re = /^\s*(\d{1,2})\.\s+(.+?)(?=\n\s*\d{1,2}\.\s|\n\n|$)/gms;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[2]!.replace(/\s+/g, " ").trim());
  }
  return out;
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
    .map((line) => line.replace(/^\s*[-•*]\s+/, "").trim());
  if (bullets.length > 0) return bullets;
  return s.paragraphs;
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
const HEADING_RE = /^#{1,2}\s+(.+)$/gm;

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
