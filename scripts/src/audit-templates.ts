/**
 * Audit AcroForm field positions in every `*-editable.pdf` template.
 *
 * For each template:
 *   1. Render an annotated copy with every form field's rectangle outlined in
 *      red and labelled. Saved to `test-output/audit/audit-<template>.pdf`.
 *      Open it next to the original template to visually spot misalignments
 *      (places where the field rect doesn't sit over the visible `{{...}}`
 *      placeholder).
 *
 *   2. Run a sanity check against typical position conventions and warn if a
 *      field is in an obviously wrong place — e.g. `PAGE_NUMBER` not at the
 *      bottom strip, or `CHAPTER_TITLE` not in the top-of-page header band.
 *
 * Run:  pnpm --filter @workspace/scripts run audit-templates
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "artifacts",
  "book-templates",
);
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test-output",
  "audit",
);

interface FieldRect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Convention bands: `(template, field)` → expected y range. If a field's y
// falls outside its expected band, flag it. Bands are loose — they catch
// catastrophic misplacements (PAGE_NUMBER in middle of page) without
// nitpicking small offsets.
//
// "*" matches any template. Specific template overrides the wildcard.
const PAGE_HEIGHT = 666;
const BANDS: Record<string, Record<string, [number, number]>> = {
  "*": {
    PAGE_NUMBER:        [0,    80],     // bottom strip
    READER_FIRST_NAME:  [560,  PAGE_HEIGHT], // top header (overridden per template)
    CHAPTER_TITLE:      [560,  PAGE_HEIGHT], // top header
    PART_NUM_1:         [560,  PAGE_HEIGHT], // top header
  },
  "01-chapter-opener-editable.pdf": {
    PAGE_NUMBER:        [0,    80],
    CH_NUM:             [200,  500],
    CHAPTER_TITLE:      [200,  500],     // centered, not header
    CHAPTER_SUBTITLE:   [200,  500],
  },
  "welcome-letter-editable.pdf": {
    READER_FIRST_NAME:  [320,  PAGE_HEIGHT], // in body, not header
  },
  "closing-letter-editable.pdf": {
    READER_FIRST_NAME:  [400,  PAGE_HEIGHT],
  },
  "05-affirmations-editable.pdf": {
    // READER_FIRST_NAME sits below the affirmation text on this layout
    // ("For {{READER_FIRST_NAME}} · {{PLACEMENT_REFERENCE}}"), not at the
    // top header. Same for PLACEMENT_REFERENCE.
    READER_FIRST_NAME:   [380, 480],
    PLACEMENT_REFERENCE: [380, 480],
  },
  "06-section-divider-editable.pdf": {
    PART_NUM_1:         [560,  PAGE_HEIGHT], // header strip
    // PART_NUM_2 may be header-right (current layout) OR a center callout.
    // Accept either.
    PART_NUM_2:         [200,  PAGE_HEIGHT],
    PART_TITLE:         [200,  450],
    PART_TAGLINE:       [200,  450],
    PAGE_NUMBER:        [0,    80],
  },
  // Hardcover / wrap covers are a different layout entirely (spine + back).
  // Disable convention checks by giving every field a full-page band.
  "00-hardcover-editable.pdf": {
    READER_FIRST_NAME: [0, PAGE_HEIGHT],
  },
};

const SKIP_FILES = new Set<string>([
  "00-hardcover-editable.pdf", // cover spread, different dimensions/layout
]);

function expectedBand(file: string, field: string): [number, number] | null {
  return BANDS[file]?.[field] ?? BANDS["*"]?.[field] ?? null;
}

async function getFields(pdfBytes: Uint8Array): Promise<FieldRect[]> {
  const pdf = await PDFDocument.load(pdfBytes);
  const out: FieldRect[] = [];
  for (const field of pdf.getForm().getFields()) {
    const name = field.getName();
    for (const w of field.acroField.getWidgets()) {
      const r = w.getRectangle();
      out.push({ name, x: r.x, y: r.y, w: r.width, h: r.height });
    }
  }
  return out;
}

async function annotate(pdfBytes: Uint8Array, fields: FieldRect[]): Promise<Buffer> {
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.getPages()[0]!;
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const f of fields) {
    page.drawRectangle({
      x: f.x, y: f.y, width: f.w, height: f.h,
      borderColor: rgb(1, 0, 0),
      borderWidth: 1,
      opacity: 0,
      borderOpacity: 0.9,
    });
    const labelY = f.y + f.h + 2 > 660 ? f.y - 9 : f.y + f.h + 2;
    page.drawText(f.name, {
      x: f.x, y: labelY, size: 7, font, color: rgb(0.9, 0, 0),
    });
    page.drawCircle({ x: f.x, y: f.y + f.h, size: 1.5, color: rgb(1, 0, 0) });
  }

  for (const fld of pdf.getForm().getFields()) {
    try { pdf.getForm().removeField(fld); } catch {}
  }

  // Skip auto-appearance update — some templates have malformed field
  // appearance dictionaries that crash that pass. We've removed the widgets
  // anyway, so there's nothing left for the appearance update to act on.
  const bytes = await pdf.save({ updateFieldAppearances: false });
  return Buffer.from(bytes);
}

interface Issue {
  template: string;
  field: string;
  y: number;
  expected: [number, number];
  severity: "WARN" | "FAIL";
}

function checkConventions(file: string, fields: FieldRect[]): Issue[] {
  const issues: Issue[] = [];
  for (const f of fields) {
    const band = expectedBand(file, f.name);
    if (!band) continue;
    const [lo, hi] = band;
    if (f.y < lo || f.y > hi) {
      const offBy = Math.min(Math.abs(f.y - lo), Math.abs(f.y - hi));
      issues.push({
        template: file,
        field: f.name,
        y: f.y,
        expected: band,
        severity: offBy > 40 ? "FAIL" : "WARN",
      });
    }
  }
  return issues;
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(TEMPLATES_DIR))
    .filter((f) => f.endsWith("-editable.pdf"))
    .filter((f) => !SKIP_FILES.has(f))
    .sort();

  console.log(`\nAuditing ${files.length} editable template${files.length === 1 ? "" : "s"}...\n`);

  let totalIssues = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await fs.readFile(path.join(TEMPLATES_DIR, file)));
    const fields = await getFields(bytes);

    console.log(`📄 ${file}  —  ${fields.length} field${fields.length === 1 ? "" : "s"}`);
    const issues = checkConventions(file, fields);
    if (issues.length === 0) {
      console.log(`   ✓ no convention violations`);
    } else {
      for (const issue of issues) {
        const mark = issue.severity === "FAIL" ? "❌ FAIL" : "⚠️  WARN";
        console.log(
          `   ${mark}  ${issue.field}  at y=${issue.y.toFixed(0)}  ` +
            `(expected y in [${issue.expected[0]}, ${issue.expected[1]}])`,
        );
      }
      totalIssues += issues.length;
    }

    const annotated = await annotate(bytes, fields);
    const outPath = path.join(OUT_DIR, `audit-${file}`);
    await fs.writeFile(outPath, annotated);
  }

  console.log(`\nAnnotated PDFs written to: ${OUT_DIR}`);
  console.log(`Total convention issues: ${totalIssues}`);
  if (totalIssues > 0) {
    console.log(`\nOpen each \`audit-*.pdf\` next to its template in Preview. The red rectangles`);
    console.log(`mark the AcroForm field positions. If a red rectangle does NOT sit on top of`);
    console.log(`the visible \`{{NAME}}\` placeholder text, that field is misaligned and needs`);
    console.log(`to be redone in Claude.ai.`);
  }
}

await main();
