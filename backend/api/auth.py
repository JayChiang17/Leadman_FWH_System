from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError
from typing import Any

from core.db import (
    get_db, get_user_by_username,
    save_refresh_token, get_refresh_token,
    delete_refresh_token, delete_user_refresh_tokens,
    log_login_attempt
)
from core.security import (
    verify_password, create_access_token,
    create_refresh_token, decode_token, verify_token_type
)
from core.deps import get_current_user
from core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


# ─────────────────────────────
# helpers：同時支援物件與 dict 的欄位讀取
# ─────────────────────────────
def _field(u: Any, name: str, default: Any = None) -> Any:
    if isinstance(u, dict):
        return u.get(name, default)
    return getattr(u, name, default)


def _get_client_ip(request: Request) -> str:
    """獲取客戶端真實 IP（支援反向代理）"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"


def _get_user_agent(request: Request) -> str:
    """獲取 User-Agent"""
    return request.headers.get("User-Agent", "unknown")[:500]  # 限制長度


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshTokenRequest(BaseModel):
    refresh_token: str


@router.post("/token", response_model=TokenResponse)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db = Depends(get_db)
):
    ip_address = _get_client_ip(request)
    user_agent = _get_user_agent(request)
    username = form_data.username

    user = get_user_by_username(db, username)

    # 驗證用戶名和密碼
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        log_login_attempt(db, username, ip_address, user_agent, False, "Invalid credentials")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 檢查用戶是否啟用
    if user["is_active"] == 0:
        log_login_attempt(db, username, ip_address, user_agent, False, "Account inactive")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive"
        )

    # 建立 tokens
    access_token = create_access_token(
        sub=user["username"],
        role=user["role"]
    )
    refresh_token = create_refresh_token(sub=user["username"])

    # 儲存 refresh token 到資料庫
    save_refresh_token(
        db,
        user["id"],
        refresh_token,
        settings.REFRESH_TOKEN_EXPIRE_DAYS
    )

    # 記錄成功登入
    log_login_attempt(db, username, ip_address, user_agent, True)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # 秒
    }


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: RefreshTokenRequest,
    db = Depends(get_db)
):
    try:
        # 解碼 refresh token
        payload = decode_token(request.refresh_token)

        # 驗證 token 類型
        if not verify_token_type(payload, "refresh"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )

        # 檢查 token 是否在資料庫中
        token_record = get_refresh_token(db, request.refresh_token)
        if not token_record:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token not found or expired"
            )

        # 取得使用者資訊
        username = payload.get("sub")
        user = get_user_by_username(db, username)
        if not user or user["is_active"] == 0:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )

        # 建立新的 access token
        new_access_token = create_access_token(
            sub=user["username"],
            role=user["role"]
        )

        # 建立新的 refresh token（輪替）
        new_refresh_token = create_refresh_token(sub=user["username"])

        # 刪除舊的 refresh token
        delete_refresh_token(db, request.refresh_token)

        # 儲存新的 refresh token
        save_refresh_token(
            db,
            user["id"],
            new_refresh_token,
            settings.REFRESH_TOKEN_EXPIRE_DAYS
        )

        return {
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        }

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )


@router.post("/logout")
async def logout(
    current_user: Any = Depends(get_current_user),
    db = Depends(get_db)
):
    # 刪除該使用者的所有 refresh tokens（兼容物件或 dict）
    user_id = _field(current_user, "id")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid user context")
    delete_user_refresh_tokens(db, user_id)
    return {"message": "Logged out successfully"}


@router.get("/me")
async def read_users_me(current_user: Any = Depends(get_current_user)):
    return {
        "username": _field(current_user, "username"),
        "role": _field(current_user, "role"),
        "is_active": _field(current_user, "is_active")
    }
