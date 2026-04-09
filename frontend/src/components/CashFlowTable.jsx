import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, X } from "@phosphor-icons/react";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { FlowEditor } from "./FlowEditor";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCompact = (amount) => {
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toFixed(0);
};

// Actual input dialog for cell click
const ActualInputDialog = ({ cellInfo, open, onOpenChange, onSave }) => {
  const [actualVal, setActualVal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cellInfo && open) {
      // Pre-fill with current value (actual if exists, else planned)
      const val = cellInfo.cell?.has_actual ? cellInfo.cell.actual : cellInfo.cell?.amount;
      setActualVal(val !== undefined ? Math.abs(val).toString() : "");
    }
  }, [cellInfo, open]);

  if (!cellInfo) return null;

  const planned = cellInfo.cell?.has_actual ? cellInfo.cell.planned : cellInfo.cell?.amount;
  const isRevenue = (planned || 0) > 0;

  const handleSave = async (action) => {
    setSaving(true);
    try {
      const sign = isRevenue ? 1 : -1;
      const actualAmount = parseFloat(actualVal) * sign;
      await axios.put(`${API}/flow-occurrences`, {
        flow_id: cellInfo.flowId,
        month: cellInfo.month,
        actual_amount: actualAmount,
        variance_action: action,
      });
      toast.success("Actual recorded");
      onSave?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await axios.delete(`${API}/flow-occurrences?flow_id=${cellInfo.flowId}&month=${cellInfo.month}`);
      toast.success("Actual cleared");
      onSave?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to clear");
    } finally {
      setSaving(false);
    }
  };

  const plannedAbs = Math.abs(planned || 0);
  const actualAbs = actualVal ? parseFloat(actualVal) : null;
  const hasVariance = actualAbs !== null && Math.abs(actualAbs - plannedAbs) > 0.01;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading text-sm">Record Actual</DialogTitle>
          <DialogDescription className="text-zinc-500">
            {cellInfo.label} — {cellInfo.monthLabel}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-zinc-500">
            Planned: <span className="font-mono text-zinc-300">CHF {plannedAbs.toLocaleString('de-CH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Actual (CHF)</Label>
            <input type="number" step="0.01" value={actualVal}
              onChange={(e) => setActualVal(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono"
              autoFocus data-testid="actual-input" />
          </div>
          {hasVariance && (
            <div className={`text-xs p-2 rounded ${
              actualAbs < plannedAbs ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
            }`}>
              Variance: CHF {Math.abs(plannedAbs - actualAbs).toLocaleString('de-CH', { minimumFractionDigits: 2 })}
              {actualAbs < plannedAbs ? ' (under)' : ' (over)'}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {hasVariance ? (
              <>
                <button onClick={() => handleSave("carry_forward")} disabled={saving}
                  className="btn-primary text-xs flex items-center justify-center gap-1" data-testid="actual-carry">
                  <Check size={12} /> Save & Carry Forward Variance
                </button>
                <button onClick={() => handleSave("write_off")} disabled={saving}
                  className="btn-secondary text-xs" data-testid="actual-writeoff">
                  Save & Write Off Variance
                </button>
              </>
            ) : (
              <button onClick={() => handleSave(null)} disabled={saving || !actualVal}
                className="btn-primary text-xs flex items-center justify-center gap-1" data-testid="actual-confirm">
                <Check size={12} /> Confirm Actual
              </button>
            )}
            {cellInfo.cell?.has_actual && (
              <button onClick={handleClear} disabled={saving}
                className="text-xs text-zinc-600 hover:text-zinc-400 mt-1" data-testid="actual-clear">
                Clear actual (revert to planned)
              </button>
            )}
            <button onClick={() => onOpenChange(false)} className="text-xs text-zinc-600 hover:text-zinc-400">
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const CashFlowTable = ({ scenario, selectedEntityId, horizon, onDataChange, refreshKey, entities }) => {
  const [matrixData, setMatrixData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editingFlow, setEditingFlow] = useState(null);
  const [actualCell, setActualCell] = useState(null);
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
    // Open full canonical editor
    axios.get(`${API}/cash-flows`).then(res => {
      const original = res.data.find(f => f.id === row.flow_id);
      if (original) setEditingFlow(original);
    });
  };

  const handleCellClick = (row, month, cell) => {
    if (row.is_percentage) return; // Can't set actuals on % flows directly
    setActualCell({
      flowId: row.flow_id,
      label: row.label,
      month: month.key,
      monthLabel: month.label,
      cell,
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

  const renderCell = (row, month, ci, colorClass) => {
    const cell = row.cells[month.key];
    if (!cell) {
      return (
        <td key={month.key}
          className={`text-right px-2 py-1.5 font-mono text-zinc-800 transition-colors ${hoveredCol === ci ? 'bg-zinc-800/20' : ''}`}
          onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}>
          —
        </td>
      );
    }
    const hasActual = cell.has_actual;
    return (
      <td key={month.key}
        className={`text-right px-2 py-1.5 font-mono cursor-pointer transition-colors ${
          hoveredCol === ci ? 'bg-zinc-800/20' : ''
        } ${hasActual ? `${colorClass} ring-1 ring-inset ring-cyan-500/30 bg-cyan-500/5` : colorClass} hover:bg-zinc-700/30`}
        onClick={() => handleCellClick(row, month, cell)}
        onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}
        title={hasActual ? `Actual: ${cell.actual} | Planned: ${cell.planned}` : `Planned: ${cell.amount} — click to record actual`}
        data-testid={`cell-${row.flow_id}-${month.key}`}>
        {formatCompact(cell.amount)}
        {hasActual && <span className="ml-0.5 text-cyan-400 text-[8px] align-super">A</span>}
      </td>
    );
  };

  // Calculate row totals
  const calcRowTotal = (row) => {
    return Object.values(row.cells).reduce((sum, cell) => sum + (cell?.amount || 0), 0);
  };
  const netTotal = Object.values(net_per_month).reduce((sum, v) => sum + v, 0);

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
                  <th key={m.key}
                    className={`text-right px-2 py-2.5 text-zinc-500 font-medium min-w-[80px] transition-colors ${hoveredCol === ci ? 'bg-zinc-800/30' : ''}`}>
                    {m.label.split(' ')[0]}
                  </th>
                ))}
                <th className="text-right px-3 py-2.5 text-zinc-400 font-medium min-w-[90px] border-l border-zinc-800">
                  Total {horizon}M
                </th>
              </tr>
            </thead>
            <tbody>
              {/* REVENUES */}
              {revenue_rows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={months.length + 2} className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-emerald-400 text-xs font-medium uppercase tracking-wider border-b border-emerald-500/10">
                      Revenues
                    </td>
                  </tr>
                  {revenue_rows.map((row, ri) => (
                    <tr key={row.flow_id}
                      className={`border-b border-zinc-800/20 transition-colors ${hoveredRow === `r-${ri}` ? 'bg-zinc-800/20' : ''}`}
                      onMouseEnter={() => setHoveredRow(`r-${ri}`)} onMouseLeave={() => setHoveredRow(null)}>
                      <td className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[200px] cursor-pointer hover:text-emerald-400 transition-colors"
                        title={`${row.label} — click to edit source flow`}
                        onClick={() => handleRowClick(row)}
                        data-testid={`row-label-${row.flow_id}`}>
                        {row.parent_id && <span className="text-zinc-600 mr-1">└</span>}
                        {row.label}
                        {row.is_percentage && <span className="ml-1 text-amber-500/60 text-[10px]">%</span>}
                      </td>
                      {months.map((m, ci) => renderCell(row, m, ci, 'text-emerald-400'))}
                      <td className="text-right px-3 py-1.5 font-mono text-emerald-400/70 font-medium border-l border-zinc-800">
                        {formatCompact(calcRowTotal(row))}
                      </td>
                    </tr>
                  ))}
                </>
              )}

              {/* EXPENSES */}
              {expense_rows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={months.length + 2} className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-rose-400 text-xs font-medium uppercase tracking-wider border-b border-rose-500/10">
                      Expenses
                    </td>
                  </tr>
                  {expense_rows.map((row, ri) => (
                    <tr key={row.flow_id}
                      className={`border-b border-zinc-800/20 transition-colors ${hoveredRow === `e-${ri}` ? 'bg-zinc-800/20' : ''}`}
                      onMouseEnter={() => setHoveredRow(`e-${ri}`)} onMouseLeave={() => setHoveredRow(null)}>
                      <td className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[200px] cursor-pointer hover:text-rose-400 transition-colors"
                        title={`${row.label} — click to edit source flow`}
                        onClick={() => handleRowClick(row)}
                        data-testid={`row-label-${row.flow_id}`}>
                        {row.parent_id && <span className="text-zinc-600 mr-1">└</span>}
                        {row.label}
                        {row.is_percentage && <span className="ml-1 text-amber-500/60 text-[10px]">%</span>}
                      </td>
                      {months.map((m, ci) => renderCell(row, m, ci, 'text-rose-400'))}
                      <td className="text-right px-3 py-1.5 font-mono text-rose-400/70 font-medium border-l border-zinc-800">
                        {formatCompact(calcRowTotal(row))}
                      </td>
                    </tr>
                  ))}
                </>
              )}

              {/* NET P/L ROW */}
              <tr className="border-t-2 border-zinc-700 bg-zinc-800/30">
                <td className="sticky left-0 bg-zinc-800/50 z-10 px-3 py-2 text-zinc-200 font-semibold">
                  Net P/L
                </td>
                {months.map((m, ci) => {
                  const net = net_per_month[m.key] || 0;
                  return (
                    <td key={m.key}
                      className={`text-right px-2 py-2 font-mono font-semibold transition-colors ${
                        hoveredCol === ci ? 'bg-zinc-700/30' : ''
                      } ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-500'}`}
                      onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}>
                      {formatCompact(net)}
                    </td>
                  );
                })}
                <td className={`text-right px-3 py-2 font-mono font-semibold border-l border-zinc-800 ${
                  netTotal > 0 ? 'text-emerald-400' : netTotal < 0 ? 'text-rose-400' : 'text-zinc-500'
                }`}>
                  {formatCompact(netTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ScrollArea>

      {/* Full canonical editor for row click */}
      <FlowEditor
        flow={editingFlow}
        open={!!editingFlow}
        onOpenChange={(open) => !open && setEditingFlow(null)}
        entities={entities || []}
        onSave={handleSaved}
      />

      {/* Actual input for cell click */}
      <ActualInputDialog
        cellInfo={actualCell}
        open={!!actualCell}
        onOpenChange={(open) => !open && setActualCell(null)}
        onSave={handleSaved}
      />
    </div>
  );
};
