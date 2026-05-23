import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

const LAST_UPDATED = "May 22, 2026";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
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
        <h1 className="text-4xl md:text-5xl font-serif text-foreground leading-tight mb-3">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-8 text-foreground/80 leading-relaxed">
          <p>
            Holigrowth ("we", "us", "our") makes personalized astrology and numerology books from the birth details you share with us. This Privacy Policy explains what we collect, how we use it, and the choices you have.
          </p>

          <Section title="1. Information we collect">
            <p>To create your book and ship it to you, we collect:</p>
            <ul className="list-disc pl-6 space-y-1.5 mt-2">
              <li><strong>Birth details</strong> — your full name, date of birth, time of birth (if provided), and place of birth. These are required to calculate your sun, moon, rising, life path, and other placements.</li>
              <li><strong>Contact info</strong> — the email address you provide at checkout. We use it for order updates, your book-ready notification, and (with your consent) occasional product announcements.</li>
              <li><strong>Shipping address</strong> — collected by our payment processor at checkout and passed to our print partner so we can ship your hardcover book.</li>
              <li><strong>Payment info</strong> — handled entirely by Stripe. We never see, store, or have access to your full card number.</li>
              <li><strong>Optional profile details</strong> — gender, sexual orientation, and relationship status (only when you supply them). These help tailor the Relationships chapter pronouns and tone. They are never displayed publicly or shared.</li>
            </ul>
          </Section>

          <Section title="2. How we use your information">
            <ul className="list-disc pl-6 space-y-1.5">
              <li>To generate your personalized book content from your birth chart and name.</li>
              <li>To fulfill, print, and ship your hardcover book through our print partner.</li>
              <li>To send you order confirmation, book-ready, and shipping update emails.</li>
              <li>To answer your support emails when you reach out to us.</li>
              <li>To improve the book's writing quality and the site experience over time.</li>
            </ul>
          </Section>

          <Section title="3. Who we share with (sub-processors)">
            <p>We use a small set of trusted third-party services to operate the book pipeline. Each is contractually bound to handle your data securely, and none of them sells your data:</p>
            <ul className="list-disc pl-6 space-y-1.5 mt-2">
              <li><strong>Stripe</strong> — processes your payment at checkout.</li>
              <li><strong>Lulu Press</strong> — prints and ships your hardcover book from the United States.</li>
              <li><strong>MailerLite</strong> — sends your order confirmation and book-ready emails.</li>
              <li><strong>OpenRouter</strong> — routes the AI prompt that drafts your book content. Only the birth details needed for the prompt are sent; no payment info, no email address.</li>
            </ul>
          </Section>

          <Section title="4. Cookies & analytics">
            <p>
              We use minimal first-party cookies to remember your shopping cart state and your admin session (if you are an admin). We do not run third-party advertising or tracking cookies on this site.
            </p>
          </Section>

          <Section title="5. Your rights">
            <ul className="list-disc pl-6 space-y-1.5">
              <li><strong>Access</strong> — email us and we will share what we have stored about you.</li>
              <li><strong>Correction</strong> — if any of your details are wrong, we will update them.</li>
              <li><strong>Deletion</strong> — you can request that we delete your order and book content; we will honor it unless we are legally required to retain it (e.g. tax records).</li>
              <li><strong>Marketing opt-out</strong> — every email we send has an unsubscribe link at the bottom.</li>
            </ul>
          </Section>

          <Section title="6. Data retention">
            <p>
              We keep your order details for as long as needed to support you, fulfill warranty/reprint requests, and comply with tax and accounting obligations. After that, we either delete the data or anonymize it.
            </p>
          </Section>

          <Section title="7. Children's privacy">
            <p>
              Holigrowth is intended for adults (18+). We do not knowingly collect information from anyone under 18. If you believe a minor has placed an order, please contact us and we will delete the data and refund any payment.
            </p>
          </Section>

          <Section title="8. Security">
            <p>
              Your payment is processed over TLS by Stripe — we never see your card. Your birth details and order records are stored in a managed database with restricted access. We do our best to keep your information safe, but no online service is 100% impervious; if a breach affects you, we will notify you promptly.
            </p>
          </Section>

          <Section title="9. International users">
            <p>
              We ship from the United States. If you are visiting from outside the US, your information will be processed in the US under our policies. By using the site you consent to that transfer.
            </p>
          </Section>

          <Section title="10. Changes to this policy">
            <p>
              We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date above. Material changes will also be announced on the homepage.
            </p>
          </Section>

          <Section title="11. Contact us">
            <p>
              Questions about your data or this policy? Reach out via the <Link href="/contact" className="text-primary hover:underline">Contact</Link> page and we will respond within 3 business days.
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
