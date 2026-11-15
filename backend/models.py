from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'user')", name="ck_users_role"),
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="ck_users_status",
        ),
        Index("uq_users_email_lower", func.lower(text("email")), unique=True),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("uq_user_sessions_token_hash", "token_hash", unique=True),
        Index("ix_user_sessions_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class AuthRateLimit(Base):
    __tablename__ = "auth_rate_limits"
    __table_args__ = (
        CheckConstraint("attempt_count > 0", name="ck_auth_rate_limits_attempt_count"),
        Index("ix_auth_rate_limits_window_started_at", "window_started_at"),
    )

    bucket_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        CheckConstraint(
            """
            (birthday_day IS NULL AND birthday_month IS NULL)
            OR (
                birthday_day IS NOT NULL
                AND birthday_month IS NOT NULL
                AND
                birthday_day BETWEEN 1 AND 31
                AND birthday_month BETWEEN 1 AND 12
                AND (birthday_month != 2 OR birthday_day <= 29)
                AND (birthday_month NOT IN (4, 6, 9, 11) OR birthday_day <= 30)
            )
            """,
            name="ck_customers_birthday_day_month",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    delivery_address: Mapped[str | None] = mapped_column(Text)
    birthday_day: Mapped[int | None] = mapped_column(SmallInteger)
    birthday_month: Mapped[int | None] = mapped_column(SmallInteger)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("current_price >= 0", name="ck_products_current_price_nonnegative"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    current_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        CheckConstraint(
            "movement_type IN ('in', 'out', 'reversal')",
            name="ck_inventory_movements_type",
        ),
        CheckConstraint(
            "quantity > 0",
            name="ck_inventory_movements_quantity",
        ),
        CheckConstraint(
            "source_type IN ('manual', 'sale')",
            name="ck_inventory_movements_source_type",
        ),
        CheckConstraint(
            """
            (movement_type = 'reversal' AND reversal_of_id IS NOT NULL)
            OR (movement_type != 'reversal' AND reversal_of_id IS NULL)
            """,
            name="ck_inventory_movements_reversal_reference",
        ),
        CheckConstraint(
            """
            (source_type = 'manual' AND source_id IS NULL)
            OR (source_type = 'sale' AND source_id IS NOT NULL)
            """,
            name="ck_inventory_movements_source_reference",
        ),
        Index(
            "ix_inventory_movements_product_date",
            "product_id",
            "occurred_at",
        ),
        Index(
            "uq_inventory_movements_reversal_of",
            "reversal_of_id",
            unique=True,
        ),
        Index(
            "uq_inventory_movements_sale_item",
            "source_id",
            unique=True,
            postgresql_where=text("source_type = 'sale' AND movement_type = 'out'"),
            sqlite_where=text("source_type = 'sale' AND movement_type = 'out'"),
        ),
        Index("ix_inventory_movements_created_by_user_id", "created_by_user_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
    )
    occurred_at: Mapped[date] = mapped_column(Date, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    source_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    reversal_of_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("inventory_movements.id", ondelete="RESTRICT"),
    )
    note: Mapped[str | None] = mapped_column(String(500))
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class DeliveryMethod(Base):
    __tablename__ = "delivery_methods"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_delivery_methods_name_not_blank",
        ),
        Index(
            "uq_delivery_methods_name_lower",
            func.lower(text("name")),
            unique=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint(
            "status IN ('completed', 'cancelled')",
            name="ck_sales_status",
        ),
        CheckConstraint(
            """
            (status = 'completed' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
            OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
            """,
            name="ck_sales_cancellation_state",
        ),
        Index("ix_sales_sold_at", "sold_at"),
        Index("ix_sales_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    customer_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
    )
    customer_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    delivery_address_snapshot: Mapped[str | None] = mapped_column(Text)
    delivery_method_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("delivery_methods.id", ondelete="RESTRICT"),
        nullable=False,
    )
    delivery_method_name_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    sold_at: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="completed")
    total_amount: Mapped[Decimal] = mapped_column(Numeric(17, 2), nullable=False)
    cancellation_reason: Mapped[str | None] = mapped_column(String(500))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    cancelled_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    items: Mapped[list["SaleItem"]] = relationship(
        back_populates="sale",
        order_by="SaleItem.line_number",
    )
    delivery: Mapped["Delivery | None"] = relationship(
        back_populates="sale",
        uselist=False,
    )


class SaleItem(Base):
    __tablename__ = "sale_items"
    __table_args__ = (
        CheckConstraint(
            "quantity BETWEEN 1 AND 1000",
            name="ck_sale_items_quantity",
        ),
        CheckConstraint(
            "line_number BETWEEN 1 AND 50",
            name="ck_sale_items_line_number",
        ),
        Index(
            "uq_sale_items_sale_product",
            "sale_id",
            "product_id",
            unique=True,
        ),
        Index(
            "uq_sale_items_sale_line",
            "sale_id",
            "line_number",
            unique=True,
        ),
        Index("ix_sale_items_product_id", "product_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    sale_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sales.id", ondelete="RESTRICT"),
        nullable=False,
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
    )
    line_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    product_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    sale: Mapped["Sale"] = relationship(back_populates="items")


class Delivery(Base):
    __tablename__ = "deliveries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'out_for_delivery', 'delivered', 'cancelled')",
            name="ck_deliveries_status",
        ),
        CheckConstraint(
            "tracking_code IS NULL OR length(trim(tracking_code)) > 0",
            name="ck_deliveries_tracking_code_not_blank",
        ),
        Index("ix_deliveries_status", "status"),
    )

    sale_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sales.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    delivery_address_snapshot: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    tracking_code: Mapped[str | None] = mapped_column(String(200))
    updated_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    sale: Mapped["Sale"] = relationship(back_populates="delivery")


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_expense_categories_name_not_blank",
        ),
        Index(
            "uq_expense_categories_name_lower",
            func.lower(text("name")),
            unique=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint(
            "amount > 0",
            name="ck_expenses_amount_positive",
        ),
        CheckConstraint(
            "status IN ('posted', 'cancelled')",
            name="ck_expenses_status",
        ),
        CheckConstraint(
            """
            (status = 'posted' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
            OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
            """,
            name="ck_expenses_cancellation_state",
        ),
        Index("ix_expenses_expense_date", "expense_date"),
        Index("ix_expenses_category_id", "category_id"),
        Index("ix_expenses_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    category_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("expense_categories.id", ondelete="RESTRICT"),
        nullable=False,
    )
    category_name_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="posted")
    cancellation_reason: Mapped[str | None] = mapped_column(String(500))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    cancelled_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('holiday', 'commemorative', 'other')",
            name="ck_calendar_events_type",
        ),
        CheckConstraint(
            "length(trim(description)) > 0",
            name="ck_calendar_events_description_not_blank",
        ),
        Index("ix_calendar_events_event_date", "event_date"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    event_type: Mapped[str] = mapped_column(String(24), nullable=False)
    created_by_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class BirthdayEmailLog(Base):
    __tablename__ = "birthday_email_logs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'sent', 'failed')",
            name="ck_birthday_email_logs_status",
        ),
        CheckConstraint(
            "attempt_count > 0",
            name="ck_birthday_email_logs_attempt_count",
        ),
        UniqueConstraint(
            "customer_id",
            "birthday_year",
            name="uq_birthday_email_logs_customer_year",
        ),
        Index("ix_birthday_email_logs_year_status", "birthday_year", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    customer_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
    )
    birthday_year: Mapped[int] = mapped_column(Integer, nullable=False)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
