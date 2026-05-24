import type { ZodiacOrder } from "@workspace/db";
import { logger } from "../../lib/logger";

// ─── Book Specifications ──────────────────────────────────────────────────────
// Size:          US Trade 6" × 9"
// Binding:       Hardcover Case Wrap
// Interior:      Standard Color (Full Color)
// Paper:         60# White — Uncoated
// Cover Finish:  Glossy
// Page Count:    40–60 pages
// Pod Package:   0600X0900FCSTDHC060CW444GXX
// ─────────────────────────────────────────────────────────────────────────────

const POD_PACKAGE_ID = "0600X0900FCSTDHC060CW444GXX";
const BOOK_MIN_PAGES = 40;
const BOOK_MAX_PAGES = 60;

interface ShippingDetails {
  shippingName: string;
  shippingAddress1: string;
  shippingAddress2?: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
  email: string;
}

interface LuluResult {
  orderId: string;
  status: string;
  priceUsd: number;
}

// Sandbox vs prod selection. Set LULU_SANDBOX=true in .env to route every
// request to api.sandbox.lulu.com instead of the production API. Sandbox
// orders are free, never printed/shipped, and only visible in the sandbox
// account at https://developers.sandbox.lulu.com — use this for end-to-end
// tests against real Lulu APIs. Default is production; you must opt into
// sandbox explicitly so a missing env var can never silently swallow a
// real customer order.
const LULU_SANDBOX = process.env.LULU_SANDBOX === "true";
const LULU_BASE_URL = LULU_SANDBOX
  ? "https://api.sandbox.lulu.com"
  : "https://api.lulu.com";
const LULU_CLIENT_KEY = process.env.LULU_CLIENT_KEY;
const LULU_CLIENT_SECRET = process.env.LULU_CLIENT_SECRET;

async function getLuluAccessToken(): Promise<string> {
  if (!LULU_CLIENT_KEY || !LULU_CLIENT_SECRET) {
    throw new Error(
      "Lulu API credentials not configured. Please set LULU_CLIENT_KEY and LULU_CLIENT_SECRET.",
    );
  }

  const credentials = Buffer.from(`${LULU_CLIENT_KEY}:${LULU_CLIENT_SECRET}`).toString("base64");

  const response = await fetch(
    `${LULU_BASE_URL}/auth/realms/glasstree/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials",
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Lulu authentication failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Converts the AI-generated markdown content into a styled HTML document
 * sized and formatted for US Trade 6" × 9" hardcover case wrap.
 *
 * Color interiors (FCSTD) support full CSS color, gradients, and rich styling.
 */
function formatContentForBook(order: ZodiacOrder, content: string): string {
  // US Trade 6" × 9" — 0.75" margins give a comfortable 4.5" readable line length
  const pageWidth = "6in";
  const pageHeight = "9in";
  const margin = "0.75in";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Holistic Growth Life Path — ${order.fullName}</title>
  <style>
    @page {
      size: ${pageWidth} ${pageHeight};
      margin: ${margin};
    }

    * { box-sizing: border-box; }

    body {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 11pt;
      line-height: 1.7;
      color: #1e1b2e;
      background: #fff;
      margin: 0;
      padding: 0;
    }

    /* ── Cover page ── */
    .cover {
      width: 100%;
      height: calc(${pageHeight} - (2 * ${margin}));
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      page-break-after: always;
      background: linear-gradient(160deg, #1a0533 0%, #3b1260 60%, #6b3fa0 100%);
      color: #fff;
      border-radius: 4px;
      padding: 1in;
    }

    .cover-brand {
      font-size: 10pt;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: #c9a96e;
      margin-bottom: 0.5in;
    }

    .cover-title {
      font-size: 26pt;
      font-weight: bold;
      line-height: 1.2;
      color: #fff;
      margin: 0 0 0.2in;
    }

    .cover-subtitle {
      font-size: 13pt;
      font-style: italic;
      color: #d4b8f0;
      margin-bottom: 0.15in;
    }

    .cover-name {
      font-size: 18pt;
      color: #c9a96e;
      font-style: italic;
      margin: 0.1in 0;
    }

    .cover-birth {
      font-size: 9pt;
      color: #b89fd4;
      margin-top: 0.3in;
      letter-spacing: 0.05em;
    }

    .cover-ornament {
      font-size: 28pt;
      margin: 0.2in 0;
      color: #c9a96e;
    }

    /* ── Pillar divider pages ── */
    .pillar-page {
      page-break-before: always;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      height: calc(${pageHeight} - (2 * ${margin}));
      color: #3b1260;
    }

    .pillar-number {
      font-size: 60pt;
      font-weight: 900;
      color: #e8d5f5;
      line-height: 1;
      margin-bottom: 0.1in;
    }

    .pillar-label {
      font-size: 9pt;
      letter-spacing: 0.4em;
      text-transform: uppercase;
      color: #c9a96e;
      margin-bottom: 0.15in;
    }

    .pillar-title {
      font-size: 24pt;
      font-weight: bold;
      color: #3b1260;
    }

    /* ── Chapter headings ── */
    h1 {
      font-size: 20pt;
      color: #3b1260;
      text-align: center;
      margin-top: 0.5in;
      margin-bottom: 0.25in;
      page-break-before: always;
      border-bottom: 2px solid #c9a96e;
      padding-bottom: 0.1in;
    }

    h2 {
      font-size: 15pt;
      color: #5c2d91;
      margin-top: 0.4in;
      margin-bottom: 0.15in;
    }

    h3 {
      font-size: 12pt;
      color: #7b4bb8;
      margin-top: 0.3in;
      margin-bottom: 0.1in;
      font-style: italic;
    }

    p {
      margin-bottom: 0.12in;
      text-align: justify;
      orphans: 3;
      widows: 3;
    }

    /* ── Highlight boxes ── */
    .callout {
      background: #f5eeff;
      border-left: 4px solid #7b4bb8;
      border-radius: 0 4px 4px 0;
      padding: 0.12in 0.15in;
      margin: 0.2in 0;
      font-style: italic;
      color: #3b1260;
    }

    /* ── Lucky numbers ── */
    .lucky-numbers {
      display: flex;
      gap: 0.1in;
      justify-content: center;
      flex-wrap: wrap;
      margin: 0.2in 0;
    }

    .lucky-number {
      background: #3b1260;
      color: #c9a96e;
      border-radius: 50%;
      width: 0.45in;
      height: 0.45in;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13pt;
      font-weight: bold;
    }

    /* ── Footer ── */
    @page {
      @bottom-center {
        content: counter(page);
        font-size: 9pt;
        color: #999;
        font-family: Georgia, serif;
      }
    }

    strong { color: #3b1260; }
    em { color: #5c2d91; }

    .page-break { page-break-before: always; }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover">
    <div class="cover-brand">Holigrowth · Holistic Growth Life Path</div>
    <div class="cover-ornament">☽ ✦ ☉</div>
    <div class="cover-title">Your Personal<br>Life Path Book</div>
    <div class="cover-subtitle">A Holistic Growth Life Path Book Crafted for</div>
    <div class="cover-name">${order.fullName}</div>
    <div class="cover-birth">
      Born ${order.birthday} · ${order.birthTime}<br>
      ${order.birthLocation}
    </div>
  </div>

  <!-- Generated Content -->
  ${content
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<div class="callout">$1</div>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[h1-6|d])/gm, '<p>')
  }

</body>
</html>`;
}

export interface LuluOrderStatus {
  status: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  estimatedDelivery: string | null;
}

export async function getLuluOrderStatus(luluOrderId: string): Promise<LuluOrderStatus> {
  if (!LULU_CLIENT_KEY || !LULU_CLIENT_SECRET) {
    logger.warn({ luluOrderId }, "Lulu credentials not set — skipping status fetch");
    return { status: "UNKNOWN", trackingNumber: null, trackingUrl: null, estimatedDelivery: null };
  }

  const token = await getLuluAccessToken();

  const response = await fetch(`${LULU_BASE_URL}/print-jobs/${luluOrderId}/`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Lulu status fetch failed: ${response.status} ${errText}`);
  }

  const data = (await response.json()) as {
    status?: { name?: string };
    line_items?: Array<{
      tracking_id?: string;
      tracking_urls?: string[];
      estimated_shipping_dates?: { ship?: string[] };
    }>;
  };

  const lineItem = data.line_items?.[0];
  const trackingNumber = lineItem?.tracking_id ?? null;
  const trackingUrl = lineItem?.tracking_urls?.[0] ?? null;
  const estimatedDelivery = lineItem?.estimated_shipping_dates?.ship?.[0] ?? null;

  return {
    status: data.status?.name ?? "UNKNOWN",
    trackingNumber,
    trackingUrl,
    estimatedDelivery,
  };
}

export async function submitBookToLulu({
  order,
  shippingDetails,
}: {
  order: ZodiacOrder;
  shippingDetails: ShippingDetails;
}): Promise<LuluResult> {
  if (!order.generatedContent) {
    throw new Error("No generated content available for this order");
  }

  const pageCount = estimatePageCount(order.generatedContent);
  logger.info(
    { orderId: order.id, pageCount, podPackageId: POD_PACKAGE_ID },
    "Preparing Lulu print job",
  );

  // If Lulu credentials are not configured, simulate for demo/dev
  if (!LULU_CLIENT_KEY || !LULU_CLIENT_SECRET) {
    logger.warn("Lulu API credentials not set — using simulated order for demo");
    return {
      orderId: `DEMO-${Date.now()}`,
      status: "DEMO_ORDER",
      priceUsd: 49.99,
    };
  }

  if (!order.interiorPdfUrl || !order.coverPdfUrl) {
    throw new Error(
      "PDF files not yet generated for this order. Run the generate step first.",
    );
  }

  const token = await getLuluAccessToken();

  const printJobResponse = await fetch(`${LULU_BASE_URL}/print-jobs/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contact_email: shippingDetails.email,
      line_items: [
        {
          title: `Holistic Growth Life Path — ${order.fullName}`,
          cover: {
            source_url: order.coverPdfUrl,
          },
          interior: {
            source_url: order.interiorPdfUrl,
          },
          pod_package_id: POD_PACKAGE_ID,
          page_count: pageCount,
          quantity: 1,
          external_id: String(order.id),
        },
      ],
      shipping_address: {
        name: shippingDetails.shippingName,
        street1: shippingDetails.shippingAddress1,
        street2: shippingDetails.shippingAddress2 ?? "",
        city: shippingDetails.shippingCity,
        state_code: shippingDetails.shippingState,
        postcode: shippingDetails.shippingZip,
        country_code: shippingDetails.shippingCountry,
        phone_number: "",
        email: shippingDetails.email,
      },
      shipping_option_level: "MAIL",
      production_delay: 0,
    }),
  });

  if (!printJobResponse.ok) {
    const errText = await printJobResponse.text();
    throw new Error(`Lulu print job creation failed: ${printJobResponse.status} ${errText}`);
  }

  const printJob = (await printJobResponse.json()) as {
    id: string;
    status: { name: string };
    costs?: { total_cost_excl_tax?: string };
  };

  const priceRaw = printJob.costs?.total_cost_excl_tax;
  const priceUsd = priceRaw ? parseFloat(priceRaw) : 49.99;

  return {
    orderId: String(printJob.id),
    status: printJob.status?.name ?? "CREATED",
    priceUsd,
  };
}

/**
 * Estimates the page count based on content length.
 * Clamps to the allowed 40–60 page range.
 * US Trade 6×9 at 11pt / 1.7 line-height ≈ 350 words per page.
 */
function estimatePageCount(content: string): number {
  const wordCount = content.split(/\s+/).length;
  const estimated = Math.round(wordCount / 350);
  return Math.min(BOOK_MAX_PAGES, Math.max(BOOK_MIN_PAGES, estimated));
}

/**
 * Builds a cover URL. In production this should point to a generated
 * full-bleed cover PDF sized for US Trade 6" × 9" case wrap (back + spine +
 * front, bleed on all edges). Currently returns a placeholder gradient cover.
 */
function buildCoverUrl(order: ZodiacOrder): string {
  // TODO: replace with a pre-rendered cover PDF stored in object storage
  // Cover PDF dimensions: Lulu one-piece case wrap for 6×9 HC
  logger.warn(
    { orderId: order.id },
    "Using placeholder cover URL — replace with real cover PDF in production",
  );
  return "https://via.placeholder.com/1300x900/3b1260/c9a96e?text=Holistic+Growth+Life+Path";
}

/**
 * Registers a webhook endpoint with Lulu's API so Lulu pushes status updates
 * (IN_PRODUCTION, SHIPPED, DELIVERED) automatically.
 *
 * Idempotent — if the URL is already registered it skips re-registration.
 * Returns the webhook record created or already existing.
 */
export async function registerLuluWebhook(webhookUrl: string): Promise<{
  id: string | number;
  url: string;
  events: string[];
  alreadyExisted: boolean;
}> {
  const token = await getLuluAccessToken();

  // Check existing webhooks to avoid duplicates
  const listResp = await fetch(`${LULU_BASE_URL}/webhooks/`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (listResp.ok) {
    const existing = (await listResp.json()) as {
      results?: Array<{ id: string | number; url: string; events: string[] }>;
    };
    const match = existing.results?.find((w) => w.url === webhookUrl);
    if (match) {
      logger.info({ webhookId: match.id, webhookUrl }, "Lulu webhook already registered — skipping");
      return { ...match, alreadyExisted: true };
    }
  }

  const createResp = await fetch(`${LULU_BASE_URL}/webhooks/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      url: webhookUrl,
      events: ["print_job.status.changed"],
    }),
  });

  if (!createResp.ok) {
    const errorText = await createResp.text();
    throw new Error(`Failed to register Lulu webhook: ${createResp.status} ${errorText}`);
  }

  const record = (await createResp.json()) as { id: string | number; url: string; events: string[] };
  logger.info({ webhookId: record.id, webhookUrl }, "Lulu webhook registered successfully");
  return { ...record, alreadyExisted: false };
}

/**
 * Uploads the HTML interior to a publicly accessible URL for Lulu to fetch.
 * In production, upload to object storage (S3 / Replit App Storage).
 * Currently returns a base64 data URL as a dev fallback.
 */
async function uploadContentAndGetUrl(htmlContent: string, _token: string): Promise<string> {
  logger.warn(
    "uploadContentAndGetUrl: using base64 data URL — integrate with object storage before going live",
  );
  const base64 = Buffer.from(htmlContent).toString("base64");
  return `data:text/html;base64,${base64}`;
}
