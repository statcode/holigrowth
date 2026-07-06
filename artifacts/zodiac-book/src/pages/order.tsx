import { useEffect, useState, useRef, useCallback } from "react";
import { useAdmin } from "@/contexts/admin-context";
import { useLocation, useParams, useSearch } from "wouter";
import { SEO } from "@/components/SEO";
import { motion } from "framer-motion";
import { Loader2, Sparkles, Star, Sun, Moon, ArrowRight, Hash, Heart, Coins, Leaf, Lock, Clock } from "lucide-react";
import { CosmicLoader } from "@/components/CosmicLoader";
import { useGetZodiacOrder, getGetZodiacOrderQueryKey, useGetSiteSettings, getGetSiteSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

export default function Order() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const search = useSearch();
  const paymentParam = new URLSearchParams(search).get("payment");
  const queryClient = useQueryClient();

  const { data: order, isLoading, isError } = useGetZodiacOrder(id, {
    query: {
      enabled: !!id,
      queryKey: getGetZodiacOrderQueryKey(id),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "pending_payment") return 5_000;
        if (status === "pending" || status === "generating") return 3_000;
        return false;
      },
    }
  });
  const { data: siteSettings } = useGetSiteSettings({
    query: { queryKey: getGetSiteSettingsQueryKey() },
  });
  const displayPrice = order?.priceUsd ?? siteSettings?.priceUsd ?? 99.99;
  const originalPrice = siteSettings?.originalPriceUsd ?? 129.99;
  const generatedPdfUrl = order?.interiorPdfUrl ?? null;

  const isPreview = new URLSearchParams(search).get("preview") === "1";

  const [streamedText, setStreamedText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [keepWaiting, setKeepWaiting] = useState(false);
  const [generationStage, setGenerationStage] = useState<"writing" | "pdf" | "upload" | "done">("writing");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Parallel-generation progress: how many of the book's sections (welcome
  // + 13 chapters + closing = 15) have been written so far, plus a rolling
  // list of titles for the loader's checkmark list.
  const [sectionsTotal, setSectionsTotal] = useState(0);
  const [sectionsCompleted, setSectionsCompleted] = useState<{ key: string; title: string }[]>([]);
  const streamStarted = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Poll handle for the resume-after-409 progress endpoint. Started when the
  // /generate POST returns 409 (another tab or the previous session is
  // already streaming this order); stopped when the order status transitions
  // to `generated` or `failed`.
  const progressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopProgressPoll = () => {
    if (progressPollRef.current) {
      clearInterval(progressPollRef.current);
      progressPollRef.current = null;
    }
  };
  const pollProgress = () => {
    stopProgressPoll();
    progressPollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/zodiac-orders/${id}/generation-progress`);
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          progress: {
            stage: "writing" | "pdf" | "upload";
            sectionsCompleted: number;
            sectionsTotal: number;
            lastSectionTitle: string | null;
          } | null;
        };
        const p = data.progress;
        if (p) {
          setGenerationStage(p.stage);
          setSectionsTotal(p.sectionsTotal);
          setSectionsCompleted(
            Array.from({ length: p.sectionsCompleted }, (_, i) => ({
              key: `section-${i + 1}`,
              title: i === p.sectionsCompleted - 1 && p.lastSectionTitle
                ? p.lastSectionTitle
                : "Chapter completed",
            })),
          );
        }
      } catch {
        // network hiccup — retry next tick
      }
    }, 2000);
  };
  useEffect(() => stopProgressPoll, []);

  // Session-based offer countdown — 30 min, persists across refreshes within same tab session
  const [countdownSecs, setCountdownSecs] = useState(30 * 60);
  useEffect(() => {
    if (!id) return;
    const DURATION = 30 * 60;
    const key = `holigrowth_offer_expiry_${id}`;
    const getExpiry = () => {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const ts = parseInt(stored, 10);
        if (!isNaN(ts) && ts > Date.now()) return ts;
      }
      const ts = Date.now() + DURATION * 1000;
      sessionStorage.setItem(key, String(ts));
      return ts;
    };
    const tick = () => {
      const expiry = getExpiry();
      const remaining = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      setCountdownSecs(remaining);
      if (remaining === 0) sessionStorage.removeItem(key);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [id]);
  const cdMins = Math.floor(countdownSecs / 60);
  const cdSecs = countdownSecs % 60;
  const countdownDisplay = `${String(cdMins).padStart(2, "0")}:${String(cdSecs).padStart(2, "0")}`;

  // Tick elapsed time while generating
  useEffect(() => {
    if (isGenerating) {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [isGenerating]);

  useEffect(() => {
    if (order?.status === "pending" || order?.status === "generating") {
      if (!streamStarted.current) {
        streamStarted.current = true;
        setIsGenerating(true);
        startGeneration();
      }
    } else if (order?.status === "generated") {
      setIsGenerating(false);
      setIsReconnecting(false);
      stopProgressPoll();
      if (isPreview) {
        const name = encodeURIComponent(order.fullName);
        setLocation(`/preview/${id}?name=${name}`);
      }
    } else if (order?.status === "failed") {
      setIsGenerating(false);
      stopProgressPoll();
      setIsReconnecting(false);
    }
  }, [order?.status]);

  const handleRetry = useCallback(() => {
    setKeepWaiting(false);
    setStreamedText("");
    setGenerationStage("writing");
    setIsReconnecting(false);
    setElapsedSeconds(0);
    setSectionsTotal(0);
    setSectionsCompleted([]);
    streamStarted.current = false;
    streamStarted.current = true;
    setIsGenerating(true);
    startGeneration();
  // startGeneration is defined below but stable via useCallback — safe to reference
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { adminToken, testMode, isAdmin } = useAdmin();

  const startGeneration = useCallback(async () => {
    try {
      const response = await fetch(`/api/zodiac-orders/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          adminToken && testMode
            ? { adminToken, adminTestMode: true }
            : {}
        ),
        // 12 minute hard timeout — server takes up to ~8 min for large books
        signal: AbortSignal.timeout(12 * 60 * 1000),
      });

      // 409 = another generation is already running for this order (the user
      // closed and reopened the tab while the AI was still streaming, or two
      // /preview tabs are open). Poll the progress endpoint so the loader
      // still shows section-count / stage updates as the OTHER stream
      // advances. The 3-second order-polling detects completion separately
      // and clears the poll via the status-watching effect below.
      if (response.status === 409) {
        setIsReconnecting(true);
        pollProgress();
        return;
      }

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          // SSE comment lines (": keepalive") are silently ignored here
          if (!part.startsWith("data: ")) continue;
          try {
            const dataStr = part.slice(6);
            if (dataStr === "[DONE]") {
              setIsGenerating(false);
              setIsReconnecting(false);
              setGenerationStage("done");
              queryClient.invalidateQueries({ queryKey: getGetZodiacOrderQueryKey(id) });
              break;
            }
            const data = JSON.parse(dataStr);
            if (data.keepalive) continue;
            if (data.content) setStreamedText((prev) => prev + data.content);
            // Parallel-generation progress events:
            //   { stage: "writing", totalSections: 15 }                       — initial
            //   { stage: "writing", sectionComplete: { n, total, key, title } } — per chapter
            if (typeof data.totalSections === "number") setSectionsTotal(data.totalSections);
            if (data.sectionComplete?.key && data.sectionComplete?.title) {
              const { key, title } = data.sectionComplete;
              setSectionsCompleted((prev) =>
                prev.some((s) => s.key === key) ? prev : [...prev, { key, title }],
              );
            }
            if (data.stage === "pdf") setGenerationStage("pdf");
            if (data.stage === "upload") setGenerationStage("upload");
            if (data.done) {
              setIsGenerating(false);
              setIsReconnecting(false);
              setGenerationStage("done");
              queryClient.invalidateQueries({ queryKey: getGetZodiacOrderQueryKey(id) });
            }
            if (data.error) {
              setIsGenerating(false);
              setIsReconnecting(false);
            }
          } catch (e) {
            console.error("Error parsing SSE data", e);
          }
        }
      }
    } catch (error) {
      console.error("SSE connection lost:", error);
      // Don't clear isGenerating — the 3 s polling will detect `generated` status
      // and the useEffect above will clear it. Just show reconnecting indicator.
      setIsReconnecting(true);
    }
  }, [id, queryClient]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0e1b2a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#c9a84c]" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center flex-col text-center px-4">
        <h2 className="text-3xl font-serif text-destructive mb-4">Cosmic Interference</h2>
        <p className="text-muted-foreground mb-8">We could not locate this reading.</p>
        <Button onClick={() => setLocation("/")} variant="outline">Return Home</Button>
      </div>
    );
  }

  if (order.status === "pending_payment" && paymentParam !== "cancel") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="py-4 px-6 border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto flex justify-center">
            <a href="/"><img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-9 w-auto" /></a>
          </div>
        </header>
        <div className="flex-grow flex items-center justify-center px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-md">
            <div className="relative inline-block mb-8">
              <div className="absolute inset-0 bg-secondary/20 blur-2xl rounded-full" />
              <Sparkles className="w-16 h-16 text-primary relative z-10" />
            </div>
            <h1 className="text-3xl font-serif mb-4 text-foreground">Complete Your Payment</h1>
            <p className="text-muted-foreground font-light mb-8 leading-relaxed">
              Your personalized book for <span className="text-foreground font-medium">{order.fullName}</span> is reserved. Complete checkout to begin generating your life path.
            </p>
            <div className="bg-muted border border-border rounded-2xl p-6 mb-8 text-left space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Book</span><span className="font-medium">Holistic Growth Life Path</span></div>
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Price</span><div className="flex items-center gap-2"><span className="text-muted-foreground/60 line-through text-xs">${originalPrice.toFixed(2)}</span><span className="font-medium text-primary">${displayPrice.toFixed(2)}</span></div></div>
              {order.referredBy && <div className="flex justify-between text-secondary"><span>Referral discount</span><span>10% off applied ✓</span></div>}
            </div>
            <Button
              size="lg"
              className="w-full h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
              onClick={async () => {
                const resp = await fetch("/api/stripe/create-checkout-session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderId: id }),
                });
                const data = await resp.json();
                if (data.url) window.location.href = data.url;
              }}
            >
              Pay Now &amp; Unlock My Book <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <p className="text-xs text-muted-foreground mt-4">Secured by Stripe · 256-bit SSL encryption</p>
          </motion.div>
        </div>
      </div>
    );
  }

  if (paymentParam === "cancel") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="py-4 px-6 border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto flex justify-center">
            <a href="/"><img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-9 w-auto" /></a>
          </div>
        </header>
        <div className="flex-grow flex items-center justify-center px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-md">
            <p className="text-4xl mb-6">🌙</p>
            <h1 className="text-3xl font-serif mb-4 text-foreground">Payment Cancelled</h1>
            <p className="text-muted-foreground font-light mb-8">No worries — your order is still saved. You can complete payment whenever you're ready.</p>
            <Button
              size="lg"
              className="w-full h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl mb-3"
              onClick={async () => {
                const resp = await fetch("/api/stripe/create-checkout-session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderId: id }),
                });
                const data = await resp.json();
                if (data.url) window.location.href = data.url;
              }}
            >
              Try Again
            </Button>
            <Button variant="outline" className="w-full h-12 rounded-xl" onClick={() => setLocation("/")}>Back to Home</Button>
          </motion.div>
        </div>
      </div>
    );
  }

  const isComplete = order.status === "generated" || order.status === "shipped" || order.status === "submitting" || order.status === "processing";

  // Hard 10-minute timeout — show retry screen if still stuck generating
  const isTimedOut = isGenerating && !isReconnecting && elapsedSeconds >= 600;

  if (!isComplete || isGenerating || isReconnecting) {
    return (
      <CosmicLoader
        name={order.fullName}
        location={order.birthLocation}
        email={order.email ?? undefined}
        stage={generationStage}
        streamedText={streamedText}
        elapsedSeconds={elapsedSeconds}
        sectionsTotal={sectionsTotal}
        sectionsCompleted={sectionsCompleted}
        isReconnecting={isReconnecting}
        timedOut={isTimedOut && !keepWaiting}
        onRetry={handleRetry}
        onKeepWaiting={() => setKeepWaiting(true)}
      />
    );
  }

  const Nav = () => (
    <header className="py-4 px-6 border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex justify-center">
        <a href="/"><img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-9 w-auto" /></a>
      </div>
    </header>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO title="Your Order — Holigrowth" noindex />
      <Nav />
      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-secondary/6 rounded-full blur-[150px]" />
      </div>

      <div className="max-w-4xl mx-auto pt-16 pb-32 px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          <div className="text-center mb-16">
            <p className="text-secondary italic font-serif text-xl mb-3">Holistic Growth Life Path</p>
            <h1 className="text-4xl md:text-6xl font-serif mb-6 text-foreground">
              Your Book <br/>
              <span className="italic text-secondary">is Ready</span>
            </h1>
            <p className="text-xl text-muted-foreground font-light max-w-2xl mx-auto">
              The cosmos has been consulted. Here is a glimpse into your complete celestial and numerological blueprint.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { icon: Sun,  label: "Sun Sign",    value: order.sunSign },
              { icon: Moon, label: "Moon Sign",   value: order.moonSign },
              { icon: Star, label: "Rising Sign", value: order.risingSign },
              { icon: Hash, label: "Life Path",   value: order.lifePath ? `#${order.lifePath}` : null },
            ].map((badge, i) => (
              <div key={i} className="p-5 rounded-2xl bg-card border border-card-border flex flex-col items-center justify-center text-center shadow-sm">
                <badge.icon className="w-6 h-6 text-secondary mb-3" />
                <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">{badge.label}</div>
                <div className="font-serif text-xl text-foreground">{badge.value || "—"}</div>
              </div>
            ))}
          </div>

          {(order.luckyNumbers || order.lifePath) && (
            <div className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-secondary/10 border border-primary/15 flex items-center gap-5">
              <div className="shrink-0 w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-[0_4px_12px_rgba(1,91,92,0.3)]">
                <Hash className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">Your Lucky Numbers</div>
                <div
                  className="font-serif text-2xl text-foreground tracking-wide blur-md select-none pointer-events-none"
                  aria-hidden="true"
                >
                  {order.luckyNumbers ?? "•• •• •• •• ••"}
                </div>
                <p className="text-sm text-muted-foreground mt-1 inline-flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-primary/60" />
                  Revealed in your book — story, meaning, and how to use each one.
                </p>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-4 mb-10">
            {[
              { icon: Heart, label: "Relationships", color: "text-rose-500", bg: "bg-rose-50 border-rose-100", desc: "Your soul mate blueprint, love languages, and current timing cycles." },
              { icon: Coins, label: "Wealth",        color: "text-amber-600", bg: "bg-amber-50 border-amber-100", desc: "Your financial destiny, abundance practices, and lucky timing windows." },
              { icon: Leaf,  label: "Health",        color: "text-teal-600",  bg: "bg-teal-50 border-teal-100",  desc: "Your body's cosmic code, vitality practices, and seasonal rhythms." },
            ].map((pillar, i) => (
              <div key={i} className={`p-5 rounded-2xl border ${pillar.bg} flex flex-col gap-2`}>
                <pillar.icon className={`w-5 h-5 ${pillar.color}`} />
                <div className="font-serif text-base text-foreground">{pillar.label}</div>
                <p className="text-xs text-muted-foreground">{pillar.desc}</p>
              </div>
            ))}
          </div>

          <div className="relative rounded-3xl bg-white border border-border shadow-sm overflow-hidden mb-10">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-secondary/40 to-transparent" />
            <div className="p-8">
              <h3 className="font-serif text-xl mb-5 text-primary italic">
                {isAdmin ? "Your Personalized Reading — Full" : "Your Personalized Reading"}
              </h3>

              {order.generatedContent ? (
                <>
                  {/* Always-visible first section */}
                  <div className="font-serif text-base leading-relaxed text-foreground/80 whitespace-pre-line">
                    {isAdmin ? order.generatedContent : order.generatedContent.slice(0, 900)}
                  </div>

                  {/* Locked section for non-admins */}
                  {!isAdmin && order.generatedContent.length > 900 && (
                    <div className="relative mt-1">
                      {/* Blurred locked content */}
                      <div
                        className="font-serif text-base leading-relaxed text-foreground/80 whitespace-pre-line select-none pointer-events-none"
                        style={{ filter: "blur(5px)" }}
                      >
                        {order.generatedContent.slice(900, 3500)}
                      </div>

                      {/* Gradient fade from clear → blurred */}
                      <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-white to-transparent" />

                      {/* Full overlay fade at bottom */}
                      <div className="absolute bottom-0 left-0 w-full h-40 bg-gradient-to-t from-white via-white/80 to-transparent" />

                      {/* Lock card */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-white/95 backdrop-blur-sm rounded-2xl border border-border shadow-lg p-6 text-center max-w-xs mx-4">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                            <Lock className="w-5 h-5 text-primary" />
                          </div>
                          <h4 className="font-serif text-lg text-foreground mb-1">The rest is yours — inside the book</h4>
                          <p className="text-xs text-muted-foreground mb-4">
                            All 13 chapters, your three pillars, lucky numbers, birthstone talisman, and closing letter are waiting in print.
                          </p>
                          <Button
                            size="sm"
                            onClick={() => setLocation(`/order/${id}/checkout`)}
                            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-5"
                          >
                            Order to unlock <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="font-serif text-base text-foreground/60 italic">
                  Your personalized reading is securely woven into the pages.
                </p>
              )}
            </div>
            {isAdmin && generatedPdfUrl && (
              <div className="px-8 pb-8 flex flex-wrap gap-3">
                <a
                  href={generatedPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Download Interior PDF
                </a>
                <a
                  href={`/preview/${id}?name=${encodeURIComponent(order.fullName)}`}
                  className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Open Preview
                </a>
              </div>
            )}
          </div>

          <div className="text-center bg-muted border border-border p-10 rounded-3xl mb-8">
            <h3 className="text-3xl font-serif mb-3 text-foreground">Print Your Life Path Book</h3>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              All 13 chapters, your three pillars, lucky numbers, affirmations, monthly forecast, and BONUS birthstone talisman — printed in <strong>full color</strong>, beautifully hardbound, and shipped to your door.
            </p>
            <div className="flex flex-col items-center gap-4">
              {/* Countdown timer */}
              <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-4 py-1.5 text-sm font-medium mb-1">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {countdownSecs > 0
                    ? <>Your reading is reserved for <span className="font-mono font-bold tabular-nums">{countdownDisplay}</span></>
                    : "Offer available — claim your book now"}
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="font-serif text-2xl text-primary">${displayPrice.toFixed(2)}</span>
                <span className="font-serif text-base text-muted-foreground line-through">${originalPrice.toFixed(2)}</span>
              </div>
              <Button
                data-testid="button-order-book"
                size="lg"
                onClick={() => setLocation(`/order/${id}/checkout`)}
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-lg px-12 h-16 rounded-full font-medium transition-all shadow-[0_8px_30px_-6px_rgba(1,91,92,0.35)] w-full sm:w-auto"
              >
                Order My Book <ArrowRight className="ml-2" />
              </Button>
            {order.status === "generated" && (
              <Button
                variant="outline"
                size="lg"
                onClick={() => setLocation(`/preview/${id}?name=${encodeURIComponent(order.fullName)}`)}
                className="bg-white text-foreground border-border text-lg px-12 h-16 rounded-full font-medium transition-all w-full sm:w-auto"
              >
                Go to Book Preview <ArrowRight className="ml-2" />
              </Button>
            )}
            </div>
          </div>

        </motion.div>
      </div>
    </div>
  );
}
