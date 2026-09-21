import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash, PencilSimple, X, Bank } from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Label } from "../components/ui/label";
import { CashPositionHistoryDialog } from "./CashPositionHistoryDialog";
import { TreasuryAccountTable } from "./TreasuryAccountTable";
import { inspectBalanceInput, formatBalancePreview } from "./amountExpression";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatMovement = (delta) => {
  if (delta == null) return "—";
  const abs = Math.abs(delta);
  const formatted = new Intl.NumberFormat("de-CH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs);
  if (delta > 0) return `+${formatted}`;
  if (delta < 0) return `−${formatted}`;
  return formatted;
};

const COLORS = [
  "bg-zinc-100",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-sky-400",
  "bg-violet-400",
  "bg-orange-400",
  "bg-teal-400",
];

const emptyDebtForm = () => ({
  creditor: "",
  total_debt_chf: "",
  entity_id: "",
});

export const TreasuryPage = ({ entities, onEntitiesChange, onDataChange }) => {
  const [accounts, setAccounts] = useState([]);
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [debtEditingId, setDebtEditingId] = useState(null);
  const [debtForm, setDebtForm] = useState(emptyDebtForm());
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [formData, setFormData] = useState({
    label: "",
    amount: "",
    entity_id: "",
    is_receivables_financing: false,
    balance_source: "manual",
    bexio_connection: "",
  });
  const [showEntityCreate, setShowEntityCreate] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [bexioSyncing, setBexioSyncing] = useState(false);

  const fetchAccounts = useCallback(async () => {
    const response = await axios.get(`${API}/bank-accounts`);
    setAccounts(response.data);
  }, []);

  const fetchDebts = useCallback(async () => {
    const response = await axios.get(`${API}/treasury/debts`);
    setDebts(response.data);
  }, []);

  const syncBexioAccounts = useCallback(async ({ silent = false } = {}) => {
    setBexioSyncing(true);
    try {
      const response = await axios.post(`${API}/treasury/sync-bexio`);
      const { synced, failed, results } = response.data || {};
      if (!silent) {
        if (failed > 0) {
          const firstErr = (results || []).find((r) => !r.ok)?.error;
          toast.error(
            firstErr
              ? `Bexio sync: ${failed} failed — ${firstErr}`
              : `Bexio sync: ${failed} account(s) failed`
          );
        } else if (synced > 0) {
          toast.success(`Bexio synced ${synced} account${synced === 1 ? "" : "s"}`);
        }
      } else if (failed > 0) {
        const firstErr = (results || []).find((r) => !r.ok)?.error;
        if (firstErr) toast.error(`Bexio sync failed: ${firstErr}`);
      }
      return response.data;
    } catch (error) {
      const detail = error?.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : "Bexio sync failed";
      if (!silent) toast.error(msg);
      return null;
    } finally {
      setBexioSyncing(false);
    }
  }, []);

  const loadTreasury = useCallback(async () => {
    setLoadError(null);
    try {
      await Promise.all([fetchAccounts(), fetchDebts()]);
      // Refresh Bexio-sourced balances on every Treasury load/refresh.
      await syncBexioAccounts({ silent: true });
      await fetchAccounts();
    } catch (error) {
      console.error("Failed to load treasury:", error);
      setLoadError("Unable to load treasury data. Check connection and retry.");
    } finally {
      setInitialLoading(false);
    }
  }, [fetchAccounts, fetchDebts, syncBexioAccounts]);

  useEffect(() => {
    loadTreasury();
  }, [loadTreasury]);

  useEffect(() => {
    if (entities.length > 0 && !formData.entity_id) {
      setFormData((f) => ({ ...f, entity_id: entities[0].id }));
    }
    if (entities.length > 0 && !debtForm.entity_id) {
      setDebtForm((f) => ({ ...f, entity_id: entities[0].id }));
    }
  }, [entities, formData.entity_id, debtForm.entity_id]);

  const resetForm = () => {
    setFormData({
      label: "",
      amount: "",
      entity_id: entities.length > 0 ? entities[0].id : "",
      is_receivables_financing: false,
      balance_source: "manual",
      bexio_connection: "",
    });
    setAdjustmentNote("");
  };

  const handleCreateEntity = async () => {
    if (!newEntityName.trim()) return;
    try {
      const response = await axios.post(`${API}/entities`, { name: newEntityName.trim() });
      onEntitiesChange?.();
      setFormData((f) => ({ ...f, entity_id: response.data.id }));
      setDebtForm((f) => ({ ...f, entity_id: response.data.id }));
      setNewEntityName("");
      setShowEntityCreate(false);
      toast.success("Entity created");
    } catch {
      toast.error("Failed to create entity");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.label || !formData.entity_id) return;
    const fromBexio = formData.balance_source === "bexio";
    if (!fromBexio && !formData.amount) return;

    let amountValue = 0;
    if (!fromBexio) {
      const parsed = inspectBalanceInput(formData.amount);
      if (!parsed.isValid) {
        toast.error("Invalid balance expression");
        return;
      }
      amountValue = parsed.value;
    }

    setLoading(true);
    try {
      const entityName = entities.find((ent) => ent.id === formData.entity_id)?.name || "";
      let bexioConnection = formData.bexio_connection || undefined;
      if (fromBexio && !bexioConnection) {
        const lower = entityName.toLowerCase();
        if (lower.includes("evahomes")) bexioConnection = "evahomes";
        else if (lower.includes("evohom")) bexioConnection = "evohom";
      }
      await axios.post(`${API}/bank-accounts`, {
        label: formData.label,
        amount: amountValue,
        entity_id: formData.entity_id,
        is_receivables_financing: !!formData.is_receivables_financing,
        balance_source: fromBexio ? "bexio" : "manual",
        bexio_connection: fromBexio ? bexioConnection : undefined,
        note: adjustmentNote || undefined,
        trigger: fromBexio ? "import" : "manual_adjustment",
      });
      toast.success(fromBexio ? "Account added (Bexio)" : "Account added");
      resetForm();
      setShowAddForm(false);
      fetchAccounts();
      onDataChange?.();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Failed to save account");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAccount = async (accountId, updates) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");

    const payload = {
      label: updates.label ?? account.label,
      amount: updates.amount ?? account.amount,
      entity_id: updates.entity_id ?? account.entity_id,
      is_receivables_financing: updates.is_receivables_financing ?? account.is_receivables_financing,
      balance_source: updates.balance_source ?? account.balance_source ?? "manual",
      bexio_connection:
        updates.bexio_connection !== undefined
          ? updates.bexio_connection
          : account.bexio_connection,
      note: updates.note,
      trigger: updates.trigger || "manual_adjustment",
    };
    if (payload.balance_source !== "bexio") {
      payload.bexio_connection = null;
    }

    try {
      await axios.put(`${API}/bank-accounts/${accountId}`, payload);
      toast.success("Account updated");
      await fetchAccounts();
      onDataChange?.();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      throw new Error(typeof detail === "string" ? detail : "Failed to save account");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this bank account?")) return;
    try {
      await axios.delete(`${API}/bank-accounts/${id}`, {
        params: { trigger: "manual_adjustment" },
      });
      toast.success("Account deleted");
      fetchAccounts();
      onDataChange?.();
    } catch {
      toast.error("Failed to delete account");
    }
  };

  const totalBalance = accounts.reduce((sum, acc) => sum + acc.amount, 0);
  const totalDebt = debts.reduce((sum, debt) => sum + debt.total_debt_chf, 0);

  const getEntityName = (entityId) => entities.find((e) => e.id === entityId)?.name || "Unknown";

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedAccounts = [...accounts].sort((a, b) => {
    if (!sortField) return 0;
    if (sortField === "last_movement") {
      const am = a.last_movement;
      const bm = b.last_movement;
      const aMissing = am == null;
      const bMissing = bm == null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return sortDir === "asc" ? 1 : -1;
      if (bMissing) return sortDir === "asc" ? -1 : 1;
      return sortDir === "asc" ? am - bm : bm - am;
    }
    let aVal;
    let bVal;
    if (sortField === "entity") {
      aVal = getEntityName(a.entity_id);
      bVal = getEntityName(b.entity_id);
    } else if (sortField === "label") {
      aVal = a.label;
      bVal = b.label;
    } else if (sortField === "amount") {
      aVal = a.amount;
      bVal = b.amount;
    }
    if (typeof aVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDir === "asc" ? aVal - bVal : bVal - aVal;
  });
  const standardAccounts = sortedAccounts.filter((a) => !a.is_receivables_financing);
  const receivablesAccounts = sortedAccounts.filter((a) => a.is_receivables_financing);

  const tableProps = {
    entities,
    totalBalance,
    sortField,
    sortDir,
    onSort: handleSort,
    onSaveAccount: handleSaveAccount,
    onDeleteAccount: handleDelete,
    formatCurrency,
    formatMovement,
    getEntityName,
  };

  const startDebtEdit = (debt) => {
    setShowAddDebt(false);
    setDebtEditingId(debt.source_flow_id);
    setDebtForm({
      creditor: debt.creditor || "",
      total_debt_chf: debt.total_debt_chf?.toString() || "",
      entity_id: debt.entity_id || (entities[0]?.id ?? ""),
    });
  };

  const cancelDebtEdit = () => {
    setDebtEditingId(null);
    setDebtForm(emptyDebtForm());
    if (entities[0]?.id) {
      setDebtForm((f) => ({ ...f, entity_id: entities[0].id }));
    }
  };

  const handleDebtSave = async () => {
    if (!debtEditingId || !debtForm.creditor.trim() || !debtForm.total_debt_chf) return;
    setLoading(true);
    try {
      await axios.put(`${API}/treasury/debts/${debtEditingId}`, {
        creditor: debtForm.creditor.trim(),
        total_debt_chf: parseFloat(debtForm.total_debt_chf),
      });
      toast.success("Debt updated");
      cancelDebtEdit();
      fetchDebts();
      onDataChange?.();
    } catch {
      toast.error("Failed to update debt");
    } finally {
      setLoading(false);
    }
  };

  const handleDebtCreate = async () => {
    if (!debtForm.creditor.trim() || !debtForm.total_debt_chf || !debtForm.entity_id) return;
    setLoading(true);
    try {
      await axios.post(`${API}/treasury/debts`, {
        creditor: debtForm.creditor.trim(),
        total_debt_chf: parseFloat(debtForm.total_debt_chf),
        entity_id: debtForm.entity_id,
      });
      toast.success("Debt added");
      setShowAddDebt(false);
      setDebtForm({
        creditor: "",
        total_debt_chf: "",
        entity_id: entities[0]?.id || "",
      });
      fetchDebts();
      onDataChange?.();
    } catch {
      toast.error("Failed to add debt");
    } finally {
      setLoading(false);
    }
  };

  const handleDebtDelete = async (debt) => {
    if (!window.confirm(`Delete debt "${debt.creditor}"?`)) return;
    try {
      await axios.delete(`${API}/treasury/debts/${debt.source_flow_id}`);
      toast.success("Debt deleted");
      fetchDebts();
      onDataChange?.();
    } catch {
      toast.error("Failed to delete debt");
    }
  };

  return (
    <>
      <div className="space-y-6" data-testid="treasury-page">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Bank size={18} className="text-zinc-400" />
              <h1 className="text-lg font-heading text-zinc-100">Treasury</h1>
            </div>
            <p className="text-sm text-zinc-500">
              Bank accounts, debt consolidation, and cash balance evolution.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
            <button
              type="button"
              onClick={async () => {
                await syncBexioAccounts();
                await fetchAccounts();
                onDataChange?.();
              }}
              disabled={bexioSyncing}
              className="text-left bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 hover:border-zinc-600 transition-colors disabled:opacity-60"
              data-testid="treasury-bexio-refresh"
              title="Refresh Bexio-sourced account balances"
            >
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Bexio</p>
              <p className="text-sm text-zinc-200">
                {bexioSyncing ? "Syncing…" : "Refresh invoices"}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="text-left bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 hover:border-zinc-600 transition-colors"
              data-testid="treasury-total"
            >
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total Cash Now</p>
              <p className="text-2xl font-mono text-zinc-50 font-light tracking-tight">
                {formatCurrency(totalBalance)}
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                {accounts.length} account{accounts.length !== 1 ? "s" : ""} · open evolution chart
              </p>
            </button>
          </div>
        </div>

        {initialLoading && (
          <div className="text-sm text-zinc-500 py-8 text-center" data-testid="treasury-loading">
            Loading treasury...
          </div>
        )}

        {loadError && (
          <div
            className="border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm rounded-lg px-4 py-3 flex items-center justify-between gap-3"
            data-testid="treasury-load-error"
          >
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => {
                setInitialLoading(true);
                loadTreasury();
              }}
              className="text-xs uppercase tracking-wider text-rose-200 hover:text-white"
              data-testid="treasury-retry-btn"
            >
              Retry
            </button>
          </div>
        )}

        {!initialLoading && !loadError && accounts.length > 0 && totalBalance > 0 && (
          <div data-testid="liquidity-bar">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Liquidity Distribution</p>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
              {sortedAccounts
                .filter((a) => a.amount > 0)
                .sort((a, b) => b.amount - a.amount)
                .map((acc, i) => {
                  const pct = (acc.amount / totalBalance) * 100;
                  return (
                    <div
                      key={acc.id}
                      className={`${COLORS[i % COLORS.length]} rounded-sm transition-all duration-300`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                      title={`${acc.label} — ${formatCurrency(acc.amount)} (${pct.toFixed(1)}%)`}
                    />
                  );
                })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {sortedAccounts
                .filter((a) => a.amount > 0)
                .sort((a, b) => b.amount - a.amount)
                .map((acc, i) => (
                  <span key={acc.id} className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} />
                    {acc.label}
                  </span>
                ))}
            </div>
          </div>
        )}

        {!initialLoading && !loadError && (
        <>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Accounts</p>
            <button
              onClick={() => {
                resetForm();
                setShowAddForm(!showAddForm);
              }}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              data-testid="add-account-toggle"
            >
              <Plus size={14} weight="bold" />
              Add Account
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="text-center py-8 text-zinc-600 text-sm">No bank accounts yet. Add one below.</div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1.5">Standard Accounts</p>
                {standardAccounts.length > 0 ? (
                  <TreasuryAccountTable
                    accounts={standardAccounts}
                    testIdPrefix="treasury-standard"
                    {...tableProps}
                  />
                ) : (
                  <div className="border border-zinc-800 rounded-lg py-4 text-center text-xs text-zinc-600">
                    No standard accounts.
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-emerald-400 mb-1.5">
                  Factoring / Receivables Financing
                </p>
                {receivablesAccounts.length > 0 ? (
                  <TreasuryAccountTable
                    accounts={receivablesAccounts}
                    testIdPrefix="treasury-receivables"
                    {...tableProps}
                  />
                ) : (
                  <div className="border border-emerald-900/50 rounded-lg py-4 text-center text-xs text-zinc-600 bg-emerald-950/10">
                    No accounts assigned to this category yet.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {(showAddForm || accounts.length === 0) && (
          <form
            onSubmit={handleSubmit}
            className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-zinc-900/30"
            data-testid="treasury-form"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-300">New Account</h3>
              {showAddForm && accounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowAddForm(false);
                  }}
                  className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Entity</Label>
              <div className="flex gap-2">
                <Select
                  value={formData.entity_id}
                  onValueChange={(v) => setFormData({ ...formData, entity_id: v })}
                >
                  <SelectTrigger className="flex-1 bg-zinc-950 border-zinc-800 h-[38px] text-sm">
                    <SelectValue placeholder="Select entity" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => setShowEntityCreate(true)}
                  className="px-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md text-zinc-300"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Account Name</Label>
                <input
                  type="text"
                  placeholder="e.g., Main checking"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500"
                  data-testid="account-label-input"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Balance source</Label>
                <Select
                  value={formData.balance_source}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      balance_source: v,
                      bexio_connection:
                        v === "bexio"
                          ? formData.bexio_connection || ""
                          : "",
                    })
                  }
                >
                  <SelectTrigger
                    className="w-full bg-zinc-950 border-zinc-800 h-[38px] text-sm"
                    data-testid="account-source-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="bexio">Bexio (invoice net)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.balance_source === "bexio" ? (
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Bexio company</Label>
                <Select
                  value={formData.bexio_connection || "auto"}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      bexio_connection: v === "auto" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger
                    className="w-full bg-zinc-950 border-zinc-800 h-[38px] text-sm"
                    data-testid="account-bexio-connection-select"
                  >
                    <SelectValue placeholder="Infer from entity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Infer from entity name</SelectItem>
                    <SelectItem value="evohom">Evohom SA</SelectItem>
                    <SelectItem value="evahomes">Evahomes SA</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-zinc-600">
                  Balance = sum of pending invoice net amounts. Synced on Treasury refresh.
                </p>
              </div>
            ) : (
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Balance (CHF)</Label>
                <input
                  type="text"
                  placeholder="-25 or =100-25"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500 font-mono"
                  data-testid="account-amount-input"
                />
                {formData.amount && formatBalancePreview(formData.amount, null, formatCurrency) && (
                  <p className="mt-1 text-[10px] text-emerald-400/80 font-mono">
                    {formatBalancePreview(formData.amount, null, formatCurrency)}
                  </p>
                )}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={!!formData.is_receivables_financing}
                onChange={(e) =>
                  setFormData({ ...formData, is_receivables_financing: e.target.checked })
                }
                className="h-4 w-4 accent-emerald-500 cursor-pointer"
                data-testid="account-is-receivables-input"
              />
              Factoring / Receivables Financing
            </label>

            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Adjustment Note (optional)</Label>
              <input
                type="text"
                placeholder="Reason for manual change"
                value={adjustmentNote}
                onChange={(e) => setAdjustmentNote(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500"
                data-testid="account-note-input"
              />
            </div>

            <button
              type="submit"
              disabled={
                loading ||
                !formData.label ||
                !formData.entity_id ||
                (formData.balance_source !== "bexio" && !formData.amount)
              }
              className="btn-primary w-full flex items-center justify-center gap-2 text-sm py-2"
              data-testid="save-account-btn"
            >
              <Plus size={14} weight="bold" /> Add Account
            </button>
          </form>
        )}

        <div
          className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30"
          data-testid="treasury-debt-consolidation"
        >
          <div className="flex items-center justify-between mb-3 gap-3">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Debt Consolidation</p>
              <p className="text-xs text-zinc-400 mt-1">
                Total debt: <span className="font-mono text-zinc-200">{formatCurrency(totalDebt)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                cancelDebtEdit();
                setShowAddDebt(!showAddDebt);
                setDebtForm({
                  creditor: "",
                  total_debt_chf: "",
                  entity_id: entities[0]?.id || "",
                });
              }}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              data-testid="add-debt-toggle"
            >
              <Plus size={14} weight="bold" />
              Add Debt
            </button>
          </div>

          {debts.length === 0 ? (
            <div className="text-zinc-600 text-sm py-3">No debts yet.</div>
          ) : (
            <div className="border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full" data-testid="treasury-debt-table">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/50">
                    <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-left py-3 px-3">
                      Creditor
                    </th>
                    <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-left py-3 px-3">
                      Entity
                    </th>
                    <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-right py-3 px-3">
                      Total Debt
                    </th>
                    <th className="py-3 px-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {debts.map((debt) => (
                    <tr
                      key={debt.source_flow_id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors"
                    >
                      <td className="py-2.5 px-3 text-sm text-zinc-200">{debt.creditor}</td>
                      <td className="py-2.5 px-3 text-xs text-zinc-500">{debt.entity}</td>
                      <td className="py-2.5 px-3 text-sm font-mono text-zinc-100 tabular-nums text-right">
                        <div>{formatCurrency(debt.total_debt_chf)}</div>
                        <div className="mt-1 text-[10px] text-zinc-500 font-sans">
                          {debt.calculation_basis}
                        </div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => startDebtEdit(debt)}
                            className="p-1 text-zinc-600 hover:text-zinc-300 rounded transition-colors"
                            data-testid={`edit-debt-${debt.source_flow_id}`}
                          >
                            <PencilSimple size={14} />
                          </button>
                          <button
                            onClick={() => handleDebtDelete(debt)}
                            className="p-1 text-zinc-600 hover:text-rose-400 rounded transition-colors"
                            data-testid={`delete-debt-${debt.source_flow_id}`}
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(showAddDebt || debtEditingId) && (
            <div className="mt-3 border border-zinc-800 rounded-lg p-3 bg-zinc-950/50 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500 uppercase tracking-wider">
                  {debtEditingId ? "Edit Debt" : "New Debt"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    cancelDebtEdit();
                    setShowAddDebt(false);
                  }}
                  className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {!debtEditingId && (
                  <div>
                    <Label className="text-xs text-zinc-500 mb-1.5 block">Entity</Label>
                    <Select
                      value={debtForm.entity_id}
                      onValueChange={(v) => setDebtForm({ ...debtForm, entity_id: v })}
                    >
                      <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px] text-sm">
                        <SelectValue placeholder="Select entity" />
                      </SelectTrigger>
                      <SelectContent>
                        {entities.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-zinc-500 mb-1.5 block">Creditor</Label>
                  <input
                    type="text"
                    value={debtForm.creditor}
                    onChange={(e) => setDebtForm({ ...debtForm, creditor: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100"
                    data-testid="debt-creditor-input"
                  />
                </div>
                <div>
                  <Label className="text-xs text-zinc-500 mb-1.5 block">Total Debt (CHF)</Label>
                  <input
                    type="number"
                    step="0.01"
                    value={debtForm.total_debt_chf}
                    onChange={(e) => setDebtForm({ ...debtForm, total_debt_chf: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono"
                    data-testid="debt-total-input"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={
                  loading ||
                  !debtForm.creditor.trim() ||
                  !debtForm.total_debt_chf ||
                  (!debtEditingId && !debtForm.entity_id)
                }
                onClick={debtEditingId ? handleDebtSave : handleDebtCreate}
                className="btn-primary w-full text-sm py-2"
                data-testid="save-debt-btn"
              >
                {debtEditingId ? "Update Debt" : "Add Debt"}
              </button>
            </div>
          )}
        </div>

        </>
        )}

        {showEntityCreate && (
          <div className="fixed inset-0 z-[60] bg-zinc-950/80 flex items-center justify-center">
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg w-64 space-y-3">
              <h4 className="text-sm font-medium text-zinc-200">New Entity</h4>
              <input
                type="text"
                placeholder="Entity name"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateEntity()}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100"
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => setShowEntityCreate(false)} className="flex-1 btn-secondary text-xs">
                  Cancel
                </button>
                <button
                  onClick={handleCreateEntity}
                  disabled={!newEntityName.trim()}
                  className="flex-1 btn-primary text-xs"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <CashPositionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  );
};
