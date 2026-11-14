from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from database import get_database_url


@pytest.fixture
def migrated_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    database_path = tmp_path / "migration-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    return database_path


@pytest.mark.parametrize(
    ("input_url", "expected_url"),
    [
        (
            "postgres://db:placeholder@localhost/app",
            "postgresql+psycopg://db:placeholder@localhost/app",
        ),
        (
            "postgresql://db:placeholder@localhost/app",
            "postgresql+psycopg://db:placeholder@localhost/app",
        ),
        ("sqlite:///./dev.db", "sqlite:///./dev.db"),
    ],
)
def test_database_url_uses_supported_postgres_driver(
    input_url: str,
    expected_url: str,
) -> None:
    assert get_database_url(input_url) == expected_url


def test_initial_migration_creates_expected_tables(migrated_database: Path) -> None:
    engine = create_engine(f"sqlite:///{migrated_database.as_posix()}")
    try:
        tables = set(inspect(engine).get_table_names())
        assert {"users", "customers", "products", "alembic_version"} <= tables
    finally:
        engine.dispose()


def test_email_uniqueness_ignores_case(migrated_database: Path) -> None:
    engine = create_engine(f"sqlite:///{migrated_database.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO users (id, full_name, email, password_hash, role, status)
                    VALUES (:id, 'Admin', 'Owner@example.com', 'hash', 'admin', 'active')
                    """
                ),
                {"id": "00000000000000000000000000000001"},
            )
            with pytest.raises(IntegrityError):
                connection.execute(
                    text(
                        """
                        INSERT INTO users (id, full_name, email, password_hash, role, status)
                        VALUES (:id, 'Duplicate', 'owner@EXAMPLE.com', 'hash', 'user', 'active')
                        """
                    ),
                    {"id": "00000000000000000000000000000002"},
                )
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("role", "status"),
    [("owner", "active"), ("user", "locked")],
)
def test_user_role_and_status_are_constrained(
    migrated_database: Path,
    role: str,
    status: str,
) -> None:
    engine = create_engine(f"sqlite:///{migrated_database.as_posix()}")
    try:
        with engine.begin() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(
                    text(
                        """
                        INSERT INTO users (id, full_name, email, password_hash, role, status)
                        VALUES (:id, 'User', :email, 'hash', :role, :status)
                        """
                    ),
                    {
                        "id": "00000000000000000000000000000004",
                        "email": f"{role}-{status}@example.com",
                        "role": role,
                        "status": status,
                    },
                )
    finally:
        engine.dispose()


def test_product_price_cannot_be_negative(migrated_database: Path) -> None:
    engine = create_engine(f"sqlite:///{migrated_database.as_posix()}")
    try:
        with engine.begin() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(
                    text(
                        """
                        INSERT INTO products (id, name, current_price)
                        VALUES (:id, 'Product', -0.01)
                        """
                    ),
                    {"id": "00000000000000000000000000000005"},
                )
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("birthday_day", "birthday_month", "valid"),
    [
        (29, 2, True),
        (30, 2, False),
        (31, 4, False),
        (31, 12, True),
        (None, None, True),
        (None, 1, False),
        (1, None, False),
    ],
)
def test_customer_birthday_constraint(
    migrated_database: Path,
    birthday_day: int | None,
    birthday_month: int | None,
    valid: bool,
) -> None:
    engine = create_engine(f"sqlite:///{migrated_database.as_posix()}")
    try:
        with engine.begin() as connection:
            statement = text(
                """
                INSERT INTO customers (id, full_name, birthday_day, birthday_month)
                VALUES (:id, 'Customer', :birthday_day, :birthday_month)
                """
            )
            params = {
                "id": "00000000000000000000000000000003",
                "birthday_day": birthday_day,
                "birthday_month": birthday_month,
            }
            if valid:
                connection.execute(statement, params)
            else:
                with pytest.raises(IntegrityError):
                    connection.execute(statement, params)
    finally:
        engine.dispose()


def test_migration_can_be_downgraded_and_reapplied(migrated_database: Path) -> None:
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{migrated_database.as_posix()}")
    try:
        assert {"users", "customers", "products"} <= set(inspect(engine).get_table_names())
    finally:
        engine.dispose()
