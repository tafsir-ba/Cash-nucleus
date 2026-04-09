import { CheckCircle, WarningCircle, Eye } from "@phosphor-icons/react";

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
      return <CheckCircle size={20} weight="fill" className="text-emerald-400" />;
    case 'Watch':
      return <Eye size={20} weight="fill" className="text-amber-400" />;
    case 'Danger':
      return <WarningCircle size={20} weight="fill" className="text-rose-400" />;
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

export const KPICards = ({ projection }) => {
  if (!projection) return null;

  const { cash_now, lowest_cash, lowest_cash_month, highest_pressure_month, overall_status } = projection;

  return (
    <div className="dashboard-grid" data-testid="kpi-cards">
      {/* Cash Now */}
      <div className="kpi-card" data-testid="kpi-cash-now">
        <span className="kpi-label">Cash Now</span>
        <span className="kpi-value font-mono">{formatCurrency(cash_now)}</span>
        <span className="kpi-meta">Current bank balance</span>
      </div>

      {/* Lowest Cash */}
      <div className="kpi-card" data-testid="kpi-lowest-cash">
        <span className="kpi-label">Lowest Point</span>
        <span className={`kpi-value font-mono ${lowest_cash < 0 ? 'text-rose-400' : ''}`}>
          {formatCurrency(lowest_cash)}
        </span>
        <span className="kpi-meta">{lowest_cash_month}</span>
      </div>

      {/* Highest Pressure Month */}
      <div className="kpi-card" data-testid="kpi-pressure-month">
        <span className="kpi-label">Pressure Month</span>
        <span className="kpi-value text-2xl sm:text-3xl lg:text-4xl">{highest_pressure_month}</span>
        <span className="kpi-meta">Highest outflows</span>
      </div>

      {/* Status */}
      <div className={`kpi-card border ${getStatusBg(overall_status)}`} data-testid="kpi-status">
        <span className="kpi-label">Status</span>
        <div className="flex items-center gap-3">
          <StatusIcon status={overall_status} />
          <span className={`kpi-value text-2xl sm:text-3xl lg:text-4xl ${getStatusColor(overall_status)}`}>
            {overall_status}
          </span>
        </div>
        <span className="kpi-meta">
          {overall_status === 'Good' && 'Always above safety buffer'}
          {overall_status === 'Watch' && 'Below buffer at some point'}
          {overall_status === 'Danger' && 'Negative cash projected'}
        </span>
      </div>
    </div>
  );
};
