const scenarios = [
  { value: 'committed', label: 'Committed' },
  { value: 'likely', label: 'Likely' },
  { value: 'extended', label: 'Extended' },
  { value: 'full', label: 'Full' },
];

export const ScenarioToggle = ({ value, onChange }) => {
  return (
    <div className="scenario-toggle" data-testid="scenario-toggle">
      {scenarios.map((scenario) => (
        <button
          key={scenario.value}
          onClick={() => onChange(scenario.value)}
          className={`scenario-btn ${value === scenario.value ? 'scenario-btn-active' : ''}`}
          data-testid={`scenario-${scenario.value}`}
        >
          {scenario.label}
        </button>
      ))}
    </div>
  );
};
