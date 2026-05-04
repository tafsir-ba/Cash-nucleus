import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { UploadSimple, CheckCircle, XCircle, ArrowClockwise, FolderOpen, CaretUp, CaretDown, ArrowsDownUp, Plus } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { inspectAmountInput, formatAmountInput } from "./amountExpression";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fallbackCategories = ["Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"];
const fallbackVarianceActions = [
  { value: "actual_only", label: "Actual only" },
  { value: "carry_forward", label: "Carry delta forward" },
  { value: "write_off", label: "Write off delta" },
];

const mergeModeOptions = [
  { value: "override", label: "Replace" },
  { value: "addition", label: "Add to current" },
];

const sortColumnLabels = {
  entity: "Entity",
  month: "Month",
  description: "Description",
  amount: "Amount",
  category: "Category",
  classification: "Actual target",
  flow: "Flow match",
  confidence: "Confidence",
  merge: "Amount vs actual",
  variance: "Variance mode",
};

const scoreLabel = (score) => {
  if (score >= 0.8) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
};

const SortHeader = ({ label, sortKey, activeKey, dir, onToggle, align = "left", testId }) => {
  const active = activeKey === sortKey;
  const Indicator = !active ? ArrowsDownUp : dir === "asc" ? CaretUp : CaretDown;
  const ariaSort = active ? (dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      aria-sort={ariaSort}
      className={`px-2 py-2 text-zinc-500 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        data-testid={testId}
        aria-label={`Sort by ${label}${active ? `, currently ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
        className={`inline-flex items-center gap-1 font-medium tracking-wide hover:text-zinc-200 ${
          active ? "text-zinc-200" : "text-zinc-500"
        } ${align === "right" ? "flex-row-reverse w-full justify-start" : ""}`}
      >
        <span>{label}</span>
        <Indicator size={10} className={active ? "text-zinc-300" : "text-zinc-600"} />
      </button>
    </th>
  );
};

export const BulkActualUploadPage = ({ entities, onDataChange, onBack, flowsRefreshKey = 0 }) => {
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
  const [rowFilter, setRowFilter] = useState("all");
  const [categories, setCategories] = useState(fallbackCategories);
  const [varianceActions, setVarianceActions] = useState(fallbackVarianceActions);
  const [selectedHistoryBatchId, setSelectedHistoryBatchId] = useState("none");
  // Review-table sort. `sortKey === null` means "file order" (same as row_index,
  // which is the order the backend applies rows in). Sort is view-only: apply
  // still runs in row_index order so within-batch Replace-then-Add semantics
  // stay deterministic regardless of how the user arranges the table.
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [newFlowOpen, setNewFlowOpen] = useState(false);
  const [newFlowLabel, setNewFlowLabel] = useState("");
  const [newFlowEntityId, setNewFlowEntityId] = useState("");
  const [newFlowCategory, setNewFlowCategory] = useState("Expense");
  const [newFlowMonth, setNewFlowMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [newFlowApplyAll, setNewFlowApplyAll] = useState(false);
  const [creatingFlow, setCreatingFlow] = useState(false);

  useEffect(() => {
    if (!entityId && entities.length > 0) {
      setEntityId(entities[0].id);
    }
  }, [entities, entityId]);

  const loadAllFlows = useCallback(() => {
    axios
      .get(`${API}/cash-flows`)
      .then((res) => setAllFlows(Array.isArray(res.data) ? res.data : []))
      .catch(() => setAllFlows([]));
  }, []);

  useEffect(() => {
    loadAllFlows();
  }, [loadAllFlows, flowsRefreshKey]);

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

  /** Rows with Multi checked, in file (#) order; first is the multi-edit leader. */
  const multiEditRowsOrdered = useMemo(
    () =>
      [...rows]
        .filter((r) => !!r.multi_edit)
        .sort((a, b) => (a.row_index ?? 0) - (b.row_index ?? 0)),
    [rows],
  );

  const multiEditRowIds = useMemo(
    () => new Set(multiEditRowsOrdered.map((r) => r.id)),
    [multiEditRowsOrdered],
  );

  const anchorRowId = multiEditRowsOrdered[0]?.id ?? null;

  const shouldBulkEdit = (rowId) =>
    multiEditRowsOrdered.length > 1 && rowId === anchorRowId;

  /** When several rows have Multi checked, edits on the first such row update all Multi rows. */
  const persistFromAnchorRow = async (rowId, patch) => {
    if (!batch) return;
    if (!shouldBulkEdit(rowId)) {
      await persistRowPatch(rowId, patch);
      return;
    }
    const targets = multiEditRowsOrdered;
    setPersistingRows((prev) => {
      const next = { ...prev };
      targets.forEach((r) => {
        next[r.id] = true;
      });
      return next;
    });
    try {
      const responses = await Promise.all(
        targets.map((r) => axios.put(`${API}/actual-imports/${batch.id}/rows/${r.id}`, patch)),
      );
      setRows((prev) => {
        const byId = {};
        responses.forEach((res) => {
          if (res.data?.id) byId[res.data.id] = res.data;
        });
        return prev.map((row) => (byId[row.id] ? { ...row, ...byId[row.id] } : row));
      });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save row edits");
    } finally {
      setPersistingRows((prev) => {
        const next = { ...prev };
        targets.forEach((r) => {
          delete next[r.id];
        });
        return next;
      });
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
      const res = await axios.post(`${API}/actual-imports/${batch.id}/apply`, {});
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

  const openNewFlowDialog = () => {
    setNewFlowEntityId(entityId || entities[0]?.id || "");
    setNewFlowMonth(rows[0]?.month || format(new Date(), "yyyy-MM"));
    setNewFlowLabel("");
    setNewFlowApplyAll(false);
    setNewFlowOpen(true);
  };

  const createFlowLineFromBulk = async () => {
    const label = newFlowLabel.trim();
    if (!label) {
      toast.error("Enter a label for the new line");
      return;
    }
    const ent = newFlowEntityId || entityId;
    if (!ent) {
      toast.error("Select an entity");
      return;
    }
    const month = newFlowMonth || format(new Date(), "yyyy-MM");
    const dateStr = `${month}-01`;
    setCreatingFlow(true);
    try {
      const res = await axios.post(`${API}/cash-flows`, {
        label,
        amount: 1,
        date: dateStr,
        category: newFlowCategory,
        certainty: "Materialized",
        recurrence: "none",
        entity_id: ent,
      });
      const created = res.data;
      loadAllFlows();
      onDataChange?.();

      if (newFlowApplyAll && batch?.id && created?.id) {
        const toPatch = rows.filter(
          (r) =>
            r.include &&
            (r.entity_id || entityId || batch?.entity_id) === ent
        );
        await Promise.all(
          toPatch.map((row) =>
            axios.put(`${API}/actual-imports/${batch.id}/rows/${row.id}`, {
              selected_flow_id: created.id,
              classification: "existing_flow",
            })
          )
        );
        setRows((prev) =>
          prev.map((row) => {
            if (!row.include) return row;
            if ((row.entity_id || entityId || batch?.entity_id) !== ent) return row;
            return {
              ...row,
              selected_flow_id: created.id,
              classification: "existing_flow",
            };
          })
        );
      }

      toast.success(
        newFlowApplyAll && batch
          ? `Created "${created.label}" and set Flow match on included rows for this entity`
          : `Created flow line "${created.label}"`
      );
      setNewFlowOpen(false);
      setNewFlowLabel("");
      setNewFlowApplyAll(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not create flow line");
    } finally {
      setCreatingFlow(false);
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

  const entityNameById = useMemo(() => {
    const map = {};
    entities.forEach((e) => { map[e.id] = e.name; });
    return map;
  }, [entities]);

  const flowLabelById = useMemo(() => {
    const map = {};
    allFlows.forEach((f) => { map[f.id] = f.label; });
    return map;
  }, [allFlows]);

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortKey(null);
    setSortDir("asc");
  };

  const sortValueFor = (row, key) => {
    switch (key) {
      case "entity": {
        const id = row.entity_id || entityId || batch?.entity_id || "";
        return (entityNameById[id] || "").toLowerCase();
      }
      case "month":
        return row.month || "";
      case "description":
        return (row.description || "").toLowerCase();
      case "amount": {
        const n = parseFloat(row.amount);
        return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
      }
      case "category":
        return (row.category || "").toLowerCase();
      case "classification":
        return row.classification || "existing_flow";
      case "flow":
        return (flowLabelById[row.selected_flow_id] || "").toLowerCase();
      case "confidence":
        return typeof row.match_score === "number" ? row.match_score : -1;
      case "merge":
        return row.actual_merge_mode || "override";
      case "variance":
        return row.variance_action || "actual_only";
      default:
        return "";
    }
  };

  const visibleRows = useMemo(() => {
    const scope = entityId || batch?.entity_id;
    let filtered;
    if (rowFilter === "included") filtered = rows.filter((r) => r.include);
    else if (rowFilter === "unmatched") {
      filtered = rows.filter((r) => {
        if (!r.include) return false;
        const cls = r.classification || "existing_flow";
        if (cls === "new_flow") return !(r.entity_id || scope);
        return !r.selected_flow_id;
      });
    } else if (rowFilter === "failed") filtered = rows.filter((r) => r.status === "failed");
    else if (rowFilter === "warnings") filtered = rows.filter((r) => r.status === "warning");
    else filtered = rows;

    const fileOrder = (a, b) => (a.row_index ?? 0) - (b.row_index ?? 0);
    if (!sortKey) {
      return [...filtered].sort(fileOrder);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortValueFor(a, sortKey);
      const vb = sortValueFor(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      // Stable tiebreak on original file order so rows staying "equal" (e.g. two
      // rows with the same description) keep their intra-group order predictable.
      return fileOrder(a, b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rowFilter, entityId, batch?.entity_id, sortKey, sortDir, entityNameById, flowLabelById]);

  return (
    <div className="surface-card w-full min-w-0" data-testid="bulk-actual-page">
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

          <div className="px-4 py-2 border-b border-zinc-800 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openNewFlowDialog}
              className="btn-secondary text-xs inline-flex items-center gap-1 shrink-0"
              data-testid="bulk-new-flow-line"
            >
              <Plus size={14} aria-hidden />
              New flow line for matching
            </button>
            <p className="text-[10px] text-zinc-600 leading-snug max-w-2xl">
              The Flow match list stays in sync when you add or edit cash lines elsewhere. Create a line here to add it to the dropdowns for this entity
              (debits match expense-style lines; credits match revenue-style lines).
            </p>
          </div>

          <div className="px-4 py-2 border-b border-zinc-800 text-[11px] text-zinc-600">
            <span className="text-zinc-500">Amount vs actual (per row):</span>{" "}
            <span className="text-zinc-400">Replace</span> sets this line’s amount as the new actual for that flow/month.{" "}
            <span className="text-zinc-400">Add to current</span> adds this line on top of what is already stored (and on top of earlier lines in this batch for the same flow/month).{" "}
            <span className="text-zinc-500">Sorting columns reorders this review table only — rows always apply in their original file order (the <span className="text-zinc-400">#</span> column).</span>
          </div>

          <div className="px-4 py-2 border-b border-zinc-800 text-[11px] text-zinc-500">
            <span className="text-zinc-400">Use</span> includes or excludes a line from the final <span className="text-zinc-400">Update Actuals</span> run.{" "}
            <span className="text-zinc-400">Multi</span> groups rows for bulk field edits: with two or more <span className="text-zinc-400">Multi</span> rows, changing{" "}
            <span className="text-zinc-400">Entity</span>, <span className="text-zinc-400">Month</span>, <span className="text-zinc-400">Category</span>,{" "}
            <span className="text-zinc-400">Actual target</span>, <span className="text-zinc-400">Flow match</span>, <span className="text-zinc-400">Amount vs actual</span>, or{" "}
            <span className="text-zinc-400">Variance</span> on the <span className="text-zinc-300">first Multi row</span> (lowest <span className="text-zinc-400">#</span> among Multi-checked rows) updates every Multi-checked row. Description and amount stay per line.
          </div>

          <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between text-xs">
            <div className="text-zinc-500 flex items-center gap-2">
              <FolderOpen size={12} />
              Review filter
              {sortKey && (
                <span className="ml-3 inline-flex items-center gap-1 rounded bg-zinc-800/70 px-2 py-[2px] text-[10px] text-zinc-300">
                  Sort: {sortColumnLabels[sortKey] || sortKey} ({sortDir === "asc" ? "ascending" : "descending"})
                  <button
                    type="button"
                    onClick={() => { setSortKey(null); setSortDir("asc"); }}
                    className="ml-1 text-zinc-400 hover:text-zinc-100"
                    data-testid="bulk-sort-clear"
                    aria-label="Clear sort"
                  >
                    ×
                  </button>
                </span>
              )}
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

          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-240px)] min-h-[320px]">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 sticky top-0 z-10">
                <tr className="border-b border-zinc-800">
                  <th
                    className="text-left px-2 py-2 text-zinc-500"
                    title="Apply order — rows always apply in original file order regardless of sort"
                  >
                    #
                  </th>
                  <th className="text-left px-2 py-2 text-zinc-500">Use</th>
                  <th
                    className="text-left px-2 py-2 text-zinc-500"
                    title="Bulk-edit group: check Multi on rows that should receive the same field changes from the first Multi row (#)"
                  >
                    Multi
                  </th>
                  <SortHeader label="Entity"           sortKey="entity"        activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-entity" />
                  <SortHeader label="Month"            sortKey="month"         activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-month" />
                  <SortHeader label="Description"      sortKey="description"   activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-description" />
                  <SortHeader label="Amount"           sortKey="amount"        activeKey={sortKey} dir={sortDir} onToggle={toggleSort} align="right" testId="bulk-sort-amount" />
                  <SortHeader label="Category"         sortKey="category"      activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-category" />
                  <SortHeader label="Actual target"    sortKey="classification" activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-classification" />
                  <SortHeader label="Flow Match"       sortKey="flow"          activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-flow" />
                  <SortHeader label="Confidence"       sortKey="confidence"    activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-confidence" />
                  <SortHeader label="Amount vs actual" sortKey="merge"         activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-merge" />
                  <SortHeader label="Variance Mode"    sortKey="variance"      activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-variance" />
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
                  const isMultiEditAnchor =
                    multiEditRowsOrdered.length > 1 && row.id === anchorRowId;
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-zinc-800/50 ${
                        isMultiEditAnchor ? "bg-zinc-800/25" : ""
                      }`}
                      title={isMultiEditAnchor ? "Multi leader: field changes here apply to all Multi-checked rows" : undefined}
                    >
                      <td
                        className="px-2 py-2 align-top text-[11px] text-zinc-500 font-mono tabular-nums"
                        title="Apply order (file order). Independent of the visual sort above."
                        data-testid={`bulk-row-applyorder-${row.id}`}
                      >
                        {(row.row_index ?? 0) + 1}
                      </td>
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
                        <input
                          type="checkbox"
                          checked={!!row.multi_edit}
                          onChange={(e) => {
                            const v = e.target.checked;
                            updateRowLocal(row.id, { multi_edit: v });
                            persistRowPatch(row.id, { multi_edit: v });
                          }}
                          title="Include in Multi bulk field edits"
                          data-testid={`bulk-row-multi-${row.id}`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={rowEntityEffective}
                          onValueChange={(v) => {
                            const patch = { entity_id: v, selected_flow_id: null };
                            if (shouldBulkEdit(row.id)) {
                              setRows((prev) =>
                                prev.map((r) => (multiEditRowIds.has(r.id) ? { ...r, ...patch } : r)),
                              );
                              persistFromAnchorRow(row.id, patch);
                            } else {
                              updateRowLocal(row.id, patch);
                              persistRowPatch(row.id, patch);
                            }
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
                          onChange={(e) => {
                            const v = e.target.value;
                            if (shouldBulkEdit(row.id)) {
                              setRows((prev) =>
                                prev.map((r) => (multiEditRowIds.has(r.id) ? { ...r, month: v } : r)),
                              );
                            } else {
                              updateRowLocal(row.id, { month: v });
                            }
                          }}
                          onBlur={(e) => persistFromAnchorRow(row.id, { month: e.target.value })}
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
                          if (shouldBulkEdit(row.id)) {
                            setRows((prev) =>
                              prev.map((r) => (multiEditRowIds.has(r.id) ? { ...r, category: v } : r)),
                            );
                            persistFromAnchorRow(row.id, { category: v });
                          } else {
                            updateRowLocal(row.id, { category: v });
                            persistRowPatch(row.id, { category: v });
                          }
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
                            if (shouldBulkEdit(row.id)) {
                              setRows((prev) =>
                                prev.map((r) => (multiEditRowIds.has(r.id) ? { ...r, ...payload } : r)),
                              );
                              persistFromAnchorRow(row.id, payload);
                            } else {
                              updateRowLocal(row.id, payload);
                              persistRowPatch(row.id, payload);
                            }
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
                            const payload = { selected_flow_id: next, classification: "existing_flow" };
                            if (shouldBulkEdit(row.id)) {
                              setRows((prev) =>
                                prev.map((r) => (multiEditRowIds.has(r.id) ? { ...r, ...payload } : r)),
                              );
                              persistFromAnchorRow(row.id, payload);
                            } else {
                              updateRowLocal(row.id, payload);
                              persistRowPatch(row.id, payload);
                            }
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
                          value={row.actual_merge_mode || "override"}
                          onValueChange={(v) => {
                            if (shouldBulkEdit(row.id)) {
                              setRows((prev) =>
                                prev.map((r) =>
                                  multiEditRowIds.has(r.id) ? { ...r, actual_merge_mode: v } : r,
                                ),
                              );
                              persistFromAnchorRow(row.id, { actual_merge_mode: v });
                            } else {
                              updateRowLocal(row.id, { actual_merge_mode: v });
                              persistRowPatch(row.id, { actual_merge_mode: v });
                            }
                          }}
                        >
                          <SelectTrigger className="w-[140px] bg-zinc-950 border-zinc-800 h-[30px]" data-testid={`bulk-row-merge-${row.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {mergeModeOptions.map((m) => (
                              <SelectItem key={m.value} value={m.value}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={row.variance_action || "actual_only"}
                          onValueChange={(v) => {
                            if (shouldBulkEdit(row.id)) {
                              setRows((prev) =>
                                prev.map((r) =>
                                  multiEditRowIds.has(r.id) ? { ...r, variance_action: v } : r,
                                ),
                              );
                              persistFromAnchorRow(row.id, { variance_action: v });
                            } else {
                              updateRowLocal(row.id, { variance_action: v });
                              persistRowPatch(row.id, { variance_action: v });
                            }
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

      <Dialog open={newFlowOpen} onOpenChange={setNewFlowOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 font-heading text-sm tracking-wide uppercase">
              New cash flow line
            </DialogTitle>
            <DialogDescription className="text-zinc-500 text-xs">
              Creates a real cash flow row you can map bank lines to. Pick Revenue for inflows, or another category for outflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Label</Label>
              <input
                type="text"
                value={newFlowLabel}
                onChange={(e) => setNewFlowLabel(e.target.value)}
                placeholder="e.g. Swisscom, Rent"
                className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-md px-3 py-2 text-zinc-100"
                data-testid="bulk-new-flow-label"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Entity</Label>
              <Select value={newFlowEntityId} onValueChange={setNewFlowEntityId}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px]">
                  <SelectValue placeholder="Entity" />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Category (sign)</Label>
              <Select value={newFlowCategory} onValueChange={setNewFlowCategory}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 h-[38px]" data-testid="bulk-new-flow-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-zinc-600 mt-1">
                Revenue lines are positive (credits); other categories are negative (debits), matching the Flow match column filters.
              </p>
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1 block">Start month</Label>
              <input
                type="month"
                value={newFlowMonth}
                onChange={(e) => setNewFlowMonth(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-zinc-100 text-sm"
              />
            </div>
            {batch && (
              <label className="flex items-start gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newFlowApplyAll}
                  onChange={(e) => setNewFlowApplyAll(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700"
                  data-testid="bulk-new-flow-apply-all"
                />
                <span>
                  Set Flow match to this new line for all included rows for this entity (same entity column as above).
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary text-xs" onClick={() => setNewFlowOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={creatingFlow}
                onClick={createFlowLineFromBulk}
                data-testid="bulk-new-flow-submit"
              >
                {creatingFlow ? "Creating…" : "Create line"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
