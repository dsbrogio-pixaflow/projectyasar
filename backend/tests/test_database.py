from unittest.mock import Mock

import pytest
from sqlalchemy.pool import NullPool

from database import _engine_for_url, create_database_engine


def test_postgres_engine_disables_prepared_statements(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "postgresql+psycopg://db:placeholder@pooler.example:6543/app"
    expected_engine = object()
    create_engine = Mock(return_value=expected_engine)
    _engine_for_url.cache_clear()
    monkeypatch.setattr("database.create_engine", create_engine)

    try:
        engine = create_database_engine(url)
    finally:
        _engine_for_url.cache_clear()

    assert engine is expected_engine
    create_engine.assert_called_once_with(
        url,
        pool_pre_ping=True,
        poolclass=NullPool,
        connect_args={"prepare_threshold": None},
    )
