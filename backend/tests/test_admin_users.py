from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from fastapi import status
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app import app
from bootstrap_admin import provision_initial_admin
from models import Product, User, UserSession

ADMIN_EMAIL = "owner@example.com"
ADMIN_PASSWORD = "Strong1"


@pytest.fixture
def admin_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    database_url = f"sqlite:///{(tmp_path / 'admin-users-test.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv(
        "RATE_LIMIT_HMAC_KEY",
        "admin-users-test-key-long-enough-for-hmac-32-bytes",
    )
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    return database_url


@pytest.fixture
def admin_transport(request: pytest.FixtureRequest) -> ASGITransport:
    request.getfixturevalue("admin_database")
    return ASGITransport(app=app)


def create_initial_admin(database_url: str) -> None:
    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            provision_initial_admin(db, ADMIN_EMAIL, ADMIN_PASSWORD)
    finally:
        engine.dispose()


async def login(
    client: AsyncClient,
    email: str,
    password: str = ADMIN_PASSWORD,
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == status.HTTP_200_OK


async def register_user(
    client: AsyncClient,
    name: str,
    email: str,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "full_name": name,
            "email": email,
            "password": ADMIN_PASSWORD,
        },
    )
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()


@pytest.mark.anyio
async def test_admin_user_endpoints_require_an_active_administrator(
    admin_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=admin_transport,
        base_url="https://testserver",
    ) as client:
        unauthenticated = await client.get("/api/v1/admin/users")
        await register_user(client, "Regular User", "regular@example.com")
        await login(client, "regular@example.com")
        forbidden = await client.get("/api/v1/admin/users")

    assert unauthenticated.status_code == status.HTTP_401_UNAUTHORIZED
    assert forbidden.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.anyio
async def test_administrator_can_search_filter_and_paginate_users(
    admin_transport: ASGITransport,
    admin_database: str,
) -> None:
    create_initial_admin(admin_database)
    async with AsyncClient(
        transport=admin_transport,
        base_url="https://testserver",
    ) as client:
        await login(client, ADMIN_EMAIL)
        await register_user(client, "Ana Silva", "ana@example.com")
        await register_user(client, "Bia Souza", "bia@example.com")
        page = await client.get(
            "/api/v1/admin/users",
            params={"limit": 1, "offset": 1},
        )
        search = await client.get(
            "/api/v1/admin/users",
            params={"q": "ANA", "role": "user", "status": "active"},
        )

    assert page.status_code == status.HTTP_200_OK
    assert page.json()["total"] == 3
    assert page.json()["limit"] == 1
    assert page.json()["offset"] == 1
    assert page.json()["items"][0]["full_name"] == "Ana Silva"
    assert "password_hash" not in page.json()["items"][0]
    assert search.json()["total"] == 1
    assert search.json()["items"][0]["email"] == "ana@example.com"


@pytest.mark.anyio
async def test_access_changes_revoke_sessions_and_email_conflicts_are_rejected(
    admin_transport: ASGITransport,
    admin_database: str,
) -> None:
    create_initial_admin(admin_database)
    async with AsyncClient(
        transport=admin_transport,
        base_url="https://testserver",
    ) as admin_client, AsyncClient(
        transport=admin_transport,
        base_url="https://testserver",
    ) as user_client:
        await login(admin_client, ADMIN_EMAIL)
        first_user = await register_user(admin_client, "First User", "first@example.com")
        second_user = await register_user(admin_client, "Second User", "second@example.com")
        await login(user_client, "first@example.com")
        conflict = await admin_client.patch(
            f"/api/v1/admin/users/{second_user['id']}",
            json={"email": "FIRST@example.com"},
        )
        updated = await admin_client.patch(
            f"/api/v1/admin/users/{first_user['id']}",
            json={"role": "admin"},
        )
        revoked_session = await user_client.get("/api/v1/auth/me")
        empty_patch = await admin_client.patch(
            f"/api/v1/admin/users/{second_user['id']}",
            json={},
        )
        null_patch = await admin_client.patch(
            f"/api/v1/admin/users/{second_user['id']}",
            json={"status": None},
        )

    assert conflict.status_code == status.HTTP_409_CONFLICT
    assert updated.status_code == status.HTTP_200_OK
    assert updated.json()["role"] == "admin"
    assert revoked_session.status_code == status.HTTP_401_UNAUTHORIZED
    assert empty_patch.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert null_patch.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    engine = create_engine(admin_database)
    try:
        with Session(engine) as db:
            session_count = db.scalar(
                select(func.count(UserSession.id)).where(
                    UserSession.user_id == UUID(first_user["id"]),
                    UserSession.revoked_at.is_(None),
                )
            )
    finally:
        engine.dispose()
    assert session_count == 0


@pytest.mark.anyio
async def test_last_active_administrator_cannot_be_demoted_deactivated_or_deleted(
    admin_transport: ASGITransport,
    admin_database: str,
) -> None:
    create_initial_admin(admin_database)
    async with AsyncClient(
        transport=admin_transport,
        base_url="https://testserver",
    ) as client:
        await login(client, ADMIN_EMAIL)
        current_user = await client.get("/api/v1/auth/me")
        user_id = current_user.json()["id"]
        demote = await client.patch(
            f"/api/v1/admin/users/{user_id}",
            json={"role": "user"},
        )
        deactivate = await client.patch(
            f"/api/v1/admin/users/{user_id}",
            json={"status": "inactive"},
        )
        remove = await client.request(
            "DELETE",
            f"/api/v1/admin/users/{user_id}",
            json={"confirm_email": ADMIN_EMAIL},
        )
        still_authenticated = await client.get("/api/v1/auth/me")

    assert demote.status_code == status.HTTP_409_CONFLICT
    assert deactivate.status_code == status.HTTP_409_CONFLICT
    assert remove.status_code == status.HTTP_409_CONFLICT
    assert still_authenticated.status_code == status.HTTP_200_OK


@pytest.mark.anyio
async def test_deletion_requires_email_confirmation_and_preserves_audit_history(
    admin_transport: ASGITransport,
    admin_database: str,
) -> None:
    create_initial_admin(admin_database)
    async with AsyncClient(
        transport=admin_transport,
        base_url="https://testserver",
    ) as admin_client, AsyncClient(
        transport=admin_transport,
        base_url="https://testserver",
    ) as user_client:
        await login(admin_client, ADMIN_EMAIL)
        target = await register_user(admin_client, "Target User", "target@example.com")
        await login(user_client, "target@example.com")
        product = await user_client.post(
            "/api/v1/products",
            json={"name": "Target Product", "current_price": "4.50"},
        )
        mismatch = await admin_client.request(
            "DELETE",
            f"/api/v1/admin/users/{target['id']}",
            json={"confirm_email": "other@example.com"},
        )
        deleted = await admin_client.request(
            "DELETE",
            f"/api/v1/admin/users/{target['id']}",
            json={"confirm_email": "TARGET@example.com"},
        )
        revoked_user_session = await user_client.get("/api/v1/auth/me")

    assert product.status_code == status.HTTP_201_CREATED
    assert mismatch.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    assert revoked_user_session.status_code == status.HTTP_401_UNAUTHORIZED
    engine = create_engine(admin_database)
    try:
        with Session(engine) as db:
            assert db.get(User, UUID(target["id"])) is None
            preserved_product = db.get(Product, UUID(product.json()["id"]))
            assert preserved_product is not None
            assert preserved_product.created_by_user_id is None
            session_count = db.scalar(
                select(func.count(UserSession.id)).where(
                    UserSession.user_id == UUID(target["id"])
                )
            )
    finally:
        engine.dispose()
    assert session_count == 0
