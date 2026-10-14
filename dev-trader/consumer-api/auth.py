"""OIDC JWT verification with asymmetric keys and strict issuer/audience.
Identity provider performs login, signup, passkeys and brute-force defense.
Do not accept app-provided role/tier claims as payment proof.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import jwt
from jwt import PyJWKClient

class AuthUnavailable(RuntimeError): pass
class AuthenticationRejected(RuntimeError): pass

@dataclass(frozen=True)
class Principal:
    subject: str
    email_verified: bool
    admin_mfa: bool

def settings() -> tuple[str, str, str, frozenset[str]]:
    issuer = os.getenv("KYVORIQ_CONSUMER_OIDC_ISSUER", "").strip().rstrip("/")
    audience = os.getenv("KYVORIQ_CONSUMER_OIDC_AUDIENCE", "").strip()
    jwks = os.getenv("KYVORIQ_CONSUMER_OIDC_JWKS_URL", "").strip()
    ids = frozenset(s.strip() for s in os.getenv("KYVORIQ_ADMIN_SUBJECTS", "").split(",") if s.strip())
    if not issuer or not audience or not jwks:
        raise AuthUnavailable("Consumer identity is not provisioned")
    # Prevent arbitrary insecure hosts and query-bearing JWKS URLs.
    p = urlparse(jwks)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.query or p.fragment:
        raise AuthUnavailable("OIDC signing keys URL must be an HTTPS endpoint")
    if urlparse(issuer).scheme != "https":
        raise AuthUnavailable("Issuer must use HTTPS")
    return issuer, audience, jwks, ids

def verify_access_token(token: str) -> Principal:
    if not token or len(token) > 8192:
        raise AuthenticationRejected("Invalid access token")
    issuer, audience, jwks, admins = settings()
    try:
        signing_key = PyJWKClient(jwks, cache_keys=True, lifespan=180).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token, signing_key.key,
            algorithms=["RS256", "ES256"], audience=audience,
            issuer=issuer, options={"require": ["sub", "iat", "exp", "iss", "aud"]},
            leeway=20,
        )
    except (jwt.PyJWTError, ConnectionError, ValueError, OSError):
        raise AuthenticationRejected("Invalid access token") from None
    sub = claims.get("sub")
    if not isinstance(sub, str) or not 1 <= len(sub) <= 256:
        raise AuthenticationRejected("Invalid subject")
    # Being on an email whitelist is insufficient for admin. A protected
    # immutable identity AND recent identity-provider MFA are required.
    methods = claims.get("amr")
    if not isinstance(methods, list):
        methods = []
    # A single SMS or email OTP is NOT sufficient to claim multi-factor auth.
    # Accept only an explicit IdP MFA assertion or a proven combination of
    # independent factors (not supplied by Android or decoded without a signature).
    mfa = ("mfa" in methods) or ("pwd" in methods and
            any(method in methods for method in {"totp", "webauthn", "hwk"}))
    firebase = claims.get("firebase")
    # Firebase Identity Platform's signed ID token may represent its MFA
    # second factor here rather than in "amr". A Google account sign-in
    # alone is NOT an administrative second factor.
    if isinstance(firebase, dict) and firebase.get("sign_in_second_factor") in {"totp", "phone"}:
        mfa = True
    auth_time = claims.get("auth_time")
    recent = (type(auth_time) is int and
              0 <= time.time() - auth_time <= 600)
    verified = claims.get("email_verified") is True
    return Principal(sub, verified, sub in admins and mfa and recent)
