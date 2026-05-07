import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sun, Moon, Star, Hash, Gift, Copy, Check, ExternalLink,
  Sparkles, Heart, Coins, Leaf, ArrowRight, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetReferral, getGetReferralQueryKey } from "@workspace/api-client-react";
import { useLocation, useParams } from "wouter";

const SIGN_EMOJIS: Record<string, string> = {
  Aries: "♈", Taurus: "♉", Gemini: "♊", Cancer: "♋",
  Leo: "♌", Virgo: "♍", Libra: "♎", Scorpio: "♏",
  Sagittarius: "♐", Capricorn: "♑", Aquarius: "♒", Pisces: "♓",
};

const PILLARS = [
  { icon: Heart,  label: "Relationships", desc: "Soul connections, love timing & compatibility blueprint" },
  { icon: Coins,  label: "Wealth",        desc: "Financial destiny, abundance windows & lucky cycles" },
  { icon: Leaf,   label: "Health",        desc: "Vitality code, seasonal rhythms & body wisdom" },
];

function CosmicOrb({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      className="absolute rounded-full bg-[#c9a84c]/8 blur-[80px]"
      style={{ width: 300, height: 300 }}
      animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
      transition={{ repeat: Infinity, duration: 8 + delay, delay, ease: "easeInOut" }}
    />
  );
}

function StarField() {
  const stars = Array.from({ length: 28 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 1.5 + 0.5,
    delay: Math.random() * 4,
    duration: Math.random() * 3 + 2,
  }));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((s) => (
        <motion.div
          key={s.id}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size }}
          animate={{ opacity: [0.1, 0.7, 0.1] }}
          transition={{ repeat: Infinity, duration: s.duration, delay: s.delay }}
        />
      ))}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-[#0e1b2a] flex items-center justify-center">
      <div className="text-center">
        <motion.div
          className="w-16 h-16 rounded-full border-2 border-[#c9a84c]/30 border-t-[#c9a84c] mx-auto mb-4"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        />
        <p className="text-white/30 text-sm">Reading the stars…</p>
      </div>
    </div>
  );
}

function NotFoundPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-[#0e1b2a] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-5xl mb-4">✦</div>
        <h1 className="font-serif text-2xl text-white mb-2">Referral not found</h1>
        <p className="text-white/40 text-sm mb-8">This invite link may be invalid or expired.</p>
        <Button
          onClick={() => setLocation("/")}
          className="bg-[#c9a84c] hover:bg-[#b8953e] text-[#0e1b2a] font-semibold rounded-xl px-6"
        >
          Explore Your Life Path →
        </Button>
      </div>
    </div>
  );
}

export default function Invite() {
  const params = useParams<{ code: string }>();
  const code = params.code ?? "";
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError } = useGetReferral(code, {
    query: { enabled: !!code, retry: false, queryKey: getGetReferralQueryKey(code) },
  });

  // Store ref code in sessionStorage so it persists through /create flow
  useEffect(() => {
    if (code) sessionStorage.setItem("referralCode", code);
  }, [code]);

  const inviteUrl = typeof window !== "undefined" ? `${window.origin}/invite/${code}` : "";
  const createUrl = `/create?ref=${code}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGetBook = () => setLocation(createUrl);

  const twitterText = data
    ? encodeURIComponent(
        `${data.referrerName} just discovered their cosmic life path and gifted me ${data.discountPercent}% off a personalized astrology book! ✨ Get yours:`
      )
    : "";
  const twitterShare = `https://twitter.com/intent/tweet?text=${twitterText}&url=${encodeURIComponent(inviteUrl)}`;

  if (isLoading) return <LoadingSkeleton />;
  if (isError || !data) return <NotFoundPage />;

  const { referrerName, discountPercent, timesUsed, sunSign, moonSign, risingSign, lifePath, luckyNumbers } = data;

  const hasCosmic = sunSign || moonSign || risingSign;
  const signLine = [
    sunSign && `${SIGN_EMOJIS[sunSign] ?? ""} ${sunSign}`,
    moonSign && `${moonSign} Moon`,
    risingSign && `${risingSign} Rising`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-[#0e1b2a] text-white overflow-x-hidden relative">
      <StarField />

      {/* Ambient orbs */}
      <div className="absolute top-1/4 left-1/4 pointer-events-none">
        <CosmicOrb delay={0} />
      </div>
      <div className="absolute top-2/3 right-1/4 pointer-events-none">
        <CosmicOrb delay={3} />
      </div>

      {/* Header */}
      <header className="relative z-10 py-4 px-6 flex justify-center border-b border-white/8">
        <a href="/">
          <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-8 w-auto brightness-0 invert opacity-80" />
        </a>
      </header>

      <div className="relative z-10 max-w-lg mx-auto px-4 py-12 flex flex-col gap-10">

        {/* ── Hero ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="text-center"
        >
          {/* Discount badge */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 280 }}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-[#c9a84c]/35 bg-[#c9a84c]/12 mb-7"
          >
            <Gift className="w-4 h-4 text-[#c9a84c]" />
            <span className="text-[#c9a84c] font-semibold text-sm tracking-wide">
              {discountPercent}% off — gifted by {referrerName}
            </span>
          </motion.div>

          <h1 className="font-serif text-4xl md:text-5xl text-white leading-[1.1] mb-4">
            Your cosmic blueprint<br />
            <em className="text-[#e8dfc8] not-italic">awaits you</em>
          </h1>
          <p className="text-white/45 text-base max-w-sm mx-auto leading-relaxed">
            {referrerName} discovered their Holistic Growth Life Path and shared a private{" "}
            <span className="text-[#c9a84c] font-medium">{discountPercent}% discount</span>{" "}
            just for you — a personalised 40–50 page full-colour hardcover book written by the stars.
          </p>
        </motion.div>

        {/* ── Referrer's cosmic card ── */}
        {hasCosmic && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.6 }}
            className="rounded-2xl border border-white/10 bg-white/4 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-white/8">
              <p className="text-white/30 text-xs uppercase tracking-[0.2em]">
                {referrerName}'s cosmic profile
              </p>
            </div>
            <div className="p-5 space-y-3">
              {/* Signs row */}
              <div className="flex flex-wrap gap-2">
                {sunSign && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                    <Sun className="w-3 h-3 text-[#c9a84c]/70" />
                    <span className="text-white/40 text-xs">Sun</span>
                    <span className="text-white text-xs font-medium">{SIGN_EMOJIS[sunSign]} {sunSign}</span>
                  </div>
                )}
                {moonSign && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                    <Moon className="w-3 h-3 text-white/50" />
                    <span className="text-white/40 text-xs">Moon</span>
                    <span className="text-white text-xs font-medium">{SIGN_EMOJIS[moonSign]} {moonSign}</span>
                  </div>
                )}
                {risingSign && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                    <Star className="w-3 h-3 text-white/40" />
                    <span className="text-white/40 text-xs">Rising</span>
                    <span className="text-white text-xs font-medium">{SIGN_EMOJIS[risingSign]} {risingSign}</span>
                  </div>
                )}
              </div>

              {/* Life path & lucky numbers */}
              <div className="flex flex-wrap gap-3">
                {lifePath && (
                  <div className="flex items-center gap-2 text-sm">
                    <Hash className="w-3.5 h-3.5 text-[#c9a84c]/50" />
                    <span className="text-white/40 text-xs">Life Path</span>
                    <span className="text-[#c9a84c] font-bold">#{lifePath}</span>
                  </div>
                )}
                {luckyNumbers && (
                  <div className="flex items-center gap-2 text-sm">
                    <Sparkles className="w-3.5 h-3.5 text-[#c9a84c]/50" />
                    <span className="text-white/40 text-xs">Lucky</span>
                    <span className="text-[#c9a84c] font-semibold">{luckyNumbers}</span>
                  </div>
                )}
              </div>

              <p className="text-white/30 text-xs pt-1 italic">
                Every profile is unique — your book will be written entirely from your own birth data.
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Three pillars ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.6 }}
          className="space-y-3"
        >
          <p className="text-white/25 text-xs uppercase tracking-[0.2em] text-center mb-4">What's inside your book</p>
          {PILLARS.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-4 p-4 rounded-xl border border-white/8 bg-white/3">
              <div className="w-9 h-9 rounded-lg bg-[#c9a84c]/10 border border-[#c9a84c]/20 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-[#c9a84c]" />
              </div>
              <div>
                <p className="text-white font-medium text-sm mb-0.5">{label}</p>
                <p className="text-white/35 text-xs leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* ── CTA block ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.6 }}
          className="rounded-2xl border border-[#c9a84c]/20 bg-[#c9a84c]/5 p-6 text-center space-y-4"
        >
          <div>
            <p className="text-white font-serif text-xl mb-1">Claim your {discountPercent}% discount</p>
            <p className="text-white/40 text-sm">Enter your birth data and receive a 40–50 page personalised hardcover in 2–3 weeks.</p>
          </div>

          <Button
            onClick={handleGetBook}
            className="w-full h-13 text-base font-semibold bg-[#c9a84c] hover:bg-[#b8953e] text-[#0e1b2a] rounded-xl gap-2 shadow-lg shadow-[#c9a84c]/20"
            style={{ height: "3.25rem" }}
          >
            Get My Life Path Book
            <ArrowRight className="w-4 h-4" />
          </Button>

          <p className="text-white/20 text-xs">
            Your discount is applied automatically at checkout — no code needed.
          </p>

          {/* Social proof */}
          {timesUsed > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center gap-2 pt-1"
            >
              <Users className="w-3.5 h-3.5 text-white/25" />
              <span className="text-white/25 text-xs">
                {timesUsed} {timesUsed === 1 ? "person has" : "people have"} already used {referrerName}'s invite
              </span>
            </motion.div>
          )}
        </motion.div>

        {/* ── Share this invite ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="space-y-3"
        >
          <p className="text-white/25 text-xs uppercase tracking-[0.2em] text-center">Share this invite</p>

          <div className="flex items-center gap-2 p-3 rounded-xl border border-white/10 bg-white/4">
            <p className="flex-1 text-white/40 text-xs font-mono truncate min-w-0">
              {inviteUrl}
            </p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-white/60 hover:text-white transition-colors text-xs flex-shrink-0"
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex items-center gap-1.5 text-green-400">
                    <Check className="w-3.5 h-3.5" /> Copied!
                  </motion.span>
                ) : (
                  <motion.span key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>

          <a
            href={twitterShare}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 p-3 rounded-xl border border-white/10 bg-white/4 hover:bg-white/6 transition-colors text-white/50 hover:text-white/80 text-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.23H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share on X (Twitter)
            <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
          </a>
        </motion.div>

        {/* Footer */}
        <div className="text-center pb-4">
          <p className="text-white/15 text-xs">
            © {new Date().getFullYear()} Holistic Growth LLC ·{" "}
            <a href="mailto:hello@holigrowth.com" className="hover:text-white/30 transition-colors">
              hello@holigrowth.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
