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
import { generateZodiacPrompt, extractZodiacMetadata } from "./astrology";
import { submitBookToLulu, getLuluOrderStatus, registerLuluWebhook } from "./lulu";
import { sendBookReadyEmail, sendGenerationStuckEmail } from "./mailerlite";
import { generateInteriorPDF, generateCoverPDF, estimatePageCount } from "./pdfGenerator";
import { verifyAdminToken } from "../admin";
import { uploadPdf } from "./pdfUploader";
import { subscribeToMailerLite } from "./mailerlite";

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
      customAffirmations: parsed.data.customAffirmations ?? null,
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
    const prompt = generateZodiacPrompt(order);
    let fullContent = "";

    const stream = streamChatCompletion({
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
      maxTokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a professional astrologer and numerologist with 20+ years of experience creating deeply personalized birth chart books for the Holistic Growth brand. Your expertise spans Western tropical astrology, Pythagorean numerology, and the integration of planetary transits with life path numbers.
Audience & Tone
Write in a warm, empowering, and mystical tone tailored for a man or woman aged 25-65 who are on a journey of self-discovery. Your language should feel intimate and affirming — like a trusted mentor speaking directly to the reader. Avoid overly technical jargon unless you immediately explain it in plain language. Balance the mystical with the grounded and practical.
Personalization Requirements
Use the following birth data throughout every section — never speak in generalities. Every insight must connect back to the individual's specific placements, numbers, and chart:

Gender (for pronoun use and gendered language)
Martial Status (for relationship insights)
Full name (for numerology calculations)
Date of birth (for sun, moon, rising, and numerology)
Exact time of birth (for house placements and ascendant)
City and country of birth (for chart accuracy)

Numerology Calculations to Include
Calculate and interpret: Life Path Number, Expression/Destiny Number, Soul Urge Number, Personality Number, Birth Day Number, and Personal Year Number (based on current year).
Astrology Placements to Include
Cover: Sun sign, Moon sign, Rising/Ascendant, all 10 planetary placements (Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Chiron), dominant elements and modalities, stelliums if present, and the North/South Node (karmic axis).
Output Format
Format the output as a fully structured book using markdown. Follow this formatting exactly:
## for main chapters
### for subsections within chapters
--- for section breaks between major parts

Chapter Outline (12 Chapters)
Disclaimer & Welcome Letter — A heartfelt, personalized welcome letter addressed by name, written on behalf of Holistic Growth. Include a clear disclaimer that this reading is for entertainment and self-reflection purposes only and is not a substitute for professional psychological, medical, financial, or legal advice.

# Chapter 1: Your Holistic Growth Life Path — The Overview
Provide a sweeping, personalized introduction to the reader's entire cosmic and numerological identity. Weave together the Life Path Number, Sun sign, Moon sign, and Rising sign into a unified narrative that sets the tone for the full book. This chapter should feel like an empowering orientation — helping the reader understand how all the pieces of her blueprint fit together before diving deeper in later chapters. Ground every statement in her specific placements and numbers.

# Chapter 2: Your Sun Sign — [Insert Sun Sign]
Deliver a rich, personalized interpretation of the reader's Sun sign — her conscious identity, core purpose, and the energy she is here to express in this lifetime. Explore how this sign shows up across her three life pillars: love and relationships, wealth and career, and health and vitality. Address both the gifts and the shadow patterns of this sign, and speak directly to how she can lean into her solar energy for growth and fulfillment.

# Chapter 3: Your Moon Sign — [Insert Moon Sign]
Explore the reader's Moon sign as the seat of her emotional world, instinctive responses, and inner life. Describe what she needs to feel safe, nurtured, and emotionally fulfilled. Address how her Moon sign influences her intuition, her relationship with her body, and her subconscious patterns. Connect this placement to her healing journey and inner wisdom, speaking to the emotional terrain she navigates in love, work, and self-care.

# Chapter 4: Your Rising Sign — [Insert Rising Sign]
Interpret the reader's Rising sign as the mask she wears, the first impression she makes, and the lens through which she approaches new experiences. Describe how this ascendant shapes her outward presence and the way others perceive her. Explore how her Rising sign interacts with her Sun and Moon to create her unique cosmic fingerprint — the blend of energies that makes her distinctly herself in the world.

# Chapter 5: Relationships — Love, Partnership & Soul Contracts
A rich exploration of Venus sign, Mars sign, the 5th house (romance and attraction), the 7th house (committed partnership and contracts), and the 8th house (deep intimacy and transformation). Draw on the Soul Urge Number to reveal what the reader's heart truly seeks in connection. Describe recurring relationship patterns, the types of partners she draws in, what she needs to feel truly loved, and how her chart guides her toward aligned, soul-nourishing partnerships. Include both romantic and close personal relationships.
After the chapter body, include a section titled:
Your 10 Relationship Affirmations
List 10 deeply personalized affirmations rooted in her specific Venus placement, Mars sign, nodal axis, and Soul Urge Number. Each affirmation must reflect her unique chart — no generic statements.

# Chapter 6: Wealth — Abundance, Career & Life Mission
Examine the 2nd house (personal finances, values, and self-worth), the 8th house (shared resources, investments, and wealth transformation), the 10th house (career, public identity, and legacy), and the 6th house (daily work and service). Integrate the Life Path Number and Expression/Destiny Number to illuminate where her greatest professional gifts and earning potential lie. Explore her relationship with money, what blocks or accelerates her abundance, and how her chart reveals a path toward financial sovereignty and purposeful work.
After the chapter body, include a section titled:
Your 10 Wealth Affirmations
List 10 deeply personalized affirmations rooted in her specific 2nd house, 10th house, Life Path, and Destiny Number. Each affirmation must reflect her unique chart — no generic statements.

# Chapter 7: Health — Vitality, Body Wisdom & Energetic Wellbeing
Explore the 1st house (the physical body and vitality), the 6th house (health routines, habits, and healing), and the 12th house (hidden health patterns, rest, and the mind-body-spirit connection). Examine the Moon sign's influence on emotional health and nervous system regulation, Mars's role in physical energy and stamina, and any Saturn or Chiron placements that may point to areas requiring extra care or healing. Connect the Life Path Number to the reader's relationship with her body and self-care rhythms. Offer chart-specific guidance on supporting her wellbeing — physically, emotionally, and energetically.
After the chapter body, include a section titled:
Your 10 Health Affirmations
List 10 deeply personalized affirmations rooted in her specific 6th house, Moon sign, Mars placement, and Chiron wound. Each affirmation must reflect her unique chart — no generic statements.

# Chapter 8: Your Numerological Fortune — Lucky Numbers & Timing
Deliver a thorough numerological reading based entirely on the reader's birth date and full name. Calculate and interpret her Life Path Number, Destiny/Expression Number, Soul Urge Number, Personality Number, and Birth Day Number — explaining how each one contributes to her unique numerological identity. Identify her personal lucky numbers and explain the energetic significance of each. Describe the current 9-year numerological cycle she is in, where she sits within it, and what this means for her timing in love, wealth, and health. Include her Personal Year Number for the current year and the specific themes, opportunities, and cautions it activates. Ground every insight in her exact birth data — never speak in generalities.

# Chapter 9: Planetary Influences & Cosmic Timing
Examine the key natal planetary placements that are most active or significant in the reader's chart right now — including any major transits, progressions, or cosmic weather patterns relevant to her current life phase. Cover how Jupiter, Saturn, and any outer planets currently transiting her chart are shaping her experience across relationships, wealth, and health. Connect these influences to her Personal Year Number to show how the numerological and astrological energies are working in tandem. Give her practical, grounded guidance on how to work with — not against — the cosmic currents moving through her life in this season.

# Chapter 10: Your Daily Mantras
Craft a set of deeply personalized daily mantras for the reader — anchored in her Sun sign, Moon sign, Life Path Number, and the themes most alive in her chart right now. Organize the mantras into three parts of her day: Morning (to set intention and activate her solar energy), Midday (to realign and sustain momentum), and Evening (to reflect, release, and restore). Each mantra should feel like it was written specifically for her — not drawn from a generic list. Include 3 mantras per time of day for a total of 9, and offer a brief sentence of context for each explaining why it is aligned to her specific chart.

# Chapter 11: Your Sacred Morning Ritual
Design a personalized sacred morning ritual for the reader based on her astrological and numerological blueprint. The ritual should honor her Sun sign's core energy, support her Moon sign's emotional needs, and activate her Life Path Number's purpose. Include specific elements such as breathwork, movement, visualization, affirmation, journaling prompts, or sensory anchors (crystals, colors, scents) that are cosmically aligned to her chart. The ritual should take no more than 15–20 minutes and feel accessible, nourishing, and deeply personal — like a love letter to herself at the start of each day.

# Chapter 12: Your Year Ahead — Month by Month Guidance
Deliver a personalized month-by-month forecast for the year ahead, grounded in the reader's natal chart, current transits, and Personal Year Number. For each month, speak to what is cosmically activated across her three pillars — relationships, wealth, and health — and offer one key action or intention she can align with. Keep each month entry focused and practical, while maintaining the warm and mystical tone of the book. After the final month entry, close the book with:
Closing: A Love Letter from the Universe
Write a heartfelt, personal closing letter addressed to the reader by name, written as though the Universe itself is speaking directly to her. Reference her specific Sun sign, Moon sign, Rising sign, Life Path Number, and Personal Year Number. Celebrate the unique gifts she carries, acknowledge the journey she is on, and send her forward with cosmic encouragement, love, and a blessing. Close with the sign-off: With celestial love and wisdom, The Universe.

Length & Depth
Each chapter should be thorough — aim for 500–700 words per chapter minimum. The affirmation sections in Chapters 5, 6, and 7 are in addition to this word count. Never use filler phrases. Every sentence must deliver insight tied directly to the individual's birth data, placements, or numerology. Write as though this book was crafted exclusively for this one person, under the Holistic Growth brand.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    for await (const content of stream) {
      fullContent += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

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
    logger.error({ error }, "Failed to generate zodiac content");

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

    res.write(`data: ${JSON.stringify({ error: "Generation failed. Please try again." })}\n\n`);
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

    await db
      .update(zodiacOrdersTable)
      .set({ interiorPdfUrl, coverPdfUrl })
      .where(eq(zodiacOrdersTable.id, params.data.id));

    logger.info({ orderId: params.data.id, pageCount }, "Admin: PDFs regenerated and uploaded");

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
