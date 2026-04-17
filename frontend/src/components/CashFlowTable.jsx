import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, X, ArrowRight } from "@phosphor-icons/react";
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

const formatCHF = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(amount));
};

// Actual input dialog
const ActualInputDialog = ({ cellInfo, open, onOpenChange, onSave }) => {
  const [actualVal, setActualVal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cellInfo && open) {
      const val = cellInfo.cell?.has_actual ? cellInfo.cell.actual : cellInfo.cell?.amount;
      setActualVal(val !== undefined ? Math.abs(val).toString() : "");
    }
  }, [cellInfo, open]);

  if (!cellInfo) return null;

  const planned = cellInfo.cell?.has_actual ? cellInfo.cell.planned : cellInfo.cell?.amount;
  const isRevenue = (planned || 0) > 0;
  const plannedAbs = Math.abs(planned || 0);
  const actualAbs = actualVal ? parseFloat(actualVal) : null;
  const hasVariance = actualAbs !== null && Math.abs(actualAbs - plannedAbs) > 0.01;
  const varianceAmount = hasVariance ? plannedAbs - actualAbs : 0;
  const isUnder = varianceAmount > 0;

  const handleSave = async (action) => {
    setSaving(true);
    try {
      const sign = isRevenue ? 1 : -1;
      const actualAmount = parseFloat(actualVal) * sign;
      const res = await axios.put(`${API}/flow-occurrences`, {
        flow_id: cellInfo.flowId,
        month: cellInfo.month,
        actual_amount: actualAmount,
        variance_action: action,
      });
      
      // Show detailed feedback
      if (action === "carry_forward" && res.data.carryover_info) {
        const ci = res.data.carryover_info;
        toast.success(`Actual recorded. CHF ${formatCHF(ci.amount)} carried to ${ci.target_month}`);
      } else if (action === "write_off") {
        toast.success(`Actual recorded. CHF ${formatCHF(varianceAmount)} variance written off`);
      } else {
        toast.success("Actual confirmed");
      }
      
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
      toast.success("Actual cleared — reverted to planned");
      onSave?.();
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to clear");
    } finally {
      setSaving(false);
    }
  };

  // Compute next month label for carry forward preview
  const [y, m] = (cellInfo.month || "2026-01").split("-");
  const nextMonth = new Date(parseInt(y), parseInt(m), 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 font-heading text-sm">Record Actual</DialogTitle>
          <DialogDescription className="text-zinc-500">{cellInfo.label} — {cellInfo.monthLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Planned</span>
            <span className="font-mono text-zinc-300">CHF {formatCHF(plannedAbs)}</span>
          </div>
          <div>
            <Label className="text-xs text-zinc-500 mb-1 block">Actual (CHF)</Label>
            <input type="number" step="0.01" value={actualVal}
              onChange={(e) => setActualVal(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 font-mono"
              autoFocus data-testid="actual-input" />
          </div>
          
          {hasVariance && (
            <div className={`text-xs p-2.5 rounded-md space-y-2 ${
              isUnder ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'
            }`} data-testid="variance-summary">
              <div className="flex justify-between font-medium">
                <span className={isUnder ? 'text-amber-400' : 'text-emerald-400'}>
                  {isUnder ? 'Under-performance' : 'Over-performance'}
                </span>
                <span className={isUnder ? 'text-amber-400' : 'text-emerald-400'}>
                  CHF {formatCHF(varianceAmount)}
                </span>
              </div>
              <div className="text-zinc-500 text-[10px] space-y-0.5">
                <div className="flex justify-between"><span>Planned</span><span className="font-mono">CHF {formatCHF(plannedAbs)}</span></div>
                <div className="flex justify-between"><span>Actual</span><span className="font-mono text-cyan-400">CHF {formatCHF(actualAbs)}</span></div>
                <div className="flex justify-between border-t border-zinc-700/50 pt-0.5">
                  <span>Variance</span>
                  <span className={`font-mono font-medium ${isUnder ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {isUnder ? '-' : '+'}CHF {formatCHF(varianceAmount)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Impact Preview — shows financial consequence before confirming */}
          {hasVariance && (
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-md p-2 text-[10px] space-y-1" data-testid="impact-preview">
              <span className="text-zinc-500 uppercase tracking-wider font-medium">Impact Preview</span>
              <div className="text-zinc-400">
                {isUnder ? (
                  <>
                    <p>This month: Cash position <span className="text-amber-400">decreases</span> by CHF {formatCHF(varianceAmount)} vs plan</p>
                    <p>If carried → <span className="text-amber-400">{nextMonth}</span> receives +CHF {formatCHF(varianceAmount)} recovery flow</p>
                    <p>If written off → CHF {formatCHF(varianceAmount)} is <span className="text-zinc-500">permanently absorbed</span></p>
                  </>
                ) : (
                  <>
                    <p>This month: Cash position <span className="text-emerald-400">increases</span> by CHF {formatCHF(varianceAmount)} vs plan</p>
                    <p>If carried → <span className="text-amber-400">{nextMonth}</span> receives -CHF {formatCHF(varianceAmount)} adjustment</p>
                    <p>If written off → Surplus of CHF {formatCHF(varianceAmount)} is <span className="text-zinc-500">not offset</span></p>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5 pt-1">
            {hasVariance ? (
              <>
                <button onClick={() => handleSave("carry_forward")} disabled={saving}
                  className="btn-primary text-xs py-2.5 text-left px-3 space-y-0.5" data-testid="actual-carry">
                  <div className="flex items-center gap-1.5 font-medium">
                    <ArrowRight size={12} /> Carry forward to {nextMonth}
                  </div>
                  <div className="text-[10px] text-zinc-400 pl-5">
                    {isUnder
                      ? `+CHF ${formatCHF(varianceAmount)} recovery flow added to ${nextMonth}`
                      : `-CHF ${formatCHF(varianceAmount)} adjustment flow added to ${nextMonth}`}
                  </div>
                </button>
                <button onClick={() => handleSave("write_off")} disabled={saving}
                  className="btn-secondary text-xs py-2.5 text-left px-3 space-y-0.5" data-testid="actual-writeoff">
                  <div className="flex items-center gap-1.5 font-medium">
                    <X size={12} /> Write off variance
                  </div>
                  <div className="text-[10px] text-zinc-500 pl-5">
                    CHF {formatCHF(varianceAmount)} variance permanently ignored — no future carryover
                  </div>
                </button>
              </>
            ) : (
              <button onClick={() => handleSave(null)} disabled={saving || !actualVal}
                className="btn-primary text-xs flex items-center justify-center gap-1 py-2" data-testid="actual-confirm">
                <Check size={12} /> Confirm actual matches planned
              </button>
            )}
            {cellInfo.cell?.has_actual && (
              <button onClick={handleClear} disabled={saving}
                className="text-xs text-zinc-600 hover:text-zinc-400 mt-1" data-testid="actual-clear">
                Clear actual (revert to planned)
              </button>
            )}
            <p className="text-[10px] text-zinc-600 text-center mt-0.5">
              All actions are undoable via the undo button in the header
            </p>
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
  const [varianceSummary, setVarianceSummary] = useState(null);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const params = { scenario, horizon };
      if (selectedEntityId) params.entity_id = selectedEntityId;
      const [matrixRes, varianceRes] = await Promise.all([
        axios.get(`${API}/projection/matrix`, { params }),
        axios.get(`${API}/variance-summary`, { params: selectedEntityId ? { entity_id: selectedEntityId } : {} }),
      ]);
      setMatrixData(matrixRes.data);
      setVarianceSummary(varianceRes.data);
    } catch (err) {
      console.error("Matrix fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [scenario, selectedEntityId, horizon]);

  useEffect(() => { fetchMatrix(); }, [fetchMatrix, refreshKey]);

  const handleRowClick = (row) => {
    axios.get(`${API}/cash-flows`).then(res => {
      const original = res.data.find(f => f.id === row.flow_id);
      if (original) setEditingFlow(original);
    });
  };

  const handleCellClick = (row, month, cell) => {
    setActualCell({
      flowId: row.flow_id, label: row.label,
      month: month.key, monthLabel: month.label, cell,
    });
  };

  const handleSaved = () => { fetchMatrix(); onDataChange?.(); };

  if (!matrixData || (matrixData.revenue_rows.length === 0 && matrixData.expense_rows.length === 0)) {
    return (
      <div className="surface-card p-6 text-center" data-testid="cashflow-table">
        <p className="text-zinc-500 text-sm">Add flows to see the cash flow table</p>
      </div>
    );
  }

  const { months, revenue_rows, expense_rows, net_per_month, revenue_per_month, cost_per_month, cash_balance_per_month, total_revenue, total_cost, total_net } = matrixData;

  const renderCell = (row, month, ci, colorClass) => {
    const cell = row.cells[month.key];
    if (!cell) {
      return (
        <td key={month.key}
          className={`text-right px-2 py-1.5 font-mono text-zinc-800 transition-colors ${hoveredCol === ci ? 'bg-zinc-800/20' : ''}`}
          onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}>—</td>
      );
    }
    const hasActual = cell.has_actual;

    if (hasActual) {
      const variance = cell.actual - cell.planned;
      const varianceAbs = Math.abs(variance);
      const isOver = variance > 0.01;
      const isUnder = variance < -0.01;
      return (
        <td key={month.key}
          className={`text-right px-2 py-1 font-mono cursor-pointer transition-colors ${
            hoveredCol === ci ? 'bg-zinc-800/20' : ''
          } bg-cyan-500/5 border-b-2 border-cyan-500/40 hover:bg-zinc-700/30`}
          onClick={() => handleCellClick(row, month, cell)}
          onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}
          data-testid={`cell-${row.flow_id}-${month.key}`}>
          <div className="flex flex-col items-end gap-0">
            <span className="text-cyan-300 font-semibold leading-tight" data-testid={`cell-actual-${row.flow_id}-${month.key}`}>
              {formatCompact(cell.actual)}
            </span>
            <span className="text-zinc-600 text-[9px] leading-tight line-through" data-testid={`cell-planned-${row.flow_id}-${month.key}`}>
              {formatCompact(cell.planned)}
            </span>
            {varianceAbs > 0.01 && (
              <span className={`text-[9px] leading-tight font-medium ${isOver ? 'text-emerald-400' : 'text-amber-400'}`}
                data-testid={`cell-variance-${row.flow_id}-${month.key}`}>
                {isOver ? '+' : ''}{formatCompact(variance)}
              </span>
            )}
          </div>
        </td>
      );
    }

    return (
      <td key={month.key}
        className={`text-right px-2 py-1.5 font-mono cursor-pointer transition-colors ${
          hoveredCol === ci ? 'bg-zinc-800/20' : ''
        } ${colorClass} hover:bg-zinc-700/30`}
        onClick={() => handleCellClick(row, month, cell)}
        onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}
        title={`Planned: CHF ${formatCHF(cell.amount)} — click to record actual`}
        data-testid={`cell-${row.flow_id}-${month.key}`}>
        {formatCompact(cell.amount)}
      </td>
    );
  };

  const priorityDot = (p) => {
    if (!p) return null;
    const cls = p === 'critical' ? 'bg-rose-400' : p === 'flexible' ? 'bg-amber-400' : 'bg-cyan-400';
    return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls} ml-1`} title={p} />;
  };

  // ALL totals read from backend — zero frontend math
  const revTotal = total_revenue ?? 0;
  const costTotal = total_cost ?? 0;
  const netTotal = total_net ?? 0;

  return (
    <div className="surface-card" data-testid="cashflow-table">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">Cash Flow Table</h2>
        {loading && <span className="text-xs text-zinc-600">Updating...</span>}
      </div>

      {/* Global Variance Tracking Bar */}
      {varianceSummary && varianceSummary.actuals_recorded > 0 && (
        <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center gap-6 bg-zinc-900/50" data-testid="variance-bar">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Variance Control</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500">{varianceSummary.actuals_recorded} actuals</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-400"></div>
            <span className="text-[10px] text-zinc-400 font-mono" data-testid="variance-total">
              Total: CHF {formatCHF(varianceSummary.total_variance)}
            </span>
          </div>
          {varianceSummary.total_carried_forward > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
              <span className="text-[10px] text-amber-400 font-mono" data-testid="variance-carried">
                Carried: CHF {formatCHF(varianceSummary.total_carried_forward)}
              </span>
            </div>
          )}
          {varianceSummary.total_written_off > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-600"></div>
              <span className="text-[10px] text-zinc-500 font-mono" data-testid="variance-writtenoff">
                Written off: CHF {formatCHF(varianceSummary.total_written_off)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Single scroll container — header, body, totals all in one table for sync */}
      <div className="overflow-x-auto" data-testid="matrix-scroll-container">
        <table className="w-full text-xs" style={{ minWidth: `${200 + months.length * 90 + 100}px` }}>
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="sticky left-0 bg-zinc-900 z-10 text-left px-3 py-2.5 text-zinc-400 font-medium w-[200px] min-w-[200px]">Flow</th>
                {months.map((m, ci) => (
                  <th key={m.key} className={`text-right px-2 py-2.5 text-zinc-500 font-medium min-w-[90px] transition-colors ${hoveredCol === ci ? 'bg-zinc-800/30' : ''}`}>
                    {m.label.split(' ')[0]}
                  </th>
                ))}
                <th className="text-right px-3 py-2.5 text-zinc-400 font-medium min-w-[90px] border-l border-zinc-800">Total {horizon}M</th>
              </tr>
            </thead>
            <tbody>
              {/* REVENUES */}
              {revenue_rows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={months.length + 2} className="sticky left-0 bg-zinc-900 z-10 px-3 py-2 text-emerald-400 text-[10px] font-semibold uppercase tracking-[0.2em] border-b border-emerald-500/20 border-t border-zinc-700/50">
                      Revenues
                    </td>
                  </tr>
                  {revenue_rows.map((row, ri) => (
                    <tr key={row.flow_id}
                      className={`border-b border-zinc-800/20 transition-colors ${hoveredRow === `r-${ri}` ? 'bg-zinc-800/20' : ''}`}
                      onMouseEnter={() => setHoveredRow(`r-${ri}`)} onMouseLeave={() => setHoveredRow(null)}>
                      <td className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[200px] cursor-pointer hover:text-emerald-400 transition-colors"
                        title={`${row.label} — click to edit`} onClick={() => handleRowClick(row)}
                        data-testid={`row-label-${row.flow_id}`}>
                        {row.parent_id && <span className="text-zinc-600 mr-1">└</span>}
                        {row.label}
                        {row.is_percentage && <span className="ml-1 text-amber-500/60 text-[10px]">%</span>}
                        {priorityDot(row.priority)}
                      </td>
                      {months.map((m, ci) => renderCell(row, m, ci, 'text-emerald-400'))}
                      <td className="text-right px-3 py-1.5 font-mono text-emerald-400/70 font-medium border-l border-zinc-800">
                        {formatCompact(row.row_total)}
                      </td>
                    </tr>
                  ))}
                  {/* Total Revenue Row */}
                  <tr className="border-b-2 border-emerald-500/30 bg-emerald-500/5" data-testid="total-revenue-row">
                    <td className="sticky left-0 bg-emerald-500/5 z-10 px-3 py-2 text-emerald-400 font-bold text-xs tracking-wide">Total Revenue</td>
                    {months.map((m, ci) => (
                      <td key={m.key} className={`text-right px-2 py-1.5 font-mono text-emerald-400 font-semibold ${hoveredCol === ci ? 'bg-emerald-500/10' : ''}`}
                        onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}>
                        {revenue_per_month ? formatCompact(revenue_per_month[m.key] || 0) : '—'}
                      </td>
                    ))}
                    <td className="text-right px-3 py-1.5 font-mono text-emerald-400 font-semibold border-l border-zinc-800">
                      {formatCompact(revTotal)}
                    </td>
                  </tr>
                </>
              )}

              {/* EXPENSES */}
              {expense_rows.length > 0 && (
                <>
                  <tr>
                    <td colSpan={months.length + 2} className="sticky left-0 bg-zinc-900 z-10 px-3 py-2 text-rose-400 text-[10px] font-semibold uppercase tracking-[0.2em] border-b border-rose-500/20 border-t-2 border-zinc-700/50">
                      Expenses
                    </td>
                  </tr>
                  {expense_rows.map((row, ri) => (
                    <tr key={row.flow_id}
                      className={`border-b border-zinc-800/20 transition-colors ${hoveredRow === `e-${ri}` ? 'bg-zinc-800/20' : ''}`}
                      onMouseEnter={() => setHoveredRow(`e-${ri}`)} onMouseLeave={() => setHoveredRow(null)}>
                      <td className="sticky left-0 bg-zinc-900 z-10 px-3 py-1.5 text-zinc-300 truncate max-w-[200px] cursor-pointer hover:text-rose-400 transition-colors"
                        title={`${row.label} — click to edit`} onClick={() => handleRowClick(row)}
                        data-testid={`row-label-${row.flow_id}`}>
                        {row.parent_id && <span className="text-zinc-600 mr-1">└</span>}
                        {row.label}
                        {row.is_percentage && <span className="ml-1 text-amber-500/60 text-[10px]">%</span>}
                        {priorityDot(row.priority)}
                      </td>
                      {months.map((m, ci) => renderCell(row, m, ci, 'text-rose-400'))}
                      <td className="text-right px-3 py-1.5 font-mono text-rose-400/70 font-medium border-l border-zinc-800">
                        {formatCompact(row.row_total)}
                      </td>
                    </tr>
                  ))}
                  {/* Total Cost Row */}
                  <tr className="border-b-2 border-rose-500/30 bg-rose-500/5" data-testid="total-cost-row">
                    <td className="sticky left-0 bg-rose-500/5 z-10 px-3 py-2 text-rose-400 font-bold text-xs tracking-wide">Total Cost</td>
                    {months.map((m, ci) => (
                      <td key={m.key} className={`text-right px-2 py-1.5 font-mono text-rose-400 font-semibold ${hoveredCol === ci ? 'bg-rose-500/10' : ''}`}
                        onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}>
                        {cost_per_month ? formatCompact(cost_per_month[m.key] || 0) : '—'}
                      </td>
                    ))}
                    <td className="text-right px-3 py-1.5 font-mono text-rose-400 font-semibold border-l border-zinc-800">
                      {formatCompact(costTotal)}
                    </td>
                  </tr>
                </>
              )}

              {/* NET P/L ROW */}
              <tr className="border-t-2 border-zinc-600 bg-zinc-800/40" data-testid="net-pl-row">
                <td className="sticky left-0 bg-zinc-800/60 z-10 px-3 py-2.5 text-zinc-100 font-bold tracking-wide">Net P/L</td>
                {months.map((m, ci) => {
                  const net = net_per_month[m.key] || 0;
                  return (
                    <td key={m.key}
                      className={`text-right px-2 py-2.5 font-mono font-bold transition-colors ${hoveredCol === ci ? 'bg-zinc-700/30' : ''} ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-500'}`}
                      onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}>
                      {formatCompact(net)}
                    </td>
                  );
                })}
                <td className={`text-right px-3 py-2.5 font-mono font-bold border-l border-zinc-700 ${netTotal > 0 ? 'text-emerald-400' : netTotal < 0 ? 'text-rose-400' : 'text-zinc-500'}`}
                  data-testid="net-total">
                  {formatCompact(netTotal)}
                </td>
              </tr>

              {/* CASH BALANCE ROW */}
              {cash_balance_per_month && (
                <tr className="bg-zinc-800/20 border-t border-zinc-700/50" data-testid="cash-balance-row">
                  <td className="sticky left-0 bg-zinc-800/30 z-10 px-3 py-2.5 text-zinc-200 font-bold text-xs tracking-wide">Cash Balance</td>
                  {months.map((m, ci) => {
                    const bal = cash_balance_per_month[m.key] || 0;
                    return (
                      <td key={m.key}
                        className={`text-right px-2 py-2.5 font-mono font-bold transition-colors ${hoveredCol === ci ? 'bg-zinc-700/30' : ''} ${bal > 0 ? 'text-cyan-400' : 'text-rose-400'}`}
                        onMouseEnter={() => setHoveredCol(ci)} onMouseLeave={() => setHoveredCol(null)}>
                        {formatCompact(bal)}
                      </td>
                    );
                  })}
                  <td className="text-right px-3 py-2.5 font-mono text-zinc-500 border-l border-zinc-700">—</td>
                </tr>
              )}
            </tbody>
          </table>
      </div>

      <FlowEditor flow={editingFlow} open={!!editingFlow} onOpenChange={(open) => !open && setEditingFlow(null)}
        entities={entities || []} onSave={handleSaved} />
      <ActualInputDialog cellInfo={actualCell} open={!!actualCell} onOpenChange={(open) => !open && setActualCell(null)}
        onSave={handleSaved} />
    </div>
  );
};
