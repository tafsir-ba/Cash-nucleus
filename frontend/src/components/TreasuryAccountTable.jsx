import { useState, useRef, useEffect, useCallback } from "react";
import { Trash, CaretUpDown } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Checkbox } from "./ui/checkbox";
import {
  inspectBalanceInput,
  formatAmountInput,
  formatBalancePreview,
} from "./amountExpression";

const EDITABLE_FIELDS = ["entity_id", "label", "amount", "is_receivables_financing", "note"];

const inputClass =
  "w-full bg-zinc-950 border border-zinc-700 text-sm rounded px-2 py-1 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500";

const SortHeader = ({ field, sortField, sortDir, onSort, children, className = "" }) => (
  <th
    onClick={() => onSort(field)}
    className={`text-xs font-semibold uppercase tracking-wider text-zinc-500 text-left py-3 px-3 cursor-pointer hover:text-zinc-300 transition-colors select-none ${className}`}
  >
    <span className="flex items-center gap-1">
      {children}
      <CaretUpDown size={12} className={sortField === field ? "text-zinc-300" : "text-zinc-600"} />
    </span>
  </th>
);

export const TreasuryAccountTable = ({
  accounts,
  entities,
  totalBalance,
  sortField,
  sortDir,
  onSort,
  onSaveAccount,
  onDeleteAccount,
  testIdPrefix,
  formatCurrency,
  formatMovement,
  getEntityName,
  selectedIds = new Set(),
  onSelectionChange,
  onSelectAll,
}) => {
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [rowNotes, setRowNotes] = useState({});
  const [savingIds, setSavingIds] = useState(new Set());
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const inputRef = useRef(null);
  const editingCellRef = useRef(null);
  const editValueRef = useRef("");

  useEffect(() => {
    editingCellRef.current = editingCell;
  }, [editingCell]);

  useEffect(() => {
    editValueRef.current = editValue;
  }, [editValue]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select) inputRef.current.select();
    }
  }, [editingCell]);

  const startEdit = useCallback((account, field) => {
    let initial = "";
    if (field === "entity_id") initial = account.entity_id;
    else if (field === "label") initial = account.label;
    else if (field === "amount") initial = formatAmountInput(account.amount);
    else if (field === "note") initial = rowNotes[account.id] || "";
    setEditValue(initial);
    setEditingCell({ accountId: account.id, field });
    setDirtyIds((prev) => new Set(prev).add(account.id));
  }, [rowNotes]);

  const cancelEdit = useCallback((accountId) => {
    setEditingCell(null);
    setEditValue("");
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.delete(accountId);
      return next;
    });
  }, []);

  const saveField = useCallback(async (account, field, rawValue) => {
    const updates = { trigger: "manual_adjustment" };
    let hasChange = false;

    if (field === "entity_id") {
      if (rawValue && rawValue !== account.entity_id) {
        updates.entity_id = rawValue;
        hasChange = true;
      }
    } else if (field === "label") {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        toast.error("Account name is required");
        return false;
      }
      if (trimmed !== account.label) {
        updates.label = trimmed;
        hasChange = true;
      }
    } else if (field === "amount") {
      const inspected = inspectBalanceInput(rawValue, account.amount);
      if (!inspected.isValid) {
        toast.error("Invalid balance expression");
        return false;
      }
      if (Math.abs(inspected.value - account.amount) > 0.009) {
        updates.amount = inspected.value;
        hasChange = true;
      }
    } else if (field === "is_receivables_financing") {
      const next = !!rawValue;
      if (next !== !!account.is_receivables_financing) {
        updates.is_receivables_financing = next;
        hasChange = true;
      }
    } else if (field === "note") {
      setRowNotes((prev) => ({ ...prev, [account.id]: rawValue.trim() }));
      setEditingCell(null);
      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
      return true;
    }

    if (!hasChange) {
      setEditingCell(null);
      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
      return true;
    }

    const note = rowNotes[account.id];
    if (note) updates.note = note;

    setSavingIds((prev) => new Set(prev).add(account.id));
    try {
      await onSaveAccount(account.id, updates);
      setEditingCell(null);
      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
      if (field === "amount" && rowNotes[account.id]) {
        setRowNotes((prev) => {
          const next = { ...prev };
          delete next[account.id];
          return next;
        });
      }
      return true;
    } catch (error) {
      toast.error(error?.message || "Failed to save account");
      return false;
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  }, [onSaveAccount, rowNotes]);

  const handleKeyDown = (e, account, field) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveField(account, field, editValueRef.current);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit(account.id);
    }
  };

  const handleBlur = (account, field) => {
    setTimeout(() => {
      const current = editingCellRef.current;
      if (current?.accountId === account.id && current?.field === field) {
        saveField(account, field, editValueRef.current);
      }
    }, 150);
  };

  const allSelected = accounts.length > 0 && accounts.every((a) => selectedIds.has(a.id));

  const renderEntityCell = (account) => {
    const isEditing = editingCell?.accountId === account.id && editingCell?.field === "entity_id";
    if (isEditing) {
      return (
        <select
          ref={inputRef}
          value={editValue}
          onChange={(e) => {
            const v = e.target.value;
            setEditValue(v);
            saveField(account, "entity_id", v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelEdit(account.id);
          }}
          className={`${inputClass} text-xs`}
          data-testid={`inline-entity-${account.id}`}
        >
          {entities.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      );
    }
    return (
      <button
        type="button"
        onClick={() => startEdit(account, "entity_id")}
        className="text-left w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        data-testid={`edit-account-${account.id}`}
      >
        {getEntityName(account.entity_id)}
      </button>
    );
  };

  const renderTextCell = (account, field, displayValue, className = "") => {
    const isEditing = editingCell?.accountId === account.id && editingCell?.field === field;
    if (isEditing) {
      const isAmount = field === "amount";
      const preview = isAmount
        ? formatBalancePreview(editValue, account.amount, formatCurrency)
        : null;
      return (
        <div>
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, account, field)}
            onBlur={() => handleBlur(account, field)}
            className={`${inputClass} ${isAmount ? "font-mono tabular-nums" : ""}`}
            data-testid={`inline-${field}-${account.id}`}
          />
          {preview && (
            <p className="mt-0.5 text-[10px] text-emerald-400/80 font-mono">{preview}</p>
          )}
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => startEdit(account, field)}
        className={`text-left w-full hover:text-zinc-100 transition-colors ${className}`}
        data-testid={`cell-${field}-${account.id}`}
      >
        {displayValue}
      </button>
    );
  };

  const renderCategoryCell = (account) => (
    <label className="flex items-center justify-center cursor-pointer" title="Factoring / Receivables Financing">
      <input
        type="checkbox"
        checked={!!account.is_receivables_financing}
        onChange={(e) => saveField(account, "is_receivables_financing", e.target.checked)}
        className="h-3.5 w-3.5 accent-emerald-500 cursor-pointer"
        data-testid={`inline-category-${account.id}`}
      />
    </label>
  );

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full" data-testid={`${testIdPrefix}-table`}>
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            <th className="py-3 px-2 w-8">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => onSelectAll?.(!!checked)}
                aria-label="Select all accounts"
                data-testid={`${testIdPrefix}-select-all`}
                className="border-zinc-600 data-[state=checked]:bg-zinc-200 data-[state=checked]:text-zinc-900"
              />
            </th>
            <SortHeader field="entity" sortField={sortField} sortDir={sortDir} onSort={onSort}>Entity</SortHeader>
            <SortHeader field="label" sortField={sortField} sortDir={sortDir} onSort={onSort}>Account</SortHeader>
            <SortHeader field="amount" sortField={sortField} sortDir={sortDir} onSort={onSort}>{"Balance"}</SortHeader>
            <SortHeader field="last_movement" sortField={sortField} sortDir={sortDir} onSort={onSort}>Movement</SortHeader>
            <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-right py-3 px-3">Share</th>
            <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-center py-3 px-2 w-10" title="Factoring / Receivables Financing">Cat.</th>
            <th className="text-xs font-semibold uppercase tracking-wider text-zinc-500 text-left py-3 px-3">Note</th>
            <th className="py-3 px-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const share = totalBalance > 0 ? (account.amount / totalBalance) * 100 : 0;
            const isDirty = dirtyIds.has(account.id);
            const isSaving = savingIds.has(account.id);
            const noteDisplay = rowNotes[account.id] ? rowNotes[account.id] : "—";

            return (
              <tr
                key={account.id}
                className={`border-b border-zinc-800/50 transition-colors ${
                  isDirty ? "bg-amber-950/20 ring-1 ring-inset ring-amber-500/30" : "hover:bg-zinc-900/50"
                } ${isSaving ? "opacity-60" : ""}`}
                data-testid={`treasury-row-${account.id}`}
                data-unsaved={isDirty ? "true" : undefined}
                data-selected={selectedIds.has(account.id) ? "true" : undefined}
              >
                <td className="py-2.5 px-2">
                  <Checkbox
                    checked={selectedIds.has(account.id)}
                    onCheckedChange={(checked) => onSelectionChange?.(account.id, !!checked)}
                    aria-label={`Select ${account.label}`}
                    data-testid={`select-account-${account.id}`}
                    data-bulk-select="true"
                    className="border-zinc-600 data-[state=checked]:bg-zinc-200 data-[state=checked]:text-zinc-900"
                  />
                </td>
                <td className="py-2 px-3">{renderEntityCell(account)}</td>
                <td className="py-2 px-3">
                  {renderTextCell(account, "label", account.label, "text-sm text-zinc-200")}
                </td>
                <td className="py-2 px-3">
                  {renderTextCell(account, "amount", formatCurrency(account.amount), "text-sm font-mono text-zinc-100 tabular-nums")}
                </td>
                <td
                  className={`py-2.5 px-3 text-xs font-mono tabular-nums ${
                    account.last_movement == null
                      ? "text-zinc-600"
                      : account.last_movement > 0
                        ? "text-emerald-400"
                        : account.last_movement < 0
                          ? "text-rose-400"
                          : "text-zinc-500"
                  }`}
                  data-testid={`treasury-movement-${account.id}`}
                >
                  {formatMovement(account.last_movement)}
                </td>
                <td className="py-2.5 px-3 text-xs text-zinc-500 text-right tabular-nums">
                  {share.toFixed(1)}%
                </td>
                <td className="py-2 px-2">{renderCategoryCell(account)}</td>
                <td className="py-2 px-3">
                  {renderTextCell(
                    account,
                    "note",
                    noteDisplay,
                    `text-xs ${rowNotes[account.id] ? "text-zinc-400" : "text-zinc-600"}`
                  )}
                </td>
                <td className="py-2.5 px-2">
                  <button
                    onClick={() => onDeleteAccount(account.id)}
                    className="p-1 text-zinc-600 hover:text-rose-400 rounded transition-colors"
                    data-testid={`delete-account-${account.id}`}
                  >
                    <Trash size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export { EDITABLE_FIELDS };
