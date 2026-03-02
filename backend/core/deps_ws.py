"""
core/deps_ws.py — WebSocket authentication dependency.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from urllib.parse import parse_qs

from fastapi import WebSocket
from jose import JWTError
import logging
from datetime import datetime, timezone

from core.security import decode_token, verify_token_type
from core.db import get_user_by_username, row_to_dict, get_db

logger = logging.getLogger("ws_auth")

_VALID_ROLES = {"admin", "operator", "qc", "viewer", "dashboard"}


class WSAuthError(Exception):
    def __init__(self, message: str, code: int = 4003):
        self.message = message
        self.code = code
        super().__init__(self.message)


@contextmanager
def _db_session():
    """Safely enter/exit the get_db() generator."""
    gen = get_db()
    db = next(gen)
    try:
        yield db
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def _fetch_user(username: str) -> dict[str, Any] | None:
    if not username:
        return None
    with _db_session() as db:
        row = get_user_by_username(db, username)
        return row_to_dict(row) if row else None


async def authenticate_websocket(websocket: WebSocket) -> dict[str, Any] | None:
    """
    Authenticate a WebSocket connection.
    Returns None on failure, payload dict on success.
    """
    try:
        # 1. Extract token
        query_params = parse_qs(websocket.url.query)
        token = query_params.get("token", [None])[0]

        if not token:
            logger.warning("WS NO-TOKEN from %s", websocket.client.host if websocket.client else "unknown")
            return None

        # 2. Decode token
        try:
            payload = decode_token(token)
        except JWTError as e:
            logger.warning("WS BAD-TOKEN %s from %s", str(e), websocket.client.host if websocket.client else "unknown")
            return None

        # 3. Verify token type
        if not verify_token_type(payload, "access"):
            logger.warning("WS WRONG-TOKEN-TYPE %s", payload.get("type"))
            return None

        # 4. Check expiry
        current_time = int(datetime.now(tz=timezone.utc).timestamp())
        if payload.get("exp", 0) < current_time:
            logger.warning("WS TOKEN-EXPIRED for user %s", payload.get("sub"))
            return None

        # 5. Verify user status (prevent disabled accounts using old tokens)
        try:
            user_row = _fetch_user(payload.get("sub"))
        except Exception as e:
            logger.error("WS USER-LOOKUP ERROR for %s: %s", payload.get("sub"), str(e))
            return None

        if not user_row:
            logger.warning("WS USER-NOT-FOUND %s", payload.get("sub"))
            return None
        if not user_row.get("is_active"):
            logger.warning("WS USER-INACTIVE %s", payload.get("sub"))
            return None

        role = user_row.get("role")
        if role not in _VALID_ROLES:
            logger.warning("WS INVALID-ROLE %s for user %s", role, payload.get("sub"))
            return None

        # Carry latest role to keep permissions in sync
        payload["role"] = role
        logger.info("WS AUTH SUCCESS for user %s", payload.get("sub"))
        return payload

    except Exception as e:
        logger.error("WS AUTH ERROR: %s", str(e))
        return None


async def get_current_user_ws(websocket: WebSocket) -> dict[str, Any]:
    """
    Placeholder dependency for FastAPI DI signature.
    Real auth is handled by authenticate_websocket() called directly in WS endpoints.
    """
    return {"sub": "unknown", "role": "viewer"}
