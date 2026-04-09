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
  
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getCurrentMonth());
  const [certainty, setCertainty] = useState("Materialized");
  const [category, setCategory] = useState("Expense");
  const [recurrence, setRecurrence] = useState("none");
  const [recurrenceCount, setRecurrenceCount] = useState("");
  const [entity, setEntity] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!label.trim() || !amount) {
      return;
    }

    setLoading(true);
    try {
      const dateStr = `${date}-01`;
      const numAmount = parseFloat(amount);
      
      const payload = {
        label: label.trim(),
        amount: numAmount,
        date: dateStr,
        certainty,
        category,
        recurrence,
        entity: entity.trim(),
      };

      if (recurrence === "monthly" && recurrenceCount) {
        payload.recurrence_count = parseInt(recurrenceCount);
      }

      await axios.post(`${API}/cash-flows`, payload);
      
      // Reset
      setLabel("");
      setAmount("");
      setDate(getCurrentMonth());
      setCertainty("Materialized");
      setCategory("Expense");
      setRecurrence("none");
      setRecurrenceCount("");
      setEntity("");
      
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
        {/* Description */}
        <div>
          <Label htmlFor="desc-input" className="text-xs text-zinc-500 mb-1.5 block">Description</Label>
          <input
            id="desc-input"
            type="text"
            autoComplete="off"
            placeholder="e.g., Office rent"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600"
            data-testid="quick-add-label"
          />
        </div>

        {/* Amount - use sign for in/out */}
        <div>
          <Label htmlFor="amount-input" className="text-xs text-zinc-500 mb-1.5 block">
            Amount (CHF) <span className="text-zinc-600">— use minus for outflows</span>
          </Label>
          <input
            id="amount-input"
            type="number"
            autoComplete="off"
            placeholder="-5000"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600 font-mono"
            data-testid="quick-add-amount"
          />
        </div>

        {/* Month + Certainty */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="month-input" className="text-xs text-zinc-500 mb-1.5 block">Month</Label>
            <input
              id="month-input"
              type="month"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600"
              data-testid="quick-add-date"
            />
          </div>
          <div>
            <Label className="text-xs text-zinc-500 mb-1.5 block">Certainty</Label>
            <Select value={certainty} onValueChange={setCertainty}>
              <SelectTrigger className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 h-[42px]" data-testid="quick-add-certainty">
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
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 h-[42px]" data-testid="quick-add-category">
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
                <Select value={recurrence} onValueChange={setRecurrence}>
                  <SelectTrigger className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 h-[42px]" data-testid="quick-add-recurrence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-time</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {recurrence === "monthly" && (
                <div>
                  <Label className="text-xs text-zinc-500 mb-1.5 block"># of months</Label>
                  <input
                    type="number"
                    placeholder="12"
                    min="1"
                    max="120"
                    value={recurrenceCount}
                    onChange={(e) => setRecurrenceCount(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600 font-mono"
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
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600"
                data-testid="quick-add-entity"
              />
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !label.trim() || !amount}
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
