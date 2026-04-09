import { useState } from "react";
import axios from "axios";
import { Plus, CaretDown } from "@phosphor-icons/react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "../components/ui/select";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categories = [
  "Revenue",
  "Salary", 
  "Tax",
  "Debt",
  "Expense",
  "Transfer",
  "Other",
];

const certainties = [
  { value: "Materialized", label: "Materialized" },
  { value: "Sure to happen", label: "Sure" },
  { value: "50/50", label: "50/50" },
  { value: "Idea", label: "Idea" },
];

const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const QuickAddForm = ({ onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isInflow, setIsInflow] = useState(false);
  
  const [formData, setFormData] = useState({
    label: "",
    amount: "",
    date: getCurrentMonth(),
    certainty: "Materialized",
    category: "Expense",
    recurrence: "none",
    recurrence_count: "",
    entity: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.label || !formData.amount) {
      return;
    }

    setLoading(true);
    try {
      // Convert month to first day of month for API
      const dateStr = `${formData.date}-01`;
      
      // Amount is negative for outflows, positive for inflows
      const amount = parseFloat(formData.amount) * (isInflow ? 1 : -1);
      
      const payload = {
        label: formData.label,
        amount,
        date: dateStr,
        certainty: formData.certainty,
        category: formData.category,
        recurrence: formData.recurrence,
        entity: formData.entity,
      };

      if (formData.recurrence === "monthly" && formData.recurrence_count) {
        payload.recurrence_count = parseInt(formData.recurrence_count);
      }

      await axios.post(`${API}/cash-flows`, payload);
      
      // Reset form
      setFormData({
        label: "",
        amount: "",
        date: getCurrentMonth(),
        certainty: "Materialized",
        category: "Expense",
        recurrence: "none",
        recurrence_count: "",
        entity: "",
      });
      setIsInflow(false);
      
      onSuccess?.();
    } catch (error) {
      console.error("Failed to add cash flow:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-card h-full" data-testid="quick-add-form">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          Quick Add
        </h2>
      </div>
      
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Label */}
        <div>
          <Label className="text-xs text-zinc-500 mb-1.5 block">Description</Label>
          <input
            type="text"
            placeholder="e.g., Office rent"
            value={formData.label}
            onChange={(e) => setFormData({ ...formData, label: e.target.value })}
            className="quick-input"
            data-testid="quick-add-label"
          />
        </div>

        {/* Amount + Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Amount (CHF)</Label>
            <input
              type="number"
              placeholder="0"
              min="0"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              className="quick-input font-mono"
              data-testid="quick-add-amount"
            />
          </div>
          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Type</Label>
            <div className="flex items-center gap-3 h-[38px]">
              <span className={`text-sm ${!isInflow ? 'text-rose-400' : 'text-zinc-500'}`}>Out</span>
              <Switch
                checked={isInflow}
                onCheckedChange={setIsInflow}
                data-testid="quick-add-type-toggle"
              />
              <span className={`text-sm ${isInflow ? 'text-emerald-400' : 'text-zinc-500'}`}>In</span>
            </div>
          </div>
        </div>

        {/* Month + Certainty */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Month</Label>
            <input
              type="month"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="quick-input"
              data-testid="quick-add-date"
            />
          </div>
          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Certainty</Label>
            <Select 
              value={formData.certainty} 
              onValueChange={(v) => setFormData({ ...formData, certainty: v })}
            >
              <SelectTrigger className="quick-input" data-testid="quick-add-certainty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {certainties.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <CaretDown 
            size={14} 
            className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
          />
          Advanced options
        </button>

        {/* Advanced fields */}
        {showAdvanced && (
          <div className="space-y-4 pt-2 border-t border-zinc-800/50">
            {/* Category */}
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Category</Label>
              <Select 
                value={formData.category} 
                onValueChange={(v) => setFormData({ ...formData, category: v })}
              >
                <SelectTrigger className="quick-input" data-testid="quick-add-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recurrence */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-zinc-500 mb-1.5 block">Recurrence</Label>
                <Select 
                  value={formData.recurrence} 
                  onValueChange={(v) => setFormData({ ...formData, recurrence: v })}
                >
                  <SelectTrigger className="quick-input" data-testid="quick-add-recurrence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-time</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.recurrence === "monthly" && (
                <div>
                  <Label className="text-xs text-zinc-500 mb-1.5 block"># of months</Label>
                  <input
                    type="number"
                    placeholder="12"
                    min="1"
                    max="120"
                    value={formData.recurrence_count}
                    onChange={(e) => setFormData({ ...formData, recurrence_count: e.target.value })}
                    className="quick-input font-mono"
                    data-testid="quick-add-recurrence-count"
                  />
                </div>
              )}
            </div>

            {/* Entity */}
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Entity (optional)</Label>
              <input
                type="text"
                placeholder="e.g., Company A"
                value={formData.entity}
                onChange={(e) => setFormData({ ...formData, entity: e.target.value })}
                className="quick-input"
                data-testid="quick-add-entity"
              />
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !formData.label || !formData.amount}
          className="btn-primary w-full flex items-center justify-center gap-2"
          data-testid="quick-add-submit"
        >
          <Plus size={16} weight="bold" />
          {loading ? 'Adding...' : 'Add Cash Flow'}
        </button>
      </form>
    </div>
  );
};
