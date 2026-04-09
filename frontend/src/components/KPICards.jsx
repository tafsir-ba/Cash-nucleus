import { CheckCircle, WarningCircle, Eye, Plus, Warning } from "@phosphor-icons/react";

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
    case 'Good':
      return <CheckCircle size={24} weight="fill" className="text-emerald-400" />;
    case 'Watch':
      return <Eye size={24} weight="fill" className="text-amber-400" />;
    case 'Danger':
      return <WarningCircle size={24} weight="fill" className="text-rose-400" />;
    default:
      return null;
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

  return (
    <div className="dashboard-grid" data-testid="kpi-cards">
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
            <span className="kpi-meta">Current bank balance</span>
          </>
        )}
      </div>

      {/* Lowest Point */}
      <div className={`kpi-card ${lowest_cash < 0 ? 'border-rose-500/30' : ''}`} data-testid="kpi-lowest-cash">
        <span className="kpi-label">Lowest Point</span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">—</span>
        ) : (
          <>
            <span className={`kpi-value font-mono ${lowest_cash < 0 ? 'text-rose-400' : lowest_cash < safety_buffer ? 'text-amber-400' : ''}`}>
              {formatCurrency(lowest_cash)}
            </span>
            <span className="kpi-meta font-medium">{lowest_cash_month}</span>
          </>
        )}
      </div>

      {/* Lowest Cash Month */}
      <div className="kpi-card" data-testid="kpi-lowest-month">
        <span className="kpi-label">Lowest Cash Month</span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">—</span>
        ) : (
          <>
            <span className="kpi-value text-2xl sm:text-3xl lg:text-4xl">{lowest_cash_month}</span>
            <span className="kpi-meta">When cash hits bottom</span>
          </>
        )}
      </div>

      {/* Status with first breach info */}
      <div className={`kpi-card border ${getStatusBg(overall_status)}`} data-testid="kpi-status">
        <span className="kpi-label">Status</span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">Add data to see status</span>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <StatusIcon status={overall_status} />
              <span className={`kpi-value text-2xl sm:text-3xl lg:text-4xl ${getStatusColor(overall_status)}`}>
                {overall_status}
              </span>
            </div>
            <div className="mt-1 text-xs space-y-0.5">
              {overall_status === 'Good' && (
                <p className="text-zinc-400">Always above buffer</p>
              )}
              {overall_status === 'Watch' && first_watch_month && (
                <>
                  <p className="text-amber-400">First breach: {first_watch_month}</p>
                  <p className="text-zinc-500">Below buffer by {formatCurrency(belowBuffer)}</p>
                </>
              )}
              {overall_status === 'Danger' && (
                <>
                  {first_danger_month && (
                    <p className="text-rose-400">Goes negative: {first_danger_month}</p>
                  )}
                  <p className="text-zinc-500">Lowest: {formatCurrency(lowest_cash)}</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
