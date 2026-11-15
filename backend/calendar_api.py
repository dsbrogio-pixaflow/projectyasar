import calendar
import hmac
import logging
import os
import smtplib
import ssl
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import make_msgid
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, TypeAdapter, ValidationError, field_validator
from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_database_session
from models import BirthdayEmailLog, CalendarEvent, Customer, User


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calendar", tags=["calendar"])
EventType = Literal["holiday", "commemorative", "other"]
EmailTypeAdapter = TypeAdapter(EmailStr)
PENDING_RETRY_AFTER = timedelta(minutes=15)
DEFAULT_EMAIL_SUBJECT = "🎉 Feliz Aniversário!"
DEFAULT_EMAIL_BODY = (
    "Olá [Nome],\n\n"
    "Desejamos a você um feliz aniversário!\n\n"
    "— Sistema de Eventos"
)


class CalendarEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_date: date
    description: str = Field(min_length=1, max_length=500)
    event_type: EventType

    @field_validator("description")
    @classmethod
    def trim_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Event description cannot be blank")
        return normalized


class CalendarEntryResponse(BaseModel):
    id: UUID
    event_date: date
    description: str
    event_type: Literal["holiday", "commemorative", "other", "birthday"]
    customer_id: UUID | None = None


class CalendarMonthResponse(BaseModel):
    year: int
    month: int
    items: list[CalendarEntryResponse]


class BirthdayEmailRunResponse(BaseModel):
    scheduled_date: date
    sent: int
    failed: int
    skipped: int


@dataclass(frozen=True)
class SMTPSettings:
    host: str
    port: int
    username: str
    password: str
    sender: str
    subject: str
    body: str


@dataclass(frozen=True)
class BirthdayRecipient:
    customer: Customer
    email: str
    log_id: UUID


def _business_today() -> date:
    return datetime.now(ZoneInfo("America/Sao_Paulo")).date()


def _next_birthday_date(customer: Customer, year: int) -> date:
    if customer.birthday_day is None or customer.birthday_month is None:
        raise ValueError("Customer birthday is required")
    if (
        customer.birthday_month == 2
        and customer.birthday_day == 29
        and not calendar.isleap(year)
    ):
        return date(year, 3, 1)
    return date(year, customer.birthday_month, customer.birthday_day)


@router.get("", response_model=CalendarMonthResponse, dependencies=[Depends(get_current_user)])
def get_calendar_month(
    year: int = Query(ge=1, le=9999),
    month: int = Query(ge=1, le=12),
    db: Session = Depends(get_database_session),
) -> CalendarMonthResponse:
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    events = list(
        db.scalars(
            select(CalendarEvent)
            .where(
                CalendarEvent.event_date >= month_start,
                CalendarEvent.event_date <= month_end,
            )
            .order_by(
                CalendarEvent.event_date,
                CalendarEvent.event_type,
                CalendarEvent.description,
            )
        )
    )
    items = [
        CalendarEntryResponse(
            id=event.id,
            event_date=event.event_date,
            description=event.description,
            event_type=event.event_type,
        )
        for event in events
    ]

    birthday_months = [month]
    if month == 3 and not calendar.isleap(year):
        birthday_months.append(2)
    customers = db.scalars(
        select(Customer)
        .where(
            Customer.archived_at.is_(None),
            Customer.birthday_day.is_not(None),
            Customer.birthday_month.in_(birthday_months),
        )
        .order_by(Customer.full_name, Customer.id)
    )
    for customer in customers:
        birthday = _next_birthday_date(customer, year)
        if birthday.month == month:
            items.append(
                CalendarEntryResponse(
                    id=customer.id,
                    customer_id=customer.id,
                    event_date=birthday,
                    description=f"Aniversário de {customer.full_name}",
                    event_type="birthday",
                )
            )
    items.sort(key=lambda item: (item.event_date, item.event_type, item.description.casefold()))
    return CalendarMonthResponse(year=year, month=month, items=items)


@router.post(
    "/events",
    response_model=CalendarEntryResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
)
def create_calendar_event(
    payload: CalendarEventCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_database_session),
) -> CalendarEntryResponse:
    event = CalendarEvent(
        id=uuid4(),
        event_date=payload.event_date,
        description=payload.description,
        event_type=payload.event_type,
        created_by_user_id=user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return CalendarEntryResponse(
        id=event.id,
        event_date=event.event_date,
        description=event.description,
        event_type=event.event_type,
    )


@router.delete(
    "/events/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user)],
)
def delete_calendar_event(
    event_id: UUID,
    db: Session = Depends(get_database_session),
) -> Response:
    event = db.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Calendar event not found",
        )
    db.delete(event)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _smtp_settings() -> SMTPSettings:
    host = os.environ.get("SMTP_HOST", "").strip()
    port_value = os.environ.get("SMTP_PORT", "587").strip()
    username = os.environ.get("SMTP_USERNAME", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    sender = os.environ.get("SMTP_FROM", "").strip()
    subject = os.environ.get("BIRTHDAY_EMAIL_SUBJECT", DEFAULT_EMAIL_SUBJECT).strip()
    body = os.environ.get("BIRTHDAY_EMAIL_BODY", DEFAULT_EMAIL_BODY).strip()
    if not all((host, username, password, sender, subject, body)):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Birthday email delivery is not configured",
        )
    if "\r" in subject or "\n" in subject:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Birthday email subject configuration is invalid",
        )
    try:
        port = int(port_value)
        if not 1 <= port <= 65535:
            raise ValueError
        sender = str(EmailTypeAdapter.validate_python(sender))
    except (ValueError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Birthday email configuration is invalid",
        ) from None
    return SMTPSettings(host, port, username, password, sender, subject, body)


def _valid_customer_email(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(EmailTypeAdapter.validate_python(value))
    except ValidationError:
        return None


def _reserve_send(
    db: Session,
    customer: Customer,
    year: int,
    scheduled_date: date,
    now: datetime,
) -> UUID | None:
    log = db.scalar(
        select(BirthdayEmailLog)
        .where(
            BirthdayEmailLog.customer_id == customer.id,
            BirthdayEmailLog.birthday_year == year,
        )
        .with_for_update()
    )
    if log is not None:
        if log.status == "sent":
            return None
        last_attempt_at = log.last_attempt_at
        if last_attempt_at.tzinfo is None:
            last_attempt_at = last_attempt_at.replace(tzinfo=timezone.utc)
        if (
            log.status == "pending"
            and last_attempt_at > now - PENDING_RETRY_AFTER
        ):
            return None
        log.status = "pending"
        log.attempt_count += 1
        log.last_attempt_at = now
        log.scheduled_date = scheduled_date
        log.sent_at = None
        log.error_code = None
    else:
        log = BirthdayEmailLog(
            id=uuid4(),
            customer_id=customer.id,
            birthday_year=year,
            scheduled_date=scheduled_date,
            status="pending",
            attempt_count=1,
            last_attempt_at=now,
        )
        db.add(log)
    log_id = log.id
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        concurrent_log = db.scalar(
            select(BirthdayEmailLog.id).where(
                BirthdayEmailLog.customer_id == customer.id,
                BirthdayEmailLog.birthday_year == year,
            )
        )
        if concurrent_log is None:
            raise
        return None
    return log_id


def _finish_send(
    db: Session,
    log_id: UUID,
    sent: bool,
    error: Exception | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    db.execute(
        update(BirthdayEmailLog)
        .where(BirthdayEmailLog.id == log_id)
        .values(
            status="sent" if sent else "failed",
            sent_at=now if sent else None,
            error_code=None if error is None else type(error).__name__[:120],
        )
    )
    db.commit()


def _make_message(
    recipient: BirthdayRecipient,
    settings: SMTPSettings,
    year: int,
) -> EmailMessage:
    message = EmailMessage()
    name = recipient.customer.full_name
    message["From"] = settings.sender
    message["To"] = recipient.email
    safe_name = name.replace("\r", " ").replace("\n", " ").strip()
    message["Subject"] = settings.subject.replace("[Nome]", safe_name)
    domain = settings.sender.rsplit("@", maxsplit=1)[-1]
    message["Message-ID"] = make_msgid(
        idstring=f"birthday-{recipient.customer.id}-{year}",
        domain=domain,
    )
    message.set_content(settings.body.replace("[Nome]", name))
    return message


def _retryable_email_logs(
    db: Session,
    year: int,
    now: datetime,
) -> list[tuple[BirthdayEmailLog, Customer]]:
    stale_before = now - PENDING_RETRY_AFTER
    return list(
        db.execute(
            select(BirthdayEmailLog, Customer)
            .join(Customer, Customer.id == BirthdayEmailLog.customer_id)
            .where(
                BirthdayEmailLog.birthday_year == year,
                or_(
                    BirthdayEmailLog.status == "failed",
                    and_(
                        BirthdayEmailLog.status == "pending",
                        BirthdayEmailLog.last_attempt_at < stale_before,
                    ),
                ),
                Customer.archived_at.is_(None),
            )
            .order_by(BirthdayEmailLog.created_at, BirthdayEmailLog.id)
        )
    )


@router.post("/birthdays/send", response_model=BirthdayEmailRunResponse)
def send_birthday_emails(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_database_session),
) -> BirthdayEmailRunResponse:
    secret = os.environ.get("CRON_SECRET", "")
    if len(secret) < 16:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Birthday email schedule is not configured",
        )
    expected_authorization = f"Bearer {secret}"
    if authorization is None or not hmac.compare_digest(
        authorization,
        expected_authorization,
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid schedule authorization",
        )

    today = _business_today()
    year = today.year
    birthday_condition = and_(
        Customer.birthday_month == today.month,
        Customer.birthday_day == today.day,
    )
    if today.month == 3 and today.day == 1 and not calendar.isleap(year):
        birthday_condition = or_(
            birthday_condition,
            and_(Customer.birthday_month == 2, Customer.birthday_day == 29),
        )
    customers = list(
        db.scalars(
            select(Customer)
            .where(
                Customer.archived_at.is_(None),
                Customer.birthday_day.is_not(None),
                Customer.birthday_month.is_not(None),
                birthday_condition,
            )
            .order_by(Customer.id)
        )
    )
    candidates: dict[UUID, tuple[Customer, date]] = {
        customer.id: (customer, today)
        for customer in customers
    }

    now = datetime.now(timezone.utc)
    for log, customer in _retryable_email_logs(db, year, now):
        candidates.setdefault(customer.id, (customer, log.scheduled_date))

    valid_candidates: list[tuple[Customer, str, date]] = []
    skipped = 0
    for customer, scheduled_date in candidates.values():
        email = _valid_customer_email(customer.email)
        if email is None:
            skipped += 1
            continue
        valid_candidates.append((customer, email, scheduled_date))

    if not valid_candidates:
        return BirthdayEmailRunResponse(
            scheduled_date=today,
            sent=0,
            failed=0,
            skipped=skipped,
        )

    settings = _smtp_settings()
    reserved: list[BirthdayRecipient] = []
    for customer, email, scheduled_date in valid_candidates:
        log_id = _reserve_send(db, customer, year, scheduled_date, now)
        if log_id is None:
            skipped += 1
            continue
        reserved.append(
            BirthdayRecipient(customer, email, log_id)
        )

    if not reserved:
        return BirthdayEmailRunResponse(
            scheduled_date=today,
            sent=0,
            failed=0,
            skipped=skipped,
        )

    sent_count = 0
    failed_count = 0
    processed: set[UUID] = set()
    try:
        with smtplib.SMTP(settings.host, settings.port, timeout=15) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            smtp.login(settings.username, settings.password)
            for recipient in reserved:
                try:
                    refused = smtp.send_message(
                        _make_message(recipient, settings, year)
                    )
                    if refused:
                        raise smtplib.SMTPRecipientsRefused(refused)
                except (OSError, smtplib.SMTPException) as error:
                    _finish_send(db, recipient.log_id, False, error)
                    failed_count += 1
                    processed.add(recipient.log_id)
                else:
                    _finish_send(db, recipient.log_id, True)
                    sent_count += 1
                    processed.add(recipient.log_id)
    except (OSError, smtplib.SMTPException) as error:
        for recipient in reserved:
            if recipient.log_id not in processed:
                _finish_send(db, recipient.log_id, False, error)
                failed_count += 1

    if failed_count:
        logger.error("Birthday email run recorded %s failed delivery attempt(s)", failed_count)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Could not deliver {failed_count} birthday email(s); "
                "failures were recorded for retry"
            ),
        )
    return BirthdayEmailRunResponse(
        scheduled_date=today,
        sent=sent_count,
        failed=0,
        skipped=skipped,
    )
