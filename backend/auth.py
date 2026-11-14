from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import ipaddress
from math import ceil
import os
import secrets

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_database_session
from models import AuthRateLimit, User, UserSession


router = APIRouter(prefix="/auth", tags=["authentication"])
password_hasher = PasswordHash.recommended()
SESSION_COOKIE_NAME = "projectyasar_session"
SESSION_DURATION = timedelta(days=14)
REGISTER_LIMIT = 5
REGISTER_WINDOW = timedelta(hours=1)
LOGIN_EMAIL_LIMIT = 10
LOGIN_IP_LIMIT = 20
LOGIN_WINDOW = timedelta(minutes=15)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)

    @field_validator("full_name")
    @classmethod
    def trim_full_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Full name cannot be blank")
        return value

    @field_validator("password")
    @classmethod
    def require_uppercase_first_letter(cls, value: str) -> str:
        validate_password_policy(value)
        return value


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: str
    full_name: str
    email: str
    role: str
    status: str


def _normalized_email(email: EmailStr) -> str:
    return str(email).strip().lower()


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_password_policy(password: str) -> None:
    if len(password) < 6 or not password[0].isalpha() or not password[0].isupper():
        raise ValueError(
            "Password must contain at least 6 characters and start with an uppercase letter"
        )


def _rate_limit_fingerprint(scope: str, value: str) -> str:
    key = os.environ.get("RATE_LIMIT_HMAC_KEY")
    if key is None or len(key.encode("utf-8")) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication rate limiting is not configured",
        )
    message = f"{scope}:{value}".encode("utf-8")
    return hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _record_rate_limit_attempt(
    db: Session,
    *,
    scope: str,
    value: str,
    limit: int,
    window: timedelta,
    now: datetime,
) -> int:
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        insert_statement = postgresql_insert(AuthRateLimit)
    elif dialect == "sqlite":
        insert_statement = sqlite_insert(AuthRateLimit)
    else:
        raise RuntimeError(f"Unsupported database dialect for rate limiting: {dialect}")

    fingerprint = _rate_limit_fingerprint(scope, value)
    window_start = now - window
    reset_window = AuthRateLimit.window_started_at <= window_start
    statement = insert_statement.values(
        bucket_hash=fingerprint,
        window_started_at=now,
        attempt_count=1,
    )
    statement = statement.on_conflict_do_update(
        index_elements=[AuthRateLimit.bucket_hash],
        set_={
            "window_started_at": case(
                (reset_window, now),
                else_=AuthRateLimit.window_started_at,
            ),
            "attempt_count": case(
                (reset_window, 1),
                else_=AuthRateLimit.attempt_count + 1,
            ),
            "updated_at": now,
        },
    ).returning(AuthRateLimit.attempt_count, AuthRateLimit.window_started_at)

    attempt_count, stored_window_start = db.execute(statement).one()
    retry_window_start = stored_window_start
    if retry_window_start.tzinfo is None:
        retry_window_start = retry_window_start.replace(tzinfo=timezone.utc)
    retry_after = max(
        1,
        ceil((retry_window_start + window - now).total_seconds()),
    )
    return retry_after if attempt_count > limit else 0


def _enforce_auth_rate_limits(
    db: Session,
    request: Request,
    *,
    operation: str,
    email: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    client_ip = request.client.host if request.client is not None else "unknown"
    if os.environ.get("VERCEL") == "1":
        forwarded_ip = request.headers.get("x-forwarded-for")
        if forwarded_ip is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Client IP is unavailable for authentication rate limiting",
            )
        try:
            client_ip = str(ipaddress.ip_address(forwarded_ip.strip()))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Client IP is invalid for authentication rate limiting",
            ) from None

    db.execute(
        delete(AuthRateLimit).where(
            AuthRateLimit.window_started_at < now - timedelta(days=2)
        )
    )

    limits: list[tuple[str, str, int, timedelta]] = []
    if operation == "register":
        limits.append(("register:ip", client_ip, REGISTER_LIMIT, REGISTER_WINDOW))
    elif operation == "login":
        limits.append(("login:ip", client_ip, LOGIN_IP_LIMIT, LOGIN_WINDOW))
        if email is not None:
            limits.append(("login:email", email, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW))
    else:
        raise ValueError(f"Unknown authentication operation: {operation}")

    retry_after_values = [
        _record_rate_limit_attempt(
            db,
            scope=scope,
            value=value,
            limit=limit,
            window=window,
            now=now,
        )
        for scope, value, limit, window in limits
    ]
    db.commit()

    retry_after = max(retry_after_values, default=0)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts; try again later",
            headers={"Retry-After": str(retry_after)},
        )


def _secure_cookie() -> bool:
    return os.environ.get("APP_ENV", "development").lower() == "production" or os.environ.get(
        "VERCEL"
    ) == "1"


def _public_user(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        status=user.status,
    )


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password",
    )


def get_current_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_database_session),
) -> User:
    if not session_token:
        raise _invalid_credentials()

    result = db.execute(
        select(User, UserSession)
        .join(UserSession, UserSession.user_id == User.id)
        .where(
            UserSession.token_hash == _token_digest(session_token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(timezone.utc),
            User.status == "active",
        )
    ).one_or_none()
    if result is None:
        raise _invalid_credentials()
    return result[0]


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    payload: RegisterRequest,
    request: Request,
    db: Session = Depends(get_database_session),
) -> UserResponse:
    _enforce_auth_rate_limits(
        db,
        request,
        operation="register",
    )
    user = User(
        full_name=payload.full_name,
        email=_normalized_email(payload.email),
        password_hash=password_hasher.hash(payload.password),
        role="user",
        status="active",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        ) from None
    db.refresh(user)
    return _public_user(user)


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_database_session),
) -> UserResponse:
    email = _normalized_email(payload.email)
    _enforce_auth_rate_limits(
        db,
        request,
        operation="login",
        email=email,
    )
    user = db.scalar(select(User).where(User.email == email))
    if (
        user is None
        or user.status != "active"
        or not password_hasher.verify(payload.password, user.password_hash)
    ):
        raise _invalid_credentials()

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + SESSION_DURATION
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=_token_digest(token),
            expires_at=expires_at,
        )
    )
    db.commit()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=int(SESSION_DURATION.total_seconds()),
        httponly=True,
        secure=_secure_cookie(),
        samesite="lax",
        path="/",
    )
    return _public_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_database_session),
) -> None:
    if session_token:
        stored_session = db.scalar(
            select(UserSession).where(
                UserSession.token_hash == _token_digest(session_token),
                UserSession.revoked_at.is_(None),
            )
        )
        if stored_session is not None:
            stored_session.revoked_at = datetime.now(timezone.utc)
            db.commit()

    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_secure_cookie(),
        samesite="lax",
    )


@router.get("/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)) -> UserResponse:
    return _public_user(user)
