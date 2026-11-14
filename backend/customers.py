import calendar
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_database_session
from models import Customer, User


router = APIRouter(
    prefix="/customers",
    tags=["customers"],
    dependencies=[Depends(get_current_user)],
)


class CustomerWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    delivery_address: str | None = Field(default=None, max_length=1000)
    birthday_day: int | None = Field(default=None, ge=1, le=31)
    birthday_month: int | None = Field(default=None, ge=1, le=12)

    @field_validator("full_name")
    @classmethod
    def trim_full_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Full name cannot be blank")
        return value

    @field_validator("email", "phone", "delivery_address", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @model_validator(mode="after")
    def validate_birthday(self) -> "CustomerWrite":
        if (self.birthday_day is None) != (self.birthday_month is None):
            raise ValueError("Birthday day and month must be provided together")
        if self.birthday_day is not None and self.birthday_month is not None:
            days_in_month = calendar.monthrange(2000, self.birthday_month)[1]
            if self.birthday_day > days_in_month:
                raise ValueError("Birthday day is invalid for the selected month")
        return self


class CustomerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str
    email: str | None
    phone: str | None
    delivery_address: str | None
    birthday_day: int | None
    birthday_month: int | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CustomerPage(BaseModel):
    items: list[CustomerResponse]
    total: int
    limit: int
    offset: int


def _customer_or_404(db: Session, customer_id: UUID) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Customer not found",
        )
    return customer


@router.get("", response_model=CustomerPage)
def list_customers(
    q: str | None = Query(default=None, max_length=200),
    include_archived: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> CustomerPage:
    conditions = []
    if not include_archived:
        conditions.append(Customer.archived_at.is_(None))

    search = q.strip() if q is not None else ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        conditions.append(
            or_(
                Customer.full_name.ilike(pattern, escape="\\"),
                Customer.email.ilike(pattern, escape="\\"),
                Customer.phone.ilike(pattern, escape="\\"),
            )
        )

    total = db.scalar(select(func.count(Customer.id)).where(*conditions)) or 0
    customers = list(
        db.scalars(
            select(Customer)
            .where(*conditions)
            .order_by(func.lower(Customer.full_name), Customer.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return CustomerPage(items=customers, total=total, limit=limit, offset=offset)


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    payload: CustomerWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> CustomerResponse:
    customer = Customer(
        **payload.model_dump(),
        created_by_user_id=user.id,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return CustomerResponse.model_validate(customer)


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: UUID,
    db: Session = Depends(get_database_session),
) -> CustomerResponse:
    return CustomerResponse.model_validate(_customer_or_404(db, customer_id))


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: UUID,
    payload: CustomerWrite,
    db: Session = Depends(get_database_session),
) -> CustomerResponse:
    customer = _customer_or_404(db, customer_id)
    for field, value in payload.model_dump().items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return CustomerResponse.model_validate(customer)


def _set_archived(
    customer_id: UUID,
    archived: bool,
    db: Session,
) -> CustomerResponse:
    customer = _customer_or_404(db, customer_id)
    customer.archived_at = datetime.now(timezone.utc) if archived else None
    db.commit()
    db.refresh(customer)
    return CustomerResponse.model_validate(customer)


@router.post("/{customer_id}/archive", response_model=CustomerResponse)
def archive_customer(
    customer_id: UUID,
    db: Session = Depends(get_database_session),
) -> CustomerResponse:
    return _set_archived(customer_id, True, db)


@router.post("/{customer_id}/restore", response_model=CustomerResponse)
def restore_customer(
    customer_id: UUID,
    db: Session = Depends(get_database_session),
) -> CustomerResponse:
    return _set_archived(customer_id, False, db)
