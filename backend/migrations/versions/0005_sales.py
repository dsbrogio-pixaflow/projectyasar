"""Add sales, sale items, and delivery methods.

Revision ID: 0005_sales
Revises: 0004_inventory_movements
Create Date: 2026-11-14
"""

from typing import Sequence
from uuid import UUID

from alembic import op
import sqlalchemy as sa


revision: str = "0005_sales"
down_revision: str | None = "0004_inventory_movements"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "delivery_methods",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_delivery_methods_name_not_blank",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_delivery_methods_name_lower",
        "delivery_methods",
        [sa.text("lower(name)")],
        unique=True,
    )
    delivery_methods = sa.table(
        "delivery_methods",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("name", sa.String(length=120)),
    )
    op.bulk_insert(
        delivery_methods,
        [
            {"id": UUID("00000000-0000-4000-8000-000000000001"), "name": "Sedex"},
            {
                "id": UUID("00000000-0000-4000-8000-000000000002"),
                "name": "Transportadora",
            },
            {
                "id": UUID("00000000-0000-4000-8000-000000000003"),
                "name": "Retirada na loja",
            },
            {
                "id": UUID("00000000-0000-4000-8000-000000000004"),
                "name": "Entregar pessoalmente",
            },
        ],
    )

    op.create_table(
        "sales",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("customer_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("customer_name_snapshot", sa.String(length=200), nullable=False),
        sa.Column("delivery_address_snapshot", sa.Text(), nullable=True),
        sa.Column("delivery_method_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "delivery_method_name_snapshot",
            sa.String(length=120),
            nullable=False,
        ),
        sa.Column("sold_at", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=17, scale=2), nullable=False),
        sa.Column("cancellation_reason", sa.String(length=500), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("cancelled_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('completed', 'cancelled')",
            name="ck_sales_status",
        ),
        sa.CheckConstraint(
            """
            (status = 'completed' AND cancelled_at IS NULL AND cancellation_reason IS NULL)
            OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
            """,
            name="ck_sales_cancellation_state",
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["delivery_method_id"],
            ["delivery_methods.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sales_sold_at", "sales", ["sold_at"])
    op.create_index("ix_sales_status", "sales", ["status"])

    op.create_table(
        "sale_items",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("sale_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("product_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("line_number", sa.SmallInteger(), nullable=False),
        sa.Column("product_name_snapshot", sa.String(length=200), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "quantity BETWEEN 1 AND 1000",
            name="ck_sale_items_quantity",
        ),
        sa.CheckConstraint(
            "line_number BETWEEN 1 AND 50",
            name="ck_sale_items_line_number",
        ),
        sa.ForeignKeyConstraint(
            ["sale_id"],
            ["sales.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_sale_items_sale_product",
        "sale_items",
        ["sale_id", "product_id"],
        unique=True,
    )
    op.create_index(
        "uq_sale_items_sale_line",
        "sale_items",
        ["sale_id", "line_number"],
        unique=True,
    )
    op.create_index("ix_sale_items_product_id", "sale_items", ["product_id"])
    op.create_index(
        "uq_inventory_movements_sale_item",
        "inventory_movements",
        ["source_id"],
        unique=True,
        postgresql_where=sa.text(
            "source_type = 'sale' AND movement_type = 'out'"
        ),
        sqlite_where=sa.text("source_type = 'sale' AND movement_type = 'out'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_inventory_movements_sale_item",
        table_name="inventory_movements",
    )
    op.drop_index("ix_sale_items_product_id", table_name="sale_items")
    op.drop_index("uq_sale_items_sale_line", table_name="sale_items")
    op.drop_index("uq_sale_items_sale_product", table_name="sale_items")
    op.drop_table("sale_items")
    op.drop_index("ix_sales_status", table_name="sales")
    op.drop_index("ix_sales_sold_at", table_name="sales")
    op.drop_table("sales")
    op.drop_index("uq_delivery_methods_name_lower", table_name="delivery_methods")
    op.drop_table("delivery_methods")
