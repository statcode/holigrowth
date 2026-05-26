import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SEO } from "@/components/SEO";
import {
  Search, Sun, Moon, Star, Hash, MapPin, Package, Printer,
  Truck, CheckCircle2, Clock, AlertCircle, RefreshCw, ExternalLink,
  ChevronDown, ChevronUp, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";

interface OrderData {
  id: number;
  fullName: string;
  birthday: string;
  status: string;
  sunSign?: string | null;
  moonSign?: string | null;
  risingSign?: string | null;
  lifePath?: string | null;
  luckyNumbers?: string | null;
  shippingAddress?: string | null;
  luluStatus?: string | null;
  luluOrderId?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  estimatedDelivery?: string | null;
  generatedContent?: string | null;
  createdAt: string;
  priceUsd?: number | null;
  referralCode?: string | null;
}

const STATUS_STEPS = [
  { key: "confirmed",  label: "Payment\nConfirmed",  icon: CheckCircle2, statuses: ["pending_payment", "pending"] },
  { key: "generated",  label: "Book\nGenerated",     icon: Hash,         statuses: ["generating", "generating_pdf", "generated"] },
  { key: "printing",   label: "At the\nPrinter",     icon: Printer,      statuses: ["submitting", "processing"] },
  { key: "shipped",    label: "On the\nWay",          icon: Truck,        statuses: ["shipped"] },
  { key: "delivered",  label: "Delivered",            icon: Package,      statuses: ["delivered"] },
];

function getStepIndex(status: string): number {
  for (let i = STATUS_STEPS.length - 1; i >= 0; i--) {
    if (STATUS_STEPS[i]!.statuses.includes(status)) return i;
  }
  return 0;
}

const LULU_STATUS_LABELS: Record<string, string> = {
  CREATED:              "Order Created",
  UNPAID:               "Awaiting Payment",
  PAYMENT_IN_PROGRESS:  "Payment Processing",
  PRODUCTION_READY:     "Ready for Production",
  IN_PRODUCTION:        "Being Printed",
  SHIPPED:              "Shipped",
  DELIVERED:            "Delivered",
  REJECTED:             "Rejected",
  DEMO_ORDER:           "Demo Order",
  UNKNOWN:              "Checking status…",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    pending_payment: { label: "Awaiting Payment",  color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" },
    pending:         { label: "Payment Confirmed", color: "bg-teal-500/15 text-teal-400 border-teal-500/25" },
    generating:      { label: "Generating Book",   color: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
    generating_pdf:  { label: "Creating PDF",      color: "bg-purple-500/15 text-purple-400 border-purple-500/25" },
    generated:       { label: "Book Ready",        color: "bg-green-500/15 text-green-400 border-green-500/25" },
    submitting:      { label: "Sending to Print",  color: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
    processing:      { label: "Being Printed",     color: "bg-blue-500/15 text-blue-400 border-blue-500/25" },
    shipped:         { label: "Shipped! 📦",        color: "bg-[#c9a84c]/15 text-[#c9a84c] border-[#c9a84c]/25" },
    delivered:       { label: "Delivered ✓",       color: "bg-green-500/15 text-green-400 border-green-500/25" },
    failed:          { label: "Error",             color: "bg-red-500/15 text-red-400 border-red-500/25" },
  };
  const s = map[status] ?? { label: status, color: "bg-white/10 text-white/60 border-white/15" };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${s.color}`}>
      {s.label}
    </span>
  );
}

function ProgressTrack({ status }: { status: string }) {
  const activeIdx = getStepIndex(status);
  return (
    <div className="w-full py-4">
      <div className="flex items-start justify-between relative">
        <div className="absolute top-4 left-0 right-0 h-px bg-white/10 z-0" />
        <div
          className="absolute top-4 left-0 h-px bg-[#c9a84c]/50 z-0 transition-all duration-700"
          style={{ width: `${(activeIdx / (STATUS_STEPS.length - 1)) * 100}%` }}
        />
        {STATUS_STEPS.map((step, i) => {
          const done   = i < activeIdx;
          const active = i === activeIdx;
          const Icon   = step.icon;
          return (
            <div key={step.key} className="flex flex-col items-center gap-2 z-10" style={{ width: `${100 / STATUS_STEPS.length}%` }}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-500 ${
                done   ? "bg-[#c9a84c]/20 border-[#c9a84c]/50"
                : active ? "bg-[#c9a84c]/30 border-[#c9a84c] shadow-[0_0_12px_rgba(201,168,76,0.4)]"
                         : "bg-white/5 border-white/15"
              }`}>
                <Icon className={`w-3.5 h-3.5 ${done || active ? "text-[#c9a84c]" : "text-white/25"}`} />
              </div>
              <span className={`text-[10px] text-center leading-tight whitespace-pre-line ${done || active ? "text-white/70" : "text-white/25"}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrackingBanner({ order }: { order: OrderData }) {
  if (!order.trackingNumber && !order.trackingUrl && order.status !== "shipped" && order.status !== "delivered") return null;

  const hasTracking = !!(order.trackingNumber || order.trackingUrl);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mx-5 mb-1 rounded-xl border p-4 flex items-center gap-3 ${
        order.status === "delivered"
          ? "bg-green-500/10 border-green-500/25"
          : "bg-[#c9a84c]/8 border-[#c9a84c]/25"
      }`}
    >
      <Truck className={`w-4 h-4 flex-shrink-0 ${order.status === "delivered" ? "text-green-400" : "text-[#c9a84c]"}`} />
      <div className="flex-1 min-w-0">
        {hasTracking && (
          <p className="text-white/80 text-sm font-medium mb-0.5">
            Tracking: <span className="font-mono text-[#c9a84c]">{order.trackingNumber ?? "Available"}</span>
          </p>
        )}
        {order.estimatedDelivery && (
          <p className="text-white/40 text-xs">
            Estimated delivery: {new Date(order.estimatedDelivery).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        )}
        {!order.estimatedDelivery && order.status === "shipped" && (
          <p className="text-white/40 text-xs">Typically arrives 2–3 weeks after order date</p>
        )}
      </div>
      {order.trackingUrl && (
        <a
          href={order.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1.5 text-xs text-[#c9a84c] hover:text-[#e8c96e] transition-colors font-medium"
        >
          Track <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </motion.div>
  );
}

function OrderCard({ order }: { order: OrderData }) {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(false);

  const orderDate = new Date(order.createdAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });

  const badges = [
    { icon: Sun,  label: "Sun",    value: order.sunSign },
    { icon: Moon, label: "Moon",   value: order.moonSign },
    { icon: Star, label: "Rising", value: order.risingSign },
    { icon: Hash, label: "Life",   value: order.lifePath ? `#${order.lifePath}` : null },
  ].filter((b) => b.value);

  const luluLabel = order.luluStatus ? (LULU_STATUS_LABELS[order.luluStatus] ?? order.luluStatus) : null;

  const isActive = ["processing", "shipped"].includes(order.status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border overflow-hidden transition-colors ${
        isActive ? "border-[#c9a84c]/20 bg-white/4" : "border-white/10 bg-white/4"
      }`}
    >
      {/* Card header */}
      <div className="p-5 border-b border-white/8 flex items-start justify-between gap-4">
        <div>
          <p className="text-white/35 text-xs mb-1">Order #{order.id} · {orderDate}</p>
          <p className="font-serif text-lg text-white leading-tight">{order.fullName}</p>
          {luluLabel && (
            <p className="text-white/30 text-xs mt-0.5">Print status: {luluLabel}</p>
          )}
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Progress track */}
      <div className="px-5 pb-2 pt-4 border-b border-white/8">
        <ProgressTrack status={order.status} />
      </div>

      {/* Tracking banner — shown inline when shipped */}
      <TrackingBanner order={order} />

      {/* Details toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between text-white/40 hover:text-white/60 transition-colors border-b border-white/8 text-xs uppercase tracking-widest"
      >
        <span>Order Details</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            {/* Cosmic profile */}
            {badges.length > 0 && (
              <div className="px-5 py-4 border-b border-white/8">
                <p className="text-white/30 text-[10px] tracking-widest uppercase mb-3">Cosmic Profile</p>
                <div className="flex flex-wrap gap-2">
                  {badges.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                      <Icon className="w-3 h-3 text-[#c9a84c]/70" />
                      <span className="text-white/40 text-xs">{label}:</span>
                      <span className="text-white text-xs font-medium">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lucky numbers */}
            {order.luckyNumbers && (
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-3">
                <Hash className="w-3.5 h-3.5 text-[#c9a84c]/50 flex-shrink-0" />
                <span className="text-white/35 text-xs">Lucky Numbers:</span>
                <span className="text-[#c9a84c] text-sm font-semibold tracking-wide">{order.luckyNumbers}</span>
              </div>
            )}

            {/* Shipping address */}
            {order.shippingAddress && (
              <div className="px-5 py-3 border-b border-white/8 flex items-start gap-3">
                <MapPin className="w-3.5 h-3.5 text-white/30 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-white/30 text-xs mb-0.5">Shipping to</p>
                  <p className="text-white/60 text-xs leading-relaxed">{order.shippingAddress}</p>
                </div>
              </div>
            )}

            {/* Lulu order ID */}
            {order.luluOrderId && (
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-3">
                <Printer className="w-3.5 h-3.5 text-white/25 flex-shrink-0" />
                <span className="text-white/25 text-xs">Print job:</span>
                <span className="text-white/40 text-xs font-mono">{order.luluOrderId}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action footer */}
      <div className="px-5 py-3 flex items-center justify-between gap-3">
        {order.status === "generated" && (
          <Button
            size="sm"
            onClick={() => setLocation(`/order/${order.id}/checkout`)}
            className="h-9 px-4 bg-[#c9a84c] hover:bg-[#b8953e] text-[#0e1b2a] text-xs font-semibold rounded-lg gap-1.5"
          >
            Order My Hardcover <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        )}
        {order.status === "delivered" && (
          <p className="text-green-400/70 text-xs flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Your book has been delivered!
          </p>
        )}
        {!["generated", "delivered"].includes(order.status) && (
          <p className="text-white/25 text-xs">
            {order.status === "processing"
              ? "Printing typically takes 7–10 business days"
              : order.status === "shipped"
              ? "Your book is on its way! ✨"
              : "Expected delivery: 2–3 weeks after order"}
          </p>
        )}
      </div>
    </motion.div>
  );
}

const POLL_INTERVAL_MS = 30_000;

export default function Track() {
  const [email, setEmail]         = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders]       = useState<OrderData[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS / 1000);
  const pollingRef                = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchParams              = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const emailParam                = searchParams.get("email");

  const fetchOrders = useCallback(async (addr: string, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const resp = await fetch(`/api/zodiac-orders/track?email=${encodeURIComponent(addr.trim())}`);
      if (!resp.ok) throw new Error("Could not load orders");
      const data = (await resp.json()) as OrderData[];
      setOrders(data);
      setLastRefreshed(new Date());
      setCountdown(POLL_INTERVAL_MS / 1000);
    } catch {
      if (!silent) setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Auto-fill from query param
  useEffect(() => {
    if (emailParam) {
      setEmail(emailParam);
      setSubmitted(true);
      fetchOrders(emailParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-poll while any order is in an active print/ship state
  useEffect(() => {
    const hasActiveOrders = orders.some((o) =>
      ["processing", "submitting", "shipped"].includes(o.status),
    );

    if (submitted && hasActiveOrders) {
      pollingRef.current = setInterval(() => {
        fetchOrders(email, true);
      }, POLL_INTERVAL_MS);

      const cdInterval = setInterval(() => {
        setCountdown((c) => (c > 1 ? c - 1 : POLL_INTERVAL_MS / 1000));
      }, 1000);

      return () => {
        clearInterval(pollingRef.current!);
        clearInterval(cdInterval);
      };
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return undefined;
    }
  }, [submitted, orders, email, fetchOrders]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
    await fetchOrders(email);
  };

  const handleRefresh = () => fetchOrders(email, true);

  const hasActiveOrders = orders.some((o) => ["processing", "submitting", "shipped"].includes(o.status));

  return (
    <div className="min-h-screen bg-[#0e1b2a] text-white flex flex-col">
      <SEO title="Track Your Order — Holigrowth" path="/track" noindex />
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#c9a84c]/6 rounded-full blur-[100px]" />

      <header className="py-4 px-6 border-b border-white/8 relative z-10">
        <div className="max-w-2xl mx-auto flex justify-center">
          <a href="/">
            <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-8 w-auto brightness-0 invert opacity-80" />
          </a>
        </div>
      </header>

      <div className="flex-1 px-4 py-12 max-w-2xl mx-auto w-full relative z-10">

        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 mb-6">
            <Package className="w-3.5 h-3.5 text-[#c9a84c]/70" />
            <span className="text-[#c9a84c]/80 text-xs tracking-[0.2em] uppercase">Order Tracking</span>
          </div>
          <h1 className="font-serif text-3xl md:text-4xl text-white mb-3 leading-tight">
            Where's your<br />
            <span className="italic text-[#e8dfc8]">Life Path book?</span>
          </h1>
          <p className="text-white/40 text-sm max-w-sm mx-auto leading-relaxed">
            Enter the email you used at checkout to see real-time shipping status, tracking info, and delivery estimates.
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="pl-10 h-12 bg-white/5 border-white/12 text-white placeholder:text-white/25 rounded-xl focus:border-[#c9a84c]/50 focus:ring-[#c9a84c]/20"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="h-12 px-6 bg-[#c9a84c] hover:bg-[#b8953e] text-[#0e1b2a] font-semibold rounded-xl transition-all"
            >
              {loading ? (
                <motion.div
                  className="w-4 h-4 border-2 border-[#0e1b2a]/30 border-t-[#0e1b2a] rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                />
              ) : "Track"}
            </Button>
          </div>
        </form>

        {/* Refresh bar — shown after results load */}
        {submitted && orders.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-between mb-6 px-1"
          >
            <div className="flex items-center gap-2">
              {lastRefreshed && (
                <p className="text-white/25 text-xs">
                  Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
              {hasActiveOrders && (
                <span className="text-white/20 text-xs">· refreshes in {countdown}s</span>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-[#c9a84c] transition-colors disabled:opacity-40"
            >
              <motion.div animate={refreshing ? { rotate: 360 } : {}} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}>
                <RefreshCw className="w-3.5 h-3.5" />
              </motion.div>
              {refreshing ? "Syncing with printer…" : "Refresh"}
            </button>
          </motion.div>
        )}

        {/* Results */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6"
            >
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </motion.div>
          )}

          {!loading && submitted && orders.length === 0 && !error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-center py-16"
            >
              <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                <Clock className="w-6 h-6 text-white/25" />
              </div>
              <p className="text-white/50 font-medium mb-1">No orders found</p>
              <p className="text-white/25 text-sm">
                No orders were found for <span className="text-white/40">{email}</span>.
                <br />Double-check the email you used at checkout.
              </p>
              <p className="text-white/20 text-xs mt-4">
                Need help?{" "}
                <a href="mailto:hello@holigrowth.com" className="text-[#c9a84c]/50 hover:text-[#c9a84c] transition-colors underline underline-offset-2">
                  Contact support
                </a>
              </p>
            </motion.div>
          )}

          {orders.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <p className="text-white/30 text-xs uppercase tracking-widest mb-2">
                {orders.length} order{orders.length !== 1 ? "s" : ""} found for {email}
              </p>
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-poll notice */}
        {hasActiveOrders && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 flex items-center gap-2 justify-center"
          >
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-[#c9a84c]/60"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            />
            <p className="text-white/20 text-xs">
              Live updates every 30 seconds — we check the printer on each refresh
            </p>
          </motion.div>
        )}

        <div className="mt-16 text-center">
          <p className="text-white/20 text-xs">
            Questions about your order?{" "}
            <a href="mailto:hello@holigrowth.com" className="text-[#c9a84c]/40 hover:text-[#c9a84c] transition-colors underline underline-offset-2">
              hello@holigrowth.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
