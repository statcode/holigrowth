import { Router, type IRouter } from "express";
import { db, zodiacOrdersTable, eq } from "@workspace/db";
import { getUncachableStripeClient } from "../stripeClient";
import { logger } from "../lib/logger";
import { getOrCreateSettings } from "./settings";

const router: IRouter = Router();

const REFERRAL_DISCOUNT_PERCENT = 10;

router.post("/stripe/create-checkout-session", async (req, res): Promise<void> => {
  const { orderId } = req.body as { orderId?: number };

  if (!orderId) {
    res.status(400).json({ error: "orderId is required" });
    return;
  }

  const [order] = await db
    .select()
    .from(zodiacOrdersTable)
    .where(eq(zodiacOrdersTable.id, orderId));

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const stripe = await getUncachableStripeClient();

  // Stripe redirects the customer's BROWSER to success_url / cancel_url, so
  // we need a URL the browser can reach — not the api-server origin.
  //   - Prod: FRONTEND_URL is unset → falls back to PUBLIC_BASE_URL, which
  //     points at the Apache vhost that serves both the SPA and proxies /api/*.
  //   - Local dev: api-server runs on :8088 (or behind a tunnel to :8088) and
  //     Vite serves the SPA on :5173. Set FRONTEND_URL=http://localhost:5173
  //     in .env so /success/:id resolves to the Vite-served SPA shell.
  const frontendUrl =
    process.env.FRONTEND_URL?.replace(/\/$/, "") ??
    process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ??
    `${req.protocol}://${req.get("host")}`;

  const settings = await getOrCreateSettings();
  const bookPriceCents = Math.round(settings.priceUsd * 100);

  const lineItems = [
    {
      price_data: {
        currency: "usd",
        unit_amount: bookPriceCents,
        product_data: {
          name: "Holistic Growth Life Path Book",
          description: `Personalized astrology & numerology book for ${order.fullName} — 40–50 hardbound pages including 30 practical personalized affirmations (10 each for love, wealth & health) written from ${order.fullName}'s Life Path.`,
          images: settings.coverImageUrl ? [settings.coverImageUrl] : [],
        },
      },
      quantity: 1,
    },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionParams: any = {
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    success_url: `${frontendUrl}/success/${orderId}`,
    cancel_url: `${frontendUrl}/order/${orderId}?payment=cancel`,
    customer_email: order.email ?? undefined,
    metadata: { orderId: String(orderId) },
  };

  if (order.referredBy) {
    const coupon = await stripe.coupons.create({
      percent_off: REFERRAL_DISCOUNT_PERCENT,
      duration: "once",
      name: "Referral Discount",
    });
    sessionParams.discounts = [{ coupon: coupon.id }];
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  await db
    .update(zodiacOrdersTable)
    .set({ stripeSessionId: session.id, priceUsd: (session.amount_total ?? bookPriceCents) / 100 })
    .where(eq(zodiacOrdersTable.id, orderId));

  res.json({ url: session.url });
});


export default router;
