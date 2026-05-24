import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Check, WifiOff, RefreshCw, Clock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

function StarField() {
  const stars = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    x: (i * 137.508) % 100,
    y: (i * 73.14) % 100,
    size: (i % 3) + 1,
    delay: (i * 0.23) % 3,
    duration: 2.5 + (i % 3),
  }));
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map((s) => (
        <motion.div
          key={s.id}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size }}
          animate={{ opacity: [0.1, 0.7, 0.1], scale: [1, 1.3, 1] }}
          transition={{ repeat: Infinity, duration: s.duration, delay: s.delay, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function Orrery() {
  return (
    <div className="relative flex items-center justify-center w-48 h-48 mx-auto">
      <div className="absolute w-24 h-24 bg-[#c9a84c]/20 rounded-full blur-2xl" />
      <motion.div className="absolute w-44 h-44 rounded-full border border-white/10"
        animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 18, ease: "linear" }}>
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#6dccaa]/60" />
      </motion.div>
      <motion.div className="absolute w-32 h-32 rounded-full border border-[#c9a84c]/20"
        animate={{ rotate: -360 }} transition={{ repeat: Infinity, duration: 11, ease: "linear" }}>
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#c9a84c]/70" />
      </motion.div>
      <motion.div className="absolute w-20 h-20 rounded-full border border-purple-400/20"
        animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 6, ease: "linear" }}>
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-purple-400/60" />
      </motion.div>
      <motion.div
        className="relative z-10 w-12 h-12 rounded-full bg-[#c9a84c]/15 border border-[#c9a84c]/40 flex items-center justify-center"
        animate={{ scale: [1, 1.12, 1], boxShadow: ["0 0 0px rgba(201,168,76,0)", "0 0 20px rgba(201,168,76,0.35)", "0 0 0px rgba(201,168,76,0)"] }}
        transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
      >
        <Sparkles className="w-5 h-5 text-[#c9a84c]" />
      </motion.div>
    </div>
  );
}

const WRITING_PHASES = [
  "Consulting the ephemeris…",
  "Mapping your planetary aspects…",
  "Reading your birth chart…",
  "Calculating your life path number…",
  "Weaving your three pillars…",
  "Channeling your cosmic narrative…",
  "Inscribing your relationships chapter…",
  "Aligning your wealth blueprint…",
  "Encoding your health destiny…",
  "Composing your personal affirmations…",
];

const STAGE_LABELS: Record<string, { title: string; sub: string }> = {
  writing: { title: "Reading the Stars",     sub: "Your AI-powered astrologer is consulting the cosmos…" },
  pdf:     { title: "Typesetting Your Book", sub: "Laying out your full-color pages in perfect order…" },
  upload:  { title: "Securing Your Book",    sub: "Uploading and encrypting your personalized file…" },
};

const PROGRESS_STEPS = [
  { key: "writing", label: "Consulting the Cosmos" },
  { key: "pdf",     label: "Typesetting Pages" },
  { key: "upload",  label: "Securing Your File" },
  { key: "done",    label: "Book Ready" },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function getReassuranceMessage(seconds: number): string | null {
  if (seconds >= 300) return "Almost there — weaving the final cosmic threads…";
  if (seconds >= 180) return "Your reading is unusually detailed — thank you for your patience.";
  if (seconds >= 90)  return "Still crafting your chart — complex readings take 2–3 minutes.";
  return null;
}

function TimeoutScreen({ name, elapsedSeconds, onRetry, onKeepWaiting }: {
  name: string;
  elapsedSeconds: number;
  onRetry: () => void;
  onKeepWaiting: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center text-center max-w-sm mx-auto"
    >
      <motion.div
        className="w-20 h-20 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center mb-8"
        animate={{ boxShadow: ["0 0 0px rgba(245,158,11,0)", "0 0 30px rgba(245,158,11,0.25)", "0 0 0px rgba(245,158,11,0)"] }}
        transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
      >
        <Clock className="w-8 h-8 text-amber-400" />
      </motion.div>

      <p className="text-[#c9a84c]/60 text-[10px] tracking-[0.35em] uppercase mb-3">Generation Timeout</p>
      <h1 className="font-serif text-3xl text-white mb-3">Taking longer than expected</h1>
      <p className="text-white/40 text-sm leading-relaxed mb-2">
        {name}'s reading has been generating for <span className="text-amber-400/80">{formatElapsed(elapsedSeconds)}</span>.
      </p>
      <p className="text-white/30 text-sm leading-relaxed mb-10">
        The cosmic connection may have been interrupted. You can retry the generation — any existing progress will be preserved.
      </p>

      <div className="flex flex-col gap-3 w-full">
        <Button
          onClick={onRetry}
          className="h-12 w-full bg-[#c9a84c] hover:bg-[#c9a84c]/90 text-[#0e1b2a] font-medium rounded-xl gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Retry Generation
        </Button>
        <button
          onClick={onKeepWaiting}
          className="text-white/30 hover:text-white/60 text-sm transition-colors py-2"
        >
          Keep waiting — I think it's still running
        </button>
      </div>
    </motion.div>
  );
}

export function CosmicLoader({ name, location, email, stage, streamedText, elapsedSeconds = 0, sectionsTotal = 0, sectionsCompleted = [], isReconnecting = false, timedOut = false, onRetry, onKeepWaiting }: {
  name: string;
  location: string;
  email?: string;
  stage: "writing" | "pdf" | "upload" | "done";
  streamedText: string;
  elapsedSeconds?: number;
  /** Total sections the backend will generate (welcome + 13 chapters +
   *  closing = 15). Populated by the initial SSE event; 0 until then. */
  sectionsTotal?: number;
  /** Sections the backend has finished, in completion order. */
  sectionsCompleted?: { key: string; title: string }[];
  isReconnecting?: boolean;
  timedOut?: boolean;
  onRetry?: () => void;
  onKeepWaiting?: () => void;
}) {
  const [, setPhaseIdx] = useState(0);
  const [visibleMessage, setVisibleMessage] = useState(WRITING_PHASES[0]!);
  const activeStepIdx = PROGRESS_STEPS.findIndex((s) => s.key === stage);

  useEffect(() => {
    if (stage !== "writing") return;
    const t = setInterval(() => {
      setPhaseIdx((p) => {
        const next = (p + 1) % WRITING_PHASES.length;
        setVisibleMessage(WRITING_PHASES[next]!);
        return next;
      });
    }, 3200);
    return () => clearInterval(t);
  }, [stage]);

  const currentLabel = STAGE_LABELS[stage] ?? STAGE_LABELS["writing"]!;
  const reassurance = !timedOut ? getReassuranceMessage(elapsedSeconds) : null;

  return (
    <div className="min-h-screen bg-[#0e1b2a] text-white flex flex-col relative overflow-hidden">
      <StarField />
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-[#c9a84c]/7 rounded-full blur-[100px]" />

      <header className="py-4 px-6 border-b border-white/8 relative z-10">
        <div className="max-w-2xl mx-auto flex justify-center">
          <a href="/"><img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-8 w-auto brightness-0 invert opacity-80" /></a>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 relative z-10 max-w-2xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {timedOut ? (
            <TimeoutScreen
              key="timeout"
              name={name}
              elapsedSeconds={elapsedSeconds}
              onRetry={onRetry ?? (() => {})}
              onKeepWaiting={onKeepWaiting ?? (() => {})}
            />
          ) : (
            <motion.div key="generating" className="w-full flex flex-col items-center">
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7 }} className="mb-8">
                <Orrery />
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="text-center mb-6">
                <p className="text-[#c9a84c]/60 text-[10px] tracking-[0.35em] uppercase mb-3">Holistic Growth Life Path</p>
                <h1 className="font-serif text-3xl md:text-4xl text-white mb-2">{currentLabel.title}</h1>
                <p className="text-white/40 text-sm">{currentLabel.sub}</p>
              </motion.div>

              {/* Elapsed time + reconnecting indicator */}
              <div className="flex items-center gap-3 mb-6">
                {elapsedSeconds > 0 && (
                  <span className="text-[#c9a84c]/70 text-xs font-mono tabular-nums">
                    {formatElapsed(elapsedSeconds)}
                  </span>
                )}
                {isReconnecting && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1"
                  >
                    <WifiOff className="w-3 h-3 text-amber-400" />
                    <span className="text-amber-400 text-[10px] tracking-wide">Reconnecting — still working…</span>
                  </motion.div>
                )}
              </div>

              {/* Persistent "you can close this tab" reassurance — eases
                  the anxiety of a long generation by surfacing the email
                  the customer will get when the book is ready. Falls back
                  to a generic line when we don't have the address yet
                  (very rare — order.email is set at /create submission). */}
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="mb-5 px-4 py-2.5 rounded-2xl bg-white/4 border border-white/10 flex items-center gap-2.5 max-w-md"
              >
                <Mail className="w-4 h-4 text-[#c9a84c]/80 shrink-0" />
                <p className="text-white/65 text-xs leading-relaxed">
                  {email ? (
                    <>You can close this tab safely — we'll email <span className="text-white/90 font-medium">{email}</span> the moment your book is ready (≈ 5 min).</>
                  ) : (
                    <>You can close this tab safely — we'll email you the moment your book is ready (≈ 5 min).</>
                  )}
                </p>
              </motion.div>

              {/* Parallel-generation progress — only renders during the
                  writing stage and once the backend has told us the total.
                  Shows a live count and the last 4 completed section
                  titles with checkmarks, which makes the wait feel
                  productive ("ok, my book is actually being written")
                  instead of a static spinner. */}
              {stage === "writing" && sectionsTotal > 0 && (
                <div className="mb-6 w-full max-w-md">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[#c9a84c]/80 text-[10px] tracking-[0.25em] uppercase">Chapters written</span>
                    <span className="text-[#c9a84c] text-xs font-mono tabular-nums">{sectionsCompleted.length} / {sectionsTotal}</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-[#c9a84c]/70 to-[#c9a84c]"
                      animate={{ width: `${(sectionsCompleted.length / sectionsTotal) * 100}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                  {sectionsCompleted.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      <AnimatePresence initial={false}>
                        {sectionsCompleted.slice(-4).map((s) => (
                          <motion.li
                            key={s.key}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.35 }}
                            className="flex items-center gap-2 text-white/60 text-xs"
                          >
                            <Check className="w-3 h-3 text-[#c9a84c]/80 shrink-0" />
                            <span>{s.title}</span>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>
              )}

              {/* Rotating phase message */}
              <div className="h-7 mb-6 flex items-center justify-center">
                <AnimatePresence mode="wait">
                  {!isReconnecting ? (
                    <motion.p
                      key={stage === "writing" ? visibleMessage : stage}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.4 }}
                      className="text-white/50 text-sm font-light italic text-center"
                    >
                      {stage === "writing" ? `${visibleMessage} ✦ ${name}, born in ${location}` : (STAGE_LABELS[stage]?.sub ?? "")}
                    </motion.p>
                  ) : (
                    <motion.p
                      key="reconnecting"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="text-white/40 text-sm font-light italic text-center"
                    >
                      Your reading is still being written — this page will update automatically.
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              {/* Progress steps */}
              <div className="flex items-center gap-0 mb-8 w-full max-w-sm mx-auto">
                {PROGRESS_STEPS.map((step, i) => {
                  const done   = i < activeStepIdx;
                  const active = i === activeStepIdx;
                  const isLast = i === PROGRESS_STEPS.length - 1;
                  return (
                    <div key={step.key} className="flex items-center flex-1">
                      <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-500 ${
                          done   ? "bg-[#c9a84c]/25 border-[#c9a84c]/60"
                          : active ? "bg-[#c9a84c]/20 border-[#c9a84c] shadow-[0_0_12px_rgba(201,168,76,0.5)]"
                                   : "bg-white/5 border-white/15"
                        }`}>
                          {done ? (
                            <Check className="w-3 h-3 text-[#c9a84c]" />
                          ) : active ? (
                            <motion.div className="w-2 h-2 rounded-full bg-[#c9a84c]"
                              animate={{ scale: [1, 1.4, 1] }}
                              transition={{ repeat: Infinity, duration: 1.2 }}
                            />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                          )}
                        </div>
                        <span className={`text-[9px] text-center leading-tight max-w-[64px] ${done || active ? "text-white/60" : "text-white/20"}`}>
                          {step.label}
                        </span>
                      </div>
                      {!isLast && (
                        <div className="flex-1 h-px mx-1 mb-4 relative overflow-hidden">
                          <div className="absolute inset-0 bg-white/10" />
                          {done && <div className="absolute inset-0 bg-[#c9a84c]/40" />}
                          {active && (
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-[#c9a84c]/40 to-transparent"
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Timed reassurance message */}
              <AnimatePresence>
                {reassurance && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mb-6 px-4 py-2.5 rounded-full bg-[#c9a84c]/10 border border-[#c9a84c]/20 text-center"
                  >
                    <p className="text-[#c9a84c]/80 text-xs font-light">{reassurance}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {streamedText.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full rounded-2xl border border-white/8 bg-white/3 overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
                    <div className="w-2 h-2 rounded-full bg-[#c9a84c]/50 animate-pulse" />
                    <p className="text-white/30 text-[10px] tracking-widest uppercase">Live preview — your words are appearing</p>
                  </div>
                  <div className="p-5 max-h-36 overflow-y-auto font-serif text-sm leading-relaxed text-white/50 [mask-image:linear-gradient(to_bottom,white_60%,transparent)]">
                    {streamedText}
                    <motion.span
                      className="text-[#c9a84c]/60 ml-0.5"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                    >
                      ✦
                    </motion.span>
                  </div>
                </motion.div>
              )}

              <p className="text-white/20 text-xs text-center mt-8">
                This typically takes 60–90 seconds. Please keep this tab open.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
