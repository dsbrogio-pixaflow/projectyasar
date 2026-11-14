from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    field_validator,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_database_session
from models import Product, User


router = APIRouter(
    prefix="/products",
    tags=["products"],
    dependencies=[Depends(get_current_user)],
)


class ProductWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    current_price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    image_url: HttpUrl | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Product name cannot be blank")
        return value

    @field_validator("image_url", mode="before")
    @classmethod
    def normalize_image_url(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    current_price: Decimal
    image_url: str | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ProductPage(BaseModel):
    items: list[ProductResponse]
    total: int
    limit: int
    offset: int


def _product_or_404(db: Session, product_id: UUID) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )
    return product


@router.get("", response_model=ProductPage)
def list_products(
    q: str | None = Query(default=None, max_length=200),
    include_archived: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> ProductPage:
    conditions = []
    if not include_archived:
        conditions.append(Product.archived_at.is_(None))

    search = q.strip() if q is not None else ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(Product.name.ilike(f"%{escaped}%", escape="\\"))

    total = db.scalar(select(func.count(Product.id)).where(*conditions)) or 0
    products = list(
        db.scalars(
            select(Product)
            .where(*conditions)
            .order_by(func.lower(Product.name), Product.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return ProductPage(items=products, total=total, limit=limit, offset=offset)


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductWrite,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> ProductResponse:
    product = Product(
        name=payload.name,
        current_price=payload.current_price,
        image_url=str(payload.image_url) if payload.image_url else None,
        created_by_user_id=user.id,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return ProductResponse.model_validate(product)


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: UUID,
    db: Session = Depends(get_database_session),
) -> ProductResponse:
    return ProductResponse.model_validate(_product_or_404(db, product_id))


@router.put("/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: UUID,
    payload: ProductWrite,
    db: Session = Depends(get_database_session),
) -> ProductResponse:
    product = _product_or_404(db, product_id)
    product.name = payload.name
    product.current_price = payload.current_price
    product.image_url = str(payload.image_url) if payload.image_url else None
    db.commit()
    db.refresh(product)
    return ProductResponse.model_validate(product)


def _set_archived(
    product_id: UUID,
    archived: bool,
    db: Session,
) -> ProductResponse:
    product = _product_or_404(db, product_id)
    product.archived_at = datetime.now(timezone.utc) if archived else None
    db.commit()
    db.refresh(product)
    return ProductResponse.model_validate(product)


@router.post("/{product_id}/archive", response_model=ProductResponse)
def archive_product(
    product_id: UUID,
    db: Session = Depends(get_database_session),
) -> ProductResponse:
    return _set_archived(product_id, True, db)


@router.post("/{product_id}/restore", response_model=ProductResponse)
def restore_product(
    product_id: UUID,
    db: Session = Depends(get_database_session),
) -> ProductResponse:
    return _set_archived(product_id, False, db)
