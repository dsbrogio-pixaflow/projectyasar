from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app import app
from auth import SESSION_COOKIE_NAME, _token_digest
from models import User, UserSession


@pytest.fixture
def auth_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    database_path = tmp_path / "auth-test.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    return database_url


@pytest.fixture
def transport(auth_database: str) -> ASGITransport:
    return ASGITransport(app=app)


async def register_user(client: AsyncClient, **overrides: str):
    payload = {
        "full_name": "Test Customer",
        "email": "Person@example.com",
        "password": "Strong1",
    }
    payload.update(overrides)
    return await client.post("/api/v1/auth/register", json=payload)


@pytest.mark.anyio
async def test_registration_creates_active_user_without_exposing_hash(
    transport: ASGITransport,
    auth_database: str,
) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await register_user(client)

    assert response.status_code == 201
    assert response.json()["email"] == "person@example.com"
    assert response.json()["role"] == "user"
    assert response.json()["status"] == "active"
    assert "password_hash" not in response.json()

    engine = create_engine(auth_database)
    try:
        with Session(engine) as db:
            user = db.scalar(select(User).where(User.email == "person@example.com"))
            assert user is not None
            assert user.password_hash != "Strong1"
            assert user.password_hash.startswith("$argon2")
    finally:
        engine.dispose()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("password", "extra", "expected_status"),
    [
        ("abcde", {}, 422),
        ("lowercase1", {}, 422),
        ("1StartsWithNumber", {}, 422),
        ("Strong1", {"role": "admin"}, 422),
    ],
)
async def test_registration_rejects_invalid_password_or_privilege_escalation(
    transport: ASGITransport,
    password: str,
    extra: dict[str, str],
    expected_status: int,
) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await register_user(client, password=password, **extra)

    assert response.status_code == expected_status


@pytest.mark.anyio
async def test_registration_rejects_duplicate_email_case_insensitively(
    transport: ASGITransport,
) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        first = await register_user(client)
        duplicate = await register_user(
            client,
            email="PERSON@EXAMPLE.COM",
            full_name="Duplicate",
        )

    assert first.status_code == 201
    assert duplicate.status_code == 409


@pytest.mark.anyio
async def test_login_me_and_logout_revoke_hashed_session(
    transport: ASGITransport,
    auth_database: str,
) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await register_user(client)
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "PERSON@example.com", "password": "Strong1"},
        )
        assert login.status_code == 200
        token = client.cookies.get(SESSION_COOKIE_NAME)
        assert token is not None

        assert "httponly" in login.headers["set-cookie"].lower()
        assert "samesite=lax" in login.headers["set-cookie"].lower()
        assert "secure" not in login.headers["set-cookie"].lower()

        current_user = await client.get("/api/v1/auth/me")
        logout = await client.post("/api/v1/auth/logout")
        after_logout = await client.get("/api/v1/auth/me")

    assert current_user.status_code == 200
    assert current_user.json()["email"] == "person@example.com"
    assert logout.status_code == 204
    assert after_logout.status_code == 401

    engine = create_engine(auth_database)
    try:
        with Session(engine) as db:
            stored_session = db.scalar(
                select(UserSession).where(UserSession.token_hash == _token_digest(token))
            )
            assert stored_session is not None
            assert stored_session.revoked_at is not None
            assert stored_session.token_hash != token
    finally:
        engine.dispose()


@pytest.mark.anyio
async def test_inactive_user_cannot_login(transport: ASGITransport, auth_database: str) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await register_user(client)
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "person@example.com", "password": "Strong1"},
        )
        assert login.status_code == 200

        engine = create_engine(auth_database)
        try:
            with Session(engine) as db:
                user = db.scalar(select(User).where(User.email == "person@example.com"))
                assert user is not None
                user.status = "inactive"
                db.commit()
        finally:
            engine.dispose()

        inactive_login = await client.post(
            "/api/v1/auth/login",
            json={"email": "person@example.com", "password": "Strong1"},
        )
        existing_session = await client.get("/api/v1/auth/me")

    assert inactive_login.status_code == 401
    assert inactive_login.json()["detail"] == "Invalid email or password"
    assert existing_session.status_code == 401


@pytest.mark.anyio
async def test_production_session_cookie_is_secure(
    transport: ASGITransport,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await register_user(client)
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "person@example.com", "password": "Strong1"},
        )

    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


@pytest.mark.anyio
async def test_expired_session_cannot_access_current_user(
    transport: ASGITransport,
    auth_database: str,
) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        await register_user(client)
        await client.post(
            "/api/v1/auth/login",
            json={"email": "person@example.com", "password": "Strong1"},
        )
        token = client.cookies.get(SESSION_COOKIE_NAME)
        assert token is not None

        engine = create_engine(auth_database)
        try:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        UPDATE user_sessions
                        SET expires_at = '2000-01-01 00:00:00'
                        WHERE token_hash = :token_hash
                        """
                    ),
                    {"token_hash": _token_digest(token)},
                )
        finally:
            engine.dispose()

        response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401
