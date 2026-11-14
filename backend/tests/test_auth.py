from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app import app
from auth import (
    SESSION_COOKIE_NAME,
    _rate_limit_fingerprint,
    _record_rate_limit_attempt,
    _token_digest,
)
from bootstrap_admin import provision_initial_admin
from models import AuthRateLimit, User, UserSession


@pytest.fixture
def auth_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    database_path = tmp_path / "auth-test.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("RATE_LIMIT_HMAC_KEY", "test-rate-limit-key-that-is-at-least-32-bytes")
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
async def test_registration_rate_limit_returns_retry_after_and_stores_only_fingerprints(
    transport: ASGITransport,
    auth_database: str,
) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        responses = [
            await register_user(
                client,
                email=f"person{index}@example.com",
                full_name=f"Test Customer {index}",
            )
            for index in range(6)
        ]

    assert [response.status_code for response in responses] == [201] * 5 + [429]
    assert int(responses[-1].headers["retry-after"]) > 0

    engine = create_engine(auth_database)
    try:
        with Session(engine) as db:
            buckets = list(db.scalars(select(AuthRateLimit)))
            assert len(buckets) == 1
            assert buckets[0].attempt_count == 6
            assert "127.0.0.1" not in buckets[0].bucket_hash
            assert "person" not in buckets[0].bucket_hash
    finally:
        engine.dispose()


@pytest.mark.anyio
async def test_authentication_rate_limit_requires_hmac_secret(
    transport: ASGITransport,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("RATE_LIMIT_HMAC_KEY")
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await register_user(client)

    assert response.status_code == 503


@pytest.mark.anyio
async def test_vercel_rate_limit_uses_platform_forwarded_client_ip(
    transport: ASGITransport,
    auth_database: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VERCEL", "1")
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "full_name": "Test Customer",
                "email": "Person@example.com",
                "password": "Strong1",
            },
            headers={"x-forwarded-for": "203.0.113.17"},
        )

    assert response.status_code == 201
    engine = create_engine(auth_database)
    try:
        with Session(engine) as db:
            bucket = db.scalar(select(AuthRateLimit))
            assert bucket is not None
            assert bucket.bucket_hash == _rate_limit_fingerprint(
                "register:ip",
                "203.0.113.17",
            )
    finally:
        engine.dispose()


@pytest.mark.anyio
async def test_login_rate_limit_is_scoped_by_email(
    transport: ASGITransport,
) -> None:
    async with AsyncClient(transport=transport, base_url="https://testserver") as client:
        responses = [
            await client.post(
                "/api/v1/auth/login",
                json={"email": "victim@example.com", "password": "Wrong1"},
            )
            for _ in range(11)
        ]

    assert [response.status_code for response in responses[:10]] == [401] * 10
    assert responses[10].status_code == 429
    assert int(responses[10].headers["retry-after"]) > 0


def test_rate_limit_window_resets_after_expiry(auth_database: str) -> None:
    engine = create_engine(auth_database)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    try:
        with Session(engine) as db:
            assert (
                _record_rate_limit_attempt(
                    db,
                    scope="test",
                    value="same-client",
                    limit=1,
                    window=timedelta(minutes=15),
                    now=start,
                )
                == 0
            )
            assert (
                _record_rate_limit_attempt(
                    db,
                    scope="test",
                    value="same-client",
                    limit=1,
                    window=timedelta(minutes=15),
                    now=start + timedelta(minutes=1),
                )
                > 0
            )
            assert (
                _record_rate_limit_attempt(
                    db,
                    scope="test",
                    value="same-client",
                    limit=1,
                    window=timedelta(minutes=15),
                    now=start + timedelta(minutes=16),
                )
                == 0
            )
            db.commit()
            bucket = db.scalar(select(AuthRateLimit))

        assert bucket is not None
        assert bucket.attempt_count == 1
    finally:
        engine.dispose()


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


def test_initial_admin_bootstrap_is_one_time_and_uses_standard_password_policy(
    auth_database: str,
) -> None:
    engine = create_engine(auth_database)
    try:
        with Session(engine) as db:
            with pytest.raises(ValueError):
                provision_initial_admin(db, "another@example.com", "weak1")

        with Session(engine) as db:
            admin = provision_initial_admin(db, "ADMIN@example.com", "Strong1")

        assert admin.email == "admin@example.com"
        assert admin.role == "admin"
        assert admin.status == "active"
        assert admin.password_hash.startswith("$argon2")
        assert admin.password_hash != "Strong1"

        with Session(engine) as db:
            with pytest.raises(RuntimeError, match="already exists"):
                provision_initial_admin(db, "another@example.com", "Strong1")
    finally:
        engine.dispose()
