"""
core/deps.py — Auth dependencies for FastAPI routes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from pydantic import BaseModel, ValidationError

from core.db import get_db, get_user_by_username, row_to_dict
from core.security import decode_token, verify_token_type

logger = logging.getLogger(__name__)

# ── Type declarations ──

Role = Literal["admin", "qc", "operator", "viewer", "dashboard"]


class TokenPayload(BaseModel):
    sub: str
    exp: int
    type: Literal["access", "refresh"]


class User(BaseModel):
    id: int
    username: str
    role: Role
    is_active: bool = True
    full_name: str | None = None


# ── OAuth2 scheme ──

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/token",
    scheme_name="JWT",
    auto_error=False,
)


def http_exc(code: int, detail: str) -> HTTPException:
    headers = {"WWW-Authenticate": "Bearer"} if code == status.HTTP_401_UNAUTHORIZED else None
    return HTTPException(status_code=code, detail=detail, headers=headers)


# ── Safe user lookup ──

def safe_get_user_by_username(db, username: str) -> dict | None:
    """Fetch user with error handling. db is (conn, cur) tuple."""
    if not username or not isinstance(username, str):
        logger.warning(f"Invalid username parameter: {username}")
        return None

    try:
        row = get_user_by_username(db, username)
        return row_to_dict(row) if row else None
    except Exception as e:
        logger.error(f"Database error in safe_get_user_by_username: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error",
        )


# ── Get current user ──

def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[tuple, Depends(get_db)],
) -> User:
    if not token:
        raise http_exc(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    try:
        # Decode JWT
        try:
            payload_dict = decode_token(token)
            payload = TokenPayload(**payload_dict)
        except (JWTError, ValidationError) as e:
            logger.warning(f"Token decode error: {e}")
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Invalid token")

        # Verify token type
        if not verify_token_type(payload_dict, "access"):
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Invalid token type")

        # Check expiry
        current_time = int(datetime.now(tz=timezone.utc).timestamp())
        if payload.exp < current_time:
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Token expired")

        # Fetch user
        try:
            user_data = safe_get_user_by_username(db, payload.sub)
        except HTTPException:
            raise

        if not user_data:
            logger.warning(f"User not found: {payload.sub}")
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "User not found")

        if not user_data.get("is_active", False):
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "User inactive")

        return User.model_validate(user_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_current_user: {e}")
        raise http_exc(status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal server error")


# ── Role checkers ──

def require_roles(*allowed: Role):
    allowed_set = set(allowed)

    def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in allowed_set:
            raise http_exc(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    checker.__name__ = f"require_roles_{'_'.join(sorted(allowed_set))}"
    return checker


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != "admin":
        raise http_exc(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


def require_qc_or_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role not in ["qc", "admin"]:
        raise http_exc(status.HTTP_403_FORBIDDEN, "QC or Admin access required")
    return user


# ── Lightweight token-only verification ──

def verify_token_only(token: Annotated[str, Depends(oauth2_scheme)]) -> TokenPayload:
    """Verify token without DB lookup (for lightweight checks)."""
    if not token:
        raise http_exc(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    try:
        payload_dict = decode_token(token)
        payload = TokenPayload(**payload_dict)

        if not verify_token_type(payload_dict, "access"):
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Invalid token type")

        current_time = int(datetime.now(tz=timezone.utc).timestamp())
        if payload.exp < current_time:
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Token expired")

        return payload

    except (JWTError, ValidationError) as e:
        logger.warning(f"Token verification error: {e}")
        raise http_exc(status.HTTP_401_UNAUTHORIZED, "Invalid token")
