import os

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from auth import RegisterRequest, password_hasher
from database import create_database_engine
from models import User


_BOOTSTRAP_LOCK_ID = 603_504_749_747_197_952


def provision_initial_admin(db: Session, email: str, password: str) -> User:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_id)"),
            {"lock_id": _BOOTSTRAP_LOCK_ID},
        )

    existing_admin = db.scalar(select(User.id).where(User.role == "admin").limit(1))
    if existing_admin is not None:
        raise RuntimeError("An administrator already exists; bootstrap is one-time only")

    payload = RegisterRequest(
        full_name="Administrador inicial",
        email=email,
        password=password,
    )
    admin = User(
        full_name=payload.full_name,
        email=str(payload.email).strip().lower(),
        password_hash=password_hasher.hash(payload.password),
        role="admin",
        status="active",
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def _required_environment_variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def main() -> None:
    email = _required_environment_variable("ADMIN_BOOTSTRAP_EMAIL")
    password = _required_environment_variable("ADMIN_BOOTSTRAP_PASSWORD")
    engine = create_database_engine()

    with Session(engine) as db:
        provision_initial_admin(db, email, password)

    print("Initial administrator created. Remove the bootstrap credentials from the environment.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from None
