from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_database_session
from models import User, UserSession


router = APIRouter(prefix="/auth", tags=["authentication"])
password_hasher = PasswordHash.recommended()
SESSION_COOKIE_NAME = "projectyasar_session"
SESSION_DURATION = timedelta(days=14)


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
        if not value[0].isalpha() or not value[0].isupper():
            raise ValueError("Password must start with an uppercase letter")
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
    db: Session = Depends(get_database_session),
) -> UserResponse:
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
    response: Response,
    db: Session = Depends(get_database_session),
) -> UserResponse:
    user = db.scalar(select(User).where(User.email == _normalized_email(payload.email)))
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
