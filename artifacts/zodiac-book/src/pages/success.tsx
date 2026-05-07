import { useEffect, useState, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { Sun, Moon, Star, Hash, ArrowRight, Copy, Check, Share2, Users, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetZodiacOrder, getGetZodiacOrderQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CosmicLoader } from "@/components/CosmicLoader";

function Confetti() {
  const pieces = Array.from({ length: 28 }, (_, i) => ({
    id: i,
    x: (i * 37) % 100,
    delay: (i * 0.12) % 1.4,
    color: i % 4 === 0 ? "#c9a84c" : i % 4 === 1 ? "#6dccaa" : i % 4 === 2 ? "#b08fdf" : "#ffffff",
    size: (i % 3) + 4,
  }));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{ width: p.size, height: p.size, left: `${p.x}%`, top: -20, background: p.color, opacity: 0.7 }}
          animate={{ y: ["0%", "110vh"], rotate: [0, 360], opacity: [0.8, 0] }}
          transition={{ duration: 2.8 + p.delay, delay: p.delay * 0.4, ease: "easeIn", repeat: 0 }}
        />
      ))}
    </div>
  );
}

function ReferralCard({ referralCode, referralCount }: { referralCode: string; referralCount: number }) {
  const [copied, setCopied] = useState(false);
  const referralUrl = `${window.location.origin}/invite/${referralCode}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const shareText = encodeURIComponent("I just got my personalized Holistic Growth Life Path astrology book. Here's 10% off yours:");
  const shareUrl = encodeURIComponent(referralUrl);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.0 }}
      className="rounded-2xl border border-white/10 bg-white/5 p-6"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-[#c9a84c]/20 flex items-center justify-center flex-shrink-0">
          <Share2 className="w-4 h-4 text-[#c9a84c]" />
        </div>
        <div>
          <h3 className="font-serif text-base text-white">Share &amp; Give 10% Off</h3>
          <p className="text-xs text-white/40">Your link gives friends 10% off their book</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 bg-white/8 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white/50 font-mono truncate">
          {referralUrl}
        </div>
        <Button
          onClick={handleCopy}
          size="sm"
          variant="outline"
          className="shrink-0 h-10 px-3 border-[#c9a84c]/30 text-[#c9a84c] hover:bg-[#c9a84c]/10 rounded-xl gap-1.5 bg-transparent"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <a href={`https://wa.me/?text=${shareText}%20${shareUrl}`} target="_blank" rel="noopener noreferrer"
          className="flex-1 min-w-[100px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-[#25D366] text-white text-xs font-medium hover:opacity-90 transition-opacity">
          WhatsApp
        </a>
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`} target="_blank" rel="noopener noreferrer"
          className="flex-1 min-w-[100px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-medium hover:opacity-90 transition-opacity">
          Facebook
        </a>
        <a href={`https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noopener noreferrer"
          className="flex-1 min-w-[100px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-black text-white text-xs font-medium hover:opacity-90 transition-opacity">
          X / Twitter
        </a>
      </div>

      <div className="flex items-center gap-2 text-xs text-white/30 pt-3 border-t border-white/8">
        <Users className="w-3.5 h-3.5" />
        {referralCount === 0
          ? "Be the first to share your link!"
          : `${referralCount} friend${referralCount > 1 ? "s have" : " has"} used your link`}
      </div>
    </motion.div>
  );
}

export default function Success() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const [showConfetti, setShowConfetti] = useState(true);
  const queryClient = useQueryClient();

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [generationStage, setGenerationStage] = useState<"writing" | "pdf" | "upload" | "done">("writing");
  const streamStarted = useRef(false);

  const { data: order } = useGetZodiacOrder(id, {
    query: {
      enabled: !!id,
      queryKey: getGetZodiacOrderQueryKey(id),
      refetchInterval: isGenerating ? false : 3000,
    },
  });

  useEffect(() => {
    const t = setTimeout(() => setShowConfetti(false), 3500);
    return () => clearTimeout(t);
  }, []);

  // Trigger generation as soon as order is pending
  useEffect(() => {
    if (!order) return;
    if (order.status === "pending" || order.status === "generating") {
      if (!streamStarted.current) {
        streamStarted.current = true;
        startGeneration();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status]);

  const startGeneration = async () => {
    setIsGenerating(true);
    setGenerationStage("writing");
    setStreamedText("");

    try {
      const response = await fetch(`/api/zodiac-orders/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok || !response.body) {
        setIsGenerating(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) {
              setStreamedText((t) => t + event.content);
            } else if (event.stage === "pdf") {
              setGenerationStage("pdf");
            } else if (event.stage === "upload") {
              setGenerationStage("upload");
            } else if (event.done) {
              setGenerationStage("done");
              setIsGenerating(false);
              await queryClient.invalidateQueries({ queryKey: getGetZodiacOrderQueryKey(id) });
            } else if (event.error) {
              setIsGenerating(false);
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }
    } catch {
      setIsGenerating(false);
    }
  };

  const badges = [
    { icon: Sun,  label: "Sun Sign",    value: order?.sunSign   },
    { icon: Moon, label: "Moon Sign",   value: order?.moonSign  },
    { icon: Star, label: "Rising Sign", value: order?.risingSign },
    { icon: Hash, label: "Life Path",   value: order?.lifePath ? `#${order.lifePath}` : null },
  ];

  // Show generation progress while book is being written
  if (isGenerating && order) {
    return (
      <CosmicLoader
        name={order.fullName}
        location={order.birthLocation}
        stage={generationStage}
        streamedText={streamedText}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0e1b2a] text-white flex flex-col relative overflow-hidden">
      {showConfetti && <Confetti />}

      {/* Ambient glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#c9a84c]/8 rounded-full blur-[120px]" />

      <header className="py-4 px-6 border-b border-white/8 relative z-10">
        <div className="max-w-2xl mx-auto flex justify-center">
          <a href="/">
            <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-8 w-auto brightness-0 invert opacity-80" />
          </a>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-start px-4 py-12 relative z-10 max-w-2xl mx-auto w-full">

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          className="text-center mb-10 w-full"
        >
          <div className="relative inline-flex mb-6">
            <div className="absolute inset-0 bg-[#c9a84c]/30 rounded-full blur-2xl scale-150" />
            <div className="relative w-20 h-20 rounded-full bg-[#c9a84c]/15 border border-[#c9a84c]/30 flex items-center justify-center">
              <Sparkles className="w-9 h-9 text-[#c9a84c]" />
            </div>
          </div>

          <div className="w-12 h-px bg-[#c9a84c]/40 mx-auto mb-4" />
          <p className="text-[#c9a84c]/80 text-xs tracking-[0.35em] uppercase mb-3">Payment Confirmed</p>
          <h1 className="font-serif text-3xl md:text-4xl text-white mb-4 leading-tight">
            The cosmos received<br />
            <span className="italic text-[#e8dfc8]">
              {order?.fullName ? `${order.fullName}'s order` : "your order"}
            </span>
          </h1>
          <p className="text-white/50 font-light text-base max-w-md mx-auto leading-relaxed">
            Your personalized Holistic Growth Life Path book is reserved and will be printed and shipped to you.
            Just one last step — tell us where to send it.
          </p>
        </motion.div>

        {/* Cosmic Profile Badges */}
        {badges.some((b) => b.value) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="w-full mb-8"
          >
            <p className="text-white/30 text-[10px] tracking-[0.3em] uppercase text-center mb-4">Your Cosmic Profile</p>
            <div className="grid grid-cols-4 gap-3">
              {badges.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/8">
                  <Icon className="w-5 h-5 text-[#c9a84c]/80" />
                  <span className="text-[9px] tracking-widest uppercase text-white/30 text-center">{label}</span>
                  <span className="font-serif text-sm text-white text-center leading-tight">{value ?? "—"}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Lucky Numbers */}
        {order?.luckyNumbers && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="w-full mb-8 p-5 rounded-2xl bg-[#c9a84c]/8 border border-[#c9a84c]/20 flex items-center gap-4"
          >
            <div className="shrink-0 w-11 h-11 rounded-xl bg-[#c9a84c]/15 border border-[#c9a84c]/25 flex items-center justify-center">
              <Hash className="w-5 h-5 text-[#c9a84c]" />
            </div>
            <div>
              <p className="text-[10px] tracking-widest uppercase text-[#c9a84c]/60 mb-0.5">Your Lucky Numbers</p>
              <p className="font-serif text-xl text-white tracking-wide">{order.luckyNumbers}</p>
            </div>
          </motion.div>
        )}

        {/* Primary CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
          className="w-full mb-6"
        >
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center space-y-4">
            <p className="font-serif text-white/80 text-base">
              Where should we ship your hardcover book?
            </p>
            <Button
              onClick={() => setLocation(`/order/${id}/checkout`)}
              size="lg"
              className="w-full h-14 text-base font-semibold rounded-xl bg-[#c9a84c] hover:bg-[#b8953e] text-[#0e1b2a] shadow-[0_8px_30px_rgba(201,168,76,0.25)] transition-all"
            >
              Enter Shipping Address <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <p className="text-white/25 text-xs">Full-color hardcover · Printed &amp; shipped from the USA · 2–3 weeks</p>
          </div>
        </motion.div>

        {/* Referral Card */}
        {order?.referralCode !== undefined && order.referralCode !== null && (
          <div className="w-full mb-6">
            <ReferralCard
              referralCode={order.referralCode}
              referralCount={order.referralCount ?? 0}
            />
          </div>
        )}

        {/* What happens next */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="w-full rounded-2xl border border-white/8 bg-white/3 p-6 mb-8"
        >
          <p className="text-white/40 text-[10px] tracking-[0.3em] uppercase mb-4">What happens next</p>
          <div className="space-y-3">
            {[
              ["01", "You enter your shipping address on the next page"],
              ["02", "We send your book to our print partner (Lulu Press)"],
              ["03", "Your hardcover is printed in full color and shipped to you"],
              ["04", "Delivery typically takes 2–3 weeks from the order date"],
            ].map(([num, text]) => (
              <div key={num} className="flex items-start gap-3">
                <span className="text-[#c9a84c]/50 text-xs font-mono mt-0.5 shrink-0">{num}</span>
                <span className="text-white/50 text-sm leading-snug">{text}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <p className="text-white/20 text-xs text-center">
          Questions? Email us at{" "}
          <a href="mailto:hello@holigrowth.com" className="text-[#c9a84c]/50 hover:text-[#c9a84c] transition-colors underline underline-offset-2">
            hello@holigrowth.com
          </a>
        </p>
      </div>
    </div>
  );
}
