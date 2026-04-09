import { useState, useEffect } from "react";
import axios from "axios";
import { Plus, CaretDown, Link, X } from "@phosphor-icons/react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "../components/ui/select";
import { Label } from "../components/ui/label";
import { EntitySelector } from "./EntitySelector";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const categories = [
  "Revenue",
  "Salary", 
  "Tax",
  "Debt",
  "Expense",
  "COGS",
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

const emptyLinkedFlow = () => ({
  id: Date.now(),
  label: "",
  amount: "",
  category: "Expense",
});

export const QuickAddForm = ({ onSuccess, entities, onEntitiesChange }) => {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Main flow
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getCurrentMonth());
  const [certainty, setCertainty] = useState("Materialized");
  const [category, setCategory] = useState("Expense");
  const [recurrence, setRecurrence] = useState("none");
  const [recurrenceCount, setRecurrenceCount] = useState("");
  const [entityId, setEntityId] = useState("");

  // Linked flows
  const [linkedFlows, setLinkedFlows] = useState([]);

  // Auto-select first entity if only one exists
  useEffect(() => {
    if (entities.length === 1 && !entityId) {
      setEntityId(entities[0].id);
    }
  }, [entities, entityId]);

  const addLinkedFlow = () => {
    setLinkedFlows([...linkedFlows, emptyLinkedFlow()]);
  };

  const removeLinkedFlow = (id) => {
    setLinkedFlows(linkedFlows.filter(f => f.id !== id));
  };

  const updateLinkedFlow = (id, field, value) => {
    setLinkedFlows(linkedFlows.map(f => 
      f.id === id ? { ...f, [field]: value } : f
    ));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!label.trim() || !amount || !entityId) {
      return;
    }

    setLoading(true);
    try {
      const dateStr = `${date}-01`;
      const numAmount = parseFloat(amount);
      
      // Prepare linked flows
      const validLinked = linkedFlows
        .filter(f => f.label.trim() && f.amount)
        .map(f => ({
          label: f.label.trim(),
          amount: parseFloat(f.amount),
          date: dateStr,
          certainty,
          category: f.category,
          recurrence: "none",
          entity_id: entityId,
        }));

      if (validLinked.length > 0) {
        // Use batch endpoint
        await axios.post(`${API}/cash-flows/batch`, {
          parent: {
            label: label.trim(),
            amount: numAmount,
            date: dateStr,
            certainty,
            category,
            recurrence,
            recurrence_count: recurrence === "monthly" && recurrenceCount ? parseInt(recurrenceCount) : null,
            entity_id: entityId,
          },
          linked: validLinked
        });
      } else {
        // Single flow
        await axios.post(`${API}/cash-flows`, {
          label: label.trim(),
          amount: numAmount,
          date: dateStr,
          certainty,
          category,
          recurrence,
          recurrence_count: recurrence === "monthly" && recurrenceCount ? parseInt(recurrenceCount) : null,
          entity_id: entityId,
        });
      }
      
      // Reset
      setLabel("");
      setAmount("");
      setDate(getCurrentMonth());
      setCertainty("Materialized");
      setCategory("Expense");
      setRecurrence("none");
      setRecurrenceCount("");
      setLinkedFlows([]);
      
      onSuccess?.();
    } catch (error) {
      console.error("Failed to add cash flow:", error);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = label.trim() && amount && entityId;

  return (
    <div className="surface-card h-full" data-testid="quick-add-form">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
          Quick Add
        </h2>
      </div>
      
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Entity Selector */}
        <EntitySelector
          value={entityId}
          onChange={setEntityId}
          entities={entities}
          onEntitiesChange={onEntitiesChange}
        />

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

        {/* Amount */}
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
              <SelectTrigger className="w-full bg-zinc-950 border-zinc-800 text-sm h-[42px]" data-testid="quick-add-certainty">
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
                <SelectTrigger className="w-full bg-zinc-950 border-zinc-800 text-sm h-[42px]" data-testid="quick-add-category">
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
                  <SelectTrigger className="w-full bg-zinc-950 border-zinc-800 text-sm h-[42px]" data-testid="quick-add-recurrence">
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

            {/* Linked Flows Section */}
            <div className="pt-3 border-t border-zinc-800/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Link size={14} className="text-zinc-500" />
                  <Label className="text-xs text-zinc-400">Linked Flows</Label>
                </div>
                <button
                  type="button"
                  onClick={addLinkedFlow}
                  className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                >
                  <Plus size={12} /> Add linked
                </button>
              </div>
              
              {linkedFlows.length === 0 && (
                <p className="text-xs text-zinc-600 mb-2">
                  Link related flows (e.g., Revenue + COGS)
                </p>
              )}

              {linkedFlows.map((linked, idx) => (
                <div key={linked.id} className="flex gap-2 mb-2 items-start">
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="Description"
                      value={linked.label}
                      onChange={(e) => updateLinkedFlow(linked.id, "label", e.target.value)}
                      className="col-span-1 bg-zinc-950 border border-zinc-800 text-xs rounded-md px-2 py-2 text-zinc-100 placeholder-zinc-500"
                    />
                    <input
                      type="number"
                      placeholder="Amount"
                      value={linked.amount}
                      onChange={(e) => updateLinkedFlow(linked.id, "amount", e.target.value)}
                      className="col-span-1 bg-zinc-950 border border-zinc-800 text-xs rounded-md px-2 py-2 text-zinc-100 placeholder-zinc-500 font-mono"
                    />
                    <Select 
                      value={linked.category} 
                      onValueChange={(v) => updateLinkedFlow(linked.id, "category", v)}
                    >
                      <SelectTrigger className="col-span-1 bg-zinc-950 border-zinc-800 text-xs h-[34px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLinkedFlow(linked.id)}
                    className="p-1.5 text-zinc-500 hover:text-rose-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="btn-primary w-full flex items-center justify-center gap-2"
          data-testid="quick-add-submit"
        >
          <Plus size={16} weight="bold" />
          {loading ? 'Adding...' : linkedFlows.length > 0 ? `Add ${1 + linkedFlows.filter(f => f.label && f.amount).length} Flows` : 'Add Cash Flow'}
        </button>
      </form>
    </div>
  );
};
