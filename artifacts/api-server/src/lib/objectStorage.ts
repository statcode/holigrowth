/**
 * Filesystem-backed storage. Writes uploads to UPLOADS_DIR (default:
 * `artifacts/uploads/` at the repo root — user-data, not code) and stores each
 * upload's content type in a sibling `.meta.json` file.
 *
 * Object paths use the form `/objects/uploads/<id>` to keep a stable URL shape
 * that the frontend can serve from `GET /api/storage/objects/*`.
 */
import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import type { Readable } from "stream";

// Anchor to this module's location so the path is stable regardless of the
// process cwd. Bundled output lives at `artifacts/api-server/dist/index.mjs`,
// so `../../uploads` lands at `artifacts/uploads/`.
const DEFAULT_UPLOADS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
);
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : DEFAULT_UPLOADS_DIR;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export class LocalUploadNotFoundError extends Error {
  constructor() {
    super("Local upload not found");
    this.name = "LocalUploadNotFoundError";
    Object.setPrototypeOf(this, LocalUploadNotFoundError.prototype);
  }
}

export function newLocalUploadId(): string {
  return randomUUID();
}

export function localObjectPath(id: string): string {
  return `/objects/uploads/${id}`;
}

export function localUploadIdFromObjectPath(objectPath: string): string {
  const match = /^\/?objects\/uploads\/([^/]+)\/?$/.exec(objectPath);
  if (!match) throw new LocalUploadNotFoundError();
  return match[1];
}

function resolveUploadPath(id: string): string {
  if (!ID_PATTERN.test(id)) throw new LocalUploadNotFoundError();
  return path.join(UPLOADS_DIR, id);
}

async function writeMeta(filePath: string, contentType: string): Promise<void> {
  await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }));
}

export async function writeLocalUploadStream(
  id: string,
  body: Readable,
  contentType: string,
): Promise<void> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filePath = resolveUploadPath(id);

  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(filePath);
    body.on("error", reject);
    ws.on("error", reject);
    ws.on("finish", () => resolve());
    body.pipe(ws);
  });

  await writeMeta(filePath, contentType);
}

export async function saveLocalUploadBuffer(
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const id = newLocalUploadId();
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filePath = resolveUploadPath(id);
  await fs.writeFile(filePath, buffer);
  await writeMeta(filePath, contentType);
  return localObjectPath(id);
}

export async function readLocalUploadStream(
  id: string,
): Promise<{ stream: Readable; size: number; contentType: string }> {
  const filePath = resolveUploadPath(id);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    throw new LocalUploadNotFoundError();
  }

  let contentType = "application/octet-stream";
  try {
    const raw = await fs.readFile(`${filePath}.meta.json`, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.contentType === "string") contentType = parsed.contentType;
  } catch {
    // sidecar missing — fall back to default content type
  }

  return { stream: createReadStream(filePath), size: stat.size, contentType };
}

export async function deleteLocalUpload(objectPath: string | null | undefined): Promise<void> {
  if (!objectPath) return;
  let id: string;
  try {
    id = localUploadIdFromObjectPath(objectPath);
  } catch {
    return;
  }
  const filePath = resolveUploadPath(id);
  await fs.rm(filePath, { force: true });
  await fs.rm(`${filePath}.meta.json`, { force: true });
}

export async function readLocalUploadWithMeta(
  objectPath: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const id = localUploadIdFromObjectPath(objectPath);
  const filePath = resolveUploadPath(id);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    throw new LocalUploadNotFoundError();
  }

  let contentType = "application/octet-stream";
  try {
    const raw = await fs.readFile(`${filePath}.meta.json`, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.contentType === "string") contentType = parsed.contentType;
  } catch {
    // sidecar missing — fall back to default content type
  }

  return { buffer, contentType };
}

/**
 * Return a read stream for the first N pages of an interior PDF, sliced on
 * demand and cached to disk at `<uuid>.preview.pdf`. Used by the storage
 * route to gate the full book behind payment — a determined unpaid customer
 * can inspect the PDF bytes in DevTools and see everything past the client-
 * side lock overlay, so we ALSO enforce the gate here at the source.
 *
 * The cache key is the source UUID alone. If the source PDF is regenerated
 * (new UUID), the preview file for the old UUID is orphaned but harmless.
 * Regenerating with the same UUID (would require deleting + reusing) would
 * serve a stale preview — we don't do that anywhere, but noting it.
 */
export async function readInteriorPreviewStream(
  id: string,
  pageCount = 5,
): Promise<{ stream: Readable; size: number; contentType: string }> {
  if (!ID_PATTERN.test(id)) throw new LocalUploadNotFoundError();
  const fullPath = path.join(UPLOADS_DIR, id);
  const previewPath = `${fullPath}.preview.pdf`;

  // If the cached preview already exists and is at least as new as the
  // source, serve it. Otherwise (re)build.
  let previewStat;
  try {
    previewStat = await fs.stat(previewPath);
    const srcStat = await fs.stat(fullPath);
    if (previewStat.mtimeMs < srcStat.mtimeMs) previewStat = null;
  } catch {
    previewStat = null;
  }

  if (!previewStat) {
    let srcBuffer: Buffer;
    try {
      srcBuffer = await fs.readFile(fullPath);
    } catch {
      throw new LocalUploadNotFoundError();
    }
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.load(srcBuffer);
    const dst = await PDFDocument.create();
    const take = Math.min(pageCount, src.getPageCount());
    const copied = await dst.copyPages(src, Array.from({ length: take }, (_, i) => i));
    for (const page of copied) dst.addPage(page);
    const bytes = await dst.save();
    await fs.writeFile(previewPath, bytes);
    previewStat = await fs.stat(previewPath);
  }

  return {
    stream: createReadStream(previewPath),
    size: previewStat.size,
    contentType: "application/pdf",
  };
}
