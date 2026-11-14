from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient

from app import app


@pytest.fixture
def customer_transport(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ASGITransport:
    database_path = tmp_path / "customer-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "customer-test-hmac-key-that-is-at-least-32-bytes")
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
            "full_name": "Customer Manager",
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
async def test_customer_routes_require_an_authenticated_session(
    customer_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=customer_transport,
        base_url="https://testserver",
    ) as client:
        response = await client.get("/api/v1/customers")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_customer_create_search_update_archive_and_restore(
    customer_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=customer_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        first = await client.post(
            "/api/v1/customers",
            json={
                "full_name": "  Ana Costa  ",
                "email": " ana@example.com ",
                "phone": " (11) 99999-0000 ",
                "delivery_address": " Rua Um, 10 ",
                "birthday_day": 29,
                "birthday_month": 2,
            },
        )
        second = await client.post(
            "/api/v1/customers",
            json={"full_name": "Bruno Silva"},
        )
        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["birthday_day"] == 29
        assert first.json()["birthday_month"] == 2
        customer_id = first.json()["id"]

        updated = await client.put(
            f"/api/v1/customers/{customer_id}",
            json={
                "full_name": "Ana Souza",
                "email": "ana.souza@example.com",
                "phone": None,
                "delivery_address": None,
                "birthday_day": None,
                "birthday_month": None,
            },
        )
        assert updated.status_code == 200
        assert updated.json()["full_name"] == "Ana Souza"
        assert updated.json()["email"] == "ana.souza@example.com"
        assert updated.json()["phone"] is None

        archived = await client.post(f"/api/v1/customers/{customer_id}/archive")
        active_list = await client.get("/api/v1/customers")
        archived_list = await client.get(
            "/api/v1/customers",
            params={"include_archived": True, "q": "ana.souza"},
        )
        restored = await client.post(f"/api/v1/customers/{customer_id}/restore")
        final_list = await client.get("/api/v1/customers", params={"q": "example.com"})

    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert active_list.json()["total"] == 1
    assert len(archived_list.json()["items"]) == 1
    assert archived_list.json()["items"][0]["id"] == customer_id
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert final_list.json()["total"] == 1
    assert final_list.json()["items"][0]["id"] == customer_id


@pytest.mark.anyio
@pytest.mark.parametrize(
    "birthday",
    [
        {"birthday_day": 1},
        {"birthday_month": 1},
        {"birthday_day": 30, "birthday_month": 2},
        {"birthday_day": 31, "birthday_month": 4},
        {"birthday_day": 1, "birthday_month": 13},
    ],
)
async def test_customer_rejects_invalid_birthday_combinations(
    customer_transport: ASGITransport,
    birthday: dict[str, Any],
) -> None:
    async with AsyncClient(
        transport=customer_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        response = await client.post(
            "/api/v1/customers",
            json={"full_name": "Invalid Birthday", **birthday},
        )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_customer_list_is_searchable_and_paginated(
    customer_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=customer_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        for name in ("Ana Costa", "Ana Silva", "Bruno Souza"):
            response = await client.post(
                "/api/v1/customers",
                json={"full_name": name},
            )
            assert response.status_code == 201

        page = await client.get(
            "/api/v1/customers",
            params={"q": "Ana", "limit": 1, "offset": 1},
        )

    assert page.status_code == 200
    assert page.json()["total"] == 2
    assert page.json()["limit"] == 1
    assert page.json()["offset"] == 1
    assert page.json()["items"][0]["full_name"] == "Ana Silva"


@pytest.mark.anyio
async def test_customer_get_and_archive_return_not_found_for_unknown_id(
    customer_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=customer_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        missing_id = "00000000-0000-0000-0000-000000000001"
        get_response = await client.get(f"/api/v1/customers/{missing_id}")
        archive_response = await client.post(f"/api/v1/customers/{missing_id}/archive")

    assert get_response.status_code == 404
    assert archive_response.status_code == 404
