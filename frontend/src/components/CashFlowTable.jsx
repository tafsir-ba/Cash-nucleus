import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { PencilSimple, Check } from "@phosphor-icons/react";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCompact = (amount) => {
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toFixed(0);
};

// Edit dialog for clicking a flow row label
const FlowEditDialog = ({ flow, open, onOpenChange, onSave }) => {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (flow) setAmount(flow.amount?.toString() || "");
  }, [flow]);

  const handleSave = async () => {
    if (!amount) return;
    setSaving(true);
    try {
      await axios.put(`${API}/cash-flows/${flow.flow_id}`, { amount: parseFloat(amount) });
      toast.success("Updated");
      onSave?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  if (!flow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading text-base">Edit Flow</DialogTitle>
          <DialogDescription className="text-zinc-500">{flow.label}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Amount (CHF)</Label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono"
              autoFocus
              data-testid="cell-edit-amount"
            />
          </div>
          {flow.is_percentage && (
            <p className="text-xs text-amber-400">
              Percentage-based flow. Edit the parent to recalculate.
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="flex-1 btn-secondary text-sm">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || flow.is_percentage}
              className="flex-1 btn-primary text-sm flex items-center justify-center gap-1"
              data-testid="cell-edit-save"
            >
              <Check size={14} /> Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const CashFlowTable = ({ scenario, selectedEntityId, horizon, onDataChange, refreshKey }) => {
  const [matrixData, setMatrixData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editingFlow, setEditingFlow] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [hoveredCol, setHoveredCol] = useState(null);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const params = { scenario, horizon };
      if (selectedEntityId) params.entity_id = selectedEntityId;
      const res = await axios.get(`${API}/projection/matrix`, { params });
      setMatrixData(res.data);
    } catch (err) {
      console.error("Matrix fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [scenario, selectedEntityId, horizon]);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix, refreshKey]);

  const handleRowClick = (row) => {
    if (row.is_percentage) return;
    // Fetch the original flow to get its amount
    axios.get(`${API}/cash-flows`).then(res => {
      const original = res.data.find(f => f.id === row.flow_id);
      if (original) {
        setEditingFlow({ ...row, amount: original.amount });
      }
    });
  };

  const handleSaved = () => {
    fetchMatrix();
    onDataChange?.();
  };

  if (!matrixData || (matrixData.revenue_rows.length === 0 && matrixData.expense_rows.length === 0)) {
    return (
      <div className="surface-card p-6 text-center" data-testid="cashflow-table">
        <p className="text-zinc-500 text-sm">Add flows to see the cash flow table</p>
      </div>
    );
  }

  const { months, revenue_rows, expense_rows, net_per_month } = matrixData;

  return (
    <div className="surface-card" data-testid="cashflow-table">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          Cash Flow Table
        </h2>
        {loading && <span className="text-xs text-zinc-600">Updating...</span>}
      </div>

      <ScrollArea className="w-full" orientation="horizontal">
        <div className="min-w-max">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="sticky left-0 bg-zinc-900 z-10 text-left px-3 py-2.5 text-zinc-400 font-medium w-[200px] min-w-[200px]">
                  Flow
                </th>
                {months.map((m, ci) => (
                  <th
                    key={m.key}
                    className={`text-right px-2 py-2.5 text-zinc-500 font-medium min-w-[80px] transition-colors ${
                      hoveredCol === ci ? 'bg-zinc-800/30' : ''
                    }`}
                  >
                    {m.label.split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* REVENUES SECTION */}
              {revenue_rows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={months.length + 1} className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-emerald-400 text-xs font-medium uppercase tracking-wider border-b border-emerald-500/10">
                      Revenues
                    </td>
                  </tr>
                  {revenue_rows.map((row, ri) => (
                    <tr
                      key={row.flow_id}
                      className={`border-b border-zinc-800/20 transition-colors ${
                        hoveredRow === `r-${ri}` ? 'bg-zinc-800/20' : ''
                      }`}
                      onMouseEnter={() => setHoveredRow(`r-${ri}`)}
                      onMouseLeave={() => setHoveredRow(null)}
                    >
                      <td
                        className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[200px] cursor-pointer hover:text-emerald-400 transition-colors"
                        title={`${row.label} — click to edit`}
                        onClick={() => handleRowClick(row)}
                        data-testid={`row-label-${row.flow_id}`}
                      >
                        {row.parent_id && <span className="text-zinc-600 mr-1">└</span>}
                        {row.label}
                        {row.is_percentage && <span className="ml-1 text-amber-500/60 text-[10px]">%</span>}
                      </td>
                      {months.map((m, ci) => {
                        const val = row.cells[m.key];
                        return (
                          <td
                            key={m.key}
                            className={`text-right px-2 py-1.5 font-mono transition-colors ${
                              hoveredCol === ci ? 'bg-zinc-800/20' : ''
                            } ${val !== undefined ? 'text-emerald-400' : 'text-zinc-800'}`}
                            onMouseEnter={() => setHoveredCol(ci)}
                            onMouseLeave={() => setHoveredCol(null)}
                            data-testid={`cell-${row.flow_id}-${m.key}`}
                          >
                            {val !== undefined ? formatCompact(val) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              )}

              {/* EXPENSES SECTION */}
              {expense_rows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={months.length + 1} className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-rose-400 text-xs font-medium uppercase tracking-wider border-b border-rose-500/10">
                      Expenses
                    </td>
                  </tr>
                  {expense_rows.map((row, ri) => (
                    <tr
                      key={row.flow_id}
                      className={`border-b border-zinc-800/20 transition-colors ${
                        hoveredRow === `e-${ri}` ? 'bg-zinc-800/20' : ''
                      }`}
                      onMouseEnter={() => setHoveredRow(`e-${ri}`)}
                      onMouseLeave={() => setHoveredRow(null)}
                    >
                      <td
                        className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[200px] cursor-pointer hover:text-rose-400 transition-colors"
                        title={`${row.label} — click to edit`}
                        onClick={() => handleRowClick(row)}
                        data-testid={`row-label-${row.flow_id}`}
                      >
                        {row.parent_id && <span className="text-zinc-600 mr-1">└</span>}
                        {row.label}
                        {row.is_percentage && <span className="ml-1 text-amber-500/60 text-[10px]">%</span>}
                      </td>
                      {months.map((m, ci) => {
                        const val = row.cells[m.key];
                        return (
                          <td
                            key={m.key}
                            className={`text-right px-2 py-1.5 font-mono transition-colors ${
                              hoveredCol === ci ? 'bg-zinc-800/20' : ''
                            } ${val !== undefined ? 'text-rose-400' : 'text-zinc-800'}`}
                            onMouseEnter={() => setHoveredCol(ci)}
                            onMouseLeave={() => setHoveredCol(null)}
                            data-testid={`cell-${row.flow_id}-${m.key}`}
                          >
                            {val !== undefined ? formatCompact(val) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              )}

              {/* NET P/L ROW - from same expanded data */}
              <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                <td className="sticky left-0 bg-zinc-800/50 z-10 px-3 py-2 text-zinc-200 font-semibold">
                  Net P/L
                </td>
                {months.map((m, ci) => {
                  const net = net_per_month[m.key] || 0;
                  return (
                    <td
                      key={m.key}
                      className={`text-right px-2 py-2 font-mono font-semibold transition-colors ${
                        hoveredCol === ci ? 'bg-zinc-700/30' : ''
                      } ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-500'}`}
                      onMouseEnter={() => setHoveredCol(ci)}
                      onMouseLeave={() => setHoveredCol(null)}
                    >
                      {formatCompact(net)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </ScrollArea>

      <FlowEditDialog
        flow={editingFlow}
        open={!!editingFlow}
        onOpenChange={(open) => !open && setEditingFlow(null)}
        onSave={handleSaved}
      />
    </div>
  );
};
