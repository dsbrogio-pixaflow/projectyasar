"""Add auditable inventory movements.

Revision ID: 0004_inventory_movements
Revises: 0003_auth_rate_limits
Create Date: 2026-11-14
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0004_inventory_movements"
down_revision: str | None = "0003_auth_rate_limits"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_movements",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("product_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("occurred_at", sa.Date(), nullable=False),
        sa.Column("movement_type", sa.String(length=16), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("reversal_of_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "movement_type IN ('in', 'out', 'reversal')",
            name="ck_inventory_movements_type",
        ),
        sa.CheckConstraint(
            "quantity > 0",
            name="ck_inventory_movements_quantity",
        ),
        sa.CheckConstraint(
            "source_type IN ('manual', 'sale')",
            name="ck_inventory_movements_source_type",
        ),
        sa.CheckConstraint(
            """
            (movement_type = 'reversal' AND reversal_of_id IS NOT NULL)
            OR (movement_type != 'reversal' AND reversal_of_id IS NULL)
            """,
            name="ck_inventory_movements_reversal_reference",
        ),
        sa.CheckConstraint(
            """
            (source_type = 'manual' AND source_id IS NULL)
            OR (source_type = 'sale' AND source_id IS NOT NULL)
            """,
            name="ck_inventory_movements_source_reference",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reversal_of_id"],
            ["inventory_movements.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_inventory_movements_product_date",
        "inventory_movements",
        ["product_id", "occurred_at"],
    )
    op.create_index(
        "uq_inventory_movements_reversal_of",
        "inventory_movements",
        ["reversal_of_id"],
        unique=True,
    )
    op.create_index(
        "ix_inventory_movements_created_by_user_id",
        "inventory_movements",
        ["created_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_inventory_movements_created_by_user_id",
        table_name="inventory_movements",
    )
    op.drop_index(
        "uq_inventory_movements_reversal_of",
        table_name="inventory_movements",
    )
    op.drop_index(
        "ix_inventory_movements_product_date",
        table_name="inventory_movements",
    )
    op.drop_table("inventory_movements")
