/**
 * One-shot extractor that walks every page-type template in
 * `artifacts/book-templates/`, finds every `{{PLACEHOLDER}}` token, captures
 * its bounding box + font size, and writes the result back into
 * `artifacts/book-templates/manifest.json` under each entry's `slots` block.
 *
 * Run with:  pnpm --filter @workspace/scripts run extract-template-slots
 *
 * The manifest is the single source of truth the eventual render pipeline
 * (in artifacts/api-server/src/routes/zodiac-orders/pdfGenerator.ts) will
 * consume to know where each personalized field gets drawn.
 *
 * Coordinate system: PDF user space — origin at the BOTTOM-LEFT of the page,
 * y grows upward, units are points (1/72 in). Page is 450 × 666 pt.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontName: string;
}

type SlotsBlock = Record<string, Slot | Slot[]>;

interface ManifestPageType {
  file: string;
  purpose: string;
  facing: string;
  placeholders: string[];
  $note?: string;
  slots?: SlotsBlock;
}

interface Manifest {
  pageTypes: Record<string, ManifestPageType>;
  [key: string]: unknown;
}

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "artifacts",
  "book-templates",
);
const MANIFEST_PATH = path.join(TEMPLATES_DIR, "manifest.json");
// Tolerant of letter-spaced placeholders: designers sometimes apply tracking
// to {{NAME}} tokens for visual effect, which makes pdfjs return the text run
// as e.g. `{ { W E L C O M E _ F O O T E R } }`. We normalize by stripping
// all whitespace before matching, so both spaced and unspaced forms work.
const PLACEHOLDER_RE = /^\{\{([A-Z_]+(?:_\d+)?)\}\}$/;
function matchPlaceholder(raw: string): string | null {
  const normalized = raw.replace(/\s+/g, "");
  const m = PLACEHOLDER_RE.exec(normalized);
  return m ? m[1]! : null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// Multi-occurrence placeholders the renderer accesses as an array
// (`getSlots("BODY_PARAGRAPH")` → all 3 in 02-standard-body). Fields named
// `BODY_PARAGRAPH_1`, `_2`, `_3` get folded under the bare `BODY_PARAGRAPH`
// key, sorted by their numeric suffix. Anything not in this set (BULLET_1,
// WELCOME_BODY_PARAGRAPH_1, etc.) keeps its full name as a unique slot key.
const ARRAY_GROUPED_BASES = new Set([
  "BODY_PARAGRAPH",
  "SUBSECTION_HEADING",
  "ELEMENT",
  "KEYWORDS",
  "INTERPRETATION_BODY",
  "PART_NUM",
]);

/** Translate an AcroForm field rectangle (origin bottom-left, y = bottom of
 *  rect) into a slot whose `y` is the baseline of the first text line drawn
 *  inside the rect. The renderer treats slot.y as the baseline directly. */
function rectToSlot(rect: { x: number; y: number; width: number; height: number }): Slot {
  // Place first-line baseline near top of rect for multi-line fields, or
  // slightly above bottom for single-line fields. Clamped to keep tiny fields
  // (e.g. page-number band ~10pt tall) from drawing below their own rect.
  const baselineFromBottom = Math.max(rect.height - 12, 4);
  return {
    x: round(rect.x),
    y: round(rect.y + baselineFromBottom),
    w: round(rect.width),
    h: round(rect.height),
    fontSize: 11,
    fontName: "acro-field",
  };
}

async function extractFromFormFields(filePath: string): Promise<SlotsBlock | null> {
  const buf = await fs.readFile(filePath);
  // Lazy import pdf-lib to avoid loading it for templates without forms.
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(buf);
  const fields = pdf.getForm().getFields();
  if (fields.length === 0) return null;

  // Collect every widget rect (a field can have multiple widgets, though
  // designers usually use one widget per field).
  type Entry = { fullName: string; slot: Slot };
  const entries: Entry[] = [];
  for (const field of fields) {
    const fullName = field.getName();
    const widgets = field.acroField.getWidgets();
    for (const w of widgets) {
      const r = w.getRectangle();
      entries.push({ fullName, slot: rectToSlot(r) });
    }
  }

  // Group by base name when the suffix is numeric AND the base is in our
  // array-grouped set. Sort grouped slots by suffix index (1, 2, 3…).
  const grouped: Record<string, { idx: number; slot: Slot }[]> = {};
  const individual: Record<string, Slot> = {};
  for (const { fullName, slot } of entries) {
    const m = /^([A-Z_]+?)_(\d+)$/.exec(fullName);
    if (m && ARRAY_GROUPED_BASES.has(m[1]!)) {
      (grouped[m[1]!] ??= []).push({ idx: parseInt(m[2]!, 10), slot });
    } else {
      individual[fullName] = slot;
    }
  }

  const out: SlotsBlock = { ...individual };
  for (const [base, list] of Object.entries(grouped)) {
    list.sort((a, b) => a.idx - b.idx);
    out[base] = list.length === 1 ? list[0]!.slot : list.map((x) => x.slot);
  }
  return out;
}

async function extractSlotsFromPdf(filePath: string): Promise<SlotsBlock> {
  // Priority: if the template has AcroForm fields (designer-marked positions),
  // use them. They're explicit, exact, and survive font outlining.
  const fromForm = await extractFromFormFields(filePath);
  if (fromForm) return fromForm;

  // Fallback: parse selectable {{NAME}} text out of the page's text content.
  // Works on templates where the designer kept text as text on export.
  const buf = await fs.readFile(filePath);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
  }).promise;

  const slots: Record<string, Slot[]> = {};

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = raw as { str: string; transform: number[]; width: number; height: number; fontName: string };
      const trimmed = item.str.trim();
      const name = matchPlaceholder(trimmed);
      if (!name) {
        if (/^\s*\{\s*\{[^}]*$/.test(trimmed) || /^[^{]*\}\s*\}\s*$/.test(trimmed)) {
          console.warn(`  ⚠ partial placeholder candidate: ${JSON.stringify(trimmed)}`);
        }
        continue;
      }
      const slot: Slot = {
        x: round(item.transform[4]!),
        y: round(item.transform[5]!),
        w: round(item.width),
        h: round(item.height),
        fontSize: round(item.transform[0]!),
        fontName: item.fontName,
      };
      (slots[name] ??= []).push(slot);
    }
  }

  const out: SlotsBlock = {};
  for (const [name, list] of Object.entries(slots)) {
    out[name] = list.length === 1 ? list[0]! : list;
  }
  return out;
}

async function main(): Promise<void> {
  const manifestRaw = await fs.readFile(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(manifestRaw) as Manifest;

  const summary: { template: string; placeholders: string[]; missing: string[] }[] = [];

  for (const [key, entry] of Object.entries(manifest.pageTypes)) {
    const filePath = path.join(TEMPLATES_DIR, entry.file);
    const slots = await extractSlotsFromPdf(filePath);
    // Preserve existing slots when nothing was extracted — usually means the
    // PDF was exported with "convert text to outlines" on, so the placeholders
    // are now vector paths instead of text. Nuking the previously-good slots
    // would break rendering until the designer re-exports.
    if (Object.keys(slots).length === 0 && entry.slots && Object.keys(entry.slots).length > 0) {
      summary.push({
        template: `${key} (${entry.file})`,
        placeholders: [],
        missing: ["⚠ no selectable text — kept previous slots (designer may have outlined text on export)"],
      });
      continue;
    }
    entry.slots = slots;

    const found = new Set(Object.keys(slots));
    const declared = new Set(entry.placeholders);
    const missing = [...declared].filter((p) => !found.has(p));
    const extra = [...found].filter((p) => !declared.has(p));
    summary.push({
      template: `${key} (${entry.file})`,
      placeholders: [...found],
      missing: [...missing, ...extra.map((p) => `+${p}`)],
    });
  }

  // Pretty-print so the diff is readable in git.
  const output = JSON.stringify(manifest, null, 2) + "\n";
  await fs.writeFile(MANIFEST_PATH, output);

  // Console report
  console.log("Extracted slots from " + Object.keys(manifest.pageTypes).length + " templates:\n");
  for (const row of summary) {
    console.log(`  ${row.template}`);
    console.log(`    found: ${row.placeholders.sort().join(", ")}`);
    if (row.missing.length > 0) {
      console.log(`    DRIFT vs declared placeholders: ${row.missing.join(", ")}`);
    }
  }
  console.log("\nWrote " + MANIFEST_PATH);
}

await main();
