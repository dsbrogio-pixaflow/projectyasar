from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_database_session
from models import (
    CalendarEvent,
    Customer,
    Delivery,
    DeliveryMethod,
    Expense,
    ExpenseCategory,
    InventoryMovement,
    Product,
    Sale,
    User,
    UserSession,
)


UserRole = Literal["admin", "user"]
UserStatus = Literal["active", "inactive"]
USER_AUDIT_COLUMNS = (
    Customer.created_by_user_id,
    Product.created_by_user_id,
    InventoryMovement.created_by_user_id,
    DeliveryMethod.created_by_user_id,
    Sale.created_by_user_id,
    Sale.cancelled_by_user_id,
    Delivery.updated_by_user_id,
    ExpenseCategory.created_by_user_id,
    Expense.created_by_user_id,
    Expense.cancelled_by_user_id,
    CalendarEvent.created_by_user_id,
)


class AdminUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str
    email: str
    role: UserRole
    status: UserStatus
    created_at: datetime


class AdminUserPage(BaseModel):
    items: list[AdminUserResponse]
    total: int
    limit: int
    offset: int


class AdminUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: EmailStr | None = Field(default=None, max_length=320)
    role: UserRole | None = None
    status: UserStatus | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_null_values(cls, value: object) -> object:
        if isinstance(value, dict):
            if not value:
                raise ValueError("At least one user field must be provided")
            if any(field_value is None for field_value in value.values()):
                raise ValueError("User fields cannot be null")
        return value

    @field_validator("full_name")
    @classmethod
    def trim_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Full name cannot be blank")
        return normalized


class UserDeletionConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm_email: EmailStr


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required",
        )
    return user


router = APIRouter(
    prefix="/admin/users",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


def _lock_active_administrators(db: Session) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .where(User.role == "admin", User.status == "active")
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )


def _user_for_update(db: Session, user_id: UUID) -> User:
    user = db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user


def _ensure_another_active_administrator(
    target: User,
    active_administrators: list[User],
    next_role: UserRole,
    next_status: UserStatus,
) -> None:
    target_is_active_admin = target.role == "admin" and target.status == "active"
    remains_active_admin = next_role == "admin" and next_status == "active"
    if (
        target_is_active_admin
        and not remains_active_admin
        and len(active_administrators) <= 1
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The last active administrator cannot be removed or deactivated",
        )


def _revoke_user_sessions(db: Session, user_id: UUID) -> None:
    db.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(timezone.utc))
    )


def _clear_user_audit_references(db: Session, user_id: UUID) -> None:
    for column in USER_AUDIT_COLUMNS:
        db.execute(
            update(column.table)
            .where(column == user_id)
            .values({column: None})
        )


@router.get("", response_model=AdminUserPage)
def list_users(
    q: str | None = Query(default=None, max_length=200),
    role: UserRole | None = None,
    user_status: UserStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_database_session),
) -> AdminUserPage:
    conditions = []
    search = q.strip() if q is not None else ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        conditions.append(
            or_(
                User.full_name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
            )
        )
    if role is not None:
        conditions.append(User.role == role)
    if user_status is not None:
        conditions.append(User.status == user_status)

    total = db.scalar(select(func.count(User.id)).where(*conditions)) or 0
    users = list(
        db.scalars(
            select(User)
            .where(*conditions)
            .order_by(func.lower(User.full_name), User.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return AdminUserPage(items=users, total=total, limit=limit, offset=offset)


@router.patch("/{user_id}", response_model=AdminUserResponse)
def update_user(
    user_id: UUID,
    payload: AdminUserUpdate,
    db: Session = Depends(get_database_session),
) -> AdminUserResponse:
    access_fields = {"role", "status"}
    changes_access = bool(payload.model_fields_set & access_fields)
    active_administrators = (
        _lock_active_administrators(db)
        if changes_access
        else []
    )
    user = _user_for_update(db, user_id)

    next_role = payload.role if payload.role is not None else user.role
    next_status = payload.status if payload.status is not None else user.status
    if changes_access:
        _ensure_another_active_administrator(
            user,
            active_administrators,
            next_role,
            next_status,
        )

    changed_access = (
        next_role != user.role
        or next_status != user.status
    )
    for field in payload.model_fields_set:
        value = getattr(payload, field)
        if field == "email":
            value = str(value).strip().lower()
        setattr(user, field, value)

    if changed_access:
        _revoke_user_sessions(db, user.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        ) from None
    db.refresh(user)
    return AdminUserResponse.model_validate(user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_user(
    user_id: UUID,
    payload: UserDeletionConfirmation,
    db: Session = Depends(get_database_session),
) -> None:
    active_administrators = _lock_active_administrators(db)
    user = _user_for_update(db, user_id)
    if (
        user.role == "admin"
        and user.status == "active"
        and len(active_administrators) <= 1
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The last active administrator cannot be removed or deactivated",
        )
    if str(payload.confirm_email).strip().lower() != user.email.lower():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Confirmation email does not match the account",
        )

    _clear_user_audit_references(db, user.id)
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.delete(user)
    db.commit()
