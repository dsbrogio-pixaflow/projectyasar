from datetime import date, datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session, aliased

from auth import get_current_user
from database import get_database_session
from models import InventoryMovement, Product, User


router = APIRouter(
    prefix="/inventory",
    tags=["inventory"],
    dependencies=[Depends(get_current_user)],
)


class MovementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: UUID
    occurred_at: date
    movement_type: Literal["in", "out"]
    quantity: int = Field(ge=1, le=1_000_000)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def trim_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ReversalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A reversal reason is required")
        return value


class InventoryMovementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    product_name: str
    occurred_at: date
    movement_type: str
    quantity: int
    source_type: str
    source_id: UUID | None
    reversal_of_id: UUID | None
    note: str | None
    created_by_user_id: UUID | None
    created_at: datetime
    is_reversed: bool


class InventoryMovementResult(BaseModel):
    movement: InventoryMovementResponse
    balance_after: int
    negative_balance_warning: bool


class InventoryMovementPage(BaseModel):
    items: list[InventoryMovementResponse]
    total: int
    limit: int
    offset: int


class ProductStockSummary(BaseModel):
    product_id: UUID
    product_name: str
    total_entries: int
    total_exits: int
    balance: int


class ProductStockPage(BaseModel):
    items: list[ProductStockSummary]
    total: int
    limit: int
    offset: int


def _lock_product(db: Session, product_id: UUID) -> Product:
    product = db.scalar(
        select(Product)
        .where(Product.id == product_id)
        .with_for_update()
    )
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )
    return product


def _lock_active_product(db: Session, product_id: UUID) -> Product:
    product = _lock_product(db, product_id)
    if product.archived_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Archived products cannot receive stock movements",
        )
    return product


def _product_balance(db: Session, product_id: UUID) -> int:
    movement = aliased(InventoryMovement)
    original = aliased(InventoryMovement)
    balance_change = case(
        (movement.movement_type == "in", movement.quantity),
        (movement.movement_type == "out", -movement.quantity),
        else_=case(
            (original.movement_type == "in", -movement.quantity),
            (original.movement_type == "out", movement.quantity),
            else_=0,
        ),
    )
    balance = db.scalar(
        select(func.coalesce(func.sum(balance_change), 0))
        .select_from(movement)
        .outerjoin(original, movement.reversal_of_id == original.id)
        .where(movement.product_id == product_id)
    )
    return int(balance or 0)


def _movement_response(
    movement: InventoryMovement,
    product_name: str,
    is_reversed: bool = False,
) -> InventoryMovementResponse:
    return InventoryMovementResponse(
        id=movement.id,
        product_id=movement.product_id,
        product_name=product_name,
        occurred_at=movement.occurred_at,
        movement_type=movement.movement_type,
        quantity=movement.quantity,
        source_type=movement.source_type,
        source_id=movement.source_id,
        reversal_of_id=movement.reversal_of_id,
        note=movement.note,
        created_by_user_id=movement.created_by_user_id,
        created_at=movement.created_at,
        is_reversed=is_reversed,
    )


def _movement_result(
    movement: InventoryMovement,
    product: Product,
    balance_after: int,
) -> InventoryMovementResult:
    return InventoryMovementResult(
        movement=_movement_response(movement, product.name),
        balance_after=balance_after,
        negative_balance_warning=balance_after < 0,
    )


@router.get("/summary", response_model=ProductStockPage)
def list_product_stock(
    q: str | None = Query(default=None, max_length=200),
    include_archived: bool = False,
    product_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> ProductStockPage:
    conditions = []
    if not include_archived:
        conditions.append(Product.archived_at.is_(None))
    if product_id is not None:
        conditions.append(Product.id == product_id)
    search = q.strip() if q is not None else ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(Product.name.ilike(f"%{escaped}%", escape="\\"))

    total = db.scalar(select(func.count(Product.id)).where(*conditions)) or 0

    movement = aliased(InventoryMovement)
    original = aliased(InventoryMovement)
    entry_effect = case(
        (movement.movement_type == "in", movement.quantity),
        (
            and_(
                movement.movement_type == "reversal",
                original.movement_type == "in",
            ),
            -movement.quantity,
        ),
        else_=0,
    )
    exit_effect = case(
        (movement.movement_type == "out", movement.quantity),
        (
            and_(
                movement.movement_type == "reversal",
                original.movement_type == "out",
            ),
            -movement.quantity,
        ),
        else_=0,
    )
    rows = db.execute(
        select(
            Product.id,
            Product.name,
            func.coalesce(func.sum(entry_effect), 0),
            func.coalesce(func.sum(exit_effect), 0),
        )
        .select_from(Product)
        .outerjoin(movement, movement.product_id == Product.id)
        .outerjoin(original, movement.reversal_of_id == original.id)
        .where(*conditions)
        .group_by(Product.id, Product.name)
        .order_by(func.lower(Product.name), Product.id)
        .offset(offset)
        .limit(limit)
    )
    items = [
        ProductStockSummary(
            product_id=product_id,
            product_name=product_name,
            total_entries=int(total_entries),
            total_exits=int(total_exits),
            balance=int(total_entries) - int(total_exits),
        )
        for product_id, product_name, total_entries, total_exits in rows
    ]
    return ProductStockPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/movements", response_model=InventoryMovementPage)
def list_movements(
    product_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> InventoryMovementPage:
    conditions = []
    if product_id is not None:
        conditions.append(InventoryMovement.product_id == product_id)

    total = db.scalar(
        select(func.count(InventoryMovement.id)).where(*conditions)
    ) or 0
    movement = aliased(InventoryMovement)
    reversal = aliased(InventoryMovement)
    rows = db.execute(
        select(movement, Product.name, reversal.id)
        .join(Product, Product.id == movement.product_id)
        .outerjoin(reversal, reversal.reversal_of_id == movement.id)
        .where(
            *(
                [movement.product_id == product_id]
                if product_id is not None
                else []
            )
        )
        .order_by(movement.occurred_at.desc(), movement.created_at.desc(), movement.id)
        .offset(offset)
        .limit(limit)
    )
    items = [
        _movement_response(row[0], row[1], is_reversed=row[2] is not None)
        for row in rows
    ]
    return InventoryMovementPage(items=items, total=total, limit=limit, offset=offset)


@router.post(
    "/movements",
    response_model=InventoryMovementResult,
    status_code=status.HTTP_201_CREATED,
)
def create_movement(
    payload: MovementCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> InventoryMovementResult:
    product = _lock_active_product(db, payload.product_id)
    movement = InventoryMovement(
        product_id=product.id,
        occurred_at=payload.occurred_at,
        movement_type=payload.movement_type,
        quantity=payload.quantity,
        source_type="manual",
        note=payload.note,
        created_by_user_id=user.id,
    )
    db.add(movement)
    db.flush()
    balance_after = _product_balance(db, product.id)
    db.commit()
    db.refresh(movement)
    return _movement_result(movement, product, balance_after)


@router.post(
    "/movements/{movement_id}/reverse",
    response_model=InventoryMovementResult,
)
def reverse_movement(
    movement_id: UUID,
    payload: ReversalRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> InventoryMovementResult:
    original = db.scalar(
        select(InventoryMovement)
        .where(InventoryMovement.id == movement_id)
        .with_for_update()
    )
    if original is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory movement not found",
        )
    if original.movement_type == "reversal":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A reversal cannot be reversed",
        )
    if original.source_type != "manual":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sale movements must be reversed through the sale cancellation flow",
        )

    product = _lock_product(db, original.product_id)
    existing_reversal = db.scalar(
        select(InventoryMovement.id).where(
            InventoryMovement.reversal_of_id == original.id
        )
    )
    if existing_reversal is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This inventory movement has already been reversed",
        )

    reversal = InventoryMovement(
        product_id=original.product_id,
        occurred_at=datetime.now(ZoneInfo("America/Sao_Paulo")).date(),
        movement_type="reversal",
        quantity=original.quantity,
        source_type="manual",
        reversal_of_id=original.id,
        note=payload.reason,
        created_by_user_id=user.id,
    )
    db.add(reversal)
    db.flush()
    balance_after = _product_balance(db, product.id)
    db.commit()
    db.refresh(reversal)
    return _movement_result(reversal, product, balance_after)
