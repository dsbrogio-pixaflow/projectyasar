import os

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine


def get_database_url(database_url: str | None = None) -> str:
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL must be set before connecting to the database")

    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def create_database_engine(database_url: str | None = None) -> Engine:
    return create_engine(get_database_url(database_url), pool_pre_ping=True)
