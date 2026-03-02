# core/security.py
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Any
from jose import jwt
from passlib.context import CryptContext
from core.config import settings
import secrets

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALGORITHM = "HS256"
ISSUER = getattr(settings, "JWT_ISSUER", "fwh-system")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(pw: str) -> str:
    return pwd_context.hash(pw)


get_password_hash = hash_password


def verify_password(pw: str, hashed: str) -> bool:
    return pwd_context.verify(pw, hashed)


def create_access_token(sub: str, role: str) -> str:
    exp = _now_utc() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": sub,
        "role": role,
        "type": "access",
        "iat": int(_now_utc().timestamp()),
        "exp": exp,
        "iss": ISSUER,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(sub: str) -> str:
    exp = _now_utc() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    jti = secrets.token_urlsafe(32)
    payload = {
        "sub": sub,
        "type": "refresh",
        "jti": jti,
        "iat": int(_now_utc().timestamp()),
        "exp": exp,
        "iss": ISSUER,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode JWT — validates exp + signature, skips issuer/audience checks."""
    return jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[ALGORITHM],
        options={"verify_aud": False},
    )


def verify_token_type(payload: dict, expected_type: str) -> bool:
    """Legacy tokens without 'type' field default to 'access'."""
    token_type = payload.get("type", "access")
    return token_type == expected_type
