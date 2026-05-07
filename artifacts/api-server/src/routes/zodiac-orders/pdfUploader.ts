/**
 * Persists a PDF buffer to local object storage and returns a public URL that
 * Lulu (and the user's browser) can fetch from the api-server.
 *
 * The URL is constructed from PUBLIC_BASE_URL — set this to a publicly-reachable
 * origin (e.g. https://holigrowth.com or an ngrok tunnel) when running against
 * the real Lulu API. In local-only flows it can be `http://localhost:8088`.
 */

import { saveLocalUploadBuffer } from "../../lib/objectStorage";
import { logger } from "../../lib/logger";

function getPublicBaseUrl(): string {
  const url = process.env.PUBLIC_BASE_URL;
  if (!url) {
    throw new Error(
      "PUBLIC_BASE_URL is not set. Add it to .env (e.g. http://localhost:8088 for dev, " +
        "or your public origin in production) so Lulu can fetch generated PDFs.",
    );
  }
  return url.replace(/\/$/, "");
}

export async function uploadPdf(
  pdfBuffer: Buffer,
  type: "interior" | "cover",
  orderId: number,
): Promise<string> {
  const baseUrl = getPublicBaseUrl();
  const objectPath = await saveLocalUploadBuffer(pdfBuffer, "application/pdf");
  const publicUrl = `${baseUrl}/api/storage${objectPath}`;
  logger.info({ orderId, type, objectPath, publicUrl }, "PDF stored locally");
  return publicUrl;
}
