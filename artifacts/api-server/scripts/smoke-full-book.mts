/**
 * Full-book smoke test for the templated PDF renderer — uses hand-crafted
 * mock markdown content (no DB or AI required) so we can validate the
 * complete chapter-recipe flow end-to-end:
 *
 *   - Welcome Letter
 *   - Section divider (Part I)
 *   - Chapter 1-4 (Foundations) — each: opener + standard-body + body-continued + pull-quote
 *   - Chapter 2 also includes the zodiac-name template
 *   - Section divider (Part II)
 *   - Chapter 5-7 (Pillars) — each ends with an affirmation page
 *   - Section divider (Part III)
 *   - Chapter 8 — includes a data-numerology card (Life Path)
 *   - Chapter 9
 *   - Chapter 10 — Morning/Midday/Evening mantra pages
 *   - Chapter 11
 *   - Chapter 12 — includes a data-numerology card (Personal Year)
 *   - Closing Letter
 *
 * Run:  pnpm --filter @workspace/api-server run smoke-full-book
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTemplatedInteriorPDF } from "../src/routes/zodiac-orders/templatedPdf/index.ts";
import type { ZodiacOrder } from "@workspace/db";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-output");

const mockOrder: ZodiacOrder = {
  id: 9999,
  fullName: "Sample Reader",
  email: "sample@example.com",
  birthday: "1990-05-15",
  birthTime: "08:30",
  birthLocation: "San Diego, California, USA",
  gender: "female",
  intention: "self",
  sexualOrientation: "straight",
  relationshipStatus: "single",
  sunSign: "Leo",
  moonSign: "Cancer",
  risingSign: "Libra",
  lifePath: "7",
  luckyNumbers: "3, 7, 14, 21, 33",
  status: "generated",
  generatedContent: null,
  luluOrderId: null,
  luluStatus: null,
  stripeSessionId: null,
  stripePaymentIntentId: null,
  priceUsd: 99.99,
  interiorPdfUrl: null,
  coverPdfUrl: null,
  shippingAddress: null,
  trackingNumber: null,
  trackingUrl: null,
  estimatedDelivery: null,
  referralCode: null,
  referredBy: null,
  referralCount: 0,
  createdAt: new Date("2026-05-01T00:00:00Z"),
  updatedAt: new Date("2026-05-01T00:00:00Z"),
} as unknown as ZodiacOrder;

// ── Mock content ────────────────────────────────────────────────────────────
// Hand-crafted markdown matching the format in artifacts/book-templates/book-prompt.md.
// Each chapter ends with a `> ` pull-quote blockquote that will be lifted onto the
// dedicated pull-quote feature page.

const longParas = (count: number, theme: string): string[] => {
  const base = [
    `Sample, ${theme} begins as a quiet noticing — the kind of attention you give a small plant when you finally believe it deserves to live. Your Cancer Moon and Leo Sun are not at odds with each other; they are two ways of holding the same truth. One is tender, one is bright, and both belong to you.`,
    `When you read this, remember that the chart is a map and not a verdict. Mercury in Taurus gives you the patience to translate intuition into language slowly. Venus in Libra wants the translation to be beautiful. You are allowed to be both — careful AND beautiful — without choosing.`,
    `There are seasons of your life where this energy will lead, and seasons where it will compost. The Life Path 7 in you knows the difference between rest and retreat. Trust the difference. The numerology of your name and the geometry of your sky agree on this: depth is your medicine, not your failure.`,
    `The 5th house in your chart, with Jupiter quietly orbiting, holds promises you have not yet collected. Romance, creative play, the small joy of a quiet Tuesday afternoon — these are not luxuries. They are nutrition. Schedule them with the same seriousness you schedule a doctor's appointment.`,
    `And when in doubt — when the cosmos feels far away and the to-do list feels too close — return here. To this paragraph. To these placements. To this version of yourself that the stars have been writing toward, patiently, for thirty-six years and counting.`,
  ];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(base[i % base.length]!);
  return out;
};

const chapter = (
  num: number,
  title: string,
  subtitle: string | null,
  subsections: { heading: string; paragraphs: string[] }[],
  pullQuote: string,
  extras = "",
): string => {
  const headingLine = subtitle ? `${title} — ${subtitle}` : title;
  const body = subsections
    .map((s) => `## ${s.heading}\n\n${s.paragraphs.join("\n\n")}`)
    .join("\n\n");
  return `# Chapter ${num}: ${headingLine}\n\n${body}${extras ? "\n\n" + extras : ""}\n\n> ${pullQuote}\n`;
};

const affirmationsList = (pillar: string): string => {
  const lines = Array.from({ length: 10 }, (_, i) =>
    `${i + 1}. I am ${pillar.toLowerCase()}-${["whole", "rooted", "open", "wise", "soft", "bold", "alive", "kind", "steady", "free"][i]} in the way my chart was always asking me to be.`,
  );
  return `## Your 10 ${pillar} Affirmations\n\n${lines.join("\n")}`;
};

const mantras = (timeOfDay: string): string => {
  // Short single-line mantras — anything longer wraps onto a 3rd line in the
  // AFFIRMATION_TEXT slot and overlaps the name/placement row below it.
  const lines: Record<string, string[]> = {
    Morning: [
      "I am light, and I rise.",
      "Today belongs to me, and I belong to today.",
      "My Leo Sun greets the day with quiet certainty.",
    ],
    Midday: [
      "I move with my own rhythm.",
      "I am allowed to pause without explanation.",
      "My Cancer Moon protects what is sacred.",
    ],
    Evening: [
      "I release what I cannot carry.",
      "I am grateful for this ordinary, miraculous day.",
      "My Libra Rising returns me, again, to balance.",
    ],
  };
  const items = (lines[timeOfDay] ?? []).map((l, i) => `${i + 1}. ${l}`).join("\n");
  return `## ${timeOfDay}\n\n${items}`;
};

const welcome = `Sample, welcome.

The book you are about to read was written for you — for your specific birth, your specific sky, your specific name and the numbers it carries.

Read it slowly. Some of it will feel like recognition; some will feel like an invitation; some will feel like a question. All of those are the right responses. The stars don't tell you what to do; they tell you what you already know, in language you can finally hear.

---

`;

const closing = `# Closing: A Love Letter from the Universe

Dearest Sample, this is the last page of the book, but not the last page of you.

Everything in this book was already true before you read it, and it will be true after. The work is not to memorize it — it is to live it, one ordinary morning at a time. Your Leo Sun, your Cancer Moon, your Libra Rising, your Life Path 7 — these are not predictions. They are a vocabulary your life has been using all along.

I have loved making this for you. Go gently. The cosmos has your back.

> The cosmos was writing toward you long before you were ready to be read — and it is still writing now, patiently, one heartbeat at a time.

*With celestial love and wisdom, The Universe.*`;

// Welcome + 12 chapters + closing
const content = [
  welcome,
  chapter(1, "Your Holistic Growth Life Path", "The Overview",
    [
      { heading: "How the pieces fit together", paragraphs: longParas(2, "the work of becoming yourself") },
      { heading: "Reading the sky as a map", paragraphs: longParas(2, "your cosmic blueprint") },
    ],
    "The map is not the verdict; it is the invitation to walk the territory you were born to walk."),
  // Ch 2/3/4 now use 4 subsections each (per the updated book-prompt.md)
  // so they fan out across 3–4 standard-body pages instead of the previous
  // single-page render. Sun/Moon/Rising sections follow the user's
  // reference style: essence → relationships → world/upbringing → meaning.
  chapter(2, "Your Sun Sign", "Leo · The Radiant Heart",
    [
      { heading: "Your Leo essence", paragraphs: longParas(3, "the work of letting yourself shine") },
      { heading: "Leo in love and connection", paragraphs: longParas(2, "the work of letting yourself be loved") },
      { heading: "Leo at work and in the world", paragraphs: longParas(2, "the calling that asks for your full voice") },
      { heading: "The deeper significance of Leo", paragraphs: longParas(2, "your shadow of self-erasure and the medicine of being seen") },
    ],
    "Your shine is not a performance, it is the natural posture of a heart that has remembered itself."),
  chapter(3, "Your Moon Sign", "Cancer · The Tender Keeper",
    [
      { heading: "Your Cancer inner world", paragraphs: longParas(3, "the work of emotional fluency") },
      { heading: "Cancer Moon in relationships", paragraphs: longParas(2, "the people who feel like home to your inner sea") },
      { heading: "Your emotional roots and upbringing", paragraphs: longParas(2, "the kitchen, the kept things, and the lessons of early love") },
      { heading: "The importance of Moon in Cancer", paragraphs: longParas(2, "your private inner sea and the strength of feeling deeply") },
    ],
    "You feel everything at full volume, and that sensitivity is not a flaw to manage but a frequency you were tuned to."),
  chapter(4, "Your Rising Sign", "Libra · The Diplomatic Face",
    [
      { heading: "How the world first meets you", paragraphs: longParas(3, "the doorway your presence becomes") },
      { heading: "Ruled by Venus", paragraphs: longParas(2, "your aesthetic intelligence and the rhythm Venus gives you") },
      { heading: "Where Libra Rising shines in the world", paragraphs: longParas(2, "the rooms where your gift for balance becomes leadership") },
      { heading: "Your shadow and your growth edge", paragraphs: longParas(2, "the work of choosing yourself when harmony asks you to disappear") },
    ],
    "Your rising is a doorway, not a disguise, and the people who pass through it become the most loved in your life."),
  chapter(5, "Relationships", "Love, Partnership & Soul Contracts",
    [
      { heading: "Venus & the architecture of love", paragraphs: longParas(2, "the work of choosing on purpose") },
      { heading: "Mars, longing, and depth", paragraphs: longParas(2, "your hidden pursuit") },
    ],
    "Love is not what happens to you — it is what you build, slowly and devotedly, one act of paying attention at a time.",
    affirmationsList("Relationship")),
  chapter(6, "Wealth", "Abundance, Career & Life Mission",
    [
      { heading: "Your 2nd house economy", paragraphs: longParas(2, "your relationship with self-worth") },
      { heading: "Your 10th house calling", paragraphs: longParas(2, "your public mission") },
    ],
    "Money is not the answer; alignment is. When you stop bracing for permission, the abundance you've been afraid of arrives without warning.",
    affirmationsList("Wealth")),
  chapter(7, "Health", "Vitality, Body Wisdom & Energetic Wellbeing",
    [
      { heading: "The body keeps records", paragraphs: longParas(2, "your relationship with your body") },
      { heading: "Cancer Moon rest as medicine", paragraphs: longParas(2, "your nervous-system anchors") },
    ],
    "Your body is not a problem you have — it is a language your soul is fluent in, asking only that you finally learn to listen.",
    affirmationsList("Health")),
  chapter(8, "Your Numerological Fortune", "Lucky Numbers & Timing",
    [
      { heading: "The story of seven", paragraphs: longParas(2, "your numerological identity") },
      { heading: "Personal Year cycles", paragraphs: longParas(2, "the timing of the nine-year arc") },
    ],
    "The numbers were not given to you; they were drawn from the sound of your name and the day you arrived. Listen to them like an inheritance."),
  chapter(9, "Planetary Influences", "Cosmic Timing",
    [
      { heading: "Saturn now, Jupiter soon", paragraphs: longParas(2, "the planets visiting your chart") },
      { heading: "How to ride the transit", paragraphs: longParas(2, "working with cosmic weather") },
    ],
    "The cosmos is always teaching you what to release and what to gather — your only job is to keep your hands free enough to do both."),
  chapter(10, "Your Daily Mantras", null,
    [
      // body is just the mantra subsections (no normal subsections needed)
    ],
    "The smallest sentences carry the most light when you say them on purpose.",
    [mantras("Morning"), mantras("Midday"), mantras("Evening")].join("\n\n")),
  chapter(11, "Your Sacred Morning Ritual", null,
    [
      { heading: "The first ten minutes", paragraphs: longParas(2, "your morning anchor") },
      { heading: "Anchors aligned to your chart", paragraphs: longParas(2, "specific rituals from your placements") },
    ],
    "The way you greet the morning is the way you greet your life — and the small kindness you offer yourself at sunrise is the one you carry into every room."),
  chapter(12, "Your Year Ahead", "Month by Month Guidance",
    [
      { heading: "January — Threshold", paragraphs: longParas(1, "the year opens") },
      { heading: "April — Quiet acceleration", paragraphs: longParas(1, "a season of momentum") },
      { heading: "August — Solar return", paragraphs: longParas(1, "your birthday season") },
      { heading: "December — Integration", paragraphs: longParas(1, "the year closes") },
    ],
    "The year does not unfold to you; it unfolds with you — and the version of you reading this in December will be grateful to the version writing it now."),
  // Mock order's birthday is May 15 → Emerald. Chapter 13 prose echoes that
  // so the page renders end-to-end with the gem visual + matching narrative.
  chapter(13, "BONUS: Your Birthstone", "A Talisman Aligned to Your Birth Month",
    [
      { heading: "The lore behind the stone", paragraphs: longParas(2, "the stone's traditional symbolism — rebirth, devoted love, the slow patient green of new growth") },
      { heading: "How Emerald meets your chart", paragraphs: longParas(2, "your Cancer Moon and Life Path 7 inside the Emerald's quiet field") },
      { heading: "Two carry-practices", paragraphs: longParas(1, "small daily rituals that pair the stone with the affirmations you already carry") },
    ],
    "The stone does not give you what is not already yours — it remembers what you already are, on the mornings you forget."),
  closing,
].join("\n\n");

console.log(`Mock content: ${content.length} chars, ${content.split("\n").length} lines`);
const t0 = Date.now();
const pdf = await generateTemplatedInteriorPDF(mockOrder, content);
const ms = Date.now() - t0;

await fs.mkdir(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, "test-full-book.pdf");
await fs.writeFile(out, pdf);
console.log(`Wrote ${out} (${(pdf.length / 1024).toFixed(1)} KB, ${ms} ms)`);
process.exit(0);
