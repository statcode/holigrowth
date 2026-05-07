import { Router, type IRouter } from "express";
import { db, siteSettingsTable, eq } from "@workspace/db";
import { GetSiteSettingsResponse, UpdateSiteSettingsBody, UpdateSiteSettingsResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { sendTestEmail } from "./zodiac-orders/mailerlite";

const router: IRouter = Router();

async function getOrCreateSettings() {
  const rows = await db.select().from(siteSettingsTable).limit(1);
  if (rows.length > 0) return rows[0]!;
  const [insertResult] = await db
    .insert(siteSettingsTable)
    .values({ priceUsd: 99.99, originalPriceUsd: 129.99 });
  const [created] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, insertResult.insertId))
    .limit(1);
  return created!;
}

router.get("/settings", async (_req, res): Promise<void> => {
  try {
    const settings = await getOrCreateSettings();
    const serialized = {
      ...settings,
      updatedAt: settings.updatedAt instanceof Date ? settings.updatedAt.toISOString() : settings.updatedAt,
    };
    res.json(GetSiteSettingsResponse.parse(serialized));
  } catch (err) {
    logger.error({ err }, "Failed to get site settings");
    res.status(500).json({ error: "Failed to get settings" });
  }
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSiteSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const current = await getOrCreateSettings();
    await db
      .update(siteSettingsTable)
      .set({
        ...(parsed.data.priceUsd !== undefined && { priceUsd: parsed.data.priceUsd }),
        ...(parsed.data.originalPriceUsd !== undefined && { originalPriceUsd: parsed.data.originalPriceUsd }),
        ...(parsed.data.coverImageUrl !== undefined && { coverImageUrl: parsed.data.coverImageUrl }),
        ...(parsed.data.testEmailOverride !== undefined && { testEmailOverride: parsed.data.testEmailOverride }),
        ...(parsed.data.emailConfirmSubject !== undefined && { emailConfirmSubject: parsed.data.emailConfirmSubject }),
        ...(parsed.data.emailConfirmIntro !== undefined && { emailConfirmIntro: parsed.data.emailConfirmIntro }),
        ...(parsed.data.emailBookReadySubject !== undefined && { emailBookReadySubject: parsed.data.emailBookReadySubject }),
        ...(parsed.data.emailBookReadyIntro !== undefined && { emailBookReadyIntro: parsed.data.emailBookReadyIntro }),
        ...(parsed.data.emailStuckSubject !== undefined && { emailStuckSubject: parsed.data.emailStuckSubject }),
        ...(parsed.data.emailStuckIntro !== undefined && { emailStuckIntro: parsed.data.emailStuckIntro }),
        updatedAt: new Date(),
      })
      .where(eq(siteSettingsTable.id, current.id));
    const [updated] = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, current.id))
      .limit(1);

    const row = updated ?? current;
    const serialized = {
      ...row,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
    res.json(UpdateSiteSettingsResponse.parse(serialized));
  } catch (err) {
    logger.error({ err }, "Failed to update site settings");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

router.post("/settings/test-email", async (req, res): Promise<void> => {
  const { emailType } = req.body as { emailType?: string };
  if (!emailType || !["confirm", "bookReady", "stuck"].includes(emailType)) {
    res.status(400).json({ error: "emailType must be one of: confirm, bookReady, stuck" });
    return;
  }
  try {
    const result = await sendTestEmail(emailType as "confirm" | "bookReady" | "stuck");
    if (result.ok) {
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: result.error ?? "Failed to send test email" });
    }
  } catch (err) {
    logger.error({ err }, "Test email route threw");
    res.status(500).json({ error: "Internal error sending test email" });
  }
});

export { getOrCreateSettings };
export default router;
