import { useState, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import { PencilSimple, X, Check } from "@phosphor-icons/react";
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

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Inline cell edit dialog
const CellEditDialog = ({ flow, month, open, onOpenChange, onSave }) => {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const handleOpen = () => {
    if (flow) {
      setAmount(flow.amount?.toString() || "");
    }
  };

  const handleSave = async () => {
    if (!amount) return;
    setSaving(true);
    try {
      await axios.put(`${API}/cash-flows/${flow.id}`, {
        amount: parseFloat(amount),
      });
      toast.success("Updated");
      onSave?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to update:", err);
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-xs" onOpenAutoFocus={handleOpen}>
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading text-base">Edit Flow</DialogTitle>
          <DialogDescription className="text-zinc-500">
            {flow?.label} — {month}
          </DialogDescription>
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
          {flow?.is_percentage && (
            <p className="text-xs text-amber-400">
              This is a percentage-based linked flow. Editing the parent amount will recalculate this value.
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="flex-1 btn-secondary text-sm">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || flow?.is_percentage}
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

export const CashFlowTable = ({ projection, flows, scenario, selectedEntityId, onDataChange }) => {
  const [editingCell, setEditingCell] = useState(null);

  // Build the matrix data from projection months and raw flows
  const { revenueRows, expenseRows, months, monthTotals } = useMemo(() => {
    if (!projection || !flows || flows.length === 0) {
      return { revenueRows: [], expenseRows: [], months: [], monthTotals: {} };
    }

    const months = projection.months.map(m => ({
      key: m.month,
      label: m.month_label,
    }));

    // Group flows: only parent/standalone flows (not children) to avoid double counting
    const parentFlows = flows.filter(f => !f.parent_id);
    
    // Separate revenues and expenses
    const revenues = parentFlows.filter(f => f.amount > 0);
    const expenses = parentFlows.filter(f => f.amount <= 0);

    // For each flow, determine which months it appears in
    const buildRow = (flow) => {
      const row = { flow, cells: {} };
      const flowDate = new Date(flow.date);
      const recurrence = flow.recurrence || "none";
      const recurrenceMode = flow.recurrence_mode || "repeat";
      const maxCount = flow.recurrence_count || 999;
      
      // Get all linked children
      const children = flows.filter(f => f.parent_id === flow.id);
      const childTotal = children.reduce((sum, c) => sum + (c.amount || 0), 0);
      const netAmount = flow.amount + childTotal;

      if (recurrence === "none") {
        const key = `${flowDate.getFullYear()}-${String(flowDate.getMonth() + 1).padStart(2, '0')}`;
        if (recurrenceMode === "distribute" && maxCount < 999) {
          row.cells[key] = { amount: round2(flow.amount / maxCount), netAmount: round2(netAmount / maxCount) };
        } else {
          row.cells[key] = { amount: flow.amount, netAmount };
        }
      } else {
        const interval = recurrence === "monthly" ? 1 : 3;
        let count = 0;
        const totalAmount = flow.amount;
        const totalNet = netAmount;

        while (count < maxCount) {
          const d = new Date(flowDate);
          d.setMonth(d.getMonth() + count * interval);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          
          if (recurrenceMode === "distribute" && maxCount < 999) {
            const perPeriod = round2(totalAmount / maxCount);
            const lastPeriod = round2(totalAmount - perPeriod * (maxCount - 1));
            const amt = count === maxCount - 1 ? lastPeriod : perPeriod;
            
            const netPerPeriod = round2(totalNet / maxCount);
            const netLast = round2(totalNet - netPerPeriod * (maxCount - 1));
            const netAmt = count === maxCount - 1 ? netLast : netPerPeriod;
            
            row.cells[key] = { amount: amt, netAmount: netAmt };
          } else {
            row.cells[key] = { amount: totalAmount, netAmount: totalNet };
          }
          count++;
        }
      }
      return row;
    };

    const revenueRows = revenues.map(buildRow);
    const expenseRows = expenses.map(buildRow);

    // Calculate month totals from projection data (single source of truth)
    const monthTotals = {};
    projection.months.forEach(m => {
      monthTotals[m.month] = {
        inflows: m.inflows,
        outflows: m.outflows,
        net: m.net,
      };
    });

    return { revenueRows, expenseRows, months, monthTotals };
  }, [projection, flows]);

  if (!projection || months.length === 0) {
    return (
      <div className="surface-card p-6 text-center" data-testid="cashflow-table">
        <p className="text-zinc-500 text-sm">Add flows to see the cash flow table</p>
      </div>
    );
  }

  const handleCellClick = (flow) => {
    if (flow.is_percentage) return; // Can't directly edit percentage-based flows
    setEditingCell(flow);
  };

  return (
    <div className="surface-card" data-testid="cashflow-table">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          Cash Flow Table
        </h2>
      </div>

      <ScrollArea className="w-full" orientation="horizontal">
        <div className="min-w-max">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="sticky left-0 bg-zinc-900 z-10 text-left px-3 py-2 text-zinc-400 font-medium w-[180px] min-w-[180px]">
                  Flow
                </th>
                {months.map(m => (
                  <th key={m.key} className="text-right px-2 py-2 text-zinc-500 font-medium min-w-[80px]">
                    {m.label.split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* REVENUES SECTION */}
              {revenueRows.length > 0 && (
                <>
                  <tr className="border-b border-emerald-500/10">
                    <td colSpan={months.length + 1} className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-emerald-400 text-xs font-medium uppercase tracking-wider">
                      Revenues
                    </td>
                  </tr>
                  {revenueRows.map(({ flow, cells }) => (
                    <tr key={flow.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                      <td className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[180px]" title={flow.label}>
                        {flow.label}
                      </td>
                      {months.map(m => {
                        const cell = cells[m.key];
                        return (
                          <td
                            key={m.key}
                            className={`text-right px-2 py-1.5 font-mono ${
                              cell ? 'text-emerald-400 cursor-pointer hover:bg-emerald-500/10' : 'text-zinc-700'
                            }`}
                            onClick={() => cell && handleCellClick(flow)}
                            data-testid={`cell-${flow.id}-${m.key}`}
                          >
                            {cell ? formatCompact(cell.amount) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              )}

              {/* EXPENSES SECTION */}
              {expenseRows.length > 0 && (
                <>
                  <tr className="border-b border-rose-500/10">
                    <td colSpan={months.length + 1} className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-rose-400 text-xs font-medium uppercase tracking-wider">
                      Expenses
                    </td>
                  </tr>
                  {expenseRows.map(({ flow, cells }) => (
                    <tr key={flow.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                      <td className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[180px]" title={flow.label}>
                        {flow.label}
                      </td>
                      {months.map(m => {
                        const cell = cells[m.key];
                        return (
                          <td
                            key={m.key}
                            className={`text-right px-2 py-1.5 font-mono ${
                              cell ? 'text-rose-400 cursor-pointer hover:bg-rose-500/10' : 'text-zinc-700'
                            }`}
                            onClick={() => cell && handleCellClick(flow)}
                            data-testid={`cell-${flow.id}-${m.key}`}
                          >
                            {cell ? formatCompact(cell.amount) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              )}

              {/* NET ROW - from projection (single source of truth) */}
              <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                <td className="sticky left-0 bg-zinc-800/50 z-10 px-3 py-2 text-zinc-200 font-semibold">
                  Net P/L
                </td>
                {months.map(m => {
                  const totals = monthTotals[m.key];
                  const net = totals ? totals.net : 0;
                  return (
                    <td
                      key={m.key}
                      className={`text-right px-2 py-2 font-mono font-semibold ${
                        net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-500'
                      }`}
                    >
                      {totals ? formatCompact(net) : '—'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </ScrollArea>

      {/* Cell Edit Dialog */}
      <CellEditDialog
        flow={editingCell}
        month={editingCell ? "" : ""}
        open={!!editingCell}
        onOpenChange={(open) => !open && setEditingCell(null)}
        onSave={onDataChange}
      />
    </div>
  );
};

function round2(n) {
  return Math.round(n * 100) / 100;
}
