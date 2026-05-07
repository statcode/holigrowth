import { createContext, useContext, useState, type ReactNode } from "react";

const STORAGE_KEY_TOKEN = "holigrowth_admin_token";
const STORAGE_KEY_TESTMODE = "holigrowth_admin_testmode";

type AdminContextType = {
  isAdmin: boolean;
  adminToken: string | null;
  testMode: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
  setTestMode: (enabled: boolean) => void;
};

const AdminContext = createContext<AdminContextType | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [adminToken, setAdminToken] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY_TOKEN)
  );
  const [testMode, setTestModeState] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY_TESTMODE) === "true"
  );

  const isAdmin = adminToken !== null;

  const login = async (password: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) return false;
      const { token } = (await res.json()) as { token: string };
      localStorage.setItem(STORAGE_KEY_TOKEN, token);
      setAdminToken(token);
      return true;
    } catch {
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_TESTMODE);
    setAdminToken(null);
    setTestModeState(false);
  };

  const setTestMode = (enabled: boolean) => {
    localStorage.setItem(STORAGE_KEY_TESTMODE, String(enabled));
    setTestModeState(enabled);
  };

  return (
    <AdminContext.Provider value={{ isAdmin, adminToken, testMode, login, logout, setTestMode }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
