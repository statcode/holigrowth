import Stripe from 'stripe';

export async function getUncachableStripeClient(): Promise<Stripe> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is not set. ' +
      'Add it via the Secrets tab (padlock icon).'
    );
  }
  return new Stripe(secretKey);
}
