import { useState, useMemo } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, ArrowRight, Loader2, Lock, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/contexts/admin-context";
import {
  useCreateCheckoutSession,
  useGetZodiacOrder,
  getGetZodiacOrderQueryKey,
  useGetSiteSettings,
  getGetSiteSettingsQueryKey,
} from "@workspace/api-client-react";

// ─── Zodiac data ───────────────────────────────────────────────────────────────

const ZODIAC_LIST = [
  "Aries","Taurus","Gemini","Cancer","Leo","Virgo",
  "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces",
];
const ZODIAC_SYMBOLS: Record<string, string> = {
  Aries:"♈",Taurus:"♉",Gemini:"♊",Cancer:"♋",Leo:"♌",Virgo:"♍",
  Libra:"♎",Scorpio:"♏",Sagittarius:"♐",Capricorn:"♑",Aquarius:"♒",Pisces:"♓",
};
const ZODIAC_COLORS: Record<string, string> = {
  Aries:"#e85d5d",Taurus:"#7cb87c",Gemini:"#f0c050",Cancer:"#87aee8",
  Leo:"#f0884a",Virgo:"#a8c87a",Libra:"#c87abc",Scorpio:"#7c3c5a",
  Sagittarius:"#5088c8",Capricorn:"#7c6050",Aquarius:"#50b8d0",Pisces:"#8878c8",
};

// Rough, stylised constellation patterns — not astronomically perfect, but
// recognisable shapes that read as "your sign" at a glance. Coordinates are in
// a 0–100 viewBox; renderer scales them up.
const ZODIAC_CONSTELLATIONS: Record<string, { points: [number, number][]; lines: [number, number][] }> = {
  Aries:        { points: [[20,30],[35,38],[55,42],[78,32]], lines: [[0,1],[1,2],[2,3]] },
  Taurus:       { points: [[20,55],[35,42],[50,38],[65,42],[80,55],[50,28]], lines: [[0,1],[1,2],[2,3],[3,4],[2,5]] },
  Gemini:       { points: [[30,20],[30,80],[70,20],[70,80],[30,50],[70,50]], lines: [[0,1],[2,3],[4,5]] },
  Cancer:       { points: [[25,40],[40,32],[60,32],[75,40],[50,55],[50,72]], lines: [[0,1],[1,2],[2,3],[1,4],[2,4],[4,5]] },
  Leo:          { points: [[20,40],[35,30],[50,28],[62,40],[58,55],[72,68],[80,55]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]] },
  Virgo:        { points: [[18,30],[32,40],[45,32],[58,42],[70,35],[82,46],[50,68]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[3,6]] },
  Libra:        { points: [[20,42],[40,32],[60,32],[80,42],[35,55],[65,55]], lines: [[0,1],[1,2],[2,3],[1,4],[2,5]] },
  Scorpio:      { points: [[15,30],[28,38],[42,42],[55,46],[68,52],[78,62],[72,75],[58,72]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7]] },
  Sagittarius:  { points: [[20,55],[35,38],[50,30],[65,38],[78,52],[55,55],[42,68]], lines: [[0,1],[1,2],[2,3],[3,4],[5,6],[1,5]] },
  Capricorn:    { points: [[18,40],[32,32],[48,38],[62,46],[72,58],[58,68],[40,62]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0]] },
  Aquarius:     { points: [[18,38],[30,46],[42,38],[54,46],[66,38],[78,46],[50,62],[50,78]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[3,6],[6,7]] },
  Pisces:       { points: [[18,32],[30,42],[42,38],[50,50],[58,38],[70,42],[82,32],[28,68],[72,68]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[1,7],[5,8]] },
};

const ZODIAC_DATA: Record<string, { element: "Fire"|"Earth"|"Air"|"Water"; modality: "Cardinal"|"Fixed"|"Mutable"; ruler: string; tagline: string }> = {
  Aries:       { element: "Fire",  modality: "Cardinal", ruler: "Mars",     tagline: "The Initiator" },
  Taurus:      { element: "Earth", modality: "Fixed",    ruler: "Venus",    tagline: "The Builder" },
  Gemini:      { element: "Air",   modality: "Mutable",  ruler: "Mercury",  tagline: "The Messenger" },
  Cancer:      { element: "Water", modality: "Cardinal", ruler: "Moon",     tagline: "The Nurturer" },
  Leo:         { element: "Fire",  modality: "Fixed",    ruler: "Sun",      tagline: "The Sovereign" },
  Virgo:       { element: "Earth", modality: "Mutable",  ruler: "Mercury",  tagline: "The Healer" },
  Libra:       { element: "Air",   modality: "Cardinal", ruler: "Venus",    tagline: "The Diplomat" },
  Scorpio:     { element: "Water", modality: "Fixed",    ruler: "Pluto",    tagline: "The Alchemist" },
  Sagittarius: { element: "Fire",  modality: "Mutable",  ruler: "Jupiter",  tagline: "The Seeker" },
  Capricorn:   { element: "Earth", modality: "Cardinal", ruler: "Saturn",   tagline: "The Architect" },
  Aquarius:    { element: "Air",   modality: "Fixed",    ruler: "Uranus",   tagline: "The Visionary" },
  Pisces:      { element: "Water", modality: "Mutable",  ruler: "Neptune",  tagline: "The Mystic" },
};

const ELEMENT_COLOR: Record<string, string> = {
  Fire: "#e8704a", Earth: "#90a868", Air: "#c8b870", Water: "#6090c8",
};

// Conway-style synodic-month approximation — accurate within ~hours, which is
// more than enough for a stylised birth-day moon-phase visual.
function moonPhaseFromBirthday(birthday: string): { phase: number; illumination: number; name: string } {
  const d = new Date(birthday);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (month < 3) { year -= 1; month += 12; }
  const a = Math.floor(year / 100);
  const b = Math.floor(a / 4);
  const c = 2 - a + b;
  const e = Math.floor(365.25 * (year + 4716));
  const f = Math.floor(30.6001 * (month + 1));
  const jd = c + day + e + f - 1524.5;
  const SYNODIC = 29.53058867;
  const REF_NEW_MOON_JD = 2451550.1; // 2000-01-06 18:14 UTC
  const phase = (((jd - REF_NEW_MOON_JD) % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  let name = "Waxing Crescent";
  if (phase < 0.03 || phase > 0.97) name = "New Moon";
  else if (phase < 0.22) name = "Waxing Crescent";
  else if (phase < 0.28) name = "First Quarter";
  else if (phase < 0.47) name = "Waxing Gibbous";
  else if (phase < 0.53) name = "Full Moon";
  else if (phase < 0.72) name = "Waning Gibbous";
  else if (phase < 0.78) name = "Last Quarter";
  else name = "Waning Crescent";
  return { phase, illumination, name };
}

// Cheap deterministic hash → number in [0,1). Used to place a "born here" pin
// on the decorative globe without doing real geocoding.
function hashToUnit(str: string, salt = ""): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  for (let i = 0; i < salt.length; i++) h = ((h << 5) + h + salt.charCodeAt(i)) | 0;
  return Math.abs(h % 10000) / 10000;
}

// ─── Themes ────────────────────────────────────────────────────────────────────

const PILLAR_THEMES = {
  relationships: {
    bg:"#2a0815", accent:"#f4a0c0", title:"Relationships",
    subtitle:"Love, Connection & Partnership", roman:"I",
    grad1:"#3d0f1f", grad2:"#1a0510",
  },
  wealth: {
    bg:"#1a1000", accent:"#d4a017", title:"Wealth",
    subtitle:"Abundance, Purpose & Prosperity", roman:"II",
    grad1:"#2a1900", grad2:"#110b00",
  },
  health: {
    bg:"#041a12", accent:"#6dccaa", title:"Health",
    subtitle:"Vitality, Balance & Renewal", roman:"III",
    grad1:"#072a1c", grad2:"#021008",
  },
} as const;

const CHAPTER_THEMES = [
  { bg:"#0e1624", accent:"#c9a84c", textColor:"#e8dfc8" },
  { bg:"#140e00", accent:"#d4a017", textColor:"#f0e0b0" },
  { bg:"#1a0a14", accent:"#e87a9c", textColor:"#f0d0dc" },
  { bg:"#0a1a14", accent:"#6dccaa", textColor:"#c0e8d8" },
  { bg:"#2a0815", accent:"#f4a0c0", textColor:"#f8e0e8" },
  { bg:"#1a1000", accent:"#d4a017", textColor:"#f0e0b0" },
  { bg:"#041a12", accent:"#6dccaa", textColor:"#c0e8d8" },
  { bg:"#100820", accent:"#c878f0", textColor:"#e8c8fc" },
  { bg:"#001420", accent:"#50b8d0", textColor:"#b0d8e8" },
  { bg:"#0e0018", accent:"#d0a0d0", textColor:"#f0d0f0" },
  { bg:"#101a08", accent:"#90c860", textColor:"#d0e8b0" },
  { bg:"#1a0808", accent:"#e06060", textColor:"#f0c0c0" },
];

// ─── Types ─────────────────────────────────────────────────────────────────────

type ContentTheme = { bg: string; accent: string; textColor: string };

type PageData =
  | { type: "cover" }
  | { type: "zodiac-sign" }
  | { type: "moon-phase" }
  | { type: "birthplace" }
  | { type: "dedication" }
  | { type: "toc" }
  | { type: "birth-chart" }
  | { type: "pillar-cover"; pillar: keyof typeof PILLAR_THEMES }
  | { type: "numerology" }
  | { type: "lucky-numbers" }
  | { type: "monthly-forecast"; months: string[] }
  | { type: "affirmations-visual" }
  | { type: "planet-grid" }
  | { type: "wellness-wheel" }
  | { type: "content"; chapterNum: number; title: string; body: string; theme: ContentTheme; isFirst: boolean };

type OrderLike = {
  fullName: string;
  birthday: string;
  birthTime: string;
  birthLocation: string;
  sunSign?: string | null;
  moonSign?: string | null;
  risingSign?: string | null;
  lifePath?: string | null;
  luckyNumbers?: string | null;
  customAffirmations?: string | null;
};

// ─── Content parsing ───────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

function splitIntoChunks(text: string, maxChars = 920): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paragraphs) {
    const s = p.trim();
    if (!s) continue;
    if (cur.length + s.length + 2 > maxChars && cur.length > 360) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += (cur ? "\n\n" : "") + s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  if (chunks.length === 1 && chunks[0].length > 180) {
    const words = chunks[0].split(/\s+/);
    const midpoint = Math.max(1, Math.floor(words.length / 2));
    const first = words.slice(0, midpoint).join(" ").trim();
    const second = words.slice(midpoint).join(" ").trim();
    return [first, second].filter(Boolean);
  }
  return chunks.length ? chunks : [text.slice(0, maxChars)];
}

function parseMonthForecasts(text: string): string[] {
  const months = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];
  return months.map((m) => {
    const rx = new RegExp(`\\b${m}\\b[^:]*:?\\s*([^\n]{30,180})`, "i");
    const match = text.match(rx);
    return match ? match[1]!.trim() : `${m} brings renewed energy and clarity to your path.`;
  });
}

function buildBookPages(content: string): PageData[] {
  const pages: PageData[] = [];
  pages.push({ type: "cover" });
  // Visual showcase pages (also serve as the customer's free preview teaser)
  pages.push({ type: "zodiac-sign" });
  pages.push({ type: "moon-phase" });
  pages.push({ type: "birthplace" });
  pages.push({ type: "dedication" });
  pages.push({ type: "toc" });

  const chapterBlocks = content.split(/\n(?=# (?!#))/);
  let chapterNum = 0;

  for (const block of chapterBlocks) {
    const lines = block.split("\n");
    const h1 = lines.find((l) => l.startsWith("# ") && !l.startsWith("## "));
    if (!h1) continue;

    const title = h1.replace(/^# /, "").trim();
    const bodyRaw = stripMarkdown(
      lines.filter((l) => !l.startsWith("# ") || l.startsWith("## ")).join("\n").trim()
    );
    if (!bodyRaw || bodyRaw.length < 30) continue;

    chapterNum++;
    const theme = CHAPTER_THEMES[(chapterNum - 1) % CHAPTER_THEMES.length]!;
    const chunks = splitIntoChunks(bodyRaw);

    if (chapterNum === 1) {
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
      pages.push({ type: "birth-chart" });
    } else if (chapterNum <= 4) {
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
    } else if (chapterNum === 5) {
      pages.push({ type: "pillar-cover", pillar: "relationships" });
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
    } else if (chapterNum === 6) {
      pages.push({ type: "pillar-cover", pillar: "wealth" });
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
      pages.push({ type: "numerology" });
    } else if (chapterNum === 7) {
      pages.push({ type: "pillar-cover", pillar: "health" });
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
      pages.push({ type: "wellness-wheel" });
    } else if (chapterNum === 8) {
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
      pages.push({ type: "lucky-numbers" });
    } else if (chapterNum === 9) {
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
      pages.push({ type: "planet-grid" });
    } else if (chapterNum === 10) {
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
      pages.push({ type: "affirmations-visual" });
    } else if (chapterNum === 11) {
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
      pages.push({ type: "monthly-forecast", months: parseMonthForecasts(bodyRaw) });
    } else if (chapterNum === 12) {
      pages.push({ type: "monthly-forecast", months: parseMonthForecasts(bodyRaw) });
    } else {
      chunks.forEach((c, i) =>
        pages.push({ type: "content", chapterNum, title, body: c, theme, isFirst: i === 0 })
      );
    }
  }

  // Ensure minimum 40 pages
  if (pages.length < 40) pages.push({ type: "lucky-numbers" });
  if (pages.length < 40) pages.push({ type: "planet-grid" });

  return pages.slice(0, 60);
}

// ─── Page Components ───────────────────────────────────────────────────────────

function CoverPage({ order }: { order?: OrderLike }) {
  const name = order?.fullName ?? "Your Name";
  const sunSym = ZODIAC_SYMBOLS[order?.sunSign ?? ""] ?? "☉";
  const moonSym = ZODIAC_SYMBOLS[order?.moonSign ?? ""] ?? "☽";
  const riseSym = ZODIAC_SYMBOLS[order?.risingSign ?? ""] ?? "↑";

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden select-none"
      style={{ background: "#050812" }}>
      {[...Array(55)].map((_, i) => (
        <div key={i} className="absolute rounded-full bg-white pointer-events-none"
          style={{
            width: `${(i * 31 % 3) + 1}px`, height: `${(i * 31 % 3) + 1}px`,
            top: `${i * 61 % 100}%`, left: `${i * 53 % 100}%`,
            opacity: ((i * 17 % 10) + 1) * 0.07,
          }} />
      ))}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full blur-3xl pointer-events-none"
        style={{ background: "radial-gradient(circle, #c9a84c12 0%, transparent 70%)" }} />

      <div className="relative z-10 text-center px-8 space-y-3">
        <div className="w-14 h-px mx-auto" style={{ background: "#c9a84c55" }} />
        <p className="text-[10px] tracking-[0.4em] uppercase font-light" style={{ color: "#c9a84c75" }}>Holistic Growth</p>
        <div className="flex items-center justify-center gap-4 py-1">
          <span className="text-xl" style={{ color: "#d4a017" }}>{sunSym}</span>
          <span className="text-[#c9a84c30]">·</span>
          <span className="text-xl" style={{ color: "#8090d0" }}>{moonSym}</span>
          <span className="text-[#c9a84c30]">·</span>
          <span className="text-xl" style={{ color: "#70b880" }}>{riseSym}</span>
        </div>
        <h1 className="font-serif text-white text-4xl leading-tight">Life Path</h1>
        <div className="w-14 h-px mx-auto" style={{ background: "#c9a84c55" }} />
        <p className="font-serif italic text-2xl mt-1" style={{ color: "#e8dfc8" }}>{name}</p>
        {order?.birthday && (
          <p className="text-[9px] pt-2" style={{ color: "#c9a84c45" }}>
            {order.birthday} · {order.birthLocation}
          </p>
        )}
        <div className="pt-4">
          <p className="text-[9px] tracking-[0.3em] uppercase" style={{ color: "#c9a84c35" }}>
            Astrology · Numerology · Growth
          </p>
        </div>
      </div>
      <div className="absolute bottom-5 text-center">
        <p className="text-[8px] tracking-widest uppercase" style={{ color: "#ffffff15" }}>Holigrowth Press</p>
      </div>
    </div>
  );
}

function DedicationPage({ order }: { order?: OrderLike }) {
  const name = order?.fullName ?? "You";
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-[#faf7ff] select-none px-10">
      <div className="text-center space-y-4 max-w-xs">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#3b1260]/45">Dedicated to</p>
        <p className="font-serif text-[22px] text-[#1e1b2e] italic">{name}</p>
        <div className="w-10 h-px mx-auto bg-[#c9a96e]" />
        <p className="font-serif text-[12px] text-[#6b5b8a] italic leading-relaxed">
          "The cosmos inscribed your destiny in stars before you drew your first breath. This book is the reading of that ancient script — written for you, and only you."
        </p>
        {order?.birthday && (
          <div className="pt-4 text-[9px] text-[#6b5b8a]/55 space-y-1">
            <p>{order.birthday} · {order.birthTime}</p>
            <p>{order.birthLocation}</p>
          </div>
        )}
        {order?.sunSign && order?.moonSign && order?.risingSign && (
          <div className="flex justify-center gap-3 pt-1 text-[9px] text-[#3b1260]/45">
            <span>{ZODIAC_SYMBOLS[order.sunSign]} {order.sunSign}</span>
            <span>·</span>
            <span>{ZODIAC_SYMBOLS[order.moonSign]} {order.moonSign}</span>
            <span>·</span>
            <span>↑ {order.risingSign}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TocPage({ order }: { order?: OrderLike }) {
  const items = [
    { n: "1", title: "Your Life Path — The Overview", icon: "✦", pillar: null },
    { n: "2", title: `Sun Sign — ${order?.sunSign ?? "Your Sun"}`, icon: "☉", pillar: null },
    { n: "3", title: `Moon Sign — ${order?.moonSign ?? "Your Moon"}`, icon: "☽", pillar: null },
    { n: "4", title: `Rising Sign — ${order?.risingSign ?? "Your Rising"}`, icon: "↑", pillar: null },
    { n: "5", title: "Love & Relationships", icon: "♥", pillar: "I" },
    { n: "6", title: "Wealth & Abundance", icon: "◈", pillar: "II" },
    { n: "7", title: "Health & Vitality", icon: "✦", pillar: "III" },
    { n: "8", title: "Your Lucky Numbers", icon: "✧", pillar: null },
    { n: "9", title: "Planetary Influences", icon: "♄", pillar: null },
    { n: "10", title: "Your Daily Mantras", icon: "✿", pillar: null },
    { n: "11", title: "Sacred Morning Ritual", icon: "◯", pillar: null },
    { n: "12", title: "Year Ahead — Month by Month", icon: "⌘", pillar: null },
  ];
  return (
    <div className="w-full h-full flex flex-col bg-[#faf7ff] select-none px-7 py-6">
      <div className="flex-shrink-0 mb-3">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#3b1260]/45 mb-1">Contents</p>
        <div className="w-full h-px bg-gradient-to-r from-[#c9a96e]/50 to-transparent" />
      </div>
      <div className="flex-1 flex flex-col justify-around gap-0.5">
        {items.map((ch) => (
          <div key={ch.n} className="flex items-center gap-2.5">
            <span className="text-[9px] text-[#c9a96e] font-mono w-3.5 shrink-0">{ch.n}</span>
            <span className="text-[9px] text-[#c9a96e]/55 w-3.5 shrink-0">{ch.icon}</span>
            <span className="text-[11px] text-[#1e1b2e] font-light flex-1 leading-tight">{ch.title}</span>
            {ch.pillar && (
              <span className="text-[8px] text-[#c9a96e]/55 border border-[#c9a96e]/25 rounded px-1 py-0.5 flex-shrink-0">
                {ch.pillar}
              </span>
            )}
          </div>
        ))}
      </div>
      {order?.lifePath && (
        <div className="flex-shrink-0 mt-2 border-t border-[#3b1260]/10 pt-2">
          <p className="text-[8px] text-[#3b1260]/35 text-center">
            Life Path {order.lifePath} · Lucky Numbers: {order.luckyNumbers}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Birth Chart SVG Wheel ──────────────────────────────────────────────────────

function BirthChartPage({ order }: { order?: OrderLike }) {
  const cx = 195, cy = 190, outerR = 148, innerR = 96, centerR = 36;
  const sunIdx = Math.max(0, ZODIAC_LIST.indexOf(order?.sunSign ?? "Aries"));
  const moonIdx = Math.max(0, ZODIAC_LIST.indexOf(order?.moonSign ?? "Cancer"));
  const riseIdx = Math.max(0, ZODIAC_LIST.indexOf(order?.risingSign ?? "Libra"));

  const segs = ZODIAC_LIST.map((sign, i) => {
    const a1 = ((i * 30 - 90) * Math.PI) / 180;
    const a2 = (((i + 1) * 30 - 90) * Math.PI) / 180;
    const am = (((i + 0.5) * 30 - 90) * Math.PI) / 180;
    const isSun = i === sunIdx, isMoon = i === moonIdx, isRise = i === riseIdx;
    const base = ZODIAC_COLORS[sign] ?? "#888";
    const fill = isSun ? "#c9a84c" : isMoon ? "#5070c0" : isRise ? "#4daa78" : base + "28";
    return {
      sign, fill, isSun, isMoon, isRise,
      ox1: cx + outerR * Math.cos(a1), oy1: cy + outerR * Math.sin(a1),
      ox2: cx + outerR * Math.cos(a2), oy2: cy + outerR * Math.sin(a2),
      ix1: cx + innerR * Math.cos(a1), iy1: cy + innerR * Math.sin(a1),
      ix2: cx + innerR * Math.cos(a2), iy2: cy + innerR * Math.sin(a2),
      tx: cx + ((outerR + innerR) / 2) * Math.cos(am),
      ty: cy + ((outerR + innerR) / 2) * Math.sin(am),
    };
  });

  return (
    <div className="w-full h-full flex flex-col bg-[#050d1a] select-none">
      <div className="px-5 pt-5 pb-1 flex-shrink-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#c9a84c]/55">Birth Chart</p>
        <p className="font-serif text-white text-[14px]">{order?.fullName ?? "Your"}'s Celestial Map</p>
      </div>
      <div className="flex-1 flex items-center justify-center px-2">
        <svg viewBox="0 0 390 365" className="w-full h-full max-h-[310px]">
          <circle cx={cx} cy={cy} r={outerR + 14} fill="none" stroke="#c9a84c08" strokeWidth="18" />
          {segs.map(({ sign, fill, ox1, oy1, ox2, oy2, ix1, iy1, ix2, iy2, tx, ty, isSun, isMoon, isRise }) => (
            <g key={sign}>
              <path
                d={`M ${ix1} ${iy1} L ${ox1} ${oy1} A ${outerR} ${outerR} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 0 0 ${ix1} ${iy1} Z`}
                fill={fill} stroke="#050d1a" strokeWidth="1.5"
              />
              <text x={tx} y={ty} fill={isSun || isMoon || isRise ? "#fff" : "#ffffff45"}
                fontSize="11" textAnchor="middle" dominantBaseline="middle" fontFamily="serif">
                {ZODIAC_SYMBOLS[sign] ?? "○"}
              </text>
            </g>
          ))}
          <circle cx={cx} cy={cy} r={innerR} fill="#080f20" stroke="#c9a84c18" strokeWidth="1" />
          <g transform="translate(270, 282)">
            <circle cx="23" cy="23" r="22" fill="#0d1426" stroke="#c9a84c22" strokeWidth="1" />
            <path d="M23 10c-7 0-13 6-13 13 0 10 13 20 13 20s13-10 13-20c0-7-6-13-13-13Zm0 18a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z" fill="#c9a84c" />
          </g>
          <text x="293" y="336" fill="#ffffff55" fontSize="8" textAnchor="middle" fontFamily="serif">Born Here</text>
          {ZODIAC_LIST.map((_, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180;
            return (
              <line key={i}
                x1={cx + innerR * Math.cos(a)} y1={cy + innerR * Math.sin(a)}
                x2={cx + outerR * Math.cos(a)} y2={cy + outerR * Math.sin(a)}
                stroke="#c9a84c18" strokeWidth="0.5"
              />
            );
          })}
          <circle cx={cx} cy={cy} r={centerR} fill="#030810" stroke="#c9a84c35" strokeWidth="1.5" />
          <text x={cx} y={cy - 9} fill="#c9a84c85" fontSize="8" textAnchor="middle" fontFamily="serif">Life Path</text>
          <text x={cx} y={cy + 12} fill="#c9a84c" fontSize="20" textAnchor="middle" fontFamily="serif" fontWeight="bold">
            {order?.lifePath ?? "7"}
          </text>
          {/* Legend */}
          <g transform="translate(268, 40)">
            {[
              { color:"#c9a84c", label:`☉ ${order?.sunSign ?? "Sun"}` },
              { color:"#5070c0", label:`☽ ${order?.moonSign ?? "Moon"}` },
              { color:"#4daa78", label:`↑ ${order?.risingSign ?? "Rising"}` },
            ].map(({ color, label }, i) => (
              <g key={i} transform={`translate(0,${i * 20})`}>
                <rect width="10" height="10" rx="2" fill={color} opacity="0.9" />
                <text x="14" y="9" fill="#ffffff70" fontSize="9" fontFamily="sans-serif">{label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="px-5 pb-3 flex-shrink-0">
        <p className="text-[8px] text-[#c9a84c]/35 text-center tracking-wider">
          {order?.birthday} · {order?.birthLocation}
        </p>
      </div>
    </div>
  );
}

// ── Pillar Cover Pages ─────────────────────────────────────────────────────────

function PillarCoverPage({ pillar, order }: { pillar: keyof typeof PILLAR_THEMES; order?: OrderLike }) {
  const t = PILLAR_THEMES[pillar];
  const name = order?.fullName ?? "You";

  const Deco = () => {
    if (pillar === "relationships") return (
      <svg viewBox="0 0 200 200" className="w-32 h-32 opacity-25">
        {[35,55,75,95].map((r,i) => <circle key={i} cx="100" cy="100" r={r} fill="none" stroke={t.accent} strokeWidth="1.2" />)}
        {[0,45,90,135].map((d,i) => <line key={i} x1="100" y1="5" x2="100" y2="195" stroke={t.accent} strokeWidth="0.6" opacity="0.5" transform={`rotate(${d} 100 100)`} />)}
        <circle cx="100" cy="100" r="10" fill={t.accent} opacity="0.7" />
        <text x="100" y="106" textAnchor="middle" fill={t.accent} fontSize="12">♥</text>
      </svg>
    );
    if (pillar === "wealth") return (
      <svg viewBox="0 0 200 200" className="w-32 h-32 opacity-25">
        {[0,30,60,90,120,150].map((d,i) => <line key={i} x1="100" y1="10" x2="100" y2="190" stroke={t.accent} strokeWidth="0.7" opacity="0.5" transform={`rotate(${d} 100 100)`} />)}
        <polygon points="100,20 145,80 100,50 55,80" fill="none" stroke={t.accent} strokeWidth="1.4" />
        <polygon points="100,180 55,120 100,150 145,120" fill="none" stroke={t.accent} strokeWidth="1.4" />
        <circle cx="100" cy="100" r="55" fill="none" stroke={t.accent} strokeWidth="1" />
        <circle cx="100" cy="100" r="16" fill={t.accent} opacity="0.35" />
        <text x="100" y="106" textAnchor="middle" fill={t.accent} fontSize="12">◈</text>
      </svg>
    );
    return (
      <svg viewBox="0 0 200 200" className="w-32 h-32 opacity-25">
        {[0,45,90,135].map((d,i) => <ellipse key={i} cx="100" cy="58" rx="18" ry="44" fill={t.accent} opacity="0.35" transform={`rotate(${d} 100 100)`} />)}
        {[22.5,67.5,112.5,157.5].map((d,i) => <ellipse key={i+4} cx="100" cy="64" rx="12" ry="36" fill="none" stroke={t.accent} strokeWidth="1.1" transform={`rotate(${d} 100 100)`} />)}
        <circle cx="100" cy="100" r="17" fill={t.accent} opacity="0.55" />
        <text x="100" y="106" textAnchor="middle" fill={t.accent} fontSize="12">✦</text>
      </svg>
    );
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden select-none"
      style={{ background: `linear-gradient(160deg, ${t.grad1} 0%, ${t.bg} 55%, ${t.grad2} 100%)` }}>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-56 h-56 rounded-full blur-3xl opacity-15" style={{ background: t.accent }} />
      </div>
      <div className="relative z-10 flex flex-col items-center text-center px-8 space-y-4">
        <p className="text-[9px] tracking-[0.45em] uppercase font-light" style={{ color: `${t.accent}70` }}>
          Pillar {t.roman}
        </p>
        <Deco />
        <h2 className="font-serif text-[36px] leading-none" style={{ color: t.accent }}>{t.title}</h2>
        <p className="font-serif italic text-[12px]" style={{ color: `${t.accent}85` }}>{t.subtitle}</p>
        <div className="w-10 h-px" style={{ background: `${t.accent}55` }} />
        <p className="text-[9px]" style={{ color: `${t.accent}55` }}>{name}'s personal reading</p>
      </div>
    </div>
  );
}

// ── Numerology Chart ───────────────────────────────────────────────────────────

function NumerologyPage({ order }: { order?: OrderLike }) {
  const lp = parseInt(order?.lifePath ?? "7");
  const nums = (order?.luckyNumbers ?? "3, 7, 11").split(",").map((n) => parseInt(n.trim())).filter((n) => n >= 1 && n <= 9);
  const highlighted = new Set([lp, ...nums]);
  const grid = [[1,2,3],[4,5,6],[7,8,9]];
  const meanings: Record<number,string> = {
    1:"Leader", 2:"Balance", 3:"Expression",
    4:"Structure", 5:"Freedom", 6:"Harmony",
    7:"Wisdom", 8:"Power", 9:"Completion",
  };
  return (
    <div className="w-full h-full flex flex-col bg-[#0e0828] select-none px-6 py-6">
      <div className="flex-shrink-0 mb-4">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#c9a84c]/55">Numerology</p>
        <p className="font-serif text-white text-[14px]">Your Sacred Number Grid</p>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-5">
        <div className="grid grid-cols-3 gap-2.5">
          {grid.flat().map((n) => {
            const isLP = n === lp, isHL = highlighted.has(n);
            return (
              <div key={n} className="w-[60px] h-[60px] rounded-xl flex flex-col items-center justify-center border"
                style={{
                  background: isLP ? "#c9a84c" : isHL ? "#2a1255" : "#140d28",
                  borderColor: isLP ? "#c9a84c" : isHL ? "#c9a84c45" : "#3b126030",
                }}>
                <span className="font-serif font-bold text-2xl leading-none" style={{ color: isLP ? "#1a0533" : isHL ? "#c9a84c" : "#5b4a7a" }}>{n}</span>
                <span className="text-[7px] mt-0.5" style={{ color: isLP ? "#1a053380" : isHL ? "#c9a84c70" : "#5b4a7a60" }}>{meanings[n]}</span>
              </div>
            );
          })}
        </div>
        <div className="text-center space-y-1 px-2 max-w-[240px]">
          <p className="text-[10px] text-[#c9a84c]/75 font-medium">Life Path {order?.lifePath ?? "7"}</p>
          <p className="text-[10px] text-[#b89fd4]/65 leading-relaxed">
            Your core number shapes every area of your destiny — highlighted in gold above.
          </p>
          {order?.luckyNumbers && (
            <p className="text-[9px] text-[#c9a84c]/45 mt-1">Lucky Numbers: {order.luckyNumbers}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lucky Numbers SVG ──────────────────────────────────────────────────────────

function LuckyNumbersPage({ order }: { order?: OrderLike }) {
  const raw = order?.luckyNumbers ?? "3, 7, 11, 22";
  const nums = raw.split(",").map((n) => n.trim()).slice(0, 7);
  const cx = 190, cy = 185;

  return (
    <div className="w-full h-full flex flex-col bg-[#060a18] select-none">
      <div className="px-5 pt-5 pb-1 flex-shrink-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#c9a84c]/55">Numerology</p>
        <p className="font-serif text-white text-[14px]">Your Lucky Numbers</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 380 360" className="w-full max-h-[295px]">
          {[55,95,130].map((r,i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke="#c9a84c" strokeWidth="0.4" strokeDasharray="3 6" opacity="0.25" />
          ))}
          {/* Stars */}
          {[...Array(18)].map((_, i) => (
            <text key={i} x={35 + (i * 89 % 300)} y={20 + (i * 67 % 320)}
              fill="#c9a84c" fontSize="7" opacity={(i * 11 % 7 + 2) * 0.06}>✦</text>
          ))}
          <circle cx={cx} cy={cy} r={26} fill="#12082a" stroke="#c9a84c50" strokeWidth="1.5" />
          <text x={cx} y={cy - 5} fill="#c9a84c" fontSize="7" textAnchor="middle" fontFamily="serif" opacity="0.7">Your</text>
          <text x={cx} y={cy + 8} fill="#c9a84c" fontSize="7" textAnchor="middle" fontFamily="serif" opacity="0.7">Numbers</text>
          {nums.map((num, i) => {
            const angle = ((i * (360 / nums.length)) - 90) * (Math.PI / 180);
            const dist = i % 2 === 0 ? 130 : 95;
            const bx = cx + dist * Math.cos(angle);
            const by = cy + dist * Math.sin(angle);
            const isPrimary = i === 0;
            return (
              <g key={i}>
                <line x1={cx} y1={cy} x2={bx} y2={by} stroke="#c9a84c18" strokeWidth="0.6" />
                <circle cx={bx} cy={by} r={isPrimary ? 24 : 18} fill={isPrimary ? "#c9a84c" : "#150d35"} stroke="#c9a84c" strokeWidth={isPrimary ? 0 : 1} opacity={isPrimary ? 1 : 0.85} />
                <text x={bx} y={by + (isPrimary ? 8 : 6)} fill={isPrimary ? "#1a0533" : "#c9a84c"} fontSize={isPrimary ? 20 : 15} textAnchor="middle" fontFamily="serif" fontWeight="bold">{num}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Monthly Forecast ───────────────────────────────────────────────────────────

function MonthlyForecastPage({ months }: { months: string[] }) {
  const NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const COLORS = ["#e87a9c","#f0a050","#d4a017","#90c860","#6dccaa","#50b8d0","#5088c8","#b08fdf","#c878f0","#e06060","#c87abc","#60b8c8"];
  return (
    <div className="w-full h-full flex flex-col bg-[#faf7ff] select-none px-5 py-5">
      <div className="flex-shrink-0 mb-3">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#3b1260]/45 mb-0.5">Your Year Ahead</p>
        <p className="font-serif text-[#1e1b2e] text-[13px]">Month-by-Month Guidance</p>
      </div>
      <div className="flex-1 grid grid-cols-3 gap-1.5">
        {NAMES.map((name, i) => (
          <div key={i} className="rounded-lg p-2 flex flex-col gap-0.5"
            style={{ background: COLORS[i] + "15", borderLeft: `2px solid ${COLORS[i]}55` }}>
            <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: COLORS[i] }}>{name}</p>
            <p className="text-[8px] text-[#1e1b2e]/55 leading-tight line-clamp-3">
              {months[i] ?? "Energy flows and opportunities emerge."}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Wellness Wheel ─────────────────────────────────────────────────────────────

function WellnessWheelPage({ order }: { order?: OrderLike }) {
  const cx = 195, cy = 185;
  const cats = [
    { label:"Movement", icon:"◎", r:88, color:"#6dccaa" },
    { label:"Nutrition", icon:"✦", r:112, color:"#90c860" },
    { label:"Sleep",     icon:"☽", r:88, color:"#5088c8" },
    { label:"Mindset",   icon:"◇", r:112, color:"#b08fdf" },
    { label:"Breath",    icon:"〜", r:88, color:"#50b8d0" },
    { label:"Ritual",    icon:"✿", r:112, color:"#d4a017" },
  ];
  return (
    <div className="w-full h-full flex flex-col bg-[#041a10] select-none">
      <div className="px-5 pt-5 pb-1 flex-shrink-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#6dccaa]/55">Health</p>
        <p className="font-serif text-white text-[14px]">Your Wellness Blueprint</p>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <svg viewBox="0 0 390 360" className="w-full max-h-[300px]">
          {[45,75,105,135].map((r,i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke="#6dccaa" strokeWidth="0.4" opacity={0.12 + i * 0.04} />
          ))}
          {cats.map(({ label, icon, r, color }, i) => {
            const angle = ((i * 60) - 90) * (Math.PI / 180);
            const bx = cx + r * Math.cos(angle), by = cy + r * Math.sin(angle);
            const le = cx + 42 * Math.cos(angle), lf = cy + 42 * Math.sin(angle);
            return (
              <g key={i}>
                <line x1={le} y1={lf} x2={cx + (r-18)*Math.cos(angle)} y2={cy + (r-18)*Math.sin(angle)} stroke={color} strokeWidth="0.5" opacity="0.45" />
                <circle cx={bx} cy={by} r={17} fill={color + "28"} stroke={color} strokeWidth="1.2" />
                <text x={bx} y={by-3} fill={color} fontSize="10" textAnchor="middle">{icon}</text>
                <text x={bx} y={by+9} fill={color + "cc"} fontSize="7" textAnchor="middle">{label}</text>
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={38} fill="#062014" stroke="#6dccaa35" strokeWidth="1.5" />
          <text x={cx} y={cy - 7} fill="#6dccaa" fontSize="9" textAnchor="middle" fontFamily="serif">Body</text>
          <text x={cx} y={cy + 7} fill="#6dccaa" fontSize="9" textAnchor="middle" fontFamily="serif">Code</text>
          <text x={cx} y={cy + 20} fill="#6dccaa70" fontSize="7" textAnchor="middle" fontFamily="serif">
            {order?.sunSign ?? "Your Sign"}
          </text>
        </svg>
      </div>
    </div>
  );
}

// ── Planet Grid ────────────────────────────────────────────────────────────────

function PlanetGridPage({ order }: { order?: OrderLike }) {
  const planets = [
    { symbol:"☉", name:"Sun",     sign: order?.sunSign  ?? "?", color:"#d4a017" },
    { symbol:"☽", name:"Moon",    sign: order?.moonSign ?? "?", color:"#8090c8" },
    { symbol:"↑",  name:"Rising",  sign: order?.risingSign ?? "?", color:"#70b880" },
    { symbol:"♂", name:"Mars",    sign:"Aries",        color:"#e85d5d" },
    { symbol:"♀", name:"Venus",   sign:"Libra",        color:"#f4a0c0" },
    { symbol:"☿", name:"Mercury", sign:"Gemini",       color:"#60c8d8" },
    { symbol:"♃", name:"Jupiter", sign:"Sagittarius",  color:"#d0a050" },
    { symbol:"♄", name:"Saturn",  sign:"Capricorn",    color:"#9888b0" },
    { symbol:"♆", name:"Neptune", sign:"Pisces",       color:"#6080e0" },
  ];
  return (
    <div className="w-full h-full flex flex-col bg-[#080c1c] select-none px-5 py-5">
      <div className="flex-shrink-0 mb-4">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#c9a84c]/55">Planetary Influences</p>
        <p className="font-serif text-white text-[13px]">Your Celestial Assembly</p>
      </div>
      <div className="flex-1 grid grid-cols-3 gap-2">
        {planets.map(({ symbol, name, sign, color }) => (
          <div key={name} className="rounded-xl flex flex-col items-center justify-center gap-1 py-2"
            style={{ background: color + "12", border: `1px solid ${color}28` }}>
            <span className="text-[22px] leading-none" style={{ color }}>{symbol}</span>
            <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: color + "bb" }}>{name}</span>
            <span className="text-[8px]" style={{ color: color + "65" }}>
              {ZODIAC_SYMBOLS[sign] ?? ""} {sign}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Affirmations Visual ────────────────────────────────────────────────────────

function AffirmationsVisualPage({ order }: { order?: OrderLike }) {
  const raw = order?.customAffirmations;
  const lines = raw
    ? raw.split(/[.\n]+/).filter((s) => s.trim().length > 10).map((s) => s.trim()).slice(0, 5)
    : [
        "I am aligned with my highest path.",
        "Love flows to me effortlessly.",
        "Abundance is my natural state.",
        "My body is a sacred vessel of vitality.",
        "The universe conspires in my favor.",
      ];

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden select-none"
      style={{ background: "linear-gradient(160deg, #1a0533 0%, #0e0220 60%, #050012 100%)" }}>
      {[...Array(28)].map((_, i) => (
        <div key={i} className="absolute rounded-full bg-white pointer-events-none"
          style={{ width:"1px", height:"1px", top:`${i * 67 % 100}%`, left:`${i * 53 % 100}%`, opacity:(i % 5)*0.09+0.08 }} />
      ))}
      <div className="relative z-10 px-8 text-center space-y-4">
        <p className="text-[9px] tracking-[0.4em] uppercase text-[#c9a84c]/55 mb-3">Your Affirmations</p>
        {lines.map((a, i) => (
          <p key={i} className="font-serif italic leading-relaxed text-[12px]"
            style={{ color: i === 0 ? "#c9a84c" : `rgba(212,194,240,${1 - i * 0.14})` }}>
            "{a}"
          </p>
        ))}
        <div className="pt-3">
          <span className="text-[#c9a84c]/35 text-base">✦ ✦ ✦</span>
        </div>
      </div>
    </div>
  );
}

// ── Zodiac Sign Page ───────────────────────────────────────────────────────────

function ZodiacSignPage({ order }: { order?: OrderLike }) {
  const sign = (order?.sunSign && ZODIAC_DATA[order.sunSign]) ? order.sunSign : "Aries";
  const data = ZODIAC_DATA[sign]!;
  const accent = ZODIAC_COLORS[sign] ?? "#c9a84c";
  const constellation = ZODIAC_CONSTELLATIONS[sign]!;
  const elementColor = ELEMENT_COLOR[data.element];

  return (
    <div className="w-full h-full flex flex-col bg-[#050d1a] select-none relative overflow-hidden">
      {/* Subtle starfield */}
      <svg viewBox="0 0 400 600" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 60 }, (_, i) => {
          const x = (i * 137) % 400;
          const y = (i * 89) % 600;
          const r = (i % 5) * 0.3 + 0.4;
          const op = ((i * 17) % 80) / 200 + 0.1;
          return <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={op} />;
        })}
      </svg>

      <div className="relative z-10 px-5 pt-5 pb-1 flex-shrink-0">
        <p className="text-[9px] tracking-[0.3em] uppercase" style={{ color: accent + "99" }}>Your Sun Sign</p>
        <p className="font-serif text-white text-[14px]">{order?.fullName ?? "Your"} · Born under {sign}</p>
      </div>

      {/* Constellation panel */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6">
        <svg viewBox="0 0 100 100" className="w-full h-full max-h-[230px]">
          {constellation.lines.map(([a, b], i) => {
            const [x1, y1] = constellation.points[a]!;
            const [x2, y2] = constellation.points[b]!;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth="0.4" opacity="0.55" />;
          })}
          {constellation.points.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="2.4" fill={accent} opacity="0.25" />
              <circle cx={x} cy={y} r="1.1" fill="#fff" />
            </g>
          ))}
          <text x="50" y="92" textAnchor="middle" fill={accent} fontSize="22" fontFamily="serif">
            {ZODIAC_SYMBOLS[sign]}
          </text>
        </svg>
      </div>

      {/* Sign meta */}
      <div className="relative z-10 px-6 pb-5 flex-shrink-0">
        <p className="font-serif text-white text-2xl text-center mb-1">{sign}</p>
        <p className="font-serif italic text-center text-[12px] mb-4" style={{ color: accent }}>{data.tagline}</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Element",  value: data.element,  color: elementColor },
            { label: "Modality", value: data.modality, color: "#c9a84c" },
            { label: "Ruler",    value: data.ruler,    color: accent },
          ].map((m) => (
            <div key={m.label} className="rounded-md border border-white/10 bg-white/5 py-2">
              <p className="text-[8px] tracking-widest uppercase text-white/40">{m.label}</p>
              <p className="text-[11px] mt-1" style={{ color: m.color }}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Moon Phase Page ────────────────────────────────────────────────────────────

function MoonPhasePage({ order }: { order?: OrderLike }) {
  const birthday = order?.birthday ?? new Date().toISOString().slice(0, 10);
  const { phase, illumination, name } = moonPhaseFromBirthday(birthday);

  // Two-arc moon-phase path. r = radius of the visible disk; the inner arc is
  // an ellipse whose x-radius shrinks/grows and flips orientation as the phase
  // moves through new → full → new.
  const cx = 100, cy = 100, r = 78;
  // angleProgress: 0..1 around the full cycle.
  // x-radius of the inner ellipse (terminator).
  const innerRx = Math.abs(Math.cos(2 * Math.PI * phase)) * r;
  // sweep flag: which side gets illuminated (waxing → right; waning → left)
  const waxing = phase < 0.5;
  const gibbous = illumination > 0.5;
  // Outer half-circle: always illuminated (right side when waxing, left when waning)
  const outerSweep = waxing ? 1 : 0;
  // Inner ellipse arc: sweep depends on whether we're in crescent (subtract from disk) or gibbous (add to disk)
  const innerSweep = waxing === gibbous ? 1 : 0;
  // Path: M top → outer arc to bottom → inner ellipse arc back to top.
  const moonPath =
    `M ${cx} ${cy - r} ` +
    `A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} ` +
    `A ${innerRx} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;

  return (
    <div className="w-full h-full flex flex-col bg-[#050d1a] select-none relative overflow-hidden">
      <svg viewBox="0 0 400 600" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 50 }, (_, i) => {
          const x = (i * 191) % 400;
          const y = (i * 113) % 600;
          const rad = (i % 4) * 0.3 + 0.4;
          const op = ((i * 23) % 70) / 200 + 0.1;
          return <circle key={i} cx={x} cy={y} r={rad} fill="#fff" opacity={op} />;
        })}
      </svg>

      <div className="relative z-10 px-5 pt-5 pb-1 flex-shrink-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#c9a84c]/55">Born Under</p>
        <p className="font-serif text-white text-[14px]">The moon on {order?.birthday ?? "your day"}</p>
      </div>

      <div className="relative z-10 flex-1 flex items-center justify-center px-2">
        <svg viewBox="0 0 200 200" className="w-full h-full max-h-[260px]">
          {/* Halo */}
          <defs>
            <radialGradient id="moonHalo">
              <stop offset="40%" stopColor="#fff" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="moonLit">
              <stop offset="0%" stopColor="#fff8e8" />
              <stop offset="80%" stopColor="#e6dcc4" />
              <stop offset="100%" stopColor="#b8af9a" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={r + 18} fill="url(#moonHalo)" />
          {/* Dark disk */}
          <circle cx={cx} cy={cy} r={r} fill="#0c1428" stroke="#c9a84c22" strokeWidth="0.6" />
          {/* Lit portion */}
          <path d={moonPath} fill="url(#moonLit)" />
          {/* Soft crater texture, only on lit side */}
          <g opacity="0.2" clipPath="url(#litMask)">
            <circle cx={cx - 12} cy={cy - 18} r="6" fill="#a89878" />
            <circle cx={cx + 18} cy={cy + 8} r="4" fill="#9a8a6a" />
            <circle cx={cx - 4} cy={cy + 24} r="3" fill="#a89878" />
          </g>
        </svg>
      </div>

      <div className="relative z-10 px-6 pb-5 flex-shrink-0">
        <p className="font-serif text-white text-2xl text-center mb-1">{name}</p>
        <p className="text-center text-[10px] tracking-[0.25em] uppercase text-[#c9a84c]/70 mb-3">
          {Math.round(illumination * 100)}% illuminated
        </p>
        <p className="font-serif italic text-center text-[11px] text-white/55 leading-relaxed px-4">
          The sky you were born beneath, captured in light. Decoded in your book.
        </p>
      </div>
    </div>
  );
}

// ── Birthplace Vignette ────────────────────────────────────────────────────────

function BirthplacePage({ order }: { order?: OrderLike }) {
  const location = order?.birthLocation ?? "Your hometown";
  // Decorative pin position — deterministic per location, NOT real coords.
  const cx = 100, cy = 100, r = 78;
  const lat = (hashToUnit(location, "lat") - 0.5) * 1.4; // -0.7..0.7 (avoid poles)
  const lon = (hashToUnit(location, "lon") - 0.5) * 2;   // -1..1
  const pinX = cx + Math.sin(lon * Math.PI) * r * Math.cos(lat * Math.PI / 2) * 0.78;
  const pinY = cy - Math.sin(lat * Math.PI / 2) * r * 0.78;

  return (
    <div className="w-full h-full flex flex-col bg-[#050d1a] select-none relative overflow-hidden">
      <svg viewBox="0 0 400 600" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 40 }, (_, i) => {
          const x = (i * 211) % 400;
          const y = (i * 167) % 600;
          const rad = (i % 4) * 0.3 + 0.4;
          const op = ((i * 19) % 60) / 200 + 0.1;
          return <circle key={i} cx={x} cy={y} r={rad} fill="#fff" opacity={op} />;
        })}
      </svg>

      <div className="relative z-10 px-5 pt-5 pb-1 flex-shrink-0">
        <p className="text-[9px] tracking-[0.3em] uppercase text-[#c9a84c]/55">Born In</p>
        <p className="font-serif text-white text-[14px]">{order?.fullName ?? "Your"}'s point of arrival</p>
      </div>

      <div className="relative z-10 flex-1 flex items-center justify-center px-2">
        <svg viewBox="0 0 200 200" className="w-full h-full max-h-[260px]">
          <defs>
            <radialGradient id="globeShade" cx="40%" cy="35%">
              <stop offset="0%" stopColor="#1a3650" />
              <stop offset="60%" stopColor="#0d1f30" />
              <stop offset="100%" stopColor="#050d1a" />
            </radialGradient>
            <radialGradient id="globeGlow">
              <stop offset="60%" stopColor="#c9a84c" stopOpacity="0" />
              <stop offset="95%" stopColor="#c9a84c" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#c9a84c" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Glow halo */}
          <circle cx={cx} cy={cy} r={r + 12} fill="url(#globeGlow)" />
          {/* Globe sphere */}
          <circle cx={cx} cy={cy} r={r} fill="url(#globeShade)" stroke="#c9a84c30" strokeWidth="0.6" />

          {/* Latitude lines */}
          {[-0.6, -0.3, 0, 0.3, 0.6].map((y, i) => {
            const yPos = cy + y * r;
            const lineRx = r * Math.cos(Math.asin(y));
            return (
              <ellipse key={`lat-${i}`} cx={cx} cy={yPos} rx={lineRx} ry={lineRx * 0.06}
                fill="none" stroke="#c9a84c" strokeWidth="0.3" opacity="0.18" />
            );
          })}
          {/* Longitude lines (visible front-half ellipses) */}
          {[-0.65, -0.32, 0, 0.32, 0.65].map((x, i) => (
            <ellipse key={`lon-${i}`} cx={cx} cy={cy} rx={Math.abs(x * r) + 1} ry={r}
              fill="none" stroke="#c9a84c" strokeWidth="0.3" opacity="0.18" />
          ))}
          {/* Decorative continent silhouettes — abstract, not cartographic */}
          <path d="M 56 78 Q 70 70, 86 78 Q 96 90, 88 102 Q 72 106, 60 96 Z" fill="#c9a84c" opacity="0.18" />
          <path d="M 110 90 Q 124 86, 140 96 Q 144 110, 132 118 Q 116 116, 108 104 Z" fill="#c9a84c" opacity="0.16" />
          <path d="M 70 130 Q 90 124, 108 138 Q 110 152, 92 156 Q 76 152, 68 142 Z" fill="#c9a84c" opacity="0.14" />

          {/* Pulsing pin */}
          <circle cx={pinX} cy={pinY} r="6" fill="#c9a84c" opacity="0.18">
            <animate attributeName="r" from="6" to="14" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.4" to="0" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={pinX} cy={pinY} r="3" fill="#fff" stroke="#c9a84c" strokeWidth="1" />
        </svg>
      </div>

      <div className="relative z-10 px-6 pb-5 flex-shrink-0">
        <p className="font-serif text-white text-2xl text-center mb-1">{location}</p>
        <p className="font-serif italic text-center text-[11px] text-white/55 leading-relaxed px-4">
          The exact coordinates of your first breath shape every transit and progression in your chart.
        </p>
      </div>
    </div>
  );
}

// ── Content Page ───────────────────────────────────────────────────────────────

function ContentPageView({ page, order }: { page: Extract<PageData, { type:"content" }>; order?: OrderLike }) {
  const name = order?.fullName ?? "You";
  const paragraphs = page.body
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part
    .replace(/\bthe individual\b/gi, name)
    .replace(/\bthe native\b/gi, name)
    .replace(/\bthe person\b/gi, name));
  const renderParagraphs = paragraphs.length >= 2
    ? paragraphs.slice(0, 2)
    : [
        page.body,
        "The second half of this spread continues the same reflection, giving the page a layered editorial feel like your reference image.",
      ];

  return (
    <div className="w-full h-full flex flex-col bg-[#faf8f3] overflow-hidden select-none">
      <div className="h-[3px] flex-shrink-0" style={{ background: `linear-gradient(90deg, transparent, ${page.theme.accent}, transparent)` }} />
      <div className="px-8 py-4 relative overflow-hidden flex-shrink-0" style={{ background: page.theme.bg }}>
        <div className="absolute right-4 top-2 font-serif text-6xl leading-none select-none pointer-events-none"
          style={{ color: `${page.theme.accent}0e` }}>
          {String(page.chapterNum).padStart(2, "0")}
        </div>
        {page.isFirst && (
          <p className="text-[9px] tracking-[0.3em] uppercase mb-1 font-light" style={{ color: `${page.theme.accent}75` }}>
            Chapter {page.chapterNum}
          </p>
        )}
        <h2 className="font-serif text-[13px] leading-snug" style={{ color: page.theme.textColor }}>
          {page.isFirst ? page.title : page.title}
        </h2>
      </div>
      <div className="flex-1 px-8 py-4 overflow-hidden flex flex-col gap-2.5">
        {renderParagraphs.map((paragraph, index) => (
          <p key={index} className={`font-serif text-[#1e1b2e]/83 text-[13px] leading-[1.58] ${index === 1 ? "opacity-95" : ""}`}>
            {paragraph}
          </p>
        ))}
      </div>
      <div className="px-8 pb-3 flex items-center justify-between border-t border-[#1e1b2e]/5 pt-2 flex-shrink-0">
        <p className="text-[8px] tracking-widest uppercase" style={{ color: `${page.theme.accent}65` }}>
          Holistic Growth
        </p>
        <p className="text-[9px] text-[#1e1b2e]/22">{page.chapterNum}</p>
      </div>
    </div>
  );
}

// ─── Render dispatcher ─────────────────────────────────────────────────────────

function renderPage(page: PageData, order?: OrderLike): React.ReactNode {
  switch (page.type) {
    case "cover":              return <CoverPage order={order} />;
    case "zodiac-sign":        return <ZodiacSignPage order={order} />;
    case "moon-phase":         return <MoonPhasePage order={order} />;
    case "birthplace":         return <BirthplacePage order={order} />;
    case "dedication":         return <DedicationPage order={order} />;
    case "toc":                return <TocPage order={order} />;
    case "birth-chart":        return <BirthChartPage order={order} />;
    case "pillar-cover":       return <PillarCoverPage pillar={page.pillar} order={order} />;
    case "numerology":         return <NumerologyPage order={order} />;
    case "lucky-numbers":      return <LuckyNumbersPage order={order} />;
    case "monthly-forecast":   return <MonthlyForecastPage months={page.months} />;
    case "affirmations-visual":return <AffirmationsVisualPage order={order} />;
    case "planet-grid":        return <PlanetGridPage order={order} />;
    case "wellness-wheel":     return <WellnessWheelPage order={order} />;
    case "content":            return <ContentPageView page={page} order={order} />;
  }
}

// ─── Locked overlay ────────────────────────────────────────────────────────────

function LockedOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center"
      style={{ backdropFilter:"blur(6px)", background:"rgba(250,247,255,0.3)" }}>
      <div className="w-10 h-10 rounded-full bg-[#3b1260]/15 flex items-center justify-center mb-3">
        <Lock className="w-5 h-5 text-[#c9a96e]/65" />
      </div>
      <p className="font-serif text-[#1e1b2e]/55 text-xs text-center px-8 leading-relaxed">
        Unlock in your hardcover book
      </p>
    </div>
  );
}

// ─── Dot color per page type ───────────────────────────────────────────────────

function pageColor(p: PageData): string {
  if (p.type === "cover") return "#c9a84c";
  if (p.type === "zodiac-sign") return "#e8704a";
  if (p.type === "moon-phase") return "#dcd0a8";
  if (p.type === "birthplace") return "#6090c8";
  if (p.type === "dedication" || p.type === "toc") return "#9880c8";
  if (p.type === "birth-chart") return "#6080c8";
  if (p.type === "pillar-cover") return { relationships:"#f4a0c0", wealth:"#d4a017", health:"#6dccaa" }[p.pillar];
  if (p.type === "numerology" || p.type === "lucky-numbers") return "#c9a84c";
  if (p.type === "monthly-forecast") return "#90c860";
  if (p.type === "affirmations-visual") return "#c878f0";
  if (p.type === "planet-grid") return "#5088c8";
  if (p.type === "wellness-wheel") return "#6dccaa";
  if (p.type === "content") return p.theme.accent;
  return "#888";
}

// ─── Sample pages (no content yet) ────────────────────────────────────────────

const SAMPLE_PAGES: PageData[] = [
  { type:"cover" },
  { type:"zodiac-sign" },
  { type:"moon-phase" },
  { type:"birthplace" },
  { type:"dedication" }, { type:"toc" },
  { type:"birth-chart" },
  { type:"pillar-cover", pillar:"relationships" },
  { type:"content", chapterNum:5, title:"Love & Relationships", body:"Your Sun sign in combination with your Moon sign creates a deeply nuanced approach to love. You lead with your heart while your mind carefully evaluates each connection...\n\nIn partnership, you seek someone who understands your need for both depth and independence. The ideal match honors your emotional intelligence while challenging you to grow.", theme: CHAPTER_THEMES[4]!, isFirst:true },
  { type:"pillar-cover", pillar:"wealth" },
  { type:"numerology" },
  { type:"pillar-cover", pillar:"health" },
  { type:"wellness-wheel" },
  { type:"lucky-numbers" },
  { type:"monthly-forecast", months: Array(12).fill("Rich cosmic insights and opportunities await in this month.") },
  { type:"affirmations-visual" },
  { type:"planet-grid" },
  { type:"monthly-forecast", months: Array(12).fill("A sacred morning ritual unfolds here to guide the day ahead.") },
  { type:"planet-grid" },
];

// ─── Main Preview component ────────────────────────────────────────────────────

export default function Preview() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const id = parseInt(params.id || "0", 10);
  const nameParam = new URLSearchParams(search).get("name") ?? "";
  const [, setLocation] = useLocation();
  const { isAdmin } = useAdmin();
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);

  const { data: order } = useGetZodiacOrder(id, {
    query: { enabled: !!id, queryKey: getGetZodiacOrderQueryKey(id) },
  });
  const { data: siteSettings } = useGetSiteSettings({
    query: { queryKey: getGetSiteSettingsQueryKey() },
  });
  const createCheckout = useCreateCheckoutSession();

  const isGenerated =
    order?.status === "generated" || order?.status === "shipped" ||
    order?.status === "submitting" || order?.status === "processing";

  const displayName =
    order?.fullName ?? (nameParam ? decodeURIComponent(nameParam) : "Your Name");

  const { pages, fullPageCount } = useMemo<{ pages: PageData[]; fullPageCount: number }>(() => {
    const full = order?.generatedContent
      ? (() => {
          const built = buildBookPages(order.generatedContent);
          return built.length >= 6 ? built : SAMPLE_PAGES;
        })()
      : SAMPLE_PAGES;
    // Non-admins see only the first 5 pages — pages 6+ are not in the DOM at
    // all (true gating, not an overlay). Admins see the whole book.
    return {
      pages: isAdmin ? full : full.slice(0, 5),
      fullPageCount: full.length,
    };
  }, [order?.generatedContent, isAdmin]);

  const TOTAL = pages.length;
  const UNLOCK_THRESHOLD = isGenerated ? TOTAL : 5;

  const go = (dir: 1 | -1) => {
    const next = current + dir;
    if (next < 0 || next >= TOTAL) return;
    setDirection(dir);
    setCurrent(next);
  };

  const handleOrder = () => {
    if (!id) { setLocation("/create"); return; }
    createCheckout.mutate(
      { data: { orderId: id } },
      {
        onSuccess: (s) => { if (s.url) window.location.href = s.url; else setLocation(`/order/${id}`); },
        onError: () => setLocation(`/order/${id}`),
      }
    );
  };

  const page = pages[current];
  const isLocked = current >= UNLOCK_THRESHOLD;
  const displayPrice = siteSettings?.priceUsd ?? 99.99;
  const originalPrice = siteSettings?.originalPriceUsd ?? 129.99;
  const generatedPdfUrl = order?.interiorPdfUrl ?? null;

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 50 : -50, opacity: 0 }),
    center: { x: 0, opacity: 1, transition: { duration: 0.3, ease: [0.32,0.72,0,1] as [number,number,number,number] } },
    exit:  (d: number) => ({ x: d > 0 ? -50 : 50, opacity: 0, transition: { duration: 0.2 } }),
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[400px] bg-secondary/5 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <header className="py-4 px-6 border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between">
        <a href="/"><img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-9 w-auto" /></a>
        <p className="text-muted-foreground text-xs tracking-widest uppercase">
          {isGenerated ? "Your Book" : "Sample Preview"}
        </p>
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{fullPageCount} pages</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 md:py-10">
        {/* Hero copy */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6 max-w-xl">
          {isGenerated ? (
            <>
              <p className="text-secondary text-xs tracking-[0.3em] uppercase mb-2 font-medium">Your Personalized Reading</p>
              <h1 className="font-serif text-2xl md:text-3xl text-foreground mb-1">
                {isAdmin ? `All ${TOTAL} pages` : `Preview first ${TOTAL} pages`} — written for{" "}
                <span className="italic">{displayName}</span>
              </h1>
              <p className="text-muted-foreground text-xs">Use the arrows or dots below to flip through every page</p>
            </>
          ) : (
            <>
              <p className="text-secondary text-xs tracking-[0.3em] uppercase mb-2 font-medium">Sample Preview</p>
              <h1 className="font-serif text-2xl md:text-3xl text-foreground mb-2">
                Flip through your book
              </h1>
              <p className="text-muted-foreground text-sm font-light">
                Written for <span className="italic text-foreground">{displayName}</span>.{" "}
                Pages 5–{TOTAL} unlock after ordering.
              </p>
            </>
          )}
        </motion.div>

        {/* Book viewer */}
        <div className="flex items-center gap-3 md:gap-5 w-full max-w-[400px]">
          <button onClick={() => go(-1)} disabled={current === 0}
            className="shrink-0 w-9 h-9 rounded-full bg-primary/8 border border-border hover:bg-primary/15 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex-1 relative" style={{ aspectRatio: "1 / 1" }}>
            {/* Drop shadow */}
            <div className="absolute inset-0 rounded-2xl shadow-[0_28px_70px_rgba(0,0,0,0.22)] pointer-events-none z-30" />
            {/* Binding shadow */}
            <div className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/22 to-transparent rounded-l-2xl z-20 pointer-events-none" />
            <div className="w-full h-full rounded-2xl overflow-hidden relative bg-[#faf8f3]">
              <AnimatePresence custom={direction} mode="wait">
                <motion.div key={current} custom={direction} variants={slideVariants}
                  initial="enter" animate="center" exit="exit" className="absolute inset-0">
                  {page && renderPage(page, order as OrderLike | undefined)}
                  {isLocked && <LockedOverlay />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <button onClick={() => go(1)} disabled={current === TOTAL - 1}
            className="shrink-0 w-9 h-9 rounded-full bg-primary/8 border border-border hover:bg-primary/15 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-foreground">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Page counter */}
        <p className="text-muted-foreground text-xs mt-3 mb-2">
          Page {current + 1} of {TOTAL}
        </p>

        <button
          onClick={handleOrder}
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm mb-4"
        >
          Order My Book
          <ArrowRight className="ml-2 h-4 w-4" />
        </button>

        {isAdmin && generatedPdfUrl && (
          <a
            href={generatedPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors shadow-sm mb-4"
            download
          >
            Download Interior PDF
          </a>
        )}

        {/* Dot navigation */}
        <div className="flex gap-1 flex-wrap justify-center max-w-[360px]">
          {pages.map((p, i) => {
            const color = pageColor(p);
            const active = i === current;
            const locked = i >= UNLOCK_THRESHOLD;
            return (
              <button key={i}
                onClick={() => { setDirection(i > current ? 1 : -1); setCurrent(i); }}
                className="transition-all duration-200 flex-shrink-0"
                style={{
                  width: active ? "18px" : "6px", height: "6px",
                  borderRadius: active ? "3px" : "50%",
                  background: active ? color : locked ? "#00000018" : color + "55",
                }} />
            );
          })}
        </div>

        {/* CTA — only shown if not generated/paid */}
        {!isGenerated && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="mt-8 w-full max-w-sm">
            <div className="bg-muted border border-border rounded-2xl p-6 space-y-4 text-center">
              <p className="font-serif text-foreground/80 text-sm leading-relaxed">
                Your full <strong>{TOTAL}-page</strong> book — written entirely for{" "}
                <span className="italic">{displayName}</span> — awaits printing.
              </p>
              <div className="flex items-center justify-center gap-3">
                <span className="font-serif text-xl text-primary">${displayPrice.toFixed(2)}</span>
                <span className="font-serif text-sm text-muted-foreground line-through">${originalPrice.toFixed(2)}</span>
              </div>
              <Button onClick={handleOrder} disabled={createCheckout.isPending} size="lg"
                className="w-full text-base bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-[0_8px_30px_-6px_rgba(1,91,92,0.35)]">
                {createCheckout.isPending
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <><span>Print My Book</span><ArrowRight className="ml-2 w-5 h-5" /></>}
              </Button>
              <p className="text-muted-foreground text-xs">Full-color hardcover · Ships in 2–3 weeks</p>
            </div>
            <button onClick={() => setLocation("/create")}
              className="block w-full text-center text-muted-foreground hover:text-foreground text-xs mt-4 transition-colors">
              ← Start over
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
