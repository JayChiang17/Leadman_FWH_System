# core/deps_ws.py - 修復後的 WebSocket 認證
"""
WebSocket 認證依賴 - 修復版本
解決認證時序和錯誤處理問題
"""
from __future__ import annotations
from typing import Dict, Any, Optional
from urllib.parse import parse_qs
from fastapi import WebSocket
from jose import JWTError
import logging
from datetime import datetime, timezone

from core.security import decode_token, verify_token_type

logger = logging.getLogger("ws_auth")

class WSAuthError(Exception):
    """WebSocket 認證錯誤"""
    def __init__(self, message: str, code: int = 4003):
        self.message = message
        self.code = code
        super().__init__(self.message)

async def authenticate_websocket(websocket: WebSocket) -> Optional[Dict[str, Any]]:
    """
    WebSocket 認證函數 - 不直接作為依賴項使用
    返回 None 表示認證失敗，返回 payload 表示成功
    """
    try:
        # 1. 提取 token
        query_params = parse_qs(websocket.url.query)
        token = query_params.get("token", [None])[0]
        
        if not token:
            logger.warning("WS NO-TOKEN from %s", websocket.client.host if websocket.client else "unknown")
            return None
        
        # 2. 解碼 token
        try:
            payload = decode_token(token)
        except JWTError as e:
            logger.warning("WS BAD-TOKEN %s from %s", str(e), websocket.client.host if websocket.client else "unknown")
            return None
        
        # 3. 驗證 token 類型
        if not verify_token_type(payload, "access"):
            logger.warning("WS WRONG-TOKEN-TYPE %s", payload.get("type"))
            return None
        
        # 4. 檢查過期
        current_time = int(datetime.now(tz=timezone.utc).timestamp())
        if payload.get("exp", 0) < current_time:
            logger.warning("WS TOKEN-EXPIRED for user %s", payload.get("sub"))
            return None
        
        # 5. 驗證角色
        role = payload.get("role")
        if role not in {"admin", "operator", "qc", "viewer"}:
            logger.warning("WS INVALID-ROLE %s for user %s", role, payload.get("sub"))
            return None
        
        logger.info("✅ WS AUTH SUCCESS for user %s", payload.get("sub"))
        return payload
        
    except Exception as e:
        logger.error("WS AUTH ERROR: %s", str(e))
        return None

async def get_current_user_ws(websocket: WebSocket) -> Dict[str, Any]:
    """
    WebSocket 用戶認證依賴項
    ⚠️ 此函數不應拋出異常，認證邏輯在 websocket 端點中處理
    """
    # 這個函數實際上不會被調用到認證邏輯
    # 真正的認證在各個 websocket 端點中進行
    return {"sub": "unknown", "role": "viewer"}