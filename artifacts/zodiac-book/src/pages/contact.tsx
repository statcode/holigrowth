import { Link } from "wouter";
import { ArrowLeft, Mail, Package, Sparkles, ShieldCheck, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";

// Update this if your support inbox changes. Pages that link to /contact
// will continue to work — only the mailto target needs to move.
const SUPPORT_EMAIL = "support@holigrowth.com";

export default function Contact() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="Contact Us — Holigrowth"
        description="Get in touch with Holigrowth about your personalised astrology book, order status, shipping, or anything else. We reply within 3 business days."
        path="/contact"
      />
      <header className="py-4 px-6 border-b border-border bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/"><img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-10 w-auto" /></Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 lg:py-20">
        <p className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium mb-3">Get in touch</p>
        <h1 className="text-4xl md:text-5xl font-serif text-foreground leading-tight mb-4">
          We're <span className="italic text-secondary">here</span>.
        </h1>
        <p className="text-foreground/75 leading-relaxed text-[1.05rem] max-w-xl mb-10">
          Order question, birth-detail correction, shipping update, or just want to say hello — we read every message. Expect a reply within <strong className="text-foreground">3 business days</strong>.
        </p>

        {/* Primary contact card */}
        <div className="rounded-2xl border border-border bg-white p-6 sm:p-8 shadow-sm mb-8">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">Email us</p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-xl font-serif text-foreground hover:text-primary transition-colors break-all"
              >
                {SUPPORT_EMAIL}
              </a>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                The fastest way to reach us. Please include your order number (if you have one) and a clear description of what you need.
              </p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-block mt-4">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl gap-2">
                  <MessageSquare className="w-4 h-4" /> Open my email client
                </Button>
              </a>
            </div>
          </div>
        </div>

        {/* Quick shortcuts */}
        <p className="text-xs uppercase tracking-widest text-muted-foreground mt-12 mb-4">Quick shortcuts</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <ShortcutCard
            icon={Package}
            title="Track my order"
            desc="See your shipping status, tracking number, and delivery estimate."
            href="/track"
            cta="Open tracker"
          />
          <ShortcutCard
            icon={Sparkles}
            title="Create a new book"
            desc="Start a fresh personalized book — yours or as a gift."
            href="/create"
            cta="Create my book"
          />
          <ShortcutCard
            icon={ShieldCheck}
            title="Privacy & data"
            desc="What we collect, who we share it with, and how to request deletion."
            href="/privacy"
            cta="Read the privacy policy"
          />
          <ShortcutCard
            icon={ShieldCheck}
            title="Terms of service"
            desc="Order terms, refund policy, intellectual-property rights."
            href="/terms"
            cta="Read the terms"
          />
        </div>

        <div className="mt-12 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-sm text-amber-900/80 leading-relaxed">
          <p>
            <strong className="text-amber-900">A friendly reminder.</strong> The Holigrowth Life Path book is for entertainment and self-reflection only. We can't give medical, financial, legal, or psychological advice. For real-world issues in any of those areas, please reach out to a qualified professional.
          </p>
        </div>
      </main>

      <footer className="py-8 px-6 border-t border-border bg-white">
        <div className="max-w-4xl mx-auto flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </div>
          <p>© {new Date().getFullYear()} Holigrowth. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

type IconType = typeof Mail;

function ShortcutCard({ icon: Icon, title, desc, href, cta }: {
  icon: IconType;
  title: string;
  desc: string;
  href: string;
  cta: string;
}) {
  return (
    <Link href={href} className="group block rounded-2xl border border-border bg-white p-5 hover:border-primary/40 hover:shadow-md transition-all">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-serif text-base text-foreground mb-1">{title}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">{desc}</p>
          <span className="text-xs font-medium text-primary group-hover:underline">{cta} →</span>
        </div>
      </div>
    </Link>
  );
}
