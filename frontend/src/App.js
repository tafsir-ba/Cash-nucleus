import { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { Toaster, toast } from "sonner";

// Components
import { KPICards } from "./components/KPICards";
import { ScenarioToggle } from "./components/ScenarioToggle";
import { ProjectionChart } from "./components/ProjectionChart";
import { MonthlyTable } from "./components/MonthlyTable";
import { QuickAddForm } from "./components/QuickAddForm";
import { PressurePanel } from "./components/PressurePanel";
import { BankAccountsDialog } from "./components/BankAccountsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { EntryLogDialog } from "./components/EntryLogDialog";
import { EntityFilter } from "./components/EntityFilter";

// Icons
import { Gear, Bank, ListBullets } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [scenario, setScenario] = useState("likely");
  const [projection, setProjection] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [monthDetails, setMonthDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [hasFlows, setHasFlows] = useState(false);
  const [entities, setEntities] = useState([]);
  const [selectedEntityId, setSelectedEntityId] = useState(null); // null = all entities
  
  // Dialog states
  const [bankAccountsOpen, setBankAccountsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entryLogOpen, setEntryLogOpen] = useState(false);

  const fetchEntities = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/entities`);
      setEntities(response.data);
    } catch (error) {
      console.error("Failed to fetch entities:", error);
    }
  }, []);

  const fetchProjection = useCallback(async () => {
    try {
      const params = { scenario };
      if (selectedEntityId) params.entity_id = selectedEntityId;
      
      const response = await axios.get(`${API}/projection`, { params });
      setProjection(response.data);
    } catch (error) {
      console.error("Failed to fetch projection:", error);
      toast.error("Failed to load projection data");
    } finally {
      setLoading(false);
    }
  }, [scenario, selectedEntityId]);

  const checkData = useCallback(async () => {
    try {
      const params = selectedEntityId ? { entity_id: selectedEntityId } : {};
      const [accountsRes, flowsRes] = await Promise.all([
        axios.get(`${API}/bank-accounts`, { params }),
        axios.get(`${API}/cash-flows`, { params })
      ]);
      setHasAccounts(accountsRes.data.length > 0);
      setHasFlows(flowsRes.data.length > 0);
    } catch (error) {
      console.error("Failed to check data:", error);
    }
  }, [selectedEntityId]);

  const fetchMonthDetails = useCallback(async (month) => {
    if (!month) return;
    try {
      const params = { scenario };
      if (selectedEntityId) params.entity_id = selectedEntityId;
      
      const response = await axios.get(`${API}/month-details/${month}`, { params });
      setMonthDetails(response.data);
    } catch (error) {
      console.error("Failed to fetch month details:", error);
    }
  }, [scenario, selectedEntityId]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  useEffect(() => {
    fetchProjection();
    checkData();
  }, [fetchProjection, checkData]);

  useEffect(() => {
    if (selectedMonth) {
      fetchMonthDetails(selectedMonth);
    } else {
      setMonthDetails(null);
    }
  }, [selectedMonth, fetchMonthDetails]);

  const handleCashFlowAdded = () => {
    fetchProjection();
    checkData();
    if (selectedMonth) fetchMonthDetails(selectedMonth);
    toast.success("Cash flow added");
  };

  const handleDataChange = () => {
    fetchProjection();
    checkData();
    if (selectedMonth) fetchMonthDetails(selectedMonth);
  };

  const handleMonthSelect = (month) => {
    setSelectedMonth(month === selectedMonth ? null : month);
  };

  const hasData = hasAccounts || hasFlows;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 font-body">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950" data-testid="cash-dashboard">
      <Toaster position="top-right" theme="dark" />
      
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="w-full max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-50 font-heading">
                  Cash Pilot
                </h1>
                <p className="text-xs text-zinc-500 mt-0.5">12-Month Cash Projection</p>
              </div>
              
              {/* Entity Filter */}
              <EntityFilter
                entities={entities}
                selectedId={selectedEntityId}
                onChange={setSelectedEntityId}
              />
            </div>
            
            <div className="flex items-center gap-3">
              <ScenarioToggle value={scenario} onChange={setScenario} />
              
              <div className="flex items-center gap-2 ml-4 border-l border-zinc-800 pl-4">
                <button
                  onClick={() => setEntryLogOpen(true)}
                  className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors"
                  title="Entry Log"
                  data-testid="entry-log-btn"
                >
                  <ListBullets size={20} />
                </button>
                <button
                  onClick={() => setBankAccountsOpen(true)}
                  className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors"
                  title="Bank Accounts"
                  data-testid="bank-accounts-btn"
                >
                  <Bank size={20} />
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors"
                  title="Settings"
                  data-testid="settings-btn"
                >
                  <Gear size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6">
        {/* KPI Cards */}
        <section className="mb-6">
          <KPICards 
            projection={projection} 
            hasAccounts={hasAccounts}
            onAddAccount={() => setBankAccountsOpen(true)}
          />
        </section>

        {/* Chart + Quick Add */}
        <section className="main-content-grid mb-6">
          <div className="lg:col-span-8">
            <ProjectionChart 
              projection={projection} 
              selectedMonth={selectedMonth}
              onMonthSelect={handleMonthSelect}
              hasData={hasData}
            />
          </div>
          <div className="lg:col-span-4">
            <QuickAddForm 
              onSuccess={handleCashFlowAdded} 
              entities={entities}
              onEntitiesChange={fetchEntities}
            />
          </div>
        </section>

        {/* Table + Pressure Panel */}
        <section className="main-content-grid">
          <div className="lg:col-span-8">
            <MonthlyTable 
              months={projection?.months || []}
              selectedMonth={selectedMonth}
              onMonthSelect={handleMonthSelect}
              hasData={hasData}
            />
          </div>
          <div className="lg:col-span-4">
            <PressurePanel 
              monthDetails={monthDetails}
              selectedMonth={selectedMonth}
            />
          </div>
        </section>
      </main>

      {/* Dialogs */}
      <BankAccountsDialog 
        open={bankAccountsOpen} 
        onOpenChange={setBankAccountsOpen}
        onDataChange={handleDataChange}
        entities={entities}
        onEntitiesChange={fetchEntities}
      />
      <SettingsDialog 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen}
        currentBuffer={projection?.safety_buffer || 50000}
        onDataChange={handleDataChange}
      />
      <EntryLogDialog
        open={entryLogOpen}
        onOpenChange={setEntryLogOpen}
        entities={entities}
        onDataChange={handleDataChange}
        selectedEntityId={selectedEntityId}
      />
    </div>
  );
}

export default App;
