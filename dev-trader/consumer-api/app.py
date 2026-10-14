"""KYVORIQ consumer account API, deliberately isolated from demo-execution API.

Requires managed OIDC/JWKS and a separate PostgreSQL service to activate.
Paid access remains disabled without verified, unexpired database entitlements.
No checkout endpoint or admin trading mutation is exposed until provider review.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from contextlib import contextmanager

import psycopg
from fastapi import FastAPI, Header, HTTPException, Depends, Request
from fastapi.responses import JSONResponse

from auth import verify_access_token, Principal, AuthenticationRejected, AuthUnavailable
from access_policy import Tier, FEATURE_MIN_TIER, OWNER_ONLY, entitled, grants, parse_tier
from rate_limit import check_consumer_rate, LimiterUnavailable

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def safety_headers(request: Request, call_next):
    supplied_length = request.headers.get("content-length", "0")
    if not supplied_length.isascii() or not supplied_length.isdecimal() or len(supplied_length) > 12:
        return JSONResponse({"detail": "Invalid content length"}, status_code=400)
    if int(supplied_length) > 16_384:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    if request.url.path.startswith("/v1/") and os.getenv("KYVORIQ_CONSUMER_OIDC_ISSUER", "").strip():
        # Rate limiting is mandatory once identity goes live. No permissive
        # "Redis down, try anyway" fallback for authenticated consumers.
        try:
            allowed, wait = await check_consumer_rate(request.client.host if request.client else "unknown")
        except LimiterUnavailable:
            return JSONResponse({"detail": "Consumer security service unavailable"},
                                status_code=503, headers={"Cache-Control": "no-store"})
        if not allowed:
            return JSONResponse({"detail": "Too many requests"}, status_code=429,
                                headers={"Retry-After": str(wait), "Cache-Control": "no-store"})
    response = await call_next(request)
    response.headers.update({
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    })
    return response

def require_identity(authorization: str | None = Header(default=None)) -> Principal:
    if os.getenv("KYVORIQ_CONSUMER_AUTH_ENABLED", "") != "true":
        raise HTTPException(503, "Consumer authentication not activated")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required", headers={"WWW-Authenticate": "Bearer"})
    try:
        identity = verify_access_token(authorization[7:])
    except AuthUnavailable:
        raise HTTPException(503, "Consumer authentication unavailable") from None
    except AuthenticationRejected:
        raise HTTPException(401, "Authentication required") from None
    if not identity.email_verified:
        raise HTTPException(403, "Verified account required")
    return identity

@contextmanager
def consumer_db():
    dsn = os.getenv("KYVORIQ_CONSUMER_DATABASE_URL", "").strip()
    if not dsn:
        raise HTTPException(503, "Consumer accounts unavailable")
    # This DSN MUST belong to a separate consumer DB/user, never the exchange DB.
    try:
        with psycopg.connect(dsn, connect_timeout=4, autocommit=True) as conn:
            yield conn
    except psycopg.Error:
        raise HTTPException(503, "Consumer accounts unavailable") from None

def authoritative_tier(subject: str) -> Tier:
    with consumer_db() as conn:
        row = conn.execute(
            """SELECT tier FROM consumer_entitlements
               WHERE subject = %s AND valid_until > CURRENT_TIMESTAMP
                 AND source IN ('payment_webhook', 'admin_grant')
               LIMIT 1""",
            (subject,),
        ).fetchone()
    return parse_tier(row[0]) if row else Tier.BASIC

@app.get("/livez")
def livez():
    # Liveness does not claim account readiness.
    return {"status": "running"}

@app.get("/readyz", include_in_schema=False)
def readyz():
    # Never claim consumer login has launched just because Uvicorn can start.
    # Return no actual issuer, client IDs, passwords or private connection URL.
    configured = (
        os.getenv("KYVORIQ_CONSUMER_AUTH_ENABLED", "") == "true"
        and bool(os.getenv("KYVORIQ_CONSUMER_OIDC_ISSUER", "").strip())
        and bool(os.getenv("KYVORIQ_CONSUMER_OIDC_AUDIENCE", "").strip())
        and bool(os.getenv("KYVORIQ_CONSUMER_OIDC_JWKS_URL", "").strip())
        and bool(os.getenv("KYVORIQ_CONSUMER_DATABASE_URL", "").strip())
        and os.getenv("KYVORIQ_CONSUMER_REDIS_URL", "").startswith("rediss://")
        and len(os.getenv("KYVORIQ_RATE_LIMIT_HMAC_KEY", "").encode()) >= 32
    )
    if not configured:
        return JSONResponse(
            {"status": "not_configured", "consumer_login_live": False},
            status_code=503, headers={"Cache-Control": "no-store"}
        )
    # Config presence alone is not an end-to-end email/login test. The
    # deployment gate must separately verify IdP, DB, Redis and mail flows.
    return {"status": "configured", "consumer_login_live": False}

@app.get("/v1/catalog")
def catalog():
    return {
        "tiers": ["BASIC", "PRO", "ELITE"],
        "features": {name: minimum.name for name, minimum in FEATURE_MIN_TIER.items()},
        "billing_enabled": False,
        "checkout_url": None,
        "disclaimer": "Subscriptions are not live. Trading carries risk; outcomes are not guaranteed.",
    }

@app.get("/v1/me")
def me(identity: Principal = Depends(require_identity)):
    tier = authoritative_tier(identity.subject)
    return {
        "subject": identity.subject,
        "tier": tier.name,
        "features": grants(tier),
        "admin": identity.admin_mfa,
        "billing_enabled": False,
    }

@app.get("/v1/access/{feature}")
def access(feature: str, identity: Principal = Depends(require_identity)):
    # Querying an owner-only name never grants access, even if a consumer
    # manipulated the Android APK, JWT display or client feature flags.
    if feature in OWNER_ONLY:
        raise HTTPException(403, "Not a consumer capability")
    if feature not in FEATURE_MIN_TIER:
        raise HTTPException(404, "Unknown feature")
    tier = authoritative_tier(identity.subject)
    if not entitled(tier, feature):
        raise HTTPException(403, "Subscription entitlement required")
    # Only access decision returned here. Feature data must be served by its
    # own policy-checked endpoint; never infer permission from a client flag.
    return {"feature": feature, "allowed": True, "tier": tier.name}

@app.get("/v1/admin/overview")
def admin_overview(identity: Principal = Depends(require_identity)):
    if not identity.admin_mfa:
        raise HTTPException(403, "Strong owner authentication required")
    with consumer_db() as conn:
        active = conn.execute(
            "SELECT tier, count(*) FROM consumer_entitlements WHERE valid_until > CURRENT_TIMESTAMP GROUP BY tier"
        ).fetchall()
        accounts = conn.execute("SELECT count(*) FROM consumer_accounts").fetchone()[0]
    # No exchange key access, no owner trading engine commands.
    return {"accounts": accounts, "active_paid_subscriptions": {row[0]: row[1] for row in active},
            "exchange_execution_controls": "NOT_EXPOSED"}

@app.post("/v1/checkout")
def checkout_disabled(identity: Principal = Depends(require_identity)):
    # Placeholder intentionally refuses money until merchant setup and signed
    # payment provider webhooks are audited.
    raise HTTPException(503, "Payments not enabled")
