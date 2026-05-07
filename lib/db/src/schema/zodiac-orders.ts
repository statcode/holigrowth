import { mysqlTable, int, text, longtext, varchar, float, datetime, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const zodiacOrdersTable = mysqlTable(
  "zodiac_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    fullName: text("full_name").notNull(),
    birthday: text("birthday").notNull(),
    birthTime: text("birth_time").notNull(),
    birthLocation: text("birth_location").notNull(),
    email: text("email"),
    intention: varchar("intention", { length: 16 }),
    gender: varchar("gender", { length: 16 }),
    status: varchar("status", { length: 32 }).notNull().default("pending_payment"),
    generatedContent: longtext("generated_content"),
    sunSign: text("sun_sign"),
    moonSign: text("moon_sign"),
    risingSign: text("rising_sign"),
    lifePath: text("life_path"),
    luluOrderId: text("lulu_order_id"),
    luluStatus: text("lulu_status"),
    shippingAddress: text("shipping_address"),
    sexualOrientation: varchar("sexual_orientation", { length: 32 }),
    relationshipStatus: varchar("relationship_status", { length: 32 }),
    customAffirmations: text("custom_affirmations"),
    luckyNumbers: text("lucky_numbers"),
    referralCode: text("referral_code"),
    referredBy: text("referred_by"),
    referralCount: int("referral_count").notNull().default(0),
    priceUsd: float("price_usd"),
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    interiorPdfUrl: text("interior_pdf_url"),
    coverPdfUrl: text("cover_pdf_url"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    estimatedDelivery: text("estimated_delivery"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`).$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_zodiac_orders_email").on(sql`${t.email}(255)`),
    index("idx_zodiac_orders_status").on(t.status),
    index("idx_zodiac_orders_referral_code").on(sql`${t.referralCode}(64)`),
  ],
);

export const insertZodiacOrderSchema = createInsertSchema(zodiacOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertZodiacOrder = z.infer<typeof insertZodiacOrderSchema>;
export type ZodiacOrder = typeof zodiacOrdersTable.$inferSelect;
