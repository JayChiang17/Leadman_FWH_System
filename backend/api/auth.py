from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError
from typing import Any

from core.db import (
    get_db, get_user_by_username,
    save_refresh_token, get_refresh_token,
    delete_refresh_token, delete_user_refresh_tokens
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


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshTokenRequest(BaseModel):
    refresh_token: str


@router.post("/token", response_model=TokenResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db = Depends(get_db)
):
    user = get_user_by_username(db, form_data.username)
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user["is_active"] == 0:
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
