import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ArrowLeft, Loader2, Sparkles, Gift, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useCreateZodiacOrder } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

const formSchema = z.object({
  fullName: z.string().min(2, "Please enter your full name."),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter a valid date (YYYY-MM-DD)"),
  birthTime: z.string().refine((v) => v === "" || /^\d{2}:\d{2}$/.test(v), "Please enter a valid time (HH:MM)"),
  birthLocation: z.string().min(2, "Please enter your birth city and country."),
  email: z.string().email("Please enter a valid email address."),
});

type FormValues = z.infer<typeof formSchema>;

const TOTAL_STEPS = 9;

const CheckIcon = () => (
  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

function SelectionCard({
  selected,
  onClick,
  icon,
  emoji,
  label,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  emoji?: string;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 py-10 px-6 transition-all duration-300 cursor-pointer focus:outline-none ${
        selected
          ? "border-primary bg-primary/8 shadow-[0_0_28px_-6px_rgba(1,91,92,0.3)]"
          : "border-border bg-white hover:border-primary/40 hover:bg-primary/3"
      }`}
    >
      {emoji && <span className="text-5xl select-none">{emoji}</span>}
      {icon && (
        <span className={`flex items-center justify-center w-14 h-14 rounded-full ${selected ? "bg-primary/15" : "bg-muted"} transition-colors`}>
          {icon}
        </span>
      )}
      <div className="text-center">
        <span className={`block text-xl font-serif font-medium ${selected ? "text-primary" : "text-foreground"}`}>
          {label}
        </span>
        {sub && <span className="block text-xs text-muted-foreground mt-1">{sub}</span>}
      </div>
      {selected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary flex items-center justify-center"
        >
          <CheckIcon />
        </motion.div>
      )}
    </button>
  );
}

export default function Create() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [intention, setIntention] = useState<"gift" | "myself" | null>(null);
  const [intentionError, setIntentionError] = useState(false);
  const [gender, setGender] = useState<"male" | "female" | null>(null);
  const [genderError, setGenderError] = useState(false);
  const [orientation, setOrientation] = useState<string | null>(null);
  const [orientationError, setOrientationError] = useState(false);
  const [relationshipStatus, setRelationshipStatus] = useState<string | null>(null);
  const [relationshipError, setRelationshipError] = useState(false);
  const [bdMonth, setBdMonth] = useState("");
  const [bdDay, setBdDay] = useState("");
  const [bdYear, setBdYear] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const search = useSearch();
  const refCode = new URLSearchParams(search).get("ref") ?? undefined;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      birthday: "",
      birthTime: "",
      birthLocation: "",
      email: "",
    },
  });

  const createOrder = useCreateZodiacOrder();

  const nextStep = async (fieldsToValidate?: (keyof FormValues)[]) => {
    if (step === 1) {
      const isValid = await form.trigger(["email"]);
      if (!isValid) return;
      // Fire-and-toast: don't block step transition on the marketing-list call,
      // but surface upstream failures so silent breakage like the MailerLite
      // Content-Type bug is visible.
      fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.getValues("email") }),
      })
        .then(async (res) => {
          if (res.ok) return;
          let detail = "";
          try {
            const body = (await res.json()) as { message?: string; upstreamStatus?: number };
            detail = body.message ? ` (${body.message})` : "";
          } catch {
            // ignore body parse errors — still show a generic toast
          }
          toast({
            variant: "destructive",
            title: "Couldn't add you to our list",
            description: `We'll keep going with your book — but our email signup hit an error${detail}. Please let us know if you don't get a confirmation.`,
          });
        })
        .catch(() => {
          toast({
            variant: "destructive",
            title: "Couldn't reach our email server",
            description: "Your book setup will continue — but we couldn't add you to our updates list. Check your connection or try again later.",
          });
        });
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!intention) { setIntentionError(true); return; }
      setIntentionError(false);
      setStep(3);
      return;
    }
    if (step === 3) {
      if (!gender) { setGenderError(true); return; }
      setGenderError(false);
      setStep(4);
      return;
    }
    if (step === 4) {
      if (!orientation) { setOrientationError(true); return; }
      setOrientationError(false);
      setStep(5);
      return;
    }
    if (step === 5) {
      if (!relationshipStatus) { setRelationshipError(true); return; }
      setRelationshipError(false);
      setStep(6);
      return;
    }
    if (fieldsToValidate) {
      const isValid = await form.trigger(fieldsToValidate);
      if (!isValid) return;
    }
    setStep((s) => s + 1);
  };

  const prevStep = () => setStep((s) => s - 1);

  const onSubmit = (data: FormValues) => {
    createOrder.mutate(
      { data: { ...data, intention: intention ?? undefined, gender: gender ?? undefined, sexualOrientation: (orientation ?? undefined) as import("@workspace/api-client-react").CreateZodiacOrderBodySexualOrientation | undefined, relationshipStatus: (relationshipStatus ?? undefined) as import("@workspace/api-client-react").CreateZodiacOrderBodyRelationshipStatus | undefined, referredBy: refCode, marketingOptIn } },
      {
        onSuccess: (order) => {
          setLocation(`/order/${order.id}?preview=1`);
        },
      }
    );
  };

  const containerVariants: import("framer-motion").Variants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.5 } },
    exit: { opacity: 0, x: -20, transition: { duration: 0.3 } },
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <SEO
        title="Create Your Holistic Growth Life Path Book — Holigrowth"
        description="Share your birth details and we'll write your personalised astrology and numerology book. Takes 2 minutes. Preview your opening chapters free — only order if you love it."
        path="/create"
      />
      <header className="py-4 px-6 border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-center">
          <a href="/">
            <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-9 w-auto" />
          </a>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-secondary/8 rounded-full blur-[100px] pointer-events-none" />

        <div className="w-full max-w-xl relative z-10">
          {/* Progress dots */}
          <div className="mb-12 flex items-center justify-center gap-2">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((i) => (
              <div key={i} className="flex items-center">
                <div
                  className={`w-3 h-3 rounded-full transition-colors duration-500 ${
                    step >= i ? "bg-primary shadow-[0_0_10px_rgba(1,91,92,0.4)]" : "bg-border"
                  }`}
                />
                {i < TOTAL_STEPS && (
                  <div className={`w-10 h-px transition-colors duration-500 ${step > i ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <AnimatePresence mode="wait">

                {/* ── Step 1: Email ── */}
                {step === 1 && (
                  <motion.div key="step1" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-8">
                    <div className="text-center mb-10">
                      <p className="text-secondary italic font-serif text-base mb-2">Holistic Growth Life Path</p>
                      <h2 className="text-3xl font-serif mb-4 text-foreground">Let's get started</h2>
                      <p className="text-muted-foreground font-light">
                        Enter your email so we can send your personalised book when it's ready.
                      </p>
                    </div>

                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-primary/80 uppercase tracking-widest text-xs">Email Address</FormLabel>
                        <FormControl>
                          <Input data-testid="input-email" type="email" placeholder="hello@example.com" className="h-14 text-lg bg-white border-border focus-visible:ring-primary" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <label className="flex items-start gap-3 cursor-pointer select-none group">
                      <span className="mt-0.5 flex-shrink-0">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={marketingOptIn}
                          onChange={(e) => setMarketingOptIn(e.target.checked)}
                        />
                        <span className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${marketingOptIn ? "bg-primary border-primary" : "bg-white border-border group-hover:border-primary/50"}`}>
                          {marketingOptIn && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground leading-relaxed">
                        Send me astrology insights, book updates, and exclusive Holigrowth offers.
                        <span className="block text-xs mt-0.5 text-muted-foreground/60">You can unsubscribe at any time.</span>
                      </span>
                    </label>

                    <Button
                      type="button"
                      className="w-full h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
                      onClick={() => nextStep()}
                    >
                      Continue <ChevronRight className="ml-2 w-5 h-5" />
                    </Button>
                  </motion.div>
                )}

                {/* ── Step 2: Intention ── */}
                {step === 2 && (
                  <motion.div key="step2" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-8">
                    <div className="text-center mb-10">
                      <p className="text-secondary italic font-serif text-base mb-2">Holistic Growth Life Path</p>
                      <h2 className="text-3xl font-serif mb-4 text-foreground">Who is this book for?</h2>
                      <p className="text-muted-foreground font-light">
                        This helps us set the right intention and energy throughout every page.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                      <SelectionCard
                        selected={intention === "gift"}
                        onClick={() => { setIntention("gift"); setIntentionError(false); }}
                        icon={<Gift className={`w-7 h-7 ${intention === "gift" ? "text-primary" : "text-muted-foreground"}`} />}
                        label="A Gift"
                        sub="For someone I love"
                      />
                      <SelectionCard
                        selected={intention === "myself"}
                        onClick={() => { setIntention("myself"); setIntentionError(false); }}
                        icon={<User className={`w-7 h-7 ${intention === "myself" ? "text-primary" : "text-muted-foreground"}`} />}
                        label="Myself"
                        sub="My own growth journey"
                      />
                    </div>

                    {intentionError && (
                      <p className="text-center text-sm text-destructive">Please choose one to continue.</p>
                    )}

                    <div className="flex gap-4">
                      <Button type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}>
                        <ArrowLeft className="w-5 h-5" />
                      </Button>
                      <Button
                        type="button"
                        className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
                        onClick={() => nextStep()}
                      >
                        Continue <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 3: Gender ── */}
                {step === 3 && (
                  <motion.div key="step3-gender" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-8">
                    <div className="text-center mb-10">
                      <p className="text-secondary italic font-serif text-base mb-2">Holistic Growth Life Path</p>
                      <h2 className="text-3xl font-serif mb-4 text-foreground">
                        {intention === "gift" ? "Their energy is…" : "Your energy is…"}
                      </h2>
                      <p className="text-muted-foreground font-light">
                        We'll use this to shape the tone and language throughout the book.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                      <SelectionCard
                        selected={gender === "female"}
                        onClick={() => { setGender("female"); setGenderError(false); }}
                        emoji="♀"
                        label="Female"
                      />
                      <SelectionCard
                        selected={gender === "male"}
                        onClick={() => { setGender("male"); setGenderError(false); }}
                        emoji="♂"
                        label="Male"
                      />
                    </div>

                    {genderError && (
                      <p className="text-center text-sm text-destructive">Please select one to continue.</p>
                    )}

                    <div className="flex gap-4">
                      <Button type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}>
                        <ArrowLeft className="w-5 h-5" />
                      </Button>
                      <Button type="button" className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl" onClick={() => nextStep()}>
                        Continue <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 4: Sexual Orientation ── */}
                {step === 4 && (
                  <motion.div key="step4-orientation" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-8">
                    <div className="text-center mb-10">
                      <p className="text-secondary italic font-serif text-base mb-2">For a more accurate book</p>
                      <h2 className="text-3xl font-serif mb-4 text-foreground">
                        {intention === "gift" ? "Are they gay or straight?" : "Are you gay or straight?"}
                      </h2>
                      <p className="text-muted-foreground font-light leading-relaxed">
                        This shapes who your <strong>Relationships chapter</strong> is written for — same-sex, opposite-sex, or both. Your book will be far more accurate and personal with this detail.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { value: "straight", emoji: "💑", label: "Straight", sub: "Attracted to the opposite sex" },
                        { value: "gay",      emoji: "🏳️‍🌈", label: "Gay / Lesbian", sub: "Attracted to the same sex" },
                        { value: "bisexual", emoji: "💜", label: "Bisexual", sub: "Attracted to both" },
                        { value: "prefer_not_to_say", emoji: "🤍", label: "Prefer not to say", sub: "Skip this detail" },
                      ].map(({ value, emoji, label, sub }) => (
                        <SelectionCard
                          key={value}
                          selected={orientation === value}
                          onClick={() => { setOrientation(value); setOrientationError(false); }}
                          emoji={emoji}
                          label={label}
                          sub={sub}
                        />
                      ))}
                    </div>

                    {orientationError && (
                      <p className="text-center text-sm text-destructive">Please select one to continue.</p>
                    )}

                    <div className="flex gap-4">
                      <Button type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}>
                        <ArrowLeft className="w-5 h-5" />
                      </Button>
                      <Button type="button" className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl" onClick={() => nextStep()}>
                        Continue <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 5: Relationship Status ── */}
                {step === 5 && (
                  <motion.div key="step5-relationship" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-8">
                    <div className="text-center mb-10">
                      <p className="text-secondary italic font-serif text-base mb-2">For a more accurate book</p>
                      <h2 className="text-3xl font-serif mb-4 text-foreground">
                        {intention === "gift" ? "Are they single or not?" : "Are you single or not?"}
                      </h2>
                      <p className="text-muted-foreground font-light leading-relaxed">
                        Whether {intention === "gift" ? "they're" : "you're"} single, married, or healing from a past relationship completely changes the <strong>Relationships chapter</strong> — we write exactly what's relevant to {intention === "gift" ? "their" : "your"} life right now.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { value: "single",          emoji: "🌟", label: "Single",             sub: "Ready to attract love" },
                        { value: "in_relationship", emoji: "💞", label: "In a Relationship",  sub: "Dating or committed" },
                        { value: "married",         emoji: "💍", label: "Married",             sub: "Legally wed" },
                        { value: "divorced",        emoji: "🌱", label: "Divorced",            sub: "Starting fresh" },
                        { value: "widowed",         emoji: "🕊️",  label: "Widowed",            sub: "Honouring the past" },
                        { value: "not_seeking",     emoji: "🧘", label: "Not Seeking",        sub: "Focused on self" },
                      ].map(({ value, emoji, label, sub }) => (
                        <SelectionCard
                          key={value}
                          selected={relationshipStatus === value}
                          onClick={() => { setRelationshipStatus(value); setRelationshipError(false); }}
                          emoji={emoji}
                          label={label}
                          sub={sub}
                        />
                      ))}
                    </div>

                    {relationshipError && (
                      <p className="text-center text-sm text-destructive">Please select one to continue.</p>
                    )}

                    <div className="flex gap-4">
                      <Button type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}>
                        <ArrowLeft className="w-5 h-5" />
                      </Button>
                      <Button type="button" className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl" onClick={() => nextStep()}>
                        Continue <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 6: Name ── */}
                {step === 6 && (
                  <motion.div key="step6-name" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
                    <div className="text-center mb-10">
                      <p className="text-secondary italic font-serif text-base mb-2">Holistic Growth Life Path</p>
                      <h2 className="text-3xl font-serif mb-4 text-foreground">
                        {intention === "gift" ? "Their full name" : "Your full name"}
                      </h2>
                      <p className="text-muted-foreground font-light">Enter the name as it should appear on the cover.</p>
                    </div>
                    <FormField control={form.control} name="fullName" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-primary/80 uppercase tracking-widest text-xs">Full Name</FormLabel>
                        <FormControl>
                          <Input data-testid="input-fullname" placeholder="e.g. Eleanor Vance" className="h-14 text-lg bg-white border-border focus-visible:ring-primary" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="flex gap-4">
                      <Button type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}><ArrowLeft className="w-5 h-5" /></Button>
                      <Button data-testid="button-next-step1" type="button" className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl" onClick={() => nextStep(["fullName"])}>
                        Continue <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 7: Birthday & Time ── */}
                {step === 7 && (
                  <motion.div key="step7-birthday" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
                    <div className="text-center mb-10">
                      <h2 className="text-3xl font-serif mb-4 text-foreground">The Exact Moment</h2>
                      <p className="text-muted-foreground font-light">To calculate the positions of the stars and your numerology.</p>
                    </div>

                    <FormField control={form.control} name="birthday" render={({ field }) => {
                      const syncField = (y: string, m: string, d: string) => {
                        if (y && m && d) {
                          field.onChange(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
                        } else {
                          field.onChange("");
                        }
                      };

                      const daysInMonth = bdYear && bdMonth
                        ? new Date(Number(bdYear), Number(bdMonth), 0).getDate()
                        : 31;
                      const currentYear = new Date().getFullYear();
                      const years = Array.from({ length: currentYear - 1919 }, (_, i) => String(currentYear - i));
                      const months = [
                        ["01","January"],["02","February"],["03","March"],["04","April"],
                        ["05","May"],["06","June"],["07","July"],["08","August"],
                        ["09","September"],["10","October"],["11","November"],["12","December"],
                      ];
                      const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
                      const selectCls = "flex-1 h-14 bg-white border border-border rounded-xl px-4 text-base text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors";

                      return (
                        <FormItem>
                          <FormLabel className="text-primary/80 uppercase tracking-widest text-xs">Birth Date</FormLabel>
                          <FormControl>
                            <div className="grid grid-cols-3 gap-3" data-testid="input-birthday">
                              <div className="relative">
                                <select
                                  value={bdMonth}
                                  onChange={(e) => { setBdMonth(e.target.value); syncField(bdYear, e.target.value, bdDay); }}
                                  className={selectCls}
                                >
                                  <option value="">Month</option>
                                  {months.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                                </select>
                              </div>
                              <div className="relative">
                                <select
                                  value={bdDay}
                                  onChange={(e) => { setBdDay(e.target.value); syncField(bdYear, bdMonth, e.target.value); }}
                                  className={selectCls}
                                >
                                  <option value="">Day</option>
                                  {days.map((d) => <option key={d} value={d}>{d}</option>)}
                                </select>
                              </div>
                              <div className="relative">
                                <select
                                  value={bdYear}
                                  onChange={(e) => { setBdYear(e.target.value); syncField(e.target.value, bdMonth, bdDay); }}
                                  className={selectCls}
                                >
                                  <option value="">Year</option>
                                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                                </select>
                              </div>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }} />

                    <FormField control={form.control} name="birthTime" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-primary/80 uppercase tracking-widest text-xs">Birth Time <span className="normal-case tracking-normal font-normal text-muted-foreground">(Optional)</span></FormLabel>
                        <FormControl>
                          <input
                            data-testid="input-birthtime"
                            type="time"
                            className="w-full h-14 bg-white border border-border rounded-xl px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                            {...field}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground/70 mt-1">If unknown, use 12:00. Exact time gives a more precise Rising sign and lucky numbers.</p>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <div className="flex gap-4">
                      <Button data-testid="button-prev-step2" type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}><ArrowLeft className="w-5 h-5" /></Button>
                      <Button data-testid="button-next-step2" type="button" className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl" onClick={() => nextStep(["birthday"])}>
                        Continue <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 8: Location ── */}

                {step === 8 && (
                  <motion.div key="step8-location" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
                    <div className="text-center mb-10">
                      <h2 className="text-3xl font-serif mb-4 text-foreground">The Place of Arrival</h2>
                      <p className="text-muted-foreground font-light">Where on Earth did this journey begin?</p>
                    </div>
                    <FormField control={form.control} name="birthLocation" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-primary/80 uppercase tracking-widest text-xs">Birth Place</FormLabel>
                        <FormControl>
                          <Input data-testid="input-birthlocation" placeholder="e.g. London, UK" className="h-14 text-lg bg-white border-border focus-visible:ring-primary" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="flex gap-4">
                      <Button data-testid="button-prev-step3" type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}><ArrowLeft className="w-5 h-5" /></Button>
                      <Button data-testid="button-next-step3" type="button" className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl" onClick={() => nextStep(["birthLocation"])}>
                        Continue <ChevronRight className="ml-2 w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* ── Step 9: Order Summary ── */}
                {step === 9 && (
                  <motion.div key="step9-summary" variants={containerVariants} initial="hidden" animate="visible" exit="exit" className="space-y-6">
                    <div className="text-center mb-10">
                      <h2 className="text-3xl font-serif mb-4 text-foreground">Almost There</h2>
                      <p className="text-muted-foreground font-light">Review your details before we start generating your book.</p>
                    </div>

                    <div className="p-6 rounded-xl bg-muted border border-border">
                      <h3 className="font-serif text-xl mb-4 text-primary">Your Order Summary</h3>
                      <div className="space-y-2 text-sm text-foreground/80">
                        <p><span className="text-muted-foreground w-28 inline-block">Book for:</span> {intention === "gift" ? "🎁 A Gift" : "🙋 Myself"}</p>
                        <p><span className="text-muted-foreground w-28 inline-block">Energy:</span> {gender === "female" ? "♀ Female" : "♂ Male"}</p>
                        <p><span className="text-muted-foreground w-28 inline-block">Name:</span> {form.getValues("fullName")}</p>
                        <p><span className="text-muted-foreground w-28 inline-block">Date:</span> {form.getValues("birthday")}</p>
                        <p><span className="text-muted-foreground w-28 inline-block">Time:</span> {form.getValues("birthTime")}</p>
                        <p><span className="text-muted-foreground w-28 inline-block">Location:</span> {form.getValues("birthLocation")}</p>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <Button type="button" variant="outline" className="h-14 px-6 border-border hover:bg-muted rounded-xl" onClick={prevStep}><ArrowLeft className="w-5 h-5" /></Button>
                      <Button
                        data-testid="button-submit"
                        type="submit"
                        disabled={createOrder.isPending}
                        className="flex-1 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl shadow-[0_6px_24px_rgba(1,91,92,0.3)]"
                      >
                        {createOrder.isPending ? (
                          <Loader2 className="w-6 h-6 animate-spin" />
                        ) : (
                          <>Preview Book <Sparkles className="ml-2 w-5 h-5" /></>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </form>
          </Form>
        </div>
      </main>
    </div>
  );
}
