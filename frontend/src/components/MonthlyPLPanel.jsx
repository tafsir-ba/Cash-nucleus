import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { TrendUp, TrendDown, Equals, ArrowBendDownRight, Check, X } from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
};

const ActualInput = ({ flow, month, onUpdate }) => {
  const [editing, setEditing] = useState(false);
  const [actualVal, setActualVal] = useState("");
  const [saving, setSaving] = useState(false);

  const hasActual = flow.actual_amount !== null && flow.actual_amount !== undefined;
  const planned = flow.planned_amount || flow.amount;
  const variance = hasActual ? planned - flow.actual_amount : null;

  const startEdit = () => {
    setActualVal(hasActual ? Math.abs(flow.actual_amount).toString() : Math.abs(planned).toString());
    setEditing(true);
  };

  const saveActual = async (action) => {
    setSaving(true);
    try {
      const sign = planned >= 0 ? 1 : -1;
      const actualAmount = parseFloat(actualVal) * sign;
      await axios.put(`${API}/flow-occurrences`, {
        flow_id: flow.flow_id,
        month: month,
        actual_amount: actualAmount,
        variance_action: action,
      });
      onUpdate?.();
      setEditing(false);
    } catch (err) {
      toast.error("Failed to save actual");
    } finally {
      setSaving(false);
    }
  };

  const clearActual = async () => {
    setSaving(true);
    try {
      await axios.delete(`${API}/flow-occurrences?flow_id=${flow.flow_id}&month=${month}`);
      onUpdate?.();
      setEditing(false);
    } catch (err) {
      toast.error("Failed to clear");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-1 space-y-1.5" data-testid={`actual-edit-${flow.flow_id}`}>
        <div className="flex gap-1 items-center">
          <input
            type="number"
            step="0.01"
            value={actualVal}
            onChange={(e) => setActualVal(e.target.value)}
            className="w-20 bg-zinc-950 border border-zinc-700 text-xs rounded px-1.5 py-1 text-zinc-100 font-mono"
            autoFocus
            data-testid={`actual-input-${flow.flow_id}`}
          />
          <button
            onClick={() => setEditing(false)}
            className="p-0.5 text-zinc-500 hover:text-zinc-300"
            disabled={saving}
          >
            <X size={12} />
          </button>
        </div>
        {actualVal && parseFloat(actualVal) !== Math.abs(planned) && (
          <div className="flex gap-1">
            <button
              onClick={() => saveActual("carry_forward")}
              disabled={saving}
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              data-testid={`carry-forward-${flow.flow_id}`}
            >
              Carry fwd
            </button>
            <button
              onClick={() => saveActual("write_off")}
              disabled={saving}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              data-testid={`write-off-${flow.flow_id}`}
            >
              Write off
            </button>
          </div>
        )}
        {actualVal && parseFloat(actualVal) === Math.abs(planned) && (
          <button
            onClick={() => saveActual(null)}
            disabled={saving}
            className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
          >
            Confirm match
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      {hasActual ? (
        <>
          <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
            <Check size={10} weight="bold" /> actual: {formatCurrency(flow.actual_amount)}
          </span>
          {variance !== null && Math.abs(variance) > 0.01 && (
            <span className={`text-[10px] ${flow.variance_action === 'carry_forward' ? 'text-amber-400' : 'text-zinc-500'}`}>
              ({flow.variance_action === 'carry_forward' ? 'carried' : 'written off'})
            </span>
          )}
          <button
            onClick={clearActual}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 ml-auto"
            data-testid={`clear-actual-${flow.flow_id}`}
          >
            reset
          </button>
        </>
      ) : (
        <button
          onClick={startEdit}
          className="text-[10px] text-zinc-600 hover:text-zinc-400"
          data-testid={`record-actual-${flow.flow_id}`}
        >
          Record actual
        </button>
      )}
    </div>
  );
};

export const MonthlyPLPanel = ({ monthDetails, selectedMonth, onDataChange }) => {
  if (!selectedMonth || !monthDetails) {
    return (
      <div className="surface-card h-full flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
            Monthly P&L
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-zinc-600 text-sm text-center">
            Select a month to see P&L summary
          </p>
        </div>
      </div>
    );
  }

  const { all_flows } = monthDetails;
  
  const revenueFlows = all_flows.filter(f => f.amount > 0);
  const costFlows = all_flows.filter(f => f.amount < 0);
  
  const revenues = revenueFlows.reduce((sum, f) => sum + f.amount, 0);
  const costs = costFlows.reduce((sum, f) => sum + Math.abs(f.amount), 0);
  const netResult = revenues - costs;

  const [year, month] = selectedMonth.split('-');
  const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-GB', { 
    month: 'long', 
    year: 'numeric' 
  });

  return (
    <div className="surface-card h-full" data-testid="pl-panel">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          {monthLabel} — P&L
        </h2>
      </div>
      
      <div className="p-4 space-y-4">
        {/* Revenues Section */}
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendUp size={16} weight="bold" className="text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Revenues</span>
            </div>
            <p className="text-lg font-mono text-emerald-400 font-medium">
              +{formatCurrency(revenues)}
            </p>
          </div>
          {revenueFlows.length > 0 && (
            <div className="mt-2 space-y-2 border-t border-emerald-500/10 pt-2">
              {revenueFlows.map((f, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`text-emerald-300/70 truncate ${f.is_carryover ? 'italic' : ''}`}>
                      {f.is_carryover && <ArrowBendDownRight size={10} className="inline mr-1 text-amber-400" />}
                      {f.label}
                    </span>
                    <span className="font-mono text-emerald-400/80 ml-2">+{formatCurrency(f.amount)}</span>
                  </div>
                  {f.flow_id && (
                    <ActualInput flow={f} month={selectedMonth} onUpdate={onDataChange} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Costs Section */}
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendDown size={16} weight="bold" className="text-rose-400" />
              <span className="text-xs font-medium text-rose-400 uppercase tracking-wider">Costs</span>
            </div>
            <p className="text-lg font-mono text-rose-400 font-medium">
              -{formatCurrency(costs)}
            </p>
          </div>
          {costFlows.length > 0 && (
            <div className="mt-2 space-y-2 border-t border-rose-500/10 pt-2">
              {costFlows.map((f, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`text-rose-300/70 truncate ${f.is_carryover ? 'italic' : ''}`}>
                      {f.is_carryover && <ArrowBendDownRight size={10} className="inline mr-1 text-amber-400" />}
                      {f.label}
                    </span>
                    <span className="font-mono text-rose-400/80 ml-2">-{formatCurrency(f.amount)}</span>
                  </div>
                  {f.flow_id && (
                    <ActualInput flow={f} month={selectedMonth} onUpdate={onDataChange} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Net Result */}
        <div className={`rounded-lg p-3 ${
          netResult >= 0 
            ? 'bg-emerald-500/5 border border-emerald-500/30' 
            : 'bg-rose-500/5 border border-rose-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Equals size={16} weight="bold" className={netResult >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <span className={`text-xs font-medium uppercase tracking-wider ${
                netResult >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                Net {netResult >= 0 ? 'Profit' : 'Loss'}
              </span>
            </div>
            <p className={`text-2xl font-mono font-semibold ${
              netResult >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {netResult >= 0 ? '+' : '-'}{formatCurrency(netResult)}
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-600 text-center">
          {all_flows.length} flow{all_flows.length !== 1 ? 's' : ''} this month
        </p>
      </div>
    </div>
  );
};
