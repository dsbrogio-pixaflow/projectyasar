from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import status
from httpx import ASGITransport, AsyncClient, Response

from app import app


@pytest.fixture
def deliveries_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ASGITransport:
    database_path = tmp_path / "deliveries-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv(
        "RATE_LIMIT_HMAC_KEY",
        "deliveries-test-hmac-key-that-is-at-least-32-bytes",
    )
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
            "full_name": "Delivery Manager",
            "email": "delivery@example.com",
            "password": "Strong1",
        },
    )
    assert registration.status_code == status.HTTP_201_CREATED
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "delivery@example.com", "password": "Strong1"},
    )
    assert login.status_code == status.HTTP_200_OK


async def create_sale(client: AsyncClient, method_name: str = "Retirada na loja") -> Response:
    customer = await client.post(
        "/api/v1/customers",
        json={
            "full_name": "Delivery Customer",
            "delivery_address": "Rua das Flores, 123",
        },
    )
    assert customer.status_code == status.HTTP_201_CREATED
    product = await client.post(
        "/api/v1/products",
        json={"name": "Delivery Product", "current_price": "10.00"},
    )
    assert product.status_code == status.HTTP_201_CREATED
    stock = await client.post(
        "/api/v1/inventory/movements",
        json={
            "product_id": product.json()["id"],
            "occurred_at": "2026-11-14",
            "movement_type": "in",
            "quantity": 3,
            "note": "Initial stock",
        },
    )
    assert stock.status_code == status.HTTP_201_CREATED
    methods = await client.get("/api/v1/delivery-methods")
    delivery_method = next(
        method for method in methods.json() if method["name"] == method_name
    )
    return await client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer.json()["id"],
            "delivery_method_id": delivery_method["id"],
            "sold_at": "2026-11-14",
            "items": [
                {
                    "product_id": product.json()["id"],
                    "quantity": 1,
                    "unit_price": "10.00",
                },
            ],
        },
    )


@pytest.mark.anyio
async def test_delivery_routes_require_authentication(
    deliveries_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=deliveries_database,
        base_url="https://testserver",
    ) as client:
        deliveries = await client.get("/api/v1/deliveries")

    assert deliveries.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.anyio
async def test_sale_creates_pending_delivery_for_pickup_and_tracking_is_editable(
    deliveries_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=deliveries_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        sale = await create_sale(client)
        sale_id = sale.json()["id"]
        initial_delivery = await client.get(f"/api/v1/deliveries/{sale_id}")
        updated_delivery = await client.patch(
            f"/api/v1/deliveries/{sale_id}",
            json={
                "status": "delivered",
                "tracking_code": "  BR123456789  ",
            },
        )
        cleared_tracking_code = await client.patch(
            f"/api/v1/deliveries/{sale_id}",
            json={"tracking_code": "   "},
        )
        sale_after_delivery_update = await client.get(f"/api/v1/sales/{sale_id}")
        filtered_deliveries = await client.get(
            "/api/v1/deliveries",
            params={"q": "Delivery Customer", "status": "delivered"},
        )

    assert sale.status_code == status.HTTP_201_CREATED
    assert initial_delivery.status_code == status.HTTP_200_OK
    initial_data = initial_delivery.json()
    assert {
        key: initial_data[key]
        for key in (
            "sale_id",
            "customer_name",
            "delivery_address_snapshot",
            "delivery_method_name",
            "sold_at",
            "sale_status",
            "status",
            "tracking_code",
        )
    } == {
        "sale_id": sale_id,
        "customer_name": "Delivery Customer",
        "delivery_address_snapshot": "Rua das Flores, 123",
        "delivery_method_name": "Retirada na loja",
        "sold_at": "2026-11-14",
        "sale_status": "completed",
        "status": "pending",
        "tracking_code": None,
    }
    assert initial_data["updated_at"]
    assert updated_delivery.status_code == status.HTTP_200_OK
    assert updated_delivery.json()["status"] == "delivered"
    assert updated_delivery.json()["tracking_code"] == "BR123456789"
    assert cleared_tracking_code.status_code == status.HTTP_200_OK
    assert cleared_tracking_code.json()["tracking_code"] is None
    assert sale_after_delivery_update.json()["status"] == "completed"
    assert filtered_deliveries.json()["total"] == 1
    assert filtered_deliveries.json()["items"][0]["sale_id"] == sale_id


@pytest.mark.anyio
async def test_cancelling_delivery_does_not_cancel_its_sale(
    deliveries_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=deliveries_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        sale = await create_sale(client)
        sale_id = sale.json()["id"]
        cancelled_delivery = await client.patch(
            f"/api/v1/deliveries/{sale_id}",
            json={"status": "cancelled"},
        )
        sale_after = await client.get(f"/api/v1/sales/{sale_id}")

    assert cancelled_delivery.status_code == status.HTTP_200_OK
    assert cancelled_delivery.json()["status"] == "cancelled"
    assert sale_after.json()["status"] == "completed"


@pytest.mark.anyio
async def test_cancelled_sale_deliveries_cannot_be_reopened(
    deliveries_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=deliveries_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        sale = await create_sale(client)
        sale_id = sale.json()["id"]
        cancelled_sale = await client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Pedido cancelado pelo cliente"},
        )
        reopen_delivery = await client.patch(
            f"/api/v1/deliveries/{sale_id}",
            json={"status": "pending"},
        )

    assert cancelled_sale.status_code == status.HTTP_200_OK
    assert reopen_delivery.status_code == status.HTTP_409_CONFLICT
    assert reopen_delivery.json()["detail"] == "Cancelled sales do not allow delivery updates"


@pytest.mark.anyio
async def test_delivery_migration_backfills_existing_sales(
    deliveries_database: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=deliveries_database,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        active_sale = await create_sale(client)
        cancelled_sale = await create_sale(client)
        cancelled_sale_id = cancelled_sale.json()["id"]
        cancelled_sale = await client.post(
            f"/api/v1/sales/{cancelled_sale_id}/cancel",
            json={"reason": "Cancelado antes da nova entrega"},
        )
        assert cancelled_sale.status_code == status.HTTP_200_OK

        config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
        command.downgrade(config, "0005_sales")
        command.upgrade(config, "head")
        deliveries = await client.get("/api/v1/deliveries")

    assert deliveries.status_code == status.HTTP_200_OK
    assert deliveries.json()["total"] == 2
    delivery_statuses = {
        item["sale_id"]: item["status"]
        for item in deliveries.json()["items"]
    }
    assert delivery_statuses == {
        active_sale.json()["id"]: "pending",
        cancelled_sale_id: "cancelled",
    }
