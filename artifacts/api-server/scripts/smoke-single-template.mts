/**
 * Render a single template page with sample data — useful for iterating on
 * one template at a time without regenerating the full 49-page book.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run smoke-template -- section-divider
 *   pnpm --filter @workspace/api-server run smoke-template -- chapter-opener
 *   pnpm --filter @workspace/api-server run smoke-template -- standard-body
 *   ...etc
 *
 * Valid template IDs:
 *   chapter-opener, standard-body, standard-body-with-quotes,
 *   data-numerology, affirmations, section-divider, body-continued,
 *   welcome-letter, closing-letter
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSingleTemplate, type SingleTemplateId } from "../src/routes/zodiac-orders/templatedPdf/index.ts";

const VALID_IDS: SingleTemplateId[] = [
  "chapter-opener",
  "standard-body",
  "standard-body-with-quotes",
  "data-numerology",
  "affirmations",
  "section-divider",
  "body-continued",
  "welcome-letter",
  "closing-letter",
  "body-stress",
];

const args = process.argv.slice(2).filter((a) => a !== "--");
const id = args[0] as SingleTemplateId | undefined;
if (!id || !VALID_IDS.includes(id)) {
  console.error("Usage: pnpm --filter @workspace/api-server run smoke-template -- <id>");
  console.error("Valid IDs:");
  for (const v of VALID_IDS) console.error("  " + v);
  process.exit(2);
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-output");
await fs.mkdir(OUT_DIR, { recursive: true });

const t0 = Date.now();
const pdf = await renderSingleTemplate(id);
const elapsed = Date.now() - t0;
const out = path.join(OUT_DIR, `test-${id}.pdf`);
await fs.writeFile(out, pdf);
console.log(`Wrote ${out} (${(pdf.length / 1024).toFixed(1)} KB, ${elapsed} ms)`);
process.exit(0);
