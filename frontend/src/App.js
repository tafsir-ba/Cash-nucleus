import { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { Toaster } from "sonner";

import { LoginPage } from "./components/LoginPage";
import { TreasuryPage } from "./components/TreasuryPage";
import { CashHorizonPage } from "./components/CashHorizonPage";

import { SignOut } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

axios.defaults.withCredentials = true;

function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    axios
      .get(`${API}/auth/me`)
      .then((res) => {
        setUser(res.data);
        setAuthChecked(true);
      })
      .catch(() => {
        setUser(false);
        setAuthChecked(true);
      });
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post(`${API}/auth/logout`);
    } catch {}
    setUser(false);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 font-body">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u)} />;
  }

  return <Dashboard user={user} onLogout={handleLogout} />;
}

function Dashboard({ onLogout }) {
  const [entities, setEntities] = useState([]);
  const [activeTab, setActiveTab] = useState("treasury"); // "treasury" | "cash_horizon"

  const fetchEntities = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/entities`);
      setEntities(response.data);
    } catch (error) {
      console.error("Failed to fetch entities:", error);
    }
  }, []);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  return (
    <div className="min-h-screen bg-zinc-950" data-testid="cash-dashboard">
      <Toaster position="top-right" theme="dark" />

      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="w-full mx-auto py-4 max-w-[1600px] px-4 md:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-zinc-50 font-heading whitespace-nowrap">
                Cash Pilot
              </h1>
              <div
                className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-md"
                data-testid="view-tabs"
              >
                <button
                  onClick={() => setActiveTab("treasury")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    activeTab === "treasury"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                  data-testid="tab-treasury"
                >
                  Treasury
                </button>
                <button
                  onClick={() => setActiveTab("cash_horizon")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    activeTab === "cash_horizon"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                  data-testid="tab-cash-horizon"
                >
                  Cash Horizon
                </button>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="p-2 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors"
              title="Sign out"
              data-testid="logout-btn"
            >
              <SignOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main
        className={`w-full mx-auto ${
          activeTab === "cash_horizon"
            ? "max-w-none px-3 sm:px-4 lg:px-6 py-3"
            : "max-w-[1600px] px-4 md:px-6 lg:px-8 py-6"
        }`}
      >
        {activeTab === "treasury" ? (
          <TreasuryPage entities={entities} onEntitiesChange={fetchEntities} />
        ) : (
          <CashHorizonPage />
        )}
      </main>
    </div>
  );
}

export default App;
