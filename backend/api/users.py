# backend/api/users.py
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Literal, Optional, List

from core.db import (
    get_db,
    list_users,
    create_user,
    update_user,
    delete_user,
    get_user_by_username,
)
from core.security import hash_password
from core.deps import require_roles

# ──────────────────────────────────────────────
# Pydantic Schemas
# ──────────────────────────────────────────────
class UserOut(BaseModel):
    id: int
    username: str
    role: Literal["admin", "operator", "qc", "viewer"]
    is_active: bool

class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=4)
    role: Literal["admin", "operator", "qc", "viewer"] = "viewer"

class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=2, max_length=64)
    password: Optional[str] = Field(None, min_length=4)
    role: Optional[Literal["admin", "operator", "qc", "viewer"]] = None
    is_active: Optional[bool] = None

# ──────────────────────────────────────────────
router = APIRouter(prefix="/users", tags=["users"])
# 僅 admin 可操作
require_admin = Depends(require_roles("admin"))
# ──────────────────────────────────────────────

# ① 取得全部使用者 -------------------------------------------------
@router.get("/", response_model=List[UserOut], dependencies=[require_admin])
def get_users(db = Depends(get_db)):
    return [dict(r) for r in list_users(db)]

# ② 新增使用者 -----------------------------------------------------
@router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
    response_model=UserOut,
    dependencies=[require_admin],
)
def add_user(payload: UserCreate, db = Depends(get_db)):
    # 檢查重複 username
    if get_user_by_username(db, payload.username):
        raise HTTPException(status_code=400, detail="Username already exists")

    row = create_user(
        db,
        payload.username,
        hash_password(payload.password),
        payload.role,
    )
    return dict(row)

# ③ 更新使用者（PUT：允許局部更新） --------------------------------
@router.put("/{uid}", response_model=UserOut, dependencies=[require_admin])
def edit_user(uid: int, payload: UserUpdate, db = Depends(get_db)):
    fields = {}

    # username（若有提供則需檢查是否與他人重複）
    if payload.username is not None:
        existing = get_user_by_username(db, payload.username)
        if existing and int(existing["id"]) != uid:
            raise HTTPException(status_code=400, detail="Username already exists")
        fields["username"] = payload.username

    # password（若有提供就更新 hashed_pw）
    if payload.password:
        fields["hashed_pw"] = hash_password(payload.password)

    # role（可單獨更新）
    if payload.role is not None:
        fields["role"] = payload.role

    # is_active（布林 → 0/1）
    if payload.is_active is not None:
        fields["is_active"] = int(bool(payload.is_active))

    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")

    row = update_user(db, uid, **fields)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)

# ③-1 可選：PATCH 與 PUT 一樣行為 -----------------------------------
@router.patch("/{uid}", response_model=UserOut, dependencies=[require_admin])
def patch_user(uid: int, payload: UserUpdate, db = Depends(get_db)):
    return edit_user(uid, payload, db)

# ④ 刪除使用者 -----------------------------------------------------
@router.delete(
    "/{uid}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_admin],
)
def remove_user(uid: int, db = Depends(get_db)):
    if not delete_user(db, uid):
        raise HTTPException(status_code=404, detail="User not found")
