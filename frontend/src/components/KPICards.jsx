import { CheckCircle, WarningCircle, Eye, Plus, WarningDiamond } from "@phosphor-icons/react";

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('de-CH', {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'Good': return <CheckCircle size={24} weight="fill" className="text-emerald-400" />;
    case 'Watch': return <Eye size={24} weight="fill" className="text-amber-400" />;
    case 'Danger': return <WarningCircle size={24} weight="fill" className="text-rose-400" />;
    default: return null;
  }
};

const getStatusColor = (status) => {
  switch (status) {
    case 'Good': return 'text-emerald-400';
    case 'Watch': return 'text-amber-400';
    case 'Danger': return 'text-rose-400';
    default: return 'text-zinc-400';
  }
};

const getStatusBg = (status) => {
  switch (status) {
    case 'Good': return 'bg-emerald-500/10 border-emerald-500/20';
    case 'Watch': return 'bg-amber-500/10 border-amber-500/20';
    case 'Danger': return 'bg-rose-500/10 border-rose-500/20';
    default: return 'bg-zinc-800/50 border-zinc-700';
  }
};

export const KPICards = ({ projection, hasAccounts, onAddAccount }) => {
  if (!projection) return null;

  const { 
    cash_now, lowest_cash, lowest_cash_month, overall_status, safety_buffer,
    first_watch_month, first_danger_month 
  } = projection;
  
  const belowBuffer = safety_buffer - lowest_cash;
  const isNoData = cash_now === 0 && !hasAccounts;
  const hasDanger = first_danger_month !== null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4" data-testid="kpi-cards">
      {/* Cash Now */}
      <div className="kpi-card" data-testid="kpi-cash-now">
        <span className="kpi-label">Cash Now</span>
        {isNoData ? (
          <>
            <span className="text-lg text-zinc-500 mt-1">No accounts defined</span>
            <button 
              onClick={onAddAccount}
              className="mt-2 text-sm text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition-colors"
            >
              <Plus size={14} /> Add bank account
            </button>
          </>
        ) : (
          <>
            <span className="kpi-value font-mono">{formatCurrency(cash_now)}</span>
            <span className="kpi-meta">Current balance</span>
          </>
        )}
      </div>

      {/* FIRST DANGER MONTH - THE CRITICAL METRIC */}
      <div className={`kpi-card ${hasDanger ? 'border-rose-500/40 bg-rose-500/5' : ''}`} data-testid="kpi-first-danger">
        <span className="kpi-label flex items-center gap-2">
          {hasDanger && <WarningDiamond size={14} weight="fill" className="text-rose-400" />}
          Goes Negative
        </span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">—</span>
        ) : hasDanger ? (
          <>
            <span className="kpi-value text-rose-400 font-semibold">
              {first_danger_month}
            </span>
            <span className="kpi-meta text-rose-400/70">Cash drops below zero</span>
          </>
        ) : (
          <>
            <span className="kpi-value text-emerald-400">Never</span>
            <span className="kpi-meta text-zinc-500">Within projection horizon</span>
          </>
        )}
      </div>

      {/* Lowest Point */}
      <div className="kpi-card" data-testid="kpi-lowest-cash">
        <span className="kpi-label">Lowest Point</span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">—</span>
        ) : (
          <>
            <span className={`kpi-value font-mono ${lowest_cash < 0 ? 'text-rose-400' : lowest_cash < safety_buffer ? 'text-amber-400' : ''}`}>
              {formatCurrency(lowest_cash)}
            </span>
            <span className="kpi-meta">{lowest_cash_month}</span>
          </>
        )}
      </div>

      {/* First Breach (buffer) */}
      <div className="kpi-card" data-testid="kpi-first-breach">
        <span className="kpi-label">First Breach</span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">—</span>
        ) : first_watch_month ? (
          <>
            <span className="kpi-value text-amber-400">
              {first_watch_month}
            </span>
            <span className="kpi-meta text-zinc-500">Below buffer</span>
          </>
        ) : (
          <>
            <span className="kpi-value text-zinc-500">—</span>
            <span className="kpi-meta text-zinc-600">Always above buffer</span>
          </>
        )}
      </div>

      {/* Status */}
      <div className={`kpi-card border ${getStatusBg(overall_status)}`} data-testid="kpi-status">
        <span className="kpi-label">Status</span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">Add data</span>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <StatusIcon status={overall_status} />
              <span className={`kpi-value text-xl sm:text-2xl ${getStatusColor(overall_status)}`}>
                {overall_status}
              </span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {overall_status === 'Good' && 'Always safe'}
              {overall_status === 'Watch' && `Buffer breach in ${first_watch_month}`}
              {overall_status === 'Danger' && `Negative in ${first_danger_month}`}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
