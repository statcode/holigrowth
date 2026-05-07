/**
 * Smoke test for the templated PDF renderer.
 *
 * Picks the most recent order in MAMP MySQL that has generated content,
 * runs it through the new template-based pipeline, and writes the result
 * to <repo>/test-output/test-templated.pdf for visual inspection.
 *
 * Run:  pnpm --filter @workspace/api-server run smoke-pdf
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, zodiacOrdersTable, desc, isNotNull } from "@workspace/db";
import { generateTemplatedInteriorPDF } from "../src/routes/zodiac-orders/templatedPdf/index.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-output");

const [order] = await db
  .select()
  .from(zodiacOrdersTable)
  .where(isNotNull(zodiacOrdersTable.generatedContent))
  .orderBy(desc(zodiacOrdersTable.createdAt))
  .limit(1);

const content = order?.generatedContent;
if (!order || !content) {
  console.error("No order with generated content found.");
  process.exit(1);
}

console.log(`Order #${order.id} (${order.fullName}, ${order.sunSign}); content ${content.length} chars`);
const t0 = Date.now();
const pdf = await generateTemplatedInteriorPDF(order, content);
const ms = Date.now() - t0;

await fs.mkdir(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, "test-templated.pdf");
await fs.writeFile(out, pdf);
console.log(`Wrote ${out} (${(pdf.length / 1024).toFixed(1)} KB, ${ms} ms)`);
process.exit(0);
