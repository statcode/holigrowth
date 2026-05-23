/**
 * PDF Generator for Holistic Growth Life Path books.
 *
 * Produces two PDFs meeting Lulu's print-job requirements:
 *   • Interior — US Trade 6" × 9" trim with bleed and safety
 *   • Cover    — One-piece case-wrap spread (back + spine + front)
 *
 * Dimensions are in PDF points (1 in = 72 pt).
 */

import PDFDocument from "pdfkit";
import type { ZodiacOrder } from "@workspace/db";

// ─── Constants ────────────────────────────────────────────────────────────────

const PT = 72;
const PAGE_W = 6.25 * PT;
const PAGE_H = 9.25 * PT;
const SAFE   = 0.625 * PT;

const BRAND = {
  deepPurple: "#1a0533",
  purple:     "#3b1260",
  midPurple:  "#5c2d91",
  lightPurple:"#7b4bb8",
  gold:       "#c9a96e",
  cream:      "#f5eeff",
  offWhite:   "#faf7ff",
  text:       "#1e1b2e",
  muted:      "#6b5b8a",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function pdfColor(doc: PDFKit.PDFDocument, hex: string) {
  doc.fillColor(hexToRgb(hex));
}

// Cheap deterministic hash → number in [0,1). Matches the web preview's
// `hashToUnit` so the decorative birthplace pin lands in the same spot in both.
function hashToUnit(str: string, salt = ""): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  for (let i = 0; i < salt.length; i++) h = ((h << 5) + h + salt.charCodeAt(i)) | 0;
  return Math.abs(h % 10000) / 10000;
}

function parseMarkdown(content: string): Array<{ type: "h1"|"h2"|"h3"|"p"|"br"; text: string }> {
  const lines = content.split("\n");
  const result: Array<{ type: "h1"|"h2"|"h3"|"p"|"br"; text: string }> = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      result.push({ type: "br", text: "" });
    } else if (line.startsWith("### ")) {
      result.push({ type: "h3", text: line.slice(4) });
    } else if (line.startsWith("## ")) {
      result.push({ type: "h2", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      result.push({ type: "h1", text: line.slice(2) });
    } else {
      const clean = line
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .replace(/^>\s*/, "")
        .replace(/^[-*+]\s+/, "• ");
      result.push({ type: "p", text: clean });
    }
  }
  return result;
}

// ─── Visual page helpers ──────────────────────────────────────────────────────

const ZODIAC_LIST = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo",
  "Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"];

const ZODIAC_SYMBOLS: Record<string,string> = {
  Aries:"♈", Taurus:"♉", Gemini:"♊", Cancer:"♋", Leo:"♌", Virgo:"♍",
  Libra:"♎", Scorpio:"♏", Sagittarius:"♐", Capricorn:"♑", Aquarius:"♒", Pisces:"♓",
};

const ZODIAC_COLORS: Record<string,[number,number,number]> = {
  Aries:[232,93,93], Taurus:[124,184,124], Gemini:[240,192,80], Cancer:[135,174,232],
  Leo:[240,136,74], Virgo:[168,200,122], Libra:[200,122,188], Scorpio:[124,60,90],
  Sagittarius:[80,136,200], Capricorn:[124,96,80], Aquarius:[80,184,208], Pisces:[136,120,200],
};

const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

const MONTH_COLORS: [number,number,number][] = [
  [232,122,156],[240,160,80],[212,160,23],[144,200,96],[109,204,170],[80,184,208],
  [80,136,200],[176,143,223],[200,120,240],[224,96,96],[200,122,188],[96,184,200],
];

// Parse month-by-month forecasts from the AI content
function parseMonthForecasts(content: string): string[] {
  return MONTH_NAMES.map((m) => {
    const rx = new RegExp(`\\b${m}\\b[^:]*:?\\s*([^\n]{30,160})`, "i");
    const match = content.match(rx);
    return match ? match[1]!.trim() : `${m}: A time for renewal and forward momentum in all three pillars.`;
  });
}

// ─── Moon Phase Calculation ────────────────────────────────────────────────────

function getMoonPhase(birthday: string): { phaseFrac: number; phaseName: string; emoji: string } {
  const KNOWN_NEW_MOON = new Date("2000-01-06T18:14:00Z").getTime();
  const LUNAR_MS = 29.530588853 * 24 * 60 * 60 * 1000;
  const birthMs = new Date(birthday).getTime();
  const phaseFrac = (((birthMs - KNOWN_NEW_MOON) % LUNAR_MS) + LUNAR_MS) % LUNAR_MS / LUNAR_MS;

  let phaseName: string; let emoji: string;
  if (phaseFrac < 0.0625)       { phaseName = "New Moon";        emoji = "🌑"; }
  else if (phaseFrac < 0.25)    { phaseName = "Waxing Crescent"; emoji = "🌒"; }
  else if (phaseFrac < 0.3125)  { phaseName = "First Quarter";   emoji = "🌓"; }
  else if (phaseFrac < 0.5)     { phaseName = "Waxing Gibbous";  emoji = "🌔"; }
  else if (phaseFrac < 0.5625)  { phaseName = "Full Moon";       emoji = "🌕"; }
  else if (phaseFrac < 0.75)    { phaseName = "Waning Gibbous";  emoji = "🌖"; }
  else if (phaseFrac < 0.8125)  { phaseName = "Last Quarter";    emoji = "🌗"; }
  else                          { phaseName = "Waning Crescent"; emoji = "🌘"; }
  return { phaseFrac, phaseName, emoji };
}

/** Draw a moon phase icon as a filled circle + shadow overlay */
function drawMoonIcon(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number, r: number,
  phaseFrac: number,
  lit: [number,number,number],
  dark: [number,number,number]
) {
  // Base lit circle
  doc.circle(cx, cy, r).fill(lit);

  // Shadow: an ellipse drawn as a bezier approximating the terminator
  // We compute shadow ellipse width based on phase
  // Phase 0=new, 0.5=full, 1=new again
  const angle = phaseFrac * 2 * Math.PI;
  const shadowRx = Math.abs(Math.cos(angle)) * r; // x-radius of shadow ellipse
  const waxing = phaseFrac < 0.5;

  // Shadow fills left half (waxing) or right half (waning)
  // Draw dark half-circle + ellipse to fill it
  if (phaseFrac < 0.01 || phaseFrac > 0.99) {
    // New moon: cover everything
    doc.circle(cx, cy, r).fill(dark);
    return;
  }
  if (phaseFrac > 0.49 && phaseFrac < 0.51) {
    // Full moon: do nothing (all lit)
    return;
  }

  // Half-disk shadow on appropriate side
  const p = doc.path(
    waxing
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} L ${cx} ${cy - r} Z`
      : `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} L ${cx} ${cy - r} Z`
  );
  p.fill(dark);

  // Elliptical terminator to refine shadow shape
  const ew = shadowRx;
  const cp = ew * 0.552; // bezier control for ellipse approximation
  if (waxing) {
    // Waxing: shadow is on left, shrinking → the inner ellipse is on the right
    doc.path(
      `M ${cx} ${cy - r} C ${cx + cp*4*(1-phaseFrac/0.5)} ${cy - r} ${cx + ew} ${cy - cp} ${cx + ew} ${cy} C ${cx + ew} ${cy + cp} ${cx + cp*4*(1-phaseFrac/0.5)} ${cy + r} ${cx} ${cy + r} Z`
    ).fill(lit);
  } else {
    // Waning: shadow on right, growing
    const fp = (phaseFrac - 0.5) / 0.5;
    doc.path(
      `M ${cx} ${cy - r} C ${cx - cp*4*(1-fp)} ${cy - r} ${cx - ew} ${cy - cp} ${cx - ew} ${cy} C ${cx - ew} ${cy + cp} ${cx - cp*4*(1-fp)} ${cy + r} ${cx} ${cy + r} Z`
    ).fill(lit);
  }
  // Clip to circle
  doc.circle(cx, cy, r + 0.5).fillOpacity(0).strokeColor(dark).lineWidth(1).stroke();
  doc.fillOpacity(1);
}

// ─── Constellation Star Data ───────────────────────────────────────────────────

// Normalized [x, y] star positions (0–1 range), matched to rough constellation shapes
const CONSTELLATION_STARS: Record<string, [number, number][]> = {
  Aries:       [[.50,.18],[.44,.40],[.38,.62],[.55,.72],[.66,.58],[.74,.38]],
  Taurus:      [[.20,.52],[.38,.43],[.50,.28],[.63,.43],[.78,.52],[.56,.68],[.42,.76]],
  Gemini:      [[.28,.18],[.30,.45],[.32,.72],[.72,.18],[.70,.45],[.68,.72],[.50,.54]],
  Cancer:      [[.30,.32],[.50,.46],[.70,.32],[.50,.66],[.35,.76]],
  Leo:         [[.18,.58],[.30,.46],[.44,.36],[.58,.40],[.70,.52],[.76,.68],[.52,.64],[.36,.72]],
  Virgo:       [[.46,.16],[.43,.38],[.36,.60],[.30,.78],[.56,.64],[.66,.50],[.72,.28],[.56,.74]],
  Libra:       [[.26,.56],[.50,.44],[.76,.56],[.50,.26],[.30,.72],[.70,.72]],
  Scorpio:     [[.22,.30],[.34,.40],[.48,.42],[.60,.38],[.72,.42],[.82,.54],[.78,.68],[.66,.78],[.52,.76]],
  Sagittarius: [[.20,.72],[.34,.58],[.50,.50],[.62,.42],[.76,.34],[.66,.64],[.50,.74],[.38,.78]],
  Capricorn:   [[.22,.42],[.40,.30],[.60,.30],[.76,.46],[.72,.66],[.52,.72],[.32,.66]],
  Aquarius:    [[.15,.44],[.35,.34],[.55,.44],[.75,.34],[.86,.44],[.15,.66],[.35,.58],[.55,.66],[.75,.58],[.86,.66]],
  Pisces:      [[.26,.30],[.40,.20],[.56,.30],[.56,.50],[.42,.62],[.26,.70],[.66,.70],[.78,.58],[.78,.42]],
};

const CONSTELLATION_LINES: Record<string, [number, number][]> = {
  Aries:       [[0,1],[1,2],[2,3],[3,4],[4,5]],
  Taurus:      [[0,1],[1,2],[2,3],[3,4],[1,5],[5,6]],
  Gemini:      [[0,1],[1,2],[3,4],[4,5],[1,6],[4,6]],
  Cancer:      [[0,2],[2,1],[1,3],[0,3],[3,4]],
  Leo:         [[0,1],[1,2],[2,3],[3,4],[4,5],[4,6],[6,7],[1,7]],
  Virgo:       [[0,1],[1,2],[2,3],[1,4],[4,5],[5,6],[4,7]],
  Libra:       [[0,1],[1,2],[1,3],[0,4],[2,5]],
  Scorpio:     [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]],
  Sagittarius: [[0,1],[1,2],[2,3],[3,4],[2,5],[5,6],[6,7]],
  Capricorn:   [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0]],
  Aquarius:    [[0,1],[1,2],[2,3],[3,4],[5,6],[6,7],[7,8],[8,9]],
  Pisces:      [[0,1],[1,2],[2,3],[3,4],[4,5],[6,7],[7,8],[8,2]],
};

/** Zodiac sign element + keywords for the splash page */
const ZODIAC_KEYWORDS: Record<string, { element: string; keywords: string[]; glyph: string }> = {
  Aries:       { element:"Fire",  keywords:["Courage","Initiative","Passion"],      glyph:"♈" },
  Taurus:      { element:"Earth", keywords:["Stability","Sensuality","Patience"],   glyph:"♉" },
  Gemini:      { element:"Air",   keywords:["Curiosity","Adaptability","Wit"],      glyph:"♊" },
  Cancer:      { element:"Water", keywords:["Intuition","Nurturing","Depth"],       glyph:"♋" },
  Leo:         { element:"Fire",  keywords:["Radiance","Leadership","Heart"],       glyph:"♌" },
  Virgo:       { element:"Earth", keywords:["Precision","Service","Clarity"],       glyph:"♍" },
  Libra:       { element:"Air",   keywords:["Harmony","Beauty","Justice"],          glyph:"♎" },
  Scorpio:     { element:"Water", keywords:["Transformation","Power","Mystery"],    glyph:"♏" },
  Sagittarius: { element:"Fire",  keywords:["Freedom","Wisdom","Adventure"],        glyph:"♐" },
  Capricorn:   { element:"Earth", keywords:["Mastery","Ambition","Legacy"],         glyph:"♑" },
  Aquarius:    { element:"Air",   keywords:["Vision","Originality","Humanity"],     glyph:"♒" },
  Pisces:      { element:"Water", keywords:["Compassion","Transcendence","Dreams"], glyph:"♓" },
};

// ─── Visual Pages ─────────────────────────────────────────────────────────────

// ─── Holigrowth Life Path Sigil ───────────────────────────────────────────────
// Each person's sigil is unique: life path → star polygon, lucky numbers →
// resonance rings, sun sign element → outer decorative layer,
// pillar → center motif. No two sigils are identical.

function drawNGram(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number, r: number,
  n: number,               // number of points
  skip: number,            // connect every nth vertex (creates star)
  accentColor: [number,number,number],
  opacity: number,
  lineW: number,
  fill: boolean
) {
  if (n < 3) return;
  const verts: [number,number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i / n) * 2 * Math.PI) - Math.PI / 2;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  // Build star path: walk vertices skipping `skip` each time, until we close
  const visited = new Set<number>();
  let start = 0;
  let pathStr = "";
  let cur = start;
  let firstOfPath = true;
  do {
    const [vx, vy] = verts[cur]!;
    pathStr += (firstOfPath ? `M ` : ` L `) + `${vx} ${vy}`;
    firstOfPath = false;
    visited.add(cur);
    cur = (cur + skip) % n;
  } while (cur !== start);
  pathStr += " Z";

  if (fill) {
    doc.path(pathStr).fillColor(accentColor).fillOpacity(opacity * 0.22).fill();
    doc.fillOpacity(1);
  }
  doc.path(pathStr).fillOpacity(0).strokeColor(accentColor).lineWidth(lineW).strokeOpacity(opacity).stroke();
  doc.strokeOpacity(1);
}

function drawPersonalizedSigil(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number, r: number,
  order: ZodiacOrder,
  pillar: "relationships" | "wealth" | "health",
  accent: [number,number,number]
) {
  const lp = Math.max(3, Math.min(11, (() => {
    const n = parseInt(order.lifePath ?? "7");
    if (n === 11) return 11; if (n === 22) return 8; if (n === 33) return 6;
    return n;
  })()));
  const element = ZODIAC_KEYWORDS[order.sunSign ?? "Leo"]?.element ?? "Fire";
  const luckyNums = (order.luckyNumbers ?? "3,7,11").split(",")
    .map(n => parseInt(n.trim())).filter(n => n >= 1 && n <= 33).slice(0, 6);

  // ── Layer 0: Outer aura glow ──────────────────────────────────────────────
  for (const [i, gr] of [r * 1.35, r * 1.2, r * 1.08].entries()) {
    doc.circle(cx, cy, gr).fillColor(accent).fillOpacity(0.025 + i * 0.012).fill();
    doc.fillOpacity(1);
  }

  // ── Layer 1: Element-specific outer decoration ────────────────────────────
  if (element === "Fire") {
    // 12 flame lances: tapered bezier spikes at full radius + beyond
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
      const isPrimary = i % 3 === 0;
      const tipR = isPrimary ? r * 1.18 : r * 0.98;
      const baseW = isPrimary ? 0.18 : 0.10;
      const bL = [cx + r * 0.72 * Math.cos(a - baseW), cy + r * 0.72 * Math.sin(a - baseW)] as [number,number];
      const bR = [cx + r * 0.72 * Math.cos(a + baseW), cy + r * 0.72 * Math.sin(a + baseW)] as [number,number];
      const tip = [cx + tipR * Math.cos(a), cy + tipR * Math.sin(a)] as [number,number];
      const ctrl = [cx + r * 0.92 * Math.cos(a), cy + r * 0.92 * Math.sin(a)] as [number,number];
      const p = `M ${bL[0]} ${bL[1]} Q ${ctrl[0]} ${ctrl[1]} ${tip[0]} ${tip[1]} Q ${ctrl[0]} ${ctrl[1]} ${bR[0]} ${bR[1]} Z`;
      doc.path(p).fillColor(accent).fillOpacity(isPrimary ? 0.20 : 0.10).fill();
      doc.fillOpacity(1);
    }
  } else if (element === "Earth") {
    // 4 concentric rotated squares, each rotated by π/8 — creates angular mandala
    for (let sq = 0; sq < 5; sq++) {
      const sqR = r * (0.62 + sq * 0.095);
      const rot = sq * (Math.PI / 8);
      const c: [number,number][] = [0,1,2,3].map(i => [
        cx + sqR * Math.cos(rot + i * Math.PI / 2),
        cy + sqR * Math.sin(rot + i * Math.PI / 2),
      ]);
      doc.path(`M ${c[0]![0]} ${c[0]![1]} L ${c[1]![0]} ${c[1]![1]} L ${c[2]![0]} ${c[2]![1]} L ${c[3]![0]} ${c[3]![1]} Z`)
        .fillOpacity(0).strokeColor(accent).strokeOpacity(0.18 + sq * 0.04).lineWidth(0.6).stroke();
      doc.strokeOpacity(1);
      // Corner diamonds
      for (const [vx, vy] of c) {
        const ds = 4;
        doc.path(`M ${vx} ${vy - ds} L ${vx + ds} ${vy} L ${vx} ${vy + ds} L ${vx - ds} ${vy} Z`)
          .fillColor(accent).fillOpacity(0.18).fill();
        doc.fillOpacity(1);
      }
    }
  } else if (element === "Air") {
    // 3 equidistant Archimedean spiral arms, drawn as polylines
    for (let arm = 0; arm < 3; arm++) {
      const startA = (arm / 3) * 2 * Math.PI - Math.PI / 2;
      const pts: string[] = [];
      for (let t = 0; t <= 48; t++) {
        const fraction = t / 48;
        const angle = startA + fraction * Math.PI * 1.85;
        const radius = fraction * r * 1.05;
        pts.push(`${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`);
      }
      doc.path("M " + pts.join(" L "))
        .fillOpacity(0).strokeColor(accent).strokeOpacity(0.22).lineWidth(0.55).stroke();
      doc.strokeOpacity(1);
    }
    // Thin outer arcs between spiral tips
    for (let arm = 0; arm < 3; arm++) {
      const a1 = ((arm / 3) * 2 * Math.PI) + Math.PI / 2;
      const a2 = a1 + (2 * Math.PI / 3);
      const ax1 = cx + r * 1.04 * Math.cos(a1), ay1 = cy + r * 1.04 * Math.sin(a1);
      const ax2 = cx + r * 1.04 * Math.cos(a2), ay2 = cy + r * 1.04 * Math.sin(a2);
      doc.path(`M ${ax1} ${ay1} A ${r * 1.04} ${r * 1.04} 0 0 1 ${ax2} ${ay2}`)
        .fillOpacity(0).strokeColor(accent).strokeOpacity(0.18).lineWidth(0.5).stroke();
      doc.strokeOpacity(1);
    }
  } else {
    // Water: 6 crescent-wave arcs, each rotated progressively and fading in
    for (let w = 0; w < 6; w++) {
      const wRot = (w / 6) * Math.PI;
      const wR = r * (0.66 + w * 0.065);
      const spanA = Math.PI * 0.72;
      const aS = -spanA / 2 + wRot, aE = spanA / 2 + wRot;
      const x1 = cx + wR * Math.cos(aS), y1 = cy + wR * Math.sin(aS);
      const x2 = cx + wR * Math.cos(aE), y2 = cy + wR * Math.sin(aE);
      doc.path(`M ${x1} ${y1} A ${wR} ${wR} 0 0 1 ${x2} ${y2}`)
        .fillOpacity(0).strokeColor(accent).strokeOpacity(0.14 + w * 0.03).lineWidth(0.65).stroke();
      doc.strokeOpacity(1);
    }
  }

  // ── Layer 2: Life Path n-gram (main polygon at 75% radius) ────────────────
  // Outer ghost at full radius
  drawNGram(doc, cx, cy, r * 0.98, lp, lp > 5 ? 2 : 1, accent, 0.15, 0.4, false);
  // Main filled star at 75% radius
  drawNGram(doc, cx, cy, r * 0.74, lp, lp > 5 ? 2 : 1, accent, 0.55, 1.1, true);
  // Inner ghost at 48% (echo)
  drawNGram(doc, cx, cy, r * 0.48, lp, lp > 5 ? 2 : 1, accent, 0.22, 0.5, false);

  // ── Layer 3: Lucky number resonance rings ─────────────────────────────────
  for (const [idx, num] of luckyNums.entries()) {
    const ringR = r * (0.10 + (num / 33) * 0.62);
    doc.circle(cx, cy, ringR).fillOpacity(0).strokeColor(accent)
      .strokeOpacity(0.12 + idx * 0.04).lineWidth(0.35).stroke();
    doc.strokeOpacity(1);
    // Tick marks at ring perimeter — one per lucky number value
    const ticks = Math.min(num, 22);
    for (let t = 0; t < ticks; t++) {
      const ta = (t / ticks) * 2 * Math.PI - Math.PI / 2;
      const isPrimeTick = t === 0 || t === Math.floor(ticks / 2);
      const inR = ringR - (isPrimeTick ? 5 : 2.5);
      const outR = ringR + (isPrimeTick ? 5 : 2.5);
      doc.moveTo(cx + inR * Math.cos(ta), cy + inR * Math.sin(ta))
        .lineTo(cx + outR * Math.cos(ta), cy + outR * Math.sin(ta))
        .strokeColor(accent).strokeOpacity(isPrimeTick ? 0.45 : 0.22).lineWidth(isPrimeTick ? 0.7 : 0.35).stroke();
      doc.strokeOpacity(1);
    }
  }

  // ── Layer 4: Pillar-specific center motif ─────────────────────────────────
  if (pillar === "relationships") {
    // Vesica piscis variant: two overlapping circles offset along life path axis
    const off = r * 0.20;
    const lpAngle = ((lp - 1) / 11) * 2 * Math.PI - Math.PI / 2;
    const ox = off * Math.cos(lpAngle), oy = off * Math.sin(lpAngle);
    doc.circle(cx - ox, cy - oy, r * 0.46)
      .fillOpacity(0).strokeColor(accent).strokeOpacity(0.40).lineWidth(0.9).stroke();
    doc.circle(cx + ox, cy + oy, r * 0.46)
      .fillOpacity(0).strokeColor(accent).strokeOpacity(0.40).lineWidth(0.9).stroke();
    doc.strokeOpacity(1);
    // Inner lens fill
    doc.circle(cx, cy, r * 0.18).fillColor(accent).fillOpacity(0.12).fill();
    doc.fillOpacity(1);
  } else if (pillar === "wealth") {
    // Crystal lattice: lp rhombuses radiating from center
    const facets = Math.min(lp, 8);
    for (let d = 0; d < facets; d++) {
      const da = (d / facets) * 2 * Math.PI - Math.PI / 2;
      const dm = r * 0.40;
      const perpA = da + Math.PI / 2;
      const tipOut = [cx + (dm + r * 0.20) * Math.cos(da), cy + (dm + r * 0.20) * Math.sin(da)] as [number,number];
      const tipIn  = [cx + (dm - r * 0.20) * Math.cos(da), cy + (dm - r * 0.20) * Math.sin(da)] as [number,number];
      const sideA  = [cx + dm * Math.cos(da) + r * 0.10 * Math.cos(perpA), cy + dm * Math.sin(da) + r * 0.10 * Math.sin(perpA)] as [number,number];
      const sideB  = [cx + dm * Math.cos(da) - r * 0.10 * Math.cos(perpA), cy + dm * Math.sin(da) - r * 0.10 * Math.sin(perpA)] as [number,number];
      doc.path(`M ${tipOut[0]} ${tipOut[1]} L ${sideA[0]} ${sideA[1]} L ${tipIn[0]} ${tipIn[1]} L ${sideB[0]} ${sideB[1]} Z`)
        .fillColor(accent).fillOpacity(0.10).fill();
      doc.path(`M ${tipOut[0]} ${tipOut[1]} L ${sideA[0]} ${sideA[1]} L ${tipIn[0]} ${tipIn[1]} L ${sideB[0]} ${sideB[1]} Z`)
        .fillOpacity(0).strokeColor(accent).strokeOpacity(0.42).lineWidth(0.7).stroke();
      doc.fillOpacity(1); doc.strokeOpacity(1);
    }
  } else {
    // Health: organic petal burst — lp petals overlapping at center
    const petals = Math.min(lp + 1, 10);
    const petalR = r * 0.33;
    const petalDist = r * 0.30;
    for (let p = 0; p < petals; p++) {
      const pa = (p / petals) * 2 * Math.PI - Math.PI / 2;
      const px = cx + petalDist * Math.cos(pa);
      const py = cy + petalDist * Math.sin(pa);
      doc.circle(px, py, petalR)
        .fillColor(accent).fillOpacity(0.07).fill();
      doc.circle(px, py, petalR)
        .fillOpacity(0).strokeColor(accent).strokeOpacity(0.30).lineWidth(0.6).stroke();
      doc.fillOpacity(1); doc.strokeOpacity(1);
    }
  }

  // ── Layer 5: Center point ─────────────────────────────────────────────────
  doc.circle(cx, cy, r * 0.07).fillColor(accent).fillOpacity(0.22).fill();
  doc.circle(cx, cy, r * 0.035).fillColor(accent).fillOpacity(0.70).fill();
  doc.circle(cx, cy, r * 0.012).fillColor([255,255,255]).fillOpacity(0.9).fill();
  doc.fillOpacity(1);
}

/** Full-bleed pillar cover page with personalized Life Path Sigil */
function addPillarCoverPage(
  doc: PDFKit.PDFDocument,
  pillar: "relationships" | "wealth" | "health",
  order: ZodiacOrder
) {
  doc.addPage();

  const themes = {
    relationships: {
      bg:       [34,6,18] as [number,number,number],
      bgDeep:   [22,3,11] as [number,number,number],
      accent:   [244,155,188] as [number,number,number],
      title:    "Relationships",
      subtitle: "Love, Connection & Partnership",
      roman:    "I",
      pillarDesc: "How the cosmos shapes your heart",
    },
    wealth: {
      bg:       [22,14,0] as [number,number,number],
      bgDeep:   [14,9,0] as [number,number,number],
      accent:   [212,165,30] as [number,number,number],
      title:    "Wealth",
      subtitle: "Abundance, Purpose & Prosperity",
      roman:    "II",
      pillarDesc: "Your cosmic blueprint for abundance",
    },
    health: {
      bg:       [3,22,16] as [number,number,number],
      bgDeep:   [2,14,10] as [number,number,number],
      accent:   [100,210,168] as [number,number,number],
      title:    "Health",
      subtitle: "Vitality, Balance & Renewal",
      roman:    "III",
      pillarDesc: "Your body's celestial code",
    },
  };
  const t = themes[pillar];
  const CW = PAGE_W, CH = PAGE_H;
  const cx = CW / 2;

  // ── Two-tone background ───────────────────────────────────────────────────
  doc.rect(0, 0, CW, CH).fill(t.bg);
  // Top strip (brighter)
  doc.rect(0, 0, CW, CH * 0.28).fillColor([t.bg[0]+12, t.bg[1]+8, t.bg[2]+6] as [number,number,number]).fillOpacity(0.5).fill();
  // Bottom strip
  doc.rect(0, CH * 0.72, CW, CH * 0.28).fillColor(t.bgDeep).fillOpacity(0.55).fill();
  doc.fillOpacity(1);

  // ── Thin border frame ─────────────────────────────────────────────────────
  const m = SAFE - 2;
  doc.rect(m, m, CW - m*2, CH - m*2)
    .fillOpacity(0).strokeColor(t.accent).strokeOpacity(0.18).lineWidth(0.6).stroke();
  doc.strokeOpacity(1);

  // ── "Pillar I / II / III" top label ───────────────────────────────────────
  doc.fillColor(t.accent).fillOpacity(0.45).font("Helvetica").fontSize(7)
    .text(`PILLAR  ${t.roman}`, SAFE, SAFE + 12, { align:"center", width: CW - SAFE*2, characterSpacing: 4 });
  doc.fillOpacity(1);

  // ── Sigil (center of page, dramatic) ──────────────────────────────────────
  const sigilCy = CH * 0.50;
  const sigilR  = 148;
  drawPersonalizedSigil(doc, cx, sigilCy, sigilR, order, pillar, t.accent);

  // ── "YOUR PERSONAL SIGIL" micro-label above sigil ─────────────────────────
  doc.fillColor(t.accent).fillOpacity(0.28).font("Helvetica").fontSize(6)
    .text("YOUR PERSONAL SIGIL", SAFE, sigilCy - sigilR - 22, { align:"center", width: CW - SAFE*2, characterSpacing: 2.5 });
  doc.fillOpacity(1);

  // ── Title block ────────────────────────────────────────────────────────────
  // Divider above title
  doc.moveTo(CW * 0.25, sigilCy + sigilR + 16).lineTo(CW * 0.75, sigilCy + sigilR + 16)
    .strokeColor(t.accent).strokeOpacity(0.35).lineWidth(0.6).stroke();
  doc.strokeOpacity(1);

  doc.fillColor(t.accent).fillOpacity(0.92).font("Helvetica-Bold").fontSize(30)
    .text(t.title.toUpperCase(), SAFE, sigilCy + sigilR + 24, { align:"center", width: CW - SAFE*2, characterSpacing: 5 });
  doc.fillOpacity(1);

  doc.fillColor(t.accent).fillOpacity(0.55).font("Helvetica-Oblique").fontSize(10)
    .text(t.subtitle, SAFE, sigilCy + sigilR + 60, { align:"center", width: CW - SAFE*2 });

  // ── Divider ────────────────────────────────────────────────────────────────
  doc.moveTo(CW * 0.32, sigilCy + sigilR + 78).lineTo(CW * 0.68, sigilCy + sigilR + 78)
    .strokeColor(t.accent).strokeOpacity(0.22).lineWidth(0.5).stroke();
  doc.strokeOpacity(1);

  // ── Person attribution ─────────────────────────────────────────────────────
  doc.fillColor(t.accent).fillOpacity(0.35).font("Helvetica").fontSize(8)
    .text(order.fullName.toUpperCase(), SAFE, sigilCy + sigilR + 86,
      { align:"center", width: CW - SAFE*2, characterSpacing: 2 });
  doc.fillOpacity(1);

  // ── Sigil generation key (bottom, very subtle) ────────────────────────────
  const element = ZODIAC_KEYWORDS[order.sunSign ?? "Leo"]?.element ?? "Fire";
  const sigilKey = `Life Path ${order.lifePath}  ·  ${order.sunSign} ${element}  ·  ${t.pillarDesc}`;
  doc.fillColor(t.accent).fillOpacity(0.18).font("Helvetica").fontSize(6.5)
    .text(sigilKey, SAFE, CH - SAFE - 14, { align:"center", width: CW - SAFE*2, characterSpacing: 0.5 });
  doc.fillOpacity(1);
}

// ─── Sigil Interpretation Page ────────────────────────────────────────────────

const LP_NAMES: Record<number, string> = {
  3: "Three-Pointed Triad",    4: "Four-Cornered Foundation",
  5: "Five-Pointed Quintessence", 6: "Six-Pointed Harmony",
  7: "Seven-Pointed Mystic Star", 8: "Eight-Pointed Infinity Gate",
  9: "Nine-Pointed Crown",    10: "Ten-Pointed Perfection",
  11: "Eleven-Pointed Master Sigil",
};

const LP_MEANINGS: Record<"relationships"|"wealth"|"health", Partial<Record<number,string>>> = {
  relationships: {
    3:  "Three is the number of creation — your relationships naturally birth something new: ideas, projects, and deeper truths emerge at the meeting point of two souls. You thrive in bonds that feel generative and alive.",
    4:  "Four represents unwavering foundation. Your deepest connections are built over time, layer by layer, like stone on stone. Loyalty and dependability are your love language.",
    5:  "Five pulses with freedom and magnetism. Your relationships need space to breathe and evolve — you attract people who challenge your edges and expand your world.",
    6:  "Six is the vibration of devotion. You carry a natural gift for creating harmony between opposing forces, making you a healer of broken bonds and a guardian of love.",
    7:  "Seven seeks the sacred within the human. You are drawn to rare souls who honor depth and mystery — connections that feel fated, as if written in the stars long before you met.",
    8:  "Eight flows like an infinite loop — giving and receiving in perfect rhythm. Your partnerships thrive when power is shared equally and both people invest fully in the whole.",
    9:  "Nine is the vibration of completion and compassion. You love without conditions and see the humanity in everyone, making you one of the most profoundly loving souls in any room.",
    10: "Ten returns to oneness. Your path in love is to dissolve the boundary between self and other — not through loss of identity, but through the rare alchemy of true partnership.",
    11: "Eleven is the master bridge. You feel connections at a frequency others cannot access — your relationships carry a spiritual charge, and the right partner accelerates your soul's evolution.",
  },
  wealth: {
    3:  "Three channels wealth through creativity and expression. Your most abundant pathway is one where your voice, ideas, and unique perspective are the asset — never underestimate the value of your originality.",
    4:  "Four builds prosperity slowly and surely. Your financial power lies in discipline, long-term thinking, and creating systems that generate returns long after the work is done.",
    5:  "Five multiplies abundance through variety and bold risk. You are wired for multiple income streams and unconventional paths — the standard route rarely leads to your fullest potential.",
    6:  "Six attracts wealth through service and beauty. When your work genuinely uplifts others, abundance flows back to you naturally — alignment between purpose and income is your secret.",
    7:  "Seven accumulates through expertise and depth. You are meant to master a craft so completely that the world seeks you out — your wealth comes from what no one else understands as well as you do.",
    8:  "Eight is the number of infinite abundance — a figure-eight of energy: give powerfully, receive powerfully. Business, investment, and leadership are your natural wealth channels.",
    9:  "Nine generates abundance by serving the larger good. The paradox of your path: the more freely you give, the more returns to you. Generosity is not a cost — it is your wealth strategy.",
    10: "Ten marks the completion of one cycle and the start of a richer one. Every apparent ending in your financial life is actually a rebirth into greater capacity.",
    11: "Eleven brings wealth through vision and inspiration. Your ability to see what others cannot is your most bankable skill — ideas that arrive fully formed are often million-dollar seeds.",
  },
  health: {
    3:  "Three keeps you well through creative expression. Suppressed creativity becomes physical tension in your body — the moment you give your ideas an outlet, your energy visibly lifts.",
    4:  "Four grounds your health in routine and structure. Your body responds beautifully to consistent rhythms: regular sleep, regular movement, regular nourishment — predictability is medicine for you.",
    5:  "Five needs movement and variety to stay vital. A stagnant environment becomes a stagnant body — you heal faster when life is dynamic, adventurous, and sensory-rich.",
    6:  "Six holds health through harmony and beauty. Your nervous system is highly attuned to its environment — beauty, order, and peaceful surroundings are not luxuries for you; they are medicine.",
    7:  "Seven heals through solitude and inner stillness. Your body requires regular periods of deep quiet to reset — meditation, time in nature, and reflective practices restore you like nothing else.",
    8:  "Eight renews through cycles of intensity and rest. Your body is built for powerful effort followed by deep recovery — overwork depletes you profoundly, but proper rest regenerates you completely.",
    9:  "Nine sustains vitality through meaning and purpose. When your daily life feels purposeless, your energy contracts physically. Connecting your body's actions to a larger mission is your most potent health practice.",
    10: "Ten calls you to wholeness — integrating every part of yourself into one coherent, well-tended life. Your health peaks when nothing within you is being ignored or suppressed.",
    11: "Eleven requires grounding to stay well. Your sensitivity to energy and emotion can overwhelm the nervous system — deliberate grounding, physical practices, and energy boundaries are essential to your vitality.",
  },
};

const ELEMENT_MEANINGS: Record<string, Record<"relationships"|"wealth"|"health", string>> = {
  Fire: {
    relationships: "Your flame layer speaks to passion as your primary love force. You love with intensity and require a partner who can meet your heat without being consumed by it. The flame spikes of your sigil mark the moments your heart ignites — and they are many.",
    wealth:        "Fire signs channel abundance through bold, decisive action. The lances in your sigil represent the initiatives you must launch fearlessly — each spike a burst of creative will converting vision into tangible result. Hesitation is your only true obstacle.",
    health:        "Your Fire element demands movement and heat as medicine. The flame spikes in your outer layer encode the need for dynamic, vigorous physical expression — when you move, you burn clean. Stagnation accumulates as inflammation; motion becomes your daily healer.",
  },
  Earth: {
    relationships: "Your nested squares speak of love as architecture. You build connections brick by brick — slowly, carefully, enduringly. The rotating layers of your sigil show how you add dimension over time, each rotation revealing a deeper level of trust and commitment.",
    wealth:        "Earth's concentric squares encode wealth as patient accumulation. Each rotated layer of your sigil represents another cycle of compounding — you understand better than any sign that true abundance is built in seasons, not in moments.",
    health:        "Your Earth layer grounds you in the physical body as home. The layered squares of your sigil mark the importance of sensory nourishment: wholesome food, sleep in darkness, skin-to-earth contact. Your body is your temple and responds to being treated as one.",
  },
  Air: {
    relationships: "Your spiral arms trace the way Air energy moves through connection — always circling, linking, cross-pollinating. You need intellectual kinship as much as emotional warmth, and the arcs connecting your spirals show how you weave bonds across distance and difference.",
    wealth:        "Air multiplies abundance through ideas, communication, and networks. The spiraling arms of your sigil trace the expansion of your influence — each connection you make creates another pathway for opportunity. Your wealth lives in the network of minds you cultivate.",
    health:        "Your spiral layer encodes the breath as primary medicine. Oxygen, rhythm, and the quality of the air you breathe are foundational to your wellbeing. The expanding spirals of your sigil remind you that your nervous system restores itself through conscious breathing and mental spaciousness.",
  },
  Water: {
    relationships: "Your crescent waves speak of love as a tidal force — deep, rhythmic, and beyond rational control. You feel the emotional undertow of relationships before a word is spoken. The wave arcs in your sigil map the emotional currents you navigate in every bond.",
    wealth:        "Water accumulates abundance through flow and feeling. Your financial intuition is extraordinary — the waves of your sigil encode the importance of following your gut on where to invest your energy and resources. Trying to force wealth creates dams; learning to flow creates rivers.",
    health:        "Your wave arcs speak to hydration, emotional release, and the lymphatic body. Water signs carry emotion in their tissues — unprocessed feelings become physical symptoms. The rhythmic crescents of your sigil are a daily reminder: let what is ready to leave, leave.",
  },
};

const PILLAR_MOTIF_MEANINGS: Record<"relationships"|"wealth"|"health", string> = {
  relationships: "The two interlocking circles at your sigil's heart trace the Vesica Piscis — the ancient symbol for the space where two distinct beings meet and create something neither could alone. Their offset angle is calculated from your Life Path, making this the only axis in the universe where your particular energy meets another's most fully.",
  wealth:        "The crystal facets at your sigil's center are calculated from your Life Path number, each rhombus representing a distinct frequency of value you are uniquely positioned to create. Like facets on a gem, they don't compete — they multiply the light, directing abundance from every angle toward a single, radiant point.",
  health:        "The organic petals at your sigil's core are drawn from the ancient seed-of-life pattern, adapted to your Life Path number. Each petal represents one aspect of your holistic body — physical, energetic, emotional, mental, and beyond. Together they form the living flower of your personal vitality system.",
};

/** Sigil Interpretation page — inserted right after each pillar cover page */
function addSigilInterpretationPage(
  doc: PDFKit.PDFDocument,
  pillar: "relationships" | "wealth" | "health",
  order: ZodiacOrder
) {
  doc.addPage();

  const CW = PAGE_W, CH = PAGE_H;
  const cx = CW / 2;
  const SAFE_X = SAFE;
  const TW = CW - SAFE_X * 2;

  const themes = {
    relationships: { bg:[28,5,15] as [number,number,number], accent:[244,155,188] as [number,number,number] },
    wealth:        { bg:[20,12,0] as [number,number,number], accent:[212,165,30]  as [number,number,number] },
    health:        { bg:[3,20,14] as [number,number,number], accent:[100,210,168] as [number,number,number] },
  };
  const t = themes[pillar];

  // ── Background ──────────────────────────────────────────────────────────────
  doc.rect(0, 0, CW, CH).fill(t.bg);

  // Subtle top vignette (lighter)
  doc.rect(0, 0, CW, CH * 0.35)
    .fillColor([t.bg[0]+10, t.bg[1]+8, t.bg[2]+5] as [number,number,number])
    .fillOpacity(0.4).fill();
  doc.fillOpacity(1);

  // ── Thin border frame ────────────────────────────────────────────────────────
  const m = SAFE_X - 2;
  doc.rect(m, m, CW - m*2, CH - m*2)
    .fillOpacity(0).strokeColor(t.accent).strokeOpacity(0.12).lineWidth(0.5).stroke();
  doc.strokeOpacity(1);

  // ── Mini sigil (top section, small) ─────────────────────────────────────────
  const miniR = 68;
  const miniCy = SAFE_X + 22 + miniR;
  drawPersonalizedSigil(doc, cx, miniCy, miniR, order, pillar, t.accent);

  // ── "SIGIL INTERPRETATION" header ────────────────────────────────────────────
  let y = miniCy + miniR + 14;
  doc.fillColor(t.accent).fillOpacity(0.40).font("Helvetica").fontSize(6.5)
    .text("SIGIL  INTERPRETATION", SAFE_X, y, { align:"center", width: TW, characterSpacing: 3.5 });
  doc.fillOpacity(1);
  y += 14;

  // Full-width rule
  doc.moveTo(SAFE_X, y).lineTo(CW - SAFE_X, y)
    .strokeColor(t.accent).strokeOpacity(0.22).lineWidth(0.5).stroke();
  doc.strokeOpacity(1);
  y += 14;

  // ── Helper: draw one interpretation block ────────────────────────────────────
  function drawBlock(icon: string, title: string, body: string) {
    // Small decorative icon (left of title)
    doc.fillColor(t.accent).fillOpacity(0.55).font("Helvetica-Bold").fontSize(9)
      .text(icon, SAFE_X, y, { continued: true })
      .fillColor(t.accent).fillOpacity(0.90).font("Helvetica-Bold").fontSize(8.5)
      .text(`  ${title.toUpperCase()}`, { characterSpacing: 1.2 });
    doc.fillOpacity(1);
    y += 13;

    doc.fillColor(t.accent).fillOpacity(0.60).font("Helvetica").fontSize(8.5)
      .text(body, SAFE_X, y, { width: TW, lineGap: 3, align: "justify" });
    y += doc.heightOfString(body, { width: TW, lineGap: 3 }) + 14;

    // Thin rule after block
    doc.moveTo(SAFE_X, y - 6).lineTo(CW - SAFE_X, y - 6)
      .strokeColor(t.accent).strokeOpacity(0.12).lineWidth(0.4).stroke();
    doc.strokeOpacity(1);
  }

  // ── Block 1: Life Path Polygon ───────────────────────────────────────────────
  const lp = Math.max(3, Math.min(11, (() => {
    const n = parseInt(order.lifePath ?? "7");
    if (n === 11) return 11; if (n === 22) return 8; if (n === 33) return 6;
    return n;
  })()));
  const lpName = LP_NAMES[lp] ?? `${lp}-Pointed Star`;
  const lpText = LP_MEANINGS[pillar][lp] ??
    `Your ${lp}-pointed star encodes a unique harmonic frequency into your ${pillar} path — a sacred geometry that marks both your gifts and the specific channel through which this pillar's energy most naturally flows.`;
  drawBlock("✦", `Your ${lpName}`, lpText);

  // ── Block 2: Element Layer ───────────────────────────────────────────────────
  const element = ZODIAC_KEYWORDS[order.sunSign ?? "Leo"]?.element ?? "Fire";
  const elemText = ELEMENT_MEANINGS[element]?.[pillar] ??
    `Your ${element} energy shapes the outer layer of your sigil, defining the quality of force that surrounds and protects your core ${pillar} frequency.`;
  drawBlock("◈", `Your ${element} Outer Layer`, elemText);

  // ── Block 3: Center Motif ────────────────────────────────────────────────────
  const motifText = PILLAR_MOTIF_MEANINGS[pillar];
  drawBlock("◉", `Your ${pillar.charAt(0).toUpperCase() + pillar.slice(1)} Center Motif`, motifText);

  // ── Bottom attribution ───────────────────────────────────────────────────────
  const bottomY = CH - SAFE_X - 18;
  doc.moveTo(SAFE_X, bottomY).lineTo(CW - SAFE_X, bottomY)
    .strokeColor(t.accent).strokeOpacity(0.18).lineWidth(0.4).stroke();
  doc.strokeOpacity(1);

  const luckyNums = (order.luckyNumbers ?? "3,7").split(",")
    .map(n => n.trim()).filter(Boolean).slice(0, 5).join("  ·  ");
  doc.fillColor(t.accent).fillOpacity(0.22).font("Helvetica").fontSize(6.5)
    .text(
      `${order.fullName}  ·  ${order.sunSign} ${element}  ·  Life Path ${order.lifePath}  ·  Lucky ${luckyNums}`,
      SAFE_X, bottomY + 6, { align:"center", width: TW, characterSpacing: 0.5 }
    );
  doc.fillOpacity(1);
}

const PERSONAL_YEAR_MEANINGS: Record<number, { title: string; focus: string; caution: string }> = {
  1: { title: "Initiation", focus: "Start boldly and claim fresh ground.", caution: "Avoid forcing outcomes too early." },
  2: { title: "Alignment", focus: "Build trust, refine timing, and collaborate.", caution: "Don't rush what needs patience." },
  3: { title: "Expression", focus: "Create, share, and let your voice be seen.", caution: "Watch scattered energy." },
  4: { title: "Structure", focus: "Stabilize systems and make lasting progress.", caution: "Don't become rigid." },
  5: { title: "Change", focus: "Move, adapt, and welcome surprise openings.", caution: "Avoid impulse without direction." },
  6: { title: "Commitment", focus: "Nurture home, love, duty, and beauty.", caution: "Don't over-carry everyone." },
  7: { title: "Depth", focus: "Study, reflect, and trust inner guidance.", caution: "Don't isolate for too long." },
  8: { title: "Power", focus: "Lead, grow resources, and amplify impact.", caution: "Avoid control for its own sake." },
  9: { title: "Completion", focus: "Release what has run its course.", caution: "Don't cling to outdated roles." },
};

function reduceToDigit(n: number): number {
  let x = Math.abs(n);
  while (x > 9 && x !== 11 && x !== 22 && x !== 33) {
    x = String(x).split("").reduce((sum, ch) => sum + parseInt(ch), 0);
  }
  return x;
}

function getPersonalYear(order: ZodiacOrder): number {
  const year = new Date(order.birthday).getFullYear();
  const month = new Date(order.birthday).getMonth() + 1;
  const day = new Date(order.birthday).getDate();
  const currentYear = new Date().getFullYear();
  return reduceToDigit(month + day + currentYear);
}

function addYearAheadPage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();

  const CW = PAGE_W, CH = PAGE_H;
  const year = getPersonalYear(order);
  const theme = PERSONAL_YEAR_MEANINGS[year] ?? PERSONAL_YEAR_MEANINGS[7];
  const element = ZODIAC_KEYWORDS[order.sunSign ?? "Leo"]?.element ?? "Fire";
  const color: [number, number, number] =
    element === "Fire" ? [244, 155, 188] :
    element === "Earth" ? [212, 165, 30] :
    element === "Air" ? [130, 160, 220] :
    [100, 210, 168];

  doc.rect(0, 0, CW, CH).fill([10, 12, 20]);
  doc.rect(0, 0, CW, CH * 0.25).fillColor(color).fillOpacity(0.12).fill();
  doc.fillOpacity(1);

  doc.fillColor(color).fillOpacity(0.55).font("Helvetica").fontSize(7)
    .text("YOUR YEAR AHEAD", SAFE, SAFE + 10, { width: CW - SAFE * 2, align: "center", characterSpacing: 3 });
  doc.fillColor([255, 255, 255]).fillOpacity(0.95).font("Helvetica-Bold").fontSize(22)
    .text(`PERSONAL YEAR ${year}`, SAFE, SAFE + 26, { width: CW - SAFE * 2, align: "center" });
  doc.fillOpacity(1);

  const centerX = CW / 2;
  const startY = CH * 0.2;
  const boxW = 116;
  const boxH = 68;
  const gapX = 10;
  const gapY = 12;
  const labels = ["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"];
  const phases = [
    theme.focus,
    `Your ${order.sunSign ?? "sun"} energy favors steady momentum.`,
    `Use the ${element} current to keep the year moving.`,
    theme.caution,
  ];

  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = centerX - boxW - gapX / 2 + col * (boxW + gapX);
    const y = startY + row * (boxH + gapY);
    doc.roundedRect(x, y, boxW, boxH, 10).fill(color).fillOpacity(i === 0 ? 0.16 : 0.09).fill();
    doc.roundedRect(x, y, boxW, boxH, 10).fillOpacity(0).strokeColor(color).strokeOpacity(0.35).lineWidth(0.6).stroke();
    doc.fillOpacity(1);
    doc.fillColor(color).fillOpacity(0.85).font("Helvetica-Bold").fontSize(8)
      .text(labels[i]!, x, y + 8, { width: boxW, align: "center", characterSpacing: 1.5 });
    doc.fillColor([255,255,255]).fillOpacity(0.85).font("Helvetica").fontSize(7.5)
      .text(phases[i]!, x + 7, y + 22, { width: boxW - 14, align: "center", lineGap: 2 });
    doc.fillOpacity(1);
  }

  doc.moveTo(SAFE, CH * 0.68).lineTo(CW - SAFE, CH * 0.68).strokeColor(color).strokeOpacity(0.2).lineWidth(0.5).stroke();
  doc.strokeOpacity(1);
  doc.fillColor(color).fillOpacity(0.48).font("Helvetica-Bold").fontSize(11)
    .text(theme.title.toUpperCase(), SAFE, CH * 0.70, { width: CW - SAFE * 2, align: "center", characterSpacing: 2 });
  doc.fillColor([255,255,255]).fillOpacity(0.85).font("Helvetica").fontSize(8.5)
    .text(
      `This year asks you to move through ${theme.title.toLowerCase()} with ${element.toLowerCase()}-signed confidence. ${theme.focus} ${theme.caution}`,
      SAFE + 18,
      CH * 0.74,
      { width: CW - SAFE * 2 - 36, align: "center", lineGap: 3 }
    );
  doc.fillOpacity(1);
}

/** Full-bleed natal chart spread — styled like the reference images */
function addBirthChartPage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();

  const CW = PAGE_W, CH = PAGE_H;
  const cx = CW / 2, cy = CH / 2 + 10;

  // ── Background: dark outer ring + cream inner field ────────────────────────
  doc.rect(0, 0, CW, CH).fill([18, 12, 8]); // Dark parchment-brown background

  // Cream inner disc (the chart background)
  const diskR = 240;
  doc.circle(cx, cy, diskR).fill([242, 235, 210]);

  // ── Radii ─────────────────────────────────────────────────────────────────
  const labelR  = 222; // outer text ring (sign names + planet labels)
  const outerR  = 198; // outer zodiac wheel edge
  const midR    = 162; // inner zodiac wheel edge / house outer
  const houseR  = 120; // house inner edge
  const centerR = 48;  // center medallion

  const sunIdx  = Math.max(0, ZODIAC_LIST.indexOf(order.sunSign   ?? "Aries"));
  const moonIdx = Math.max(0, ZODIAC_LIST.indexOf(order.moonSign  ?? "Cancer"));
  const riseIdx = Math.max(0, ZODIAC_LIST.indexOf(order.risingSign ?? "Libra"));

  // ── Outer decorative ring ─────────────────────────────────────────────────
  doc.circle(cx, cy, outerR + 22).fill([18, 12, 8]);
  doc.circle(cx, cy, outerR + 18).fillOpacity(0).strokeColor([180, 155, 90]).lineWidth(1).stroke();
  doc.circle(cx, cy, outerR + 22).fillOpacity(0).strokeColor([180, 155, 90]).lineWidth(0.5).stroke();
  doc.fillOpacity(1);

  // ── Sign labels around the outer ring ─────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const am = (((i + 0.5) * 30 - 90) * Math.PI) / 180;
    const lx = cx + labelR * Math.cos(am);
    const ly = cy + labelR * Math.sin(am);
    const sign = ZODIAC_LIST[i]!;
    const isSun = i === sunIdx, isMoon = i === moonIdx, isRise = i === riseIdx;
    const labelColor: [number,number,number] = isSun ? [201,168,76] : isMoon ? [130,160,220] : isRise ? [100,185,140] : [200,185,150];
    const sym = ZODIAC_SYMBOLS[sign] ?? sign.slice(0,2);
    doc.fillColor(labelColor).fillOpacity(isSun || isMoon || isRise ? 1 : 0.55)
      .font("Helvetica-Bold").fontSize(isSun || isMoon || isRise ? 13 : 10)
      .text(sym, lx - 8, ly - 6, { width: 16, align:"center" });
    doc.fillOpacity(1);
  }

  // ── 12 zodiac segments (outer ring) ───────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const a1 = ((i * 30 - 90) * Math.PI) / 180;
    const a2 = (((i+1) * 30 - 90) * Math.PI) / 180;
    const sign = ZODIAC_LIST[i]!;
    const isSun = i === sunIdx, isMoon = i === moonIdx, isRise = i === riseIdx;
    const baseColor = ZODIAC_COLORS[sign] ?? [136,136,136];

    let fillColor: [number,number,number];
    if (isSun)        fillColor = [201,168,76];
    else if (isMoon)  fillColor = [72,102,185];
    else if (isRise)  fillColor = [68,162,112];
    else fillColor = [baseColor[0]*0.15+18, baseColor[1]*0.15+10, baseColor[2]*0.15+6] as [number,number,number];

    const ox1 = cx + outerR * Math.cos(a1), oy1 = cy + outerR * Math.sin(a1);
    const ox2 = cx + outerR * Math.cos(a2), oy2 = cy + outerR * Math.sin(a2);
    const mx1 = cx + midR  * Math.cos(a1), my1 = cy + midR  * Math.sin(a1);
    const mx2 = cx + midR  * Math.cos(a2), my2 = cy + midR  * Math.sin(a2);
    doc.path(`M ${mx1} ${my1} L ${ox1} ${oy1} A ${outerR} ${outerR} 0 0 1 ${ox2} ${oy2} L ${mx2} ${my2} A ${midR} ${midR} 0 0 0 ${mx1} ${my1} Z`).fill(fillColor);
    // Separator spokes
    doc.path(`M ${mx1} ${my1} L ${cx + (outerR+22) * Math.cos(a1)} ${cy + (outerR+22) * Math.sin(a1)}`).strokeColor([18,12,8]).lineWidth(1).stroke();
  }

  // ── 12 house divisions (inner ring) ───────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const a1 = ((i * 30 - 90) * Math.PI) / 180;
    const a2 = (((i+1) * 30 - 90) * Math.PI) / 180;
    const isAngular = i % 3 === 0; // angular houses (1,4,7,10) slightly highlighted
    const houseBg: [number,number,number] = isAngular ? [225,215,188] : [238,230,208];
    const hx1 = cx + houseR * Math.cos(a1), hy1 = cy + houseR * Math.sin(a1);
    const hx2 = cx + houseR * Math.cos(a2), hy2 = cy + houseR * Math.sin(a2);
    const mx1 = cx + midR  * Math.cos(a1), my1 = cy + midR  * Math.sin(a1);
    const mx2 = cx + midR  * Math.cos(a2), my2 = cy + midR  * Math.sin(a2);
    doc.path(`M ${hx1} ${hy1} L ${mx1} ${my1} A ${midR} ${midR} 0 0 1 ${mx2} ${my2} L ${hx2} ${hy2} A ${houseR} ${houseR} 0 0 0 ${hx1} ${hy1} Z`).fill(houseBg);
    doc.path(`M ${hx1} ${hy1} L ${cx + (outerR+22) * Math.cos(a1)} ${cy + (outerR+22) * Math.sin(a1)}`).strokeColor([140,120,80]).lineWidth(isAngular ? 1.2 : 0.5).stroke();

    // House numbers
    const am = (((i + 0.5) * 30 - 90) * Math.PI) / 180;
    const hnx = cx + ((houseR + midR) / 2) * Math.cos(am);
    const hny = cy + ((houseR + midR) / 2) * Math.sin(am);
    doc.fillColor([100,80,50]).fillOpacity(0.55).font("Helvetica").fontSize(7)
      .text(String(i + 1), hnx - 5, hny - 4, { width: 10, align:"center" });
    doc.fillOpacity(1);
  }

  // ── Ring borders ──────────────────────────────────────────────────────────
  doc.circle(cx, cy, outerR).fillOpacity(0).strokeColor([80,60,30]).lineWidth(1).stroke();
  doc.circle(cx, cy, midR).fillOpacity(0).strokeColor([120,95,55]).lineWidth(0.8).stroke();
  doc.circle(cx, cy, houseR).fillOpacity(0).strokeColor([160,130,80]).lineWidth(0.6).stroke();
  doc.fillOpacity(1);

  // ── Center medallion ──────────────────────────────────────────────────────
  doc.circle(cx, cy, centerR + 4).fill([18, 12, 8]);
  doc.circle(cx, cy, centerR + 2).fill([201, 168, 76]);
  doc.circle(cx, cy, centerR).fill([18, 12, 8]);
  doc.circle(cx, cy, centerR).fillOpacity(0).strokeColor([201,168,76]).lineWidth(1.5).stroke();
  doc.fillOpacity(1);

  // Life path number in center
  doc.fillColor([201,168,76]).fillOpacity(0.55).font("Helvetica").fontSize(7)
    .text("LIFE PATH", cx - 22, cy - 15, { width: 44, align:"center", characterSpacing: 1 });
  doc.fillColor([201,168,76]).fillOpacity(1).font("Helvetica-Bold").fontSize(24)
    .text(order.lifePath ?? "7", cx - 22, cy - 4, { width: 44, align:"center" });
  doc.fillOpacity(1);

  // ── "Your Natal Chart" badge (top-left corner, dark pill) ─────────────────
  const badgeX = SAFE + 4, badgeY = SAFE + 4;
  doc.roundedRect(badgeX, badgeY, 78, 32, 4).fill([18, 12, 8]);
  doc.roundedRect(badgeX, badgeY, 78, 32, 4).fillOpacity(0).strokeColor([180,155,90]).lineWidth(0.8).stroke();
  doc.fillOpacity(1);
  doc.fillColor([180,155,90]).fillOpacity(0.6).font("Helvetica").fontSize(6)
    .text("YOUR", badgeX + 2, badgeY + 5, { width: 74, align:"center", characterSpacing: 2 });
  doc.fillColor([201,168,76]).font("Helvetica-Bold").fontSize(11)
    .text("NATAL CHART", badgeX + 2, badgeY + 15, { width: 74, align:"center", characterSpacing: 1 });
  doc.fillOpacity(1);

  // ── Person name arched across the top of the chart ────────────────────────
  doc.fillColor([18,12,8]).fillOpacity(0.8).font("Helvetica-Bold").fontSize(13)
    .text(order.fullName.toUpperCase(), SAFE, SAFE + 44, { width: CW - SAFE*2, align:"center", characterSpacing: 3 });
  doc.fillOpacity(1);

  // ── Sun / Moon / Rising sign labels (large, positioned at cardinal edges) ──
  // Sun sign — top
  doc.fillColor([201,168,76]).fillOpacity(0.9).font("Helvetica-Bold").fontSize(22)
    .text((order.sunSign ?? "").toUpperCase(), SAFE, SAFE + 60, { width: CW - SAFE*2, align:"center", characterSpacing: 4 });
  doc.fillOpacity(1);

  // Moon sign — bottom-right diagonal label
  const moonLabel = `YOUR MOON SIGN IS  ${order.moonSign?.toUpperCase() ?? ""}`;
  doc.fillColor([130,160,220]).fillOpacity(0.85).font("Helvetica").fontSize(8)
    .text(moonLabel, CW * 0.55, CH * 0.82, { width: 160, characterSpacing: 1 });

  // Rising sign — bottom-left diagonal label
  const riseLabel = `YOUR RISING SIGN IS  ${order.risingSign?.toUpperCase() ?? ""}`;
  doc.fillColor([100,185,140]).fillOpacity(0.85).font("Helvetica").fontSize(8)
    .text(riseLabel, SAFE + 8, CH * 0.82, { width: 160, characterSpacing: 1 });

  // ── Birth info (bottom center) ────────────────────────────────────────────
  doc.fillColor([18,12,8]).fillOpacity(0.5).font("Helvetica").fontSize(8)
    .text("BORN AT", SAFE, CH - SAFE - 28, { width: CW - SAFE*2, align:"center", characterSpacing: 2 });
  const birthInfo = [order.birthTime, order.birthday, order.birthLocation].filter(Boolean).join("  ·  ");
  doc.fillColor([18,12,8]).fillOpacity(0.65).font("Helvetica-Bold").fontSize(9)
    .text(birthInfo, SAFE, CH - SAFE - 16, { width: CW - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  // ── Corner star ornaments ─────────────────────────────────────────────────
  const corners = [[SAFE + 4, SAFE + 4],[CW - SAFE - 4, SAFE + 4],[SAFE + 4, CH - SAFE - 4],[CW - SAFE - 4, CH - SAFE - 4]];
  for (const [sx, sy] of corners) {
    doc.fillColor([180,155,90]).fillOpacity(0.35).font("Helvetica").fontSize(10).text("✦", sx! - 4, sy! - 5);
  }
  doc.fillOpacity(1);
}

/** Constellation star art + zodiac splash for the sun sign */
function addZodiacSplashPage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();
  const CW = PAGE_W, CH = PAGE_H;
  const sign = order.sunSign ?? "Leo";
  const info = ZODIAC_KEYWORDS[sign] ?? ZODIAC_KEYWORDS["Leo"]!;
  const signColor = ZODIAC_COLORS[sign] ?? [201,168,76];

  // ── Dark full-bleed background ─────────────────────────────────────────────
  doc.rect(0, 0, CW, CH).fill([8, 6, 14]);

  // Subtle top/bottom gradient strips
  doc.rect(0, 0, CW, CH * 0.25).fillOpacity(0.4).fill([signColor[0]*0.12, signColor[1]*0.12, signColor[2]*0.12] as [number,number,number]);
  doc.rect(0, CH * 0.75, CW, CH * 0.25).fillOpacity(0.3).fill([signColor[0]*0.1, signColor[1]*0.1, signColor[2]*0.1] as [number,number,number]);
  doc.fillOpacity(1);

  // ── Decorative border frame ────────────────────────────────────────────────
  const m = SAFE - 4;
  doc.rect(m, m, CW - m*2, CH - m*2).fillOpacity(0).strokeColor(signColor).lineWidth(0.8).stroke();
  doc.rect(m + 5, m + 5, CW - m*2 - 10, CH - m*2 - 10).fillOpacity(0).strokeColor(signColor).lineWidth(0.3).fillOpacity(0).stroke();
  doc.fillOpacity(1);
  // Corner ornaments
  for (const [bx, by] of [[m+2,m+2],[CW-m-12,m+2],[m+2,CH-m-12],[CW-m-12,CH-m-12]] as [number,number][]) {
    doc.fillColor(signColor).fillOpacity(0.7).font("Helvetica").fontSize(8).text("✦", bx, by);
  }
  doc.fillOpacity(1);

  // ── Large glyph watermark ─────────────────────────────────────────────────
  doc.fillColor(signColor).fillOpacity(0.05).font("Helvetica-Bold").fontSize(280)
    .text(info.glyph, 0, CH * 0.05, { width: CW, align:"center" });
  doc.fillOpacity(1);

  // ── Constellation star field (background scatter) ─────────────────────────
  const rng = (seed: number) => { let h = seed * 2654435761; h ^= h >> 16; return (h >>> 0) / 0xFFFFFFFF; };
  for (let i = 0; i < 40; i++) {
    const sx = rng(i * 3 + 1) * (CW - SAFE*2) + SAFE;
    const sy = rng(i * 3 + 2) * (CH - SAFE*2) + SAFE;
    const sr = rng(i * 3 + 3) * 1.5 + 0.4;
    doc.circle(sx, sy, sr).fill([255,255,255]).fillOpacity(rng(i*3)*0.4 + 0.08);
    doc.fillOpacity(1);
  }

  // ── Main constellation art ────────────────────────────────────────────────
  const stars = CONSTELLATION_STARS[sign] ?? CONSTELLATION_STARS["Leo"]!;
  const lines = CONSTELLATION_LINES[sign] ?? CONSTELLATION_LINES["Leo"]!;

  // Scale constellation to a circle area centered on the page
  const constCx = CW / 2, constCy = CH / 2 - 10;
  const constR  = 140;

  // Draw connecting lines first
  for (const [a, b] of lines) {
    const [ax, ay] = stars[a]!;
    const [bx, by] = stars[b]!;
    const sx = constCx + (ax - 0.5) * constR * 2;
    const sy = constCy + (ay - 0.5) * constR * 2;
    const ex = constCx + (bx - 0.5) * constR * 2;
    const ey = constCy + (by - 0.5) * constR * 2;
    doc.moveTo(sx, sy).lineTo(ex, ey)
      .strokeColor(signColor).lineWidth(0.7).fillOpacity(0)
      .opacity(0.4).stroke();
    doc.opacity(1);
  }

  // Draw star dots
  for (let i = 0; i < stars.length; i++) {
    const [nx, ny] = stars[i]!;
    const sx = constCx + (nx - 0.5) * constR * 2;
    const sy = constCy + (ny - 0.5) * constR * 2;
    // Main star
    const starR = i === 0 ? 5 : i < 3 ? 3.5 : 2.5;
    doc.circle(sx, sy, starR + 3).fill(signColor).fillOpacity(0.12);
    doc.circle(sx, sy, starR).fill([255,255,255]);
    doc.fillOpacity(1);
    // 4-point sparkle on bright stars
    if (i < 3) {
      const sp = starR + 4;
      doc.moveTo(sx, sy - sp).lineTo(sx, sy + sp).strokeColor([255,255,255]).lineWidth(0.5).opacity(0.5).stroke();
      doc.moveTo(sx - sp, sy).lineTo(sx + sp, sy).strokeColor([255,255,255]).lineWidth(0.5).stroke();
      doc.opacity(1);
    }
  }

  // ── "YOUR SUN SIGN IS" label ───────────────────────────────────────────────
  doc.fillColor([255,255,255]).fillOpacity(0.45).font("Helvetica").fontSize(8)
    .text("— YOUR SUN SIGN IS —", SAFE, SAFE + 10, { width: CW - SAFE*2, align:"center", characterSpacing: 3 });
  doc.fillOpacity(1);

  // ── Large sign name ────────────────────────────────────────────────────────
  const nameFontSize = sign.length > 9 ? 42 : 52;
  doc.fillColor(signColor).fillOpacity(0.95).font("Helvetica-Bold").fontSize(nameFontSize)
    .text(sign.toUpperCase(), SAFE, SAFE + 24, { width: CW - SAFE*2, align:"center", characterSpacing: 6 });
  doc.fillOpacity(1);

  // ── Element badge ──────────────────────────────────────────────────────────
  const elemW = 80, elemH = 20;
  const elemX = (CW - elemW) / 2, elemY = SAFE + 24 + nameFontSize + 8;
  doc.roundedRect(elemX, elemY, elemW, elemH, 10).fill(signColor).fillOpacity(0.2);
  doc.roundedRect(elemX, elemY, elemW, elemH, 10).fillOpacity(0).strokeColor(signColor).lineWidth(0.6).stroke();
  doc.fillOpacity(1);
  doc.fillColor(signColor).font("Helvetica").fontSize(8)
    .text(info.element.toUpperCase(), elemX, elemY + 6, { width: elemW, align:"center", characterSpacing: 2 });

  // ── Keyword pills at bottom ────────────────────────────────────────────────
  const kwY = CH - SAFE - 36;
  const kwSpacing = (CW - SAFE*2) / info.keywords.length;
  for (let i = 0; i < info.keywords.length; i++) {
    const kwX = SAFE + i * kwSpacing + kwSpacing / 2 - 36;
    doc.roundedRect(kwX, kwY, 72, 18, 9).fill(signColor).fillOpacity(0.15);
    doc.roundedRect(kwX, kwY, 72, 18, 9).fillOpacity(0).strokeColor(signColor).lineWidth(0.5).stroke();
    doc.fillOpacity(1);
    doc.fillColor(signColor).fillOpacity(0.9).font("Helvetica").fontSize(8)
      .text(info.keywords[i]!, kwX, kwY + 5, { width: 72, align:"center" });
    doc.fillOpacity(1);
  }
}

/** Moon phase wheel — shows birth moon position and phase diagram */
function addMoonPhasePage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();
  const CW = PAGE_W, CH = PAGE_H;
  const cx = CW / 2, cy = CH / 2 + 5;

  // ── Background ─────────────────────────────────────────────────────────────
  doc.rect(0, 0, CW, CH).fill([4, 8, 20]);

  // Subtle star scatter
  const rng = (s: number) => { let h = s * 2654435761; h ^= h >> 16; return (h >>> 0) / 0xFFFFFFFF; };
  for (let i = 0; i < 50; i++) {
    const sx = rng(i*5+1) * (CW - 20) + 10;
    const sy = rng(i*5+2) * (CH - 20) + 10;
    const sr = rng(i*5+3) * 1.2 + 0.3;
    doc.circle(sx, sy, sr).fill([255,255,255]).fillOpacity(rng(i*5+4)*0.35 + 0.05);
    doc.fillOpacity(1);
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  doc.fillColor([130,160,220]).fillOpacity(0.6).font("Helvetica").fontSize(7)
    .text("LUNAR ASTROLOGY", SAFE, SAFE + 10, { width: CW - SAFE*2, align:"center", characterSpacing: 3 });
  doc.fillColor([255,255,255]).fillOpacity(0.9).font("Helvetica-Bold").fontSize(14)
    .text("Your Birth Moon", SAFE, SAFE + 24, { width: CW - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  // ── Moon phase calculation ─────────────────────────────────────────────────
  const { phaseFrac, phaseName } = getMoonPhase(order.birthday);
  const moonColor: [number,number,number] = [228, 220, 195];
  const shadowColor: [number,number,number] = [6, 12, 28];

  // ── 8-phase orbit wheel ────────────────────────────────────────────────────
  const orbitR = 148;
  const phaseR = 20;
  const phases = [
    { name:"New Moon",        frac:0.00 },
    { name:"Waxing Crescent", frac:0.125 },
    { name:"First Quarter",   frac:0.25 },
    { name:"Waxing Gibbous",  frac:0.375 },
    { name:"Full Moon",       frac:0.50 },
    { name:"Waning Gibbous",  frac:0.625 },
    { name:"Last Quarter",    frac:0.75 },
    { name:"Waning Crescent", frac:0.875 },
  ];

  // Orbit ring
  doc.circle(cx, cy, orbitR).fillOpacity(0).strokeColor([130,160,220]).lineWidth(0.4).fillOpacity(0).stroke();
  doc.fillOpacity(1);

  for (let i = 0; i < 8; i++) {
    const angle = ((i / 8) * 2 * Math.PI) - Math.PI / 2;
    const px = cx + orbitR * Math.cos(angle);
    const py = cy + orbitR * Math.sin(angle);
    const phase = phases[i]!;
    const isCurrentPhase = Math.abs(phase.frac - phaseFrac) < 0.07 ||
      (phase.frac === 0 && phaseFrac > 0.93);

    // Draw outer glow for current phase
    if (isCurrentPhase) {
      doc.circle(px, py, phaseR + 8).fill([130,160,220]).fillOpacity(0.15);
      doc.circle(px, py, phaseR + 4).fill([130,160,220]).fillOpacity(0.25);
      doc.fillOpacity(1);
    }

    // Draw moon icon
    drawMoonIcon(doc, px, py, phaseR, phase.frac, moonColor, shadowColor);

    // Circle border
    doc.circle(px, py, phaseR).fillOpacity(0)
      .strokeColor(isCurrentPhase ? [180,210,255] : [60,80,130])
      .lineWidth(isCurrentPhase ? 1.5 : 0.5).stroke();
    doc.fillOpacity(1);

    // Phase label (short)
    const shortName = phase.name.replace("Waxing ","W+").replace("Waning ","W-").replace(" Moon","").replace("First ","1st ").replace("Last ","3rd ");
    const labelDist = orbitR + phaseR + 14;
    const lx = cx + labelDist * Math.cos(angle);
    const ly = cy + labelDist * Math.sin(angle);
    doc.fillColor(isCurrentPhase ? [180,210,255] : [130,160,220])
      .fillOpacity(isCurrentPhase ? 1 : 0.5).font("Helvetica").fontSize(6.5)
      .text(shortName, lx - 24, ly - 4, { width: 48, align:"center" });
    doc.fillOpacity(1);
  }

  // ── Large central moon ────────────────────────────────────────────────────
  const bigR = 55;
  // Outer glow
  doc.circle(cx, cy, bigR + 16).fill([40,60,120]).fillOpacity(0.3);
  doc.circle(cx, cy, bigR + 8).fill([60,90,160]).fillOpacity(0.25);
  doc.fillOpacity(1);
  drawMoonIcon(doc, cx, cy, bigR, phaseFrac, moonColor, shadowColor);
  doc.circle(cx, cy, bigR).fillOpacity(0).strokeColor([180,210,255]).lineWidth(1).stroke();
  doc.fillOpacity(1);

  // Phase name inside/below the big moon
  doc.fillColor([130,160,220]).fillOpacity(0.7).font("Helvetica").fontSize(7.5)
    .text(phaseName.toUpperCase(), SAFE, cy + bigR + 12, { width: CW - SAFE*2, align:"center", characterSpacing: 2 });
  doc.fillOpacity(1);

  // Moon sign label
  doc.fillColor([228,220,195]).fillOpacity(0.5).font("Helvetica").fontSize(8)
    .text(`Moon in ${order.moonSign ?? ""}`, SAFE, cy + bigR + 26, { width: CW - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  // ── Bottom: birth context ─────────────────────────────────────────────────
  doc.fillColor([130,160,220]).fillOpacity(0.35).font("Helvetica").fontSize(8)
    .text(`Moon phase: ${phaseName}.`,
      SAFE + 20, CH - SAFE - 24, { width: CW - SAFE*2 - 40, align:"center", lineGap: 2 });
  doc.fillOpacity(1);
}

/** Decorative globe vignette — port of the web preview's BirthplacePage. */
function addBirthplacePage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();
  const CW = PAGE_W, CH = PAGE_H;
  const location = order.birthLocation || "Your hometown";

  // ── Dark cosmic background ─────────────────────────────────────────────────
  doc.rect(0, 0, CW, CH).fill([5, 13, 26]);

  // Starfield
  for (let i = 0; i < 60; i++) {
    const sx = ((i * 211) % Math.floor(CW - SAFE * 2)) + SAFE;
    const sy = ((i * 167) % Math.floor(CH - SAFE * 2)) + SAFE;
    const sr = (i % 4) * 0.3 + 0.4;
    const op = ((i * 19) % 60) / 200 + 0.1;
    doc.circle(sx, sy, sr).fill([255, 255, 255]).fillOpacity(op);
  }
  doc.fillOpacity(1);

  // ── Header ─────────────────────────────────────────────────────────────────
  doc.fillColor(hexToRgb(BRAND.gold)).fillOpacity(0.55).font("Helvetica").fontSize(8)
    .text("BORN IN", SAFE, SAFE + 10, { width: CW - SAFE * 2, align: "center", characterSpacing: 3 });
  doc.fillOpacity(1);
  pdfColor(doc, BRAND.offWhite);
  doc.font("Helvetica-Oblique").fontSize(11)
    .text(`${order.fullName}'s point of arrival`, SAFE, SAFE + 26, { width: CW - SAFE * 2, align: "center" });

  // ── Globe ──────────────────────────────────────────────────────────────────
  const cx = CW / 2;
  const cy = CH / 2 - 6;
  const r = 130;

  // Faux halo via concentric rings (pdfkit has no radial gradients)
  for (let i = 0; i < 6; i++) {
    const rr = r + 4 + i * 4;
    doc.circle(cx, cy, rr).fillOpacity(0)
      .strokeColor(hexToRgb(BRAND.gold)).strokeOpacity(0.05 - i * 0.007).lineWidth(2).stroke();
  }
  doc.strokeOpacity(1);

  // Faux globe shading via 5 concentric filled circles, dark→darker
  const shadeColors: [number, number, number][] = [
    [26, 54, 80], [22, 46, 70], [18, 38, 58], [14, 30, 46], [10, 22, 36],
  ];
  shadeColors.forEach((color, i) => {
    const factor = 1 - i * 0.18;
    doc.circle(cx, cy, r * factor).fill(color);
  });

  // Globe outline
  doc.circle(cx, cy, r).fillOpacity(0)
    .strokeColor(hexToRgb(BRAND.gold)).strokeOpacity(0.18).lineWidth(0.6).stroke();
  doc.strokeOpacity(1);

  // ── Latitude lines (5 ellipses across the sphere) ──────────────────────────
  for (const yFrac of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const yPos = cy + yFrac * r;
    const rx = r * Math.cos(Math.asin(yFrac));
    const ry = rx * 0.06;
    doc.ellipse(cx, yPos, rx, ry).fillOpacity(0)
      .strokeColor(hexToRgb(BRAND.gold)).strokeOpacity(0.18).lineWidth(0.4).stroke();
  }

  // ── Longitude lines (visible front-half ellipses) ──────────────────────────
  for (const xFrac of [-0.65, -0.32, 0, 0.32, 0.65]) {
    const ex = Math.abs(xFrac * r) + 1;
    doc.ellipse(cx, cy, ex, r).fillOpacity(0)
      .strokeColor(hexToRgb(BRAND.gold)).strokeOpacity(0.18).lineWidth(0.4).stroke();
  }
  doc.strokeOpacity(1);

  // ── Abstract continent silhouettes (decorative, not cartographic) ─────────
  const cont = (path: string, opacity: number) => {
    doc.path(path).fill(hexToRgb(BRAND.gold)).fillOpacity(opacity);
  };
  // Translate the web's normalized 0–200 coords into PDF coords centered on (cx, cy).
  const tx = (x: number) => cx + (x - 100) * (r / 78);
  const ty = (y: number) => cy + (y - 100) * (r / 78);
  cont(
    `M ${tx(56)} ${ty(78)} Q ${tx(70)} ${ty(70)}, ${tx(86)} ${ty(78)} Q ${tx(96)} ${ty(90)}, ${tx(88)} ${ty(102)} Q ${tx(72)} ${ty(106)}, ${tx(60)} ${ty(96)} Z`,
    0.18,
  );
  cont(
    `M ${tx(110)} ${ty(90)} Q ${tx(124)} ${ty(86)}, ${tx(140)} ${ty(96)} Q ${tx(144)} ${ty(110)}, ${tx(132)} ${ty(118)} Q ${tx(116)} ${ty(116)}, ${tx(108)} ${ty(104)} Z`,
    0.16,
  );
  cont(
    `M ${tx(70)} ${ty(130)} Q ${tx(90)} ${ty(124)}, ${tx(108)} ${ty(138)} Q ${tx(110)} ${ty(152)}, ${tx(92)} ${ty(156)} Q ${tx(76)} ${ty(152)}, ${tx(68)} ${ty(142)} Z`,
    0.14,
  );
  doc.fillOpacity(1);

  // ── Pin (deterministic from location string — decorative only) ─────────────
  const lat = (hashToUnit(location, "lat") - 0.5) * 1.4;
  const lon = (hashToUnit(location, "lon") - 0.5) * 2;
  const pinX = cx + Math.sin(lon * Math.PI) * r * Math.cos((lat * Math.PI) / 2) * 0.78;
  const pinY = cy - Math.sin((lat * Math.PI) / 2) * r * 0.78;
  // Halo (no animation in PDF — just a soft outer disk)
  doc.circle(pinX, pinY, 8).fill(hexToRgb(BRAND.gold)).fillOpacity(0.18);
  doc.circle(pinX, pinY, 5).fill(hexToRgb(BRAND.gold)).fillOpacity(0.32);
  doc.fillOpacity(1);
  doc.circle(pinX, pinY, 3).fill([255, 255, 255]);
  doc.circle(pinX, pinY, 3).fillOpacity(0).strokeColor(hexToRgb(BRAND.gold)).lineWidth(0.8).stroke();

  // ── Bottom: location name + tagline ────────────────────────────────────────
  pdfColor(doc, BRAND.offWhite);
  doc.font("Helvetica-Bold").fontSize(18)
    .text(location, SAFE, CH - SAFE - 56, { width: CW - SAFE * 2, align: "center" });
  doc.fillColor([255, 255, 255]).fillOpacity(0.55).font("Helvetica-Oblique").fontSize(9)
    .text(
      "The exact coordinates of your first breath shape every transit and progression in your chart.",
      SAFE + 20, CH - SAFE - 30,
      { width: CW - SAFE * 2 - 40, align: "center", lineGap: 2 },
    );
  doc.fillOpacity(1);
}

/** Pythagorean numerology grid */
function addNumerologyPage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill([14, 8, 40]);

  const lp = parseInt(order.lifePath ?? "7");
  const luckyNums = (order.luckyNumbers ?? "3, 7").split(",").map((n) => parseInt(n.trim())).filter((n) => n >= 1 && n <= 9);
  const highlighted = new Set([lp, ...luckyNums]);

  // Header
  doc.fillColor([201,168,76]).fillOpacity(0.6).font("Helvetica").fontSize(7)
    .text("NUMEROLOGY", SAFE, SAFE + 10, { width: PAGE_W - SAFE*2, align:"center", characterSpacing: 2 });
  doc.fillColor([255,255,255]).fillOpacity(0.9).font("Helvetica-Bold").fontSize(14)
    .text("Your Sacred Number Grid", SAFE, SAFE + 24, { width: PAGE_W - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  // 3×3 grid
  const cellSize = 76;
  const gap = 10;
  const gridW = cellSize * 3 + gap * 2;
  const startX = (PAGE_W - gridW) / 2;
  const startY = PAGE_H * 0.22;
  const meanings: Record<number,string> = {
    1:"Leader", 2:"Balance", 3:"Expression", 4:"Structure", 5:"Freedom",
    6:"Harmony", 7:"Wisdom", 8:"Power", 9:"Completion",
  };

  for (let i = 0; i < 9; i++) {
    const n = i + 1;
    const col = i % 3, row = Math.floor(i / 3);
    const x = startX + col * (cellSize + gap);
    const y = startY + row * (cellSize + gap);
    const isLP = n === lp, isHL = highlighted.has(n);

    const bg: [number,number,number] = isLP ? [201,168,76] : isHL ? [42,18,85] : [20,12,40];
    doc.rect(x, y, cellSize, cellSize).fill(bg);

    // Border
    const borderColor: [number,number,number] = isLP ? [201,168,76] : isHL ? [201,168,76] : [59,18,96];
    doc.rect(x, y, cellSize, cellSize).fillOpacity(0).strokeColor(borderColor).fillOpacity(0).lineWidth(isHL ? 1.2 : 0.5).stroke();
    doc.fillOpacity(1);

    // Number
    const numColor: [number,number,number] = isLP ? [26,5,51] : isHL ? [201,168,76] : [91,74,122];
    doc.fillColor(numColor).font("Helvetica-Bold").fontSize(30)
      .text(String(n), x, y + cellSize * 0.2, { width: cellSize, align:"center" });

    // Label
    const lblColor: [number,number,number] = isLP ? [26,5,51] : isHL ? [201,168,76] : [91,74,122];
    doc.fillColor(lblColor).fillOpacity(isLP ? 0.7 : 0.55).font("Helvetica").fontSize(8)
      .text(meanings[n]!, x, y + cellSize * 0.65, { width: cellSize, align:"center" });
    doc.fillOpacity(1);
  }

  // Caption
  doc.fillColor([201,168,76]).fillOpacity(0.7).font("Helvetica-Bold").fontSize(10)
    .text(`Life Path ${order.lifePath ?? "7"} — highlighted in gold above`, SAFE, startY + 3 * (cellSize + gap) + 20, { width: PAGE_W - SAFE*2, align:"center" });
  if (order.luckyNumbers) {
    doc.fillColor([184,159,212]).fillOpacity(0.65).font("Helvetica").fontSize(9)
      .text(`Lucky Numbers: ${order.luckyNumbers}`, SAFE, startY + 3*(cellSize+gap) + 38, { width: PAGE_W - SAFE*2, align:"center" });
  }
  doc.fillOpacity(1);
}

/** Lucky numbers circular display */
function addLuckyNumbersPage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill([6, 10, 24]);

  const nums = (order.luckyNumbers ?? "3, 7, 11, 22").split(",").map((n) => n.trim()).slice(0, 7);
  const cx = PAGE_W / 2, cy = PAGE_H / 2;

  // Header
  doc.fillColor([201,168,76]).fillOpacity(0.55).font("Helvetica").fontSize(7)
    .text("NUMEROLOGY", SAFE, SAFE + 10, { width: PAGE_W - SAFE*2, align:"center", characterSpacing: 2 });
  doc.fillColor([255,255,255]).fillOpacity(0.9).font("Helvetica-Bold").fontSize(14)
    .text("Your Lucky Numbers", SAFE, SAFE + 24, { width: PAGE_W - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  // Orbit rings
  for (const r of [55, 90, 130]) {
    doc.circle(cx, cy, r).fillOpacity(0).strokeColor([201,168,76]).lineWidth(0.4).fillOpacity(0).stroke();
    doc.fillOpacity(1);
  }

  // Center
  doc.circle(cx, cy, 28).fill([18, 8, 42]);
  doc.fillColor([201,168,76]).fillOpacity(0.55).font("Helvetica").fontSize(8)
    .text("Your", cx - 14, cy - 10, { width: 28, align:"center" });
  doc.fillColor([201,168,76]).fillOpacity(0.55).font("Helvetica").fontSize(8)
    .text("Numbers", cx - 14, cy + 1, { width: 28, align:"center" });
  doc.fillOpacity(1);

  // Number bubbles
  for (let i = 0; i < nums.length; i++) {
    const angle = ((i * (360 / nums.length)) - 90) * (Math.PI / 180);
    const dist = i % 2 === 0 ? 130 : 92;
    const bx = cx + dist * Math.cos(angle);
    const by = cy + dist * Math.sin(angle);
    const isPrimary = i === 0;
    const br = isPrimary ? 25 : 19;

    // Connecting line
    doc.moveTo(cx, cy).lineTo(bx, by).strokeColor([201,168,76]).lineWidth(0.5).fillOpacity(0).stroke();
    doc.fillOpacity(1);

    // Bubble
    if (isPrimary) {
      doc.circle(bx, by, br).fill([201,168,76]);
      doc.fillColor([26,5,51]).font("Helvetica-Bold").fontSize(20)
        .text(nums[i]!, bx - br, by - 11, { width: br*2, align:"center" });
    } else {
      doc.circle(bx, by, br).fill([21,12,52]);
      doc.circle(bx, by, br).fillOpacity(0).strokeColor([201,168,76]).lineWidth(1).stroke();
      doc.fillOpacity(1);
      doc.fillColor([201,168,76]).font("Helvetica-Bold").fontSize(16)
        .text(nums[i]!, bx - br, by - 9, { width: br*2, align:"center" });
    }
  }

  // Stars
  const stars = "✦";
  for (let i = 0; i < 12; i++) {
    const sx = SAFE + (i * 89 % (PAGE_W - SAFE*2));
    const sy = PAGE_H * 0.07 + (i * 67 % (PAGE_H * 0.85));
    doc.fillColor([201,168,76]).fillOpacity(0.06 + (i%5)*0.02).font("Helvetica").fontSize(8)
      .text(stars, sx, sy);
  }
  doc.fillOpacity(1);
}

/** Monthly forecast grid (all 12 months) */
function addMonthlyForecastPage(doc: PDFKit.PDFDocument, order: ZodiacOrder, content: string) {
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill([250,247,255]);

  // Header
  doc.fillColor([59,18,96]).fillOpacity(0.45).font("Helvetica").fontSize(7)
    .text("YOUR YEAR AHEAD", SAFE, SAFE + 10, { width: PAGE_W - SAFE*2, align:"center", characterSpacing: 2 });
  doc.fillColor([30,27,46]).fillOpacity(0.9).font("Helvetica-Bold").fontSize(13)
    .text("Month-by-Month Guidance", SAFE, SAFE + 24, { width: PAGE_W - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  const forecasts = parseMonthForecasts(content);
  const cellW = (PAGE_W - SAFE*2 - 8) / 3;
  const cellH = (PAGE_H - SAFE*2 - 55) / 4;
  const startY = SAFE + 48;

  for (let i = 0; i < 12; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = SAFE + col * (cellW + 4);
    const y = startY + row * (cellH + 4);
    const [cr, cg, cb] = MONTH_COLORS[i]!;

    // Cell background
    doc.rect(x, y, cellW, cellH).fill([cr*0.08+242, cg*0.08+242, cb*0.08+242] as [number,number,number]);

    // Left accent stripe
    doc.rect(x, y, 3, cellH).fill([cr, cg, cb]);

    // Month name
    doc.fillColor([cr, cg, cb]).font("Helvetica-Bold").fontSize(8)
      .text(MONTH_NAMES[i]!.slice(0,3).toUpperCase(), x + 8, y + 6, { width: cellW - 12 });

    // Forecast text (truncated)
    const text = forecasts[i] ?? "";
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const first = sentences.slice(0, 2).join(" ");
    const second = sentences.slice(2).join(" ");
    doc.fillColor([30,27,46]).fillOpacity(0.55).font("Helvetica").fontSize(7.5)
      .text(first, x + 8, y + 18, {
        width: cellW - 14, height: cellH - 18, lineGap: 2.2, ellipsis: false,
      });
    if (second) {
      doc.fillColor([30,27,46]).fillOpacity(0.42).font("Helvetica").fontSize(7.1)
        .text(second, x + 8, y + 18 + doc.heightOfString(first, { width: cellW - 14, lineGap: 2.2 }) + 4, {
          width: cellW - 14, height: cellH - 34, lineGap: 2, ellipsis: false,
        });
    }
    doc.fillOpacity(1);
  }
}

/** Planet grid page */
function addPlanetGridPage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill([8, 12, 28]);

  const planets = [
    { symbol:"☉", name:"Sun",     sign: order.sunSign   ?? "?", r:212, g:160, b:23 },
    { symbol:"☽", name:"Moon",    sign: order.moonSign  ?? "?", r:128, g:144, b:200 },
    { symbol:"↑",  name:"Rising",  sign: order.risingSign ?? "?", r:112, g:184, b:128 },
    { symbol:"♂", name:"Mars",    sign:"Aries",      r:232, g:93,  b:93 },
    { symbol:"♀", name:"Venus",   sign:"Libra",      r:244, g:160, b:192 },
    { symbol:"☿", name:"Mercury", sign:"Gemini",     r:96,  g:200, b:216 },
    { symbol:"♃", name:"Jupiter", sign:"Sagittarius",r:208, g:160, b:80 },
    { symbol:"♄", name:"Saturn",  sign:"Capricorn",  r:152, g:136, b:176 },
    { symbol:"♆", name:"Neptune", sign:"Pisces",     r:96,  g:128, b:224 },
  ];

  doc.fillColor([201,168,76]).fillOpacity(0.55).font("Helvetica").fontSize(7)
    .text("PLANETARY INFLUENCES", SAFE, SAFE + 10, { width: PAGE_W - SAFE*2, align:"center", characterSpacing: 2 });
  doc.fillColor([255,255,255]).fillOpacity(0.9).font("Helvetica-Bold").fontSize(13)
    .text("Your Celestial Assembly", SAFE, SAFE + 24, { width: PAGE_W - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  const cellW = (PAGE_W - SAFE*2 - 8) / 3;
  const cellH = (PAGE_H - SAFE*2 - 55) / 3;
  const startY = SAFE + 48;

  for (const [i, planet] of planets.entries()) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = SAFE + col * (cellW + 4);
    const y = startY + row * (cellH + 4);
    const { r: pr, g: pg, b: pb } = planet;

    // Cell background
    doc.rect(x, y, cellW, cellH).fill([pr*0.07+6, pg*0.07+8, pb*0.07+22] as [number,number,number]);
    doc.rect(x, y, cellW, cellH).fillOpacity(0).strokeColor([pr, pg, pb]).lineWidth(0.5).fillOpacity(0).stroke();
    doc.fillOpacity(1);

    // Symbol
    doc.fillColor([pr, pg, pb]).font("Helvetica").fontSize(24)
      .text(planet.symbol, x, y + cellH * 0.1, { width: cellW, align:"center" });

    // Name
    doc.fillColor([pr, pg, pb]).fillOpacity(0.85).font("Helvetica-Bold").fontSize(8)
      .text(planet.name.toUpperCase(), x, y + cellH * 0.5, { width: cellW, align:"center", characterSpacing: 1 });

    // Sign
    const symStr = ZODIAC_SYMBOLS[planet.sign] ?? "";
    doc.fillColor([pr, pg, pb]).fillOpacity(0.5).font("Helvetica").fontSize(8)
      .text(`${symStr} ${planet.sign}`, x, y + cellH * 0.68, { width: cellW, align:"center" });
    doc.fillOpacity(1);
  }
}

/** Wellness wheel (text-based version for PDF) */
function addWellnessPage(doc: PDFKit.PDFDocument, order: ZodiacOrder) {
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill([4, 26, 18]);

  const cats = [
    { label:"Movement",  icon:"◎", color:[109,204,170] as [number,number,number], desc:`Physical practices aligned with ${order.sunSign ?? "your sign"}'s nature` },
    { label:"Nutrition",  icon:"✦", color:[144,200,96] as [number,number,number],  desc:"Nourishment and seasonal eating wisdom" },
    { label:"Sleep",      icon:"☽", color:[80,136,200] as [number,number,number],  desc:"Rest rhythms and lunar cycle practices" },
    { label:"Mindset",    icon:"◇", color:[176,143,223] as [number,number,number], desc:"Thought patterns and mental energy maintenance" },
    { label:"Breath",     icon:"〜", color:[80,184,208] as [number,number,number],  desc:"Breathwork and energetic clearing techniques" },
    { label:"Sacred Time",icon:"✿", color:[212,160,23] as [number,number,number],  desc:"Daily rituals and restorative practices" },
  ];

  doc.fillColor([109,204,170]).fillOpacity(0.55).font("Helvetica").fontSize(7)
    .text("HEALTH", SAFE, SAFE + 10, { width: PAGE_W - SAFE*2, align:"center", characterSpacing: 2 });
  doc.fillColor([255,255,255]).fillOpacity(0.9).font("Helvetica-Bold").fontSize(13)
    .text("Your Wellness Blueprint", SAFE, SAFE + 24, { width: PAGE_W - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  // Central sign info
  doc.fillColor([109,204,170]).fillOpacity(0.7).font("Helvetica-BoldOblique").fontSize(10)
    .text(`${order.sunSign ?? "Your Sign"} · ${order.moonSign ?? ""} Moon · ${order.risingSign ?? ""} Rising`, SAFE, SAFE + 44, { width: PAGE_W - SAFE*2, align:"center" });
  doc.fillOpacity(1);

  const itemH = (PAGE_H - SAFE*2 - 72) / 6;
  const startY = SAFE + 66;
  const barW = PAGE_W - SAFE*2;

  for (const [i, cat] of cats.entries()) {
    const y = startY + i * itemH;
    const [cr, cg, cb] = cat.color;

    // Background strip
    doc.rect(SAFE, y, barW, itemH - 4).fill([cr*0.06+3, cg*0.06+22, cb*0.06+14] as [number,number,number]);

    // Left color stripe
    doc.rect(SAFE, y, 4, itemH - 4).fill([cr, cg, cb]);

    // Icon + label
    doc.fillColor([cr, cg, cb]).font("Helvetica-Bold").fontSize(10)
      .text(`${cat.icon}  ${cat.label}`, SAFE + 14, y + 6, { width: 110 });

    // Description
    doc.fillColor([255,255,255]).fillOpacity(0.42).font("Helvetica-Oblique").fontSize(8)
      .text(cat.desc, SAFE + 130, y + 7, { width: barW - 140, height: itemH - 10, lineGap: 2.1, ellipsis: false });
    doc.fillOpacity(1);
  }
}

// ─── Interior PDF ─────────────────────────────────────────────────────────────

import { generateTemplatedInteriorPDF } from "./templatedPdf";

/**
 * Builds the interior PDF by merging the designer-supplied templates in
 * `artifacts/book-templates/` with the AI-generated chapter prose.
 *
 * The legacy pdfkit-from-scratch implementation lives below as
 * `generateInteriorPDFLegacy` — kept as a fallback for now.
 */
export function generateInteriorPDF(order: ZodiacOrder, content: string, options?: { maxPages?: number }): Promise<Buffer> {
  return generateTemplatedInteriorPDF(order, content, options);
}

async function generateInteriorPDFLegacy(order: ZodiacOrder, content: string, options?: { maxPages?: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margins: { top: SAFE, bottom: SAFE, left: SAFE, right: SAFE },
      autoFirstPage: false,
      info: {
        Title: `Holistic Growth Life Path — ${order.fullName}`,
        Author: "Holigrowth",
        Subject: "Personalized Astrology & Numerology Book",
      },
    });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Page 1: Title page ─────────────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(hexToRgb(BRAND.deepPurple));
    doc.rect(0, 0, PAGE_W, PAGE_H * 0.08).fill(hexToRgb(BRAND.purple));

    pdfColor(doc, BRAND.gold);
    doc.font("Helvetica").fontSize(8).text("HOLIGROWTH · HOLISTIC GROWTH LIFE PATH", SAFE, PAGE_H * 0.12, {
      align:"center", width: PAGE_W - SAFE*2, characterSpacing: 2,
    });

    pdfColor(doc, BRAND.gold);
    doc.fontSize(22).text("☽  ✦  ☉", SAFE, PAGE_H * 0.22, { align:"center", width: PAGE_W - SAFE*2 });

    pdfColor(doc, BRAND.offWhite);
    doc.font("Helvetica-Bold").fontSize(22).text("Your Personal Life Path Book", SAFE, PAGE_H * 0.33, {
      align:"center", width: PAGE_W - SAFE*2,
    });

    pdfColor(doc, "#d4b8f0");
    doc.font("Helvetica-Oblique").fontSize(12).text("A Holistic Growth Life Path Book Crafted for", SAFE, PAGE_H * 0.52, {
      align:"center", width: PAGE_W - SAFE*2,
    });

    pdfColor(doc, BRAND.gold);
    doc.font("Helvetica-BoldOblique").fontSize(20).text(order.fullName, SAFE, PAGE_H * 0.58, {
      align:"center", width: PAGE_W - SAFE*2,
    });

    pdfColor(doc, "#b89fd4");
    doc.font("Helvetica").fontSize(9).text(
      `Born ${order.birthday}  ·  ${order.birthTime}\n${order.birthLocation}`,
      SAFE, PAGE_H * 0.68,
      { align:"center", width: PAGE_W - SAFE*2, lineGap: 3 }
    );

    // ── Pages 2–4: Visual showcase (zodiac, moon, birthplace) ──────────────
    // Mirrors the web preview's first-5-pages flow so the printed book opens
    // on the same visual sequence customers see online.
    addZodiacSplashPage(doc, order);
    addMoonPhasePage(doc, order);
    addBirthplacePage(doc, order);

    // ── Page 5: Dedication ─────────────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(hexToRgb(BRAND.cream));

    pdfColor(doc, BRAND.muted);
    doc.font("Helvetica").fontSize(8).text("Dedicated to", SAFE, PAGE_H * 0.22, {
      align:"center", width: PAGE_W - SAFE*2, characterSpacing: 2,
    });
    pdfColor(doc, BRAND.purple);
    doc.font("Helvetica-BoldOblique").fontSize(20).text(order.fullName, SAFE, PAGE_H * 0.3, {
      align:"center", width: PAGE_W - SAFE*2,
    });

    doc.moveTo(PAGE_W * 0.35, PAGE_H * 0.42).lineTo(PAGE_W * 0.65, PAGE_H * 0.42)
      .strokeColor(hexToRgb(BRAND.gold)).lineWidth(0.6).stroke();

    pdfColor(doc, BRAND.muted);
    doc.font("Helvetica-Oblique").fontSize(10).text(
      '"The cosmos inscribed your destiny in stars before you drew your first breath. This book is the reading of that ancient script — written for you, and only you."',
      SAFE + 20, PAGE_H * 0.46,
      { align:"center", width: PAGE_W - SAFE*2 - 40, lineGap: 4 }
    );

    if (order.birthday) {
      pdfColor(doc, BRAND.muted);
      doc.font("Helvetica").fontSize(8).text(
        `${order.birthday}  ·  ${order.birthTime}\n${order.birthLocation}`,
        SAFE, PAGE_H * 0.64,
        { align:"center", width: PAGE_W - SAFE*2, lineGap: 3 }
      );
    }

    // ── Page 6: Table of Contents ──────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(hexToRgb(BRAND.cream));

    pdfColor(doc, BRAND.purple);
    doc.font("Helvetica-Bold").fontSize(16).text("Contents", SAFE, SAFE + 4, {
      align:"center", width: PAGE_W - SAFE*2,
    });
    doc.moveTo(SAFE*2, SAFE + 28).lineTo(PAGE_W - SAFE*2, SAFE + 28)
      .strokeColor(hexToRgb(BRAND.gold)).lineWidth(0.75).stroke();

    const tocChapters = [
      ["1", "Your Life Path — The Overview"],
      ["2", `Your Sun Sign — ${order.sunSign ?? "Your Sun"}`],
      ["3", `Your Moon Sign — ${order.moonSign ?? "Your Moon"}`],
      ["4", `Your Rising Sign — ${order.risingSign ?? "Your Rising"}`],
      ["5", "Love & Relationships (Pillar I)"],
      ["6", "Wealth & Abundance (Pillar II)"],
      ["7", "Health & Vitality (Pillar III)"],
      ["8", "Your Lucky Numbers"],
      ["9", "Planetary Influences"],
      ["10", "Your Daily Mantras"],
      ["11", "Your Sacred Morning Ritual"],
      ["12", "Your Year Ahead — Month by Month"],
    ];
    let tocY = SAFE + 40;
    for (const [num, title] of tocChapters) {
      pdfColor(doc, BRAND.gold);
      doc.font("Helvetica-Bold").fontSize(8).text(num, SAFE + 10, tocY, { width: 16 });
      pdfColor(doc, BRAND.text);
      doc.font("Helvetica").fontSize(9).text(title, SAFE + 30, tocY, { width: PAGE_W - SAFE*2 - 30 });
      tocY += 18;
    }

    if (order.luckyNumbers) {
      doc.moveTo(SAFE + 10, tocY + 6).lineTo(PAGE_W - SAFE - 10, tocY + 6)
        .strokeColor(hexToRgb(BRAND.cream)).lineWidth(0.4).stroke();
      pdfColor(doc, BRAND.muted);
      doc.font("Helvetica").fontSize(8)
        .text(`Life Path ${order.lifePath}  ·  Lucky Numbers: ${order.luckyNumbers}`, SAFE, tocY + 12, {
          align:"center", width: PAGE_W - SAFE*2,
        });
    }

    // ── Content pages with visual inserts ─────────────────────────────────
    const parsed = parseMarkdown(content);
    const contentW = PAGE_W - SAFE * 2;
    const maxY = PAGE_H - SAFE;
    let currentY = SAFE;
    let chapterCount = 0;
    const contentStr = content;

    let pagesAdded = 6; // title + zodiac + moon + birthplace + dedication + TOC already added
    let limitReached = false;

    const startNewPage = (bgHex: string = BRAND.offWhite) => {
      if (options?.maxPages !== undefined && pagesAdded >= options.maxPages) {
        limitReached = true;
        return;
      }
      pagesAdded++;
      doc.addPage();
      doc.rect(0, 0, PAGE_W, PAGE_H).fill(hexToRgb(bgHex));
      doc.moveTo(SAFE, SAFE + 14).lineTo(PAGE_W - SAFE, SAFE + 14)
        .strokeColor(hexToRgb(BRAND.cream)).lineWidth(0.4).stroke();
      currentY = SAFE + 22;
    };

    startNewPage();

    for (const node of parsed) {
      if (limitReached) break;
      if (node.type === "br") {
        currentY += 6;
        continue;
      }

      if (node.type === "h1") {
        chapterCount++;

        // Insert visual pages at specific chapter boundaries
        // (Zodiac splash, moon phase, and birthplace now live in the front
        // matter — pages 2–4 — so they don't get re-inserted here.)
        if (chapterCount === 2) { addBirthChartPage(doc, order); }
        if (chapterCount === 5) { addPillarCoverPage(doc, "relationships", order); addSigilInterpretationPage(doc, "relationships", order); }
        if (chapterCount === 6) { addPillarCoverPage(doc, "wealth", order); addSigilInterpretationPage(doc, "wealth", order); }
        if (chapterCount === 7) { addPillarCoverPage(doc, "health", order); addSigilInterpretationPage(doc, "health", order); }

        startNewPage();

        const CHAPTER_BG_COLORS: Record<number,[number,number,number]> = {
          1:[14,22,36], 2:[20,14,0], 3:[26,10,20], 4:[10,26,20],
          5:[42,8,21], 6:[26,16,0], 7:[4,26,18],
          8:[16,8,32], 9:[0,20,32], 10:[14,0,24],
          11:[16,26,8], 12:[26,8,8],
        };
        const chapBg = CHAPTER_BG_COLORS[chapterCount] ?? [14,22,36];

        doc.rect(SAFE - 8, currentY - 4, contentW + 16, 38).fill(chapBg);

        const chapterAccents: Record<number,string> = {
          1:"#c9a84c", 2:"#d4a017", 3:"#e87a9c", 4:"#6dccaa",
          5:"#f4a0c0", 6:"#d4a017", 7:"#6dccaa",
          8:"#c878f0", 9:"#50b8d0", 10:"#d0a0d0",
          11:"#90c860", 12:"#e06060",
        };
        const accent = chapterAccents[chapterCount] ?? BRAND.gold;

        pdfColor(doc, "#7a6898");
        doc.font("Helvetica").fontSize(7)
          .text(`Chapter ${chapterCount}`, SAFE, currentY, { width: contentW });

        doc.fillColor(hexToRgb(accent)).font("Helvetica-Bold").fontSize(14)
          .text(node.text, SAFE, currentY + 10, { width: contentW, align:"center" });
        currentY += 52;

        doc.moveTo(SAFE * 2, currentY).lineTo(PAGE_W - SAFE * 2, currentY)
          .strokeColor(hexToRgb(accent)).lineWidth(0.8).stroke();
        currentY += 12;
        continue;
      }

      if (node.type === "h2") {
        if (currentY + 50 > maxY - 18) startNewPage();
        pdfColor(doc, BRAND.purple);
        doc.font("Helvetica-Bold").fontSize(12).text(node.text, SAFE, currentY, { width: contentW });
        currentY += doc.currentLineHeight() + 6;
        continue;
      }

      if (node.type === "h3") {
        if (currentY + 30 > maxY - 18) startNewPage();
        pdfColor(doc, "#5c2d91");
        doc.font("Helvetica-BoldOblique").fontSize(10.5).text(node.text, SAFE, currentY, { width: contentW });
        currentY += doc.currentLineHeight() + 4;
        continue;
      }

      if (node.type === "p") {
        const estimatedLines = Math.ceil(node.text.length / 75);
        const estimatedH = estimatedLines * 14.5;
    if (currentY + estimatedH > maxY - 18) startNewPage();

        pdfColor(doc, BRAND.text);
        doc.font("Helvetica").fontSize(10.5).text(node.text, SAFE, currentY, {
          width: contentW, align:"justify", lineGap: 2.5,
        });
        currentY = doc.y + 9;

        if (currentY > PAGE_H * 0.72) {
          // Zodiac, moon, and birthplace are part of the front-matter
          // showcase — don't repeat them in this overflow filler.
          addBirthChartPage(doc, order);
          addPlanetGridPage(doc, order);
          addWellnessPage(doc, order);
          addLuckyNumbersPage(doc, order);
          addNumerologyPage(doc, order);
          addMonthlyForecastPage(doc, order, contentStr);
          currentY = SAFE + 22;
        }
        continue;
      }
    }

    // ── Post-content visual pages ──────────────────────────────────────────
    if (limitReached) { doc.end(); return; }

    // ── Lucky numbers back matter ──────────────────────────────────────────
    if (order.luckyNumbers) {
      doc.addPage();
      doc.rect(0, 0, PAGE_W, PAGE_H).fill(hexToRgb(BRAND.cream));

      pdfColor(doc, BRAND.purple);
      doc.font("Helvetica-Bold").fontSize(16).text("Your Lucky Numbers", SAFE, PAGE_H * 0.12, {
        align:"center", width: PAGE_W - SAFE*2,
      });

      const nums = order.luckyNumbers.split(",").map((n) => n.trim());
      const circleR = 20;
      const gap = 14;
      const total = nums.length * (circleR * 2 + gap) - gap;
      let cx2 = (PAGE_W - total) / 2 + circleR;

      for (const num of nums) {
        doc.circle(cx2, PAGE_H * 0.32 + circleR, circleR).fill(hexToRgb(BRAND.purple));
        pdfColor(doc, BRAND.gold);
        doc.font("Helvetica-Bold").fontSize(13).text(num, cx2 - circleR, PAGE_H * 0.32 + circleR - 7, {
          width: circleR * 2, align:"center",
        });
        cx2 += circleR * 2 + gap;
      }
    }

    // ── Closing page ───────────────────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PAGE_W, PAGE_H).fill(hexToRgb(BRAND.deepPurple));

    pdfColor(doc, BRAND.gold);
    doc.font("Helvetica").fontSize(14).text("✦", SAFE, PAGE_H * 0.35, { align:"center", width: PAGE_W - SAFE*2 });

    pdfColor(doc, "#d4b8f0");
    doc.font("Helvetica-Oblique").fontSize(10).text(
      `This book was created with love for ${order.fullName}.\nMay it illuminate your path and remind you of your unique cosmic gifts.`,
      SAFE + 20, PAGE_H * 0.44,
      { align:"center", width: PAGE_W - SAFE*2 - 40, lineGap: 5 }
    );

    pdfColor(doc, BRAND.muted);
    doc.font("Helvetica").fontSize(7).text("Holigrowth Press · holigrowth.com", SAFE, PAGE_H * 0.65, {
      align:"center", width: PAGE_W - SAFE*2,
    });

    doc.end();
  });
}

// ─── Cover PDF ────────────────────────────────────────────────────────────────

import { buildHardcoverWrap } from "./templatedPdf/render";

/**
 * Builds the hardcover case-wrap PDF that prints around the outside of the
 * hardback book. Primary path is `buildHardcoverWrap` (the templated wrap
 * driven by `00-hardcover-editable.pdf` — fills BOOK_TITLE, READER_FIRST_NAME,
 * BIRTH_PLACE, DATE_OF_BIRTH, FULL_NAME widgets onto the designer artwork).
 *
 * `pageCount` is currently unused by the templated path because the wrap PDF
 * is delivered at a fixed total size (14 × 10.75 in = 1008 × 774 pt) with
 * the spine width baked into the template artwork by the designer. The Lulu
 * pod package this targets (`0600X0900FCSTDHC060CW444GXX`) has a minimum
 * hardcover spine width determined by the board thickness, not the linear
 * `pageCount / 444` paperback formula — see
 * artifacts/book-templates/README.md ("Hardcover wrap") for the print spec.
 * The legacy pdfkit-from-scratch path (`generateCoverPDFLegacy`) is kept
 * for diagnostic comparison and computes the spine dynamically.
 */
export async function generateCoverPDF(order: ZodiacOrder, pageCount: number): Promise<Buffer> {
  void pageCount; // unused — see docblock above
  return buildHardcoverWrap(order);
}

async function generateCoverPDFLegacy(order: ZodiacOrder, pageCount: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    // US Trade 6" × 9" hardcover case wrap
    // Paper: 60# white uncoated  Spine: pages / 444 in (Lulu formula for 60# uncoated)
    const SPINE_IN = pageCount / 444;
    const SPINE_PT = SPINE_IN * PT;
    const BLEED  = 0.125 * PT;
    const WRAP   = 0.75  * PT;
    const TRIM_W = 6.0   * PT;   // 432 pt
    const TRIM_H = 9.0   * PT;   // 648 pt

    const COVER_W = BLEED + WRAP + TRIM_W + SPINE_PT + TRIM_W + WRAP + BLEED;
    const COVER_H = BLEED + WRAP + TRIM_H + WRAP + BLEED;

    const backStart  = BLEED + WRAP;
    const spineStart = backStart + TRIM_W;
    const frontStart = spineStart + SPINE_PT;
    const frontEnd   = frontStart + TRIM_W;
    const contentTop = BLEED + WRAP;
    const contentBottom = contentTop + TRIM_H;

    const doc = new PDFDocument({
      size: [COVER_W, COVER_H],
      margins: { top:0, bottom:0, left:0, right:0 },
      autoFirstPage: false,
      info: { Title:`Cover — ${order.fullName}`, Author:"Holigrowth" },
    });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.addPage();

    // Full-bleed background
    doc.rect(0, 0, COVER_W, COVER_H).fill(hexToRgb(BRAND.deepPurple));
    doc.rect(0, 0, COVER_W, COVER_H * 0.35).fill(hexToRgb(BRAND.purple));
    doc.rect(0, COVER_H * 0.65, COVER_W, COVER_H * 0.35).fill(hexToRgb(BRAND.purple));

    // ── Back cover ─────────────────────────────────────────────────────────
    pdfColor(doc, BRAND.gold);
    doc.font("Helvetica").fontSize(7).text("HOLIGROWTH", backStart + 16, contentTop + 20, {
      width: TRIM_W - 32, align:"center", characterSpacing: 3,
    });

    pdfColor(doc, "#d4b8f0");
    doc.font("Helvetica-Oblique").fontSize(9.5).text(
      "This personalized book was created using the ancient wisdom\nof astrology and numerology to illuminate your unique cosmic path.",
      backStart + 24, contentTop + 50,
      { width: TRIM_W - 48, align:"center", lineGap: 4 }
    );

    const profile = [
      order.sunSign    ? `☉ Sun: ${order.sunSign}` : null,
      order.moonSign   ? `☽ Moon: ${order.moonSign}` : null,
      order.risingSign ? `↑ Rising: ${order.risingSign}` : null,
      order.lifePath   ? `✦ Life Path: ${order.lifePath}` : null,
    ].filter(Boolean) as string[];

    if (profile.length > 0) {
      pdfColor(doc, BRAND.gold);
      doc.font("Helvetica-Bold").fontSize(8.5).text("Your Cosmic Profile", backStart + 24, contentTop + 140, {
        width: TRIM_W - 48, align:"center",
      });
      pdfColor(doc, "#d4b8f0");
      doc.font("Helvetica").fontSize(8.5).text(profile.join("\n"), backStart + 24, contentTop + 158, {
        width: TRIM_W - 48, align:"center", lineGap: 5,
      });
    }

    doc.rect(backStart + TRIM_W/2 - 28, contentBottom - 68, 56, 40).fill(hexToRgb("#ffffff"));
    pdfColor(doc, BRAND.muted);
    doc.font("Helvetica").fontSize(6).text("ISBN / Barcode", backStart + TRIM_W/2 - 28, contentBottom - 24, {
      width: 56, align:"center",
    });

    // ── Spine ──────────────────────────────────────────────────────────────
    if (SPINE_PT > 18) {
      doc.rect(spineStart, 0, SPINE_PT, COVER_H).fill(hexToRgb(BRAND.purple));
      doc.save();
      doc.translate(spineStart + SPINE_PT / 2, COVER_H / 2);
      doc.rotate(-90);
      pdfColor(doc, BRAND.gold);
      doc.font("Helvetica-Bold").fontSize(7).text("HOLISTIC GROWTH LIFE PATH", -80, -3, {
        width: 160, align:"center", characterSpacing: 1,
      });
      doc.restore();

      for (const xOff of [1, SPINE_PT - 1]) {
        doc.moveTo(spineStart + xOff, BLEED).lineTo(spineStart + xOff, COVER_H - BLEED)
          .strokeColor(hexToRgb(BRAND.gold)).lineWidth(0.5).stroke();
      }
    }

    // ── Front cover ────────────────────────────────────────────────────────
    pdfColor(doc, BRAND.gold);
    doc.font("Helvetica").fontSize(7).text("HOLIGROWTH", frontStart + 16, contentTop + 20, {
      width: TRIM_W - 32, align:"center", characterSpacing: 3,
    });
    doc.fontSize(20).text("☽  ✦  ☉", frontStart + 16, contentTop + 44, {
      width: TRIM_W - 32, align:"center",
    });

    pdfColor(doc, BRAND.offWhite);
    doc.font("Helvetica-Bold").fontSize(26).text("Your Personal\nLife Path Book", frontStart + 24, contentTop + 90, {
      width: TRIM_W - 48, align:"center", lineGap: 7,
    });

    doc.moveTo(frontStart + TRIM_W * 0.15, contentTop + 168).lineTo(frontEnd - TRIM_W * 0.15, contentTop + 168)
      .strokeColor(hexToRgb(BRAND.gold)).lineWidth(0.75).stroke();

    pdfColor(doc, "#d4b8f0");
    doc.font("Helvetica-Oblique").fontSize(11).text("A Holistic Growth Life Path Book Crafted for", frontStart + 16, contentTop + 180, {
      width: TRIM_W - 32, align:"center",
    });

    pdfColor(doc, BRAND.gold);
    doc.font("Helvetica-BoldOblique").fontSize(19).text(order.fullName, frontStart + 16, contentTop + 202, {
      width: TRIM_W - 32, align:"center",
    });

    pdfColor(doc, "#b89fd4");
    doc.font("Helvetica").fontSize(8.5).text(
      `Born ${order.birthday}  ·  ${order.birthTime}\n${order.birthLocation}`,
      frontStart + 16, contentTop + 238,
      { width: TRIM_W - 32, align:"center", lineGap: 3 }
    );

    pdfColor(doc, BRAND.gold);
    doc.font("Helvetica").fontSize(7.5).text("RELATIONSHIPS  ·  WEALTH  ·  HEALTH", frontStart + 16, contentBottom - 52, {
      width: TRIM_W - 32, align:"center", characterSpacing: 1,
    });

    doc.moveTo(frontStart + 16, contentBottom - 36).lineTo(frontEnd - 16, contentBottom - 36)
      .strokeColor(hexToRgb(BRAND.gold)).lineWidth(0.5).stroke();

    doc.end();
  });
}

/** Estimates page count for a given content string, clamped to 40–60 pages. */
export function estimatePageCount(content: string): number {
  const wordCount = content.split(/\s+/).length;
  // ~250 words per content page + visual pages (~25 inserts: zodiac splash, natal chart, moon phase, 3 pillar covers + 3 sigil interpretation pages + 3 year-ahead pages, numerology, lucky numbers, wellness, planets, monthly, affirmations, closing)
  const estimated = Math.round(wordCount / 250) + 25;
  return Math.min(72, Math.max(46, estimated));
}
