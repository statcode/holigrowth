import { useState, useMemo, useEffect, type FormEvent } from "react";
import { useAdmin } from "@/contexts/admin-context";
import { useListZodiacOrders, useGetOrderStats, useGetSiteSettings, useUpdateSiteSettings, useDeleteZodiacOrder, getListZodiacOrdersQueryKey, getGetOrderStatsQueryKey, getGetSiteSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, ChevronRight, X, Users, BookOpen, Truck, Clock,
  AlertCircle, TrendingUp, RefreshCw, ExternalLink, Copy, Check,
  ChevronDown, Hash, Star, Download, Settings, Save, Image, Webhook, Link, Mail, Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ZodiacOrder = {
  id: number;
  fullName: string;
  birthday: string;
  birthTime: string;
  birthLocation: string;
  email?: string | null;
  gender?: string | null;
  sexualOrientation?: string | null;
  relationshipStatus?: string | null;
  status: string;
  sunSign?: string | null;
  moonSign?: string | null;
  risingSign?: string | null;
  lifePath?: string | null;
  luckyNumbers?: string | null;
  referralCode?: string | null;
  referredBy?: string | null;
  referralCount: number;
  priceUsd?: number | null;
  luluOrderId?: string | null;
  shippingAddress?: string | null;
  generatedContent?: string | null;
  interiorPdfUrl?: string | null;
  coverPdfUrl?: string | null;
  createdAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  pending:    { label: "Pending",    color: "bg-amber-50 text-amber-700 border-amber-200",   dot: "bg-amber-400" },
  generating: { label: "Generating", color: "bg-blue-50 text-blue-700 border-blue-200",      dot: "bg-blue-400" },
  generated:  { label: "Generated",  color: "bg-teal-50 text-teal-700 border-teal-200",      dot: "bg-teal-400" },
  submitting: { label: "Submitting", color: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-400" },
  processing: { label: "Processing", color: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-400" },
  shipped:    { label: "Shipped",    color: "bg-green-50 text-green-700 border-green-200",    dot: "bg-green-400" },
  failed:     { label: "Failed",     color: "bg-red-50 text-red-700 border-red-200",          dot: "bg-red-400" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-muted-foreground hover:text-foreground transition-colors ml-1"
    >
      {copied ? <Check className="w-3 h-3 text-teal-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-2.5 border-b border-border/60 last:border-0">
      <span className="text-xs text-muted-foreground w-28 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-foreground/85 flex-1 min-w-0 break-words ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function OrderDrawer({ order, onClose, onRefreshed }: { order: ZodiacOrder; onClose: () => void; onRefreshed: () => void }) {
  const [showContent, setShowContent] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<{ interiorPdfUrl: string; coverPdfUrl: string; pageCount: number } | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteOrder = useDeleteZodiacOrder();
  const signLine = [order.sunSign, order.moonSign && `${order.moonSign} Moon`, order.risingSign && `${order.risingSign} Rising`].filter(Boolean).join(" · ");

  // Reset the arm state whenever a different order opens.
  useEffect(() => { setDeleteArmed(false); setDeleteError(null); }, [order.id]);

  const handleDelete = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      // Auto-disarm after 5s so a stale armed button doesn't fire on a misclick.
      setTimeout(() => setDeleteArmed(false), 5000);
      return;
    }
    setDeleteError(null);
    deleteOrder.mutate(
      { id: order.id },
      {
        onSuccess: () => {
          onRefreshed();
          onClose();
        },
        onError: (err) => {
          setDeleteError(err instanceof Error ? err.message : "Delete failed");
          setDeleteArmed(false);
        },
      },
    );
  };

  const handleRegeneratePdf = async () => {
    setIsRegenerating(true);
    setRegenError(null);
    setRegenResult(null);
    try {
      const res = await fetch(`/api/zodiac-orders/${order.id}/regenerate-pdf`, { method: "POST" });
      const data = await res.json() as { interiorPdfUrl?: string; coverPdfUrl?: string; pageCount?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Regeneration failed");
      setRegenResult({ interiorPdfUrl: data.interiorPdfUrl!, coverPdfUrl: data.coverPdfUrl!, pageCount: data.pageCount! });
      onRefreshed();
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    setResetError(null);
    setResetDone(false);
    try {
      const res = await fetch(`/api/zodiac-orders/${order.id}/reset`, { method: "POST" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Reset failed");
      setResetDone(true);
      onRefreshed();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex"
      onClick={onClose}
    >
      <div className="flex-1 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 260 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] bg-white h-full overflow-y-auto flex flex-col shadow-2xl"
      >
        {/* Drawer header */}
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Order #{order.id}</p>
            <h2 className="font-serif text-xl text-foreground">{order.fullName}</h2>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={order.status} />
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {/* Cosmic profile */}
          {signLine && (
            <div className="rounded-xl bg-gradient-to-br from-primary/5 to-secondary/8 border border-primary/15 p-4">
              <p className="text-xs uppercase tracking-widest text-primary/60 mb-1.5">Cosmic Profile</p>
              <p className="font-serif text-base text-foreground">{signLine}</p>
              {order.lifePath && <p className="text-sm text-muted-foreground mt-1">Life Path {order.lifePath} · Lucky Numbers: {order.luckyNumbers}</p>}
            </div>
          )}

          {/* Personal details */}
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Personal Details</p>
            <div className="rounded-xl border border-border overflow-hidden">
              <DetailRow label="Full Name" value={order.fullName} />
              <DetailRow label="Gender" value={order.gender ? (order.gender.charAt(0).toUpperCase() + order.gender.slice(1)) : undefined} />
              <DetailRow label="Orientation" value={
                order.sexualOrientation === "straight" ? "Straight" :
                order.sexualOrientation === "gay" ? "Gay / Lesbian" :
                order.sexualOrientation === "bisexual" ? "Bisexual" :
                order.sexualOrientation === "prefer_not_to_say" ? "Prefer not to say" :
                undefined
              } />
              <DetailRow label="Rel. Status" value={
                order.relationshipStatus === "single" ? "Single" :
                order.relationshipStatus === "in_relationship" ? "In a Relationship" :
                order.relationshipStatus === "married" ? "Married" :
                order.relationshipStatus === "divorced" ? "Divorced" :
                order.relationshipStatus === "widowed" ? "Widowed" :
                order.relationshipStatus === "not_seeking" ? "Not Seeking" :
                undefined
              } />
              <DetailRow label="Birthday" value={order.birthday} />
              <DetailRow label="Birth Time" value={order.birthTime} />
              <DetailRow label="Birth Location" value={order.birthLocation} />
              <DetailRow label="Email" value={order.email ?? undefined} />
            </div>
          </div>

          {/* Order details */}
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Order Details</p>
            <div className="rounded-xl border border-border overflow-hidden">
              <DetailRow label="Created" value={new Date(order.createdAt).toLocaleString()} />
              <DetailRow label="Price" value={order.priceUsd ? `$${order.priceUsd.toFixed(2)}` : undefined} />
              <DetailRow label="Lulu Order ID" value={order.luluOrderId ?? undefined} mono />
              <DetailRow label="Shipping To" value={order.shippingAddress ?? undefined} />
            </div>
          </div>

          {/* Referral */}
          {(order.referralCode || order.referredBy) && (
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Referral</p>
              <div className="rounded-xl border border-border overflow-hidden">
                {order.referralCode && (
                  <div className="flex gap-3 py-2.5 px-3 border-b border-border/60">
                    <span className="text-xs text-muted-foreground w-28 shrink-0 pt-0.5">Their Code</span>
                    <span className="text-sm font-mono text-foreground/85 flex items-center gap-1">
                      {order.referralCode}
                      <CopyButton value={order.referralCode} />
                    </span>
                    {order.referralCount > 0 && (
                      <span className="text-xs text-teal-600 ml-auto">{order.referralCount} use{order.referralCount > 1 ? "s" : ""}</span>
                    )}
                  </div>
                )}
                {order.referredBy && (
                  <DetailRow label="Referred By" value={order.referredBy} mono />
                )}
              </div>
            </div>
          )}

          {/* Generated content */}
          {order.generatedContent && (
            <div>
              <button
                onClick={() => setShowContent((s) => !s)}
                className="w-full flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground mb-3 hover:text-foreground transition-colors"
              >
                <span>Generated Book Content</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showContent ? "rotate-180" : ""}`} />
              </button>
              {showContent && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 max-h-96 overflow-y-auto">
                  <pre className="text-xs text-foreground/70 font-light leading-relaxed whitespace-pre-wrap font-sans">
                    {order.generatedContent}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* PDF Preview + Downloads */}
          {(order.interiorPdfUrl || order.coverPdfUrl) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Book Preview</p>
                <span className="text-[10px] text-muted-foreground/60 bg-muted px-2 py-0.5 rounded-full">Admin only</span>
              </div>

              {/* Inline PDF preview */}
              {order.interiorPdfUrl && (
                <div className="mb-3 rounded-xl overflow-hidden border border-border bg-muted/30">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                    <span className="text-xs text-muted-foreground font-medium">Interior — full book</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setShowPdfPreview((s) => !s)}
                        className="text-xs text-primary hover:underline"
                      >
                        {showPdfPreview ? "Collapse" : "Expand preview"}
                      </button>
                      <span className="text-muted-foreground/40">·</span>
                      <a href={order.interiorPdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                        Open <ExternalLink className="w-3 h-3" />
                      </a>
                      <span className="text-muted-foreground/40">·</span>
                      <a href={order.interiorPdfUrl} download rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                        Download <Download className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                  <AnimatePresence>
                    {showPdfPreview && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 520, opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <iframe
                          src={`${order.interiorPdfUrl}#toolbar=1&navpanes=1&scrollbar=1&view=FitH`}
                          className="w-full h-[520px] border-0"
                          title={`Interior PDF — ${order.fullName}`}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {!showPdfPreview && (
                    <button
                      onClick={() => setShowPdfPreview(true)}
                      className="w-full py-8 flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <BookOpen className="w-6 h-6 opacity-40" />
                      <span className="text-xs">Click to preview the full interior PDF</span>
                    </button>
                  )}
                </div>
              )}

              {/* Cover PDF row */}
              {order.coverPdfUrl && (
                <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5 bg-muted/20">
                  <span className="text-xs text-muted-foreground font-medium">Cover PDF</span>
                  <div className="flex items-center gap-3">
                    <a href={order.coverPdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                    <a href={order.coverPdfUrl} download rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                      Download <Download className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Admin Actions */}
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Admin Actions</p>
            <div className="flex flex-col gap-2">

                {/* Reset stuck order — visible for generating / failed / pending */}
                {["generating", "failed", "pending"].includes(order.status) && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full gap-2 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                      onClick={handleReset}
                      disabled={isResetting || resetDone}
                    >
                      {isResetting ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> Resetting…</>
                      ) : resetDone ? (
                        <><Check className="w-4 h-4" /> Reset to Pending</>
                      ) : (
                        <><RefreshCw className="w-4 h-4" /> Reset to Pending</>
                      )}
                    </Button>
                    {resetDone && (
                      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                        <Check className="w-4 h-4 shrink-0" />
                        <span>Order reset to Pending. The customer can now re-trigger generation.</span>
                      </div>
                    )}
                    {resetError && (
                      <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{resetError}</span>
                      </div>
                    )}
                  </>
                )}

                {/* Regenerate PDFs — visible when generated content exists */}
                {order.generatedContent && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full gap-2 rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                      onClick={handleRegeneratePdf}
                      disabled={isRegenerating}
                    >
                      {isRegenerating
                        ? <><RefreshCw className="w-4 h-4 animate-spin" /> Regenerating PDFs…</>
                        : <><RefreshCw className="w-4 h-4" /> Regenerate PDFs</>
                      }
                    </Button>

                    {regenError && (
                      <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{regenError}</span>
                      </div>
                    )}

                    {regenResult && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2.5">
                          <Check className="w-4 h-4 shrink-0" />
                          <span>PDFs regenerated — {regenResult.pageCount} pages.</span>
                        </div>
                        <a href={regenResult.interiorPdfUrl} target="_blank" rel="noopener noreferrer" download>
                          <Button variant="outline" className="w-full gap-2 rounded-xl border-teal-200 text-teal-700 hover:bg-teal-50">
                            <Download className="w-4 h-4" /> Download New Interior PDF
                          </Button>
                        </a>
                        <a href={regenResult.coverPdfUrl} target="_blank" rel="noopener noreferrer" download>
                          <Button variant="outline" className="w-full gap-2 rounded-xl border-purple-200 text-purple-700 hover:bg-purple-50">
                            <Download className="w-4 h-4" /> Download New Cover PDF
                          </Button>
                        </a>
                      </div>
                    )}
                  </>
                )}

              {/* Danger zone — permanently delete this order */}
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[10px] uppercase tracking-widest text-red-600/70 mb-2">Danger Zone</p>
                <Button
                  variant="outline"
                  className={`w-full gap-2 rounded-xl border-red-200 disabled:opacity-60 ${deleteArmed ? "bg-red-600 text-white border-red-600 hover:bg-red-700 hover:text-white" : "text-red-700 hover:bg-red-50"}`}
                  onClick={handleDelete}
                  disabled={deleteOrder.isPending}
                >
                  {deleteOrder.isPending ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Deleting…</>
                  ) : deleteArmed ? (
                    <><Trash2 className="w-4 h-4" /> Click again to confirm permanent delete</>
                  ) : (
                    <><Trash2 className="w-4 h-4" /> Delete Order</>
                  )}
                </Button>
                {deleteArmed && !deleteOrder.isPending && (
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    This permanently removes order #{order.id} ({order.fullName}) from the database. Cannot be undone.
                  </p>
                )}
                {deleteError && (
                  <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mt-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{deleteError}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <a
              href={`/order/${order.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1"
            >
              <Button variant="outline" className="w-full gap-2 rounded-xl border-border">
                <ExternalLink className="w-4 h-4" /> View Order Page
              </Button>
            </a>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

const STATUSES = ["all", "pending_payment", "pending", "generating", "generated", "processing", "shipped", "failed"];

function SettingsPanel() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSiteSettings({
    query: { queryKey: getGetSiteSettingsQueryKey() },
  });
  const updateSettings = useUpdateSiteSettings();

  const [price, setPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [confirmSubject, setConfirmSubject] = useState("");
  const [confirmIntro, setConfirmIntro] = useState("");
  const [bookReadySubject, setBookReadySubject] = useState("");
  const [bookReadyIntro, setBookReadyIntro] = useState("");
  const [stuckSubject, setStuckSubject] = useState("");
  const [stuckIntro, setStuckIntro] = useState("");
  const [openEmailSection, setOpenEmailSection] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, "ok" | "error">>({});

  useEffect(() => {
    if (settings && price === "") {
      setPrice(String(settings.priceUsd));
      setOriginalPrice(String(settings.originalPriceUsd));
      setCoverUrl(settings.coverImageUrl ?? "");
      setTestEmail(settings.testEmailOverride ?? "");
      setConfirmSubject(settings.emailConfirmSubject ?? "");
      setConfirmIntro(settings.emailConfirmIntro ?? "");
      setBookReadySubject(settings.emailBookReadySubject ?? "");
      setBookReadyIntro(settings.emailBookReadyIntro ?? "");
      setStuckSubject(settings.emailStuckSubject ?? "");
      setStuckIntro(settings.emailStuckIntro ?? "");
    }
  }, [settings]);

  const handleSendTest = async (emailType: string) => {
    setSendingTest(emailType);
    setTestResult((r) => { const n = { ...r }; delete n[emailType]; return n; });
    try {
      const resp = await fetch("/api/settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailType }),
      });
      const data = await resp.json() as { ok?: boolean; error?: string };
      setTestResult((r) => ({ ...r, [emailType]: resp.ok && data.ok ? "ok" : "error" }));
    } catch {
      setTestResult((r) => ({ ...r, [emailType]: "error" }));
    } finally {
      setSendingTest(null);
      setTimeout(() => setTestResult((r) => { const n = { ...r }; delete n[emailType]; return n; }), 4000);
    }
  };

  const handleSave = () => {
    const priceNum = parseFloat(price || String(settings?.priceUsd ?? 99.99));
    const origNum = parseFloat(originalPrice || String(settings?.originalPriceUsd ?? 129.99));
    if (isNaN(priceNum) || isNaN(origNum)) return;

    updateSettings.mutate(
      {
        data: {
          priceUsd: priceNum,
          originalPriceUsd: origNum,
          coverImageUrl: coverUrl || null,
          testEmailOverride: testEmail || null,
          emailConfirmSubject: confirmSubject || null,
          emailConfirmIntro: confirmIntro || null,
          emailBookReadySubject: bookReadySubject || null,
          emailBookReadyIntro: bookReadyIntro || null,
          emailStuckSubject: stuckSubject || null,
          emailStuckIntro: stuckIntro || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() });
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-border p-10 flex items-center justify-center">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const displayPrice = price || String(settings?.priceUsd ?? 99.99);
  const displayOriginal = originalPrice || String(settings?.originalPriceUsd ?? 129.99);

  return (
    <div className="space-y-6">
      {/* Pricing */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Book Pricing</h2>
            <p className="text-xs text-muted-foreground">Controls the Stripe checkout amount and displayed price across the site</p>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {/* Live preview */}
          <div className="rounded-xl bg-muted/50 border border-border p-4 flex items-center gap-3">
            <span className="text-xs text-muted-foreground uppercase tracking-widest">Live preview:</span>
            <span className="font-serif text-2xl text-primary font-semibold">${parseFloat(displayPrice || "0").toFixed(2)}</span>
            <span className="font-serif text-lg text-muted-foreground line-through">${parseFloat(displayOriginal || "0").toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Sale Price (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={price !== "" ? price : String(settings?.priceUsd ?? 99.99)}
                  onChange={(e) => setPrice(e.target.value)}
                  className="pl-7 h-10 rounded-lg border-border"
                  placeholder="99.99"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">This is the amount charged at Stripe checkout</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Original Price (struck through)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={originalPrice !== "" ? originalPrice : String(settings?.originalPriceUsd ?? 129.99)}
                  onChange={(e) => setOriginalPrice(e.target.value)}
                  className="pl-7 h-10 rounded-lg border-border"
                  placeholder="129.99"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Shown with a strikethrough as the "was" price</p>
            </div>
          </div>
        </div>
      </div>

      {/* Cover Image */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
            <Image className="w-4 h-4 text-secondary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Book Cover Image</h2>
            <p className="text-xs text-muted-foreground">URL of the cover image shown on the Stripe checkout page</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex gap-4 items-start">
            {(coverUrl || settings?.coverImageUrl) ? (
              <div className="w-20 h-28 rounded-lg border border-border overflow-hidden flex-shrink-0 shadow-sm">
                <img
                  src={coverUrl || settings?.coverImageUrl || ""}
                  alt="Cover preview"
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            ) : (
              <div className="w-20 h-28 rounded-lg border border-dashed border-border flex items-center justify-center flex-shrink-0 bg-muted/30">
                <BookOpen className="w-6 h-6 text-muted-foreground/40" />
              </div>
            )}
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-foreground">Cover Image URL</label>
              <Input
                type="url"
                value={coverUrl !== "" ? coverUrl : (settings?.coverImageUrl ?? "")}
                onChange={(e) => setCoverUrl(e.target.value)}
                className="h-10 rounded-lg border-border"
                placeholder="https://example.com/book-cover.jpg"
              />
              <p className="text-[11px] text-muted-foreground">Paste any public image URL. Shown on Stripe checkout.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Email Templates & Testing */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-secondary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Email Templates &amp; Testing</h2>
            <p className="text-xs text-muted-foreground">Customise subject lines, intro text, and route test copies. Use <code className="bg-muted px-1 rounded text-[10px]">{"{{firstName}}"}</code> in subjects.</p>
          </div>
        </div>
        <div className="p-6 space-y-5">

          {/* Test email override */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Test Email Override</label>
            <Input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="h-10 rounded-lg border-border"
              placeholder="holigrowth@gmail.com"
            />
            <p className="text-[11px] text-muted-foreground">When set, every outgoing email also sends a blind copy to this address so you can preview real sends.</p>
          </div>

          <div className="border-t border-border" />

          {/* Confirmation email */}
          {(["confirm", "bookReady", "stuck"] as const).map((key) => {
            const labels: Record<string, { title: string; subjectVal: string; setSubject: (v: string) => void; introVal: string; setIntro: (v: string) => void; defaultSubject: string; defaultIntro: string }> = {
              confirm: {
                title: "Order Confirmation",
                subjectVal: confirmSubject,
                setSubject: setConfirmSubject,
                introVal: confirmIntro,
                setIntro: setConfirmIntro,
                defaultSubject: "Your Holistic Growth Life Path Book is Confirmed, {{firstName}}! ✨",
                defaultIntro: "Your personalized Holistic Growth Life Path book has been confirmed. Inside: 40–50 hardbound pages including 30 practical affirmations — 10 each for love, wealth & health — written from your Life Path. We're getting it ready to print and ship to you.",
              },
              bookReady: {
                title: "Book Ready",
                subjectVal: bookReadySubject,
                setSubject: setBookReadySubject,
                introVal: bookReadyIntro,
                setIntro: setBookReadyIntro,
                defaultSubject: "Your Life Path Book is Ready, {{firstName}}! ✨",
                defaultIntro: "Your personalized Holistic Growth Life Path book has been written — 40–50 full-color pages crafted just for you, including 30 practical affirmations written from your Life Path (10 each for love, wealth & health).",
              },
              stuck: {
                title: "Generation Retry",
                subjectVal: stuckSubject,
                setSubject: setStuckSubject,
                introVal: stuckIntro,
                setIntro: setStuckIntro,
                defaultSubject: "A small cosmic hiccup with your book, {{firstName}} — here's how to retry",
                defaultIntro: "We ran into a brief interruption while writing your personalized Life Path book. Your order is safe and just needs one more attempt to complete.",
              },
            };
            const cfg = labels[key];
            const isOpen = openEmailSection === key;
            const isCustomised = !!cfg.subjectVal || !!cfg.introVal;
            return (
              <div key={key} className="border border-border rounded-xl overflow-hidden">
                <div className="flex items-center">
                  <button
                    type="button"
                    className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                    onClick={() => setOpenEmailSection(isOpen ? null : key)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{cfg.title}</span>
                      {isCustomised && (
                        <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">custom</span>
                      )}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform mr-2 ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  <button
                    type="button"
                    title={settings?.testEmailOverride ? `Send test to ${settings.testEmailOverride}` : "Save a test email address above first"}
                    disabled={!settings?.testEmailOverride || sendingTest === key}
                    onClick={() => handleSendTest(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 mr-3 rounded-lg text-[11px] font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed
                      bg-secondary/10 border-secondary/20 text-secondary hover:bg-secondary/20"
                  >
                    {sendingTest === key ? (
                      <><RefreshCw className="w-3 h-3 animate-spin" />Sending…</>
                    ) : testResult[key] === "ok" ? (
                      <><Check className="w-3 h-3 text-green-600" /><span className="text-green-600">Sent!</span></>
                    ) : testResult[key] === "error" ? (
                      <><AlertCircle className="w-3 h-3 text-destructive" /><span className="text-destructive">Failed</span></>
                    ) : (
                      <><Mail className="w-3 h-3" />Send test</>
                    )}
                  </button>
                </div>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border bg-muted/20">
                    <div className="space-y-1.5 pt-3">
                      <label className="text-xs font-medium text-foreground">Subject Line</label>
                      <Input
                        value={cfg.subjectVal}
                        onChange={(e) => cfg.setSubject(e.target.value)}
                        className="h-9 rounded-lg border-border text-sm"
                        placeholder={cfg.defaultSubject}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">Intro Paragraph</label>
                      <Textarea
                        value={cfg.introVal}
                        onChange={(e) => cfg.setIntro(e.target.value)}
                        className="rounded-lg border-border text-sm resize-none"
                        rows={3}
                        placeholder={cfg.defaultIntro}
                      />
                    </div>
                    {(cfg.subjectVal || cfg.introVal) && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => { cfg.setSubject(""); cfg.setIntro(""); }}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updateSettings.isPending}
          className="h-10 px-6 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl gap-2"
        >
          {updateSettings.isPending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <><Check className="w-4 h-4" /> Saved!</>
          ) : (
            <><Save className="w-4 h-4" /> Save Settings</>
          )}
        </Button>
      </div>

      {/* Lulu Webhook */}
      <LuluWebhookPanel />
    </div>
  );
}

function LuluWebhookPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    webhookId?: string | number;
    url?: string;
    events?: string[];
    alreadyExisted?: boolean;
    message?: string;
    error?: string;
  } | null>(null);

  const register = async () => {
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch("/api/lulu/register-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json() as typeof result;
      setResult(data);
    } catch {
      setResult({ success: false, error: "Network error — check that the API server is running." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
          <Webhook className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">Lulu Print Webhook</h2>
          <p className="text-xs text-muted-foreground">
            Register your server URL with Lulu so order status updates (shipped, delivered) arrive automatically — no polling needed.
          </p>
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="rounded-xl bg-muted/50 border border-border p-4 text-xs text-muted-foreground space-y-1.5 font-mono">
          <p className="text-foreground font-sans font-medium text-sm mb-2">How it works</p>
          <div className="flex items-start gap-2">
            <span className="text-primary font-semibold mt-0.5">1.</span>
            <span>Click Register below — your server calls Lulu's API to subscribe to <code className="bg-muted px-1 rounded">print_job.status.changed</code> events.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-primary font-semibold mt-0.5">2.</span>
            <span>Lulu pushes a <code className="bg-muted px-1 rounded">POST /api/lulu/webhook</code> when any book moves to <strong>In Production → Shipped → Delivered</strong>.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-primary font-semibold mt-0.5">3.</span>
            <span>Your server updates the order in the DB and emails the customer their tracking number automatically.</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            Optionally set <code className="bg-amber-100 px-1 rounded font-mono">LULU_WEBHOOK_SECRET</code> in your environment secrets to enable HMAC signature verification on incoming events.
          </span>
        </div>

        <Button
          onClick={register}
          disabled={loading}
          className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-2 text-sm"
        >
          {loading ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Registering…</>
          ) : (
            <><Link className="w-4 h-4" /> Register Lulu Webhook</>
          )}
        </Button>

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`rounded-xl border px-4 py-3 text-sm space-y-1 ${
                result.success
                  ? "bg-teal-50 border-teal-200 text-teal-800"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              {result.success ? (
                <>
                  <p className="flex items-center gap-2 font-medium">
                    <Check className="w-4 h-4" />
                    {result.alreadyExisted ? "Already registered" : "Webhook registered!"}
                  </p>
                  <p className="text-xs opacity-70">{result.message}</p>
                  {result.url && (
                    <p className="text-xs font-mono mt-1 bg-teal-100/60 px-2 py-1 rounded break-all">{result.url}</p>
                  )}
                  {result.webhookId && (
                    <p className="text-xs opacity-60">Webhook ID: {result.webhookId}</p>
                  )}
                </>
              ) : (
                <p className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {result.error}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function Admin() {
  const { isAdmin, login, logout } = useAdmin();
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const { data: orders = [], isLoading, refetch, isFetching } = useListZodiacOrders({
    query: { refetchInterval: 30_000, queryKey: getListZodiacOrdersQueryKey() },
  });
  const { data: stats } = useGetOrderStats({
    query: { queryKey: getGetOrderStatsQueryKey(), refetchInterval: 30_000 },
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<ZodiacOrder | null>(null);
  const [sortBy, setSortBy] = useState<"createdAt" | "status" | "name">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<"orders" | "settings">("orders");

  const filtered = useMemo(() => {
    let rows = orders as ZodiacOrder[];
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (o) =>
          o.fullName.toLowerCase().includes(q) ||
          (o.email ?? "").toLowerCase().includes(q) ||
          (o.birthLocation ?? "").toLowerCase().includes(q) ||
          String(o.id).includes(q) ||
          (o.referralCode ?? "").toLowerCase().includes(q),
      );
    }
    rows = [...rows].sort((a, b) => {
      let av: string | number = "", bv: string | number = "";
      if (sortBy === "createdAt") { av = a.createdAt; bv = b.createdAt; }
      if (sortBy === "status") { av = a.status; bv = b.status; }
      if (sortBy === "name") { av = a.fullName; bv = b.fullName; }
      return sortDir === "asc" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
    });
    return rows;
  }, [orders, search, statusFilter, sortBy, sortDir]);

  const totalRevenue = useMemo(
    () => (orders as ZodiacOrder[]).reduce((s, o) => s + (o.priceUsd ?? 0), 0),
    [orders],
  );
  const referralUses = useMemo(
    () => (orders as ZodiacOrder[]).reduce((s, o) => s + (o.referralCount ?? 0), 0),
    [orders],
  );

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  }

  const SortIcon = ({ col }: { col: typeof sortBy }) =>
    sortBy === col ? (
      <ChevronDown className={`w-3.5 h-3.5 inline ml-1 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 inline ml-1 opacity-25" />
    );

  if (!isAdmin) {
    const handleLogin = async (e: FormEvent) => {
      e.preventDefault();
      setLoginLoading(true);
      setLoginError(false);
      const ok = await login(loginPassword);
      setLoginLoading(false);
      if (!ok) setLoginError(true);
    };

    return (
      <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-border p-10 w-full max-w-sm shadow-sm">
          <div className="text-center mb-8">
            <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-10 w-auto mx-auto mb-5" />
            <h1 className="text-xl font-semibold text-foreground">Admin Access</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter your password to continue</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              className="w-full h-11 px-4 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
            />
            {loginError && (
              <p className="text-sm text-red-500 text-center">Incorrect password. Please try again.</p>
            )}
            <button
              type="submit"
              disabled={loginLoading || !loginPassword}
              className="w-full h-11 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loginLoading ? "Verifying…" : "Login"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-foreground">
      {/* Header */}
      <header className="bg-white border-b border-border px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-8 w-auto" />
            <div className="h-6 w-px bg-border" />
            <h1 className="text-lg font-semibold text-foreground">Admin Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Tab buttons */}
            <div className="flex bg-muted rounded-lg p-1 mr-2">
              <button
                onClick={() => setActiveTab("orders")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "orders" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Orders
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === "settings" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Settings className="w-3.5 h-3.5" />
                Settings
              </button>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-red-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50"
            >
              <X className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {activeTab === "settings" && <SettingsPanel />}

        {activeTab === "orders" && <>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Total Orders",  value: stats?.total ?? 0,                  icon: BookOpen,   color: "text-primary",    bg: "bg-primary/8" },
            { label: "Generated",     value: stats?.generated ?? 0,              icon: Star,       color: "text-teal-600",   bg: "bg-teal-50" },
            { label: "Shipped",       value: stats?.shipped ?? 0,                icon: Truck,      color: "text-green-600",  bg: "bg-green-50" },
            { label: "Pending",       value: (stats?.pending ?? 0) + (stats?.generating ?? 0), icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
            { label: "Revenue",       value: `$${totalRevenue.toFixed(0)}`,       icon: TrendingUp, color: "text-indigo-600", bg: "bg-indigo-50" },
            { label: "Referral Uses", value: referralUses,                        icon: Users,      color: "text-rose-600",   bg: "bg-rose-50" },
          ].map((s) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-border p-5 flex flex-col gap-3"
            >
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}>
                <s.icon className={`w-4.5 h-4.5 ${s.color}`} style={{ width: "1.1rem", height: "1.1rem" }} />
              </div>
              <div>
                <div className="text-2xl font-semibold text-foreground font-serif">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Orders Table */}
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          {/* Table toolbar */}
          <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <h2 className="font-semibold text-foreground">All Orders</h2>
            <div className="flex gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, email, ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-sm bg-muted border-border rounded-lg"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 text-sm border border-border rounded-lg px-3 bg-white text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s === "all" ? "All statuses" : (STATUS_CONFIG[s]?.label ?? s)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="py-20 text-center text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" />
              Loading orders…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>No orders found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground w-12">#</th>
                    <th
                      className="px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("name")}
                    >
                      Customer <SortIcon col="name" />
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Signs</th>
                    <th
                      className="px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("status")}
                    >
                      Status <SortIcon col="status" />
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Referral</th>
                    <th
                      className="px-4 py-3 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("createdAt")}
                    >
                      Date <SortIcon col="createdAt" />
                    </th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((order, i) => (
                    <motion.tr
                      key={order.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      onClick={() => setSelectedOrder(order)}
                      className="hover:bg-muted/40 cursor-pointer transition-colors group"
                    >
                      <td className="px-5 py-3.5 text-muted-foreground font-mono text-xs">{order.id}</td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-foreground">{order.fullName}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          {order.gender && <span className="capitalize">{order.gender}</span>}
                          {order.gender && order.email && <span>·</span>}
                          {order.email && <span className="truncate max-w-[160px]">{order.email}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {order.sunSign ? (
                          <div className="text-xs text-foreground/70">
                            <span className="font-medium">{order.sunSign}</span>
                            {order.moonSign && <span className="text-muted-foreground"> · {order.moonSign} ☽</span>}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                        {order.lifePath && (
                          <div className="text-xs text-muted-foreground mt-0.5">LP {order.lifePath}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        {order.referralCode ? (
                          <div>
                            <span className="text-xs font-mono text-foreground/70">{order.referralCode}</span>
                            {order.referralCount > 0 && (
                              <span className="text-xs text-teal-600 ml-1.5">({order.referralCount})</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                        {order.referredBy && (
                          <div className="text-xs text-muted-foreground mt-0.5">via {order.referredBy}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        <div className="text-muted-foreground/50 text-[11px]">
                          {new Date(order.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Table footer */}
          {!isLoading && (
            <div className="px-5 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
              {filtered.length} of {orders.length} order{orders.length !== 1 ? "s" : ""}
              {statusFilter !== "all" && ` · filtered by "${STATUS_CONFIG[statusFilter]?.label ?? statusFilter}"`}
              {search && ` · "${search}"`}
            </div>
          )}
        </div>

        {/* Quick Customers Overview */}
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Customers</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{orders.length} total · {(orders as ZodiacOrder[]).filter(o => o.email).length} with email</p>
          </div>
          <div className="divide-y divide-border">
            {((orders as ZodiacOrder[]).slice(0, 10)).map((order) => (
              <div
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                className="px-5 py-3.5 flex items-center gap-4 hover:bg-muted/30 cursor-pointer transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-primary font-serif text-sm font-semibold">{order.fullName.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground">{order.fullName}</div>
                  <div className="text-xs text-muted-foreground truncate">{order.email ?? "No email"} · {order.birthLocation}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {order.sunSign && <span className="text-xs text-muted-foreground hidden sm:block">{order.sunSign}</span>}
                  <StatusBadge status={order.status} />
                </div>
              </div>
            ))}
            {orders.length > 10 && (
              <div className="px-5 py-3 text-xs text-muted-foreground text-center">
                + {orders.length - 10} more — use the table above to see all
              </div>
            )}
          </div>
        </div>

        </>}

      </main>

      {/* Order detail drawer */}
      <AnimatePresence>
        {selectedOrder && (
          <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onRefreshed={() => { void refetch(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
