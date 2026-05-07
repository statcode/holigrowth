import { getUncachableStripeClient } from './stripeClient';

async function seedProducts() {
  try {
    const stripe = await getUncachableStripeClient();

    console.log('Checking for existing Holistic Growth Life Path Book product...');

    const existing = await stripe.products.search({
      query: "name:'Holistic Growth Life Path Book' AND active:'true'",
    });

    if (existing.data.length > 0) {
      console.log('Product already exists:', existing.data[0].id);
      const prices = await stripe.prices.list({ product: existing.data[0].id, active: true });
      if (prices.data.length > 0) {
        console.log('Active price:', prices.data[0].id, `($${(prices.data[0].unit_amount ?? 0) / 100})`);
      }
      return;
    }

    console.log('Creating product...');
    const product = await stripe.products.create({
      name: 'Holistic Growth Life Path Book',
      description: 'A personalized 40–50 page hardbound astrology and numerology book covering Relationships, Wealth, and Health — including 30 practical personalized affirmations (10 per pillar) written from your Life Path.',
      metadata: {
        type: 'book',
        brand: 'holigrowth',
      },
    });
    console.log('Created product:', product.id);

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 4900,
      currency: 'usd',
    });
    console.log('Created price:', price.id, '($49.00)');

    console.log('\nDone! Webhooks will sync this data to your database automatically.');
    console.log('Product ID:', product.id);
    console.log('Price ID:', price.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error:', message);
    process.exit(1);
  }
}

seedProducts();
