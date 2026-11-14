from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from auth import get_current_user
from database import get_database_session
from inventory import lock_active_product, lock_product_for_inventory, product_balance
from models import (
    Customer,
    DeliveryMethod,
    InventoryMovement,
    Product,
    Sale,
    SaleItem,
    User,
)


sales_router = APIRouter(
    prefix="/sales",
    tags=["sales"],
    dependencies=[Depends(get_current_user)],
)
delivery_methods_router = APIRouter(
    prefix="/delivery-methods",
    tags=["delivery methods"],
    dependencies=[Depends(get_current_user)],
)


class DeliveryMethodCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Delivery method name cannot be blank")
        return value


class DeliveryMethodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SaleItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: UUID
    quantity: int = Field(ge=1, le=1000)
    unit_price: Decimal = Field(max_digits=12, decimal_places=2)


class SaleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: UUID
    delivery_method_id: UUID
    sold_at: date
    items: list[SaleItemCreate] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def reject_duplicate_products(self) -> "SaleCreate":
        product_ids = [item.product_id for item in self.items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Each product can only appear once per sale")
        return self


class SaleCancellation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A cancellation reason is required")
        return value


class SaleItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    line_number: int
    product_name_snapshot: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class SaleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    customer_id: UUID
    customer_name_snapshot: str
    delivery_address_snapshot: str | None
    delivery_method_id: UUID
    delivery_method_name_snapshot: str
    sold_at: date
    status: Literal["completed", "cancelled"]
    total_amount: Decimal
    cancellation_reason: str | None
    cancelled_at: datetime | None
    created_by_user_id: UUID | None
    cancelled_by_user_id: UUID | None
    created_at: datetime
    items: list[SaleItemResponse]


class SalePage(BaseModel):
    items: list[SaleResponse]
    total: int
    limit: int
    offset: int


class SalesByProduct(BaseModel):
    product_id: UUID
    product_name: str
    quantity_sold: int
    total_sold: Decimal


def _sale_or_404(db: Session, sale_id: UUID) -> Sale:
    sale = db.scalar(
        select(Sale)
        .options(selectinload(Sale.items))
        .where(Sale.id == sale_id)
    )
    if sale is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sale not found",
        )
    return sale


def _delivery_method_or_404(db: Session, delivery_method_id: UUID) -> DeliveryMethod:
    method = db.get(DeliveryMethod, delivery_method_id)
    if method is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delivery method not found",
        )
    return method


def _sale_response(db: Session, sale_id: UUID) -> SaleResponse:
    sale = _sale_or_404(db, sale_id)
    return SaleResponse.model_validate(sale)


@sales_router.get("", response_model=SalePage)
def list_sales(
    q: str | None = Query(default=None, max_length=200),
    sale_status: Literal["completed", "cancelled"] | None = Query(
        default=None,
        alias="status",
    ),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> SalePage:
    conditions = []
    if sale_status is not None:
        conditions.append(Sale.status == sale_status)
    search = q.strip() if q is not None else ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(
            Sale.customer_name_snapshot.ilike(f"%{escaped}%", escape="\\")
        )

    total = db.scalar(select(func.count(Sale.id)).where(*conditions)) or 0
    sales = list(
        db.scalars(
            select(Sale)
            .options(selectinload(Sale.items))
            .where(*conditions)
            .order_by(Sale.sold_at.desc(), Sale.created_at.desc(), Sale.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return SalePage(items=sales, total=total, limit=limit, offset=offset)


@sales_router.get("/summary", response_model=list[SalesByProduct])
def sales_summary(db: Session = Depends(get_database_session)) -> list[SalesByProduct]:
    rows = db.execute(
        select(
            SaleItem.product_id,
            SaleItem.product_name_snapshot,
            func.sum(SaleItem.quantity),
            func.sum(SaleItem.line_total),
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Sale.status == "completed")
        .group_by(SaleItem.product_id, SaleItem.product_name_snapshot)
        .order_by(func.lower(SaleItem.product_name_snapshot), SaleItem.product_id)
    )
    return [
        SalesByProduct(
            product_id=product_id,
            product_name=product_name,
            quantity_sold=int(quantity_sold),
            total_sold=Decimal(total_sold),
        )
        for product_id, product_name, quantity_sold, total_sold in rows
    ]


@sales_router.post(
    "",
    response_model=SaleResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_sale(
    payload: SaleCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> SaleResponse:
    customer = db.scalar(
        select(Customer)
        .where(Customer.id == payload.customer_id)
        .with_for_update()
    )
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Customer not found",
        )
    if customer.archived_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Archived customers cannot be used for new sales",
        )

    delivery_method = db.scalar(
        select(DeliveryMethod)
        .where(DeliveryMethod.id == payload.delivery_method_id)
        .with_for_update()
    )
    if delivery_method is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delivery method not found",
        )
    if delivery_method.archived_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Archived delivery methods cannot be used for new sales",
        )

    products: dict[UUID, Product] = {}
    for product_id in sorted(item.product_id for item in payload.items):
        products[product_id] = lock_active_product(db, product_id)
    for item in payload.items:
        product = products[item.product_id]
        available = product_balance(db, product.id)
        if item.quantity > available:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Insufficient stock for {product.name}. "
                    f"Available: {available}; requested: {item.quantity}."
                ),
            )

    line_totals = [
        (item.unit_price * item.quantity).quantize(Decimal("0.01"))
        for item in payload.items
    ]
    total_amount = sum(line_totals, start=Decimal("0.00"))
    sale_items = [
        SaleItem(
            id=uuid4(),
            line_number=index,
            product_id=item.product_id,
            product_name_snapshot=products[item.product_id].name,
            quantity=item.quantity,
            unit_price=item.unit_price,
            line_total=line_totals[index - 1],
        )
        for index, item in enumerate(payload.items, start=1)
    ]
    sale = Sale(
        customer_id=customer.id,
        customer_name_snapshot=customer.full_name,
        delivery_address_snapshot=customer.delivery_address,
        delivery_method_id=delivery_method.id,
        delivery_method_name_snapshot=delivery_method.name,
        sold_at=payload.sold_at,
        status="completed",
        total_amount=total_amount,
        created_by_user_id=user.id,
        items=sale_items,
    )
    db.add(sale)
    db.flush()

    for sale_item in sale.items:
        db.add(
            InventoryMovement(
                product_id=sale_item.product_id,
                occurred_at=sale.sold_at,
                movement_type="out",
                quantity=sale_item.quantity,
                source_type="sale",
                source_id=sale_item.id,
                note=f"Sale {sale.id}",
                created_by_user_id=user.id,
            )
        )
    db.commit()
    return _sale_response(db, sale.id)


@sales_router.get("/{sale_id}", response_model=SaleResponse)
def get_sale(
    sale_id: UUID,
    db: Session = Depends(get_database_session),
) -> SaleResponse:
    return SaleResponse.model_validate(_sale_or_404(db, sale_id))


@sales_router.post("/{sale_id}/cancel", response_model=SaleResponse)
def cancel_sale(
    sale_id: UUID,
    payload: SaleCancellation,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> SaleResponse:
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
            detail="Sale has already been cancelled",
        )

    sale_items = list(
        db.scalars(
            select(SaleItem)
            .where(SaleItem.sale_id == sale.id)
            .order_by(SaleItem.product_id, SaleItem.id)
        )
    )
    if not sale_items:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sale has no items to cancel",
        )

    for product_id in sorted({item.product_id for item in sale_items}):
        lock_product_for_inventory(db, product_id)

    source_ids = [item.id for item in sale_items]
    sale_movements = list(
        db.scalars(
            select(InventoryMovement)
            .where(
                InventoryMovement.source_type == "sale",
                InventoryMovement.movement_type == "out",
                InventoryMovement.source_id.in_(source_ids),
            )
            .with_for_update()
        )
    )
    movements_by_item_id = {
        movement.source_id: movement
        for movement in sale_movements
    }
    if len(movements_by_item_id) != len(sale_items):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sale inventory movements are incomplete; cancellation was not applied",
        )
    for item in sale_items:
        movement = movements_by_item_id[item.id]
        if (
            movement.product_id != item.product_id
            or movement.quantity != item.quantity
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Sale inventory movements do not match sale items",
            )

    cancelled_at = datetime.now(timezone.utc)
    occurred_at = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    for movement in sale_movements:
        db.add(
            InventoryMovement(
                product_id=movement.product_id,
                occurred_at=occurred_at,
                movement_type="reversal",
                quantity=movement.quantity,
                source_type="sale",
                source_id=movement.source_id,
                reversal_of_id=movement.id,
                note=payload.reason,
                created_by_user_id=user.id,
            )
        )
    sale.status = "cancelled"
    sale.cancellation_reason = payload.reason
    sale.cancelled_at = cancelled_at
    sale.cancelled_by_user_id = user.id
    db.commit()
    return _sale_response(db, sale.id)


@delivery_methods_router.get("", response_model=list[DeliveryMethodResponse])
def list_delivery_methods(
    include_archived: bool = False,
    db: Session = Depends(get_database_session),
) -> list[DeliveryMethodResponse]:
    conditions = []
    if not include_archived:
        conditions.append(DeliveryMethod.archived_at.is_(None))
    return list(
        db.scalars(
            select(DeliveryMethod)
            .where(*conditions)
            .order_by(func.lower(DeliveryMethod.name), DeliveryMethod.id)
        )
    )


@delivery_methods_router.post(
    "",
    response_model=DeliveryMethodResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_delivery_method(
    payload: DeliveryMethodCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> DeliveryMethodResponse:
    existing = db.scalar(
        select(DeliveryMethod.id).where(
            func.lower(DeliveryMethod.name) == payload.name.lower()
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A delivery method with this name already exists",
        )
    method = DeliveryMethod(
        name=payload.name,
        created_by_user_id=user.id,
    )
    db.add(method)
    db.commit()
    db.refresh(method)
    return DeliveryMethodResponse.model_validate(method)


def _set_delivery_method_archived(
    delivery_method_id: UUID,
    archived: bool,
    db: Session,
) -> DeliveryMethodResponse:
    method = _delivery_method_or_404(db, delivery_method_id)
    method.archived_at = datetime.now(timezone.utc) if archived else None
    db.commit()
    db.refresh(method)
    return DeliveryMethodResponse.model_validate(method)


@delivery_methods_router.post(
    "/{delivery_method_id}/archive",
    response_model=DeliveryMethodResponse,
)
def archive_delivery_method(
    delivery_method_id: UUID,
    db: Session = Depends(get_database_session),
) -> DeliveryMethodResponse:
    return _set_delivery_method_archived(delivery_method_id, True, db)


@delivery_methods_router.post(
    "/{delivery_method_id}/restore",
    response_model=DeliveryMethodResponse,
)
def restore_delivery_method(
    delivery_method_id: UUID,
    db: Session = Depends(get_database_session),
) -> DeliveryMethodResponse:
    return _set_delivery_method_archived(delivery_method_id, False, db)
