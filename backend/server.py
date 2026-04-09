from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone, date
from dateutil.relativedelta import relativedelta
from enum import Enum

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ============== ENUMS ==============
class Category(str, Enum):
    REVENUE = "Revenue"
    SALARY = "Salary"
    TAX = "Tax"
    DEBT = "Debt"
    EXPENSE = "Expense"
    TRANSFER = "Transfer"
    COGS = "COGS"
    OTHER = "Other"

class Certainty(str, Enum):
    MATERIALIZED = "Materialized"
    SURE = "Sure to happen"
    FIFTY_FIFTY = "50/50"
    IDEA = "Idea"

class Recurrence(str, Enum):
    NONE = "none"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"

class RecurrenceMode(str, Enum):
    REPEAT = "repeat"
    DISTRIBUTE = "distribute"

class SourceType(str, Enum):
    MANUAL = "manual"
    DEAL = "deal"

class FlowPriority(str, Enum):
    CRITICAL = "critical"
    FLEXIBLE = "flexible"
    STRATEGIC = "strategic"

# ============== ENTITY MODELS ==============
class Entity(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class EntityCreate(BaseModel):
    name: str
    description: str = ""

class EntityUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

# ============== BANK ACCOUNT MODELS ==============
class BankAccount(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    entity_id: str = ""
    entity: str = ""
    label: str
    amount: float
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class BankAccountCreate(BaseModel):
    entity_id: str
    label: str
    amount: float

class BankAccountUpdate(BaseModel):
    entity_id: Optional[str] = None
    label: Optional[str] = None
    amount: Optional[float] = None

# ============== CASH FLOW MODELS ==============
class CashFlow(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str
    amount: float
    date: str  # ISO date YYYY-MM-DD
    category: Category = Category.EXPENSE
    certainty: Certainty = Certainty.MATERIALIZED
    recurrence: Recurrence = Recurrence.NONE
    recurrence_mode: RecurrenceMode = RecurrenceMode.REPEAT
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity_id: str = ""
    entity: str = ""
    parent_id: Optional[str] = None
    is_percentage: bool = False
    percentage_of_parent: Optional[float] = None
    carryover_from: Optional[str] = None
    carryover_month: Optional[str] = None
    source_type: SourceType = SourceType.MANUAL
    source_id: Optional[str] = None
    priority: Optional[FlowPriority] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CashFlowCreate(BaseModel):
    label: str
    amount: float
    date: str
    category: Category = Category.EXPENSE
    certainty: Certainty = Certainty.MATERIALIZED
    recurrence: Recurrence = Recurrence.NONE
    recurrence_mode: RecurrenceMode = RecurrenceMode.REPEAT
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity_id: str
    parent_id: Optional[str] = None
    is_percentage: bool = False
    percentage_of_parent: Optional[float] = None
    source_type: SourceType = SourceType.MANUAL
    source_id: Optional[str] = None
    priority: Optional[FlowPriority] = None

class CashFlowUpdate(BaseModel):
    label: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[str] = None
    category: Optional[Category] = None
    certainty: Optional[Certainty] = None
    recurrence: Optional[Recurrence] = None
    recurrence_mode: Optional[RecurrenceMode] = None
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity_id: Optional[str] = None
    priority: Optional[FlowPriority] = None

class CashFlowBatchCreate(BaseModel):
    parent: CashFlowCreate
    linked: List[CashFlowCreate] = []

# ============== FLOW OCCURRENCE MODELS (ACTUALS & VARIANCE) ==============
class FlowOccurrence(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    flow_id: str
    month: str  # "YYYY-MM"
    actual_amount: Optional[float] = None  # None = no actual recorded yet (planned)
    variance_action: Optional[str] = None  # "carry_forward" | "write_off" | None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class FlowOccurrenceUpdate(BaseModel):
    flow_id: str
    month: str
    actual_amount: Optional[float] = None
    variance_action: Optional[str] = None  # "carry_forward" | "write_off"


# ============== UNDO SYSTEM ==============
class UndoAction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action_type: str  # "create" | "update" | "delete" | "batch_create" | "record_actual"
    collection: str  # "cash_flows" | "bank_accounts" | "entities" | "flow_occurrences"
    target_ids: List[str] = []  # IDs affected
    previous_data: Optional[List[dict]] = None  # Snapshots before change
    created_data: Optional[List[dict]] = None  # Data that was created (for undoing creates)
    side_effects: Optional[dict] = None  # Related changes (carryover flows, occurrences)
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    description: str = ""

# ============== SETTINGS & PROJECTION MODELS ==============
class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = "settings"
    safety_buffer: float = 50000.0

class SettingsUpdate(BaseModel):
    safety_buffer: float

class MonthProjection(BaseModel):
    month: str
    month_label: str
    inflows: float
    outflows: float
    net: float
    closing_cash: float
    status: str

class ProjectionResponse(BaseModel):
    cash_now: float
    lowest_cash: float
    lowest_cash_month: str
    highest_pressure_month: str = ""
    first_watch_month: Optional[str] = None
    first_danger_month: Optional[str] = None
    overall_status: str
    safety_buffer: float
    months: List[MonthProjection]

# ============== HELPER: Calculate percentage-based amount dynamically ==============
async def get_flow_with_dynamic_amount(flow: dict) -> dict:
    """For percentage-based linked flows, calculate amount from parent dynamically."""
    if flow.get("is_percentage") and flow.get("parent_id") and flow.get("percentage_of_parent"):
        parent = await db.cash_flows.find_one({"id": flow["parent_id"]}, {"_id": 0})
        if parent:
            pct = flow["percentage_of_parent"]
            parent_abs = abs(parent.get("amount", 0))
            # Percentage flows are costs (negative) based on parent's absolute value
            flow["amount"] = -(parent_abs * pct / 100)
    return flow


# ============== UNDO HELPERS ==============
MAX_UNDO_STACK = 50

async def push_undo(action_type: str, collection: str, target_ids: List[str], 
                     previous_data=None, created_data=None, description="", side_effects=None):
    """Push an action to the undo stack."""
    action = UndoAction(
        action_type=action_type,
        collection=collection,
        target_ids=target_ids,
        previous_data=previous_data,
        created_data=created_data,
        description=description,
        side_effects=side_effects,
    )
    await db.undo_stack.insert_one(action.model_dump())
    # Trim stack to max size
    count = await db.undo_stack.count_documents({})
    if count > MAX_UNDO_STACK:
        oldest = await db.undo_stack.find({}, {"_id": 0, "id": 1}).sort("timestamp", 1).limit(count - MAX_UNDO_STACK).to_list(100)
        if oldest:
            await db.undo_stack.delete_many({"id": {"$in": [o["id"] for o in oldest]}})

@api_router.post("/undo")
async def undo_last_action():
    """Undo the most recent action. Restores full system state including dependencies."""
    last = await db.undo_stack.find_one({}, {"_id": 0}, sort=[("timestamp", -1)])
    if not last:
        return {"status": "nothing_to_undo"}
    
    action_type = last["action_type"]
    collection = last["collection"]
    coll = db[collection]
    side_effects = last.get("side_effects") or {}
    
    if action_type in ["create", "batch_create"]:
        # Delete the created items
        for tid in last.get("target_ids", []):
            await coll.delete_one({"id": tid})
        # For batch_create, also delete linked children
        if action_type == "batch_create" and collection == "cash_flows":
            for tid in last.get("target_ids", []):
                await coll.delete_many({"parent_id": tid})
    
    elif action_type == "update":
        # Restore previous data
        for prev in (last.get("previous_data") or []):
            prev_clean = {k: v for k, v in prev.items() if k != "_id"}
            fid = prev_clean.get("id")
            if fid:
                await coll.replace_one({"id": fid}, prev_clean, upsert=True)
    
    elif action_type == "delete":
        # Re-insert previously deleted data
        for prev in (last.get("previous_data") or []):
            prev.pop("_id", None)
            await coll.insert_one(prev)
        # If children were orphaned (not deleted), restore their parent_id
        orphaned_ids = side_effects.get("orphaned_child_ids", [])
        if orphaned_ids and collection == "cash_flows":
            parent_data = (last.get("previous_data") or [{}])[0]
            parent_id = parent_data.get("id", "")
            if parent_id:
                for child_snapshot in (last.get("previous_data") or [])[1:]:
                    child_id = child_snapshot.get("id")
                    if child_id in orphaned_ids:
                        # Restore the child to its pre-delete state (including parent_id)
                        child_clean = {k: v for k, v in child_snapshot.items() if k != "_id"}
                        await coll.replace_one({"id": child_id}, child_clean, upsert=True)
    
    elif action_type == "record_actual":
        # Restore previous occurrence state
        prev_occurrence = side_effects.get("previous_occurrence")
        flow_id = side_effects.get("flow_id", "")
        month = side_effects.get("month", "")
        
        if prev_occurrence:
            # Restore the previous occurrence
            prev_occurrence.pop("_id", None)
            await db.flow_occurrences.replace_one(
                {"flow_id": flow_id, "month": month},
                prev_occurrence, upsert=True
            )
        else:
            # No previous occurrence — delete the one we created
            await db.flow_occurrences.delete_one({"flow_id": flow_id, "month": month})
        
        # Remove any carryover flows that were created by this action
        created_carryovers = side_effects.get("created_carryover_ids", [])
        for cid in created_carryovers:
            await db.cash_flows.delete_one({"id": cid})
        
        # Restore any carryover flows that were deleted by this action
        deleted_carryovers = side_effects.get("deleted_carryovers", [])
        for dc in deleted_carryovers:
            dc.pop("_id", None)
            await db.cash_flows.insert_one(dc)
    
    # Remove the action from stack
    await db.undo_stack.delete_one({"id": last["id"]})
    
    return {"status": "undone", "description": last.get("description", "")}

@api_router.get("/undo/peek")
async def peek_undo():
    """Peek at the last undoable action."""
    last = await db.undo_stack.find_one({}, {"_id": 0}, sort=[("timestamp", -1)])
    if not last:
        return {"has_undo": False}
    return {"has_undo": True, "description": last.get("description", ""), "action_type": last["action_type"]}

# ============== ENTITY ROUTES ==============
@api_router.get("/entities", response_model=List[Entity])
async def get_entities():
    entities = await db.entities.find({}, {"_id": 0}).to_list(100)
    return entities

@api_router.post("/entities", response_model=Entity)
async def create_entity(entity: EntityCreate):
    entity_obj = Entity(**entity.model_dump())
    await db.entities.insert_one(entity_obj.model_dump())
    return entity_obj

@api_router.put("/entities/{entity_id}", response_model=Entity)
async def update_entity(entity_id: str, update: EntityUpdate):
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid update data")
    result = await db.entities.find_one_and_update(
        {"id": entity_id}, {"$set": update_data},
        return_document=True, projection={"_id": 0}
    )
    if not result:
        raise HTTPException(status_code=404, detail="Entity not found")
    return result

@api_router.delete("/entities/{entity_id}")
async def delete_entity(entity_id: str):
    accounts = await db.bank_accounts.count_documents({"entity_id": entity_id})
    flows = await db.cash_flows.count_documents({"entity_id": entity_id})
    if accounts > 0 or flows > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {accounts} accounts, {flows} flows")
    result = await db.entities.delete_one({"id": entity_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Entity not found")
    return {"message": "Entity deleted"}

# ============== BANK ACCOUNT ROUTES ==============
@api_router.get("/bank-accounts", response_model=List[BankAccount])
async def get_bank_accounts(entity_id: Optional[str] = None):
    query = {"entity_id": entity_id} if entity_id else {}
    accounts = await db.bank_accounts.find(query, {"_id": 0}).to_list(100)
    return accounts

@api_router.post("/bank-accounts", response_model=BankAccount)
async def create_bank_account(account: BankAccountCreate):
    entity = await db.entities.find_one({"id": account.entity_id})
    if not entity:
        raise HTTPException(status_code=400, detail="Entity not found")
    account_obj = BankAccount(**account.model_dump())
    await db.bank_accounts.insert_one(account_obj.model_dump())
    return account_obj

@api_router.put("/bank-accounts/{account_id}", response_model=BankAccount)
async def update_bank_account(account_id: str, update: BankAccountUpdate):
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid update data")
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.bank_accounts.find_one_and_update(
        {"id": account_id}, {"$set": update_data},
        return_document=True, projection={"_id": 0}
    )
    if not result:
        raise HTTPException(status_code=404, detail="Bank account not found")
    return result

@api_router.delete("/bank-accounts/{account_id}")
async def delete_bank_account(account_id: str):
    result = await db.bank_accounts.delete_one({"id": account_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bank account not found")
    return {"message": "Bank account deleted"}

# ============== CASH FLOW ROUTES ==============
@api_router.get("/cash-flows")
async def get_cash_flows(entity_id: Optional[str] = None):
    query = {"entity_id": entity_id} if entity_id else {}
    flows = await db.cash_flows.find(query, {"_id": 0}).to_list(1000)
    # Calculate dynamic amounts for percentage-based flows
    result = []
    for f in flows:
        result.append(await get_flow_with_dynamic_amount(f))
    return result

@api_router.get("/cash-flows/with-linked")
async def get_cash_flows_with_linked(entity_id: Optional[str] = None):
    """Get all cash flows grouped by parent-child, with dynamic amount calculation."""
    query = {"entity_id": entity_id} if entity_id else {}
    flows = await db.cash_flows.find(query, {"_id": 0}).to_list(1000)
    
    # Calculate dynamic amounts
    flows_with_amounts = []
    for f in flows:
        flows_with_amounts.append(await get_flow_with_dynamic_amount(f))
    
    # Separate parents and children
    parent_flows = [f for f in flows_with_amounts if not f.get("parent_id")]
    linked_map = {}
    for f in flows_with_amounts:
        if f.get("parent_id"):
            pid = f["parent_id"]
            if pid not in linked_map:
                linked_map[pid] = []
            linked_map[pid].append(f)
    
    result = []
    for pf in parent_flows:
        result.append({
            "flow": pf,
            "linked_flows": linked_map.get(pf["id"], [])
        })
    result.sort(key=lambda x: x["flow"].get("date", ""), reverse=True)
    return result

@api_router.post("/cash-flows", response_model=CashFlow)
async def create_cash_flow(flow: CashFlowCreate):
    entity = await db.entities.find_one({"id": flow.entity_id})
    if not entity:
        raise HTTPException(status_code=400, detail="Entity not found")
    flow_obj = CashFlow(**flow.model_dump())
    await db.cash_flows.insert_one(flow_obj.model_dump())
    await push_undo("create", "cash_flows", [flow_obj.id], description=f"Create: {flow_obj.label}")
    return flow_obj

@api_router.post("/cash-flows/batch")
async def create_cash_flow_batch(batch: CashFlowBatchCreate):
    """Create parent + linked flows. Children inherit recurrence from parent."""
    entity = await db.entities.find_one({"id": batch.parent.entity_id})
    if not entity:
        raise HTTPException(status_code=400, detail="Entity not found")
    
    # Create parent
    parent_obj = CashFlow(**batch.parent.model_dump())
    await db.cash_flows.insert_one(parent_obj.model_dump())
    
    # Create linked flows with inherited recurrence
    linked_results = []
    for linked in batch.linked:
        data = linked.model_dump()
        data["parent_id"] = parent_obj.id
        # ENFORCE: Children inherit parent's recurrence and mode
        data["recurrence"] = batch.parent.recurrence
        data["recurrence_mode"] = batch.parent.recurrence_mode
        data["recurrence_end"] = batch.parent.recurrence_end
        data["recurrence_count"] = batch.parent.recurrence_count
        
        # For percentage-based: calculate initial amount from parent
        if data.get("is_percentage") and data.get("percentage_of_parent"):
            pct = data["percentage_of_parent"]
            parent_abs = abs(batch.parent.amount)
            data["amount"] = -(parent_abs * pct / 100)
        
        linked_obj = CashFlow(**data)
        await db.cash_flows.insert_one(linked_obj.model_dump())
        linked_results.append(linked_obj.model_dump())
    
    all_ids = [parent_obj.id] + [lr["id"] for lr in linked_results]
    await push_undo("batch_create", "cash_flows", all_ids, description=f"Create: {parent_obj.label} + {len(linked_results)} linked")
    
    return {"parent": parent_obj.model_dump(), "linked": linked_results}
    # Note: undo tracking done above after all inserts

@api_router.put("/cash-flows/{flow_id}", response_model=CashFlow)
async def update_cash_flow(flow_id: str, update: CashFlowUpdate):
    """Update flow. Propagate changes to children for parent flows."""
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid update data")
    
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Get current flow to check if parent — snapshot for undo
    current = await db.cash_flows.find_one({"id": flow_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Cash flow not found")
    
    # Snapshot children too for undo
    children_snapshot = await db.cash_flows.find({"parent_id": flow_id}, {"_id": 0}).to_list(100)
    all_snapshots = [current] + children_snapshot
    
    # Update the flow
    result = await db.cash_flows.find_one_and_update(
        {"id": flow_id}, {"$set": update_data},
        return_document=True, projection={"_id": 0}
    )
    
    # Check if this is a parent flow (has children)
    children = await db.cash_flows.find({"parent_id": flow_id}, {"_id": 0}).to_list(100)
    
    if children:
        child_updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
        
        # PROPAGATE: Recurrence changes to all children
        if any(k in update_data for k in ["recurrence", "recurrence_mode", "recurrence_end", "recurrence_count"]):
            if "recurrence" in update_data:
                child_updates["recurrence"] = update_data["recurrence"]
            if "recurrence_mode" in update_data:
                child_updates["recurrence_mode"] = update_data["recurrence_mode"]
            if "recurrence_end" in update_data:
                child_updates["recurrence_end"] = update_data["recurrence_end"]
            if "recurrence_count" in update_data:
                child_updates["recurrence_count"] = update_data["recurrence_count"]
        
        # PROPAGATE: Date changes to children
        if "date" in update_data:
            child_updates["date"] = update_data["date"]
        
        # PROPAGATE: Certainty changes to children
        if "certainty" in update_data:
            child_updates["certainty"] = update_data["certainty"]
        
        if len(child_updates) > 1:  # More than just updated_at
            await db.cash_flows.update_many(
                {"parent_id": flow_id},
                {"$set": child_updates}
            )
        
        # RECALCULATE: Percentage-based children when parent amount changes
        if "amount" in update_data:
            new_parent_amount = abs(update_data["amount"])
            for child in children:
                if child.get("is_percentage") and child.get("percentage_of_parent"):
                    new_child_amount = -(new_parent_amount * child["percentage_of_parent"] / 100)
                    await db.cash_flows.update_one(
                        {"id": child["id"]},
                        {"$set": {"amount": new_child_amount, "updated_at": datetime.now(timezone.utc).isoformat()}}
                    )
    
    await push_undo("update", "cash_flows", [flow_id], previous_data=all_snapshots, description=f"Edit: {current.get('label', '')}")
    
    return result

@api_router.delete("/cash-flows/{flow_id}")
async def delete_cash_flow(flow_id: str, delete_linked: bool = False):
    """Delete flow. Optionally delete linked children or orphan them."""
    # Snapshot for undo — ALWAYS snapshot children for full state restore
    current = await db.cash_flows.find_one({"id": flow_id}, {"_id": 0})
    children = await db.cash_flows.find({"parent_id": flow_id}, {"_id": 0}).to_list(100)
    all_snapshots = ([current] if current else []) + children
    
    if delete_linked:
        await db.cash_flows.delete_many({"parent_id": flow_id})
    else:
        # Orphan children (remove parent_id)
        await db.cash_flows.update_many(
            {"parent_id": flow_id},
            {"$set": {"parent_id": None}}
        )
    
    result = await db.cash_flows.delete_one({"id": flow_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cash flow not found")
    
    await push_undo(
        "delete", "cash_flows", [flow_id], previous_data=all_snapshots,
        description=f"Delete: {current.get('label', '') if current else 'flow'}",
        side_effects={"delete_linked": delete_linked, "orphaned_child_ids": [c["id"] for c in children] if not delete_linked else []}
    )
    
    return {"message": "Cash flow deleted"}

# ============== FLOW OCCURRENCE ROUTES ==============
@api_router.get("/flow-occurrences")
async def get_flow_occurrences(month: Optional[str] = None, flow_id: Optional[str] = None):
    """Get occurrence records (actuals + variance actions). Filter by month and/or flow_id."""
    query = {}
    if month:
        query["month"] = month
    if flow_id:
        query["flow_id"] = flow_id
    occurrences = await db.flow_occurrences.find(query, {"_id": 0}).to_list(1000)
    return occurrences

@api_router.put("/flow-occurrences")
async def set_flow_occurrence(update: FlowOccurrenceUpdate):
    """Record an actual amount for a flow occurrence.
    
    Variance = planned - actual.
    If variance_action = 'carry_forward': creates a one-time flow for the difference in next month.
    If variance_action = 'write_off': difference is ignored.
    Pushes full undo state including occurrence + carryover flows.
    """
    # Snapshot previous state for undo
    prev_occurrence = await db.flow_occurrences.find_one(
        {"flow_id": update.flow_id, "month": update.month}, {"_id": 0}
    )
    
    # Snapshot existing carryovers that will be deleted
    existing_carryovers = await db.cash_flows.find({
        "carryover_from": update.flow_id,
        "carryover_month": update.month
    }, {"_id": 0}).to_list(100)
    
    # Upsert the occurrence record
    update_fields = {}
    if update.actual_amount is not None:
        update_fields["actual_amount"] = update.actual_amount
    if update.variance_action is not None:
        update_fields["variance_action"] = update.variance_action
    
    if prev_occurrence:
        await db.flow_occurrences.update_one(
            {"flow_id": update.flow_id, "month": update.month},
            {"$set": update_fields}
        )
    else:
        occ = FlowOccurrence(
            flow_id=update.flow_id,
            month=update.month,
            actual_amount=update.actual_amount,
            variance_action=update.variance_action,
        )
        await db.flow_occurrences.insert_one(occ.model_dump())
    
    # Remove any old carryover for this flow+month first
    await db.cash_flows.delete_many({
        "carryover_from": update.flow_id,
        "carryover_month": update.month
    })
    
    # Handle carry_forward: create a flow for the variance in next month
    created_carryover_ids = []
    if update.variance_action == "carry_forward" and update.actual_amount is not None:
        original = await db.cash_flows.find_one({"id": update.flow_id}, {"_id": 0})
        if original:
            # Get planned amount for this occurrence
            planned = original["amount"]
            rec_mode = original.get("recurrence_mode", "repeat")
            rec_count = original.get("recurrence_count")
            if rec_mode == "distribute" and rec_count and rec_count > 0:
                planned = round(planned / rec_count, 2)
            
            variance = planned - update.actual_amount
            
            if abs(variance) > 0.01:
                year, mon = update.month.split("-")
                next_date = date(int(year), int(mon), 1) + relativedelta(months=1)
                next_month_str = next_date.strftime("%Y-%m")
                
                carryover = CashFlow(
                    label=f"{original['label']} (variance carryover)",
                    amount=round(variance, 2),
                    date=f"{next_month_str}-01",
                    category=original.get("category", "Expense"),
                    certainty="Materialized",
                    recurrence="none",
                    recurrence_mode="repeat",
                    entity_id=original.get("entity_id", ""),
                    carryover_from=update.flow_id,
                    carryover_month=update.month,
                )
                await db.cash_flows.insert_one(carryover.model_dump())
                created_carryover_ids.append(carryover.id)
    
    # Push undo with full dependency chain
    await push_undo(
        "record_actual", "flow_occurrences",
        [update.flow_id],
        description=f"Actual: {update.flow_id[:8]}... {update.month}",
        side_effects={
            "flow_id": update.flow_id,
            "month": update.month,
            "previous_occurrence": prev_occurrence,
            "deleted_carryovers": existing_carryovers,
            "created_carryover_ids": created_carryover_ids,
        }
    )
    
    # Build response with useful info
    response = {"status": "ok"}
    if created_carryover_ids and update.actual_amount is not None:
        original = await db.cash_flows.find_one({"id": update.flow_id}, {"_id": 0})
        if original:
            resp_planned = original["amount"]
            rec_mode = original.get("recurrence_mode", "repeat")
            rec_count = original.get("recurrence_count")
            if rec_mode == "distribute" and rec_count and rec_count > 0:
                resp_planned = round(resp_planned / rec_count, 2)
            resp_variance = resp_planned - update.actual_amount
            year, mon = update.month.split("-")
            next_date = date(int(year), int(mon), 1) + relativedelta(months=1)
            response["carryover_info"] = {
                "target_month": next_date.strftime("%b %Y"),
                "amount": round(resp_variance, 2),
            }
    
    return response

@api_router.delete("/flow-occurrences")
async def clear_flow_occurrence(flow_id: str, month: str):
    """Clear actual recording for a flow occurrence (revert to planned). Pushes undo."""
    # Snapshot for undo
    prev_occurrence = await db.flow_occurrences.find_one(
        {"flow_id": flow_id, "month": month}, {"_id": 0}
    )
    existing_carryovers = await db.cash_flows.find({
        "carryover_from": flow_id,
        "carryover_month": month
    }, {"_id": 0}).to_list(100)
    
    await db.flow_occurrences.delete_one({"flow_id": flow_id, "month": month})
    await db.cash_flows.delete_many({
        "carryover_from": flow_id,
        "carryover_month": month
    })
    
    # Push undo to restore previous state
    if prev_occurrence:
        await push_undo(
            "record_actual", "flow_occurrences",
            [flow_id],
            description=f"Clear actual: {flow_id[:8]}... {month}",
            side_effects={
                "flow_id": flow_id,
                "month": month,
                "previous_occurrence": prev_occurrence,
                "deleted_carryovers": existing_carryovers,
                "created_carryover_ids": [],
            }
        )
    
    return {"status": "ok"}

# ============== SETTINGS ROUTES ==============
@api_router.get("/settings", response_model=Settings)
async def get_settings():
    settings = await db.settings.find_one({"id": "settings"}, {"_id": 0})
    if not settings:
        default = Settings()
        await db.settings.insert_one(default.model_dump())
        return default
    return settings

@api_router.put("/settings", response_model=Settings)
async def update_settings(update: SettingsUpdate):
    result = await db.settings.find_one_and_update(
        {"id": "settings"},
        {"$set": {"safety_buffer": update.safety_buffer}},
        upsert=True, return_document=True, projection={"_id": 0}
    )
    return result

# ============== PROJECTION ENGINE ==============
def expand_recurring_flows(flows: List[dict], start_date: date, end_date: date) -> List[dict]:
    """Expand recurring flows. Supports monthly/quarterly recurrence and repeat/distribute modes."""
    expanded = []
    
    for flow in flows:
        flow_date = date.fromisoformat(flow["date"][:10])
        flow_id = flow.get("id", "")
        recurrence = flow.get("recurrence", "none")
        recurrence_mode = flow.get("recurrence_mode", "repeat")
        
        if recurrence == "none":
            if start_date <= flow_date <= end_date:
                expanded.append({
                    "date": flow_date,
                    "amount": flow["amount"],
                    "label": flow["label"],
                    "certainty": flow["certainty"],
                    "category": flow["category"],
                    "entity_id": flow.get("entity_id", ""),
                    "flow_id": flow_id,
                    "parent_id": flow.get("parent_id"),
                    "is_percentage": flow.get("is_percentage", False),
                    "carryover_from": flow.get("carryover_from"),
                })
        else:
            # Monthly or quarterly
            interval_months = 1 if recurrence == "monthly" else 3
            current = flow_date
            count = 0
            max_count = flow.get("recurrence_count") or 999
            end_rec = date.fromisoformat(flow["recurrence_end"][:10]) if flow.get("recurrence_end") else end_date
            
            # Calculate distribute amounts if needed
            total_amount = flow["amount"]
            if recurrence_mode == "distribute" and max_count < 999:
                per_period = round(total_amount / max_count, 2)
                last_period = round(total_amount - per_period * (max_count - 1), 2)
            else:
                per_period = total_amount
                last_period = total_amount
            
            while current <= min(end_date, end_rec) and count < max_count:
                if current >= start_date:
                    # For distribute: last period gets rounding remainder
                    if recurrence_mode == "distribute" and max_count < 999:
                        period_amount = last_period if count == max_count - 1 else per_period
                    else:
                        period_amount = total_amount
                    
                    expanded.append({
                        "date": current,
                        "amount": period_amount,
                        "label": flow["label"],
                        "certainty": flow["certainty"],
                        "category": flow["category"],
                        "entity_id": flow.get("entity_id", ""),
                        "flow_id": flow_id,
                        "parent_id": flow.get("parent_id"),
                        "is_percentage": flow.get("is_percentage", False),
                    })
                count += 1
                current = flow_date + relativedelta(months=count * interval_months)
    
    return expanded

def get_certainty_levels(scenario: str) -> List[str]:
    return {
        "committed": ["Materialized"],
        "likely": ["Materialized", "Sure to happen"],
        "extended": ["Materialized", "Sure to happen", "50/50"],
        "full": ["Materialized", "Sure to happen", "50/50", "Idea"]
    }.get(scenario, ["Materialized"])

@api_router.get("/projection")
async def get_projection(
    scenario: str = "likely",
    entity_id: Optional[str] = Query(None, description="Filter by entity"),
    horizon: int = Query(12, description="Projection horizon in months (12, 24, or 36)")
):
    """Single projection engine - all UI components use this."""
    # Validate horizon
    if horizon not in [12, 24, 36]:
        horizon = 12
    
    # Get bank accounts (state)
    acc_query = {"entity_id": entity_id} if entity_id else {}
    accounts = await db.bank_accounts.find(acc_query, {"_id": 0}).to_list(100)
    cash_now = sum(acc.get("amount", 0) for acc in accounts)
    
    # Get cash flows (events)
    flow_query = {"entity_id": entity_id} if entity_id else {}
    flows = await db.cash_flows.find(flow_query, {"_id": 0}).to_list(1000)
    
    # Calculate dynamic amounts for percentage-based flows
    flows_with_amounts = []
    for f in flows:
        flows_with_amounts.append(await get_flow_with_dynamic_amount(f))
    
    # Get settings
    settings = await db.settings.find_one({"id": "settings"}, {"_id": 0})
    safety_buffer = settings.get("safety_buffer", 50000) if settings else 50000
    
    # Projection based on horizon
    today = date.today()
    start_of_month = today.replace(day=1)
    end_date = start_of_month + relativedelta(months=horizon)
    
    # Filter by certainty
    certainty_levels = get_certainty_levels(scenario)
    filtered = [f for f in flows_with_amounts if f.get("certainty") in certainty_levels]
    
    # Get actuals — when recorded, projection uses actual amount instead of planned
    all_occs = await db.flow_occurrences.find({}, {"_id": 0}).to_list(1000)
    actuals_map = {}  # (flow_id, month) -> actual_amount
    for occ in all_occs:
        if occ.get("actual_amount") is not None:
            actuals_map[(occ["flow_id"], occ["month"])] = occ["actual_amount"]
    
    # Expand recurring
    expanded = expand_recurring_flows(filtered, start_of_month, end_date)
    
    # Apply actuals overlay: replace planned with actual where recorded
    for ef in expanded:
        fid = ef.get("flow_id", "")
        mkey = ef["date"].strftime("%Y-%m")
        if (fid, mkey) in actuals_map:
            ef["amount"] = actuals_map[(fid, mkey)]
    
    # Group by month
    months_data = {}
    for i in range(horizon):
        m = start_of_month + relativedelta(months=i)
        key = m.strftime("%Y-%m")
        months_data[key] = {
            "month": key,
            "month_label": m.strftime("%b %Y"),
            "inflows": 0.0,
            "outflows": 0.0
        }
    
    for flow in expanded:
        key = flow["date"].strftime("%Y-%m")
        if key in months_data:
            if flow["amount"] > 0:
                months_data[key]["inflows"] += flow["amount"]
            else:
                months_data[key]["outflows"] += abs(flow["amount"])
    
    # Calculate projection
    months = []
    closing = cash_now
    lowest_cash = cash_now
    lowest_cash_month = start_of_month.strftime("%b %Y")
    highest_pressure_month = start_of_month.strftime("%b %Y")
    highest_pressure = 0.0
    first_watch_month = None
    first_danger_month = None
    
    for key in sorted(months_data.keys()):
        data = months_data[key]
        net = data["inflows"] - data["outflows"]
        closing += net
        
        if closing >= safety_buffer:
            status = "Good"
        elif closing >= 0:
            status = "Watch"
            if first_watch_month is None:
                first_watch_month = data["month_label"]
        else:
            status = "Danger"
            if first_danger_month is None:
                first_danger_month = data["month_label"]
        
        if closing < lowest_cash:
            lowest_cash = closing
            lowest_cash_month = data["month_label"]
        
        if data["outflows"] > highest_pressure:
            highest_pressure = data["outflows"]
            highest_pressure_month = data["month_label"]
        
        months.append(MonthProjection(
            month=data["month"],
            month_label=data["month_label"],
            inflows=round(data["inflows"], 2),
            outflows=round(data["outflows"], 2),
            net=round(net, 2),
            closing_cash=round(closing, 2),
            status=status
        ))
    
    overall_status = "Danger" if lowest_cash < 0 else ("Watch" if lowest_cash < safety_buffer else "Good")
    
    return ProjectionResponse(
        cash_now=round(cash_now, 2),
        lowest_cash=round(lowest_cash, 2),
        lowest_cash_month=lowest_cash_month,
        highest_pressure_month=highest_pressure_month,
        first_watch_month=first_watch_month,
        first_danger_month=first_danger_month,
        overall_status=overall_status,
        safety_buffer=safety_buffer,
        months=months
    )


@api_router.get("/projection/matrix")
async def get_projection_matrix(
    scenario: str = "likely",
    entity_id: Optional[str] = Query(None),
    horizon: int = Query(12)
):
    """Matrix data derived from the SAME projection engine. No independent computation."""
    if horizon not in [12, 24, 36]:
        horizon = 12
    
    # Same flow fetching as main projection
    flow_query = {"entity_id": entity_id} if entity_id else {}
    flows = await db.cash_flows.find(flow_query, {"_id": 0}).to_list(1000)
    
    flows_with_amounts = []
    for f in flows:
        flows_with_amounts.append(await get_flow_with_dynamic_amount(f))
    
    certainty_levels = get_certainty_levels(scenario)
    filtered = [f for f in flows_with_amounts if f.get("certainty") in certainty_levels]
    
    # Same actuals handling as main projection
    all_occs = await db.flow_occurrences.find({}, {"_id": 0}).to_list(1000)
    actuals_map = {}
    for occ in all_occs:
        if occ.get("actual_amount") is not None:
            actuals_map[(occ["flow_id"], occ["month"])] = occ["actual_amount"]
    
    today = date.today()
    start_of_month = today.replace(day=1)
    end_date = start_of_month + relativedelta(months=horizon)
    
    # Same expand function
    expanded = expand_recurring_flows(filtered, start_of_month, end_date)
    
    # Store planned amounts before actuals overlay
    planned_map = {}  # (flow_id, month) -> planned_amount
    for ef in expanded:
        fid = ef.get("flow_id", "")
        mkey = ef["date"].strftime("%Y-%m")
        if fid:
            planned_map[(fid, mkey)] = ef["amount"]
    
    # Apply actuals overlay
    for ef in expanded:
        fid = ef.get("flow_id", "")
        mkey = ef["date"].strftime("%Y-%m")
        if (fid, mkey) in actuals_map:
            ef["amount"] = actuals_map[(fid, mkey)]
    
    # Build month keys
    month_keys = []
    for i in range(horizon):
        m = start_of_month + relativedelta(months=i)
        month_keys.append({
            "key": m.strftime("%Y-%m"),
            "label": m.strftime("%b %Y")
        })
    
    # Group expanded flows by flow_id + month
    flow_month_map = {}
    flow_info = {}
    
    for ef in expanded:
        fid = ef.get("flow_id", "")
        if not fid:
            continue
        mkey = ef["date"].strftime("%Y-%m")
        
        if fid not in flow_month_map:
            flow_month_map[fid] = {}
            # Use planned amount to determine revenue/expense classification
            planned_amt = planned_map.get((fid, mkey), ef["amount"])
            flow_info[fid] = {
                "flow_id": fid,
                "label": ef["label"],
                "category": ef["category"],
                "is_revenue": planned_amt > 0,
                "parent_id": ef.get("parent_id"),
                "is_percentage": ef.get("is_percentage", False),
            }
        
        flow_month_map[fid][mkey] = flow_month_map[fid].get(mkey, 0) + ef["amount"]
    
    # Build rows: separate revenues and expenses, exclude children (show net on parent)
    revenue_rows = []
    expense_rows = []
    
    # Build a priority lookup from raw flows (NOT from engine, pure metadata)
    flow_priority_map = {f.get("id", ""): f.get("priority") for f in flows}
    
    for fid, info in flow_info.items():
        cells = {}
        for mk in month_keys:
            amt = flow_month_map[fid].get(mk["key"])
            if amt is not None:
                planned = planned_map.get((fid, mk["key"]))
                actual = actuals_map.get((fid, mk["key"]))
                cell_data = {"amount": round(amt, 2)}
                if actual is not None:
                    cell_data["actual"] = round(actual, 2)
                    cell_data["planned"] = round(planned, 2) if planned is not None else round(amt, 2)
                    cell_data["has_actual"] = True
                else:
                    cell_data["has_actual"] = False
                cells[mk["key"]] = cell_data
        
        row = {
            "flow_id": fid,
            "label": info["label"],
            "category": info["category"],
            "parent_id": info["parent_id"],
            "is_percentage": info["is_percentage"],
            "cells": cells,
            "row_total": round(sum(c.get("amount", 0) for c in cells.values()), 2),
            "priority": flow_priority_map.get(fid),
        }
        
        if info["is_revenue"]:
            revenue_rows.append(row)
        else:
            expense_rows.append(row)
    
    # Net per month (from same expanded data — guaranteed match)
    net_per_month = {}
    revenue_per_month = {}
    cost_per_month = {}
    for mk in month_keys:
        net_per_month[mk["key"]] = 0.0
        revenue_per_month[mk["key"]] = 0.0
        cost_per_month[mk["key"]] = 0.0
    for ef in expanded:
        mkey = ef["date"].strftime("%Y-%m")
        if mkey in net_per_month:
            net_per_month[mkey] += ef["amount"]
            if ef["amount"] > 0:
                revenue_per_month[mkey] += ef["amount"]
            else:
                cost_per_month[mkey] += abs(ef["amount"])
    net_per_month = {k: round(v, 2) for k, v in net_per_month.items()}
    revenue_per_month = {k: round(v, 2) for k, v in revenue_per_month.items()}
    cost_per_month = {k: round(v, 2) for k, v in cost_per_month.items()}
    
    # Cash balance per month (starting cash + cumulative net — engine-driven)
    acc_query = {"entity_id": entity_id} if entity_id else {}
    accounts = await db.bank_accounts.find(acc_query, {"_id": 0}).to_list(100)
    cash_now = sum(acc.get("amount", 0) for acc in accounts)
    
    cash_balance_per_month = {}
    running = cash_now
    for mk in month_keys:
        running += net_per_month.get(mk["key"], 0)
        cash_balance_per_month[mk["key"]] = round(running, 2)
    
    # Horizon totals — computed from engine data, never by frontend
    total_revenue = round(sum(revenue_per_month.values()), 2)
    total_cost = round(sum(cost_per_month.values()), 2)
    total_net = round(sum(net_per_month.values()), 2)
    
    return {
        "months": month_keys,
        "revenue_rows": revenue_rows,
        "expense_rows": expense_rows,
        "net_per_month": net_per_month,
        "revenue_per_month": revenue_per_month,
        "cost_per_month": cost_per_month,
        "cash_balance_per_month": cash_balance_per_month,
        "cash_now": round(cash_now, 2),
        "total_revenue": total_revenue,
        "total_cost": total_cost,
        "total_net": total_net,
    }


@api_router.get("/projection/drivers")
async def get_negative_month_drivers(
    scenario: str = "likely",
    entity_id: Optional[str] = Query(None),
    horizon: int = Query(12)
):
    """Top drivers of negative months. Uses projection engine values only. Aggregates by flow label."""
    if horizon not in [12, 24, 36]:
        horizon = 12
    
    flow_query = {"entity_id": entity_id} if entity_id else {}
    flows = await db.cash_flows.find(flow_query, {"_id": 0}).to_list(1000)
    flows_with_amounts = []
    for f in flows:
        flows_with_amounts.append(await get_flow_with_dynamic_amount(f))
    
    certainty_levels = get_certainty_levels(scenario)
    filtered = [f for f in flows_with_amounts if f.get("certainty") in certainty_levels]
    
    all_occs = await db.flow_occurrences.find({}, {"_id": 0}).to_list(1000)
    actuals_map = {}
    for occ in all_occs:
        if occ.get("actual_amount") is not None:
            actuals_map[(occ["flow_id"], occ["month"])] = occ["actual_amount"]
    
    today = date.today()
    start_of_month = today.replace(day=1)
    end_date = start_of_month + relativedelta(months=horizon)
    expanded = expand_recurring_flows(filtered, start_of_month, end_date)
    
    for ef in expanded:
        fid = ef.get("flow_id", "")
        mkey = ef["date"].strftime("%Y-%m")
        if (fid, mkey) in actuals_map:
            ef["amount"] = actuals_map[(fid, mkey)]
    
    # Group by month, compute net
    months_data = {}
    for i in range(horizon):
        m = start_of_month + relativedelta(months=i)
        key = m.strftime("%Y-%m")
        months_data[key] = {"flows": [], "net": 0.0, "label": m.strftime("%b %Y")}
    
    for ef in expanded:
        mkey = ef["date"].strftime("%Y-%m")
        if mkey in months_data:
            months_data[mkey]["flows"].append(ef)
            months_data[mkey]["net"] += ef["amount"]
    
    # For each negative month, aggregate negative contributors by label
    acc_query = {"entity_id": entity_id} if entity_id else {}
    accounts = await db.bank_accounts.find(acc_query, {"_id": 0}).to_list(100)
    cash_now = sum(acc.get("amount", 0) for acc in accounts)
    
    running = cash_now
    result = []
    for key in sorted(months_data.keys()):
        md = months_data[key]
        running += md["net"]
        
        if md["net"] >= 0:
            continue
        
        # Aggregate only negative flows by label
        label_agg = {}
        for ef in md["flows"]:
            if ef["amount"] >= 0:
                continue
            lbl = ef["label"]
            if lbl not in label_agg:
                label_agg[lbl] = {"label": lbl, "total": 0.0, "count": 0, "category": ef["category"]}
            label_agg[lbl]["total"] += ef["amount"]
            label_agg[lbl]["count"] += 1
        
        # Sort by absolute impact, top 3
        sorted_drivers = sorted(label_agg.values(), key=lambda x: x["total"])[:3]
        drivers = [
            {
                "label": d["label"],
                "amount": round(d["total"], 2),
                "count": d["count"],
                "category": d["category"],
            }
            for d in sorted_drivers
        ]
        
        result.append({
            "month": key,
            "month_label": md["label"],
            "net": round(md["net"], 2),
            "cash_balance": round(running, 2),
            "drivers": drivers,
        })
    
    return {"negative_months": result}


@api_router.get("/projection/scenario-delta")
async def get_scenario_delta(
    entity_id: Optional[str] = Query(None),
    horizon: int = Query(12)
):
    """Gap = Likely cash_balance - Committed cash_balance per month. Uses same projection engine."""
    if horizon not in [12, 24, 36]:
        horizon = 12
    
    # Fetch both projections from same engine
    # Committed
    committed = await get_projection(scenario="committed", entity_id=entity_id, horizon=horizon)
    likely = await get_projection(scenario="likely", entity_id=entity_id, horizon=horizon)
    
    months = []
    for cm, lm in zip(committed.months, likely.months):
        gap_net = round(lm.net - cm.net, 2)
        gap_balance = round(lm.closing_cash - cm.closing_cash, 2)
        months.append({
            "month": cm.month,
            "month_label": cm.month_label,
            "committed_net": cm.net,
            "likely_net": lm.net,
            "gap_net": gap_net,
            "committed_balance": cm.closing_cash,
            "likely_balance": lm.closing_cash,
            "gap_balance": gap_balance,
        })
    
    total_gap = round(sum(m["gap_net"] for m in months), 2)
    
    return {
        "months": months,
        "total_gap_net": total_gap,
        "committed_runway": next(
            (i + 1 for i, m in enumerate(committed.months) if m.closing_cash < 0), None
        ),
        "likely_runway": next(
            (i + 1 for i, m in enumerate(likely.months) if m.closing_cash < 0), None
        ),
    }


@api_router.get("/projection/runway")
async def get_cash_runway(
    entity_id: Optional[str] = Query(None),
    horizon: int = Query(36)
):
    """Cash runway = first month where cash_balance < 0. Returns months from now + breach month."""
    if horizon not in [12, 24, 36]:
        horizon = 36
    
    result = {}
    for sc in ["committed", "likely"]:
        proj = await get_projection(scenario=sc, entity_id=entity_id, horizon=horizon)
        breach_idx = None
        breach_month = None
        for i, m in enumerate(proj.months):
            if m.closing_cash < 0:
                breach_idx = i + 1
                breach_month = m.month_label
                break
        result[sc] = {
            "months_until_breach": breach_idx,
            "breach_month": breach_month,
            "runway_months": breach_idx if breach_idx else horizon,
            "is_safe": breach_idx is None,
        }
    
    return result


@api_router.get("/month-details/{month}")
async def get_month_details(
    month: str,
    scenario: str = "likely",
    entity_id: Optional[str] = None
):
    flow_query = {"entity_id": entity_id} if entity_id else {}
    flows = await db.cash_flows.find(flow_query, {"_id": 0}).to_list(1000)
    
    # Dynamic amounts
    flows_with_amounts = []
    for f in flows:
        flows_with_amounts.append(await get_flow_with_dynamic_amount(f))
    
    certainty_levels = get_certainty_levels(scenario)
    filtered = [f for f in flows_with_amounts if f.get("certainty") in certainty_levels]
    
    # Actuals
    all_occs = await db.flow_occurrences.find({}, {"_id": 0}).to_list(1000)
    actuals_map = {}
    occ_detail_map = {}  # (flow_id, month) -> full occurrence record
    for occ in all_occs:
        key = (occ["flow_id"], occ["month"])
        if occ.get("actual_amount") is not None:
            actuals_map[key] = occ["actual_amount"]
        occ_detail_map[key] = occ
    
    year, mon = month.split("-")
    start = date(int(year), int(mon), 1)
    end = start + relativedelta(months=1) - relativedelta(days=1)
    
    # Use the same expand function
    expanded = expand_recurring_flows(filtered, start, end)
    
    # Apply actuals overlay
    for ef in expanded:
        fid = ef.get("flow_id", "")
        mkey = ef["date"].strftime("%Y-%m")
        if (fid, mkey) in actuals_map:
            ef["_planned_amount"] = ef["amount"]
            ef["amount"] = actuals_map[(fid, mkey)]
    
    month_flows = [f for f in expanded if f["date"].strftime("%Y-%m") == month]
    outflows = sorted([f for f in month_flows if f["amount"] < 0], key=lambda x: x["amount"])
    
    recurring_labels = {f["label"] for f in filtered if f.get("recurrence") in ["monthly", "quarterly"]}
    recurring = [f for f in month_flows if f["label"] in recurring_labels]
    
    return {
        "month": month,
        "top_outflows": [{"label": f["label"], "amount": f["amount"], "category": f["category"]} for f in outflows[:5]],
        "recurring_burdens": [{"label": f["label"], "amount": f["amount"], "category": f["category"]} for f in recurring],
        "all_flows": [
            {
                "flow_id": f.get("flow_id", ""),
                "label": f["label"], 
                "amount": round(f["amount"], 2), 
                "planned_amount": round(f.get("_planned_amount", f["amount"]), 2),
                "actual_amount": actuals_map.get((f.get("flow_id", ""), month)),
                "variance_action": occ_detail_map.get((f.get("flow_id", ""), month), {}).get("variance_action"),
                "category": f["category"], 
                "date": f["date"].isoformat(),
                "is_carryover": bool(f.get("carryover_from")),
            } 
            for f in month_flows
        ]
    }

@api_router.get("/variance-summary")
async def get_variance_summary(entity_id: Optional[str] = None):
    """Global variance tracking: total variance, total carried forward, total written off."""
    query = {}
    if entity_id:
        # Get flow IDs for this entity
        entity_flows = await db.cash_flows.find({"entity_id": entity_id}, {"_id": 0, "id": 1}).to_list(1000)
        flow_ids = [f["id"] for f in entity_flows]
        query["flow_id"] = {"$in": flow_ids}
    
    all_occs = await db.flow_occurrences.find(query, {"_id": 0}).to_list(1000)
    
    # Get planned amounts for variance computation
    flow_ids_needed = list({occ["flow_id"] for occ in all_occs if occ.get("actual_amount") is not None})
    flows_map = {}
    if flow_ids_needed:
        flows = await db.cash_flows.find({"id": {"$in": flow_ids_needed}}, {"_id": 0}).to_list(1000)
        for f in flows:
            flows_map[f["id"]] = f
    
    total_variance = 0.0
    total_underperformance = 0.0
    total_overperformance = 0.0
    total_carried = 0.0
    total_written_off = 0.0
    actuals_count = 0
    
    for occ in all_occs:
        if occ.get("actual_amount") is None:
            continue
        actuals_count += 1
        flow = flows_map.get(occ["flow_id"])
        if not flow:
            continue
        planned = flow["amount"]
        rec_mode = flow.get("recurrence_mode", "repeat")
        rec_count = flow.get("recurrence_count")
        if rec_mode == "distribute" and rec_count and rec_count > 0:
            planned = round(planned / rec_count, 2)
        
        variance = planned - occ["actual_amount"]
        abs_var = abs(variance)
        total_variance += abs_var
        
        # Under = actual < planned (for revenue: less came in; for expense: less went out)
        if abs(variance) > 0.01:
            if occ["actual_amount"] < abs(planned):
                total_underperformance += abs_var
            else:
                total_overperformance += abs_var
        
        if occ.get("variance_action") == "carry_forward":
            total_carried += abs_var
        elif occ.get("variance_action") == "write_off":
            total_written_off += abs_var
    
    net_variance_impact = round(total_overperformance - total_underperformance, 2)
    
    return {
        "actuals_recorded": actuals_count,
        "total_variance": round(total_variance, 2),
        "total_underperformance": round(total_underperformance, 2),
        "total_overperformance": round(total_overperformance, 2),
        "total_carried_forward": round(total_carried, 2),
        "total_written_off": round(total_written_off, 2),
        "net_variance_impact": net_variance_impact,
    }


@api_router.get("/")
async def root():
    return {"message": "Cash Piloting Dashboard API"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
