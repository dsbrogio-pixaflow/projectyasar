from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import and_, case, extract, func, select
from sqlalchemy.orm import Session, aliased

from auth import get_current_user
from database import get_database_session
from models import Expense, InventoryMovement, Product, Sale, SaleItem


router = APIRouter(
    prefix="/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(get_current_user)],
)


class DashboardMonth(BaseModel):
    month: str
    inventory_entries: int
    inventory_exits: int
    units_sold: int
    expenses: Decimal


class DashboardResponse(BaseModel):
    current_stock_balance: int
    months: list[DashboardMonth]


def _next_month(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


@router.get("", response_model=DashboardResponse)
def get_dashboard(
    db: Session = Depends(get_database_session),
) -> DashboardResponse:
    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    current_month = today.replace(day=1)
    months: list[date] = []
    month = current_month
    for _ in range(11):
        if month.month == 1:
            month = date(month.year - 1, 12, 1)
        else:
            month = date(month.year, month.month - 1, 1)
    for _ in range(12):
        months.append(month)
        month = _next_month(month)
    start_date = months[0]
    end_date = _next_month(current_month)
    monthly_totals = {
        month.strftime("%Y-%m"): {
            "inventory_entries": 0,
            "inventory_exits": 0,
            "units_sold": 0,
            "expenses": Decimal("0.00"),
        }
        for month in months
    }

    movement = aliased(InventoryMovement)
    original = aliased(InventoryMovement)
    inventory_entry = case(
        (movement.movement_type == "in", movement.quantity),
        (
            and_(
                movement.movement_type == "reversal",
                original.movement_type == "out",
            ),
            movement.quantity,
        ),
        else_=0,
    )
    inventory_exit = case(
        (movement.movement_type == "out", movement.quantity),
        (
            and_(
                movement.movement_type == "reversal",
                original.movement_type == "in",
            ),
            movement.quantity,
        ),
        else_=0,
    )
    inventory_year = extract("year", movement.occurred_at)
    inventory_month = extract("month", movement.occurred_at)
    inventory_rows = db.execute(
        select(
            inventory_year,
            inventory_month,
            func.sum(inventory_entry),
            func.sum(inventory_exit),
        )
        .select_from(movement)
        .outerjoin(original, movement.reversal_of_id == original.id)
        .where(
            movement.occurred_at >= start_date,
            movement.occurred_at < end_date,
        )
        .group_by(inventory_year, inventory_month)
    )
    for year, month_number, entries, exits in inventory_rows:
        key = f"{int(year):04d}-{int(month_number):02d}"
        if key in monthly_totals:
            monthly_totals[key]["inventory_entries"] = int(entries or 0)
            monthly_totals[key]["inventory_exits"] = int(exits or 0)

    sale_year = extract("year", Sale.sold_at)
    sale_month = extract("month", Sale.sold_at)
    sales_rows = db.execute(
        select(sale_year, sale_month, func.sum(SaleItem.quantity))
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(
            Sale.status == "completed",
            Sale.sold_at >= start_date,
            Sale.sold_at < end_date,
        )
        .group_by(sale_year, sale_month)
    )
    for year, month_number, units_sold in sales_rows:
        key = f"{int(year):04d}-{int(month_number):02d}"
        if key in monthly_totals:
            monthly_totals[key]["units_sold"] = int(units_sold or 0)

    expense_year = extract("year", Expense.expense_date)
    expense_month = extract("month", Expense.expense_date)
    expense_rows = db.execute(
        select(expense_year, expense_month, func.sum(Expense.amount))
        .where(
            Expense.status == "posted",
            Expense.expense_date >= start_date,
            Expense.expense_date < end_date,
        )
        .group_by(expense_year, expense_month)
    )
    for year, month_number, amount in expense_rows:
        key = f"{int(year):04d}-{int(month_number):02d}"
        if key in monthly_totals:
            monthly_totals[key]["expenses"] = Decimal(amount or 0).quantize(
                Decimal("0.01")
            )

    stock_movement = aliased(InventoryMovement)
    stock_original = aliased(InventoryMovement)
    balance_change = case(
        (stock_movement.movement_type == "in", stock_movement.quantity),
        (stock_movement.movement_type == "out", -stock_movement.quantity),
        else_=case(
            (stock_original.movement_type == "in", -stock_movement.quantity),
            (stock_original.movement_type == "out", stock_movement.quantity),
            else_=0,
        ),
    )
    current_stock_balance = int(
        db.scalar(
            select(func.coalesce(func.sum(balance_change), 0))
            .select_from(stock_movement)
            .join(Product, Product.id == stock_movement.product_id)
            .outerjoin(
                stock_original,
                stock_movement.reversal_of_id == stock_original.id,
            )
            .where(Product.archived_at.is_(None))
        )
        or 0
    )

    return DashboardResponse(
        current_stock_balance=current_stock_balance,
        months=[
            DashboardMonth(month=key, **values)
            for key, values in monthly_totals.items()
        ],
    )
