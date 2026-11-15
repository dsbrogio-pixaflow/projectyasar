import os
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session as SQLAlchemySession
from sqlalchemy.pool import NullPool

load_dotenv(Path(__file__).resolve().with_name(".env"), override=False)


def get_database_url(database_url: str | None = None) -> str:
    url = database_url or os.environ.get("DATABASE_URL")

    if not url:
        raise RuntimeError(
            "DATABASE_URL must be set before connecting to the database"
        )

    url = url.strip()

    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)

    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)

    return url


@lru_cache(maxsize=4)
def _engine_for_url(url: str) -> Engine:
    connect_args = (
        {"prepare_threshold": None}
        if url.startswith("postgresql+psycopg://")
        else {}
    )
    return create_engine(
        url,
        pool_pre_ping=True,
        poolclass=NullPool,
        connect_args=connect_args,
    )


def create_database_engine(database_url: str | None = None) -> Engine:
    return _engine_for_url(get_database_url(database_url))


def get_database_session() -> Iterator[SQLAlchemySession]:
    engine = create_database_engine()
    with SQLAlchemySession(engine) as session:
        yield session