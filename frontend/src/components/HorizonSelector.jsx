const horizons = [
  { value: 12, label: '12M' },
  { value: 24, label: '24M' },
  { value: 36, label: '36M' },
];

export const HorizonSelector = ({ value, onChange }) => {
  return (
    <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-md" data-testid="horizon-selector">
      {horizons.map((h) => (
        <button
          key={h.value}
          onClick={() => onChange(h.value)}
          className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
            value === h.value 
              ? 'bg-zinc-800 text-zinc-100' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
          data-testid={`horizon-${h.value}`}
        >
          {h.label}
        </button>
      ))}
    </div>
  );
};
