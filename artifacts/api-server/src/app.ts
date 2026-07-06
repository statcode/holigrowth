import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { WebhookHandlers } from "./webhookHandlers";
import { processLuluWebhook } from "./luluWebhookHandler";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the loopback proxy (Apache/Nginx → 127.0.0.1:PORT) on Cloudways.
// Lets req.protocol reflect the original `https` from X-Forwarded-Proto,
// so generated URLs (e.g. the PDF preview links Lulu pulls) use the public
// scheme + host instead of `http://localhost`.
app.set("trust proxy", "loopback");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Lulu webhook — must be registered before express.json() to receive raw Buffer body
app.post(
  "/api/lulu/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["x-hub-signature"];
    const sig = Array.isArray(signature) ? signature[0] : signature;

    try {
      await processLuluWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Lulu webhook error");
      res.status(400).json({ error: message });
    }
  }
);

// Stripe webhook MUST be registered before express.json() — needs raw Buffer body
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;

    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "Stripe webhook error");
      res.status(400).json({ error: message });
    }
  }
);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

/**
 * Global Express error handler. Without this, unhandled route errors
 * fall through to Express's default handler which prints a bare stack
 * trace to stderr — MySQL diagnostics (code / errno / sqlMessage /
 * sql) live on the Error's own fields or on `.cause`, and Express
 * drops them all. Routing through our pino logger with the custom
 * `err` serialiser surfaces the actual driver-level message.
 *
 * Four-arg signature is required for Express to recognise this as an
 * error handler (three-arg would be treated as a normal middleware).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  req.log.error({ err }, "Unhandled route error");
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
});

export default app;
