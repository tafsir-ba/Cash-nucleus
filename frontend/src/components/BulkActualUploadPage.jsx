import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UploadSimple, CheckCircle, XCircle, ArrowClockwise, FolderOpen } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { inspectAmountInput, formatAmountInput } from "./amountExpression";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fallbackCategories = ["Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"];
const fallbackVarianceActions = [
  { value: "actual_only", label: "Actual only" },
  { value: "carry_forward", label: "Carry delta forward" },
  { value: "write_off", label: "Write off delta" },
];

const scoreLabel = (score) => {
  if (score >= 0.8) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
};

export const BulkActualUploadPage = ({ entities, onDataChange, onBack }) => {
  const [entityId, setEntityId] = useState("");
  const [file, setFile] = useState(null);
  const [batch, setBatch] = useState(null);
  const [rows, setRows] = useState([]);
  /** All flows (no entity filter) so each row can match flows for its chosen entity. */
  const [allFlows, setAllFlows] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [batchHistory, setBatchHistory] = useState([]);
  const [persistingRows, setPersistingRows] = useState({});
  const [applyResult, setApplyResult] = useState(null);
  /** "override" replaces the cell actual; "addition" sums the row amount onto the current actual. */
  const [actualMergeMode, setActualMergeMode] = useState("override");
  const [rowFilter, setRowFilter] = useState("all");
  const [categories, setCategories] = useState(fallbackCategories);
  const [varianceActions, setVarianceActions] = useState(fallbackVarianceActions);
  const [selectedHistoryBatchId, setSelectedHistoryBatchId] = useState("none");

  useEffect(() => {
    if (!entityId && entities.length > 0) {
      setEntityId(entities[0].id);
    }
  }, [entities, entityId]);

  useEffect(() => {
    axios
      .get(`${API}/cash-flows`)
      .then((res) => setAllFlows(Array.isArray(res.data) ? res.data : []))
      .catch(() => setAllFlows([]));
  }, []);

  useEffect(() => {
    axios
      .get(`${API}/meta/cash-flow`)
      .then((res) => {
        const nextCategories = Array.isArray(res.data?.categories) && res.data.categories.length > 0
          ? res.data.categories
          : fallbackCategories;
        const nextVarianceActions = Array.isArray(res.data?.variance_actions) && res.data.variance_actions.length > 0
          ? res.data.variance_actions
          : fallbackVarianceActions;
        setCategories(nextCategories);
        setVarianceActions(nextVarianceActions);
      })
      .catch(() => {
        setCategories(fallbackCategories);
        setVarianceActions(fallbackVarianceActions);
      });
  }, []);

  const fetchBatchHistory = async (currentEntityId = entityId) => {
    if (!currentEntityId) return;
    setLoadingHistory(true);
    try {
      const res = await axios.get(`${API}/actual-imports`, { params: { entity_id: currentEntityId, limit: 20 } });
      setBatchHistory(res.data || []);
    } catch {
      setBatchHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchBatchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const uploadFile = async () => {
    if (!file) {
      toast.error("Select a CSV/XLSX file first");
      return;
    }

    const form = new FormData();
    form.append("file", file);
    if (entityId) form.append("entity_id", entityId);

    setUploading(true);
    try {
      const res = await axios.post(`${API}/actual-imports/parse`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setBatch(res.data.batch);
      setRows(res.data.rows || []);
      setSelectedHistoryBatchId(res.data.batch?.id || "none");
      setApplyResult(null);
      await fetchBatchHistory(entityId);
      toast.success(`Parsed ${res.data.batch.total_rows} rows`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to parse file");
    } finally {
      setUploading(false);
    }
  };

  const updateRowLocal = (rowId, patch) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const persistRowPatch = async (rowId, patch) => {
    if (!batch) return;
    setPersistingRows((prev) => ({ ...prev, [rowId]: true }));
    try {
      const res = await axios.put(`${API}/actual-imports/${batch.id}/rows/${rowId}`, patch);
      updateRowLocal(rowId, res.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save row edit");
    } finally {
      setPersistingRows((prev) => ({ ...prev, [rowId]: false }));
    }
  };

  const reloadRows = async (batchId = batch?.id) => {
    if (!batchId) return;
    setLoadingRows(true);
    try {
      const [batchRes, rowsRes] = await Promise.all([
        axios.get(`${API}/actual-imports/${batchId}`),
        axios.get(`${API}/actual-imports/${batchId}/rows`),
      ]);
      setBatch(batchRes.data);
      setRows(rowsRes.data || []);
      setSelectedHistoryBatchId(batchId);
    } catch {
      toast.error("Failed to refresh import batch");
    } finally {
      setLoadingRows(false);
    }
  };

  const openBatch = async (batchId) => {
    setSelectedHistoryBatchId(batchId);
    await reloadRows(batchId);
    setApplyResult(null);
  };

  const applyAmountExpression = (row) => {
    const inspected = inspectAmountInput(row.amount);
    if (!inspected.text || !inspected.hasExpression) return true;
    if (!inspected.isValid) {
      toast.error("Invalid amount expression");
      return false;
    }
    updateRowLocal(row.id, { amount: formatAmountInput(inspected.value) });
    return true;
  };

  const applyRows = async () => {
    if (!batch) return;
    for (const row of rows) {
      if (!applyAmountExpression(row)) return;
    }

    setApplying(true);
    try {
      const res = await axios.post(`${API}/actual-imports/${batch.id}/apply`, {
        actual_merge_mode: actualMergeMode,
      });
      setBatch((prev) => ({ ...prev, status: res.data.status || prev?.status }));
      setApplyResult(res.data);
      if (res.data.status === "idempotent") {
        toast.success("Same batch payload already applied; no duplicate changes made.");
      } else {
        const applied = res.data.applied_rows || 0;
        const skipped = res.data.skipped_rows || 0;
        const failed = res.data.failed_rows || 0;
        toast.success(`Applied ${applied} rows (${skipped} skipped, ${failed} failed).`);
      }
      onDataChange?.();
      await reloadRows(batch.id);
      await fetchBatchHistory(entityId);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to apply imported rows");
    } finally {
      setApplying(false);
    }
  };

  const discardBatch = async () => {
    if (!batch) return;
    setDiscarding(true);
    try {
      await axios.post(`${API}/actual-imports/${batch.id}/discard`);
      setBatch((prev) => ({ ...prev, status: "discarded" }));
      toast.success("Import batch discarded");
      await fetchBatchHistory(entityId);
    } catch (err) {
      toast.error("Failed to discard batch");
    } finally {
      setDiscarding(false);
    }
  };

  const summary = useMemo(() => {
    const included = rows.filter((r) => r.include);
    const discardedRows = rows.length - included.length;
    const scope = entityId || batch?.entity_id;
    const unmatched = included.filter((r) => {
      const cls = r.classification || "existing_flow";
      if (cls === "new_flow") return !(r.entity_id || scope);
      return !r.selected_flow_id;
    }).length;
    return {
      total: rows.length,
      included: included.length,
      discarded: discardedRows,
      unmatched,
    };
  }, [rows, entityId, batch?.entity_id]);

  const visibleRows = useMemo(() => {
    const scope = entityId || batch?.entity_id;
    if (rowFilter === "included") return rows.filter((r) => r.include);
    if (rowFilter === "unmatched") {
      return rows.filter((r) => {
        if (!r.include) return false;
        const cls = r.classification || "existing_flow";
        if (cls === "new_flow") return !(r.entity_id || scope);
        return !r.selected_flow_id;
      });
    }
    if (rowFilter === "failed") return rows.filter((r) => r.status === "failed");
    if (rowFilter === "warnings") return rows.filter((r) => r.status === "warning");
    return rows;
  }, [rows, rowFilter, entityId, batch?.entity_id]);

  return (
    <div className="surface-card" data-testid="bulk-actual-page">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
            Bulk Actual Upload
          </h2>
          <p className="text-xs text-zinc-600 mt-1">Upload CSV/XLSX, review rows, then apply actuals.</p>
        </div>
        <button onClick={onBack} className="btn-secondary text-xs">
          Back
        </button>
      </div>

      <div className="p-4 border-b border-zinc-800 grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-3 items-end">
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Default entity</label>
          <Select value={entityId} onValueChange={setEntityId}>
            <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px]">
              <SelectValue placeholder="Select entity" />
            </SelectTrigger>
            <SelectContent>
              {entities.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-zinc-600 mt-1 max-w-[220px]">
            Used when parsing and as the row default; each line can override entity in the table.
          </p>
        </div>

        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Statement File</label>
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-200"
            data-testid="bulk-file-input"
          />
        </div>

        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Recent Import Batches</label>
          <Select
            value={selectedHistoryBatchId}
            onValueChange={(v) => {
              if (v !== "none") openBatch(v);
            }}
          >
            <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px]">
              <SelectValue placeholder={loadingHistory ? "Loading..." : "Open a recent batch"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Select batch</SelectItem>
              {batchHistory.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.filename} · {String(b.status || "").toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <button onClick={uploadFile} disabled={uploading} className="btn-primary text-sm h-[38px]">
          <UploadSimple size={14} className="inline mr-1" />
          {uploading ? "Processing..." : "Parse File"}
        </button>
      </div>

      {batch && (
        <>
          <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-zinc-500">Batch: <span className="text-zinc-300">{batch.filename}</span></span>
            <span className="text-zinc-500">Status: <span className="text-zinc-300 uppercase">{batch.status}</span></span>
            <span className="text-zinc-500">Rows: <span className="text-zinc-300">{summary.total}</span></span>
            <span className="text-zinc-500">Included: <span className="text-emerald-400">{summary.included}</span></span>
            <span className="text-zinc-500">Discarded: <span className="text-zinc-400">{summary.discarded}</span></span>
            <span className="text-zinc-500">Unmatched: <span className="text-amber-400">{summary.unmatched}</span></span>
            {batch.id && (
              <span className="text-zinc-500">Batch ID: <span className="text-zinc-400 font-mono">{batch.id.slice(0, 8)}…</span></span>
            )}
          </div>

          <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-xs">
            <div className="text-zinc-500 flex items-center gap-2">
              <FolderOpen size={12} />
              Review filter
            </div>
            <Select value={rowFilter} onValueChange={setRowFilter}>
              <SelectTrigger className="w-[180px] bg-zinc-950 border-zinc-800 h-[30px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rows</SelectItem>
                <SelectItem value="included">Included only</SelectItem>
                <SelectItem value="unmatched">Unmatched included</SelectItem>
                <SelectItem value="warnings">Warnings</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto max-h-[560px]">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 sticky top-0 z-10">
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-2 py-2 text-zinc-500">Use</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Entity</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Month</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Description</th>
                  <th className="text-right px-2 py-2 text-zinc-500">Amount</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Category</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Actual target</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Flow Match</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Confidence</th>
                  <th className="text-left px-2 py-2 text-zinc-500">Variance Mode</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const rowEntityEffective =
                    row.entity_id || entityId || batch?.entity_id || entities[0]?.id || "";
                  const flowOptions = allFlows.filter(
                    (f) =>
                      f.entity_id === rowEntityEffective &&
                      (row.amount >= 0 ? f.amount > 0 : f.amount < 0),
                  );
                  const inspected = inspectAmountInput(row.amount);
                  const isSaving = !!persistingRows[row.id];
                  const classification = row.classification || "existing_flow";
                  const isNewLine = classification === "new_flow";
                  return (
                    <tr key={row.id} className="border-b border-zinc-800/50">
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={!!row.include}
                          onChange={(e) => {
                            updateRowLocal(row.id, { include: e.target.checked });
                            persistRowPatch(row.id, { include: e.target.checked });
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={rowEntityEffective}
                          onValueChange={(v) => {
                            updateRowLocal(row.id, { entity_id: v, selected_flow_id: null });
                            persistRowPatch(row.id, { entity_id: v, selected_flow_id: null });
                          }}
                        >
                          <SelectTrigger className="w-[140px] bg-zinc-950 border-zinc-800 h-[30px]" data-testid={`bulk-row-entity-${row.id}`}>
                            <SelectValue placeholder="Entity" />
                          </SelectTrigger>
                          <SelectContent>
                            {entities.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="month"
                          value={row.month}
                          onChange={(e) => updateRowLocal(row.id, { month: e.target.value })}
                          onBlur={(e) => persistRowPatch(row.id, { month: e.target.value })}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100"
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="text"
                          value={row.description}
                          onChange={(e) => updateRowLocal(row.id, { description: e.target.value })}
                          onBlur={(e) => persistRowPatch(row.id, { description: e.target.value })}
                          className="w-full min-w-[220px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100"
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.amount}
                          onChange={(e) => updateRowLocal(row.id, { amount: e.target.value })}
                          onBlur={(e) => {
                            const nextRaw = e.target.value;
                            const nextRow = { ...row, amount: nextRaw };
                            const parsed = inspectAmountInput(nextRaw);
                            if (applyAmountExpression(nextRow) && parsed.isValid) {
                              persistRowPatch(row.id, { amount: parsed.value });
                            }
                          }}
                          className={`w-[120px] bg-zinc-950 border rounded px-2 py-1 text-right font-mono ${
                            inspected.isValid ? "border-zinc-800 text-zinc-100" : "border-rose-500/40 text-rose-300"
                          }`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select value={row.category} onValueChange={(v) => {
                          updateRowLocal(row.id, { category: v });
                          persistRowPatch(row.id, { category: v });
                        }}>
                          <SelectTrigger className="w-[120px] bg-zinc-950 border-zinc-800 h-[30px]">
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
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={classification}
                          onValueChange={(v) => {
                            const payload =
                              v === "new_flow"
                                ? { classification: "new_flow", selected_flow_id: null }
                                : { classification: "existing_flow" };
                            updateRowLocal(row.id, payload);
                            persistRowPatch(row.id, payload);
                          }}
                        >
                          <SelectTrigger className="w-[160px] bg-zinc-950 border-zinc-800 h-[30px]" data-testid={`bulk-classify-${row.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="existing_flow">Existing line</SelectItem>
                            <SelectItem value="new_flow">New line</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={row.selected_flow_id || "none"}
                          disabled={isNewLine}
                          onValueChange={(v) => {
                            const next = v === "none" ? null : v;
                            updateRowLocal(row.id, { selected_flow_id: next, classification: "existing_flow" });
                            persistRowPatch(row.id, { selected_flow_id: next, classification: "existing_flow" });
                          }}
                        >
                          <SelectTrigger className="w-[220px] bg-zinc-950 border-zinc-800 h-[30px]">
                            <SelectValue placeholder={isNewLine ? "Creates new cash line" : "Select flow"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unmatched</SelectItem>
                            {flowOptions.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span className={`text-[11px] ${
                          row.match_score >= 0.8 ? "text-emerald-400" : row.match_score >= 0.6 ? "text-amber-400" : "text-zinc-500"
                        }`}>
                          {scoreLabel(row.match_score)} ({row.match_score?.toFixed(2) || "0.00"})
                        </span>
                        <div className={`text-[10px] mt-1 ${isSaving ? "text-zinc-400" : row.error ? "text-rose-400" : "text-zinc-600"}`}>
                          {isSaving ? "Saving..." : row.error || row.status}
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={row.variance_action || "actual_only"}
                          onValueChange={(v) => {
                            updateRowLocal(row.id, { variance_action: v });
                            persistRowPatch(row.id, { variance_action: v });
                          }}
                        >
                          <SelectTrigger className="w-[160px] bg-zinc-950 border-zinc-800 h-[30px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {varianceActions.map((a) => (
                              <SelectItem key={a.value} value={a.value}>
                                {a.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleRows.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-zinc-600">No rows for current filter.</div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/40">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Bulk apply mode</p>
            <p className="text-[11px] text-zinc-600 mb-2 max-w-3xl">
              Several statement lines can map to the same flow and month (e.g. two Swisscom payments). Use{" "}
              <span className="text-zinc-400">Add to current</span> so each line adds to the running actual. With{" "}
              <span className="text-zinc-400">Replace</span>, later rows overwrite earlier ones for the same flow/month.
            </p>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 text-xs text-zinc-300">
              <label className="flex items-start gap-2 cursor-pointer max-w-md">
                <input
                  type="radio"
                  name="actual-merge-mode"
                  className="mt-0.5"
                  checked={actualMergeMode === "override"}
                  onChange={() => setActualMergeMode("override")}
                  data-testid="bulk-merge-override"
                />
                <span>
                  <span className="text-zinc-200 font-medium">Replace</span>
                  <span className="text-zinc-500"> — each row amount becomes the new actual for that flow and month (default).</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer max-w-md">
                <input
                  type="radio"
                  name="actual-merge-mode"
                  className="mt-0.5"
                  checked={actualMergeMode === "addition"}
                  onChange={() => setActualMergeMode("addition")}
                  data-testid="bulk-merge-addition"
                />
                <span>
                  <span className="text-zinc-200 font-medium">Add to current</span>
                  <span className="text-zinc-500"> — row amount is added to whatever actual is already stored; empty actual counts as zero.</span>
                </span>
              </label>
            </div>
          </div>

          <div className="p-4 border-t border-zinc-800 flex items-center justify-between">
            <button onClick={discardBatch} disabled={discarding || applying} className="btn-secondary text-sm text-zinc-300">
              {discarding ? "Discarding..." : "Discard Batch"}
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => reloadRows()} className="btn-secondary text-sm" disabled={loadingRows}>
                <ArrowClockwise size={14} className="inline mr-1" />
                {loadingRows ? "Refreshing..." : "Refresh Review"}
              </button>
              <button onClick={applyRows} disabled={applying} className="btn-primary text-sm" data-testid="bulk-apply-btn">
                {applying ? "Applying..." : "Update Actuals"}
              </button>
            </div>
          </div>

          {batch.status === "applied" && (
            <div className="px-4 pb-4 text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle size={14} /> Applied successfully. Cash flow table/projections are now updated.
            </div>
          )}
          {batch.status === "failed" && (
            <div className="px-4 pb-4 text-xs text-rose-400 flex items-center gap-1">
              <XCircle size={14} /> Batch apply failed. Review row mappings and try again.
            </div>
          )}
          {applyResult?.errors?.length > 0 && (
            <div className="px-4 pb-4">
              <p className="text-xs text-rose-300 mb-2">Apply errors (top {applyResult.errors.length}):</p>
              <div className="max-h-24 overflow-auto rounded border border-rose-500/20 bg-rose-500/5 p-2">
                {applyResult.errors.map((e) => (
                  <div key={e.row_id} className="text-[11px] text-rose-300 font-mono">
                    {e.row_id?.slice(0, 8)}… — {e.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
