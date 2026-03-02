# backend/api/ws_router.py
"""
WebSocket 路由（使用 core.pg 連線 PostgreSQL pcba schema）
- 認證後才 accept()
- 所有 send/receive 皆加保護
- 初始資料與事件廣播一致
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional

import psycopg2.extras
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from core.deps_ws import authenticate_websocket
from core.pg import get_conn
from core.ws_manager import ws_manager

# 直接共用 API 端邏輯
from api.pcba import (
    _get_all_boards,
    _get_board_by_serial,
    _get_statistics,
    _create_board_internal,
    _update_board_stage_internal,
    BoardCreate,
)

logger = logging.getLogger("api.ws_router")
router = APIRouter()

PCBA_SCHEMA = "pcba"


def _pcba_cursor(conn):
    """Create a RealDictCursor for the pcba schema."""
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


# ------------------ 安全 send 工具 ------------------
def _is_connected(ws: WebSocket) -> bool:
    return (
        ws.client_state == WebSocketState.CONNECTED
        and ws.application_state == WebSocketState.CONNECTED
    )


async def safe_send_text(ws: WebSocket, text: str) -> bool:
    try:
        if not _is_connected(ws):
            return False
        await asyncio.wait_for(ws.send_text(text), timeout=5.0)
        return True
    except Exception:
        return False


async def safe_send_json(ws: WebSocket, data: dict) -> bool:
    try:
        if not _is_connected(ws):
            return False
        await asyncio.wait_for(ws.send_json(data), timeout=5.0)
        return True
    except Exception:
        return False


# ------------------ Dashboard WS ------------------
@router.websocket("/realtime/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    user = await authenticate_websocket(websocket)
    if not user:
        try:
            await websocket.close(code=4003, reason="Authentication failed")
        except Exception:
            pass
        return

    # 一定先 accept，再做其他事
    try:
        await websocket.accept()
    except RuntimeError as e:
        if "accept" not in str(e).lower():
            logger.exception("dashboard accept() failed")
            return

    if not await ws_manager.connect(websocket, user):
        return

    try:
        await safe_send_json(
            websocket,
            {
                "type": "welcome",
                "message": f"Dashboard connected for {user.get('sub')}",
                "role": user.get("role"),
            },
        )

        while _is_connected(websocket):
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if raw == "ping":
                    await safe_send_text(websocket, "pong")
            except asyncio.TimeoutError:
                await safe_send_text(websocket, "heartbeat")
            except WebSocketDisconnect:
                break
            except Exception:
                break
    finally:
        await ws_manager.disconnect(websocket)


# ------------------ PCBA WS ------------------
@router.websocket("/realtime/pcba")
async def websocket_pcba(websocket: WebSocket):
    user: Optional[Dict[str, Any]] = None
    try:
        # 認證（未 accept 前）
        user = await authenticate_websocket(websocket)
        if not user:
            try:
                await websocket.close(code=4003, reason="Authentication failed")
            except Exception:
                pass
            return

        if user.get("role") not in {"admin", "operator", "qc"}:
            try:
                await websocket.close(code=4003, reason="Insufficient permissions")
            except Exception:
                pass
            return

        # 接受連線
        try:
            await websocket.accept()
        except RuntimeError as e:
            if "accept" not in str(e).lower():
                logger.exception("PCBA accept() failed")
                return

        if not await ws_manager.connect(websocket, user):
            return

        logger.info("PCBA WebSocket connected for user: %s", user.get("sub"))

        # 初始資料
        await asyncio.sleep(0.05)
        await send_initial_pcba_data_safe(websocket)

        # 主回圈
        while _is_connected(websocket):
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if raw == "ping":
                    await safe_send_text(websocket, "pong")
                    continue

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await safe_send_json(websocket, {"type": "error", "message": "Invalid JSON"})
                    continue

                await handle_pcba_message_safe(websocket, msg, user)

            except asyncio.TimeoutError:
                await safe_send_text(websocket, "heartbeat")
            except WebSocketDisconnect:
                break
            except Exception:
                break

    finally:
        if user:
            logger.info("PCBA WebSocket disconnected for user: %s", user.get("sub"))
        await ws_manager.disconnect(websocket)


# ------------------ 初始資料/訊息處理 ------------------
async def send_initial_pcba_data_safe(ws: WebSocket):
    if not _is_connected(ws):
        return

    try:
        with get_conn(PCBA_SCHEMA) as conn:
            cur = _pcba_cursor(conn)
            # FIX: Don't send all 11,288 boards! Only send statistics
            # Front-end will load boards via REST API as needed
            stats = _get_statistics(conn, cur)
            cur.close()
        payload = stats.dict() if hasattr(stats, "dict") else (stats.model_dump() if hasattr(stats, "model_dump") else stats.__dict__)
        # Send empty boards array - front-end loads via API
        await safe_send_json(ws, {"type": "initial_data", "boards": [], "statistics": payload})
    except Exception as e:
        logger.error(f"Failed to send initial PCBA data: {e}")
        await safe_send_json(ws, {"type": "error", "message": "Failed to load initial data"})


async def handle_pcba_message_safe(ws: WebSocket, message: Dict[str, Any], user: Dict[str, Any]):
    mtype = message.get("type")
    uname = user.get("sub", "Unknown")

    try:
        if mtype == "new_board":
            await handle_new_board_safe(message, uname)

        elif mtype == "update_board":
            await handle_update_board_safe(message, uname)

        elif mtype == "request_board_data":
            await handle_request_board_data_safe(ws, message)

        elif mtype == "get_statistics":
            await handle_get_statistics_safe(ws)

        elif mtype == "ping":
            await safe_send_text(ws, "pong")

        else:
            await safe_send_json(ws, {"type": "error", "message": f"Unknown message type: {mtype}"})

    except Exception as e:
        await safe_send_json(ws, {"type": "error", "message": f"Failed to process {mtype}: {e}"})


async def handle_new_board_safe(message: Dict[str, Any], username: str):
    board_data = message.get("board") or {}
    if not board_data:
        raise ValueError("Missing board data")

    with get_conn(PCBA_SCHEMA) as conn:
        cur = _pcba_cursor(conn)
        serial = board_data.get("serialNumber")
        if not serial:
            raise ValueError("Missing serialNumber")

        existing = _get_board_by_serial(cur, serial)
        if existing:
            board = _update_board_stage_internal(conn, cur, serial, board_data.get("stage"), username)
            action = "updated"
        else:
            create_data = BoardCreate(
                serialNumber=serial,
                stage=board_data.get("stage"),
                batchNumber=board_data.get("batchNumber"),
                model=board_data.get("model", "AUTO-DETECT"),
                operator=username,
            )
            board = _create_board_internal(conn, cur, create_data, username)
            action = "created"

        stats = _get_statistics(conn, cur)
        cur.close()

    payload = stats.dict() if hasattr(stats, "dict") else (stats.model_dump() if hasattr(stats, "model_dump") else stats.__dict__)
    await ws_manager.broadcast_many(
        [
            {"type": "board_update", "board": board},
            {
                "type": "notification",
                "message": f"Board {board['serialNumber']} {action} - Stage: {board['stage']}",
                "level": "success",
            },
            {"type": "statistics_update", "statistics": payload},
        ]
    )


async def handle_update_board_safe(message: Dict[str, Any], username: str):
    board_data = message.get("board") or {}
    if not board_data:
        raise ValueError("Missing board data")

    with get_conn(PCBA_SCHEMA) as conn:
        cur = _pcba_cursor(conn)
        serial = board_data.get("serialNumber")
        stage = board_data.get("stage")
        if not serial or not stage:
            raise ValueError("Missing serialNumber or stage")

        board = _update_board_stage_internal(conn, cur, serial, stage, username)
        stats = _get_statistics(conn, cur)
        cur.close()

    payload = stats.dict() if hasattr(stats, "dict") else (stats.model_dump() if hasattr(stats, "model_dump") else stats.__dict__)
    await ws_manager.broadcast_many(
        [
            {"type": "board_update", "board": board},
            {"type": "notification", "message": f"Board {board['serialNumber']} moved to {board['stage']}", "level": "info"},
            {"type": "statistics_update", "statistics": payload},
        ]
    )


async def handle_request_board_data_safe(ws: WebSocket, message: Dict[str, Any]):
    serial = message.get("serialNumber")
    if not serial:
        await safe_send_json(ws, {"type": "error", "message": "serialNumber required"})
        return

    with get_conn(PCBA_SCHEMA) as conn:
        cur = _pcba_cursor(conn)
        board = _get_board_by_serial(cur, serial)
        cur.close()

    if board:
        await safe_send_json(ws, {"type": "board_update", "board": board})
    else:
        await safe_send_json(ws, {"type": "error", "message": f"Board {serial} not found"})


async def handle_get_statistics_safe(ws: WebSocket):
    with get_conn(PCBA_SCHEMA) as conn:
        cur = _pcba_cursor(conn)
        stats = _get_statistics(conn, cur)
        cur.close()

    payload = stats.dict() if hasattr(stats, "dict") else (stats.model_dump() if hasattr(stats, "model_dump") else stats.__dict__)
    await safe_send_json(ws, {"type": "statistics_update", "statistics": payload})
