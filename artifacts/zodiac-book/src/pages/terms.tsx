import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { SEO } from "@/components/SEO";

const LAST_UPDATED = "May 22, 2026";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="Terms of Service — Holigrowth"
        description="Holigrowth Terms of Service: order policy, refund and reprint policy, intellectual property, and the disclaimer that the book is for entertainment and self-reflection only."
        path="/terms"
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
        <p className="text-xs tracking-[0.2em] uppercase text-primary/70 font-medium mb-3">Legal</p>
        <h1 className="text-4xl md:text-5xl font-serif text-foreground leading-tight mb-3">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-8 text-foreground/80 leading-relaxed">
          <p>
            Welcome to Holigrowth. These Terms of Service ("Terms") govern your use of our website and the personalized Holistic Growth Life Path book ("the Book") we create and ship. By placing an order, you agree to these Terms.
          </p>

          <Section title="1. The book is for self-reflection only">
            <p>
              <strong>Important.</strong> The content of your Book is generated for entertainment, self-reflection, and personal enrichment. It draws on astrology and numerology — traditions that are not scientifically validated and are not a substitute for professional advice. Nothing in your Book is medical, psychological, financial, legal, or relationship counseling. If you need guidance in any of those areas, please consult a qualified professional.
            </p>
          </Section>

          <Section title="2. Eligibility">
            <p>You must be at least 18 years old to place an order. By submitting your order you confirm you are 18 or older and that the birth details you provide are accurate to the best of your knowledge.</p>
          </Section>

          <Section title="3. Your order">
            <ul className="list-disc pl-6 space-y-1.5">
              <li>When you submit your birth details, we generate your Book content and create a free preview of the opening chapters.</li>
              <li>You only pay if you choose to order the physical hardcover. Pricing is shown at checkout and processed by Stripe.</li>
              <li>Once payment clears, we send the print file to our partner, who prints and ships from the United States.</li>
              <li>Typical fulfillment is 2–3 weeks from order to your door. Shipping times outside the US may be longer.</li>
            </ul>
          </Section>

          <Section title="4. Personalization disclaimer">
            <p>
              We use your name, birth date, birth time (if supplied), and birth location to calculate your placements. If any of those details are wrong, the Book will be calculated from the wrong data. We are not responsible for corrections requested after your Book has been printed — please double-check your details before checkout.
            </p>
          </Section>

          <Section title="5. Refunds & returns">
            <p>
              Because each Book is custom-printed for you, we cannot accept "change of mind" returns once it has shipped. We will, however, reprint or refund in the following situations:
            </p>
            <ul className="list-disc pl-6 space-y-1.5 mt-2">
              <li><strong>Print defect</strong> — torn pages, binding issues, missing pages, severe ink problems. Send us a photo within 14 days of delivery and we will reprint at no charge.</li>
              <li><strong>Lost in transit</strong> — if your Book is not delivered within 6 weeks of shipping and tracking does not show any movement, we will reprint or refund.</li>
              <li><strong>Wrong item</strong> — if the Book that arrives is not the Book you ordered, we will reprint or refund.</li>
            </ul>
            <p className="mt-2">
              Refunds are issued to the original payment method. Reprints are free of charge and ship via our standard service.
            </p>
          </Section>

          <Section title="6. Intellectual property">
            <p>
              Your printed Book is yours to keep, read, gift, and re-read for personal use. The cover artwork, template designs, and book text are licensed to you for personal, non-commercial use. You may not redistribute, resell, mass-reproduce, or publish your Book's content (in print or digital form) without our written permission.
            </p>
            <p>
              The Holigrowth name, logo, and site design are our property. Do not use them to misrepresent affiliation with us.
            </p>
          </Section>

          <Section title="7. Acceptable use">
            <p>
              You agree not to use the site to: (a) abuse, harass, or impersonate others; (b) submit malicious code or attempt to disrupt the service; (c) place orders with information you know to be false; (d) circumvent technical limitations or scrape the site at scale.
            </p>
          </Section>

          <Section title="8. Service availability">
            <p>
              We do our best to keep the site online, but we don't guarantee uptime. We may take the site down for maintenance, change features, or end-of-life the product with reasonable notice. If you have an undelivered order when we shut down, you will be refunded.
            </p>
          </Section>

          <Section title="9. Disclaimer of warranties">
            <p>
              The site and the Book are provided "as is" without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Book will be free of typographical errors or that the AI-assisted prose will be perfectly accurate to every detail of your chart — astrology software varies in its calculation methods.
            </p>
          </Section>

          <Section title="10. Limitation of liability">
            <p>
              To the maximum extent permitted by law, Holigrowth and its operators are not liable for indirect, incidental, special, or consequential damages arising out of your use of the site or your Book. Our total liability for any claim is capped at the amount you paid us in the 12 months before the claim arose.
            </p>
          </Section>

          <Section title="11. Indemnification">
            <p>
              You agree to indemnify and hold us harmless from any claim arising out of (a) your misuse of the site, (b) your violation of these Terms, or (c) your violation of any rights of a third party.
            </p>
          </Section>

          <Section title="12. Governing law">
            <p>
              These Terms are governed by the laws of the State of California, USA, without regard to conflict-of-law principles. Any dispute that cannot be resolved informally will be brought in the state or federal courts of California.
            </p>
          </Section>

          <Section title="13. Changes to these Terms">
            <p>
              We may update these Terms occasionally. When we do, we will update the "Last updated" date above. Material changes will be announced on the homepage; continued use of the site after a change means you accept the new Terms.
            </p>
          </Section>

          <Section title="14. Contact us">
            <p>
              Questions about these Terms or your order? Reach out via the <Link href="/contact" className="text-primary hover:underline">Contact</Link> page and we will respond within 3 business days.
            </p>
          </Section>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-serif text-foreground mb-3">{title}</h2>
      <div className="text-foreground/80 leading-relaxed">{children}</div>
    </section>
  );
}
