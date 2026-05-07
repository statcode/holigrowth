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
const PLACEHOLDER_RE = /^\{\{([A-Z_]+(?:_\d+)?)\}\}$/;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

async function extractSlotsFromPdf(filePath: string): Promise<SlotsBlock> {
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
      const m = PLACEHOLDER_RE.exec(item.str.trim());
      if (!m) continue;
      const name = m[1]!;
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

  // Collapse single-occurrence arrays into bare objects to keep the manifest tidy.
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
