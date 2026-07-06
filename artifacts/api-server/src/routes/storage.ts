import { Router, type IRouter, type Request, type Response } from "express";
import { db, zodiacOrdersTable, like } from "@workspace/db";
import {
  readLocalUploadStream,
  readInteriorPreviewStream,
  LocalUploadNotFoundError,
} from "../lib/objectStorage";

const router: IRouter = Router();

/**
 * Number of pages of an interior PDF that we're willing to serve to unpaid
 * customers. Matches the client-side `UNLOCK_THRESHOLD` in preview.tsx —
 * changing one requires changing the other so both gates stay in sync.
 */
const PREVIEW_PAGE_COUNT = 5;

/**
 * Look up which order (if any) references this UUID as its interior PDF. We
 * ONLY care about interior matches — cover PDFs are cover artwork and don't
 * contain paid content. If the UUID doesn't match any interior_pdf_url we
 * treat it as unclaimed and serve as-is.
 *
 * Uses a LIKE %uuid% match because interior_pdf_url is stored as an absolute
 * URL (with PUBLIC_BASE_URL prefix), not the bare UUID. Runs one query per
 * storage GET — fine for our volume, would want an indexed column at scale.
 */
async function findOwningOrderForInterior(uuid: string): Promise<
  | { orderId: number; isPaid: boolean }
  | null
> {
  const rows = await db
    .select({
      id: zodiacOrdersTable.id,
      status: zodiacOrdersTable.status,
      stripePaymentIntentId: zodiacOrdersTable.stripePaymentIntentId,
      interiorPdfUrl: zodiacOrdersTable.interiorPdfUrl,
    })
    .from(zodiacOrdersTable)
    .where(like(zodiacOrdersTable.interiorPdfUrl, `%${uuid}%`))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Payment signals: stripePaymentIntentId is set by the checkout.session.
  // completed webhook. Post-Lulu-submit states (processing/shipped/submitting)
  // require prior payment, so treat them as paid too. Mirrors preview.tsx.
  const isPaid =
    Boolean(row.stripePaymentIntentId) ||
    row.status === "processing" ||
    row.status === "shipped" ||
    row.status === "submitting";
  return { orderId: row.id, isPaid };
}

/**
 * GET /storage/objects/uploads/:id
 *
 * Serve a previously stored object (PDF, image, etc.). Wildcard form preserved
 * for URL compatibility, but only `uploads/<id>` is a valid shape.
 *
 * Payment gate for interior PDFs: if the UUID belongs to an interior_pdf_url
 * on an unpaid order, we return the first N pages only (sliced on demand,
 * cached to disk). Any other request — cover PDFs, orphaned UUIDs, paid
 * orders — passes straight through.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

  const match = /^uploads\/([^/]+)$/.exec(wildcardPath);
  if (!match) {
    res.status(404).json({ error: "Object not found" });
    return;
  }
  const uuid = match[1]!;

  try {
    let owner: { orderId: number; isPaid: boolean } | null = null;
    try {
      owner = await findOwningOrderForInterior(uuid);
    } catch (err) {
      // DB hiccup — fall back to serving the file. Reasoning: this route
      // serves cover PDFs, images, and other harmless assets too. Failing
      // closed on every request during a DB blip would break the site.
      req.log.warn({ err, uuid }, "storage: DB lookup for owning order failed");
    }

    const shouldGatePreview = owner !== null && !owner.isPaid;
    const { stream, size, contentType } = shouldGatePreview
      ? await readInteriorPreviewStream(uuid, PREVIEW_PAGE_COUNT)
      : await readLocalUploadStream(uuid);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(size));
    res.setHeader("Cache-Control", "private, max-age=3600");
    stream.on("error", (err) => {
      req.log.error({ err }, "Error streaming local upload");
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof LocalUploadNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error reading local upload");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
