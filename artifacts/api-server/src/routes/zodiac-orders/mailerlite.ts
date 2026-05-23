import { logger } from "../../lib/logger";
import { db, siteSettingsTable } from "@workspace/db";
import type { ZodiacOrder } from "@workspace/db";

type EmailTemplateSettings = {
  testEmailOverride?: string | null;
  emailConfirmSubject?: string | null;
  emailConfirmIntro?: string | null;
  emailBookReadySubject?: string | null;
  emailBookReadyIntro?: string | null;
  emailStuckSubject?: string | null;
  emailStuckIntro?: string | null;
};

async function fetchEmailSettings(): Promise<EmailTemplateSettings> {
  try {
    const rows = await db.select({
      testEmailOverride: siteSettingsTable.testEmailOverride,
      emailConfirmSubject: siteSettingsTable.emailConfirmSubject,
      emailConfirmIntro: siteSettingsTable.emailConfirmIntro,
      emailBookReadySubject: siteSettingsTable.emailBookReadySubject,
      emailBookReadyIntro: siteSettingsTable.emailBookReadyIntro,
      emailStuckSubject: siteSettingsTable.emailStuckSubject,
      emailStuckIntro: siteSettingsTable.emailStuckIntro,
    }).from(siteSettingsTable).limit(1);
    return rows[0] ?? {};
  } catch {
    return {};
  }
}

function buildToList(
  order: ZodiacOrder,
  testOverride: string | null | undefined,
): Array<{ email: string; name: string }> {
  const list: Array<{ email: string; name: string }> = [
    { email: order.email!, name: order.fullName },
  ];
  if (testOverride && testOverride !== order.email) {
    list.push({ email: testOverride, name: `[TEST COPY] ${order.fullName}` });
  }
  return list;
}

// Classic MailerLite API (api.mailerlite.com) — used for subscriber management
const MAILERLITE_CLASSIC_API_URL = "https://api.mailerlite.com/api/v2";
const HOLIGROWTH_PROSPECT_GROUP_ID = "113181813";

function classicHeaders(apiKey: string): Record<string, string> {
  return {
    "X-MailerLite-ApiKey": apiKey,
    "Content-Type": "application/json",
  };
}

async function sendClassicMailerLiteEmail(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${MAILERLITE_CLASSIC_API_URL}/campaigns`, {
    method: "POST",
    headers: {
      ...classicHeaders(apiKey),
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "http_error" | "network_error"; status?: number; message: string };

export async function subscribeToMailerLite(email: string, fullName: string): Promise<SubscribeResult> {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    logger.warn("MAILERLITE_API_KEY not set — skipping subscriber sync");
    return { ok: false, reason: "not_configured", message: "MAILERLITE_API_KEY is not set" };
  }

  try {
    const resp = await fetch(
      `${MAILERLITE_CLASSIC_API_URL}/groups/${HOLIGROWTH_PROSPECT_GROUP_ID}/subscribers`,
      {
        method: "POST",
        headers: classicHeaders(apiKey),
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          fields: {
            first_name: fullName.trim().split(/\s+/)[0] ?? "",
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ status: resp.status, body, email }, "MailerLite legacy subscriber sync failed");
      let parsedMessage = body;
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        if (parsed.error?.message) parsedMessage = parsed.error.message;
      } catch {
        // body wasn't JSON — fall back to raw text
      }
      return { ok: false, reason: "http_error", status: resp.status, message: parsedMessage };
    }

    logger.info({ email }, "MailerLite subscriber synced to Prospect group");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, email }, "MailerLite request threw");
    return { ok: false, reason: "network_error", message };
  }
}

export async function sendOrderConfirmationEmail(order: ZodiacOrder): Promise<void> {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    logger.warn("MAILERLITE_API_KEY not set — skipping confirmation email");
    return;
  }
  if (!order.email) {
    logger.info({ orderId: order.id }, "No email on order — skipping confirmation email");
    return;
  }

  const emailSettings = await fetchEmailSettings();
  const firstName = order.fullName.trim().split(/\s+/)[0] ?? order.fullName;
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "https://holigrowth.com";
  const trackUrl = `${baseUrl}/track`;
  const orderDate = new Date(order.createdAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const cosmicRows = [
    { label: "☀️ Sun Sign", value: order.sunSign },
    { label: "🌙 Moon Sign", value: order.moonSign },
    { label: "⭐ Rising Sign", value: order.risingSign },
    { label: "🔢 Life Path", value: order.lifePath ? `#${order.lifePath}` : null },
  ]
    .filter((r) => r.value)
    .map(
      (r) => `<tr>
        <td style="padding:8px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #1e3a52;">${r.label}</td>
        <td style="padding:8px 16px;color:#e8dfc8;font-size:14px;font-weight:600;border-bottom:1px solid #1e3a52;text-align:right;">${r.value}</td>
      </tr>`,
    )
    .join("");

  const referralSection = order.referralCode
    ? `<div style="margin:24px 0;padding:20px;background:#0e2335;border:1px solid #1e3a52;border-radius:12px;">
        <p style="color:#c9a84c;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin:0 0 8px;">🎁 Share &amp; Give 10% Off</p>
        <p style="color:#9ca3af;font-size:13px;margin:0 0 12px;">Share your personal link — friends get 10% off their book.</p>
        <div style="background:#162d3f;border:1px solid #1e3a52;border-radius:8px;padding:10px 14px;font-family:monospace;font-size:12px;color:#c9a84c;word-break:break-all;">
          ${baseUrl}/?ref=${order.referralCode}
        </div>
      </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your Holistic Growth Life Path Book is Confirmed</title></head>
<body style="margin:0;padding:0;background-color:#0a1520;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background:#0e1b2a;border:1px solid #1e3a52;border-radius:100px;padding:6px 20px;margin-bottom:20px;">
        <span style="color:#c9a84c;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.25em;">✨ Order Confirmed</span>
      </div>
      <h1 style="color:#ffffff;font-size:26px;font-weight:400;margin:0 0 8px;font-style:italic;">The cosmos received your order,<br><strong style="font-style:normal;color:#e8dfc8;">${firstName}!</strong></h1>
      <p style="color:#9ca3af;font-size:14px;margin:0;line-height:1.6;">${emailSettings.emailConfirmIntro ?? "Your personalized Holistic Growth Life Path book has been confirmed. Inside: 40–50 hardbound pages including 30 practical affirmations — 10 each for love, wealth & health — written from your Life Path. We're getting it ready to print and ship to you."}</p>
    </div>

    <!-- Order summary box -->
    <div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 12px;">Order Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;color:#9ca3af;font-size:13px;border-bottom:1px solid #1e3a52;">Order ID</td>
          <td style="padding:8px 0;color:#e8dfc8;font-size:13px;text-align:right;border-bottom:1px solid #1e3a52;font-weight:600;">#${order.id}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#9ca3af;font-size:13px;border-bottom:1px solid #1e3a52;">Date</td>
          <td style="padding:8px 0;color:#e8dfc8;font-size:13px;text-align:right;border-bottom:1px solid #1e3a52;">${orderDate}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#9ca3af;font-size:13px;">Name on Book</td>
          <td style="padding:8px 0;color:#e8dfc8;font-size:13px;text-align:right;font-weight:600;">${order.fullName}</td>
        </tr>
        ${(order.sexualOrientation && order.sexualOrientation !== "prefer_not_to_say") ? `<tr>
          <td style="padding:8px 0;color:#9ca3af;font-size:13px;border-top:1px solid #1e3a52;">Orientation</td>
          <td style="padding:8px 0;color:#e8dfc8;font-size:13px;text-align:right;border-top:1px solid #1e3a52;">${
            order.sexualOrientation === "straight" ? "Straight" :
            order.sexualOrientation === "gay" ? "Gay / Lesbian" :
            order.sexualOrientation === "bisexual" ? "Bisexual" : ""
          }</td>
        </tr>` : ""}
        ${order.relationshipStatus ? `<tr>
          <td style="padding:8px 0;color:#9ca3af;font-size:13px;border-top:1px solid #1e3a52;">Relationship</td>
          <td style="padding:8px 0;color:#e8dfc8;font-size:13px;text-align:right;border-top:1px solid #1e3a52;">${
            order.relationshipStatus === "single" ? "Single" :
            order.relationshipStatus === "in_relationship" ? "In a Relationship" :
            order.relationshipStatus === "married" ? "Married" :
            order.relationshipStatus === "divorced" ? "Divorced" :
            order.relationshipStatus === "widowed" ? "Widowed" :
            order.relationshipStatus === "not_seeking" ? "Not Seeking" : ""
          }</td>
        </tr>` : ""}
      </table>
    </div>

    <!-- Cosmic profile -->
    ${cosmicRows ? `<div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 12px;">Your Cosmic Profile</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${cosmicRows}</table>
    </div>` : ""}

    <!-- Lucky numbers -->
    ${order.luckyNumbers ? `<div style="background:#0e1b2a;border:1px solid #c9a84c33;border-radius:16px;padding:20px;margin-bottom:24px;display:flex;align-items:center;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 6px;">Your Lucky Numbers</p>
      <p style="color:#c9a84c;font-size:22px;font-weight:700;margin:0;letter-spacing:.1em;">${order.luckyNumbers}</p>
    </div>` : ""}

    <!-- Referral -->
    ${referralSection}

    <!-- Track CTA -->
    <div style="text-align:center;margin:32px 0;">
      <a href="${trackUrl}" style="display:inline-block;background:#c9a84c;color:#0e1b2a;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;letter-spacing:.04em;">Track Your Order →</a>
    </div>

    <!-- What happens next -->
    <div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:32px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 16px;">What happens next</p>
      ${[
        ["01", "Enter your shipping address on the website"],
        ["02", "We send your book file to Lulu Press for printing"],
        ["03", "Your full-color hardcover is printed &amp; packed"],
        ["04", "Delivered to your door in 2–3 weeks"],
      ]
        .map(
          ([n, t]) =>
            `<div style="display:flex;gap:12px;margin-bottom:12px;">
              <span style="color:#c9a84c;font-size:11px;font-family:monospace;padding-top:2px;flex-shrink:0;">${n}</span>
              <span style="color:#9ca3af;font-size:13px;line-height:1.5;">${t}</span>
            </div>`,
        )
        .join("")}
    </div>

    <!-- Footer -->
    <div style="text-align:center;border-top:1px solid #1e3a52;padding-top:20px;">
      <p style="color:#4b5563;font-size:12px;margin:0 0 4px;">Questions? We're here to help.</p>
      <a href="mailto:hello@holigrowth.com" style="color:#c9a84c;font-size:12px;text-decoration:none;">hello@holigrowth.com</a>
      <p style="color:#374151;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Holistic Growth LLC · All rights reserved</p>
    </div>

  </div>
</body>
</html>`;

  try {
    const resp = await sendClassicMailerLiteEmail(apiKey, {
      subject: emailSettings.emailConfirmSubject?.replace("{{firstName}}", firstName) ?? `Your Holistic Growth Life Path Book is Confirmed, ${firstName}! ✨`,
      emails: buildToList(order, emailSettings.testEmailOverride).map((entry) => ({
        to: entry.email,
        subject: emailSettings.emailConfirmSubject?.replace("{{firstName}}", firstName) ?? `Your Holistic Growth Life Path Book is Confirmed, ${firstName}! ✨`,
        content: html,
      })),
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ status: resp.status, body, orderId: order.id }, "Confirmation email send failed");
    } else {
      logger.info({ email: order.email, orderId: order.id }, "Confirmation email sent");
    }
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "Confirmation email request threw — skipping");
  }
}

export async function sendBookReadyEmail(order: ZodiacOrder): Promise<void> {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    logger.warn("MAILERLITE_API_KEY not set — skipping book ready email");
    return;
  }
  if (!order.email) {
    logger.info({ orderId: order.id }, "No email on order — skipping book ready email");
    return;
  }

  const emailSettings = await fetchEmailSettings();
  const firstName = order.fullName.trim().split(/\s+/)[0] ?? order.fullName;
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "https://holigrowth.com";
  const previewUrl = `${baseUrl}/order/${order.id}`;
  const checkoutUrl = `${baseUrl}/order/${order.id}/checkout`;

  const cosmicRows = [
    { label: "☀️ Sun Sign",    value: order.sunSign },
    { label: "🌙 Moon Sign",   value: order.moonSign },
    { label: "⭐ Rising Sign", value: order.risingSign },
    { label: "🔢 Life Path",   value: order.lifePath ? `#${order.lifePath}` : null },
  ]
    .filter((r) => r.value)
    .map(
      (r) => `<tr>
        <td style="padding:8px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #1e3a52;">${r.label}</td>
        <td style="padding:8px 16px;color:#e8dfc8;font-size:14px;font-weight:600;border-bottom:1px solid #1e3a52;text-align:right;">${r.value}</td>
      </tr>`,
    )
    .join("");

  const excerpt = order.generatedContent
    ? order.generatedContent.slice(0, 300).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "…"
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your Life Path Book is Ready, ${firstName}!</title></head>
<body style="margin:0;padding:0;background-color:#0a1520;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background:#0e1b2a;border:1px solid #c9a84c33;border-radius:100px;padding:6px 20px;margin-bottom:20px;">
        <span style="color:#c9a84c;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.25em;">✨ Your Book is Ready</span>
      </div>
      <h1 style="color:#ffffff;font-size:26px;font-weight:400;margin:0 0 8px;font-style:italic;">The cosmos has spoken,<br><strong style="font-style:normal;color:#e8dfc8;">${firstName}!</strong></h1>
      <p style="color:#9ca3af;font-size:14px;margin:0;line-height:1.6;">${emailSettings.emailBookReadyIntro ?? "Your personalized Holistic Growth Life Path book has been written — 40–50 full-color pages crafted just for you, including 30 practical affirmations written from your Life Path (10 each for love, wealth & health)."}</p>
    </div>

    <!-- Cosmic profile -->
    ${cosmicRows ? `<div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 12px;">Your Cosmic Profile</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${cosmicRows}</table>
    </div>` : ""}

    <!-- Personal details for book-ready email -->
    ${(order.sexualOrientation && order.sexualOrientation !== "prefer_not_to_say") || order.relationshipStatus ? `<div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 12px;">Personalised For You</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${(order.sexualOrientation && order.sexualOrientation !== "prefer_not_to_say") ? `<tr>
          <td style="padding:8px 16px;color:#9ca3af;font-size:13px;border-bottom:1px solid #1e3a52;">Orientation</td>
          <td style="padding:8px 16px;color:#e8dfc8;font-size:14px;font-weight:600;border-bottom:1px solid #1e3a52;text-align:right;">${
            order.sexualOrientation === "straight" ? "Straight" :
            order.sexualOrientation === "gay" ? "Gay / Lesbian" :
            order.sexualOrientation === "bisexual" ? "Bisexual" : ""
          }</td>
        </tr>` : ""}
        ${order.relationshipStatus ? `<tr>
          <td style="padding:8px 16px;color:#9ca3af;font-size:13px;">Relationship</td>
          <td style="padding:8px 16px;color:#e8dfc8;font-size:14px;font-weight:600;text-align:right;">${
            order.relationshipStatus === "single" ? "Single" :
            order.relationshipStatus === "in_relationship" ? "In a Relationship" :
            order.relationshipStatus === "married" ? "Married" :
            order.relationshipStatus === "divorced" ? "Divorced" :
            order.relationshipStatus === "widowed" ? "Widowed" :
            order.relationshipStatus === "not_seeking" ? "Not Seeking" : ""
          }</td>
        </tr>` : ""}
      </table>
    </div>` : ""}

    <!-- Lucky numbers -->
    ${order.luckyNumbers ? `<div style="background:#0e1b2a;border:1px solid #c9a84c33;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 6px;">Your Lucky Numbers</p>
      <p style="color:#c9a84c;font-size:22px;font-weight:700;margin:0;letter-spacing:.1em;">${order.luckyNumbers}</p>
    </div>` : ""}

    <!-- Excerpt preview -->
    ${excerpt ? `<div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 12px;">A glimpse into your pages…</p>
      <p style="color:#9ca3af;font-size:14px;line-height:1.8;margin:0;font-style:italic;">${excerpt}</p>
    </div>` : ""}

    <!-- Primary CTA -->
    <div style="text-align:center;margin:32px 0 16px;">
      <a href="${previewUrl}" style="display:inline-block;background:#c9a84c;color:#0e1b2a;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;letter-spacing:.04em;">Read Your Book Preview →</a>
    </div>
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${checkoutUrl}" style="display:inline-block;background:transparent;color:#c9a84c;text-decoration:none;font-size:13px;font-weight:600;padding:10px 24px;border-radius:10px;border:1px solid #c9a84c44;">Order My Hardcover Book →</a>
    </div>

    <!-- What's inside -->
    <div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:32px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 16px;">What's inside your book</p>
      ${[
        ["❤️", "Relationships", "Soul mate blueprint, love languages, timing &amp; <strong>10 personal affirmations</strong>"],
        ["💰", "Wealth",        "Financial destiny, abundance, lucky windows &amp; <strong>10 personal affirmations</strong>"],
        ["🌿", "Health",        "Vitality practices, seasonal rhythms, body code &amp; <strong>10 personal affirmations</strong>"],
        ["📅", "Monthly Forecast", "12-month cosmic outlook, month by month"],
      ]
        .map(
          ([icon, title, desc]) =>
            `<div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start;">
              <span style="font-size:18px;flex-shrink:0;">${icon}</span>
              <div>
                <span style="color:#e8dfc8;font-size:13px;font-weight:600;">${title}</span>
                <span style="color:#9ca3af;font-size:13px;"> — ${desc}</span>
              </div>
            </div>`,
        )
        .join("")}
    </div>

    <!-- Footer -->
    <div style="text-align:center;border-top:1px solid #1e3a52;padding-top:20px;">
      <p style="color:#4b5563;font-size:12px;margin:0 0 4px;">Questions? We're here to help.</p>
      <a href="mailto:hello@holigrowth.com" style="color:#c9a84c;font-size:12px;text-decoration:none;">hello@holigrowth.com</a>
      <p style="color:#374151;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Holistic Growth LLC · All rights reserved</p>
    </div>

  </div>
</body>
</html>`;

  try {
    const resp = await sendClassicMailerLiteEmail(apiKey, {
      subject: emailSettings.emailBookReadySubject?.replace("{{firstName}}", firstName) ?? `Your Life Path Book is Ready, ${firstName}! ✨`,
      emails: buildToList(order, emailSettings.testEmailOverride).map((entry) => ({
        to: entry.email,
        subject: emailSettings.emailBookReadySubject?.replace("{{firstName}}", firstName) ?? `Your Life Path Book is Ready, ${firstName}! ✨`,
        content: html,
      })),
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ status: resp.status, body, orderId: order.id }, "Book ready email send failed");
    } else {
      logger.info({ email: order.email, orderId: order.id }, "Book ready email sent");
    }
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "Book ready email request threw — skipping");
  }
}

export async function sendGenerationStuckEmail(order: ZodiacOrder): Promise<void> {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    logger.warn("MAILERLITE_API_KEY not set — skipping generation stuck email");
    return;
  }
  if (!order.email) {
    logger.info({ orderId: order.id }, "No email on order — skipping generation stuck email");
    return;
  }

  const emailSettings = await fetchEmailSettings();
  const firstName = order.fullName.trim().split(/\s+/)[0] ?? order.fullName;
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "https://holigrowth.com";
  const retryUrl = `${baseUrl}/order/${order.id}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>A small cosmic hiccup, ${firstName}</title></head>
<body style="margin:0;padding:0;background-color:#0a1520;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background:#0e1b2a;border:1px solid #c9a84c33;border-radius:100px;padding:6px 20px;margin-bottom:20px;">
        <span style="color:#c9a84c;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.25em;">⏳ Still Working on Your Book</span>
      </div>
      <h1 style="color:#ffffff;font-size:26px;font-weight:400;margin:0 0 8px;font-style:italic;">A small cosmic hiccup,<br><strong style="font-style:normal;color:#e8dfc8;">${firstName}</strong></h1>
      <p style="color:#9ca3af;font-size:14px;margin:0;line-height:1.6;">${emailSettings.emailStuckIntro ?? "We ran into a brief interruption while writing your personalized Life Path book. Your order is safe and just needs one more attempt to complete."}</p>
    </div>

    <!-- What happened box -->
    <div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 12px;">What happened?</p>
      <p style="color:#9ca3af;font-size:13px;line-height:1.7;margin:0;">Sometimes the stars need a moment to align. Our AI writer occasionally experiences a timeout on extra-detailed charts. Your data is fully saved — all it takes is one click to try again, and it usually completes without any trouble.</p>
    </div>

    <!-- Primary CTA -->
    <div style="text-align:center;margin:32px 0 16px;">
      <a href="${retryUrl}" style="display:inline-block;background:#c9a84c;color:#0e1b2a;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;letter-spacing:.04em;">Retry My Book Generation →</a>
    </div>
    <p style="text-align:center;color:#6b7a8d;font-size:12px;margin:0 0 32px;">Takes you directly to your order page — click "Retry" to resume.</p>

    <!-- Order ref -->
    <div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:16px 20px;margin-bottom:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#9ca3af;font-size:13px;">Order ID</span>
        <span style="color:#e8dfc8;font-size:13px;font-weight:600;">#${order.id}</span>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;border-top:1px solid #1e3a52;padding-top:20px;">
      <p style="color:#4b5563;font-size:12px;margin:0 0 4px;">Still having trouble? We're here to help.</p>
      <a href="mailto:hello@holigrowth.com" style="color:#c9a84c;font-size:12px;text-decoration:none;">hello@holigrowth.com</a>
      <p style="color:#374151;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Holistic Growth LLC · All rights reserved</p>
    </div>

  </div>
</body>
</html>`;

  try {
    const resp = await sendClassicMailerLiteEmail(apiKey, {
      subject: emailSettings.emailStuckSubject?.replace("{{firstName}}", firstName) ?? `A small cosmic hiccup with your book, ${firstName} — here's how to retry`,
      emails: buildToList(order, emailSettings.testEmailOverride).map((entry) => ({
        to: entry.email,
        subject: emailSettings.emailStuckSubject?.replace("{{firstName}}", firstName) ?? `A small cosmic hiccup with your book, ${firstName} — here's how to retry`,
        content: html,
      })),
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ status: resp.status, body, orderId: order.id }, "Generation stuck email send failed");
    } else {
      logger.info({ email: order.email, orderId: order.id }, "Generation stuck email sent");
    }
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "Generation stuck email request threw — skipping");
  }
}

export async function sendTestEmail(
  emailType: "confirm" | "bookReady" | "stuck",
): Promise<{ ok: boolean; error?: string }> {
  const emailSettings = await fetchEmailSettings();
  const toEmail = emailSettings.testEmailOverride;
  if (!toEmail) {
    return { ok: false, error: "No test email override set in settings" };
  }

  const fakeOrder = {
    id: 0,
    fullName: "Alex Sample",
    email: toEmail,
    birthday: "1990-06-15",
    birthTime: "14:30",
    birthLocation: "New York, USA",
    intention: "myself",
    gender: "female",
    sexualOrientation: null,
    relationshipStatus: "single",
    status: "generated",
    sunSign: "Gemini",
    moonSign: "Scorpio",
    risingSign: "Capricorn",
    lifePath: "7",
    luckyNumbers: "3, 7, 12, 21",
    referralCode: "SAMPLE123",
    referredBy: null,
    referralCount: 0,
    luluOrderId: null,
    luluStatus: null,
    shippingAddress: null,
    priceUsd: 99.99,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    interiorPdfUrl: null,
    coverPdfUrl: null,
    trackingNumber: null,
    trackingUrl: null,
    estimatedDelivery: null,
    marketingOptIn: false,
    generatedContent:
      "The stars have aligned in a remarkable pattern at the moment of your birth. Your Gemini sun gives you a natural curiosity and adaptability that will serve you throughout this year. This is a year of transformation and growth — your cosmic blueprint reveals unique opportunities in relationships, wealth, and health that are yours to claim.",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ZodiacOrder;

  try {
    if (emailType === "confirm") {
      await sendOrderConfirmationEmail(fakeOrder);
    } else if (emailType === "bookReady") {
      await sendBookReadyEmail(fakeOrder);
    } else {
      await sendGenerationStuckEmail(fakeOrder);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function sendShippedEmail(order: ZodiacOrder): Promise<void> {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    logger.warn("MAILERLITE_API_KEY not set — skipping shipped email");
    return;
  }
  if (!order.email) {
    logger.info({ orderId: order.id }, "No email on order — skipping shipped email");
    return;
  }

  const firstName = order.fullName.trim().split(/\s+/)[0] ?? order.fullName;
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "https://holigrowth.com";
  const trackingPageUrl = `${baseUrl}/track?email=${encodeURIComponent(order.email)}`;

  const trackingSection = order.trackingNumber
    ? `<div style="background:#0e1b2a;border:1px solid #c9a84c33;border-radius:16px;padding:20px;margin-bottom:24px;">
        <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 12px;">📦 Tracking Information</p>
        <p style="margin:0 0 8px;">
          <span style="color:#9ca3af;font-size:13px;">Tracking Number: </span>
          <span style="color:#c9a84c;font-size:14px;font-weight:700;font-family:monospace;">${order.trackingNumber}</span>
        </p>
        ${order.estimatedDelivery ? `<p style="margin:0 0 8px;">
          <span style="color:#9ca3af;font-size:13px;">Estimated Arrival: </span>
          <span style="color:#e8dfc8;font-size:13px;font-weight:600;">${new Date(order.estimatedDelivery).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        </p>` : ""}
        ${order.trackingUrl ? `<div style="margin-top:12px;">
          <a href="${order.trackingUrl}" style="display:inline-block;background:#c9a84c22;color:#c9a84c;text-decoration:none;font-size:12px;font-weight:600;padding:8px 18px;border-radius:8px;border:1px solid #c9a84c44;">Track My Package →</a>
        </div>` : ""}
      </div>`
    : `<div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
        <p style="color:#9ca3af;font-size:13px;margin:0;">Your tracking number will be available shortly from your carrier. Typical delivery is 2–3 weeks from your order date.</p>
      </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your Life Path Book is on its Way, ${firstName}!</title></head>
<body style="margin:0;padding:0;background-color:#0a1520;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background:#0e1b2a;border:1px solid #c9a84c33;border-radius:100px;padding:6px 20px;margin-bottom:20px;">
        <span style="color:#c9a84c;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.25em;">📬 Your Book is Shipped!</span>
      </div>
      <h1 style="color:#ffffff;font-size:26px;font-weight:400;margin:0 0 8px;font-style:italic;">It's on its way,<br><strong style="font-style:normal;color:#e8dfc8;">${firstName}!</strong></h1>
      <p style="color:#9ca3af;font-size:14px;margin:0;line-height:1.6;">Your personalized Holistic Growth Life Path hardcover book has left the printer and is headed to you. ✨</p>
    </div>

    <!-- Tracking -->
    ${trackingSection}

    <!-- What to expect -->
    <div style="background:#0e1b2a;border:1px solid #1e3a52;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="color:#6b7a8d;font-size:11px;text-transform:uppercase;letter-spacing:.2em;margin:0 0 16px;">What to expect</p>
      ${[
        ["📦", "Delivered to your door", "Your book is shipped directly from our print partner"],
        ["🎁", "Full-color hardcover",   "40–50 pages, premium glossy cover, made just for you"],
        ["🌟", "Ready to read",          "Your cosmic insights, numerology &amp; yearly forecast inside"],
      ]
        .map(
          ([icon, title, desc]) =>
            `<div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start;">
              <span style="font-size:18px;flex-shrink:0;">${icon}</span>
              <div>
                <span style="color:#e8dfc8;font-size:13px;font-weight:600;">${title}</span>
                <span style="color:#9ca3af;font-size:13px;"> — ${desc}</span>
              </div>
            </div>`,
        )
        .join("")}
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin:32px 0 24px;">
      <a href="${trackingPageUrl}" style="display:inline-block;background:#c9a84c;color:#0e1b2a;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;letter-spacing:.04em;">View Order Status →</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;border-top:1px solid #1e3a52;padding-top:20px;">
      <p style="color:#4b5563;font-size:12px;margin:0 0 4px;">Questions about your delivery?</p>
      <a href="mailto:hello@holigrowth.com" style="color:#c9a84c;font-size:12px;text-decoration:none;">hello@holigrowth.com</a>
      <p style="color:#374151;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Holistic Growth LLC · All rights reserved</p>
    </div>

  </div>
</body>
</html>`;

  try {
    const resp = await sendClassicMailerLiteEmail(apiKey, {
      subject: `Your Life Path book is on its way, ${firstName}! 📬`,
      emails: [
        {
          to: order.email,
          subject: `Your Life Path book is on its way, ${firstName}! 📬`,
          content: html,
        },
      ],
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ status: resp.status, body, orderId: order.id }, "Shipped email send failed");
    } else {
      logger.info({ email: order.email, orderId: order.id }, "Shipped email sent");
    }
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "Shipped email request threw — skipping");
  }
}
