import { mysqlTable, int, float, text, datetime } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const siteSettingsTable = mysqlTable("site_settings", {
  id: int("id").autoincrement().primaryKey(),
  priceUsd: float("price_usd").notNull().default(99.99),
  originalPriceUsd: float("original_price_usd").notNull().default(129.99),
  coverImageUrl: text("cover_image_url"),
  testEmailOverride: text("test_email_override"),
  emailConfirmSubject: text("email_confirm_subject"),
  emailConfirmIntro: text("email_confirm_intro"),
  emailBookReadySubject: text("email_book_ready_subject"),
  emailBookReadyIntro: text("email_book_ready_intro"),
  emailStuckSubject: text("email_stuck_subject"),
  emailStuckIntro: text("email_stuck_intro"),
  updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`).$onUpdate(() => new Date()),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
