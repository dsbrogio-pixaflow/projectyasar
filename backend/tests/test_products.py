from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient

from app import app


@pytest.fixture
def product_transport(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ASGITransport:
    database_path = tmp_path / "product-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "product-test-hmac-key-that-is-at-least-32-bytes")
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
            "full_name": "Product Manager",
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


@pytest.mark.anyio
async def test_product_routes_require_an_authenticated_session(
    product_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=product_transport,
        base_url="https://testserver",
    ) as client:
        response = await client.get("/api/v1/products")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_product_create_search_update_archive_and_restore(
    product_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=product_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        created = await client.post(
            "/api/v1/products",
            json={
                "name": "  Camiseta Yasar  ",
                "current_price": "89.90",
                "image_url": "https://cdn.example.com/camiseta.png",
            },
        )
        assert created.status_code == 201
        product_id = created.json()["id"]

        updated = await client.put(
            f"/api/v1/products/{product_id}",
            json={
                "name": "Camiseta Yasar Premium",
                "current_price": "99.99",
                "image_url": "",
            },
        )
        archived = await client.post(f"/api/v1/products/{product_id}/archive")
        active_list = await client.get("/api/v1/products")
        archived_list = await client.get(
            "/api/v1/products",
            params={"q": "Premium", "include_archived": True},
        )
        restored = await client.post(f"/api/v1/products/{product_id}/restore")
        final_list = await client.get("/api/v1/products", params={"q": "Camiseta"})

    assert Decimal(str(created.json()["current_price"])) == Decimal("89.90")
    assert created.json()["image_url"] == "https://cdn.example.com/camiseta.png"
    assert updated.status_code == 200
    assert Decimal(str(updated.json()["current_price"])) == Decimal("99.99")
    assert updated.json()["image_url"] is None
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert active_list.json()["total"] == 0
    assert len(archived_list.json()["items"]) == 1
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert final_list.json()["total"] == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("name", "price", "image_url"),
    [
        (" ", "10.00", None),
        ("Valid name", "-0.01", None),
        ("Valid name", "10.001", None),
        ("Valid name", "10000000000.00", None),
        ("Valid name", "10.00", "javascript:alert(1)"),
        ("Valid name", "10.00", "/images/product.png"),
    ],
)
async def test_product_rejects_invalid_name_price_or_image_url(
    product_transport: ASGITransport,
    name: str,
    price: str,
    image_url: str | None,
) -> None:
    async with AsyncClient(
        transport=product_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        response = await client.post(
            "/api/v1/products",
            json={"name": name, "current_price": price, "image_url": image_url},
        )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_product_list_search_and_pagination(
    product_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=product_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        for name in ("Blusa Azul", "Blusa Verde", "Calça Jeans"):
            response = await client.post(
                "/api/v1/products",
                json={"name": name, "current_price": "10.00"},
            )
            assert response.status_code == 201

        page = await client.get(
            "/api/v1/products",
            params={"q": "Blusa", "limit": 1, "offset": 1},
        )

    assert page.status_code == 200
    assert page.json()["total"] == 2
    assert page.json()["limit"] == 1
    assert page.json()["offset"] == 1
    assert page.json()["items"][0]["name"] == "Blusa Verde"


@pytest.mark.anyio
async def test_product_returns_not_found_for_unknown_id(
    product_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=product_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        missing_id = "00000000-0000-0000-0000-000000000001"
        response = await client.get(f"/api/v1/products/{missing_id}")

    assert response.status_code == 404
