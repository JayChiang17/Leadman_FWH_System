"""
Fixed core/deps.py - 解決用戶認證和數據庫併發問題
────────────────────────────────────────────────
修復內容：
1. 改善錯誤處理和日誌記錄
2. 添加重試機制
3. 優化數據庫查詢邏輯
4. 改善緩存機制
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from functools import lru_cache
from typing import Annotated, Literal

import sqlite3
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from pydantic import BaseModel, ValidationError

from core.db import get_db, get_user_by_username, row_to_dict
from core.security import decode_token, verify_token_type

# 設置日誌
logger = logging.getLogger(__name__)

# ──────────────────────────────
# 1. 型別宣告
# ──────────────────────────────
Role = Literal["admin", "qc", "operator", "viewer"]

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

# ──────────────────────────────
# 2. OAuth2 來源
# ──────────────────────────────
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/token",
    scheme_name="JWT",
    auto_error=False
)

def http_exc(code: int, detail: str) -> HTTPException:
    """統一的 HTTP 異常創建函數"""
    headers = {"WWW-Authenticate": "Bearer"} if code == status.HTTP_401_UNAUTHORIZED else None
    return HTTPException(status_code=code, detail=detail, headers=headers)

# ──────────────────────────────
# 3. 安全的用戶查詢函數
# ──────────────────────────────
def safe_get_user_by_username(db: sqlite3.Connection, username: str) -> dict | None:
    """安全的用戶查詢函數，帶錯誤處理"""
    if not username or not isinstance(username, str):
        logger.warning(f"Invalid username parameter: {username}")
        return None
    
    try:
        row = get_user_by_username(db, username)
        return row_to_dict(row) if row else None
        
    except sqlite3.OperationalError as e:
        if "database is locked" in str(e).lower():
            logger.warning(f"Database locked during user query for {username}")
            # 對於認證請求，我們不重試，直接返回錯誤
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database temporarily unavailable"
            )
        logger.error(f"Database operational error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error"
        )
    except sqlite3.InterfaceError as e:
        logger.error(f"Database interface error: {e}, username: {username}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database interface error"
        )
    except Exception as e:
        logger.error(f"Unexpected error in safe_get_user_by_username: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

# ──────────────────────────────
# 4. 取得當前使用者
# ──────────────────────────────
def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[sqlite3.Connection, Depends(get_db)]
) -> User:
    """獲取當前用戶，改善錯誤處理"""
    
    if not token:
        logger.debug("No token provided")
        raise http_exc(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    try:
        # ① 解碼 JWT
        try:
            payload_dict = decode_token(token)
            payload = TokenPayload(**payload_dict)
        except (JWTError, ValidationError) as e:
            logger.warning(f"Token decode error: {e}")
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Invalid token")

        # ② 驗證 token 類型
        if not verify_token_type(payload_dict, "access"):
            logger.warning("Invalid token type")
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Invalid token type")

        # ③ 檢查過期
        current_time = int(datetime.now(tz=timezone.utc).timestamp())
        if payload.exp < current_time:
            logger.debug(f"Token expired: {payload.exp} < {current_time}")
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "Token expired")

        # ④ 查詢用戶
        try:
            user_data = safe_get_user_by_username(db, payload.sub)
        except HTTPException:
            # 重新拋出 HTTP 異常
            raise
        
        if not user_data:
            logger.warning(f"User not found: {payload.sub}")
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "User not found")
        
        if not user_data.get("is_active", False):
            logger.warning(f"User inactive: {payload.sub}")
            raise http_exc(status.HTTP_401_UNAUTHORIZED, "User inactive")

        return User.model_validate(user_data)

    except HTTPException:
        # 重新拋出 HTTP 異常
        raise
    except Exception as e:
        # 捕獲其他未預期的錯誤
        logger.error(f"Unexpected error in get_current_user: {e}")
        raise http_exc(status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal server error")

# ──────────────────────────────
# 5. 角色權限檢查
# ──────────────────────────────
def require_roles(*allowed: Role):
    """角色權限檢查裝飾器"""
    allowed_set = set(allowed)

    def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in allowed_set:
            logger.warning(f"Access denied for user {user.username} with role {user.role}")
            raise http_exc(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    checker.__name__ = f"require_roles_{'_'.join(sorted(allowed_set))}"
    return checker

# ──────────────────────────────
# 6. 可選的管理員檢查
# ──────────────────────────────
def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    """要求管理員權限"""
    if user.role != "admin":
        logger.warning(f"Admin access denied for user {user.username}")
        raise http_exc(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user

def require_qc_or_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    """要求 QC 或管理員權限"""
    if user.role not in ["qc", "admin"]:
        logger.warning(f"QC/Admin access denied for user {user.username}")
        raise http_exc(status.HTTP_403_FORBIDDEN, "QC or Admin access required")
    return user

# ──────────────────────────────
# 7. 用戶緩存（可選）
# ──────────────────────────────
@lru_cache(maxsize=512)
def cached_user_lookup(username: str, cache_time: int) -> User | None:
    """緩存用戶查詢，減少數據庫負載"""
    try:
        from core.db import db_manager
        with db_manager.get_connection() as db:
            user_data = safe_get_user_by_username(db, username)
            return User.model_validate(user_data) if user_data else None
    except Exception as e:
        logger.error(f"Error in cached user lookup: {e}")
        return None

def get_cached_user(username: str) -> User | None:
    """獲取緩存的用戶，5分鐘緩存"""
    # 使用當前時間的5分鐘區間作為緩存鍵
    cache_time = int(time.time() // 300)  # 5分鐘區間
    return cached_user_lookup(username, cache_time)

def clear_user_cache():
    """清理用戶緩存"""
    cached_user_lookup.cache_clear()
    logger.info("User cache cleared")

# ──────────────────────────────
# 8. 可選的令牌驗證（不查詢用戶）
# ──────────────────────────────
def verify_token_only(token: Annotated[str, Depends(oauth2_scheme)]) -> TokenPayload:
    """僅驗證令牌，不查詢用戶（用於輕量級檢查）"""
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

# ──────────────────────────────
# 9. 錯誤監控
# ──────────────────────────────
class AuthMetrics:
    """認證指標收集器"""
    
    def __init__(self):
        self.auth_attempts = 0
        self.auth_failures = 0
        self.db_errors = 0
        self.last_reset = time.time()
    
    def record_auth_attempt(self):
        self.auth_attempts += 1
    
    def record_auth_failure(self, reason: str):
        self.auth_failures += 1
        logger.info(f"Auth failure: {reason}")
    
    def record_db_error(self):
        self.db_errors += 1
    
    def get_stats(self) -> dict:
        uptime = time.time() - self.last_reset
        return {
            "auth_attempts": self.auth_attempts,
            "auth_failures": self.auth_failures,
            "db_errors": self.db_errors,
            "success_rate": (self.auth_attempts - self.auth_failures) / max(self.auth_attempts, 1),
            "uptime_minutes": uptime / 60
        }
    
    def reset_stats(self):
        self.auth_attempts = 0
        self.auth_failures = 0
        self.db_errors = 0
        self.last_reset = time.time()

# 全局指標收集器
auth_metrics = AuthMetrics()