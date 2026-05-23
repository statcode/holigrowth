import app from './app';
import { logger } from './lib/logger';

const rawPort = process.env['PORT'];

if (!rawPort) {
  throw new Error('PORT environment variable is required but was not provided.');
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey || stripeKey.length < 10) {
  logger.warn('STRIPE_SECRET_KEY not set or looks invalid — add your sk_test_... key to enable payments');
} else {
  logger.info('Stripe key present — checkout ready');
}

// Bind to loopback only — on Cloudways the public Apache/Nginx server
// reverse-proxies /api/* to this process over 127.0.0.1. Binding to the
// public interface (0.0.0.0) would expose the Node port directly, which
// we don't want.
app.listen(port, '127.0.0.1', (err) => {
  if (err) {
    logger.error({ err }, 'Error listening on port');
    process.exit(1);
  }
  logger.info({ port }, 'Server listening on 127.0.0.1');
});
