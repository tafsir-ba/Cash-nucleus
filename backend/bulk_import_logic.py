"""Bulk actual import grouping, apply, and simulation preview."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from server import CashFlow


def bulk_import_group_key(row: dict, batch: dict) -> tuple:
    from server import Category

    classification = row.get("classification", "existing_flow")
    month = row.get("month")
    if classification == "new_flow":
        entity = row.get("entity_id") or batch.get("entity_id")
        raw_cat = row.get("category", Category.EXPENSE.value)
        cat = raw_cat.value if isinstance(raw_cat, Category) else str(raw_cat)
        return ("new_flow", entity, cat, month)
    return ("existing_flow", row.get("selected_flow_id"), month)


def aggregate_bulk_import_groups(to_apply: List[dict], batch: dict) -> List[dict]:
    groups: Dict[tuple, dict] = {}
    for row in sorted(to_apply, key=lambda r: r.get("row_index", 0)):
        key = bulk_import_group_key(row, batch)
        if key not in groups:
            groups[key] = {
                "key": key,
                "rows": [],
                "amount_sum": 0.0,
                "variance_action": row.get("variance_action", "actual_only"),
            }
        group = groups[key]
        group["rows"].append(row)
        group["amount_sum"] = round(group["amount_sum"] + float(row.get("amount", 0)), 2)
        group["variance_action"] = row.get("variance_action", "actual_only")
    return list(groups.values())


def validate_bulk_import_row_for_apply(row: dict, batch: dict) -> Optional[str]:
    from server import is_valid_month_key

    classification = row.get("classification", "existing_flow")
    month = row.get("month")
    amount = row.get("amount")
    entity_for_row = row.get("entity_id") or batch.get("entity_id")

    if not month or amount is None:
        return "Row missing month or amount"
    if not is_valid_month_key(str(month)):
        return "Row has invalid month format (expected YYYY-MM)"
    try:
        amount_value = float(amount)
    except Exception:
        return "Row has invalid amount"
    if not math.isfinite(amount_value):
        return "Row has invalid amount"

    if classification == "new_flow":
        if not entity_for_row:
            return "New line rows require entity scope (set entity on batch or row)"
        return None

    if not row.get("selected_flow_id"):
        return "Row missing selected_flow_id (pick a flow or switch target to New line)"
    return None


def resolve_bulk_import_group_flow(
    group: dict,
    batch: dict,
    *,
    create_new_flows: bool,
) -> Tuple[Optional[str], Optional[str], Optional["CashFlow"]]:
    from server import build_cash_flow_from_import_row

    key = group["key"]
    if key[0] == "existing_flow":
        return key[1], None, None

    entity_id = key[1]
    if not entity_id:
        return None, "New line rows require entity scope (set entity on batch or row)", None

    if not create_new_flows:
        return None, None, None

    leader = group["rows"][0]
    flow_obj = build_cash_flow_from_import_row(leader, entity_id, group["amount_sum"])
    return flow_obj.id, None, flow_obj


async def apply_bulk_import_groups(
    *,
    batch: dict,
    batch_id: str,
    to_apply: List[dict],
    user: dict,
) -> Tuple[int, int, int, List[dict], List[dict]]:
    from server import (
        FlowOccurrenceUpdate,
        db,
        upsert_flow_occurrence,
        validate_selected_flow_for_row,
    )

    applied = 0
    failed = 0
    skipped = 0
    errors: List[dict] = []
    batch_side_effects: List[dict] = []

    async def mark_group_rows(
        row_ids: List[str],
        status: str,
        error: Optional[str] = None,
        extra: Optional[dict] = None,
    ) -> None:
        patch: Dict[str, Any] = {
            "status": status,
            "error": error,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if extra:
            patch.update(extra)
        for rid in row_ids:
            await db.actual_import_rows.update_one({"id": rid}, {"$set": patch})

    for row in to_apply:
        msg = validate_bulk_import_row_for_apply(row, batch)
        if msg:
            failed += 1
            errors.append({"row_id": row["id"], "error": msg})
            await mark_group_rows([row["id"]], "failed", msg)

    valid_rows = [r for r in to_apply if validate_bulk_import_row_for_apply(r, batch) is None]
    groups = aggregate_bulk_import_groups(valid_rows, batch)

    for group in groups:
        group_rows = group["rows"]
        row_ids = [r["id"] for r in group_rows]
        leader = group_rows[0]
        month = leader.get("month")
        final_amount = float(group["amount_sum"])
        variance_action = group.get("variance_action", "actual_only")
        created_flow_id: Optional[str] = None
        flow_id: Optional[str] = None

        try:
            flow_id, resolve_err, flow_obj = resolve_bulk_import_group_flow(
                group, batch, create_new_flows=True,
            )
            if resolve_err:
                failed += len(group_rows)
                for rid in row_ids:
                    errors.append({"row_id": rid, "error": resolve_err})
                await mark_group_rows(row_ids, "failed", resolve_err)
                continue

            if flow_obj is not None:
                await db.cash_flows.insert_one(flow_obj.model_dump())
                created_flow_id = flow_id
                entity_for_row = group["key"][1]
                await validate_selected_flow_for_row(flow_id, entity_for_row, batch.get("entity_id"))
            else:
                await validate_selected_flow_for_row(
                    flow_id, leader.get("entity_id"), batch.get("entity_id"),
                )

            desired_variance_action = None if variance_action == "actual_only" else variance_action
            prev_occurrence = await db.flow_occurrences.find_one(
                {"flow_id": flow_id, "month": month},
                {"_id": 0},
            )
            existing_amount = prev_occurrence.get("actual_amount") if prev_occurrence else None
            existing_variance_action = prev_occurrence.get("variance_action") if prev_occurrence else None

            if (
                prev_occurrence
                and existing_amount is not None
                and round(float(existing_amount), 2) == round(final_amount, 2)
                and existing_variance_action == desired_variance_action
            ):
                skipped += len(group_rows)
                if created_flow_id:
                    await db.cash_flows.delete_many({"parent_id": created_flow_id})
                    await db.cash_flows.delete_one({"id": created_flow_id})
                await mark_group_rows(row_ids, "skipped", None)
                continue

            existing_carryovers = await db.cash_flows.find({
                "carryover_from": flow_id,
                "carryover_month": month,
            }, {"_id": 0}).to_list(100)

            occ_update = FlowOccurrenceUpdate(
                flow_id=flow_id,
                month=month,
                actual_amount=final_amount,
                variance_action=desired_variance_action,
            )
            occ_result = await upsert_flow_occurrence(
                occ_update,
                suppress_undo=True,
                event_meta={
                    "action": "set",
                    "source": "bulk_import",
                    "batch_id": batch_id,
                    "batch_filename": batch.get("filename"),
                    "batch_row_id": leader["id"],
                    "input_amount": final_amount,
                    "merge_mode": "override",
                    "actor_id": user.get("id"),
                    "actor_email": user.get("email"),
                },
            )
            applied += len(group_rows)
            row_effects: Dict[str, Any] = {
                "flow_id": flow_id,
                "month": month,
                "previous_occurrence": prev_occurrence,
                "deleted_carryovers": existing_carryovers,
                "created_carryover_ids": occ_result.get("created_carryover_ids", []),
            }
            if created_flow_id:
                row_effects["created_flow_id"] = created_flow_id
            batch_side_effects.append(row_effects)
            extra_set: Dict[str, Any] = {}
            if group["key"][0] == "new_flow":
                extra_set["selected_flow_id"] = flow_id
            await mark_group_rows(row_ids, "applied", None, extra_set)
        except Exception as exc:
            if created_flow_id:
                await db.cash_flows.delete_many({"parent_id": created_flow_id})
                await db.cash_flows.delete_one({"id": created_flow_id})
            failed += len(group_rows)
            msg = str(exc)
            for rid in row_ids:
                errors.append({"row_id": rid, "error": msg})
            await mark_group_rows(row_ids, "failed", msg)

    return applied, failed, skipped, errors, batch_side_effects


async def compute_bulk_import_preview(
    batch: dict,
    to_apply: List[dict],
    *,
    entity_id: Optional[str] = None,
    horizon: int = 12,
    scenario: str = "likely",
):
    from server import (
        ActualImportPreviewChange,
        ActualImportSimulateResponse,
        Category,
        db,
        get_projection_matrix,
    )

    errors: List[dict] = []
    changes: List[ActualImportPreviewChange] = []
    preview_actuals: Dict[Tuple[str, str], float] = {}
    preview_new_rows: List[dict] = []

    valid_rows = []
    for row in to_apply:
        msg = validate_bulk_import_row_for_apply(row, batch)
        if msg:
            errors.append({"row_id": row["id"], "error": msg})
            continue
        valid_rows.append(row)

    groups = aggregate_bulk_import_groups(valid_rows, batch)

    for group in groups:
        leader = group["rows"][0]
        month = str(leader.get("month"))
        final_amount = float(group["amount_sum"])
        is_new = group["key"][0] == "new_flow"

        flow_id, resolve_err, _flow_obj = resolve_bulk_import_group_flow(
            group, batch, create_new_flows=False,
        )
        if resolve_err:
            for r in group["rows"]:
                errors.append({"row_id": r["id"], "error": resolve_err})
            continue

        if is_new:
            label = (leader.get("description") or "Imported").strip()[:200] or "Imported"
            raw_cat = leader.get("category", Category.EXPENSE.value)
            cat = raw_cat.value if isinstance(raw_cat, Category) else str(raw_cat)
            preview_new_rows.append({
                "flow_id": f"preview-new-{leader['id']}",
                "label": label,
                "category": cat,
                "month": month,
                "amount": final_amount,
                "is_revenue": final_amount > 0,
            })
            changes.append(
                ActualImportPreviewChange(
                    flow_id=None,
                    flow_label=label,
                    month=month,
                    current_actual=None,
                    preview_actual=final_amount,
                    import_row_count=len(group["rows"]),
                    is_new_flow=True,
                )
            )
            continue

        if not flow_id:
            msg = "Row missing selected_flow_id (pick a flow or switch target to New line)"
            for r in group["rows"]:
                errors.append({"row_id": r["id"], "error": msg})
            continue

        flow_doc = await db.cash_flows.find_one({"id": flow_id}, {"_id": 0, "label": 1})
        label = flow_doc.get("label", flow_id) if flow_doc else flow_id

        prev_occurrence = await db.flow_occurrences.find_one(
            {"flow_id": flow_id, "month": month},
            {"_id": 0},
        )
        current_actual = None
        if prev_occurrence and prev_occurrence.get("actual_amount") is not None:
            current_actual = round(float(prev_occurrence["actual_amount"]), 2)

        preview_actuals[(flow_id, month)] = final_amount
        changes.append(
            ActualImportPreviewChange(
                flow_id=flow_id,
                flow_label=label,
                month=month,
                current_actual=current_actual,
                preview_actual=final_amount,
                import_row_count=len(group["rows"]),
                is_new_flow=False,
            )
        )

    matrix_entity = entity_id or batch.get("entity_id")
    matrix = await get_projection_matrix(scenario=scenario, entity_id=matrix_entity, horizon=horizon)

    def patch_matrix_cells(row_list: List[dict]) -> None:
        for row in row_list:
            fid = row.get("flow_id")
            for mk, cell in (row.get("cells") or {}).items():
                key = (fid, mk)
                if key in preview_actuals:
                    preview = preview_actuals[key]
                    planned = cell.get("planned", cell.get("amount"))
                    cell["actual"] = preview
                    cell["planned"] = planned
                    cell["has_actual"] = True
                    cell["amount"] = preview

    patch_matrix_cells(matrix.get("revenue_rows", []))
    patch_matrix_cells(matrix.get("expense_rows", []))

    for preview_row in preview_new_rows:
        mk = preview_row["month"]
        cell = {
            "amount": preview_row["amount"],
            "actual": preview_row["amount"],
            "planned": preview_row["amount"],
            "has_actual": True,
        }
        row_obj = {
            "flow_id": preview_row["flow_id"],
            "label": preview_row["label"],
            "category": preview_row["category"],
            "parent_id": None,
            "is_percentage": False,
            "cells": {mk: cell},
            "row_total": preview_row["amount"],
            "priority": None,
        }
        if preview_row["is_revenue"]:
            matrix.setdefault("revenue_rows", []).append(row_obj)
        else:
            matrix.setdefault("expense_rows", []).append(row_obj)

    return ActualImportSimulateResponse(changes=changes, errors=errors, matrix=matrix)
