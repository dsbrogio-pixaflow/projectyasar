import os
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth import router as auth_router
from customers import router as customers_router
from inventory import router as inventory_router
from products import router as products_router

LOCAL_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
CORS_HEADERS = ["Content-Type"]


def get_cors_origins() -> list[str]:
    is_production = (
        os.environ.get("APP_ENV", "").lower() == "production"
        or os.environ.get("VERCEL") == "1"
    )
    configured_origins = os.environ.get("CORS_ORIGINS")
    if configured_origins is None:
        if is_production:
            raise RuntimeError("CORS_ORIGINS must be configured in production")
        return LOCAL_CORS_ORIGINS.copy()

    raw_origins = configured_origins.split(",")
    if any(not origin.strip() for origin in raw_origins):
        raise RuntimeError("CORS_ORIGINS contains an empty origin")

    origins: list[str] = []
    for raw_origin in raw_origins:
        origin = raw_origin.strip().rstrip("/")
        parsed = urlsplit(origin)
        try:
            parsed.port
        except ValueError:
            raise RuntimeError(f"Invalid origin in CORS_ORIGINS: {origin}") from None

        hostname = parsed.hostname
        is_localhost = hostname in {"localhost", "127.0.0.1", "::1"}
        if (
            origin == "*"
            or parsed.scheme not in {"http", "https"}
            or hostname is None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or (parsed.scheme != "https" and (is_production or not is_localhost))
        ):
            raise RuntimeError(f"Invalid origin in CORS_ORIGINS: {origin}")
        if origin not in origins:
            origins.append(origin)

    return origins


def create_app() -> FastAPI:
    application = FastAPI(title="Projeto Yasar API", version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=True,
        allow_methods=CORS_METHODS,
        allow_headers=CORS_HEADERS,
        expose_headers=["Retry-After"],
    )
    application.include_router(auth_router, prefix="/api/v1")
    application.include_router(customers_router, prefix="/api/v1")
    application.include_router(products_router, prefix="/api/v1")
    application.include_router(inventory_router, prefix="/api/v1")

    @application.get("/health", tags=["health"])
    async def health_check() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
