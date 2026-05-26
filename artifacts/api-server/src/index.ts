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

// OpenRouter sanity check at startup. AI book generation breaks silently if
// either the key is absent or the model name is garbled (this bit us once —
// a trailing `ß` character on OPENROUTER_MODEL caused every generation to
// 400 with the error swallowed in the SSE stream). Surfacing it here at
// boot makes the misconfiguration obvious before any customer hits it.
const openrouterKey = process.env.OPENROUTER_API_KEY;
if (!openrouterKey || !openrouterKey.startsWith('sk-or-')) {
  logger.error('OPENROUTER_API_KEY missing or malformed — book generation will fail. Expected format: sk-or-v1-…');
} else {
  logger.info('OpenRouter key present — book generation ready');
}

// Model name format: <provider>/<model-id>, lowercase ASCII with hyphens/
// dots/colons only. Catches stray non-ASCII (e.g. `ß`) and obvious typos
// before the first generation request fires.
const openrouterModel = process.env.OPENROUTER_MODEL;
const VALID_MODEL_RE = /^[a-z0-9.-]+\/[a-z0-9.:-]+$/;
if (openrouterModel && !VALID_MODEL_RE.test(openrouterModel)) {
  logger.error(
    { model: openrouterModel, valid_pattern: VALID_MODEL_RE.source },
    'OPENROUTER_MODEL looks malformed — generation will 400 silently. Examples: google/gemini-2.5-flash, anthropic/claude-haiku-4-5, openai/gpt-4o-mini',
  );
} else if (openrouterModel) {
  logger.info({ model: openrouterModel }, 'OpenRouter model override active');
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
