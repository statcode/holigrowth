import { Link, useSearch } from "wouter";
import { motion, MotionConfig, type Variants } from "framer-motion";
import { Star, Sparkles, Heart, Coins, Leaf, CheckCircle, Gift, X, Truck, BookOpen, Flame, Package, Eye, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { useGetReferral, getGetReferralQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import heroWatercolor from "@assets/hero-watercolor.png";

// Variants intentionally degenerate — `hidden` and `visible` are identical
// so components using `initial="hidden" animate="visible"` render at their
// final state immediately. Combined with `MotionConfig isStatic` below,
// this kills both transform and opacity animation on the entire homepage.
const fadeIn: Variants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};

const stagger: Variants = {
  visible: {},
};

function StarRating({ count = 5 }: { count?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

function ReferralBanner({ code }: { code: string }) {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useGetReferral(code, {
    query: { enabled: !!code, retry: false, queryKey: getGetReferralQueryKey(code) },
  });

  if (!data || dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 1, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-primary text-primary-foreground px-4 py-3 relative"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-center gap-3 text-sm pr-8">
        <Gift className="w-4 h-4 shrink-0 text-accent" />
        <p>
          <span className="font-semibold">{data.referrerName}</span> gifted you{" "}
          <span className="font-semibold text-accent">{data.discountPercent}% off</span> your Holistic Growth Life Path book.
          {" "}Your discount will be applied at checkout.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-primary-foreground/60 hover:text-primary-foreground"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

export default function Home() {
  const search = useSearch();
  const refCode = new URLSearchParams(search).get("ref") ?? "";
  const [activeThumb, setActiveThumb] = useState(0);

  const thumbs = [
    { src: "/images/book-cover-mockup.png",        alt: "Holistic Growth Life Path — front cover" },
    { src: "/images/book-cover-mockup2.png",       alt: "Holistic Growth Life Path — cosmic mockup" },
    { src: "/images/book-interior-natal-chart.png", alt: "Interior — your personal natal-chart blueprint" },
    { src: "/images/book-interior-opener.png",     alt: "Interior — chapter opener" },
    { src: "/images/book-interior-body.png",       alt: "Interior — Moon Sign chapter body" },
    { src: "/images/book-interior-affirmation.png", alt: "Interior — affirmation page" },
    { src: "/images/book-interior-numerology.png", alt: "Interior — numerology data card" },
    { src: "/images/book-interior-birthstone.png", alt: "Interior — birthstone talisman (BONUS Chapter 13)" },
  ];

  return (
    // Two-pronged "no animation" setup:
    //   1. `reducedMotion="always"` tells framer-motion to skip every
    //      transform animation (x / y / scale / rotate) — slides are gone.
    //   2. Every `initial` prop on this page starts at `opacity: 1`, and
    //      the `fadeIn` / `stagger` variants are degenerate (hidden ===
    //      visible). With opacity already at its final value, there's
    //      nothing to fade in — opacity transitions are no-ops.
    // Combined, elements render at their final position and visibility
    // instantly. Switch to `reducedMotion="user"` to respect each
    // visitor's OS `prefers-reduced-motion` setting instead of forcing
    // the static path on everyone.
    <MotionConfig reducedMotion="always">
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="Holistic Growth Life Path — Personalised Astrology & Birth Chart Book"
        description="A full-color hardbound book written entirely from your birth chart. 13 personal chapters across relationships, wealth, health, lucky numbers, and your birthstone — printed in the USA. Preview your opening pages free."
        path="/"
      />
      {/* Referral Banner */}
      {refCode && <ReferralBanner code={refCode} />}

      {/* Nav */}
      <header className="py-4 px-6 border-b border-border bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-10 w-auto" />
          <nav className="hidden md:flex items-center gap-8 text-base font-semibold text-foreground/80">
            <a href="#inside" className="hover:text-foreground transition-colors">Inside the Book</a>
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#reviews" className="hover:text-foreground transition-colors">Reviews</a>
            <a href="https://shop.holigrowth.com" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Shop</a>
          </nav>
          <Link href={refCode ? `/create?ref=${refCode}` : "/create"}>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-6">
              Create My Book
            </Button>
          </Link>
        </div>
      </header>

      {/* ── PRODUCT HERO ── */}
      <section className="relative py-12 px-6 lg:py-20 overflow-hidden">
        <img
          src={heroWatercolor}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-x-0 top-0 w-full max-h-[500px] object-cover object-top opacity-60 mix-blend-multiply [mask-image:linear-gradient(to_bottom,black_15%,transparent_85%)]"
        />
        <div className="relative max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">

            {/* Left — book image */}
            <motion.div
              initial={{ opacity: 1, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              className="space-y-4"
            >
              <div className="relative rounded-2xl overflow-hidden bg-muted aspect-[125/185] flex items-center justify-center shadow-xl">
                <img
                  src={thumbs[activeThumb]?.src}
                  alt={thumbs[activeThumb]?.alt}
                  className="w-full h-full object-contain"
                />
                {/* USA badge on image */}
                <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-white/95 backdrop-blur rounded-full px-4 py-2 shadow-md text-sm font-medium text-foreground">
                  <span className="text-lg">🇺🇸</span> Printed in the USA
                </div>
              </div>
              {/* Thumbnails */}
              <div className="grid grid-cols-8 gap-2">
                {thumbs.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveThumb(i)}
                    className={`rounded-lg overflow-hidden aspect-[125/185] border-2 bg-muted transition-all ${activeThumb === i ? "border-primary shadow-md" : "border-transparent opacity-60 hover:opacity-90"}`}
                  >
                    <img src={t.src} alt={t.alt} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Right — product details */}
            <motion.div
              initial="hidden"
              animate="visible"
              variants={stagger}
              className="space-y-6 lg:pt-4"
            >
              <motion.p variants={fadeIn} className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium">
                The Personalized Astrology Book
              </motion.p>

              <motion.h1 variants={fadeIn} className="text-4xl md:text-5xl font-serif text-foreground leading-tight">
                Holistic Growth<br />
                <span className="italic text-secondary">Life Path</span>
              </motion.h1>

              {/* Reviews */}
              <motion.div variants={fadeIn} className="flex items-center gap-3">
                <StarRating />
                <span className="text-sm text-muted-foreground">4.9 · <a href="#reviews" className="underline underline-offset-2 hover:text-foreground">See reviews</a></span>
              </motion.div>

              <motion.p variants={fadeIn} className="text-foreground/75 font-light leading-relaxed text-[1.05rem]">
                A <strong className="text-foreground font-semibold">full-color hardbound book</strong> written entirely from your birth chart. Every word — your relationships, your wealth path, your health code, your lucky numbers, and a closing love letter from the universe — is <em>magically written</em> from the signals you send the cosmos at your unique moment in space and time. No two books are alike!
              </motion.p>

              {/* Trust badges */}
              <motion.div variants={fadeIn} className="flex flex-wrap gap-3">
                {[
                  { icon: "🇺🇸", label: "Printed in the USA" },
                  { icon: "🎨", label: "Full Color · 6″ × 9″ US Trade" },
                  { icon: "✨", label: "100% personalized" },
                  { icon: "🎁", label: "Perfect as a gift" },
                  { icon: "👁️", label: "Preview free before ordering" },
                ].map((b) => (
                  <span key={b.label} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-muted border border-border text-foreground/70">
                    <span>{b.icon}</span> {b.label}
                  </span>
                ))}
              </motion.div>

              {/* CTA */}
              <motion.div variants={fadeIn} className="pt-2 space-y-3">
                <Link href={refCode ? `/create?ref=${refCode}` : "/create"} className="block">
                  <Button size="lg" className="w-full h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl font-medium shadow-[0_8px_30px_-6px_rgba(1,91,92,0.35)] transition-all hover:shadow-[0_12px_36px_-6px_rgba(1,91,92,0.45)]">
                    Create My Book
                    <Sparkles className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
                <p className="text-center text-xs text-muted-foreground">Takes 2 minutes · <span className="text-primary font-medium">Preview your pages free</span> · Ships in 2–3 weeks</p>
              </motion.div>

              {/* What's included list */}
              <motion.div variants={fadeIn} className="pt-2 space-y-2.5 border-t border-border">
                <p className="text-xs uppercase tracking-widest text-muted-foreground pt-4 mb-3">What's inside every book</p>
                {[
                  "13 deeply personal chapters",
                  "Relationships, Wealth & Health pillars",
                  <><strong>15 practical personalized affirmations</strong> — 5 each for love, money & health, written from your Life Path</>,
                  "Your lucky numbers with full interpretations",
                  "Sacred morning ritual & month-by-month forecast",
                  <><strong>BONUS Chapter 13</strong> — your birth-month birthstone as a personal talisman</>,
                  "A closing love letter from the universe",
                  <><strong><em>Preview your first pages free — before you order</em></strong></>,
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm text-foreground/75">
                    <CheckCircle className="w-4 h-4 text-primary shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section className="border-y border-border bg-muted py-5 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: Truck, label: "Ships from the USA", sub: "Fulfilled by Lulu Press" },
              { icon: BookOpen, label: "US Trade 6″ × 9″", sub: "Glossy hardcover case wrap" },
              { icon: Flame, label: "Magically written for you", sub: "Cast from your unique space-time" },
              { icon: Package, label: "Ships in 2–3 weeks", sub: "Tracked & insured" },
            ].map(({ icon: Icon, label, sub }, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <Icon className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground">{sub}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── INSIDE THE BOOK ── */}
      <section id="inside" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium mb-3">A Peek Inside</p>
            <h2 className="text-4xl md:text-5xl font-serif text-foreground">
              Every page is <span className="italic text-secondary">about you</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto font-light">
              Sample passages from a real book — written with the exact same depth and intimacy as yours will be.
            </p>
          </motion.div>

          {/* Spread layout */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                tag: "Chapter 1",
                tagColor: "bg-primary/10 text-primary",
                title: "Your Cosmic Blueprint",
                copy: "You arrived on this Earth carrying a Life Path 7 — the number of the seeker, the mystic, the one who was born to question everything and trust only what rings true in the depths of your own knowing. This is not a life built for the ordinary…",
                accent: "border-l-4 border-primary/30",
              },
              {
                tag: "Chapter 5 · Relationships",
                tagColor: "bg-rose-100 text-rose-600",
                title: "Your Soul's Blueprint for Love",
                copy: "Your Scorpio Sun and Cancer Moon create a soul who loves with breathtaking depth and ferocity. You do not love casually — you love with your entire being. The person who gets to be loved by you has won something most people never find…",
                accent: "border-l-4 border-rose-300",
              },
              {
                tag: "Chapter 6 · Wealth",
                tagColor: "bg-amber-100 text-amber-700",
                title: "Your Abundance Code",
                copy: "Your Destiny Number 3 is one of the most creative wealth numbers in all of numerology. You are not built to grind in obscurity — you are built to be seen. The universe has literally wired your name to generate income through self-expression…",
                accent: "border-l-4 border-amber-300",
              },
              {
                tag: "Chapter 8 · Lucky Numbers",
                tagColor: "bg-secondary/15 text-primary",
                title: "Your Numbers Decoded",
                copy: "Your lucky numbers — 7, 14, 21, 33, 42 — are not random. The 7 is your Life Path, the number that governs your soul's journey. Use it for major decisions: signings, beginnings, travel dates. The universe responds to its own frequency…",
                accent: "border-l-4 border-secondary/50",
              },
              {
                tag: "Chapter 6 · Wealth Affirmations",
                tagColor: "bg-amber-100 text-amber-700",
                title: "10 Practical Wealth Affirmations",
                copy: "1. My Destiny Number 3 makes me visible — I price my work for the audience I'm built to reach. 2. Abundance follows my voice; today I send the message I've been postponing. 3. As a Pisces, I read money like an emotion — I trust the signal, not the panic…",
                accent: "border-l-4 border-amber-300",
              },
              {
                tag: "Closing · Love Letter",
                tagColor: "bg-purple-100 text-purple-700",
                title: "From the Universe, to You",
                copy: "Dear [Name], from the moment you drew your first breath beneath those particular stars, something ancient and knowing wrote your name in light. You are not here by accident. Every wound has been a classroom. Every loss, a redirection toward something truer…",
                accent: "border-l-4 border-purple-300",
              },
            ].map((page, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 1, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.55, delay: i * 0.08 }}
                className={`bg-white rounded-2xl border border-border p-7 shadow-sm ${page.accent}`}
              >
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${page.tagColor}`}>{page.tag}</span>
                <h4 className="font-serif text-lg text-foreground mt-3 mb-2">{page.title}</h4>
                <p className="text-sm text-muted-foreground font-light leading-relaxed italic">"{page.copy}"</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PREVIEW CALLOUT ── */}
      <section className="py-16 px-6 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-white rounded-full blur-[100px]" />
          <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-secondary rounded-full blur-[80px]" />
        </div>
        <div className="max-w-5xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-10"
          >
            <p className="text-primary-foreground/70 font-serif italic text-base mb-3">No risk. No commitment.</p>
            <h2 className="text-4xl md:text-5xl font-serif text-primary-foreground leading-tight">
              Read your book before<br />
              <span className="italic opacity-90">you spend a cent.</span>
            </h2>
            <p className="mt-4 text-primary-foreground/75 font-light text-lg max-w-2xl mx-auto leading-relaxed">
              Once you enter your details, the cosmos writes your personalised book in minutes. You can read the opening chapters completely free — only order the physical hardbound copy if it moves you.
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 1, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="grid sm:grid-cols-3 gap-4 mb-10"
          >
            {[
              { icon: Zap, title: "Written in minutes", desc: "The cosmos translates the signals from your unique moment in space-time into your book the instant you submit your details." },
              { icon: Eye, title: "Preview pages instantly", desc: "Read your opening chapters online — completely free, no payment required." },
              { icon: ShieldCheck, title: "Only pay if you love it", desc: "Order the luxury hardbound copy only when you're ready. Zero pressure." },
            ].map(({ icon: Icon, title, desc }, i) => (
              <div key={i} className="flex flex-col items-center text-center gap-3 p-6 rounded-2xl bg-white/10 border border-white/20">
                <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary-foreground" />
                </div>
                <h3 className="font-serif text-primary-foreground font-medium">{title}</h3>
                <p className="text-primary-foreground/65 text-sm font-light leading-relaxed">{desc}</p>
              </div>
            ))}
          </motion.div>
          <motion.div
            initial={{ opacity: 1 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25 }}
            className="text-center"
          >
            <Link href={refCode ? `/create?ref=${refCode}` : "/create"}>
              <Button size="lg" className="h-14 px-12 text-lg bg-white text-primary hover:bg-white/90 rounded-full font-medium shadow-xl">
                Preview My Book Free <Eye className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <p className="mt-3 text-primary-foreground/50 text-sm">No credit card needed to preview</p>
          </motion.div>
        </div>
      </section>

      {/* ── THREE PILLARS ── */}
      <section id="features" className="py-24 px-6 bg-muted border-y border-border relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-secondary/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="max-w-6xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium mb-3">The Heart of Your Book</p>
            <h2 className="text-4xl md:text-5xl font-serif text-foreground">
              Three Pillars of <span className="italic text-secondary">Holistic Growth</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto font-light">
              Every page serves your growth across the three domains that shape the quality of your entire life.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Heart,
                iconBg: "bg-rose-100",
                iconColor: "text-rose-500",
                accent: "bg-rose-500",
                title: "Love & Relationships",
                tagline: "Your cosmic blueprint for connection",
                bullets: [
                  "Soul mate qualities & karmic lessons",
                  "Love language & communication style by sign",
                  "Timing cycles for love this year",
                  "How to deepen your most important bonds",
                  "5 personalized relationship affirmations",
                ]
              },
              {
                icon: Coins,
                iconBg: "bg-amber-100",
                iconColor: "text-amber-600",
                accent: "bg-amber-500",
                title: "Wealth & Abundance",
                tagline: "Your cosmic path to prosperity",
                bullets: [
                  "Life Path number & financial destiny",
                  "Natural wealth gifts and money blind spots",
                  "Lucky timing windows for big decisions",
                  "Abundance practices aligned with your chart",
                  "5 personalized wealth affirmations",
                ]
              },
              {
                icon: Leaf,
                iconBg: "bg-teal-100",
                iconColor: "text-teal-600",
                accent: "bg-teal-500",
                title: "Health & Vitality",
                tagline: "Your body's cosmic code",
                bullets: [
                  "Body zones governed by your signs",
                  "What drains vs. replenishes your energy",
                  "Stress patterns & mind-body practices",
                  "Seasonal rhythms your body wants to honor",
                  "5 personalized health affirmations",
                ]
              }
            ].map((pillar, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 1, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.15 }}
                className="p-8 rounded-2xl border bg-white shadow-sm overflow-hidden relative"
              >
                <div className={`absolute top-0 left-0 right-0 h-1 ${pillar.accent}`} />
                <div className={`w-12 h-12 rounded-full ${pillar.iconBg} flex items-center justify-center mb-5`}>
                  <pillar.icon className={`w-6 h-6 ${pillar.iconColor}`} />
                </div>
                <h3 className="text-xl font-serif text-foreground mb-1">{pillar.title}</h3>
                <p className="text-sm text-muted-foreground italic mb-5">{pillar.tagline}</p>
                <ul className="space-y-3">
                  {pillar.bullets.map((b, j) => (
                    <li key={j} className="flex items-start gap-3 text-sm text-foreground/75">
                      <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRINTED IN USA ── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 1, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9 }}
            >
              <div className="relative rounded-3xl overflow-hidden aspect-[4/3] shadow-2xl bg-muted">
                <img src="/images/book-cover-mockup.png" alt="Premium hardbound book" className="w-full h-full object-contain" />
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/15 to-transparent pointer-events-none" />
                <div className="absolute bottom-5 right-5 bg-white/95 backdrop-blur rounded-2xl px-5 py-4 shadow-lg">
                  <p className="text-2xl mb-1">🇺🇸</p>
                  <p className="font-serif text-foreground text-sm font-medium">Proudly printed<br />in the USA</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stagger}
            >
              <motion.p variants={fadeIn} className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium mb-3">Premium Quality</motion.p>
              <motion.h2 variants={fadeIn} className="text-4xl md:text-5xl font-serif mb-6 text-foreground">
                Built to last <br />
                <span className="italic text-secondary">a lifetime</span>
              </motion.h2>
              <motion.p variants={fadeIn} className="text-muted-foreground font-light mb-8 leading-relaxed text-[1.05rem]">
                Your book is printed in <strong className="text-foreground font-semibold">full color</strong> and bound in the United States to Lulu Press's US Trade standard — richly illustrated pages on 60# uncoated white paper (6&Prime; × 9&Prime;) with a glossy case-wrap hardcover. Not a digital PDF — a real, physical volume you'll return to again and again.
              </motion.p>

              <motion.div variants={fadeIn} className="grid grid-cols-2 gap-4 mb-8">
                {[
                  { num: "13", label: "Personal chapters" },
                  { num: "15", label: "Personal affirmations" },
                  { num: "3", label: "Life pillars" },
                  { num: "5+", label: "Lucky numbers decoded" },
                ].map((stat) => (
                  <div key={stat.label} className="p-4 rounded-2xl bg-muted border border-border text-center">
                    <div className="font-serif text-2xl text-primary font-semibold">{stat.num}</div>
                    <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                  </div>
                ))}
              </motion.div>

              <motion.div variants={fadeIn}>
                <Link href={refCode ? `/create?ref=${refCode}` : "/create"}>
                  <Button size="lg" className="h-14 px-10 text-base bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl font-medium shadow-[0_8px_30px_-6px_rgba(1,91,92,0.3)]">
                    Create My Book <Sparkles className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-24 px-6 bg-muted border-y border-border">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14"
          >
            <p className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium mb-3">Simple Process</p>
            <h2 className="text-4xl md:text-5xl font-serif text-foreground">
              How It <span className="italic text-secondary">Works</span>
            </h2>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: "01", title: "Enter your email", desc: "Takes 30 seconds. We'll send your book link and order updates here." },
              { step: "02", title: "Share birth details", desc: "Name, birthday, birth time, and birth location. Two minutes total." },
              { step: "03", title: "Preview your pages", desc: "The cosmos writes your book instantly. Read the opening chapters — completely free — before you spend anything.", highlight: true },
              { step: "04", title: "Order & receive", desc: "Love what you see? Order your luxury hardbound copy and it ships from the USA in 2–3 weeks." },
            ].map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 1, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={`relative p-6 rounded-2xl border shadow-sm ${"highlight" in s && s.highlight ? "bg-primary/5 border-primary/30 ring-1 ring-primary/20" : "bg-white border-border"}`}
              >
                <div className={`absolute -top-5 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full flex items-center justify-center font-serif text-sm font-semibold ${"highlight" in s && s.highlight ? "bg-secondary text-white shadow-[0_4px_12px_rgba(1,91,92,0.4)]" : "bg-primary text-primary-foreground shadow-[0_4px_12px_rgba(1,91,92,0.3)]"}`}>
                  {s.step}
                </div>
                {"highlight" in s && s.highlight && (
                  <span className="absolute top-3 right-3 text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Free</span>
                )}
                <h3 className="text-base font-serif mt-5 mb-2 text-foreground">{s.title}</h3>
                <p className="text-muted-foreground font-light text-sm leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── REVIEWS ── */}
      <section id="reviews" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Aggregate */}
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <p className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium mb-3">Customer Reviews</p>
            <h2 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
              Voices from the <span className="italic text-secondary">Stars</span>
            </h2>
            <div className="flex items-center justify-center gap-3">
              <StarRating />
              <span className="text-xl font-serif text-foreground">4.9</span>
              <span className="text-muted-foreground text-sm">· See reviews</span>
            </div>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                quote: "The lucky numbers chapter alone was worth it. I've been using them for everything — and the wealth section said out loud what I already knew about myself but couldn't name.",
                author: "Eleanor T.",
                sign: "Pisces · Life Path 7",
                stars: 5,
              },
              {
                quote: "I submitted my affirmations and was moved to tears when I saw them woven into the book. It's the most personal thing I've ever owned. I read it every single morning.",
                author: "Margaret H.",
                sign: "Taurus · Life Path 3",
                stars: 5,
              },
              {
                quote: "The relationships chapter was uncanny. It named patterns I hadn't been able to articulate myself. This is a tool for real growth — not just pretty words.",
                author: "Sarah L.",
                sign: "Leo · Life Path 11",
                stars: 5,
              },
              {
                quote: "I ordered this for my mom's birthday and she cried happy tears when she opened it. The quality of the hardbound book is stunning. Printed beautifully.",
                author: "James K.",
                sign: "Gifted to: Virgo · Life Path 4",
                stars: 5,
              },
              {
                quote: "My health chapter was so specific about what depletes me that I immediately restructured my mornings around it. Already seeing a difference in my energy.",
                author: "Priya M.",
                sign: "Aquarius · Life Path 9",
                stars: 5,
              },
              {
                quote: "The love letter at the end made me put the book down and just sit for a while. I've never felt so seen by anything. Absolute magic.",
                author: "Claudia R.",
                sign: "Scorpio · Life Path 2",
                stars: 5,
              },
            ].map((r, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 1, scale: 0.97 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.07 }}
                className="p-7 rounded-2xl bg-card border border-border flex flex-col shadow-sm"
              >
                <StarRating count={r.stars} />
                <p className="text-foreground/75 font-serif text-base leading-relaxed flex-grow italic mt-4 mb-6">
                  "{r.quote}"
                </p>
                <div>
                  <div className="text-foreground font-medium text-sm">{r.author}</div>
                  <div className="text-secondary text-xs mt-0.5">{r.sign}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-24 px-6 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-[400px] h-[400px] bg-white rounded-full blur-[100px]" />
          <div className="absolute bottom-0 right-0 w-[300px] h-[300px] bg-secondary rounded-full blur-[80px]" />
        </div>
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 1, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="space-y-6"
          >
            <p className="text-primary-foreground/70 font-serif italic text-lg">Your stars are waiting</p>
            <h2 className="text-4xl md:text-6xl font-serif text-primary-foreground leading-tight">
              The most personal book<br />you'll ever hold.
            </h2>
            <p className="text-primary-foreground/75 font-light text-lg max-w-xl mx-auto leading-relaxed">
              Full-color pages written entirely about you. Preview your opening chapters free — then order your luxury hardbound copy, printed in the USA.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
              <Link href={refCode ? `/create?ref=${refCode}` : "/create"}>
                <Button size="lg" className="h-14 px-12 text-lg bg-white text-primary hover:bg-white/90 rounded-full font-medium shadow-xl transition-all">
                  Preview My Book Free <Eye className="ml-2 w-5 h-5" />
                </Button>
              </Link>
            </div>
            <p className="text-primary-foreground/50 text-sm">No credit card needed to preview · 🇺🇸 Printed &amp; shipped from the USA</p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-border bg-white">
        <div className="max-w-6xl mx-auto flex flex-col items-center gap-6 text-sm text-muted-foreground">
          <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-8 w-auto" />
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="#inside" className="hover:text-foreground transition-colors">Inside the Book</a>
            <a href="#reviews" className="hover:text-foreground transition-colors">Reviews</a>
            <Link href="/create" className="hover:text-foreground transition-colors">Create My Book</Link>
            <span className="text-muted-foreground/40">·</span>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </div>
          <p>© {new Date().getFullYear()} Holigrowth. All rights reserved.</p>
        </div>
      </footer>
    </div>
    </MotionConfig>
  );
}
