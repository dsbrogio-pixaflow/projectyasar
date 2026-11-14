from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import app
from models import InventoryMovement, Product, User


@pytest.fixture
def inventory_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[str, ASGITransport]:
    database_path = tmp_path / "inventory-test.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "inventory-test-hmac-key-that-is-at-least-32-bytes")
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    return database_url, ASGITransport(app=app)


async def authenticate(client: AsyncClient) -> None:
    registration = await client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Inventory Manager",
            "email": "manager@example.com",
            "password": "Strong1",
        },
    )
    assert registration.status_code == 201
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "manager@example.com", "password": "Strong1"},
    )
    assert login.status_code == 200


async def create_product(client: AsyncClient, name: str = "Inventory Product") -> str:
    response = await client.post(
        "/api/v1/products",
        json={"name": name, "current_price": "10.00"},
    )
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.anyio
async def test_inventory_routes_require_an_authenticated_session(
    inventory_database: tuple[str, ASGITransport],
) -> None:
    _, transport = inventory_database
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await client.get("/api/v1/inventory/summary")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_negative_balance_is_allowed_and_flagged_then_reversal_restores_balance(
    inventory_database: tuple[str, ASGITransport],
) -> None:
    _, transport = inventory_database
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await authenticate(client)
        product_id = await create_product(client)
        entry = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product_id,
                "occurred_at": "2026-11-14",
                "movement_type": "in",
                "quantity": 5,
                "note": "Initial stock",
            },
        )
        exit_movement = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product_id,
                "occurred_at": "2026-11-14",
                "movement_type": "out",
                "quantity": 8,
            },
        )
        summary_negative = await client.get("/api/v1/inventory/summary")
        reverse = await client.post(
            f"/api/v1/inventory/movements/{exit_movement.json()['movement']['id']}/reverse",
            json={"reason": "Saída registrada com quantidade incorreta"},
        )
        summary_restored = await client.get("/api/v1/inventory/summary")
        reverse_entry = await client.post(
            f"/api/v1/inventory/movements/{entry.json()['movement']['id']}/reverse",
            json={"reason": "Entrada também lançada incorretamente"},
        )
        summary_cleared = await client.get("/api/v1/inventory/summary")
        movements = await client.get(
            "/api/v1/inventory/movements",
            params={"product_id": product_id},
        )

        repeated_reverse = await client.post(
            f"/api/v1/inventory/movements/{exit_movement.json()['movement']['id']}/reverse",
            json={"reason": "Tentativa duplicada"},
        )
        reverse_of_reversal = await client.post(
            f"/api/v1/inventory/movements/{reverse.json()['movement']['id']}/reverse",
            json={"reason": "Não permitido"},
        )

    assert entry.status_code == 201
    assert entry.json()["balance_after"] == 5
    assert entry.json()["negative_balance_warning"] is False
    assert exit_movement.status_code == 201
    assert exit_movement.json()["balance_after"] == -3
    assert exit_movement.json()["negative_balance_warning"] is True
    assert summary_negative.json()["items"][0]["total_entries"] == 5
    assert summary_negative.json()["items"][0]["total_exits"] == 8
    assert summary_negative.json()["items"][0]["balance"] == -3
    assert reverse.status_code == 200
    assert reverse.json()["balance_after"] == 5
    assert reverse.json()["negative_balance_warning"] is False
    assert summary_restored.json()["items"][0]["total_entries"] == 5
    assert summary_restored.json()["items"][0]["total_exits"] == 0
    assert summary_restored.json()["items"][0]["balance"] == 5
    assert reverse_entry.status_code == 200
    assert summary_cleared.json()["items"][0]["total_entries"] == 0
    assert summary_cleared.json()["items"][0]["total_exits"] == 0
    assert summary_cleared.json()["items"][0]["balance"] == 0
    assert movements.json()["total"] == 4
    assert any(
        item["id"] == exit_movement.json()["movement"]["id"] and item["is_reversed"]
        for item in movements.json()["items"]
    )
    assert repeated_reverse.status_code == 409
    assert reverse_of_reversal.status_code == 409


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("movement_type", "quantity"),
    [
        ("incoming", 1),
        ("in", 0),
        ("out", -1),
        ("in", 1_000_001),
    ],
)
async def test_inventory_rejects_invalid_movement_type_or_quantity(
    inventory_database: tuple[str, ASGITransport],
    movement_type: str,
    quantity: int,
) -> None:
    _, transport = inventory_database
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await authenticate(client)
        product_id = await create_product(client)
        response = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product_id,
                "occurred_at": "2026-11-14",
                "movement_type": movement_type,
                "quantity": quantity,
            },
        )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_inventory_rejects_movement_for_archived_product(
    inventory_database: tuple[str, ASGITransport],
) -> None:
    _, transport = inventory_database
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await authenticate(client)
        product_id = await create_product(client)
        archive = await client.post(f"/api/v1/products/{product_id}/archive")
        movement = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product_id,
                "occurred_at": "2026-11-14",
                "movement_type": "in",
                "quantity": 1,
            },
        )

    assert archive.status_code == 200
    assert movement.status_code == 409


@pytest.mark.anyio
async def test_manual_movement_can_be_reversed_after_product_is_archived(
    inventory_database: tuple[str, ASGITransport],
) -> None:
    _, transport = inventory_database
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await authenticate(client)
        product_id = await create_product(client)
        movement = await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product_id,
                "occurred_at": "2026-11-14",
                "movement_type": "in",
                "quantity": 2,
            },
        )
        archive = await client.post(f"/api/v1/products/{product_id}/archive")
        reverse = await client.post(
            f"/api/v1/inventory/movements/{movement.json()['movement']['id']}/reverse",
            json={"reason": "Corrigir lancamento historico"},
        )

    assert archive.status_code == 200
    assert reverse.status_code == 200
    assert reverse.json()["balance_after"] == 0


@pytest.mark.anyio
async def test_inventory_summary_paginates_and_filters_by_product_name(
    inventory_database: tuple[str, ASGITransport],
) -> None:
    _, transport = inventory_database
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await authenticate(client)
        await create_product(client, "Bermuda Azul")
        await create_product(client, "Bermuda Verde")
        await create_product(client, "Calça Jeans")
        page = await client.get(
            "/api/v1/inventory/summary",
            params={"q": "Bermuda", "limit": 1, "offset": 1},
        )

    assert page.status_code == 200
    assert page.json()["total"] == 2
    assert page.json()["items"][0]["product_name"] == "Bermuda Verde"
    assert page.json()["items"][0]["balance"] == 0


@pytest.mark.anyio
async def test_inventory_summary_can_fetch_one_products_current_balance(
    inventory_database: tuple[str, ASGITransport],
) -> None:
    _, transport = inventory_database
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await authenticate(client)
        product_id = await create_product(client)
        await client.post(
            "/api/v1/inventory/movements",
            json={
                "product_id": product_id,
                "occurred_at": "2026-11-14",
                "movement_type": "in",
                "quantity": 3,
            },
        )
        response = await client.get(
            "/api/v1/inventory/summary",
            params={"product_id": product_id, "limit": 1},
        )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["balance"] == 3


@pytest.mark.anyio
async def test_sale_movement_cannot_be_reversed_by_manual_endpoint(
    inventory_database: tuple[str, ASGITransport],
) -> None:
    database_url, transport = inventory_database
    engine = create_engine(database_url)
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await authenticate(client)
        product_id = await create_product(client)

        with Session(engine) as db:
            user = db.query(User).filter_by(email="manager@example.com").one()
            product = db.query(Product).filter_by(name="Inventory Product").one()
            sale_movement = InventoryMovement(
                product_id=product.id,
                occurred_at=date(2026, 11, 14),
                movement_type="out",
                quantity=1,
                source_type="sale",
                source_id=uuid4(),
                created_by_user_id=user.id,
            )
            db.add(sale_movement)
            db.commit()
            movement_id = str(sale_movement.id)

        response = await client.post(
            f"/api/v1/inventory/movements/{movement_id}/reverse",
            json={"reason": "Use o fluxo de cancelamento da venda"},
        )

    engine.dispose()
    assert product_id
    assert response.status_code == 409
