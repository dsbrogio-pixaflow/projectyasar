from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_database_session
from models import Expense, ExpenseCategory, Sale, User


ExpenseStatus = Literal["posted", "cancelled"]

expense_categories_router = APIRouter(
    prefix="/expense-categories",
    tags=["expense categories"],
    dependencies=[Depends(get_current_user)],
)
expenses_router = APIRouter(
    prefix="/expenses",
    tags=["expenses"],
    dependencies=[Depends(get_current_user)],
)
financial_router = APIRouter(
    prefix="/financial",
    tags=["financial"],
    dependencies=[Depends(get_current_user)],
)


class ExpenseCategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Expense category name cannot be blank")
        return normalized


class ExpenseCategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    created_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


class ExpenseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID
    expense_date: date
    amount: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)


class ExpenseCancellation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("A cancellation reason is required")
        return normalized


class ExpenseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID
    category_name_snapshot: str
    expense_date: date
    amount: Decimal
    status: ExpenseStatus
    cancellation_reason: str | None
    cancelled_at: datetime | None
    created_by_user_id: UUID | None
    cancelled_by_user_id: UUID | None
    created_at: datetime


class ExpensePage(BaseModel):
    items: list[ExpenseResponse]
    total: int
    limit: int
    offset: int


class FinancialSummary(BaseModel):
    total_sales: Decimal
    total_expenses: Decimal
    net_result: Decimal


@expense_categories_router.get("", response_model=list[ExpenseCategoryResponse])
def list_expense_categories(
    db: Session = Depends(get_database_session),
) -> list[ExpenseCategoryResponse]:
    categories = db.scalars(
        select(ExpenseCategory).order_by(
            func.lower(ExpenseCategory.name),
            ExpenseCategory.id,
        )
    )
    return [
        ExpenseCategoryResponse.model_validate(category)
        for category in categories
    ]


@expense_categories_router.post(
    "",
    response_model=ExpenseCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_expense_category(
    payload: ExpenseCategoryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> ExpenseCategoryResponse:
    existing_id = db.scalar(
        select(ExpenseCategory.id).where(
            func.lower(ExpenseCategory.name) == payload.name.lower()
        )
    )
    if existing_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An expense category with this name already exists",
        )
    category = ExpenseCategory(
        id=uuid4(),
        name=payload.name,
        created_by_user_id=user.id,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return ExpenseCategoryResponse.model_validate(category)


@expenses_router.get("", response_model=ExpensePage)
def list_expenses(
    q: str | None = Query(default=None, max_length=200),
    expense_status: ExpenseStatus | None = Query(default=None, alias="status"),
    category_id: UUID | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> ExpensePage:
    conditions = []
    if expense_status is not None:
        conditions.append(Expense.status == expense_status)
    if category_id is not None:
        conditions.append(Expense.category_id == category_id)
    search = q.strip() if q is not None else ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(
            Expense.category_name_snapshot.ilike(f"%{escaped}%", escape="\\")
        )

    total = db.scalar(select(func.count(Expense.id)).where(*conditions)) or 0
    expenses = db.scalars(
        select(Expense)
        .where(*conditions)
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc(), Expense.id)
        .offset(offset)
        .limit(limit)
    )
    return ExpensePage(
        items=[ExpenseResponse.model_validate(expense) for expense in expenses],
        total=total,
        limit=limit,
        offset=offset,
    )


@expenses_router.post(
    "",
    response_model=ExpenseResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_expense(
    payload: ExpenseCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> ExpenseResponse:
    category = db.get(ExpenseCategory, payload.category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense category not found",
        )
    expense = Expense(
        id=uuid4(),
        category_id=category.id,
        category_name_snapshot=category.name,
        expense_date=payload.expense_date,
        amount=payload.amount,
        status="posted",
        created_by_user_id=user.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return ExpenseResponse.model_validate(expense)


@expenses_router.post("/{expense_id}/cancel", response_model=ExpenseResponse)
def cancel_expense(
    expense_id: UUID,
    payload: ExpenseCancellation,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> ExpenseResponse:
    expense = db.scalar(
        select(Expense)
        .where(Expense.id == expense_id)
        .with_for_update()
    )
    if expense is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Expense not found",
        )
    if expense.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Expense has already been cancelled",
        )
    expense.status = "cancelled"
    expense.cancellation_reason = payload.reason
    expense.cancelled_at = datetime.now(timezone.utc)
    expense.cancelled_by_user_id = user.id
    db.commit()
    db.refresh(expense)
    return ExpenseResponse.model_validate(expense)


@financial_router.get("/summary", response_model=FinancialSummary)
def financial_summary(
    db: Session = Depends(get_database_session),
) -> FinancialSummary:
    total_sales = Decimal(
        db.scalar(
            select(func.coalesce(func.sum(Sale.total_amount), 0)).where(
                Sale.status == "completed"
            )
        )
        or 0
    ).quantize(Decimal("0.01"))
    total_expenses = Decimal(
        db.scalar(
            select(func.coalesce(func.sum(Expense.amount), 0)).where(
                Expense.status == "posted"
            )
        )
        or 0
    ).quantize(Decimal("0.01"))
    return FinancialSummary(
        total_sales=total_sales,
        total_expenses=total_expenses,
        net_result=total_sales - total_expenses,
    )
