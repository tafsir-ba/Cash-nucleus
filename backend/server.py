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
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity_id: str = ""
    entity: str = ""
    parent_id: Optional[str] = None
    is_percentage: bool = False
    percentage_of_parent: Optional[float] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CashFlowCreate(BaseModel):
    label: str
    amount: float
    date: str
    category: Category = Category.EXPENSE
    certainty: Certainty = Certainty.MATERIALIZED
    recurrence: Recurrence = Recurrence.NONE
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity_id: str
    parent_id: Optional[str] = None
    is_percentage: bool = False
    percentage_of_parent: Optional[float] = None

class CashFlowUpdate(BaseModel):
    label: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[str] = None
    category: Optional[Category] = None
    certainty: Optional[Certainty] = None
    recurrence: Optional[Recurrence] = None
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity_id: Optional[str] = None

class CashFlowBatchCreate(BaseModel):
    parent: CashFlowCreate
    linked: List[CashFlowCreate] = []

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
        # ENFORCE: Children inherit parent's recurrence
        data["recurrence"] = batch.parent.recurrence
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
    
    return {"parent": parent_obj.model_dump(), "linked": linked_results}

@api_router.put("/cash-flows/{flow_id}", response_model=CashFlow)
async def update_cash_flow(flow_id: str, update: CashFlowUpdate):
    """Update flow. Propagate changes to children for parent flows."""
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid update data")
    
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Get current flow to check if parent
    current = await db.cash_flows.find_one({"id": flow_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Cash flow not found")
    
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
        if any(k in update_data for k in ["recurrence", "recurrence_end", "recurrence_count"]):
            if "recurrence" in update_data:
                child_updates["recurrence"] = update_data["recurrence"]
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
    
    return result

@api_router.delete("/cash-flows/{flow_id}")
async def delete_cash_flow(flow_id: str, delete_linked: bool = False):
    """Delete flow. Optionally delete linked children or orphan them."""
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
    return {"message": "Cash flow deleted"}

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
    """Expand recurring flows. Supports monthly and quarterly recurrence."""
    expanded = []
    
    for flow in flows:
        flow_date = date.fromisoformat(flow["date"][:10])
        recurrence = flow.get("recurrence", "none")
        
        if recurrence == "none":
            if start_date <= flow_date <= end_date:
                expanded.append({
                    "date": flow_date,
                    "amount": flow["amount"],
                    "label": flow["label"],
                    "certainty": flow["certainty"],
                    "category": flow["category"],
                    "entity_id": flow.get("entity_id", "")
                })
        else:
            # Monthly or quarterly
            interval_months = 1 if recurrence == "monthly" else 3
            current = flow_date
            count = 0
            max_count = flow.get("recurrence_count") or 999
            end_rec = date.fromisoformat(flow["recurrence_end"][:10]) if flow.get("recurrence_end") else end_date
            
            while current <= min(end_date, end_rec) and count < max_count:
                if current >= start_date:
                    expanded.append({
                        "date": current,
                        "amount": flow["amount"],
                        "label": flow["label"],
                        "certainty": flow["certainty"],
                        "category": flow["category"],
                        "entity_id": flow.get("entity_id", "")
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
    entity_id: Optional[str] = Query(None, description="Filter by entity")
):
    """Single projection engine - all UI components use this."""
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
    
    # 12-month projection
    today = date.today()
    start_of_month = today.replace(day=1)
    end_date = start_of_month + relativedelta(months=12)
    
    # Filter by certainty
    certainty_levels = get_certainty_levels(scenario)
    filtered = [f for f in flows_with_amounts if f.get("certainty") in certainty_levels]
    
    # Expand recurring
    expanded = expand_recurring_flows(filtered, start_of_month, end_date)
    
    # Group by month
    months_data = {}
    for i in range(12):
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
        first_watch_month=first_watch_month,
        first_danger_month=first_danger_month,
        overall_status=overall_status,
        safety_buffer=safety_buffer,
        months=months
    )

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
    
    year, mon = month.split("-")
    start = date(int(year), int(mon), 1)
    end = start + relativedelta(months=1) - relativedelta(days=1)
    
    expanded = expand_recurring_flows(filtered, start, end)
    month_flows = [f for f in expanded if f["date"].strftime("%Y-%m") == month]
    
    outflows = sorted([f for f in month_flows if f["amount"] < 0], key=lambda x: x["amount"])
    
    recurring_labels = {f["label"] for f in filtered if f.get("recurrence") in ["monthly", "quarterly"]}
    recurring = [f for f in month_flows if f["label"] in recurring_labels]
    
    return {
        "month": month,
        "top_outflows": [{"label": f["label"], "amount": f["amount"], "category": f["category"]} for f in outflows[:5]],
        "recurring_burdens": [{"label": f["label"], "amount": f["amount"], "category": f["category"]} for f in recurring],
        "all_flows": [{"label": f["label"], "amount": f["amount"], "category": f["category"], "date": f["date"].isoformat()} for f in month_flows]
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
