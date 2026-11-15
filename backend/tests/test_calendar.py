from email.message import EmailMessage
from datetime import date
from pathlib import Path
import smtplib
import ssl
from typing import Any
from uuid import UUID

import pytest
from alembic import command
from alembic.config import Config
from fastapi import status
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session

import calendar_api
from app import app
from database import create_database_engine
from models import BirthdayEmailLog


@pytest.fixture
def calendar_transport(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ASGITransport:
    database_path = tmp_path / "calendar-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv(
        "RATE_LIMIT_HMAC_KEY",
        "calendar-test-key-long-enough-for-hmac-32-bytes",
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
            "full_name": "Calendar Manager",
            "email": "calendar@example.com",
            "password": "Strong1",
        },
    )
    assert registration.status_code == status.HTTP_201_CREATED
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "calendar@example.com", "password": "Strong1"},
    )
    assert login.status_code == status.HTTP_200_OK


async def create_customer(
    client: AsyncClient,
    name: str,
    birthday_day: int,
    birthday_month: int,
    email: str | None = None,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/customers",
        json={
            "full_name": name,
            "email": email,
            "birthday_day": birthday_day,
            "birthday_month": birthday_month,
        },
    )
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()


@pytest.mark.anyio
async def test_calendar_events_and_active_customer_birthdays(
    calendar_transport: ASGITransport,
) -> None:
    async with AsyncClient(
        transport=calendar_transport,
        base_url="https://testserver",
    ) as client:
        unauthenticated = await client.get(
            "/api/v1/calendar",
            params={"year": 2027, "month": 3},
        )
        await authenticate(client)
        leap_birthday = await create_customer(client, "Ana Costa", 29, 2)
        march_birthday = await create_customer(client, "Bruna Lima", 1, 3)
        archived_birthday = await create_customer(client, "Carla Souza", 29, 2)
        await client.post(
            f"/api/v1/customers/{archived_birthday['id']}/archive",
        )
        february_2027 = await client.get(
            "/api/v1/calendar",
            params={"year": 2027, "month": 2},
        )
        march_2027 = await client.get(
            "/api/v1/calendar",
            params={"year": 2027, "month": 3},
        )
        february_2028 = await client.get(
            "/api/v1/calendar",
            params={"year": 2028, "month": 2},
        )
        event = await client.post(
            "/api/v1/calendar/events",
            json={
                "event_date": "2027-03-15",
                "description": "  Reunião da equipe  ",
                "event_type": "other",
            },
        )
        created_event = await client.get(
            "/api/v1/calendar",
            params={"year": 2027, "month": 3},
        )
        deleted = await client.delete(
            f"/api/v1/calendar/events/{event.json()['id']}",
        )
        missing_event = await client.delete(
            f"/api/v1/calendar/events/{event.json()['id']}",
        )

    assert unauthenticated.status_code == status.HTTP_401_UNAUTHORIZED
    assert february_2027.status_code == status.HTTP_200_OK
    assert all(
        item["event_type"] != "birthday"
        for item in february_2027.json()["items"]
    )
    march_birthdays = [
        item
        for item in march_2027.json()["items"]
        if item["event_type"] == "birthday"
    ]
    assert {
        (item["customer_id"], item["event_date"])
        for item in march_birthdays
    } == {
        (leap_birthday["id"], "2027-03-01"),
        (march_birthday["id"], "2027-03-01"),
    }
    february_birthdays = [
        item
        for item in february_2028.json()["items"]
        if item["event_type"] == "birthday"
    ]
    assert [(item["customer_id"], item["event_date"]) for item in february_birthdays] == [
        (leap_birthday["id"], "2028-02-29"),
    ]
    assert event.status_code == status.HTTP_201_CREATED
    assert event.json()["description"] == "Reunião da equipe"
    assert any(
        item["id"] == event.json()["id"]
        for item in created_event.json()["items"]
    )
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    assert missing_event.status_code == status.HTTP_404_NOT_FOUND


class SMTPStub:
    messages: list[EmailMessage] = []
    fail_next_message = False

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout

    def __enter__(self) -> "SMTPStub":
        return self

    def __exit__(
        self,
        _exc_type: object,
        _exc_value: object,
        _traceback: object,
    ) -> None:
        assert _exc_type is None
        assert _exc_value is None
        assert _traceback is None
        return None

    def ehlo(self) -> None:
        return None

    def starttls(self, context: object) -> None:
        assert isinstance(context, ssl.SSLContext)

    def login(self, _username: str, _password: str) -> None:
        assert _username == "calendar@example.test"
        assert _password == "test-only-password"

    def send_message(self, message: EmailMessage) -> dict[str, tuple[int, bytes]]:
        if type(self).fail_next_message:
            type(self).fail_next_message = False
            raise smtplib.SMTPServerDisconnected("temporary test failure")
        type(self).messages.append(message)
        return {}


def configure_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "calendar-test-cron-secret")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USERNAME", "calendar@example.test")
    monkeypatch.setenv("SMTP_PASSWORD", "test-only-password")
    monkeypatch.setenv("SMTP_FROM", "calendar@example.com")
    monkeypatch.setenv("BIRTHDAY_EMAIL_SUBJECT", "Parabéns, [Nome]!")
    monkeypatch.setenv("BIRTHDAY_EMAIL_BODY", "Olá [Nome], feliz aniversário!")
    SMTPStub.messages = []
    SMTPStub.fail_next_message = False
    monkeypatch.setattr(calendar_api.smtplib, "SMTP", SMTPStub)


@pytest.mark.anyio
async def test_birthday_schedule_authenticates_and_is_idempotent(
    calendar_transport: ASGITransport,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_smtp(monkeypatch)
    monkeypatch.setattr(calendar_api, "_business_today", lambda: date(2027, 3, 1))
    async with AsyncClient(
        transport=calendar_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        await create_customer(
            client,
            "Ana Costa",
            29,
            2,
            "ana@example.com",
        )
        await create_customer(client, "Sem e-mail", 29, 2)
        unauthorized = await client.post("/api/v1/calendar/birthdays/send")
        sent = await client.post(
            "/api/v1/calendar/birthdays/send",
            headers={"Authorization": "Bearer calendar-test-cron-secret"},
        )
        repeated = await client.post(
            "/api/v1/calendar/birthdays/send",
            headers={"Authorization": "Bearer calendar-test-cron-secret"},
        )

    assert unauthorized.status_code == status.HTTP_401_UNAUTHORIZED
    assert sent.status_code == status.HTTP_200_OK
    assert sent.json() == {
        "scheduled_date": "2027-03-01",
        "sent": 1,
        "failed": 0,
        "skipped": 1,
    }
    assert repeated.json()["sent"] == 0
    assert repeated.json()["skipped"] == 2
    assert len(SMTPStub.messages) == 1
    assert SMTPStub.messages[0]["To"] == "ana@example.com"
    assert SMTPStub.messages[0]["Subject"] == "Parabéns, Ana Costa!"
    assert SMTPStub.messages[0].get_content() == "Olá Ana Costa, feliz aniversário!\n"


@pytest.mark.anyio
async def test_failed_birthday_email_can_be_retried_without_duplicate_success(
    calendar_transport: ASGITransport,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_smtp(monkeypatch)
    SMTPStub.fail_next_message = True
    monkeypatch.setattr(calendar_api, "_business_today", lambda: date(2028, 2, 29))
    async with AsyncClient(
        transport=calendar_transport,
        base_url="https://testserver",
    ) as client:
        await authenticate(client)
        customer = await create_customer(
            client,
            "Bruna Lima",
            29,
            2,
            "bruna@example.com",
        )
        failed = await client.post(
            "/api/v1/calendar/birthdays/send",
            headers={"Authorization": "Bearer calendar-test-cron-secret"},
        )
        retried = await client.post(
            "/api/v1/calendar/birthdays/send",
            headers={"Authorization": "Bearer calendar-test-cron-secret"},
        )
        repeated = await client.post(
            "/api/v1/calendar/birthdays/send",
            headers={"Authorization": "Bearer calendar-test-cron-secret"},
        )

    engine = create_database_engine()
    with Session(engine) as db:
        log = db.scalar(
            select(BirthdayEmailLog).where(
                BirthdayEmailLog.customer_id == UUID(customer["id"]),
                BirthdayEmailLog.birthday_year == 2028,
            )
        )

    assert failed.status_code == status.HTTP_502_BAD_GATEWAY
    assert retried.status_code == status.HTTP_200_OK
    assert retried.json()["sent"] == 1
    assert repeated.json()["sent"] == 0
    assert len(SMTPStub.messages) == 1
    assert log is not None
    assert log.status == "sent"
    assert log.attempt_count == 2
