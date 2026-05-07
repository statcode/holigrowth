import { Shield, LogOut, Zap } from "lucide-react";
import { useAdmin } from "@/contexts/admin-context";

export function AdminToolbar() {
  const { isAdmin, testMode, setTestMode, logout } = useAdmin();
  if (!isAdmin) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-950 text-white px-4 py-2.5 rounded-full shadow-2xl border border-white/10 text-sm select-none">
      <Shield className="w-4 h-4 text-teal-400 shrink-0" />
      <span className="font-semibold text-teal-400 text-xs tracking-wide uppercase">Admin</span>
      <div className="w-px h-4 bg-white/20" />
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={testMode}
          onChange={(e) => setTestMode(e.target.checked)}
          className="w-4 h-4 accent-yellow-400 cursor-pointer"
        />
        <Zap className={`w-3.5 h-3.5 ${testMode ? "text-yellow-400" : "text-white/40"}`} />
        <span className={`text-xs ${testMode ? "text-yellow-300 font-semibold" : "text-white/60"}`}>
          Test mode (5 pages)
        </span>
      </label>
      <div className="w-px h-4 bg-white/20" />
      <button
        onClick={logout}
        className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" />
        Logout
      </button>
    </div>
  );
}
