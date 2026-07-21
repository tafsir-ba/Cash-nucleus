import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  UploadSimple, CheckCircle, XCircle, ArrowClockwise, FolderOpen, CaretUp, CaretDown, ArrowsDownUp, Plus, MagnifyingGlass, WarningCircle,
} from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { CashFlowTable } from "./CashFlowTable";
import { inspectAmountInput, formatAmountInput } from "./amountExpression";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fallbackCategories = ["Revenue", "Salary", "Tax", "Debt", "Expense", "COGS", "Transfer", "Other"];
const fallbackVarianceActions = [
  { value: "actual_only", label: "Actual only" },
  { value: "carry_forward", label: "Carry delta forward" },
  { value: "write_off", label: "Write off delta" },
];

const sortColumnLabels = {
  entity: "Entity",
  date: "Date",
  valueDate: "Value",
  month: "Month",
  description: "Description",
  amount: "Amount",
  category: "Category",
  classification: "Actual target",
  flow: "Flow match",
  confidence: "Confidence",
  variance: "Variance mode",
};

const scoreLabel = (score) => {
  if (score >= 0.8) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
};

/** Included row still missing entity (new line) or flow match (existing line). */
const isUnmatchedRow = (row, scope) => {
  if (!row.include) return false;
  const cls = row.classification || "existing_flow";
  if (cls === "new_flow") return !(row.entity_id || scope);
  return !row.selected_flow_id;
};

const REVENUE_CATEGORY = "Revenue";

const bulkImportAmountNumber = (row, inspected) => {
  if (inspected?.isValid && typeof inspected.value === "number" && Number.isFinite(inspected.value)) {
    return inspected.value;
  }
  const n = parseFloat(String(row?.amount ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Bank debits/credits vs flow lines: use category when amount is zero or %-linked. */
const flowMatchesBulkImportDirection = (flow, rowAmountNum, entityEff) => {
  if (flow.entity_id !== entityEff) return false;
  const rowIsRevenue = rowAmountNum > 0;
  if (flow.is_percentage) {
    const flowIsRevenue = flow.category === REVENUE_CATEGORY;
    return flowIsRevenue === rowIsRevenue;
  }
  const a = typeof flow.amount === "number" ? flow.amount : parseFloat(flow.amount);
  const byCategory = (flow.category === REVENUE_CATEGORY) === rowIsRevenue;
  if (!Number.isFinite(a) || Math.abs(a) < 1e-9) return byCategory;
  const byAmount = (a > 0) === rowIsRevenue;
  return byAmount || byCategory;
};


const flowBelongsToEntity = (flow, entityEff, entityList) => {
  if (!entityEff) return true;
  // Legacy cash lines may omit entity_id (backend _flow_belongs_to_entity treats them as eligible).
  if (flow.entity_id == null || flow.entity_id === "") {
    if (!flow.entity) return true;
    const ent = entityList.find((e) => e.id === entityEff);
    return !!(ent?.name && flow.entity === ent.name);
  }
  if (flow.entity_id === entityEff) return true;
  const ent = entityList.find((e) => e.id === entityEff);
  return !!(ent?.name && flow.entity === ent.name);
};

const categoryOptionsForRow = (entityEff, globalCategories, perEntityMap) => {
  const list = entityEff && perEntityMap[entityEff]?.length ? perEntityMap[entityEff] : globalCategories;
  return list?.length ? list : globalCategories;
};


/** Apply one boolean field to every visible row between anchor and target (inclusive). */
const applyDragRangeToRows = (rows, visibleRows, anchorRowId, targetRowId, field, value) => {
  const order = visibleRows.map((r) => r.id);
  const a = order.indexOf(anchorRowId);
  const b = order.indexOf(targetRowId);
  if (a === -1 || b === -1) return rows;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const inRange = new Set(order.slice(lo, hi + 1));
  return rows.map((row) => (inRange.has(row.id) ? { ...row, [field]: value } : row));
};

const sortFlowsForBulkImportRow = (flows, rowAmountNum) =>
  [...flows].sort((a, b) => {
    const aMatch = flowMatchesBulkImportDirection(a, rowAmountNum, a.entity_id) ? 1 : 0;
    const bMatch = flowMatchesBulkImportDirection(b, rowAmountNum, b.entity_id) ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base" });
  });

const buildBulkRowReviewSearchText = (row, ctx) => {
  const {
    entityNameById,
    entityScope,
    flowLabelById,
    varianceLabelByValue,
  } = ctx;
  const entityIdEff = row.entity_id || entityScope || "";
  const entityName = entityNameById[entityIdEff] || "";
  const flowLabel = row.selected_flow_id
    ? flowLabelById[row.selected_flow_id] || ""
    : "Unmatched";
  const varianceKey = row.variance_action || "actual_only";
  const parts = [
    String((row.row_index ?? 0) + 1),
    row.include ? "included" : "excluded",
    row.multi_edit ? "multi" : "",
    entityName,
    row.transaction_date || "",
    row.value_date || "",
    row.month,
    row.description,
    String(row.amount ?? ""),
    row.category,
    row.classification === "new_flow" ? "new line new_flow" : "existing line existing_flow",
    flowLabel,
    scoreLabel(row.match_score),
    String(row.match_score ?? ""),
    varianceKey,
    varianceLabelByValue[varianceKey] || "",
    row.error || "",
    row.status || "",
    String(row.id || ""),
    row.raw_flow_match || "",
    row.raw_entity || "",
  ];
  return parts.join(" ");
};

const rowMatchesBulkReviewSearch = (row, needleLower, ctx) => {
  if (!needleLower) return true;
  return buildBulkRowReviewSearchText(row, ctx).toLowerCase().includes(needleLower);
};

/**
 * Included rows that did not record a new actual: failed, or skipped (idempotent / no change).
 * Merges API error list for any row not already covered.
 */
const buildApplyReviewItems = (rows, applyResult) => {
  const errorByRowId = {};
  for (const e of applyResult?.errors || []) {
    if (e?.row_id) errorByRowId[e.row_id] = e.error;
  }
  const items = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (!row.include) continue;
    if (row.status === "failed" || row.status === "skipped") {
      const isFail = row.status === "failed";
      const reason = isFail
        ? (row.error || errorByRowId[row.id] || "Unknown error")
        : "No change — actual already matched planned (same value and variance mode).";
      items.push({ row, reason, kind: isFail ? "failed" : "skipped" });
      seen.add(row.id);
    }
  }
  for (const e of applyResult?.errors || []) {
    if (!e?.row_id || seen.has(e.row_id)) continue;
    const row = (rows || []).find((r) => r.id === e.row_id);
    if (row) {
      items.push({ row, reason: e.error, kind: "failed" });
    } else {
      items.push({
        row: { id: e.row_id, row_index: 0, month: "—", description: "—", amount: "—" },
        reason: e.error,
        kind: "failed",
        orphan: true,
      });
    }
    seen.add(e.row_id);
  }
  items.sort((a, b) => (a.row.row_index ?? 0) - (b.row.row_index ?? 0));
  return items;
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
  const [simulating, setSimulating] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [batchHistory, setBatchHistory] = useState([]);
  const [persistingRows, setPersistingRows] = useState({});
  const [applyResult, setApplyResult] = useState(null);
  const [applyReviewOpen, setApplyReviewOpen] = useState(false);
  const [applyReviewItems, setApplyReviewItems] = useState([]);
  const [rowFilter, setRowFilter] = useState("all");
  /** Filters the review table across visible columns (substring, case-insensitive). */
  const [reviewSearch, setReviewSearch] = useState("");
  useEffect(() => {
    setReviewSearch("");
  }, [batch?.id]);
  const [categories, setCategories] = useState(fallbackCategories);
  const [categoriesByEntity, setCategoriesByEntity] = useState({});
  const [varianceActions, setVarianceActions] = useState(fallbackVarianceActions);
  const [selectedHistoryBatchId, setSelectedHistoryBatchId] = useState("none");
  // Review-table sort. `sortKey === null` means "file order" (same as row_index,
  // which is the stable order used before the backend groups matching rows. Sort is
  // view-only, so grouping/summing stays deterministic regardless of the table view.
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [newFlowOpen, setNewFlowOpen] = useState(false);
  const [newFlowLabel, setNewFlowLabel] = useState("");
  const [newFlowEntityId, setNewFlowEntityId] = useState("");
  const [newFlowCategory, setNewFlowCategory] = useState("Expense");
  const [newFlowMonth, setNewFlowMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [newFlowApplyAll, setNewFlowApplyAll] = useState(false);
  const [creatingFlow, setCreatingFlow] = useState(false);
  const rowDragSelectRef = useRef(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!entityId && entities.length > 0) {
      setEntityId(entities[0].id);
    }
  }, [entities, entityId]);

  const loadAllFlows = useCallback(async () => {
    const scopeIds = [
      ...new Set([
        entityId,
        batch?.entity_id,
        ...rows.map((r) => r.entity_id),
        ...entities.map((e) => e.id),
      ].filter(Boolean)),
    ];
    try {
      if (scopeIds.length === 0) {
        const res = await axios.get(`${API}/cash-flows`);
        const list = Array.isArray(res.data) ? res.data : [];
        setAllFlows(list);
        return;
      }
      const results = await Promise.all(
        scopeIds.map((id) =>
          axios.get(`${API}/actual-imports/matching-flows`, { params: { entity_id: id } }),
        ),
      );
      const byId = new Map();
      const catMap = {};
      results.forEach((res, idx) => {
        const body = res.data || {};
        const flows = Array.isArray(body) ? body : body.flows || [];
        const cats = body.categories || [];
        flows.forEach((f) => byId.set(f.id, f));
        const eid = scopeIds[idx];
        if (eid && cats.length) catMap[eid] = cats;
      });
      setCategoriesByEntity((prev) => ({ ...prev, ...catMap }));
      const merged = [...byId.values()];
      setAllFlows(merged);
      if (merged.length === 0) {
        toast.message(
          "No cash flow lines found for selected entities. Add lines in Cash Flow Table or use New flow line for matching.",
          { duration: 6000 },
        );
      }
    } catch (err) {
      setAllFlows([]);
      toast.error(err.response?.data?.detail || "Could not load cash flow lines for matching");
    }
  }, [entityId, batch?.entity_id, rows, entities]);

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
      setApplyReviewOpen(false);
      setApplyReviewItems([]);
      await fetchBatchHistory(entityId);
      await loadAllFlows();
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

  /** Rows with Multi checked, in file (#) order (used for stable apply + API batch order). */
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

  /** True when this row has Multi on and there are at least two Multi rows — edits propagate to the whole group. */
  const shouldBulkEdit = (rowId) =>
    multiEditRowsOrdered.length > 1 && multiEditRowIds.has(rowId);

  /** When several rows have Multi checked, edits on any such row update all Multi rows. */
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

  const rematchBatch = async () => {
    if (!batch) return;
    setLoadingRows(true);
    try {
      const res = await axios.post(`${API}/actual-imports/${batch.id}/rematch`);
      setBatch(res.data.batch || batch);
      setRows(res.data.rows || []);
      toast.success(`Re-matched ${res.data.rematched_rows ?? 0} row(s)`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Rematch failed");
    } finally {
      setLoadingRows(false);
    }
  };

  const reloadRows = async (batchId = batch?.id) => {
    if (!batchId) return null;
    setLoadingRows(true);
    try {
      const [batchRes, rowsRes] = await Promise.all([
        axios.get(`${API}/actual-imports/${batchId}`),
        axios.get(`${API}/actual-imports/${batchId}/rows`),
      ]);
      const list = rowsRes.data || [];
      setBatch(batchRes.data);
      setRows(list);
      setSelectedHistoryBatchId(batchId);
      return list;
    } catch {
      toast.error("Failed to refresh import batch");
      return null;
    } finally {
      setLoadingRows(false);
    }
  };

  const openBatch = async (batchId) => {
    setSelectedHistoryBatchId(batchId);
    await reloadRows(batchId);
    await loadAllFlows();
    setApplyResult(null);
    setApplyReviewOpen(false);
    setApplyReviewItems([]);
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

  const runSimulation = async () => {
    if (!batch) return;
    for (const row of rows) {
      if (!applyAmountExpression(row)) return;
    }
    setSimulating(true);
    try {
      // Do not pass page entity filter: preview must include all entities in included rows.
      const res = await axios.post(
        `${API}/actual-imports/${batch.id}/simulate`,
        {},
        { params: { horizon: 12, scenario: "likely" } },
      );
      setSimulationResult(res.data);
      setSimulationOpen(true);
      if (res.data?.errors?.length) {
        toast.message(`Simulation ready with ${res.data.errors.length} row issue(s). Review before applying.`, { duration: 5000 });
      } else {
        toast.success("Simulation ready — preview the cash flow table before applying.");
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Simulation failed");
    } finally {
      setSimulating(false);
    }
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
      onDataChange?.();
      const refreshedRows = await reloadRows(batch.id);
      const reviewItems = buildApplyReviewItems(refreshedRows || [], res.data);
      if (reviewItems.length > 0) {
        setApplyReviewItems(reviewItems);
        setApplyReviewOpen(true);
      } else {
        setApplyReviewItems([]);
        setApplyReviewOpen(false);
      }
      if (res.data.status === "idempotent") {
        toast.success("Same batch payload already applied; no duplicate changes made.");
      } else if (reviewItems.length > 0) {
        const applied = res.data.applied_rows || 0;
        toast.message(
          `Apply finished: ${applied} row(s) updated. ${reviewItems.length} row(s) did not change or failed — see the dialog.`,
          { duration: 6500 },
        );
      } else {
        toast.success(`Applied ${res.data.applied_rows || 0} row(s).`);
      }
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
    const unmatched = included.filter((r) => isUnmatchedRow(r, scope)).length;
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

  const varianceLabelByValue = useMemo(
    () => Object.fromEntries(varianceActions.map((a) => [a.value, a.label])),
    [varianceActions],
  );

  const sortValueFor = (row, key) => {
    switch (key) {
      case "entity": {
        const id = row.entity_id || entityId || batch?.entity_id || "";
        return (entityNameById[id] || "").toLowerCase();
      }
      case "date":
        return row.transaction_date || "";
      case "valueDate":
        return row.value_date || "";
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
      filtered = rows.filter((r) => isUnmatchedRow(r, scope));
    } else if (rowFilter === "failed") filtered = rows.filter((r) => r.status === "failed");
    else if (rowFilter === "warnings") filtered = rows.filter((r) => r.status === "warning");
    else filtered = rows;

    const needle = reviewSearch.trim().toLowerCase();
    if (needle) {
      const ctx = {
        entityNameById,
        entityScope: entityId || batch?.entity_id || "",
        flowLabelById,
        varianceLabelByValue,
      };
      filtered = filtered.filter((r) => rowMatchesBulkReviewSearch(r, needle, ctx));
    }

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
  }, [rows, rowFilter, entityId, batch?.entity_id, sortKey, sortDir, entityNameById, flowLabelById, reviewSearch, varianceLabelByValue]);


  const bulkSetIncludeForVisible = async (includeVal) => {
    if (!batch || visibleRows.length === 0) return;
    const targets = visibleRows;
    setPersistingRows((prev) => {
      const next = { ...prev };
      targets.forEach((r) => {
        next[r.id] = true;
      });
      return next;
    });
    try {
      const responses = await Promise.all(
        targets.map((r) =>
          axios.put(`${API}/actual-imports/${batch.id}/rows/${r.id}`, { include: includeVal }),
        ),
      );
      setRows((prev) => {
        const byId = {};
        responses.forEach((res) => {
          if (res.data?.id) byId[res.data.id] = res.data;
        });
        return prev.map((row) => (byId[row.id] ? { ...row, ...byId[row.id] } : row));
      });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update include flags");
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


  const persistRowsField = async (targetRows, field, value) => {
    if (!batch || targetRows.length === 0) return;
    setPersistingRows((prev) => {
      const next = { ...prev };
      targetRows.forEach((r) => { next[r.id] = true; });
      return next;
    });
    try {
      const patch = field === "include" ? { include: value } : { multi_edit: value };
      const responses = await Promise.all(
        targetRows.map((r) => axios.put(`${API}/actual-imports/${batch.id}/rows/${r.id}`, patch)),
      );
      setRows((prev) => {
        const byId = {};
        responses.forEach((res) => { if (res.data?.id) byId[res.data.id] = res.data; });
        return prev.map((row) => (byId[row.id] ? { ...row, ...byId[row.id] } : row));
      });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save row selection");
    } finally {
      setPersistingRows((prev) => {
        const next = { ...prev };
        targetRows.forEach((r) => { delete next[r.id]; });
        return next;
      });
    }
  };

  const finishRowDragSelect = useCallback(async () => {
    const drag = rowDragSelectRef.current;
    if (!drag || !batch) return;
    rowDragSelectRef.current = null;
    const order = visibleRows.map((r) => r.id);
    const a = order.indexOf(drag.anchorRowId);
    const b = order.indexOf(drag.lastRowId);
    if (a === -1 || b === -1) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const rangeIds = new Set(order.slice(lo, hi + 1));
    const targets = rowsRef.current.filter((r) => rangeIds.has(r.id));
    await persistRowsField(targets, drag.field, drag.value);
  }, [batch, visibleRows]);

  const beginRowDragSelect = (field, rowId, currentOn) => {
    const value = !currentOn;
    rowDragSelectRef.current = { field, anchorRowId: rowId, lastRowId: rowId, value };
    setRows((prev) => applyDragRangeToRows(prev, visibleRows, rowId, rowId, field, value));
  };

  const extendRowDragSelect = (field, rowId) => {
    const drag = rowDragSelectRef.current;
    if (!drag || drag.field !== field) return;
    drag.lastRowId = rowId;
    setRows((prev) => applyDragRangeToRows(prev, visibleRows, drag.anchorRowId, rowId, field, drag.value));
  };

  useEffect(() => {
    const onMouseUp = () => { finishRowDragSelect(); };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [finishRowDragSelect]);

  const bulkSetMultiForVisible = async (multiVal) => {
    if (!batch || visibleRows.length === 0) return;
    const targets = visibleRows;
    setPersistingRows((prev) => {
      const next = { ...prev };
      targets.forEach((r) => {
        next[r.id] = true;
      });
      return next;
    });
    try {
      const responses = await Promise.all(
        targets.map((r) =>
          axios.put(`${API}/actual-imports/${batch.id}/rows/${r.id}`, { multi_edit: multiVal }),
        ),
      );
      setRows((prev) => {
        const byId = {};
        responses.forEach((res) => {
          if (res.data?.id) byId[res.data.id] = res.data;
        });
        return prev.map((row) => (byId[row.id] ? { ...row, ...byId[row.id] } : row));
      });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update Multi flags");
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

  return (
    <div className="surface-card w-full min-w-0" data-testid="bulk-actual-page">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium tracking-[0.15em] uppercase text-zinc-400 font-heading">
            Bulk Actual Upload
          </h2>
          <p className="text-xs text-zinc-600 mt-1">
            Upload CSV/XLSX, review rows, then apply actuals. Enriched files may include Date, Posting text, Amount, Value, Entity, Month, Category, and Flow match — those columns are pre-filled on parse.
          </p>
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
            <span className="text-zinc-500">Flows loaded: <span className="text-zinc-300">{allFlows.length}</span></span>
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
            <span className="text-zinc-500">Apply logic:</span>{" "}
            Each line sets the actual for its matched flow and month. Multiple included lines on the same flow/month are{" "}
            <span className="text-zinc-400">summed</span> into one actual (replacing any prior actual for that cell).{" "}
            <span className="text-zinc-500">Use <span className="text-zinc-400">Simulate</span> to preview the cash flow table before committing.</span>
          </div>

          <div className="px-4 py-2 border-b border-zinc-800 text-[11px] text-zinc-500">
            <span className="text-zinc-400">Use</span> includes or excludes a line from the final <span className="text-zinc-400">Update Actuals</span> run.{" "}
            <span className="text-zinc-400">Multi</span> (click or drag in the Multi column) groups rows for bulk field edits: with two or more <span className="text-zinc-400">Multi</span> rows, changing{" "}
            <span className="text-zinc-400">Entity</span>, <span className="text-zinc-400">Month</span>, <span className="text-zinc-400">Category</span>,{" "}
            <span className="text-zinc-400">Actual target</span>, <span className="text-zinc-400">Flow match</span>, or{" "}
            <span className="text-zinc-400">Variance</span> on <span className="text-zinc-300">any row that has Multi checked</span> (while two or more rows have Multi) updates every Multi-checked row. Description and amount stay per line.
          </div>

          <div className="px-4 py-2 border-b border-zinc-800 flex flex-wrap items-center gap-3 justify-between text-xs">
            <div className="text-zinc-500 flex flex-wrap items-center gap-2 min-w-0">
              <FolderOpen size={12} className="shrink-0" aria-hidden />
              <span className="shrink-0">Review filter</span>
              {sortKey && (
                <span className="inline-flex items-center gap-1 rounded bg-zinc-800/70 px-2 py-[2px] text-[10px] text-zinc-300">
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
            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[min(100%,280px)]">
              <label htmlFor="bulk-review-search" className="sr-only">
                Search rows across all columns
              </label>
              <div className="relative flex-1 min-w-[160px] max-w-md">
                <MagnifyingGlass
                  size={14}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
                  aria-hidden
                />
                <input
                  id="bulk-review-search"
                  type="search"
                  value={reviewSearch}
                  onChange={(e) => setReviewSearch(e.target.value)}
                  placeholder="Search all columns…"
                  autoComplete="off"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
                  data-testid="bulk-review-search"
                />
              </div>
              <Select value={rowFilter} onValueChange={setRowFilter}>
                <SelectTrigger className="w-[180px] bg-zinc-950 border-zinc-800 h-[30px] shrink-0" data-testid="bulk-row-filter">
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
                  <th className="align-top text-left px-2 py-2 text-zinc-500">
                    <div className="flex flex-col gap-1.5 min-w-[4.75rem]">
                      <span title="Click or drag down rows to toggle">Use</span>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none"
                          disabled={visibleRows.length === 0}
                          onClick={() => bulkSetIncludeForVisible(true)}
                          aria-label="Include all visible rows in apply"
                          data-testid="bulk-use-select-all"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none"
                          disabled={visibleRows.length === 0}
                          onClick={() => bulkSetIncludeForVisible(false)}
                          aria-label="Exclude all visible rows from apply"
                          data-testid="bulk-use-select-none"
                        >
                          None
                        </button>
                      </div>
                    </div>
                  </th>
                  <th
                    className="align-top text-left px-2 py-2 text-zinc-500"
                    title="Bulk-edit group: check Multi on rows that receive the same field changes when you edit Entity, Month, etc. on any Multi-checked row"
                  >
                    <div className="flex flex-col gap-1.5 min-w-[4.75rem]">
                      <span title="Click or drag down rows to bulk-edit together">Multi</span>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none"
                          disabled={visibleRows.length === 0}
                          onClick={() => bulkSetMultiForVisible(true)}
                          aria-label="Turn on Multi for all visible rows"
                          data-testid="bulk-multi-select-all"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none"
                          disabled={visibleRows.length === 0}
                          onClick={() => bulkSetMultiForVisible(false)}
                          aria-label="Turn off Multi for all visible rows"
                          data-testid="bulk-multi-select-none"
                        >
                          None
                        </button>
                      </div>
                    </div>
                  </th>
                  <SortHeader label="Entity"           sortKey="entity"        activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-entity" />
                  <SortHeader label="Date"             sortKey="date"          activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-date" />
                  <SortHeader label="Value"            sortKey="valueDate"     activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-value-date" />
                  <SortHeader label="Month"            sortKey="month"         activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-month" />
                  <SortHeader label="Description"      sortKey="description"   activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-description" />
                  <SortHeader label="Amount"           sortKey="amount"        activeKey={sortKey} dir={sortDir} onToggle={toggleSort} align="right" testId="bulk-sort-amount" />
                  <SortHeader label="Category"         sortKey="category"      activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-category" />
                  <SortHeader label="Actual target"    sortKey="classification" activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-classification" />
                  <SortHeader label="Flow Match"       sortKey="flow"          activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-flow" />
                  <SortHeader label="Confidence"       sortKey="confidence"    activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-confidence" />
                  <SortHeader label="Variance Mode"    sortKey="variance"      activeKey={sortKey} dir={sortDir} onToggle={toggleSort} testId="bulk-sort-variance" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const rowEntityEffective =
                    row.entity_id || entityId || batch?.entity_id || entities[0]?.id || "";
                  const scope = entityId || batch?.entity_id;
                  const inspected = inspectAmountInput(row.amount);
                  const amtNum = bulkImportAmountNumber(row, inspected);
                  const entityFlows = allFlows.filter((f) => flowBelongsToEntity(f, rowEntityEffective, entities));
                  const flowOptions = sortFlowsForBulkImportRow(entityFlows, amtNum);
                  const isSaving = !!persistingRows[row.id];
                  const classification = row.classification || "existing_flow";
                  const isNewLine = classification === "new_flow";
                  const isInMultiGroup =
                    !!row.multi_edit && multiEditRowsOrdered.length > 1;
                  const isUnmatched = isUnmatchedRow(row, scope);
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-zinc-800/50 ${
                        isUnmatched
                          ? "bg-amber-950/45"
                          : isInMultiGroup
                            ? "bg-zinc-800/25"
                            : ""
                      }`}
                      title={
                        [
                          isUnmatched
                            ? "Unmatched: assign entity or flow match before apply"
                            : null,
                          isInMultiGroup
                            ? "Multi group: changing Entity, Month, Category, etc. on this row updates all Multi-checked rows"
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" — ") || undefined
                      }
                    >
                      <td
                        className="px-2 py-2 align-top text-[11px] text-zinc-500 font-mono tabular-nums"
                        title="Apply order (file order). Independent of the visual sort above."
                        data-testid={`bulk-row-applyorder-${row.id}`}
                      >
                        {(row.row_index ?? 0) + 1}
                      </td>
                      <td
                        className="px-2 py-2 align-top select-none"
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          beginRowDragSelect("include", row.id, !!row.include);
                        }}
                        onMouseEnter={() => extendRowDragSelect("include", row.id)}
                      >
                        <input
                          type="checkbox"
                          className="pointer-events-none"
                          readOnly
                          checked={!!row.include}
                          tabIndex={-1}
                          aria-label={`Include row ${(row.row_index ?? 0) + 1} in apply`}
                        />
                      </td>
                      <td
                        className="px-2 py-2 align-top select-none"
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          beginRowDragSelect("multi_edit", row.id, !!row.multi_edit);
                        }}
                        onMouseEnter={() => extendRowDragSelect("multi_edit", row.id)}
                        title="Click or drag to toggle Multi (bulk field edits)"
                      >
                        <input
                          type="checkbox"
                          className="pointer-events-none"
                          readOnly
                          checked={!!row.multi_edit}
                          tabIndex={-1}
                          data-testid={`bulk-row-multi-${row.id}`}
                          aria-label={`Multi-edit row ${(row.row_index ?? 0) + 1}`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={rowEntityEffective}
                          onValueChange={(v) => {
                            const patch = { entity_id: v, selected_flow_id: null };
                            const rowAmt = bulkImportAmountNumber(row, inspectAmountInput(row.amount));
                            patch.category = rowAmt >= 0 ? REVENUE_CATEGORY : "Expense";
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
                          type="date"
                          value={row.transaction_date || ""}
                          title={row.value_date ? `Value date: ${row.value_date}` : undefined}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (shouldBulkEdit(row.id)) {
                              setRows((prev) =>
                                prev.map((r) =>
                                  multiEditRowIds.has(r.id) ? { ...r, transaction_date: v } : r,
                                ),
                              );
                            } else {
                              updateRowLocal(row.id, { transaction_date: v });
                            }
                          }}
                          onBlur={(e) => persistFromAnchorRow(row.id, { transaction_date: e.target.value })}
                          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100"
                          data-testid={`bulk-row-date-${row.id}`}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <span
                          className="block min-w-[110px] px-2 py-1 text-zinc-300 font-mono text-[11px] tabular-nums"
                          title="Value date from file (read-only)"
                          data-testid={`bulk-row-value-date-${row.id}`}
                        >
                          {row.value_date || "—"}
                        </span>
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
                            {categoryOptionsForRow(rowEntityEffective, categories, categoriesByEntity).map((c) => (
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
                            const matchedFlow = next ? allFlows.find((f) => f.id === next) : null;
                            const payload = { selected_flow_id: next, classification: "existing_flow" };
                            if (matchedFlow?.category) payload.category = matchedFlow.category;
                            if (matchedFlow?.entity_id) payload.entity_id = matchedFlow.entity_id;
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
                                {f.label}{f.category ? ` - ${f.category}` : ""}
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
              <button
                type="button"
                onClick={rematchBatch}
                disabled={loadingRows || applying || simulating || batch.status === "applied"}
                className="btn-secondary text-sm"
                data-testid="bulk-rematch-btn"
              >
                Re-match flows
              </button>
              <button
                type="button"
                onClick={runSimulation}
                disabled={simulating || applying || summary.included === 0}
                className="btn-secondary text-sm"
                data-testid="bulk-simulate-btn"
              >
                {simulating ? "Simulating..." : "Simulate"}
              </button>
              <button onClick={applyRows} disabled={applying || simulating} className="btn-primary text-sm" data-testid="bulk-apply-btn">
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
        </>
      )}


      <Dialog open={simulationOpen} onOpenChange={setSimulationOpen}>
        <DialogContent className="bg-zinc-950 border-zinc-800 max-w-[96vw] w-full max-h-[92vh] flex flex-col p-0 overflow-hidden" data-testid="bulk-simulation-dialog">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-zinc-800 shrink-0">
            <DialogTitle className="text-zinc-100 font-heading text-sm tracking-wide uppercase">Import simulation preview</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              Cash flow table after applying included rows (grouped sums per flow/month). Nothing is saved until you run Update Actuals.
            </DialogDescription>
          </DialogHeader>
          {simulationResult?.changes?.length > 0 && (
            <div className="px-5 py-2 border-b border-zinc-800 max-h-32 overflow-y-auto shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Summary</p>
              <ul className="text-xs text-zinc-400 space-y-0.5">
                {simulationResult.changes.map((c, i) => (
                  <li key={`${c.flow_label}-${c.month}-${i}`}>
                    <span className="text-zinc-300">{c.flow_label}</span> · {c.month} → <span className="font-mono text-cyan-300">CHF {Number(c.preview_actual).toLocaleString("de-CH")}</span>
                    {c.import_row_count > 1 && <span className="text-zinc-600"> ({c.import_row_count} lines summed)</span>}
                    {c.is_new_flow && <span className="text-amber-400/80"> · new line</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto p-3">
            {simulationResult?.matrix ? (
              <CashFlowTable scenario="likely" horizon={12} entities={entities} previewMatrix={simulationResult.matrix} readOnly />
            ) : (
              <p className="text-sm text-zinc-500 p-4">No preview data.</p>
            )}
          </div>
          <DialogFooter className="px-5 py-3 border-t border-zinc-800 shrink-0 gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => setSimulationOpen(false)}>Close</button>
            <button type="button" className="btn-primary text-sm" onClick={() => { setSimulationOpen(false); applyRows(); }} disabled={applying} data-testid="bulk-simulate-apply">Update Actuals</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={applyReviewOpen} onOpenChange={setApplyReviewOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden" data-testid="bulk-apply-review-dialog">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-zinc-800 shrink-0">
            <DialogTitle className="text-zinc-100 font-heading text-sm tracking-wide uppercase flex items-center gap-2">
              <WarningCircle size={20} className="text-amber-400 shrink-0" weight="fill" aria-hidden />
              Rows not updated
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-500 space-y-1">
              <span>
                These lines were included in the run but did not record a new actual (failed) or were left unchanged because values already matched (skipped).
              </span>
              {applyResult?.discarded_rows > 0 && (
                <span className="block text-zinc-600">
                  {applyResult.discarded_rows} other line(s) were not part of this run (Use unchecked).
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto px-3 py-2 min-h-0 flex-1">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-zinc-900 z-[1]">
                <tr className="text-left text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 pr-2 font-medium">#</th>
                  <th className="py-2 pr-2 font-medium">Month</th>
                  <th className="py-2 pr-2 font-medium min-w-[140px]">Description</th>
                  <th className="py-2 pr-2 font-medium text-right">Amount</th>
                  <th className="py-2 pr-2 font-medium min-w-[100px]">Flow</th>
                  <th className="py-2 pr-2 font-medium">Type</th>
                  <th className="py-2 font-medium min-w-[180px]">Why</th>
                </tr>
              </thead>
              <tbody>
                {applyReviewItems.map(({ row, reason, kind, orphan }) => (
                  <tr key={row.id} className="border-b border-zinc-800/60 align-top">
                    <td className="py-2 pr-2 font-mono text-zinc-500 tabular-nums">
                      {orphan ? "—" : (row.row_index ?? 0) + 1}
                    </td>
                    <td className="py-2 pr-2 text-zinc-300 whitespace-nowrap">{row.month || "—"}</td>
                    <td className="py-2 pr-2 text-zinc-300 max-w-[220px]">
                      <span className="line-clamp-2" title={row.description}>{row.description || "—"}</span>
                    </td>
                    <td className="py-2 pr-2 text-right font-mono text-zinc-300 whitespace-nowrap">{row.amount ?? "—"}</td>
                    <td className="py-2 pr-2 text-zinc-400 truncate max-w-[140px]" title={orphan ? "" : (flowLabelById[row.selected_flow_id] || (row.classification === "new_flow" ? "New line" : "Unmatched"))}>
                      {orphan ? "—" : (flowLabelById[row.selected_flow_id] || (row.classification === "new_flow" ? "New line" : "Unmatched"))}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <span className={kind === "failed" ? "text-rose-400" : "text-amber-400/90"}>
                        {kind === "failed" ? "Failed" : "Skipped"}
                      </span>
                    </td>
                    <td className="py-2 text-zinc-400">{reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/80 shrink-0">
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => setApplyReviewOpen(false)}
              data-testid="bulk-apply-review-dismiss"
            >
              Got it — fix in table
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
