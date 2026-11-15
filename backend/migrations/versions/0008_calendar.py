"""Add calendar events and birthday email delivery logs.

Revision ID: 0008_calendar
Revises: 0007_finance
Create Date: 2026-11-15
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0008_calendar"
down_revision: str | None = "0007_finance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("event_type", sa.String(length=24), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('holiday', 'commemorative', 'other')",
            name="ck_calendar_events_type",
        ),
        sa.CheckConstraint(
            "length(trim(description)) > 0",
            name="ck_calendar_events_description_not_blank",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_events_event_date",
        "calendar_events",
        ["event_date"],
    )

    op.create_table(
        "birthday_email_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("customer_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("birthday_year", sa.Integer(), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed')",
            name="ck_birthday_email_logs_status",
        ),
        sa.CheckConstraint(
            "attempt_count > 0",
            name="ck_birthday_email_logs_attempt_count",
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "customer_id",
            "birthday_year",
            name="uq_birthday_email_logs_customer_year",
        ),
    )
    op.create_index(
        "ix_birthday_email_logs_year_status",
        "birthday_email_logs",
        ["birthday_year", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_birthday_email_logs_year_status",
        table_name="birthday_email_logs",
    )
    op.drop_table("birthday_email_logs")
    op.drop_index("ix_calendar_events_event_date", table_name="calendar_events")
    op.drop_table("calendar_events")
