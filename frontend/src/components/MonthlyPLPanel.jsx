import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { TrendUp, TrendDown, Equals, ArrowBendDownRight, CheckCircle, Clock, XCircle } from "@phosphor-icons/react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
};

const statusConfig = {
  planned: { icon: Clock, color: "text-zinc-400", bg: "bg-zinc-800", label: "Planned" },
  paid: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/20", label: "Paid" },
  unpaid: { icon: XCircle, color: "text-rose-400", bg: "bg-rose-500/20", label: "Unpaid" },
};

const FlowStatusButton = ({ flowId, month, currentStatus, onStatusChange }) => {
  const [updating, setUpdating] = useState(false);

  const cycleStatus = async () => {
    const next = currentStatus === "planned" ? "paid" : currentStatus === "paid" ? "unpaid" : "planned";
    setUpdating(true);
    try {
      await axios.put(`${API}/flow-occurrences`, {
        flow_id: flowId,
        month: month,
        status: next,
      });
      onStatusChange?.();
    } catch (err) {
      console.error("Failed to update status:", err);
      toast.error("Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  const cfg = statusConfig[currentStatus] || statusConfig.planned;
  const Icon = cfg.icon;

  return (
    <button
      onClick={cycleStatus}
      disabled={updating}
      className={`p-1 rounded transition-colors ${cfg.bg} ${cfg.color} hover:opacity-80`}
      title={`${cfg.label} — click to change`}
      data-testid={`status-btn-${flowId}`}
    >
      <Icon size={14} weight="fill" />
    </button>
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
            <div className="mt-2 space-y-1 border-t border-emerald-500/10 pt-2">
              {revenueFlows.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {f.flow_id && (
                      <FlowStatusButton
                        flowId={f.flow_id}
                        month={selectedMonth}
                        currentStatus={f.status || "planned"}
                        onStatusChange={onDataChange}
                      />
                    )}
                    <span className={`text-emerald-300/70 truncate ${f.is_carryover ? 'italic' : ''}`}>
                      {f.is_carryover && <ArrowBendDownRight size={10} className="inline mr-1 text-amber-400" />}
                      {f.label}
                    </span>
                  </div>
                  <span className="font-mono text-emerald-400/80 ml-2">+{formatCurrency(f.amount)}</span>
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
            <div className="mt-2 space-y-1 border-t border-rose-500/10 pt-2">
              {costFlows.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {f.flow_id && (
                      <FlowStatusButton
                        flowId={f.flow_id}
                        month={selectedMonth}
                        currentStatus={f.status || "planned"}
                        onStatusChange={onDataChange}
                      />
                    )}
                    <span className={`text-rose-300/70 truncate ${f.is_carryover ? 'italic' : ''}`}>
                      {f.is_carryover && <ArrowBendDownRight size={10} className="inline mr-1 text-amber-400" />}
                      {f.label}
                    </span>
                  </div>
                  <span className="font-mono text-rose-400/80 ml-2">-{formatCurrency(f.amount)}</span>
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

        {/* Flow count */}
        <p className="text-xs text-zinc-600 text-center">
          {all_flows.length} flow{all_flows.length !== 1 ? 's' : ''} this month
        </p>
      </div>
    </div>
  );
};
