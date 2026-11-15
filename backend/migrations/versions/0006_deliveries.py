"""Add delivery tracking for sales.

Revision ID: 0006_deliveries
Revises: 0005_sales
Create Date: 2026-11-14
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0006_deliveries"
down_revision: str | None = "0005_sales"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deliveries",
        sa.Column("sale_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("delivery_address_snapshot", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=24),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("tracking_code", sa.String(length=200), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
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
            "status IN ('pending', 'out_for_delivery', 'delivered', 'cancelled')",
            name="ck_deliveries_status",
        ),
        sa.CheckConstraint(
            "tracking_code IS NULL OR length(trim(tracking_code)) > 0",
            name="ck_deliveries_tracking_code_not_blank",
        ),
        sa.ForeignKeyConstraint(
            ["sale_id"],
            ["sales.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("sale_id"),
    )
    op.create_index("ix_deliveries_status", "deliveries", ["status"])

    sales = sa.table(
        "sales",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("delivery_address_snapshot", sa.Text()),
        sa.column("status", sa.String(length=16)),
    )
    deliveries = sa.table(
        "deliveries",
        sa.column("sale_id", sa.Uuid(as_uuid=True)),
        sa.column("delivery_address_snapshot", sa.Text()),
        sa.column("status", sa.String(length=24)),
    )
    op.execute(
        sa.insert(deliveries).from_select(
            ["sale_id", "delivery_address_snapshot", "status"],
            sa.select(
                sales.c.id,
                sales.c.delivery_address_snapshot,
                sa.case(
                    (sales.c.status == "cancelled", "cancelled"),
                    else_="pending",
                ),
            ).select_from(sales),
        )
    )


def downgrade() -> None:
    op.drop_index("ix_deliveries_status", table_name="deliveries")
    op.drop_table("deliveries")
