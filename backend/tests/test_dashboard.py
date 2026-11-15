from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from alembic import command
from alembic.config import Config
from fastapi import status
from httpx import ASGITransport, AsyncClient

from app import app


@pytest.fixture
def dashboard_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ASGITransport:
    database_path = tmp_path / "dashboard-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "dashboard-test-key-long-enough-for-hmac-32-bytes")
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    return ASGITransport(app=app)


async def authenticate(client: AsyncClient) -> None:
    registration = await client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Dashboard Manager",
            "email": "dashboard@example.com",
            "password": "Strong1",
        },
    )
    assert registration.status_code == status.HTTP_201_CREATED
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "dashboard@example.com", "password": "Strong1"},
    )
    assert login.status_code == status.HTTP_200_OK


def current_month_start() -> date:
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date().replace(day=1)


def month_keys_ending_at_current() -> list[str]:
    month = current_month_start()
    months = []
    for _ in range(11):
        if month.month == 1:
            month = date(month.year - 1, 12, 1)
        else:
            month = date(month.year, month.month - 1, 1)
    for _ in range(12):
        months.append(month.strftime("%Y-%m"))
        if month.month == 12:
            month = date(month.year + 1, 1, 1)
        else:
            month = date(month.year, month.month + 1, 1)
    return months


async def create_sale(
    client: AsyncClient,
    customer_id: str,
    product_id: str,
    delivery_method_id: str,
    sold_at: date,
    quantity: int,
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "delivery_method_id": delivery_method_id,
            "sold_at": sold_at.isoformat(),
            "items": [
                {
                    "product_id": product_id,
                    "quantity": quantity,
                    "unit_price": "10.00",
                },
            ],
        },
    )
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()


@pytest.mark.anyio
async def test_dashboard_requires_authentication_and_returns_twelve_months(
    dashboard_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=dashboard_database,
        base_url="https://testserver",
    ) as client:
        unauthenticated = await client.get("/api/v1/dashboard")
        await authenticate(client)
        dashboard = await client.get("/api/v1/dashboard")

    assert unauthenticated.status_code == status.HTTP_401_UNAUTHORIZED
    assert dashboard.status_code == status.HTTP_200_OK
    assert dashboard.json()["current_stock_balance"] == 0
    assert [month["month"] for month in dashboard.json()["months"]] == (
        month_keys_ending_at_current()
    )
    assert all(
        month["inventory_entries"] == 0
        and month["inventory_exits"] == 0
        and month["units_sold"] == 0
        and month["expenses"] == "0.00"
        for month in dashboard.json()["months"]
    )


@pytest.mark.anyio
async def test_dashboard_aggregates_inventory_sales_and_active_expenses(
    dashboard_database: ASGITransport,
) -> None:
    today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    this_month = today.replace(day=1)
    last_month = this_month - timedelta(days=1)
    async with AsyncClient(
        transport=dashboard_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        customer = await client.post(
            "/api/v1/customers",
            json={"full_name": "Dashboard Customer"},
        )
        product = await client.post(
            "/api/v1/products",
            json={"name": "Dashboard Product", "current_price": "10.00"},
        )
        stock = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product.json()["id"],
                "occurred_at": today.isoformat(),
                "movement_type": "in",
                "quantity": 10,
                "note": "Initial stock",
            },
        )
        temporary_stock = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product.json()["id"],
                "occurred_at": today.isoformat(),
                "movement_type": "in",
                "quantity": 2,
                "note": "Stock to reverse",
            },
        )
        stock_reversal = await client.post(
            f"/api/v1/inventory/movements/{temporary_stock.json()['movement']['id']}/reverse",
            json={"reason": "Correction"},
        )
        methods = await client.get("/api/v1/delivery-methods")
        delivery_method_id = methods.json()[0]["id"]
        completed_sale = await create_sale(
            client,
            customer.json()["id"],
            product.json()["id"],
            delivery_method_id,
            today,
            2,
        )
        cancelled_sale = await create_sale(
            client,
            customer.json()["id"],
            product.json()["id"],
            delivery_method_id,
            last_month,
            1,
        )
        sale_cancellation = await client.post(
            f"/api/v1/sales/{cancelled_sale['id']}/cancel",
            json={"reason": "Pedido cancelado"},
        )
        category = await client.post(
            "/api/v1/expense-categories",
            json={"name": "Despesas do painel"},
        )
        active_expense = await client.post(
            "/api/v1/expenses",
            json={
                "category_id": category.json()["id"],
                "expense_date": today.isoformat(),
                "amount": "4.50",
            },
        )
        cancelled_expense = await client.post(
            "/api/v1/expenses",
            json={
                "category_id": category.json()["id"],
                "expense_date": today.isoformat(),
                "amount": "9.00",
            },
        )
        expense_cancellation = await client.post(
            f"/api/v1/expenses/{cancelled_expense.json()['id']}/cancel",
            json={"reason": "Duplicada"},
        )
        negative_movement = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product.json()["id"],
                "occurred_at": today.isoformat(),
                "movement_type": "out",
                "quantity": 10,
                "note": "Legacy-compatible negative balance",
            },
        )
        dashboard = await client.get("/api/v1/dashboard")

    assert stock.status_code == status.HTTP_201_CREATED
    assert stock_reversal.status_code == status.HTTP_200_OK
    assert completed_sale["status"] == "completed"
    assert sale_cancellation.status_code == status.HTTP_200_OK
    assert active_expense.status_code == status.HTTP_201_CREATED
    assert expense_cancellation.status_code == status.HTTP_200_OK
    assert negative_movement.status_code == status.HTTP_201_CREATED
    assert negative_movement.json()["negative_balance_warning"] is True
    assert dashboard.status_code == status.HTTP_200_OK
    assert dashboard.json()["current_stock_balance"] == -2
    months = {month["month"]: month for month in dashboard.json()["months"]}
    current_key = today.strftime("%Y-%m")
    previous_key = last_month.strftime("%Y-%m")
    assert months[current_key] == {
        "month": current_key,
        "inventory_entries": 13,
        "inventory_exits": 14,
        "units_sold": 2,
        "expenses": "4.50",
    }
    assert months[previous_key] == {
        "month": previous_key,
        "inventory_entries": 0,
        "inventory_exits": 1,
        "units_sold": 0,
        "expenses": "0.00",
    }
