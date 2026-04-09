from fastapi import FastAPI, APIRouter, HTTPException
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

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Enums
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
    entity_id: str = ""  # Default empty for backward compatibility
    entity: str = ""  # Legacy field
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
    date: str
    category: Category = Category.EXPENSE
    certainty: Certainty = Certainty.MATERIALIZED
    recurrence: Recurrence = Recurrence.NONE
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity_id: str = ""  # Default empty for backward compatibility
    entity: str = ""  # Legacy field
    parent_id: Optional[str] = None  # For linked flows
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
    # For percentage-based linked flows
    is_percentage: bool = False
    percentage_of_parent: Optional[float] = None  # e.g., 40 for 40%

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

class CashFlowWithChildren(BaseModel):
    flow: dict
    linked_flows: List[dict] = []

class CashFlowBatchCreate(BaseModel):
    """Create a parent flow with optional linked flows"""
    parent: CashFlowCreate
    linked: List[CashFlowCreate] = []

# ============== SETTINGS MODEL ==============
class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = "settings"
    safety_buffer: float = 50000.0

class SettingsUpdate(BaseModel):
    safety_buffer: float

# ============== PROJECTION MODELS ==============
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
    highest_pressure_month: str
    first_watch_month: Optional[str] = None
    first_danger_month: Optional[str] = None
    overall_status: str
    safety_buffer: float
    months: List[MonthProjection]

# ============== ENTITY ROUTES ==============
@api_router.get("/entities", response_model=List[Entity])
async def get_entities():
    entities = await db.entities.find({}, {"_id": 0}).to_list(100)
    return entities

@api_router.post("/entities", response_model=Entity)
async def create_entity(entity: EntityCreate):
    entity_obj = Entity(**entity.model_dump())
    doc = entity_obj.model_dump()
    await db.entities.insert_one(doc)
    return entity_obj

@api_router.put("/entities/{entity_id}", response_model=Entity)
async def update_entity(entity_id: str, update: EntityUpdate):
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid update data provided")
    
    result = await db.entities.find_one_and_update(
        {"id": entity_id},
        {"$set": update_data},
        return_document=True,
        projection={"_id": 0}
    )
    if not result:
        raise HTTPException(status_code=404, detail="Entity not found")
    return result

@api_router.delete("/entities/{entity_id}")
async def delete_entity(entity_id: str):
    # Check if entity has bank accounts or cash flows
    accounts_count = await db.bank_accounts.count_documents({"entity_id": entity_id})
    flows_count = await db.cash_flows.count_documents({"entity_id": entity_id})
    
    if accounts_count > 0 or flows_count > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot delete entity with {accounts_count} bank accounts and {flows_count} cash flows"
        )
    
    result = await db.entities.delete_one({"id": entity_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Entity not found")
    return {"message": "Entity deleted"}

# ============== BANK ACCOUNT ROUTES ==============
@api_router.get("/bank-accounts", response_model=List[BankAccount])
async def get_bank_accounts():
    accounts = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)
    return accounts

@api_router.post("/bank-accounts", response_model=BankAccount)
async def create_bank_account(account: BankAccountCreate):
    # Verify entity exists
    entity = await db.entities.find_one({"id": account.entity_id})
    if not entity:
        raise HTTPException(status_code=400, detail="Entity not found")
    
    account_obj = BankAccount(**account.model_dump())
    doc = account_obj.model_dump()
    await db.bank_accounts.insert_one(doc)
    return account_obj

@api_router.put("/bank-accounts/{account_id}", response_model=BankAccount)
async def update_bank_account(account_id: str, update: BankAccountUpdate):
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid update data provided")
    
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    result = await db.bank_accounts.find_one_and_update(
        {"id": account_id},
        {"$set": update_data},
        return_document=True,
        projection={"_id": 0}
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
@api_router.get("/cash-flows", response_model=List[CashFlow])
async def get_cash_flows():
    flows = await db.cash_flows.find({}, {"_id": 0}).to_list(1000)
    return flows

@api_router.get("/cash-flows/with-linked")
async def get_cash_flows_with_linked():
    """Get all cash flows grouped by parent-child relationships"""
    flows = await db.cash_flows.find({}, {"_id": 0}).to_list(1000)
    
    # Separate parent flows and linked flows
    parent_flows = [f for f in flows if f.get("parent_id") is None]
    linked_map = {}
    
    for f in flows:
        if f.get("parent_id"):
            parent_id = f["parent_id"]
            if parent_id not in linked_map:
                linked_map[parent_id] = []
            linked_map[parent_id].append(f)
    
    # Build result
    result = []
    for pf in parent_flows:
        result.append({
            "flow": pf,
            "linked_flows": linked_map.get(pf["id"], [])
        })
    
    # Sort by date descending
    result.sort(key=lambda x: x["flow"].get("date", ""), reverse=True)
    return result

@api_router.post("/cash-flows", response_model=CashFlow)
async def create_cash_flow(flow: CashFlowCreate):
    # Verify entity exists
    entity = await db.entities.find_one({"id": flow.entity_id})
    if not entity:
        raise HTTPException(status_code=400, detail="Entity not found")
    
    flow_obj = CashFlow(**flow.model_dump())
    doc = flow_obj.model_dump()
    await db.cash_flows.insert_one(doc)
    return flow_obj

@api_router.post("/cash-flows/batch")
async def create_cash_flow_batch(batch: CashFlowBatchCreate):
    """Create a parent flow with optional linked flows.
    
    Rules:
    - Linked flows inherit recurrence from parent (no independent recurrence)
    - Linked flows can be percentage-based (auto-calculated from parent amount)
    - Cannot have both fixed amount and percentage
    """
    # Verify entity exists
    entity = await db.entities.find_one({"id": batch.parent.entity_id})
    if not entity:
        raise HTTPException(status_code=400, detail="Entity not found")
    
    # Create parent flow
    parent_obj = CashFlow(**batch.parent.model_dump())
    parent_doc = parent_obj.model_dump()
    await db.cash_flows.insert_one(parent_doc)
    
    # Create linked flows - inherit recurrence from parent
    linked_results = []
    for linked in batch.linked:
        linked_data = linked.model_dump()
        linked_data["parent_id"] = parent_obj.id
        
        # Enforce recurrence inheritance from parent
        linked_data["recurrence"] = batch.parent.recurrence
        linked_data["recurrence_end"] = batch.parent.recurrence_end
        linked_data["recurrence_count"] = batch.parent.recurrence_count
        
        # Calculate amount if percentage-based
        if linked_data.get("is_percentage") and linked_data.get("percentage_of_parent"):
            pct = linked_data["percentage_of_parent"]
            parent_amount = abs(batch.parent.amount)
            # Percentage flows are typically costs (negative)
            linked_data["amount"] = -(parent_amount * pct / 100)
        
        linked_obj = CashFlow(**linked_data)
        linked_doc = linked_obj.model_dump()
        await db.cash_flows.insert_one(linked_doc)
        linked_results.append(linked_obj.model_dump())
    
    return {
        "parent": parent_obj.model_dump(),
        "linked": linked_results
    }

@api_router.put("/cash-flows/{flow_id}", response_model=CashFlow)
async def update_cash_flow(flow_id: str, update: CashFlowUpdate):
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No valid update data provided")
    
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    result = await db.cash_flows.find_one_and_update(
        {"id": flow_id},
        {"$set": update_data},
        return_document=True,
        projection={"_id": 0}
    )
    if not result:
        raise HTTPException(status_code=404, detail="Cash flow not found")
    
    # If this is a parent flow and amount changed, update percentage-based children
    if "amount" in update_data:
        children = await db.cash_flows.find(
            {"parent_id": flow_id, "is_percentage": True},
            {"_id": 0}
        ).to_list(100)
        
        for child in children:
            if child.get("percentage_of_parent"):
                new_amount = -(abs(update_data["amount"]) * child["percentage_of_parent"] / 100)
                await db.cash_flows.update_one(
                    {"id": child["id"]},
                    {"$set": {"amount": new_amount, "updated_at": datetime.now(timezone.utc).isoformat()}}
                )
    
    # If recurrence changed on parent, update all children
    if any(k in update_data for k in ["recurrence", "recurrence_end", "recurrence_count"]):
        recurrence_update = {}
        if "recurrence" in update_data:
            recurrence_update["recurrence"] = update_data["recurrence"]
        if "recurrence_end" in update_data:
            recurrence_update["recurrence_end"] = update_data["recurrence_end"]
        if "recurrence_count" in update_data:
            recurrence_update["recurrence_count"] = update_data["recurrence_count"]
        
        if recurrence_update:
            recurrence_update["updated_at"] = datetime.now(timezone.utc).isoformat()
            await db.cash_flows.update_many(
                {"parent_id": flow_id},
                {"$set": recurrence_update}
            )
    
    return result

@api_router.delete("/cash-flows/{flow_id}")
async def delete_cash_flow(flow_id: str, delete_linked: bool = False):
    # Check if this is a parent flow
    if delete_linked:
        # Delete all linked flows
        await db.cash_flows.delete_many({"parent_id": flow_id})
    
    result = await db.cash_flows.delete_one({"id": flow_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cash flow not found")
    return {"message": "Cash flow deleted"}

# ============== SETTINGS ROUTES ==============
@api_router.get("/settings", response_model=Settings)
async def get_settings():
    settings = await db.settings.find_one({"id": "settings"}, {"_id": 0})
    if not settings:
        default_settings = Settings()
        await db.settings.insert_one(default_settings.model_dump())
        return default_settings
    return settings

@api_router.put("/settings", response_model=Settings)
async def update_settings(update: SettingsUpdate):
    result = await db.settings.find_one_and_update(
        {"id": "settings"},
        {"$set": {"safety_buffer": update.safety_buffer}},
        upsert=True,
        return_document=True,
        projection={"_id": 0}
    )
    return result

# ============== PROJECTION LOGIC ==============
def expand_recurring_flows(flows: List[dict], start_date: date, end_date: date) -> List[dict]:
    """Expand recurring flows into individual monthly occurrences"""
    expanded = []
    
    for flow in flows:
        flow_date = date.fromisoformat(flow["date"][:10])
        
        if flow["recurrence"] == "none":
            if start_date <= flow_date <= end_date:
                expanded.append({
                    "date": flow_date,
                    "amount": flow["amount"],
                    "label": flow["label"],
                    "certainty": flow["certainty"],
                    "category": flow["category"]
                })
        else:
            current = flow_date
            count = 0
            max_count = flow.get("recurrence_count") or 999
            end_recurrence = date.fromisoformat(flow["recurrence_end"][:10]) if flow.get("recurrence_end") else end_date
            
            while current <= min(end_date, end_recurrence) and count < max_count:
                if current >= start_date:
                    expanded.append({
                        "date": current,
                        "amount": flow["amount"],
                        "label": flow["label"],
                        "certainty": flow["certainty"],
                        "category": flow["category"]
                    })
                count += 1
                current = flow_date + relativedelta(months=count)
    
    return expanded

def get_certainty_levels(scenario: str) -> List[str]:
    """Get certainty levels included in each scenario"""
    scenarios = {
        "committed": ["Materialized"],
        "likely": ["Materialized", "Sure to happen"],
        "extended": ["Materialized", "Sure to happen", "50/50"],
        "full": ["Materialized", "Sure to happen", "50/50", "Idea"]
    }
    return scenarios.get(scenario, ["Materialized"])

@api_router.get("/projection")
async def get_projection(scenario: str = "likely"):
    # Get bank accounts for starting cash
    accounts = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)
    cash_now = sum(acc.get("amount", 0) for acc in accounts)
    
    # Get cash flows
    flows = await db.cash_flows.find({}, {"_id": 0}).to_list(1000)
    
    # Get settings
    settings = await db.settings.find_one({"id": "settings"}, {"_id": 0})
    safety_buffer = settings.get("safety_buffer", 50000) if settings else 50000
    
    # Calculate projection for next 12 months
    today = date.today()
    start_of_month = today.replace(day=1)
    end_date = start_of_month + relativedelta(months=12)
    
    # Filter flows by certainty level
    certainty_levels = get_certainty_levels(scenario)
    filtered_flows = [f for f in flows if f.get("certainty") in certainty_levels]
    
    # Expand recurring flows
    expanded_flows = expand_recurring_flows(filtered_flows, start_of_month, end_date)
    
    # Group by month
    months_data = {}
    for i in range(12):
        month_date = start_of_month + relativedelta(months=i)
        month_key = month_date.strftime("%Y-%m")
        months_data[month_key] = {
            "month": month_key,
            "month_label": month_date.strftime("%b %Y"),
            "inflows": 0.0,
            "outflows": 0.0,
            "flows": []
        }
    
    for flow in expanded_flows:
        month_key = flow["date"].strftime("%Y-%m")
        if month_key in months_data:
            if flow["amount"] > 0:
                months_data[month_key]["inflows"] += flow["amount"]
            else:
                months_data[month_key]["outflows"] += abs(flow["amount"])
            months_data[month_key]["flows"].append(flow)
    
    # Calculate projections
    months = []
    closing = cash_now
    lowest_cash = cash_now
    lowest_cash_month = start_of_month.strftime("%b %Y")
    highest_pressure_month = start_of_month.strftime("%b %Y")
    highest_pressure = 0.0
    first_watch_month = None
    first_danger_month = None
    
    for month_key in sorted(months_data.keys()):
        data = months_data[month_key]
        net = data["inflows"] - data["outflows"]
        closing = closing + net
        
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
    
    if lowest_cash >= safety_buffer:
        overall_status = "Good"
    elif lowest_cash >= 0:
        overall_status = "Watch"
    else:
        overall_status = "Danger"
    
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

@api_router.get("/month-details/{month}")
async def get_month_details(month: str, scenario: str = "likely"):
    flows = await db.cash_flows.find({}, {"_id": 0}).to_list(1000)
    
    certainty_levels = get_certainty_levels(scenario)
    filtered_flows = [f for f in flows if f.get("certainty") in certainty_levels]
    
    year, mon = month.split("-")
    start_date = date(int(year), int(mon), 1)
    end_date = start_date + relativedelta(months=1) - relativedelta(days=1)
    
    expanded_flows = expand_recurring_flows(filtered_flows, start_date, end_date)
    
    month_flows = [f for f in expanded_flows if f["date"].strftime("%Y-%m") == month]
    outflows = [f for f in month_flows if f["amount"] < 0]
    outflows.sort(key=lambda x: x["amount"])
    
    recurring_labels = set()
    for f in filtered_flows:
        if f.get("recurrence") == "monthly":
            recurring_labels.add(f["label"])
    
    recurring_burdens = [f for f in month_flows if f["label"] in recurring_labels]
    
    return {
        "month": month,
        "top_outflows": [
            {"label": f["label"], "amount": f["amount"], "category": f["category"]}
            for f in outflows[:5]
        ],
        "recurring_burdens": [
            {"label": f["label"], "amount": f["amount"], "category": f["category"]}
            for f in recurring_burdens
        ],
        "all_flows": [
            {"label": f["label"], "amount": f["amount"], "category": f["category"], "date": f["date"].isoformat()}
            for f in month_flows
        ]
    }

@api_router.get("/")
async def root():
    return {"message": "Cash Piloting Dashboard API"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
