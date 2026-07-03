import { promises as fs } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { db, zodiacOrdersTable, eq, count, desc, sql } from "@workspace/db";
import {
  CreateZodiacOrderBody,
  GetZodiacOrderParams,
  GetZodiacOrderResponse,
  GenerateZodiacContentParams,
  SubmitToLuluParams,
  SubmitToLuluBody,
  SubmitToLuluResponse,
  ListZodiacOrdersResponse,
  GetOrderStatsResponse,
  GetReferralParams,
  GetReferralResponse,
} from "@workspace/api-zod";

import { streamChatCompletion } from "../../lib/openrouterClient";
import { logger } from "../../lib/logger";
import { getBookSections, extractZodiacMetadata } from "./astrology";
import { submitBookToLulu, getLuluOrderStatus, registerLuluWebhook } from "./lulu";
import { sendBookReadyEmail, sendGenerationStuckEmail } from "./mailerlite";
import { generateInteriorPDF, generateCoverPDF, estimatePageCount } from "./pdfGenerator";
import { verifyAdminToken } from "../admin";
import { uploadPdf } from "./pdfUploader";
import { subscribeToMailerLite } from "./mailerlite";
import { templatesDir } from "./templatedPdf/parse";

/**
 * Load the system prompt for the book generator from
 * `artifacts/book-templates/book-prompt.md`. Cached after first read.
 * Editing the markdown file is the canonical way to tune AI output —
 * keep this code unchanged and edit the file.
 */
let cachedSystemPrompt: string | null = null;
async function loadBookSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const filePath = path.join(templatesDir(), "book-prompt.md");
  cachedSystemPrompt = await fs.readFile(filePath, "utf8");
  return cachedSystemPrompt;
}

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function serializeDates<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (result[key] instanceof Date) {
      result[key] = (result[key] as Date).toISOString();
    }
  }
  return result as T;
}

// Strip paid-only fields (currently just luckyNumbers) when an order has not
// completed Stripe checkout. The Stripe webhook sets stripePaymentIntentId on
// `checkout.session.completed` — that's the unforgeable "actually paid" signal.
// Status alone is unreliable: orders sit at `generated` post-AI but pre-payment.
function gateUnpaidFields<T extends { stripePaymentIntentId?: string | null; luckyNumbers?: string | null }>(order: T): T {
  if (order.stripePaymentIntentId) return order;
  return { ...order, luckyNumbers: null };
}

const router: IRouter = Router();

router.get("/zodiac-orders", async (_req, res): Promise<void> => {
  const orders = await db
    .select()
    .from(zodiacOrdersTable)
    .orderBy(desc(zodiacOrdersTable.createdAt));
  res.json(ListZodiacOrdersResponse.parse(orders.map(serializeDates)));
});

router.post("/zodiac-orders", async (req, res): Promise<void> => {
  const parsed = CreateZodiacOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const referralCode = generateReferralCode();

  const [insertResult] = await db
    .insert(zodiacOrdersTable)
    .values({
      fullName: parsed.data.fullName,
      birthday: parsed.data.birthday,
      birthTime: parsed.data.birthTime,
      birthLocation: parsed.data.birthLocation,
      email: parsed.data.email ?? null,
      intention: parsed.data.intention ?? null,
      gender: parsed.data.gender ?? null,
      sexualOrientation: parsed.data.sexualOrientation ?? null,
      relationshipStatus: parsed.data.relationshipStatus ?? null,
      referredBy: parsed.data.referredBy ?? null,
      referralCode,
      status: "pending",
    });
  const newId = insertResult.insertId;

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, newId));

  // Increment referral count on the referrer's order
  if (parsed.data.referredBy) {
    await db
      .update(zodiacOrdersTable)
      .set({ referralCount: sql`referral_count + 1` })
      .where(eq(zodiacOrdersTable.referralCode, parsed.data.referredBy));
  }

  // Fire-and-forget: add email to MailerLite prospects list
  if (parsed.data.email) {
    subscribeToMailerLite(parsed.data.email, parsed.data.fullName).catch(() => {});
  }

  res.status(201).json(GetZodiacOrderResponse.parse(serializeDates(order)));
});

router.get("/zodiac-orders/stats/summary", async (_req, res): Promise<void> => {
  const [totalResult] = await db.select({ count: count() }).from(zodiacOrdersTable);
  const allOrders = await db
    .select()
    .from(zodiacOrdersTable)
    .orderBy(desc(zodiacOrdersTable.createdAt));

  const statuses = ["pending", "generating", "generated", "shipped"];
  const statusCounts: Record<string, number> = {};
  for (const status of statuses) {
    statusCounts[status] = allOrders.filter((o) => o.status === status).length;
  }

  res.json(
    GetOrderStatsResponse.parse({
      total: totalResult?.count ?? 0,
      pending: statusCounts.pending ?? 0,
      generating: statusCounts.generating ?? 0,
      generated: statusCounts.generated ?? 0,
      shipped: statusCounts.shipped ?? 0,
      recentOrders: allOrders.slice(0, 5).map(serializeDates),
    })
  );
});

router.get("/zodiac-orders/track", async (req, res): Promise<void> => {
  const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
  if (!email) {
    res.status(400).json({ error: "email query parameter is required" });
    return;
  }

  const orders = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.email, email))
    .orderBy(desc(zodiacOrdersTable.createdAt));

  // For orders with a Lulu print job, sync latest status in the background
  const syncPromises = orders
    .filter((o) => o.luluOrderId && o.status !== "delivered" && o.status !== "failed")
    .map(async (o) => {
      try {
        const luluStatus = await getLuluOrderStatus(o.luluOrderId!);

        // Map Lulu status to our order status
        const statusMap: Record<string, string> = {
          IN_PRODUCTION: "processing",
          SHIPPED: "shipped",
          DELIVERED: "delivered",
          REJECTED: "failed",
        };
        const newStatus = statusMap[luluStatus.status] ?? o.status;

        await db
          .update(zodiacOrdersTable)
          .set({
            luluStatus: luluStatus.status,
            status: newStatus,
            ...(luluStatus.trackingNumber ? { trackingNumber: luluStatus.trackingNumber } : {}),
            ...(luluStatus.trackingUrl ? { trackingUrl: luluStatus.trackingUrl } : {}),
            ...(luluStatus.estimatedDelivery ? { estimatedDelivery: luluStatus.estimatedDelivery } : {}),
          })
          .where(eq(zodiacOrdersTable.id, o.id));

        logger.info({ orderId: o.id, luluStatus: luluStatus.status }, "Synced Lulu status on track lookup");
      } catch (err) {
        logger.warn({ err, orderId: o.id }, "Lulu status sync failed during track lookup");
      }
    });

  // Run syncs in parallel (fire-and-forget, but await before responding)
  await Promise.allSettled(syncPromises);

  // Re-fetch updated orders
  const updatedOrders = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.email, email))
    .orderBy(desc(zodiacOrdersTable.createdAt));

  res.json(updatedOrders.map((o) => serializeDates(gateUnpaidFields(o))));
});

router.get("/zodiac-orders/:id", async (req, res): Promise<void> => {
  const params = GetZodiacOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(GetZodiacOrderResponse.parse(serializeDates(gateUnpaidFields(order))));
});

router.post("/zodiac-orders/:id/generate", async (req, res): Promise<void> => {
  const params = GenerateZodiacContentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (order.status === "generated" || order.status === "submitted" || order.status === "processing" || order.status === "shipped") {
    res.status(409).json({ error: "Content already generated" });
    return;
  }

  // Guardrail: a customer who closes the /preview tab and comes back while
  // the AI is still streaming would otherwise re-trigger /generate, kicking
  // off a second parallel OpenRouter call against the same order. Block it
  // and let the client poll the status row instead — the in-flight job will
  // finish and flip status to `generated` on its own.
  if (order.status === "generating") {
    res.status(409).json({
      error: "Already generating — your book is being written. Poll /api/zodiac-orders/:id for status.",
      status: "generating",
    });
    return;
  }

  // Mark as generating
  await db
    .update(zodiacOrdersTable)
    .set({ status: "generating" })
    .where(eq(zodiacOrdersTable.id, params.data.id));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders();

  // Keepalive ping every 20 s — prevents the reverse-proxy from closing the
  // connection silently while the AI is generating (proxy read-timeout ~60 s).
  let keepAliveTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (!res.writableEnded) res.write(`: keepalive\n\n`);
  }, 20_000);

  try {
    const systemPrompt = await loadBookSystemPrompt();
    const sections = getBookSections(order);
    // Default model is Gemini 2.5 Flash — fastest + cheapest model that still
    // writes the book at the quality bar we want. Override per-environment
    // by setting OPENROUTER_MODEL in .env (e.g. "anthropic/claude-haiku-4-5"
    // if you want more poetic prose, or "openai/gpt-5-mini" for stricter
    // adherence to the per-chapter word-count targets).
    const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";

    // Tell the client how many sections to expect so the loader can show
    // a progress bar / "n of N" count.
    res.write(`data: ${JSON.stringify({ stage: "writing", totalSections: sections.length })}\n\n`);

    /** Run a single section's AI call to completion and emit a progress
     *  event when it finishes. One automatic retry on failure (timeout,
     *  idle stall, or transient 5xx) — OpenRouter occasionally drops a
     *  single connection mid-stream, and retrying is cheaper than asking
     *  the customer to start over. Returns the original index so we can
     *  stitch the chapters in book order regardless of completion order. */
    const runSection = async (section: typeof sections[number], idx: number, completedRef: { n: number }): Promise<{ idx: number; key: string; text: string }> => {
      const MAX_ATTEMPTS = 2;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const stream = streamChatCompletion({
            model,
            maxTokens: 4096,
            // Per-section caps: 3 min hard total, 45 s idle-stall. These keep
            // a single slow / hung chapter from holding the whole book hostage.
            requestTimeoutMs: 180_000,
            idleTimeoutMs: 45_000,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: section.userPrompt },
            ],
          });
          let text = "";
          for await (const chunk of stream) text += chunk;
          if (text.trim().length === 0) {
            throw new Error(`OpenRouter returned empty response for section "${section.key}"`);
          }
          completedRef.n += 1;
          // Emit progress as each chapter resolves. Multiple sections finish
          // concurrently — `n` here is the COUNT of completed sections, not
          // the index, so the UI's count never goes backwards.
          res.write(`data: ${JSON.stringify({
            stage: "writing",
            sectionComplete: {
              n: completedRef.n,
              total: sections.length,
              key: section.key,
              title: section.title,
            },
          })}\n\n`);
          return { idx, key: section.key, text: text.trim() };
        } catch (err) {
          lastErr = err;
          logger.warn(
            { err, sectionKey: section.key, attempt, orderId: params.data.id },
            `Section "${section.key}" attempt ${attempt}/${MAX_ATTEMPTS} failed`,
          );
          if (attempt < MAX_ATTEMPTS) continue;
        }
      }
      // Both attempts failed — throw with section context so the outer
      // catch can tell the client which chapter died.
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(`Section "${section.key}" failed after ${MAX_ATTEMPTS} attempts: ${message}`);
    };

    const completedRef = { n: 0 };
    const results = await Promise.all(
      sections.map((section, idx) => runSection(section, idx, completedRef)),
    );

    // Stitch in book order (Promise.all preserves input order, but sort
    // defensively in case future code switches to Promise.allSettled).
    results.sort((a, b) => a.idx - b.idx);
    const fullContent = results.map((r) => r.text).join("\n\n");

    // Extract metadata from the generated content
    const metadata = extractZodiacMetadata(order.fullName, order.birthday, order.birthTime, order.birthLocation);

    // Persist content and metadata first so PDFs can reference them
    const orderWithMeta = {
      ...order,
      generatedContent: fullContent,
      sunSign: metadata.sunSign,
      moonSign: metadata.moonSign,
      risingSign: metadata.risingSign,
      lifePath: metadata.lifePath,
      luckyNumbers: metadata.luckyNumbers,
    };

    await db
      .update(zodiacOrdersTable)
      .set({
        status: "generating",
        generatedContent: fullContent,
        sunSign: metadata.sunSign,
        moonSign: metadata.moonSign,
        risingSign: metadata.risingSign,
        lifePath: metadata.lifePath,
        luckyNumbers: metadata.luckyNumbers,
      })
      .where(eq(zodiacOrdersTable.id, params.data.id));

    res.write(`data: ${JSON.stringify({ stage: "pdf", message: "Generating PDF files…" })}\n\n`);

    // Check for admin test mode (5-page PDF)
    const reqBody = req.body as { adminToken?: string; adminTestMode?: boolean } | undefined;
    const isAdminTest = reqBody?.adminTestMode === true && reqBody?.adminToken && verifyAdminToken(reqBody.adminToken);

    // Generate both PDFs in parallel
    const pageCount = isAdminTest ? 5 : estimatePageCount(fullContent);
    const [interiorBuffer, coverBuffer] = await Promise.all([
      generateInteriorPDF(orderWithMeta, fullContent, isAdminTest ? { maxPages: 5 } : undefined),
      generateCoverPDF(orderWithMeta, pageCount),
    ]);

    res.write(`data: ${JSON.stringify({ stage: "upload", message: "Uploading PDFs…" })}\n\n`);

    // Upload both PDFs to object storage in parallel
    const [interiorPdfUrl, coverPdfUrl] = await Promise.all([
      uploadPdf(interiorBuffer, "interior", params.data.id),
      uploadPdf(coverBuffer, "cover", params.data.id),
    ]);

    logger.info({ orderId: params.data.id, pageCount, interiorPdfUrl, coverPdfUrl }, "PDFs generated and uploaded");

    // Save final status with PDF URLs
    await db
      .update(zodiacOrdersTable)
      .set({
        status: "generated",
        interiorPdfUrl,
        coverPdfUrl,
      })
      .where(eq(zodiacOrdersTable.id, params.data.id));

    // Fire "book ready" email (fire-and-forget)
    const [readyOrder] = await db
      .select()
      .from(zodiacOrdersTable)
      .where(eq(zodiacOrdersTable.id, params.data.id));

    if (readyOrder) {
      sendBookReadyEmail(readyOrder).catch((err) =>
        logger.warn({ err, orderId: params.data.id }, 'Book ready email failed'),
      );
    }

    res.write(`data: ${JSON.stringify({ done: true, metadata, interiorPdfUrl, coverPdfUrl, pageCount })}\n\n`);
    res.end();
  } catch (error) {
    // Surface the underlying error message in the response so DevTools shows
    // the actual cause (e.g. "Section 'chapter-5' failed after 2 attempts:
    // OpenRouter 429: rate limited"). The error is also logged with full
    // context for prod debugging via pm2.
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error, errMessage, orderId: params.data.id }, "Failed to generate zodiac content");

    await db
      .update(zodiacOrdersTable)
      .set({ status: "failed" })
      .where(eq(zodiacOrdersTable.id, params.data.id));

    // Fire stuck-generation email so the customer knows to retry (fire-and-forget)
    const [failedOrder] = await db
      .select()
      .from(zodiacOrdersTable)
      .where(eq(zodiacOrdersTable.id, params.data.id));

    if (failedOrder) {
      sendGenerationStuckEmail(failedOrder).catch((err) =>
        logger.warn({ err, orderId: params.data.id }, "Generation stuck email failed"),
      );
    }

    res.write(`data: ${JSON.stringify({
      error: "Generation failed. Please try again.",
      detail: errMessage,
    })}\n\n`);
    res.end();
  } finally {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }
});

router.post("/zodiac-orders/:id/submit-to-lulu", async (req, res): Promise<void> => {
  const params = SubmitToLuluParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitToLuluBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (order.status !== "generated") {
    res.status(400).json({ error: "Content must be generated before ordering" });
    return;
  }

  if (!order.generatedContent) {
    res.status(400).json({ error: "No generated content found" });
    return;
  }

  try {
    const luluResult = await submitBookToLulu({
      order,
      shippingDetails: body.data,
    });

    const shippingAddressStr = [
      body.data.shippingName,
      body.data.shippingAddress1,
      body.data.shippingAddress2,
      body.data.shippingCity,
      body.data.shippingState,
      body.data.shippingZip,
      body.data.shippingCountry,
    ]
      .filter(Boolean)
      .join(", ");

    await db
      .update(zodiacOrdersTable)
      .set({
        status: "processing",
        luluOrderId: luluResult.orderId,
        luluStatus: luluResult.status,
        shippingAddress: shippingAddressStr,
        email: body.data.email || order.email,
        priceUsd: luluResult.priceUsd,
      })
      .where(eq(zodiacOrdersTable.id, params.data.id));

    const [updated] = await db
      .select()
      .from(zodiacOrdersTable)
      .where(eq(zodiacOrdersTable.id, params.data.id));

    res.json(SubmitToLuluResponse.parse(serializeDates(updated!)));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Failed to submit to Lulu";
    logger.error({ error }, "Lulu submission failed");
    res.status(400).json({ error: errMsg });
  }
});

router.post("/zodiac-orders/:id/regenerate-pdf", async (req, res): Promise<void> => {
  const params = SubmitToLuluParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (!order.generatedContent) {
    res.status(400).json({ error: "No generated content found — run full book generation first" });
    return;
  }

  try {
    logger.info({ orderId: params.data.id }, "Admin: re-generating PDFs from existing content");

    const orderWithMeta = {
      ...order,
      generatedContent: order.generatedContent,
    };

    const pageCount = estimatePageCount(order.generatedContent);
    const [interiorBuffer, coverBuffer] = await Promise.all([
      generateInteriorPDF(orderWithMeta, order.generatedContent),
      generateCoverPDF(orderWithMeta, pageCount),
    ]);

    const [interiorPdfUrl, coverPdfUrl] = await Promise.all([
      uploadPdf(interiorBuffer, "interior", params.data.id),
      uploadPdf(coverBuffer, "cover", params.data.id),
    ]);

    // Regenerating PDFs invalidates any prior Lulu submission — the URLs
    // baked into Lulu's print job now point at stale files. Move the order
    // back to `generated` and clear the Lulu fields so the admin drawer
    // shows the "Submit to Lulu" button again. Stripe fields (session/PI/
    // priceUsd) intentionally persist — this is a re-submit, not a re-pay.
    // If the previous status was already past `generated`, log it so the
    // reset is auditable.
    const resetLuluFields = order.status !== "generated" || order.luluOrderId != null;
    await db
      .update(zodiacOrdersTable)
      .set({
        interiorPdfUrl,
        coverPdfUrl,
        ...(resetLuluFields
          ? { status: "generated" as const, luluOrderId: null, luluStatus: null }
          : {}),
      })
      .where(eq(zodiacOrdersTable.id, params.data.id));

    if (resetLuluFields) {
      logger.info(
        {
          orderId: params.data.id,
          previousStatus: order.status,
          previousLuluOrderId: order.luluOrderId,
          previousLuluStatus: order.luluStatus,
          pageCount,
        },
        "Admin: PDFs regenerated — status reset to generated, Lulu fields cleared",
      );
    } else {
      logger.info({ orderId: params.data.id, pageCount }, "Admin: PDFs regenerated and uploaded");
    }

    res.json({ interiorPdfUrl, coverPdfUrl, pageCount });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "PDF regeneration failed";
    logger.error({ error, orderId: params.data.id }, "Admin: PDF regeneration failed");
    res.status(500).json({ error: errMsg });
  }
});

router.post("/zodiac-orders/:id/reset", async (req, res): Promise<void> => {
  const params = SubmitToLuluParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const resettable = ["generating", "failed", "pending"];
  if (!resettable.includes(order.status)) {
    res.status(409).json({ error: `Cannot reset an order with status "${order.status}"` });
    return;
  }

  await db
    .update(zodiacOrdersTable)
    .set({ status: "pending" })
    .where(eq(zodiacOrdersTable.id, params.data.id));

  logger.info({ orderId: params.data.id, previousStatus: order.status }, "Admin: order reset to pending");

  const [updated] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  res.json(GetZodiacOrderResponse.parse(serializeDates(updated!)));
});

// Admin-only: permanently delete an order. The DB row is dropped; any
// uploaded PDFs on disk (referenced by interiorPdfUrl / coverPdfUrl) become
// orphans but aren't cleaned up — they sit in artifacts/uploads/ until the
// next sweep. Matches the existing admin endpoints' security model (the
// admin UI is the gate; the route itself is not token-protected — see
// reset / regenerate-pdf above).
router.delete("/zodiac-orders/:id", async (req, res): Promise<void> => {
  const params = GetZodiacOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  await db
    .delete(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, params.data.id));

  logger.info({ orderId: params.data.id, fullName: order.fullName, status: order.status }, "Admin: order deleted");

  res.status(204).end();
});

router.get("/referrals/:code", async (req, res): Promise<void> => {
  const params = GetReferralParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [referrer] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.referralCode, params.data.code));

  if (!referrer) {
    res.status(404).json({ error: "Referral code not found" });
    return;
  }

  const firstName = referrer.fullName.split(" ")[0] ?? referrer.fullName;

  res.json(GetReferralResponse.parse({
    code: referrer.referralCode!,
    referrerName: firstName,
    discountPercent: 10,
    timesUsed: referrer.referralCount,
    sunSign: referrer.sunSign ?? null,
    moonSign: referrer.moonSign ?? null,
    risingSign: referrer.risingSign ?? null,
    lifePath: referrer.lifePath ?? null,
    luckyNumbers: referrer.luckyNumbers ?? null,
  }));
});

// ─── Admin: Register Lulu webhook ───────────────────────────────────────────
// POST /api/lulu/register-webhook
// Call this once after deployment to tell Lulu where to send status updates.
// The webhook URL is auto-derived from PUBLIC_BASE_URL env var.
// Optionally pass { "url": "https://your-domain.com/api/lulu/webhook" } in the body.
router.post("/lulu/register-webhook", async (req, res): Promise<void> => {
  try {
    const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    const domain = (req.body as { url?: string })?.url
      ?? (baseUrl ? `${baseUrl}/api/lulu/webhook` : null);

    if (!domain) {
      res.status(400).json({
        error: "Cannot determine webhook URL. Pass { url: 'https://your-domain.com/api/lulu/webhook' } in the request body.",
      });
      return;
    }

    const result = await registerLuluWebhook(domain);
    res.json({
      success: true,
      webhookId: result.id,
      url: result.url,
      events: result.events,
      alreadyExisted: result.alreadyExisted,
      message: result.alreadyExisted
        ? "Webhook already registered — no changes made."
        : "Webhook registered successfully. Lulu will now push status updates to your server.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Lulu webhook registration failed");
    res.status(500).json({ error: message });
  }
});

export default router;
