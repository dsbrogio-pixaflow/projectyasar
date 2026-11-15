from datetime import date, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from auth import get_current_user
from database import get_database_session
from models import Delivery, Sale, User


DeliveryStatus = Literal[
    "pending",
    "out_for_delivery",
    "delivered",
    "cancelled",
]

deliveries_router = APIRouter(
    prefix="/deliveries",
    tags=["deliveries"],
    dependencies=[Depends(get_current_user)],
)


class DeliveryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: DeliveryStatus | None = None
    tracking_code: str | None = Field(default=None, max_length=200)

    @field_validator("tracking_code")
    @classmethod
    def normalize_tracking_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def require_update(self) -> "DeliveryUpdate":
        if not self.model_fields_set:
            raise ValueError("Provide a delivery status or tracking code to update")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("Delivery status cannot be null")
        return self


class DeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sale_id: UUID
    customer_name: str
    delivery_address_snapshot: str | None
    delivery_method_name: str
    sold_at: date
    sale_status: Literal["completed", "cancelled"]
    status: DeliveryStatus
    tracking_code: str | None
    updated_at: datetime


class DeliveryPage(BaseModel):
    items: list[DeliveryResponse]
    total: int
    limit: int
    offset: int


def _delivery_response(delivery: Delivery) -> DeliveryResponse:
    return DeliveryResponse(
        sale_id=delivery.sale_id,
        customer_name=delivery.sale.customer_name_snapshot,
        delivery_address_snapshot=delivery.delivery_address_snapshot,
        delivery_method_name=delivery.sale.delivery_method_name_snapshot,
        sold_at=delivery.sale.sold_at,
        sale_status=delivery.sale.status,
        status=delivery.status,
        tracking_code=delivery.tracking_code,
        updated_at=delivery.updated_at,
    )


def _delivery_or_404(db: Session, sale_id: UUID) -> Delivery:
    query = select(Delivery).options(joinedload(Delivery.sale)).where(
        Delivery.sale_id == sale_id
    )
    delivery = db.scalar(query)
    if delivery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delivery not found",
        )
    return delivery


@deliveries_router.get("", response_model=DeliveryPage)
def list_deliveries(
    q: str | None = Query(default=None, max_length=200),
    delivery_status: DeliveryStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> DeliveryPage:
    conditions = []
    if delivery_status is not None:
        conditions.append(Delivery.status == delivery_status)
    search = q.strip() if q is not None else ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(Sale.customer_name_snapshot.ilike(f"%{escaped}%", escape="\\"))

    total = db.scalar(
        select(func.count(Delivery.sale_id))
        .join(Sale, Sale.id == Delivery.sale_id)
        .where(*conditions)
    ) or 0
    deliveries = list(
        db.scalars(
            select(Delivery)
            .join(Sale, Sale.id == Delivery.sale_id)
            .options(joinedload(Delivery.sale))
            .where(*conditions)
            .order_by(Sale.sold_at.desc(), Sale.created_at.desc(), Sale.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return DeliveryPage(
        items=[_delivery_response(delivery) for delivery in deliveries],
        total=total,
        limit=limit,
        offset=offset,
    )


@deliveries_router.get("/{sale_id}", response_model=DeliveryResponse)
def get_delivery(
    sale_id: UUID,
    db: Session = Depends(get_database_session),
) -> DeliveryResponse:
    return _delivery_response(_delivery_or_404(db, sale_id))


@deliveries_router.patch("/{sale_id}", response_model=DeliveryResponse)
def update_delivery(
    sale_id: UUID,
    payload: DeliveryUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> DeliveryResponse:
    sale = db.scalar(
        select(Sale)
        .where(Sale.id == sale_id)
        .with_for_update()
    )
    if sale is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sale not found",
        )
    if sale.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cancelled sales do not allow delivery updates",
        )

    delivery = db.scalar(
        select(Delivery)
        .where(Delivery.sale_id == sale.id)
        .with_for_update()
    )
    if delivery is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delivery not found",
        )
    if "status" in payload.model_fields_set and payload.status is not None:
        delivery.status = payload.status
    if "tracking_code" in payload.model_fields_set:
        delivery.tracking_code = payload.tracking_code
    delivery.updated_by_user_id = user.id
    db.commit()
    return _delivery_response(_delivery_or_404(db, sale_id))
