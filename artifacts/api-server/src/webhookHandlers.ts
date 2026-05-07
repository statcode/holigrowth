import { getUncachableStripeClient, getWebhookSecret } from './stripeClient';
import { db, zodiacOrdersTable, eq } from '@workspace/db';
import { logger } from './lib/logger';
import { sendOrderConfirmationEmail } from './routes/zodiac-orders/mailerlite';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    const stripe = await getUncachableStripeClient();
    const webhookSecret = getWebhookSecret();

    let event: import('stripe').Stripe.Event;

    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } else {
      logger.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
      event = JSON.parse(payload.toString()) as import('stripe').Stripe.Event;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as import('stripe').Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId ? Number(session.metadata.orderId) : null;

      if (orderId) {
        await db
          .update(zodiacOrdersTable)
          .set({
            stripeSessionId: session.id,
            stripePaymentIntentId:
              typeof session.payment_intent === 'string' ? session.payment_intent : null,
            priceUsd: session.amount_total ? session.amount_total / 100 : undefined,
          })
          .where(eq(zodiacOrdersTable.id, orderId));

        logger.info({ orderId }, 'Payment confirmed — Stripe fields updated');

        // Fire confirmation email (fire-and-forget)
        const [order] = await db
          .select()
          .from(zodiacOrdersTable)
          .where(eq(zodiacOrdersTable.id, orderId));

        if (order) {
          sendOrderConfirmationEmail(order).catch((err) =>
            logger.warn({ err, orderId }, 'Confirmation email failed'),
          );
        }
      }
    }
  }
}
