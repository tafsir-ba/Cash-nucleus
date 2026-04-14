import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, Trash, PencilSimple, X, Bank, CaretUpDown } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Label } from "../components/ui/label";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const COLORS = [
  'bg-zinc-100', 'bg-emerald-400', 'bg-amber-400', 'bg-rose-400',
  'bg-sky-400', 'bg-violet-400', 'bg-orange-400', 'bg-teal-400',
];

export const TreasuryDrawer = ({ open, onOpenChange, onDataChange, entities, onEntitiesChange, cashNow }) => {
  const [accounts, setAccounts] = useState([]);
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debtEditingId, setDebtEditingId] = useState(null);
  const [debtForm, setDebtForm] = useState({ creditor: "", total_debt_chf: "" });
  const [editingId, setEditingId] = useState(null);
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('desc');
  const [formData, setFormData] = useState({
    label: "",
    amount: "",
    entity_id: "",
  });
  const [showEntityCreate, setShowEntityCreate] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/bank-accounts`);
      setAccounts(response.data);
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    }
  }, []);

  const fetchDebts = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/treasury/debts`);
      setDebts(response.data);
    } catch (error) {
      console.error("Failed to fetch debts:", error);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchAccounts();
      fetchDebts();
    }
  }, [open, fetchAccounts, fetchDebts]);

  useEffect(() => {
    if (entities.length > 0 && !formData.entity_id) {
      setFormData(f => ({ ...f, entity_id: entities[0].id }));
    }
  }, [entities, formData.entity_id]);

  const resetForm = () => {
    setFormData({
      label: "",
      amount: "",
      entity_id: entities.length > 0 ? entities[0].id : ""
    });
    setEditingId(null);
  };

  const handleCreateEntity = async () => {
    if (!newEntityName.trim()) return;
    try {
      const response = await axios.post(`${API}/entities`, { name: newEntityName.trim() });
      onEntitiesChange?.();
      setFormData(f => ({ ...f, entity_id: response.data.id }));
      setNewEntityName("");
      setShowEntityCreate(false);
      toast.success("Entity created");
    } catch (error) {
      toast.error("Failed to create entity");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.label || !formData.amount || !formData.entity_id) return;

    setLoading(true);
    try {
      const payload = {
        label: formData.label,
        amount: parseFloat(formData.amount),
        entity_id: formData.entity_id,
      };

      if (editingId) {
        await axios.put(`${API}/bank-accounts/${editingId}`, payload);
        toast.success("Account updated");
      } else {
        await axios.post(`${API}/bank-accounts`, payload);
        toast.success("Account added");
      }

      resetForm();
      setShowAddForm(false);
      fetchAccounts();
      onDataChange?.();
    } catch (error) {
      toast.error("Failed to save account");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (account) => {
    setEditingId(account.id);
    setFormData({
      label: account.label,
      amount: account.amount.toString(),
      entity_id: account.entity_id,
    });
    setShowAddForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this bank account?")) return;
    try {
      await axios.delete(`${API}/bank-accounts/${id}`);
      toast.success("Account deleted");
      fetchAccounts();
      onDataChange?.();
    } catch (error) {
      toast.error("Failed to delete account");
    }
  };

  const totalBalance = cashNow ?? accounts.reduce((sum, acc) => sum + acc.amount, 0);
  const totalDebt = debts.reduce((sum, debt) => sum + debt.total_debt_chf, 0);

  const getEntityName = (entityId) => {
    return entities.find(e => e.id === entityId)?.name || "Unknown";
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedAccounts = [...accounts].sort((a, b) => {
    if (!sortField) return 0;
    let aVal, bVal;
    if (sortField === 'entity') {
      aVal = getEntityName(a.entity_id);
      bVal = getEntityName(b.entity_id);
    } else if (sortField === 'label') {
      aVal = a.label;
      bVal = b.label;
    } else if (sortField === 'amount') {
      aVal = a.amount;
      bVal = b.amount;
    }
    if (typeof aVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const SortHeader = ({ field, children }) => (
    <th
      onClick={() => handleSort(field)}
      className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-left py-3 px-3 cursor-pointer hover:text-zinc-300 transition-colors select-none"
    >
      <span className="flex items-center gap-1">
        {children}
        <CaretUpDown size={12} className={sortField === field ? 'text-zinc-300' : 'text-zinc-600'} />
      </span>
    </th>
  );

  const startDebtEdit = (debt) => {
    setDebtEditingId(debt.source_flow_id);
    setDebtForm({
      creditor: debt.creditor || "",
      total_debt_chf: debt.total_debt_chf?.toString() || "",
    });
  };

  const cancelDebtEdit = () => {
    setDebtEditingId(null);
    setDebtForm({ creditor: "", total_debt_chf: "" });
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
    } catch (error) {
      toast.error("Failed to update debt");
    } finally {
      setLoading(false);
    }
  };

  const handleDebtDelete = async (debt) => {
    if (!window.confirm(`Delete debt "${debt.creditor}"?`)) return;
    try {
      await axios.delete(`${API}/cash-flows/${debt.source_flow_id}`);
      toast.success("Debt deleted");
      fetchDebts();
      onDataChange?.();
    } catch (error) {
      toast.error("Failed to delete debt");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-zinc-950 border-zinc-800 w-[560px] sm:max-w-[560px] p-0 flex flex-col"
        data-testid="treasury-drawer"
      >
        {/* Sticky Header */}
        <div className="border-b border-zinc-800 px-6 pt-6 pb-4 flex-shrink-0">
          <SheetHeader>
            <div className="flex items-center gap-2 mb-1">
              <Bank size={18} className="text-zinc-400" />
              <SheetTitle className="text-zinc-100 font-heading text-base tracking-wide">
                Treasury
              </SheetTitle>
            </div>
            <SheetDescription className="text-zinc-600 text-xs">
              Bank accounts & liquidity overview
            </SheetDescription>
          </SheetHeader>

          {/* Total Cash */}
          <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total Cash Now</p>
                <p className="text-2xl font-mono text-zinc-50 font-light tracking-tight" data-testid="treasury-total">
                  {formatCurrency(totalBalance)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-600">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* Liquidity Distribution Bar */}
          {accounts.length > 0 && totalBalance > 0 && (
            <div data-testid="liquidity-bar">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Liquidity Distribution</p>
              <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                {sortedAccounts
                  .filter(a => a.amount > 0)
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
                  })
                }
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {sortedAccounts
                  .filter(a => a.amount > 0)
                  .sort((a, b) => b.amount - a.amount)
                  .map((acc, i) => (
                    <span key={acc.id} className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} />
                      {acc.label}
                    </span>
                  ))
                }
              </div>
            </div>
          )}

          {/* Accounts Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Accounts</p>
              <button
                onClick={() => { resetForm(); setShowAddForm(!showAddForm); }}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                data-testid="add-account-toggle"
              >
                <Plus size={14} weight="bold" />
                Add Account
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="text-center py-8 text-zinc-600 text-sm">
                No bank accounts yet. Add one below.
              </div>
            ) : (
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full" data-testid="treasury-table">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/50">
                      <SortHeader field="entity">Entity</SortHeader>
                      <SortHeader field="label">Account</SortHeader>
                      <SortHeader field="amount">Balance</SortHeader>
                      <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-right py-3 px-3">Share</th>
                      <th className="py-3 px-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAccounts.map((account) => {
                      const share = totalBalance > 0 ? ((account.amount / totalBalance) * 100) : 0;
                      return (
                        <tr
                          key={account.id}
                          className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors"
                          data-testid={`treasury-row-${account.id}`}
                        >
                          <td className="py-2.5 px-3 text-xs text-zinc-500">
                            {getEntityName(account.entity_id)}
                          </td>
                          <td className="py-2.5 px-3 text-sm text-zinc-200">
                            {account.label}
                          </td>
                          <td className="py-2.5 px-3 text-sm font-mono text-zinc-100 tabular-nums">
                            {formatCurrency(account.amount)}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-zinc-500 text-right tabular-nums">
                            {share.toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleEdit(account)}
                                className="p-1 text-zinc-600 hover:text-zinc-300 rounded transition-colors"
                                data-testid={`edit-account-${account.id}`}
                              >
                                <PencilSimple size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(account.id)}
                                className="p-1 text-zinc-600 hover:text-rose-400 rounded transition-colors"
                                data-testid={`delete-account-${account.id}`}
                              >
                                <Trash size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Add/Edit Form */}
          {(showAddForm || accounts.length === 0) && (
            <form onSubmit={handleSubmit} className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-zinc-900/30" data-testid="treasury-form">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-300">
                  {editingId ? 'Edit Account' : 'New Account'}
                </h3>
                {(editingId || showAddForm) && accounts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { resetForm(); setShowAddForm(false); }}
                    className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* Entity */}
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Entity</Label>
                <div className="flex gap-2">
                  <Select value={formData.entity_id} onValueChange={(v) => setFormData({ ...formData, entity_id: v })}>
                    <SelectTrigger className="flex-1 bg-zinc-950 border-zinc-800 h-[38px] text-sm">
                      <SelectValue placeholder="Select entity" />
                    </SelectTrigger>
                    <SelectContent>
                      {entities.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
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

              <div className="grid grid-cols-2 gap-3">
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
                  <Label className="text-xs text-zinc-500 mb-1.5 block">Balance (CHF)</Label>
                  <input
                    type="number"
                    placeholder="0"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 placeholder-zinc-500 font-mono"
                    data-testid="account-amount-input"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !formData.label || !formData.amount || !formData.entity_id}
                className="btn-primary w-full flex items-center justify-center gap-2 text-sm py-2"
                data-testid="save-account-btn"
              >
                {editingId ? (
                  <><PencilSimple size={14} /> Update Account</>
                ) : (
                  <><Plus size={14} weight="bold" /> Add Account</>
                )}
              </button>
            </form>
          )}

          {/* Debt Consolidation */}
          <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30" data-testid="treasury-debt-consolidation">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">Debt Consolidation</p>
              <p className="text-xs text-zinc-400">
                Total debt: <span className="font-mono text-zinc-200">{formatCurrency(totalDebt)}</span>
              </p>
            </div>

            {debts.length === 0 ? (
              <div className="text-zinc-600 text-sm py-3">
                No debt-tagged cash flows found.
              </div>
            ) : (
              <div className="border border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full" data-testid="treasury-debt-table">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/50">
                      <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-left py-3 px-3">Creditor</th>
                      <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-left py-3 px-3">Entity</th>
                      <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-right py-3 px-3">Total Debt</th>
                      <th className="py-3 px-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {debts.map((debt) => (
                      <tr key={debt.source_flow_id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors">
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

            {debtEditingId && (
              <div className="mt-3 border border-zinc-800 rounded-lg p-3 bg-zinc-950/50 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider">Edit Debt</p>
                  <button
                    type="button"
                    onClick={cancelDebtEdit}
                    className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                  disabled={loading || !debtForm.creditor.trim() || !debtForm.total_debt_chf}
                  onClick={handleDebtSave}
                  className="btn-primary w-full text-sm py-2"
                  data-testid="save-debt-btn"
                >
                  Update Debt
                </button>
              </div>
            )}
          </div>

          {/* Create Entity Overlay */}
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
                  <button onClick={() => setShowEntityCreate(false)} className="flex-1 btn-secondary text-xs">Cancel</button>
                  <button onClick={handleCreateEntity} disabled={!newEntityName.trim()} className="flex-1 btn-primary text-xs">Create</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
