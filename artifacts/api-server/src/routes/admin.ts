import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export function getAdminToken(): string {
  const pwd = process.env.ADMIN_PASSWORD ?? "";
  return crypto.createHmac("sha256", pwd).update("holigrowth-admin-v1").digest("hex");
}

export function verifyAdminToken(token: string): boolean {
  const expected = getAdminToken();
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

router.post("/admin/login", (req, res): void => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "Password required" });
    return;
  }
  const adminPwd = process.env.ADMIN_PASSWORD;
  if (!adminPwd) {
    logger.error("ADMIN_PASSWORD env var not set");
    res.status(500).json({ error: "Admin not configured" });
    return;
  }
  if (password !== adminPwd) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  res.json({ token: getAdminToken() });
});

export default router;
