from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient, Response

from app import app


@pytest.fixture
def sales_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ASGITransport:
    database_path = tmp_path / "sales-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "sales-test-hmac-key-that-is-at-least-32-bytes")
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
            "full_name": "Sales Manager",
            "email": "sales@example.com",
            "password": "Strong1",
        },
    )
    assert registration.status_code == 201
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "sales@example.com", "password": "Strong1"},
    )
    assert login.status_code == 200


async def create_customer(client: AsyncClient, name: str = "Sales Customer") -> str:
    response = await client.post(
        "/api/v1/customers",
        json={
            "full_name": name,
            "delivery_address": "Rua das Flores, 123",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


async def create_product(
    client: AsyncClient,
    name: str,
    current_price: str = "10.00",
) -> str:
    response = await client.post(
        "/api/v1/products",
        json={"name": name, "current_price": current_price},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def add_stock(client: AsyncClient, product_id: str, quantity: int) -> None:
    response = await client.post(
        "/api/v1/inventory/movements",
        json={
            "product_id": product_id,
            "occurred_at": "2026-11-14",
            "movement_type": "in",
            "quantity": quantity,
            "note": "Initial stock",
        },
    )
    assert response.status_code == 201


async def create_sale(
    client: AsyncClient,
    customer_id: str,
    delivery_method_id: str,
    items: list[dict[str, object]],
) -> Response:
    return await client.post(
        "/api/v1/sales",
        json={
            "customer_id": customer_id,
            "delivery_method_id": delivery_method_id,
            "sold_at": "2026-11-14",
            "items": items,
        },
    )


@pytest.mark.anyio
async def test_sales_and_delivery_routes_require_authentication(
    sales_database: ASGITransport,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        sales = await client.get("/api/v1/sales")
        delivery_methods = await client.get("/api/v1/delivery-methods")

    assert sales.status_code == 401
    assert delivery_methods.status_code == 401


@pytest.mark.anyio
async def test_multi_item_sale_preserves_price_snapshots_and_negative_prices(
    sales_database: ASGITransport,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        await authenticate(client)
        customer_id = await create_customer(client, "Maria Silva")
        first_product_id = await create_product(client, "Blusa Azul", "15.00")
        second_product_id = await create_product(client, "Calça Preta", "20.00")
        await add_stock(client, first_product_id, 10)
        await add_stock(client, second_product_id, 4)
        delivery_methods = await client.get("/api/v1/delivery-methods")
        sedex = next(
            item for item in delivery_methods.json() if item["name"] == "Sedex"
        )

        sale = await create_sale(
            client,
            customer_id,
            sedex["id"],
            [
                {
                    "product_id": first_product_id,
                    "quantity": 2,
                    "unit_price": "12.50",
                },
                {
                    "product_id": second_product_id,
                    "quantity": 3,
                    "unit_price": "-2.00",
                },
            ],
        )
        inventory_first = await client.get(
            "/api/v1/inventory/summary",
            params={"product_id": first_product_id},
        )
        inventory_second = await client.get(
            "/api/v1/inventory/summary",
            params={"product_id": second_product_id},
        )
        summary = await client.get("/api/v1/sales/summary")
        await client.put(
            f"/api/v1/customers/{customer_id}",
            json={"full_name": "Maria Silva Atualizada"},
        )
        await client.put(
            f"/api/v1/products/{first_product_id}",
            json={"name": "Blusa Azul Nova", "current_price": "99.99"},
        )
        saved_sale = await client.get(f"/api/v1/sales/{sale.json()['id']}")

    assert delivery_methods.status_code == 200
    assert sale.status_code == 201
    assert Decimal(sale.json()["total_amount"]) == Decimal("19.00")
    assert sale.json()["status"] == "completed"
    assert sale.json()["customer_name_snapshot"] == "Maria Silva"
    assert sale.json()["delivery_address_snapshot"] == "Rua das Flores, 123"
    assert sale.json()["delivery_method_name_snapshot"] == "Sedex"
    assert [
        item["product_name_snapshot"] for item in sale.json()["items"]
    ] == ["Blusa Azul", "Calça Preta"]
    assert [item["line_number"] for item in sale.json()["items"]] == [1, 2]
    assert Decimal(sale.json()["items"][0]["line_total"]) == Decimal("25.00")
    assert Decimal(sale.json()["items"][1]["line_total"]) == Decimal("-6.00")
    assert inventory_first.json()["items"][0]["balance"] == 8
    assert inventory_second.json()["items"][0]["balance"] == 1
    assert len(summary.json()) == 2
    assert saved_sale.json()["customer_name_snapshot"] == "Maria Silva"
    assert saved_sale.json()["items"][0]["product_name_snapshot"] == "Blusa Azul"
    assert saved_sale.json()["items"][0]["unit_price"] == "12.50"


@pytest.mark.anyio
async def test_insufficient_stock_rejects_sale_without_partial_writes(
    sales_database: ASGITransport,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        await authenticate(client)
        customer_id = await create_customer(client)
        product_id = await create_product(client, "Limited Stock")
        await add_stock(client, product_id, 1)
        delivery_methods = await client.get("/api/v1/delivery-methods")
        delivery_method_id = delivery_methods.json()[0]["id"]

        sale = await create_sale(
            client,
            customer_id,
            delivery_method_id,
            [{"product_id": product_id, "quantity": 2, "unit_price": "10.00"}],
        )
        sales = await client.get("/api/v1/sales")
        inventory = await client.get(
            "/api/v1/inventory/summary",
            params={"product_id": product_id},
        )
        movements = await client.get(
            "/api/v1/inventory/movements",
            params={"product_id": product_id},
        )

    assert sale.status_code == 409
    assert "Insufficient stock" in sale.json()["detail"]
    assert sales.json()["total"] == 0
    assert inventory.json()["items"][0]["balance"] == 1
    assert movements.json()["total"] == 1


@pytest.mark.anyio
async def test_cancellation_restores_stock_and_cannot_be_repeated_or_manually_reversed(
    sales_database: ASGITransport,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        await authenticate(client)
        customer_id = await create_customer(client)
        product_id = await create_product(client, "Cancelled Item")
        await add_stock(client, product_id, 5)
        delivery_methods = await client.get("/api/v1/delivery-methods")
        delivery_method_id = delivery_methods.json()[0]["id"]
        sale = await create_sale(
            client,
            customer_id,
            delivery_method_id,
            [{"product_id": product_id, "quantity": 3, "unit_price": "10.00"}],
        )
        sale_id = sale.json()["id"]
        cancel = await client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Pedido cancelado pelo cliente"},
        )
        delivery = await client.get(f"/api/v1/deliveries/{sale_id}")
        duplicate_cancel = await client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Tentativa duplicada"},
        )
        inventory = await client.get(
            "/api/v1/inventory/summary",
            params={"product_id": product_id},
        )
        summary = await client.get("/api/v1/sales/summary")
        movements = await client.get(
            "/api/v1/inventory/movements",
            params={"product_id": product_id},
        )
        sale_movement = next(
            item for item in movements.json()["items"]
            if item["source_type"] == "sale" and item["movement_type"] == "out"
        )
        manual_reverse = await client.post(
            f"/api/v1/inventory/movements/{sale_movement['id']}/reverse",
            json={"reason": "Use o cancelamento da venda"},
        )

    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"
    assert cancel.json()["cancellation_reason"] == "Pedido cancelado pelo cliente"
    assert delivery.status_code == 200
    assert delivery.json()["status"] == "cancelled"
    assert duplicate_cancel.status_code == 409
    assert inventory.json()["items"][0]["balance"] == 5
    assert summary.json() == []
    assert movements.json()["total"] == 3
    assert manual_reverse.status_code == 409


@pytest.mark.parametrize("delivery_status", ["out_for_delivery", "delivered"])
@pytest.mark.anyio
async def test_sale_cannot_be_cancelled_after_delivery_leaves_or_completes(
    sales_database: ASGITransport,
    delivery_status: str,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        await authenticate(client)
        customer_id = await create_customer(client)
        product_id = await create_product(client, "Shipped Product")
        await add_stock(client, product_id, 5)
        delivery_methods = await client.get("/api/v1/delivery-methods")
        delivery_method_id = delivery_methods.json()[0]["id"]
        sale = await create_sale(
            client,
            customer_id,
            delivery_method_id,
            [{"product_id": product_id, "quantity": 2, "unit_price": "10.00"}],
        )
        sale_id = sale.json()["id"]
        delivery = await client.patch(
            f"/api/v1/deliveries/{sale_id}",
            json={"status": delivery_status},
        )
        cancel = await client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Pedido cancelado pelo cliente"},
        )
        saved_sale = await client.get(f"/api/v1/sales/{sale_id}")
        inventory = await client.get(
            "/api/v1/inventory/summary",
            params={"product_id": product_id},
        )

    assert delivery.status_code == 200
    assert cancel.status_code == 409
    assert "cannot be cancelled" in cancel.json()["detail"]
    assert saved_sale.json()["status"] == "completed"
    assert inventory.json()["items"][0]["balance"] == 3


@pytest.mark.anyio
async def test_sale_can_be_cancelled_if_delivery_was_cancelled_independently(
    sales_database: ASGITransport,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        await authenticate(client)
        customer_id = await create_customer(client)
        product_id = await create_product(client, "Cancelled Delivery Product")
        await add_stock(client, product_id, 2)
        delivery_methods = await client.get("/api/v1/delivery-methods")
        delivery_method_id = delivery_methods.json()[0]["id"]
        sale = await create_sale(
            client,
            customer_id,
            delivery_method_id,
            [{"product_id": product_id, "quantity": 1, "unit_price": "10.00"}],
        )
        sale_id = sale.json()["id"]
        delivery = await client.patch(
            f"/api/v1/deliveries/{sale_id}",
            json={"status": "cancelled"},
        )
        cancel = await client.post(
            f"/api/v1/sales/{sale_id}/cancel",
            json={"reason": "Pedido cancelado pelo cliente"},
        )
        saved_delivery = await client.get(f"/api/v1/deliveries/{sale_id}")

    assert delivery.status_code == 200
    assert cancel.status_code == 200
    assert saved_delivery.json()["status"] == "cancelled"


@pytest.mark.anyio
async def test_sale_rejects_duplicate_products_and_invalid_prices_or_quantities(
    sales_database: ASGITransport,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        await authenticate(client)
        customer_id = await create_customer(client)
        product_id = await create_product(client, "Validation Product")
        delivery_methods = await client.get("/api/v1/delivery-methods")
        delivery_method_id = delivery_methods.json()[0]["id"]
        invalid_payloads = [
            [
                {"product_id": product_id, "quantity": 1, "unit_price": "10.00"},
                {"product_id": product_id, "quantity": 1, "unit_price": "10.00"},
            ],
            [{"product_id": product_id, "quantity": 0, "unit_price": "10.00"}],
            [{"product_id": product_id, "quantity": 1001, "unit_price": "10.00"}],
            [{"product_id": product_id, "quantity": 1, "unit_price": "10.001"}],
        ]
        responses = [
            await create_sale(client, customer_id, delivery_method_id, items)
            for items in invalid_payloads
        ]

    assert [response.status_code for response in responses] == [422, 422, 422, 422]


@pytest.mark.anyio
async def test_delivery_methods_can_be_added_and_names_are_case_insensitive(
    sales_database: ASGITransport,
) -> None:
    async with AsyncClient(transport=sales_database, base_url="https://testserver") as client:
        await authenticate(client)
        created = await client.post(
            "/api/v1/delivery-methods",
            json={"name": "Entrega Expressa"},
        )
        duplicate = await client.post(
            "/api/v1/delivery-methods",
            json={"name": "entrega expressa"},
        )
        blank = await client.post(
            "/api/v1/delivery-methods",
            json={"name": "   "},
        )

    assert created.status_code == 201
    assert created.json()["name"] == "Entrega Expressa"
    assert duplicate.status_code == 409
    assert blank.status_code == 422
