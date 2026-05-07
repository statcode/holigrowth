import { createHmac, timingSafeEqual } from "crypto";
import { db, zodiacOrdersTable, eq } from "@workspace/db";
import { logger } from "./lib/logger";
import { sendShippedEmail } from "./routes/zodiac-orders/mailerlite";

// Lulu sends status change events as they move through production and shipping.
// Docs: https://api.lulu.com/#tag/Webhooks
//
// Event payload shape:
// {
//   data: {
//     print_job: {
//       id: number,
//       status: { name: string },
//       line_items: [{
//         external_id: string,        // = our orderId (set at print-job creation time)
//         tracking_id: string,
//         tracking_urls: string[],
//         estimated_shipping_dates: { ship: string[] }
//       }]
//     }
//   }
// }

interface LuluLineItem {
  id?: number;
  external_id?: string;
  tracking_id?: string;
  tracking_urls?: string[];
  estimated_shipping_dates?: { ship?: string[] };
}

interface LuluWebhookPayload {
  data?: {
    print_job?: {
      id?: number | string;
      status?: { name?: string };
      line_items?: LuluLineItem[];
    };
  };
}

// Map Lulu's status names to our internal status values
const LULU_TO_INTERNAL: Record<string, string> = {
  CREATED:              "processing",
  UNPAID:               "processing",
  PAYMENT_IN_PROGRESS:  "processing",
  PRODUCTION_READY:     "processing",
  IN_PRODUCTION:        "processing",
  SHIPPED:              "shipped",
  DELIVERED:            "delivered",
  REJECTED:             "failed",
};

function verifyLuluSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  // Lulu sends: X-Hub-Signature: sha256=<hex>
  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;
  const receivedHex = parts[1]!;

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Use timing-safe comparison
  try {
    return timingSafeEqual(Buffer.from(receivedHex), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function processLuluWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): Promise<void> {
  const secret = process.env.LULU_WEBHOOK_SECRET;

  // Verify signature when secret is configured
  if (secret) {
    if (!signatureHeader) {
      throw new Error("Missing X-Hub-Signature header");
    }
    if (!verifyLuluSignature(rawBody, signatureHeader, secret)) {
      throw new Error("Invalid Lulu webhook signature");
    }
  } else {
    logger.warn("LULU_WEBHOOK_SECRET not set — skipping signature verification");
  }

  let payload: LuluWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString()) as LuluWebhookPayload;
  } catch {
    throw new Error("Invalid JSON in Lulu webhook body");
  }

  const printJob = payload.data?.print_job;
  if (!printJob) {
    logger.info("Lulu webhook received with no print_job data — ignoring");
    return;
  }

  const luluOrderId = String(printJob.id ?? "");
  const luluStatusName = printJob.status?.name ?? "UNKNOWN";
  const lineItems = printJob.line_items ?? [];

  logger.info({ luluOrderId, luluStatusName }, "Processing Lulu webhook event");

  // Resolve our order ID:  prefer external_id on the first line item
  // (set as String(order.id) at print-job creation), fall back to DB lookup by luluOrderId
  let orderId: number | null = null;

  const firstLineItem = lineItems[0];
  if (firstLineItem?.external_id) {
    const parsed = parseInt(firstLineItem.external_id, 10);
    if (!isNaN(parsed)) orderId = parsed;
  }

  // If external_id wasn't set / parseable, find by luluOrderId column
  if (!orderId && luluOrderId) {
    const [found] = await db
      .select({ id: zodiacOrdersTable.id })
      .from(zodiacOrdersTable)
      .where(eq(zodiacOrdersTable.luluOrderId, luluOrderId));
    if (found) orderId = found.id;
  }

  if (!orderId) {
    logger.warn({ luluOrderId, luluStatusName }, "Lulu webhook: could not find matching order — ignoring");
    return;
  }

  // Resolve tracking details from first line item
  const trackingNumber = firstLineItem?.tracking_id ?? null;
  const trackingUrl    = firstLineItem?.tracking_urls?.[0] ?? null;
  const estimatedDelivery = firstLineItem?.estimated_shipping_dates?.ship?.[0] ?? null;

  const internalStatus = LULU_TO_INTERNAL[luluStatusName];

  // Build the update patch
  const patch: Partial<typeof zodiacOrdersTable.$inferSelect> = {
    luluStatus: luluStatusName,
    ...(internalStatus ? { status: internalStatus } : {}),
    ...(trackingNumber  ? { trackingNumber }   : {}),
    ...(trackingUrl     ? { trackingUrl }       : {}),
    ...(estimatedDelivery ? { estimatedDelivery } : {}),
  };

  await db
    .update(zodiacOrdersTable)
    .set(patch)
    .where(eq(zodiacOrdersTable.id, orderId));

  logger.info({ orderId, luluStatusName, internalStatus, trackingNumber }, "Order updated from Lulu webhook");

  // Fire "book shipped!" email when status transitions to SHIPPED
  if (luluStatusName === "SHIPPED") {
    const [order] = await db
      .select()
      .from(zodiacOrdersTable)
      .where(eq(zodiacOrdersTable.id, orderId));

    if (order) {
      sendShippedEmail(order).catch((err) =>
        logger.warn({ err, orderId }, "Shipped email failed"),
      );
    }
  }
}
