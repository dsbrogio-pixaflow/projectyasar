from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import status
from httpx import ASGITransport, AsyncClient

from app import app


@pytest.fixture
def finance_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ASGITransport:
    database_path = tmp_path / "finance-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "finance-test-key-long-enough-for-hmac-32-bytes")
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
            "full_name": "Finance Manager",
            "email": "finance@example.com",
            "password": "Strong1",
        },
    )
    assert registration.status_code == status.HTTP_201_CREATED
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "finance@example.com", "password": "Strong1"},
    )
    assert login.status_code == status.HTTP_200_OK


async def create_category(client: AsyncClient, name: str = "Transporte") -> str:
    response = await client.post("/api/v1/expense-categories", json={"name": name})
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()["id"]


async def create_expense(
    client: AsyncClient,
    category_id: str,
    amount: str,
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/expenses",
        json={
            "category_id": category_id,
            "expense_date": "2026-11-14",
            "amount": amount,
        },
    )
    return response.json()


async def create_sale(
    client: AsyncClient,
    amount: str,
    product_name: str,
) -> str:
    customer = await client.post(
        "/api/v1/customers",
        json={"full_name": f"{product_name} Customer"},
    )
    assert customer.status_code == status.HTTP_201_CREATED
    product = await client.post(
        "/api/v1/products",
        json={"name": product_name, "current_price": amount},
    )
    assert product.status_code == status.HTTP_201_CREATED
    stock = await client.post(
        "/api/v1/inventory/movements",
        json={
            "product_id": product.json()["id"],
            "occurred_at": "2026-11-14",
            "movement_type": "in",
            "quantity": 1,
            "note": "Initial stock",
        },
    )
    assert stock.status_code == status.HTTP_201_CREATED
    methods = await client.get("/api/v1/delivery-methods")
    sale = await client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer.json()["id"],
            "delivery_method_id": methods.json()[0]["id"],
            "sold_at": "2026-11-14",
            "items": [
                {
                    "product_id": product.json()["id"],
                    "quantity": 1,
                    "unit_price": amount,
                },
            ],
        },
    )
    assert sale.status_code == status.HTTP_201_CREATED
    return sale.json()["id"]


@pytest.mark.anyio
async def test_finance_routes_require_authentication(
    finance_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=finance_database,
        base_url="https://testserver",
    ) as client:
        categories = await client.get("/api/v1/expense-categories")
        expenses = await client.get("/api/v1/expenses")
        summary = await client.get("/api/v1/financial/summary")

    assert categories.status_code == status.HTTP_401_UNAUTHORIZED
    assert expenses.status_code == status.HTTP_401_UNAUTHORIZED
    assert summary.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.anyio
async def test_expense_categories_are_trimmed_and_case_insensitively_unique(
    finance_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=finance_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        created = await client.post(
            "/api/v1/expense-categories",
            json={"name": "  Transporte  "},
        )
        duplicate = await client.post(
            "/api/v1/expense-categories",
            json={"name": "transporte"},
        )
        blank = await client.post(
            "/api/v1/expense-categories",
            json={"name": "  "},
        )
        categories = await client.get("/api/v1/expense-categories")

    assert created.status_code == status.HTTP_201_CREATED
    assert created.json()["name"] == "Transporte"
    assert duplicate.status_code == status.HTTP_409_CONFLICT
    assert blank.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert [category["name"] for category in categories.json()] == ["Transporte"]


@pytest.mark.anyio
async def test_expenses_require_a_valid_category_and_positive_two_decimal_amount(
    finance_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=finance_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        category_id = await create_category(client)
        invalid = [
            await client.post(
                "/api/v1/expenses",
                json={
                    "category_id": category_id,
                    "expense_date": "2026-11-14",
                    "amount": amount,
                },
            )
            for amount in ("0", "-1.00", "1.001")
        ]
        missing_category = await client.post(
            "/api/v1/expenses",
            json={
                "category_id": "00000000-0000-4000-8000-000000000099",
                "expense_date": "2026-11-14",
                "amount": "1.00",
            },
        )
        expenses = await client.get("/api/v1/expenses")

    assert [response.status_code for response in invalid] == [
        status.HTTP_422_UNPROCESSABLE_CONTENT,
    ] * 3
    assert missing_category.status_code == status.HTTP_404_NOT_FOUND
    assert expenses.json()["total"] == 0


@pytest.mark.anyio
async def test_cancelled_expenses_are_audited_and_excluded_from_financial_totals(
    finance_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=finance_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        category_id = await create_category(client, "Aluguel")
        active_expense = await client.post(
            "/api/v1/expenses",
            json={
                "category_id": category_id,
                "expense_date": "2026-11-13",
                "amount": "12.35",
            },
        )
        cancelled_expense = await client.post(
            "/api/v1/expenses",
            json={
                "category_id": category_id,
                "expense_date": "2026-11-14",
                "amount": "4.00",
            },
        )
        expense_id = cancelled_expense.json()["id"]
        cancel = await client.post(
            f"/api/v1/expenses/{expense_id}/cancel",
            json={"reason": "  Lançamento duplicado  "},
        )
        duplicate_cancel = await client.post(
            f"/api/v1/expenses/{expense_id}/cancel",
            json={"reason": "Outra tentativa"},
        )
        listed = await client.get(
            "/api/v1/expenses",
            params={"q": "Aluguel", "status": "cancelled"},
        )
        summary = await client.get("/api/v1/financial/summary")

    assert active_expense.status_code == status.HTTP_201_CREATED
    assert cancelled_expense.status_code == status.HTTP_201_CREATED
    assert cancel.status_code == status.HTTP_200_OK
    assert cancel.json()["status"] == "cancelled"
    assert cancel.json()["cancellation_reason"] == "Lançamento duplicado"
    assert duplicate_cancel.status_code == status.HTTP_409_CONFLICT
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["id"] == expense_id
    assert summary.json() == {
        "total_sales": "0.00",
        "total_expenses": "12.35",
        "net_result": "-12.35",
    }


@pytest.mark.anyio
async def test_financial_summary_counts_completed_sales_only(
    finance_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=finance_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        category_id = await create_category(client, "Materiais")
        await create_expense(client, category_id, "8.00")
        completed_sale_id = await create_sale(client, "20.00", "Completed Sale")
        cancelled_sale_id = await create_sale(client, "15.00", "Cancelled Sale")
        cancellation = await client.post(
            f"/api/v1/sales/{cancelled_sale_id}/cancel",
            json={"reason": "Pedido cancelado pelo cliente"},
        )
        summary = await client.get("/api/v1/financial/summary")
        completed_sale = await client.get(f"/api/v1/sales/{completed_sale_id}")

    assert cancellation.status_code == status.HTTP_200_OK
    assert completed_sale.json()["status"] == "completed"
    assert summary.json() == {
        "total_sales": "20.00",
        "total_expenses": "8.00",
        "net_result": "12.00",
    }
