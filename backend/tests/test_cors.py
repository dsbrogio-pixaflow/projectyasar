import pytest
from fastapi import Response
from httpx import ASGITransport, AsyncClient

from app import create_app, get_cors_origins


def test_local_cors_defaults_are_limited_to_vite_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    assert get_cors_origins() == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def test_production_requires_explicit_cors_origins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    with pytest.raises(RuntimeError, match="CORS_ORIGINS must be configured"):
        create_app()


@pytest.mark.parametrize(
    "configured_origins",
    [
        "*",
        "https://frontend.example.com/path",
        "http://frontend.example.com",
        "https://user:password@frontend.example.com",
        "https://frontend.example.com,",
    ],
)
def test_production_rejects_invalid_origins(
    monkeypatch: pytest.MonkeyPatch,
    configured_origins: str,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", configured_origins)

    with pytest.raises(RuntimeError, match="Invalid origin|empty origin"):
        create_app()


@pytest.mark.anyio
async def test_production_cors_allows_configured_origin_and_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    origin = "https://frontend.example.com"
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", origin)
    application = create_app()

    @application.get("/test-retry-after")
    async def retry_after_endpoint(response: Response) -> dict[str, str]:
        response.headers["Retry-After"] = "30"
        return {"status": "limited"}

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://api.example.com",
    ) as client:
        preflight = await client.options(
            "/health",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        response = await client.get(
            "/test-retry-after",
            headers={"Origin": origin},
        )

    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert preflight.headers["access-control-allow-credentials"] == "true"
    assert "post" in preflight.headers["access-control-allow-methods"].lower()
    assert "content-type" in preflight.headers["access-control-allow-headers"].lower()
    assert response.headers["access-control-expose-headers"] == "Retry-After"
    assert response.headers["retry-after"] == "30"


@pytest.mark.anyio
async def test_unlisted_origin_does_not_receive_cors_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://frontend.example.com")
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="https://api.example.com",
    ) as client:
        response = await client.get(
            "/health",
            headers={"Origin": "https://unlisted.example.com"},
        )

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
