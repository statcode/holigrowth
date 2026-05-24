import type { ZodiacOrder } from "@workspace/db";

const ZODIAC_SIGNS = [
  { name: "Capricorn", start: [12, 22], end: [1, 19] },
  { name: "Aquarius", start: [1, 20], end: [2, 18] },
  { name: "Pisces", start: [2, 19], end: [3, 20] },
  { name: "Aries", start: [3, 21], end: [4, 19] },
  { name: "Taurus", start: [4, 20], end: [5, 20] },
  { name: "Gemini", start: [5, 21], end: [6, 20] },
  { name: "Cancer", start: [6, 21], end: [7, 22] },
  { name: "Leo", start: [7, 23], end: [8, 22] },
  { name: "Virgo", start: [8, 23], end: [9, 22] },
  { name: "Libra", start: [9, 23], end: [10, 22] },
  { name: "Scorpio", start: [10, 23], end: [11, 21] },
  { name: "Sagittarius", start: [11, 22], end: [12, 21] },
];

const MOON_SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const RISING_SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

function getSunSign(birthday: string): string {
  const date = new Date(birthday);
  const month = date.getMonth() + 1;
  const day = date.getDate();

  for (const sign of ZODIAC_SIGNS) {
    const [startMonth, startDay] = sign.start;
    const [endMonth, endDay] = sign.end;
    if (startMonth === 12 && month === 12 && day >= startDay) return sign.name;
    if (endMonth === 1 && month === 1 && day <= endDay) return sign.name;
    if (month === startMonth && day >= startDay) return sign.name;
    if (month === endMonth && day <= endDay) return sign.name;
  }
  return "Capricorn";
}

function reduceToSingleDigit(n: number): number {
  if (n === 11 || n === 22 || n === 33) return n;
  while (n > 9) {
    n = n.toString().split("").map(Number).reduce((a, b) => a + b, 0);
    if (n === 11 || n === 22 || n === 33) return n;
  }
  return n;
}

function getLifePath(birthday: string): string {
  const digits = birthday.replace(/\D/g, "").split("").map(Number);
  const sum = digits.reduce((a, b) => a + b, 0);
  return String(reduceToSingleDigit(sum));
}

function getDestinyNumber(fullName: string): string {
  const LETTER_VALUES: Record<string, number> = {
    a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8,i:9,
    j:1,k:2,l:3,m:4,n:5,o:6,p:7,q:8,r:9,
    s:1,t:2,u:3,v:4,w:5,x:6,y:7,z:8
  };
  const sum = fullName.toLowerCase().split("").reduce((acc, ch) => acc + (LETTER_VALUES[ch] || 0), 0);
  return String(reduceToSingleDigit(sum));
}

function getSoulUrgeNumber(fullName: string): string {
  const VOWELS = new Set(["a","e","i","o","u"]);
  const LETTER_VALUES: Record<string, number> = {
    a:1,e:5,i:9,o:6,u:3
  };
  const sum = fullName.toLowerCase().split("").reduce((acc, ch) => VOWELS.has(ch) ? acc + (LETTER_VALUES[ch] || 0) : acc, 0);
  return String(reduceToSingleDigit(sum));
}

function getPersonalYearNumber(birthday: string): string {
  const currentYear = new Date().getFullYear();
  const date = new Date(birthday);
  const birthMonth = date.getMonth() + 1;
  const birthDay = date.getDate();
  const sum = String(currentYear).split("").map(Number).reduce((a,b)=>a+b,0)
    + birthMonth + birthDay;
  return String(reduceToSingleDigit(sum));
}

function calculateLuckyNumbers(fullName: string, birthday: string): string {
  const lifePathNum = parseInt(getLifePath(birthday));
  const destinyNum = parseInt(getDestinyNumber(fullName));
  const soulNum = parseInt(getSoulUrgeNumber(fullName));
  const personalYearNum = parseInt(getPersonalYearNumber(birthday));

  const lucky = new Set<number>();
  lucky.add(lifePathNum);
  lucky.add(destinyNum);
  lucky.add(soulNum);
  lucky.add(personalYearNum);

  // Add complementary numbers
  const complement = (n: number) => n <= 5 ? n + 4 : n - 4;
  lucky.add(complement(lifePathNum));

  // Remove 0, ensure range 1-99
  const filtered = [...lucky].filter(n => n >= 1 && n <= 99).sort((a,b) => a-b);
  return filtered.join(", ");
}

function deterministicIndex(seed: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % max;
}

export function extractZodiacMetadata(fullName: string, birthday: string, birthTime: string, birthLocation: string): {
  sunSign: string;
  moonSign: string;
  risingSign: string;
  lifePath: string;
  luckyNumbers: string;
} {
  const sunSign = getSunSign(birthday);
  const seed = birthday + birthTime + birthLocation;
  const moonSign = MOON_SIGNS[deterministicIndex(seed + "moon", MOON_SIGNS.length)]!;
  const risingSign = RISING_SIGNS[deterministicIndex(seed + "rising", RISING_SIGNS.length)]!;
  const lifePath = getLifePath(birthday);
  const luckyNumbers = calculateLuckyNumbers(fullName, birthday);

  return { sunSign, moonSign, risingSign, lifePath, luckyNumbers };
}

/** Birthstone metadata for Chapter 13 (BONUS). The renderer has the same
 *  table — keep them in sync. Pulled from the American Gem Society's modern
 *  birthstone list (with the traditional alternates Pearl/Alexandrite and
 *  Turquoise/Tanzanite acknowledged in the prose). */
const BIRTHSTONE_BY_MONTH: Record<number, { name: string; meaning: string }> = {
  1:  { name: "Garnet",      meaning: "trust, strength, and protection" },
  2:  { name: "Amethyst",    meaning: "royal calm, intuition, and quiet wisdom" },
  3:  { name: "Aquamarine",  meaning: "tranquility, hope, and clarity of mind" },
  4:  { name: "Diamond",     meaning: "eternity, strength, and resilience" },
  5:  { name: "Emerald",     meaning: "rebirth, devoted love, and growth" },
  6:  { name: "Pearl",       meaning: "purity, balance, and quiet wisdom (traditional alternate: Alexandrite)" },
  7:  { name: "Ruby",        meaning: "passion, courage, and vital aliveness" },
  8:  { name: "Peridot",     meaning: "prosperity, joy, and inner strength" },
  9:  { name: "Sapphire",    meaning: "truth, loyalty, and sovereign wisdom" },
  10: { name: "Opal",        meaning: "creativity, hope, and emotional healing" },
  11: { name: "Citrine",     meaning: "joy, abundance, and warm positivity" },
  12: { name: "Turquoise",   meaning: "good fortune and spiritual alignment (traditional alternate: Tanzanite)" },
};

function birthstoneForBirthday(birthday: string): { name: string; meaning: string } {
  const m = /^\d{4}-(\d{2})-/.exec(birthday);
  const month = m ? parseInt(m[1]!, 10) : 1;
  return BIRTHSTONE_BY_MONTH[month] ?? BIRTHSTONE_BY_MONTH[1]!;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function birthMonthName(birthday: string): string {
  const m = /^\d{4}-(\d{2})-/.exec(birthday);
  const month = m ? parseInt(m[1]!, 10) : 1;
  return MONTH_NAMES[month - 1] ?? "January";
}

/**
 * A single AI-generated unit of the book. The /generate route runs one
 * OpenRouter call per section in parallel (Promise.all), then stitches
 * the results in this order to produce the full markdown that
 * parse.ts → render.ts consumes.
 *
 * `key` is a stable id used in the SSE progress events sent to the
 * frontend, `title` is the human-readable label the CosmicLoader shows,
 * and `userPrompt` is the complete user-message that pairs with
 * `book-prompt.md` (system prompt) for that one call.
 */
export interface BookSection {
  key: string;
  title: string;
  userPrompt: string;
}

/** Builds the shared birth-context block prepended to every section
 *  prompt. Includes name, birth data, calculated astrology + numerology,
 *  pronoun guidance, and the formatting reminder so each parallel call
 *  has the same anchoring information. */
function buildSharedHeader(order: ZodiacOrder): string {
  const metadata = extractZodiacMetadata(order.fullName, order.birthday, order.birthTime, order.birthLocation);
  const destinyNumber = getDestinyNumber(order.fullName);
  const soulUrgeNumber = getSoulUrgeNumber(order.fullName);
  const personalYear = getPersonalYearNumber(order.birthday);

  const isFemale = order.gender !== "male";
  const pronoun = isFemale ? "her" : "his";
  const pronounSub = isFemale ? "she" : "he";
  const pronounObj = isFemale ? "her" : "him";

  const orientationLabel: Record<string, string> = {
    straight: "heterosexual / straight",
    gay: "gay / lesbian",
    bisexual: "bisexual",
    prefer_not_to_say: "not specified",
  };
  const relationshipLabel: Record<string, string> = {
    single: "single",
    in_relationship: "in a relationship",
    married: "married",
    divorced: "divorced",
    widowed: "widowed",
    not_seeking: "not seeking a relationship",
  };
  const orientation = order.sexualOrientation
    ? (orientationLabel[order.sexualOrientation] ?? order.sexualOrientation)
    : "not specified";
  const relStatus = order.relationshipStatus
    ? (relationshipLabel[order.relationshipStatus] ?? order.relationshipStatus)
    : "not specified";

  return `You are writing ONE section of ${order.fullName}'s personalised "Holistic Growth Life Path" book. Other sections are being generated in parallel by other workers — write only the section described below, and do NOT include any other chapters.

Birth Details:
- Full Name: ${order.fullName}
- Gender: ${order.gender ?? "not specified"}
- Sexual Orientation: ${orientation}
- Relationship Status: ${relStatus}
- Birthday: ${order.birthday}
- Birth Time: ${order.birthTime}
- Birth Location: ${order.birthLocation}

Calculated Astrological & Numerological Profile:
- Sun Sign: ${metadata.sunSign}
- Moon Sign: ${metadata.moonSign}
- Rising Sign: ${metadata.risingSign}
- Life Path Number: ${metadata.lifePath}
- Destiny Number: ${destinyNumber}
- Soul Urge Number: ${soulUrgeNumber}
- Personal Year Number (${new Date().getFullYear()}): ${personalYear}
- Lucky Numbers: ${metadata.luckyNumbers}

Use pronouns ${pronounSub}/${pronoun}/${pronounObj} throughout. Address ${order.fullName} by name frequently. Use "# " for the chapter heading (one only). Use "## " for sub-section headings inside the chapter.`;
}

/** Shared guideline tail appended to every section prompt — covers tone,
 *  specificity, and the pull-quote requirement that closes each chapter. */
const SHARED_FOOTER = `

IMPORTANT:
- Output ONLY this one section. Do NOT introduce a preface, do NOT write any other chapters.
- Be specific to the reader's chart — never use generic horoscope-style language.
- Warm, empowering, mystical-yet-grounded prose.
- End the section with one \`> ...\` blockquote pull quote on its own line (single sentence, 120–280 chars, second person, no name).`;

/**
 * Builds the ordered list of sections for the book. Each section's
 * `userPrompt` is a self-contained instruction that the parallel
 * coordinator pairs with `book-prompt.md` (the system prompt) to
 * generate just that one section. The order here is the order the
 * sections will appear in the final book.
 */
export function getBookSections(order: ZodiacOrder): BookSection[] {
  const metadata = extractZodiacMetadata(order.fullName, order.birthday, order.birthTime, order.birthLocation);
  const destinyNumber = getDestinyNumber(order.fullName);
  const soulUrgeNumber = getSoulUrgeNumber(order.fullName);
  const personalYear = getPersonalYearNumber(order.birthday);
  const birthstone = birthstoneForBirthday(order.birthday);
  const birthMonth = birthMonthName(order.birthday);

  const isFemale = order.gender !== "male";
  const pronoun = isFemale ? "her" : "his";
  const pronounSub = isFemale ? "she" : "he";
  const pronounObj = isFemale ? "her" : "him";
  const pronounPoss = isFemale ? "her" : "his";

  const orientationLabel: Record<string, string> = {
    straight: "heterosexual / straight",
    gay: "gay / lesbian",
    bisexual: "bisexual",
    prefer_not_to_say: "not specified",
  };
  const relationshipLabel: Record<string, string> = {
    single: "single",
    in_relationship: "in a relationship",
    married: "married",
    divorced: "divorced",
    widowed: "widowed",
    not_seeking: "not seeking a relationship",
  };
  const orientation = order.sexualOrientation ? (orientationLabel[order.sexualOrientation] ?? order.sexualOrientation) : "not specified";
  const relStatus = order.relationshipStatus ? (relationshipLabel[order.relationshipStatus] ?? order.relationshipStatus) : "not specified";

  const header = buildSharedHeader(order);
  const wrap = (directive: string): string => `${header}\n\n${directive}${SHARED_FOOTER}`;

  return [
    {
      key: "welcome",
      title: "Welcome Letter",
      userPrompt: wrap(`Write the **Welcome Letter** for the start of the book. ~200–300 words. Format the heading exactly as "# Welcome".\n\nA heartfelt opening addressed by name from Holistic Growth. Set the warm, intimate tone for the book. Include a short disclaimer that this reading is for entertainment and self-reflection only — not a substitute for professional medical, financial, legal, or psychological advice. End with one \`> ...\` pull quote.`),
    },
    {
      key: "ch1",
      title: "Chapter 1 — Your Life Path Overview",
      userPrompt: wrap(`# Chapter 1: Your Holistic Growth Life Path — The Overview\nWrite 450–550 words across 3 paragraphs. Introduce ${order.fullName}'s unique cosmic blueprint. Explain Life Path ${metadata.lifePath} as ${pronounPoss} guiding thread, ${pronounPoss} soul's mission and karmic gifts. Weave in Sun (${metadata.sunSign}), Moon (${metadata.moonSign}), and Rising (${metadata.risingSign}). End with a direct, loving message to ${order.fullName}.`),
    },
    {
      key: "ch2",
      title: `Chapter 2 — Your ${metadata.sunSign} Sun`,
      userPrompt: wrap(`# Chapter 2: Your Sun Sign — ${metadata.sunSign}\nWrite 350–450 words across 3 paragraphs. Cover ${pronounPoss} ${metadata.sunSign} core identity, natural gifts, shadow patterns, and elemental energy. Briefly connect to love, wealth, and health.`),
    },
    {
      key: "ch3",
      title: `Chapter 3 — Your ${metadata.moonSign} Moon`,
      userPrompt: wrap(`# Chapter 3: Your Moon Sign — ${metadata.moonSign}\nWrite 350–450 words across 3 paragraphs. Cover ${pronounPoss} emotional inner world, what ${pronounSub} needs to feel safe, ${pronounPoss} intuitive gifts, and patterns to heal.`),
    },
    {
      key: "ch4",
      title: `Chapter 4 — Your ${metadata.risingSign} Rising`,
      userPrompt: wrap(`# Chapter 4: Your Rising Sign — ${metadata.risingSign}\nWrite 300–400 words across 2 paragraphs. Cover how the world perceives ${pronounObj}, ${pronounPoss} social mask, and how ${metadata.risingSign} Rising interacts with ${pronounPoss} Sun and Moon.`),
    },
    {
      key: "ch5",
      title: "Chapter 5 — Love & Relationships",
      userPrompt: wrap(`# Chapter 5: Love & Relationships — Your Cosmic Blueprint for Connection\nWrite 500–600 words across 3–4 paragraphs. This is the most personal chapter. Cover:\n- Sexual orientation is ${orientation} — write relationship guidance accurately reflecting who ${pronounSub} is attracted to (same-sex, opposite-sex, or both). Never assume heterosexuality unless specified.\n- Relationship status is ${relStatus} — tailor the love guidance accordingly. If single: focus on attracting and recognizing the right partner. If in a relationship/married: focus on deepening and sustaining connection. If divorced/widowed: focus on healing, self-love, and readiness for new love. If not seeking: focus on self-love, platonic connections, and fulfillment outside romance.\n- How ${pronounPoss} ${metadata.sunSign}/${metadata.moonSign} combination shapes love and attachment\n- The qualities ${pronounSub} attracts and karmic relationship lessons\n- What ${pronounSub} truly needs from a partner; Personal Year ${personalYear} love timing\n- Practical guidance for ${pronounPoss} relationships right now given ${pronounPoss} current status\n\nAfter the chapter body, before the pull quote, include a section titled exactly "## Your 10 Relationship Affirmations" — write exactly 10 first-person affirmations (one per line, numbered 1–10) tailored to ${order.fullName}'s Life Path ${metadata.lifePath}, ${metadata.sunSign}/${metadata.moonSign} combination, sexual orientation (${orientation}), and current relationship status (${relStatus}). Each affirmation must be a complete first-person statement (not a fragment) and must speak to ${pronounPoss} specific situation — not generic platitudes.`),
    },
    {
      key: "ch6",
      title: "Chapter 6 — Wealth & Abundance",
      userPrompt: wrap(`# Chapter 6: Wealth & Abundance — Your Cosmic Path to Prosperity\nWrite 500–600 words across 3–4 paragraphs:\n- Life Path ${metadata.lifePath} wealth archetype; natural gifts and money blind spots for ${metadata.sunSign}\n- Destiny Number ${destinyNumber} and abundance beliefs to reprogram\n- Best aligned income paths; Personal Year ${personalYear} financial timing\n- Two practical abundance practices for ${pronounPoss} signs\n\nAfter the chapter body, before the pull quote, include a section titled exactly "## Your 10 Wealth Affirmations" — write exactly 10 first-person affirmations (one per line, numbered 1–10) tailored to ${order.fullName}'s Life Path ${metadata.lifePath}, Destiny Number ${destinyNumber}, ${metadata.sunSign} money archetype, and Personal Year ${personalYear} timing.`),
    },
    {
      key: "ch7",
      title: "Chapter 7 — Health & Vitality",
      userPrompt: wrap(`# Chapter 7: Health & Vitality — Your Body's Cosmic Code\nWrite 500–600 words across 3–4 paragraphs:\n- Body zones and energy systems linked to ${metadata.sunSign}, ${metadata.moonSign}, ${metadata.risingSign}\n- What drains vs. replenishes ${pronounObj}; stress patterns and seasonal rhythms\n- Two mind-body practices designed for ${pronounPoss} cosmic blueprint\n\nAfter the chapter body, before the pull quote, include a section titled exactly "## Your 10 Health Affirmations" — write exactly 10 first-person affirmations (one per line, numbered 1–10) tailored to ${order.fullName}'s ${metadata.sunSign} body zones, ${metadata.moonSign} emotional-body needs, and ${metadata.risingSign} energetic patterns.`),
    },
    {
      key: "ch8",
      title: "Chapter 8 — Numerological Fortune",
      userPrompt: wrap(`# Chapter 8: Your Numerological Fortune — Lucky Numbers & Timing\nWrite 500–600 words. Interpret each number concisely:\n- Life Path ${metadata.lifePath}: spiritual and practical meaning\n- Destiny Number ${destinyNumber}: ${pronounPoss} outer calling; Soul Urge ${soulUrgeNumber}: ${pronounPoss} heart's desire\n- Personal Year ${personalYear} (${new Date().getFullYear()}): key themes across all three pillars\n- Lucky Numbers ${metadata.luckyNumbers}: when and how to use them; lucky days and timing windows`),
    },
    {
      key: "ch9",
      title: "Chapter 9 — Planetary Influences",
      userPrompt: wrap(`# Chapter 9: Planetary Influences & Cosmic Timing\nWrite 400–500 words across 3 paragraphs. Key natal placements (Sun, Moon, Rising ruler). Current transits activating ${pronounPoss} chart. How timing affects ${pronounPoss} three pillars this year.`),
    },
    {
      key: "ch10",
      title: "Chapter 10 — Your Daily Mantras",
      userPrompt: wrap(`# Chapter 10: Your Daily Mantras\nWrite 300–400 words. Open with one short paragraph (3–4 sentences) on how to use a mantra — pair it with breath, repeat silently in transit, on a walk, before sleep. Then list exactly 9 mantras under three subheadings — "## Morning" (3 mantras), "## Midday" (3 mantras), "## Evening" (3 mantras) — one per line. Each mantra: 3–7 words, first person, rooted in Life Path ${metadata.lifePath}, ${metadata.sunSign} energy, and Personal Year ${personalYear}. Say-aloud language, not flowery prose.`),
    },
    {
      key: "ch11",
      title: "Chapter 11 — Sacred Morning Ritual",
      userPrompt: wrap(`# Chapter 11: Your Sacred Morning Ritual\nWrite 350–450 words. A concise step-by-step morning practice (8–10 minutes) for ${order.fullName}'s chart: breath sequence, affirmation, visualization for Life Path ${metadata.lifePath}, grounding movement for ${metadata.sunSign}.`),
    },
    {
      key: "ch12",
      title: "Chapter 12 — Your Year Ahead",
      userPrompt: wrap(`# Chapter 12: Your Year Ahead — Month by Month Guidance\nWrite 1–2 sentences for EACH of the 12 months. Format EXACTLY as shown (each month on its own line):\n\nJanuary: [1–2 sentences on relationships, wealth, or health energy]\nFebruary: [1–2 sentences]\nMarch: [1–2 sentences]\nApril: [1–2 sentences]\nMay: [1–2 sentences]\nJune: [1–2 sentences]\nJuly: [1–2 sentences]\nAugust: [1–2 sentences]\nSeptember: [1–2 sentences]\nOctober: [1–2 sentences]\nNovember: [1–2 sentences]\nDecember: [1–2 sentences]`),
    },
    {
      key: "ch13",
      title: `Chapter 13 (BONUS) — ${birthstone.name}`,
      userPrompt: wrap(`# Chapter 13 (BONUS): Your Birthstone — A Talisman Aligned to Your Birth Month\n${order.fullName} was born in ${birthMonth}, so ${pronoun} birthstone is **${birthstone.name}** — traditionally associated with ${birthstone.meaning}. Do not propose an alternate stone.\n\nWrite 500–700 words in this order:\n1. Open by naming ${pronounPoss} birth month and ${birthstone.name} in one warm welcoming sentence (no list, no headers in the opener).\n2. Tell the lore in 2–3 sentences — the stone's traditional symbolism, who valued it historically, what it was believed to protect or attract. Stay grounded; no occult guarantees.\n3. Connect ${birthstone.name} to ${pronounPoss} chart in 3–4 sentences. Be specific: name how the stone resonates with ${metadata.sunSign} Sun, ${metadata.moonSign} Moon, or ${metadata.risingSign} Rising, and how it amplifies Life Path ${metadata.lifePath}.\n4. Offer exactly two practical carry-practices — short, sensory, achievable. Examples: wearing the stone during a specific moon phase, placing it on a journal during morning ritual, holding it while repeating one of ${pronounPoss} affirmations from Chapters 5/6/7.\n\nNo alternate stones, no horoscope generalisations, no list-and-dump of facts.`),
    },
    {
      key: "closing",
      title: "Closing — A Love Letter from the Universe",
      userPrompt: wrap(`Write the **Closing letter** from the cosmos to ${order.fullName}. ~300–400 words. Format the heading exactly as "# Closing: A Love Letter from the Universe".\n\nA deeply moving, personally addressed closing. Reference ${pronounPoss} Sun ${metadata.sunSign}, Moon ${metadata.moonSign}, Rising ${metadata.risingSign}, Life Path ${metadata.lifePath}, and Personal Year ${personalYear}. End with ${pronounPoss} lucky numbers (${metadata.luckyNumbers}) as a blessing. Close with the sign-off: *With celestial love and wisdom, The Universe.*`),
    },
  ];
}

/**
 * Legacy single-prompt builder — retained for callers that want one big
 * AI request instead of the parallel-per-section approach. The /generate
 * route uses `getBookSections` now; this remains for the in-tree
 * smoke-test script and any external integration.
 *
 * @deprecated prefer `getBookSections(order)` + a parallel coordinator
 */
export function generateZodiacPrompt(order: ZodiacOrder): string {
  const metadata = extractZodiacMetadata(order.fullName, order.birthday, order.birthTime, order.birthLocation);
  const destinyNumber = getDestinyNumber(order.fullName);
  const soulUrgeNumber = getSoulUrgeNumber(order.fullName);
  const personalYear = getPersonalYearNumber(order.birthday);
  const birthstone = birthstoneForBirthday(order.birthday);
  const birthMonth = birthMonthName(order.birthday);

  const isFemale = order.gender !== "male";
  const pronoun = isFemale ? "her" : "his";
  const pronounSub = isFemale ? "she" : "he";
  const pronounObj = isFemale ? "her" : "him";
  const pronounPoss = isFemale ? "her" : "his";

  const orientationLabel: Record<string, string> = {
    straight: "heterosexual / straight",
    gay: "gay / lesbian",
    bisexual: "bisexual",
    prefer_not_to_say: "not specified",
  };
  const relationshipLabel: Record<string, string> = {
    single: "single",
    in_relationship: "in a relationship",
    married: "married",
    divorced: "divorced",
    widowed: "widowed",
    not_seeking: "not seeking a relationship",
  };
  const orientation = order.sexualOrientation
    ? (orientationLabel[order.sexualOrientation] ?? order.sexualOrientation)
    : "not specified";
  const relStatus = order.relationshipStatus
    ? (relationshipLabel[order.relationshipStatus] ?? order.relationshipStatus)
    : "not specified";

  return `Create a comprehensive "Holistic Growth Life Path" personalized astrology and numerology book for ${order.fullName}.

Birth Details:
- Full Name: ${order.fullName}
- Gender: ${order.gender ?? "not specified"}
- Sexual Orientation: ${orientation}
- Relationship Status: ${relStatus}
- Birthday: ${order.birthday}
- Birth Time: ${order.birthTime}
- Birth Location: ${order.birthLocation}

Calculated Astrological & Numerological Profile:
- Sun Sign: ${metadata.sunSign}
- Moon Sign: ${metadata.moonSign}
- Rising Sign: ${metadata.risingSign}
- Life Path Number: ${metadata.lifePath}
- Destiny Number: ${destinyNumber}
- Soul Urge Number: ${soulUrgeNumber}
- Personal Year Number (${new Date().getFullYear()}): ${personalYear}
- Lucky Numbers: ${metadata.luckyNumbers}

Please write a deeply personal, richly detailed "Holistic Growth Life Path" book with these chapters.
TARGET: 40–50 printed pages of rich, personal content (aim for 400–600 words per chapter — be specific and meaningful, not padded).
Use the correct pronouns throughout: ${pronounSub}/${pronoun}/${pronounObj}.
Use "# " for chapter headings (only one per chapter). Use "## " for section headings within chapters. Write 2–3 paragraphs per section.

IMPORTANT FORMATTING: Use "# " (single #) for every chapter heading. Use "## " (double #) for section headings inside chapters. Each chapter starts with "# Chapter N: Title".

# Chapter 1: Your Holistic Growth Life Path — The Overview
Write 450–550 words. Introduce ${order.fullName}'s unique cosmic blueprint across 3 paragraphs. Explain Life Path ${metadata.lifePath} as ${pronounPoss} guiding thread, ${pronounPoss} soul's mission and karmic gifts. Weave in Sun (${metadata.sunSign}), Moon (${metadata.moonSign}), and Rising (${metadata.risingSign}). End with a direct, loving message to ${order.fullName}.

# Chapter 2: Your Sun Sign — ${metadata.sunSign}
Write 350–450 words. Cover ${pronounPoss} ${metadata.sunSign} core identity, natural gifts, shadow patterns, and elemental energy across 3 paragraphs. Briefly connect to love, wealth, and health.

# Chapter 3: Your Moon Sign — ${metadata.moonSign}
Write 350–450 words. Cover ${pronounPoss} emotional inner world, what ${pronounSub} needs to feel safe, ${pronounPoss} intuitive gifts, and patterns to heal across 3 paragraphs.

# Chapter 4: Your Rising Sign — ${metadata.risingSign}
Write 300–400 words. Cover how the world perceives ${pronounObj}, ${pronounPoss} social mask, and how ${metadata.risingSign} Rising interacts with ${pronounPoss} Sun and Moon across 2 paragraphs.

# Chapter 5: Love & Relationships — Your Cosmic Blueprint for Connection
Write 500–600 words across 3–4 paragraphs. This is the most personal chapter. Cover:
- Sexual orientation is ${orientation} — write relationship guidance accurately reflecting who ${pronounSub} is attracted to (same-sex, opposite-sex, or both). Never assume heterosexuality unless specified.
- Relationship status is ${relStatus} — tailor the love guidance accordingly. If single: focus on attracting and recognizing the right partner. If in a relationship/married: focus on deepening and sustaining connection. If divorced/widowed: focus on healing, self-love, and readiness for new love. If not seeking: focus on self-love, platonic connections, and fulfillment outside romance.
- How ${pronounPoss} ${metadata.sunSign}/${metadata.moonSign} combination shapes love and attachment
- The qualities ${pronounSub} attracts and karmic relationship lessons
- What ${pronounSub} truly needs from a partner; Personal Year ${personalYear} love timing
- Practical guidance for ${pronounPoss} relationships right now given ${pronounPoss} current status

End the chapter with a section titled exactly "## Your 10 Relationship Affirmations" — write exactly 10 first-person affirmations (one per line, numbered 1–10) tailored to ${order.fullName}'s Life Path ${metadata.lifePath}, ${metadata.sunSign}/${metadata.moonSign} combination, sexual orientation (${orientation}), and current relationship status (${relStatus}). Each affirmation must be a complete first-person statement (not a fragment) and must speak to ${pronounPoss} specific situation — not generic platitudes. Practical and actionable: something ${pronounSub} can repeat in the morning and act on the same day.

# Chapter 6: Wealth & Abundance — Your Cosmic Path to Prosperity
Write 500–600 words across 3–4 paragraphs:
- Life Path ${metadata.lifePath} wealth archetype; natural gifts and money blind spots for ${metadata.sunSign}
- Destiny Number ${destinyNumber} and abundance beliefs to reprogram
- Best aligned income paths; Personal Year ${personalYear} financial timing
- Two practical abundance practices for ${pronounPoss} signs

End the chapter with a section titled exactly "## Your 10 Wealth Affirmations" — write exactly 10 first-person affirmations (one per line, numbered 1–10) tailored to ${order.fullName}'s Life Path ${metadata.lifePath}, Destiny Number ${destinyNumber}, ${metadata.sunSign} money archetype, and Personal Year ${personalYear} timing. Each affirmation must be a complete first-person statement (not a fragment) and must address ${pronounPoss} specific wealth gifts and blind spots. Practical and actionable: phrased so ${pronounSub} can repeat them at the start of every workday.

# Chapter 7: Health & Vitality — Your Body's Cosmic Code
Write 500–600 words across 3–4 paragraphs:
- Body zones and energy systems linked to ${metadata.sunSign}, ${metadata.moonSign}, ${metadata.risingSign}
- What drains vs. replenishes ${pronounObj}; stress patterns and seasonal rhythms
- Two mind-body practices designed for ${pronounPoss} cosmic blueprint

End the chapter with a section titled exactly "## Your 10 Health Affirmations" — write exactly 10 first-person affirmations (one per line, numbered 1–10) tailored to ${order.fullName}'s ${metadata.sunSign} body zones, ${metadata.moonSign} emotional-body needs, and ${metadata.risingSign} energetic patterns. Each affirmation must be a complete first-person statement (not a fragment) and must speak to ${pronounPoss} specific body and energy. Practical and actionable: tied to a daily habit or moment (waking, eating, moving, resting) so ${pronounSub} can live them, not just read them.

# Chapter 8: Your Numerological Fortune — Lucky Numbers & Timing
Write 500–600 words. Interpret each number concisely for ${order.fullName}:
- Life Path ${metadata.lifePath}: spiritual and practical meaning
- Destiny Number ${destinyNumber}: ${pronounPoss} outer calling; Soul Urge ${soulUrgeNumber}: ${pronounPoss} heart's desire
- Personal Year ${personalYear} (${new Date().getFullYear()}): key themes across all three pillars
- Lucky Numbers ${metadata.luckyNumbers}: when and how to use them; lucky days and timing windows

# Chapter 9: Planetary Influences & Cosmic Timing
Write 400–500 words across 3 paragraphs. Key natal placements (Sun, Moon, Rising ruler). Current transits activating ${pronounPoss} chart. How timing affects ${pronounPoss} three pillars this year.

# Chapter 10: Your Daily Mantras
Write 300–400 words. The 30 long-form affirmations live at the end of the three pillar chapters (5, 6, 7). This chapter is different — short, chant-like power phrases ${order.fullName} can carry through the day. Open with one short paragraph (3–4 sentences) on how to use a mantra: how to pair it with breath, how to repeat it silently in transit, on a walk, before sleep. Then list exactly 9 mantras under three subheadings — "## Morning" (3 mantras), "## Midday" (3 mantras), "## Evening" (3 mantras) — one per line. Each mantra must be 3–7 words, written in first person, and rooted in ${order.fullName}'s Life Path ${metadata.lifePath}, ${metadata.sunSign} energy, and Personal Year ${personalYear}. They should sound like things a person could actually say out loud — not flowery prose.

# Chapter 11: Your Sacred Morning Ritual
Write 350–450 words. A concise step-by-step morning practice (8–10 minutes) for ${order.fullName}'s chart: breath sequence, affirmation, visualization for Life Path ${metadata.lifePath}, grounding movement for ${metadata.sunSign}.

# Chapter 12: Your Year Ahead — Month by Month Guidance
Write 1–2 sentences for EACH of the 12 months. Format EXACTLY as shown (each month on its own line):

January: [1–2 sentences on relationships, wealth, or health energy]
February: [1–2 sentences]
March: [1–2 sentences]
April: [1–2 sentences]
May: [1–2 sentences]
June: [1–2 sentences]
July: [1–2 sentences]
August: [1–2 sentences]
September: [1–2 sentences]
October: [1–2 sentences]
November: [1–2 sentences]
December: [1–2 sentences]

# Chapter 13 (BONUS): Your Birthstone — A Talisman Aligned to Your Birth Month
${order.fullName} was born in ${birthMonth}, so ${pronoun} birthstone is **${birthstone.name}** — traditionally associated with ${birthstone.meaning}. Do not propose an alternate stone.

Write 500–700 words of richly personalized prose, in this order:
1. Open by naming ${pronounPoss} birth month and ${birthstone.name} in one warm welcoming sentence (no list, no headers in the opener).
2. Tell the lore in 2–3 sentences — the stone's traditional symbolism, who valued it historically, what it was believed to protect or attract. Stay grounded; no occult guarantees.
3. Connect ${birthstone.name} to ${pronounPoss} chart in 3–4 sentences. Be specific: name how the stone resonates with ${metadata.sunSign} Sun, ${metadata.moonSign} Moon, or ${metadata.risingSign} Rising, and how it amplifies Life Path ${metadata.lifePath}. Identify the placement of ${pronoun} that the stone most clearly counterbalances or supports.
4. Offer exactly two practical carry-practices — short, sensory, achievable. Examples: wearing the stone during a specific moon phase, placing it on a journal during morning ritual, holding it while repeating one of ${pronounPoss} affirmations from Chapters 5/6/7. Keep them concrete enough that ${pronounSub} could try one today.
5. **End the chapter with one \`> \` blockquote pull quote** — a single 1–2 sentence line in second-person voice that names the stone's gift to ${pronounObj}.

No alternate stones, no horoscope generalisations, no list-and-dump of facts. The chapter should feel like an heirloom handed across the table — celebratory, personal, and warm.

# Closing: A Love Letter from the Universe
Write 300–400 words. A deeply moving, personally addressed closing to ${order.fullName} from the cosmos. Remind ${pronounObj} of ${pronounPoss} unique gifts and the path ahead. End with ${pronounPoss} lucky numbers as a blessing.

IMPORTANT GUIDELINES:
- Address ${order.fullName} by name frequently — this should feel intimately personal
- Use correct pronouns consistently: ${pronounSub}/${pronoun}/${pronounObj}
- Write in warm, empowering, mystical yet grounded prose
- Be specific and detailed — avoid generic statements
- Emphasize ${pronounPoss} three growth pillars (relationships, wealth, health) throughout
- Each pillar chapter (5, 6, 7) MUST end with exactly 10 numbered first-person affirmations under the specified "## Your 10 [Pillar] Affirmations" heading. These are the headline feature of the book — make every affirmation specific to ${order.fullName}'s chart, never generic.
- The lucky numbers should feel magical and practical
- This book should feel like the most personal gift ${pronounSub} has ever received`;
}
