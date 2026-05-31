/**
 * Generate marketing images for the homepage from the actual book templates.
 *
 * Outputs PNGs into `artifacts/zodiac-book/public/images/`:
 *   - book-cover-mockup.png         — front cover cropped out of the 14×10.75" wrap
 *   - book-interior-opener.png      — chapter-opener with mock chapter data filled in
 *   - book-interior-body.png        — standard-body with mock prose
 *   - book-interior-affirmation.png — affirmations page with 5 mock affirmations
 *   - book-interior-numerology.png  — data-numerology card with mock Life Path data
 *
 * Strategy:
 *   - Cover: pdf-lib embeds the hardcover wrap into a fresh 6.125×9.25" PDF
 *     so only the right-hand front-cover region (with outer bleed) is visible.
 *     The page is intentionally rendered with the template's bare widget
 *     placeholders ("BORN", "IN", "A PERSONALIZED ALMANAC", …) showing —
 *     this matches the customer-facing marketing mockup (book before the
 *     customer fills in their info).
 *   - Interiors: shells out to `@workspace/api-server`'s `smoke-template` runner,
 *     which uses the production renderer (fills mock content into each
 *     template via the same code path real orders use). Each generated PDF
 *     lives in `test-output/test-<id>.pdf`.
 *   - `sips` rasterizes each PDF → PNG (only image tool on every dev mac).
 *
 * Run with:  pnpm --filter @workspace/scripts run generate-marketing-images
 */
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATES_DIR = path.join(REPO_ROOT, "artifacts", "book-templates");
const OUT_DIR = path.join(REPO_ROOT, "artifacts", "zodiac-book", "public", "images");
const TMP_DIR = path.join(REPO_ROOT, "test-output", "marketing-tmp");
const SMOKE_OUT_DIR = path.join(REPO_ROOT, "test-output");
const API_SERVER_DIR = path.join(REPO_ROOT, "artifacts", "api-server");

// Hardcover wrap geometry — see artifacts/book-templates/README.md →
// "Hardcover wrap" for the print spec. Front cover is the right-hand 6"
// trim block; we add the 0.125" outer bleed on the right + top + bottom so
// the rasterised image includes the artwork's bleed area (no awkward white
// edge in marketing screenshots). The inner edge (toward the spine) is
// trimmed cleanly so the cover doesn't include the spine band.
const PT = 72;
const FRONT_TRIM_W_IN = 6;
const FRONT_TRIM_H_IN = 9;
const BLEED_IN = 0.125;
const WRAP_IN = 0.625;
const SPINE_IN = 0.5; // baked into 00-hardcover-editable.pdf — see README

const FRONT_X_IN = BLEED_IN + WRAP_IN + FRONT_TRIM_W_IN + SPINE_IN; // 7.25
const FRONT_Y_IN = BLEED_IN + WRAP_IN;                              // 0.75 (from bottom)
const FRONT_OUT_W_IN = FRONT_TRIM_W_IN + BLEED_IN;                  // include outer bleed: 6.125
const FRONT_OUT_H_IN = FRONT_TRIM_H_IN + BLEED_IN * 2;              // include top+bottom bleed: 9.25
const FRONT_OUT_Y_IN = FRONT_Y_IN - BLEED_IN;                       // 0.625

/** Build a single-page front-cover PDF by embedding the hardcover wrap shifted
 *  so only the right-hand front-cover region (with outer bleed) is visible. */
async function buildFrontCoverPdf(srcPath: string, dstPath: string): Promise<void> {
  const srcBytes = await fs.readFile(srcPath);
  const out = await PDFDocument.create();
  const srcDoc = await PDFDocument.load(srcBytes);
  const [embedded] = await out.embedPdf(srcDoc, [0]);
  if (!embedded) throw new Error("Failed to embed hardcover template");

  const pageW = FRONT_OUT_W_IN * PT;
  const pageH = FRONT_OUT_H_IN * PT;
  const page = out.addPage([pageW, pageH]);

  // Draw the wrap at full size, then translate so the front-cover region
  // aligns with the new page's origin. embedded.width / .height are the
  // wrap's native dimensions in pt (1008 × 774).
  page.drawPage(embedded, {
    x: -FRONT_X_IN * PT,
    y: -FRONT_OUT_Y_IN * PT,
    width: embedded.width,
    height: embedded.height,
  });

  const bytes = await out.save();
  await fs.writeFile(dstPath, bytes);
}

/** Convert a PDF to a PNG with `sips`. `heightPx` controls the output
 *  resolution; sips preserves aspect ratio. */
function pdfToPng(pdfPath: string, pngPath: string, heightPx: number): void {
  const res = spawnSync(
    "/usr/bin/sips",
    ["-s", "format", "png", "--resampleHeight", String(heightPx), pdfPath, "--out", pngPath],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(`sips failed for ${pdfPath}: ${res.stderr || res.stdout}`);
  }
}

/** Render one interior page by shelling out to the api-server smoke runner.
 *  This reuses the production renderer (mock data + production code path)
 *  so the marketing image matches what real orders look like. */
function smokeTemplate(id: string): string {
  const res = spawnSync(
    "pnpm",
    ["run", "smoke-template", id],
    { encoding: "utf8", cwd: API_SERVER_DIR },
  );
  if (res.status !== 0) {
    throw new Error(`smoke-template ${id} failed: ${res.stderr || res.stdout}`);
  }
  return path.join(SMOKE_OUT_DIR, `test-${id}.pdf`);
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });

  // ── Front cover ──────────────────────────────────────────────────────────
  const wrapPath = path.join(TEMPLATES_DIR, "00-hardcover-editable.pdf");
  const frontPdfPath = path.join(TMP_DIR, "front-cover.pdf");
  await buildFrontCoverPdf(wrapPath, frontPdfPath);
  pdfToPng(frontPdfPath, path.join(OUT_DIR, "book-cover-mockup.png"), 1600);
  console.log("✓ book-cover-mockup.png       (front cover cropped from hardcover wrap)");

  // ── Interior pages ──────────────────────────────────────────────────────
  // Render each via the production smoke runner so the marketing image
  // shows realistic content (mock customer data, real prose).
  const interiors: { id: string; out: string }[] = [
    { id: "natal-chart",      out: "book-interior-natal-chart.png" },
    { id: "chapter-opener",   out: "book-interior-opener.png" },
    { id: "standard-body",    out: "book-interior-body.png" },
    { id: "affirmations",     out: "book-interior-affirmation.png" },
    { id: "data-numerology",  out: "book-interior-numerology.png" },
    { id: "birthstone",       out: "book-interior-birthstone.png" },
  ];
  for (const i of interiors) {
    const pdfPath = smokeTemplate(i.id);
    pdfToPng(pdfPath, path.join(OUT_DIR, i.out), 1400);
    console.log(`✓ ${i.out.padEnd(31)} (${i.id} — via smoke-template)`);
  }

  console.log(`\nWrote ${1 + interiors.length} marketing images to ${OUT_DIR}`);
}

await main();
