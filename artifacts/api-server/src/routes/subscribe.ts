import { Router } from "express";
import { subscribeToMailerLite } from "./zodiac-orders/mailerlite";

const router = Router();

router.post("/subscribe", async (req, res) => {
  const { email, name } = req.body as { email?: string; name?: string };
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const result = await subscribeToMailerLite(email, name ?? "");

  if (result.ok) {
    res.json({ ok: true });
    return;
  }

  // Surface upstream failures so the frontend can show a banner. We still want
  // the user to proceed through the form, so the frontend treats this as a
  // non-blocking warning rather than a fatal error.
  const status = result.reason === "not_configured" ? 503 : 502;
  res.status(status).json({
    ok: false,
    reason: result.reason,
    upstreamStatus: result.status,
    message: result.message,
  });
});

export default router;
