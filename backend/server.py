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
    OTHER = "Other"

class Certainty(str, Enum):
    MATERIALIZED = "Materialized"
    SURE = "Sure to happen"
    FIFTY_FIFTY = "50/50"
    IDEA = "Idea"

class Recurrence(str, Enum):
    NONE = "none"
    MONTHLY = "monthly"

# Models
class BankAccount(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    entity: str = ""
    label: str
    amount: float
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class BankAccountCreate(BaseModel):
    entity: str = ""
    label: str
    amount: float

class BankAccountUpdate(BaseModel):
    entity: Optional[str] = None
    label: Optional[str] = None
    amount: Optional[float] = None

class CashFlow(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    label: str
    amount: float  # positive = inflow, negative = outflow
    date: str  # ISO date string
    category: Category = Category.EXPENSE
    certainty: Certainty = Certainty.MATERIALIZED
    recurrence: Recurrence = Recurrence.NONE
    recurrence_end: Optional[str] = None  # ISO date string
    recurrence_count: Optional[int] = None
    entity: str = ""
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
    entity: str = ""

class CashFlowUpdate(BaseModel):
    label: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[str] = None
    category: Optional[Category] = None
    certainty: Optional[Certainty] = None
    recurrence: Optional[Recurrence] = None
    recurrence_end: Optional[str] = None
    recurrence_count: Optional[int] = None
    entity: Optional[str] = None

class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = "settings"
    safety_buffer: float = 50000.0

class SettingsUpdate(BaseModel):
    safety_buffer: float

class MonthProjection(BaseModel):
    month: str  # YYYY-MM
    month_label: str  # Jan 2026
    inflows: float
    outflows: float
    net: float
    closing_cash: float
    status: str  # Good, Watch, Danger

class ProjectionResponse(BaseModel):
    cash_now: float
    lowest_cash: float
    lowest_cash_month: str
    highest_pressure_month: str
    overall_status: str
    safety_buffer: float
    months: List[MonthProjection]

# Bank Account Routes
@api_router.get("/bank-accounts", response_model=List[BankAccount])
async def get_bank_accounts():
    accounts = await db.bank_accounts.find({}, {"_id": 0}).to_list(100)
    return accounts

@api_router.post("/bank-accounts", response_model=BankAccount)
async def create_bank_account(account: BankAccountCreate):
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

# Cash Flow Routes
@api_router.get("/cash-flows", response_model=List[CashFlow])
async def get_cash_flows():
    flows = await db.cash_flows.find({}, {"_id": 0}).to_list(1000)
    return flows

@api_router.post("/cash-flows", response_model=CashFlow)
async def create_cash_flow(flow: CashFlowCreate):
    flow_obj = CashFlow(**flow.model_dump())
    doc = flow_obj.model_dump()
    await db.cash_flows.insert_one(doc)
    return flow_obj

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
    return result

@api_router.delete("/cash-flows/{flow_id}")
async def delete_cash_flow(flow_id: str):
    result = await db.cash_flows.delete_one({"id": flow_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cash flow not found")
    return {"message": "Cash flow deleted"}

# Settings Routes
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

# Projection Route
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
            # Monthly recurrence
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
    
    for month_key in sorted(months_data.keys()):
        data = months_data[month_key]
        net = data["inflows"] - data["outflows"]
        closing = closing + net
        
        # Determine status
        if closing >= safety_buffer:
            status = "Good"
        elif closing >= 0:
            status = "Watch"
        else:
            status = "Danger"
        
        # Track lowest cash
        if closing < lowest_cash:
            lowest_cash = closing
            lowest_cash_month = data["month_label"]
        
        # Track highest pressure (largest outflow month)
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
    
    # Overall status based on lowest point
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
        overall_status=overall_status,
        safety_buffer=safety_buffer,
        months=months
    )

# Get flows for a specific month (for pressure panel)
@api_router.get("/month-details/{month}")
async def get_month_details(month: str, scenario: str = "likely"):
    flows = await db.cash_flows.find({}, {"_id": 0}).to_list(1000)
    
    certainty_levels = get_certainty_levels(scenario)
    filtered_flows = [f for f in flows if f.get("certainty") in certainty_levels]
    
    # Parse month
    year, mon = month.split("-")
    start_date = date(int(year), int(mon), 1)
    end_date = start_date + relativedelta(months=1) - relativedelta(days=1)
    
    expanded_flows = expand_recurring_flows(filtered_flows, start_date, end_date)
    
    # Sort by amount (largest outflows first)
    month_flows = [f for f in expanded_flows if f["date"].strftime("%Y-%m") == month]
    outflows = [f for f in month_flows if f["amount"] < 0]
    outflows.sort(key=lambda x: x["amount"])
    
    # Get recurring burdens (flows that have recurrence)
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
