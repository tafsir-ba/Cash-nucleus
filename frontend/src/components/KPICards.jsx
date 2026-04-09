import { CheckCircle, WarningCircle, Eye, Plus } from "@phosphor-icons/react";

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
    case 'Good':
      return 'text-emerald-400';
    case 'Watch':
      return 'text-amber-400';
    case 'Danger':
      return 'text-rose-400';
    default:
      return 'text-zinc-400';
  }
};

const getStatusBg = (status) => {
  switch (status) {
    case 'Good':
      return 'bg-emerald-500/10 border-emerald-500/20';
    case 'Watch':
      return 'bg-amber-500/10 border-amber-500/20';
    case 'Danger':
      return 'bg-rose-500/10 border-rose-500/20';
    default:
      return 'bg-zinc-800/50 border-zinc-700';
  }
};

export const KPICards = ({ projection, hasAccounts, onAddAccount }) => {
  if (!projection) return null;

  const { cash_now, lowest_cash, lowest_cash_month, overall_status, safety_buffer } = projection;
  
  // Calculate how much below buffer
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

      {/* Lowest Point - THE KEY METRIC */}
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

      {/* Lowest Point Month - Replaced "Pressure Month" */}
      <div className="kpi-card" data-testid="kpi-lowest-month">
        <span className="kpi-label">Critical Month</span>
        {isNoData ? (
          <span className="text-lg text-zinc-500 mt-1">—</span>
        ) : (
          <>
            <span className="kpi-value text-2xl sm:text-3xl lg:text-4xl">{lowest_cash_month}</span>
            <span className="kpi-meta">When cash is lowest</span>
          </>
        )}
      </div>

      {/* Status with EXPLANATION */}
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
            {/* Explicit explanation */}
            <div className="mt-1 text-xs text-zinc-400 space-y-0.5">
              {overall_status === 'Good' && (
                <p>Always above CHF {formatCurrency(safety_buffer).replace('CHF ', '')}</p>
              )}
              {overall_status === 'Watch' && (
                <>
                  <p className="text-amber-400">Below buffer by {formatCurrency(belowBuffer)}</p>
                  <p>in {lowest_cash_month}</p>
                </>
              )}
              {overall_status === 'Danger' && (
                <>
                  <p className="text-rose-400">Negative: {formatCurrency(lowest_cash)}</p>
                  <p>in {lowest_cash_month}</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
