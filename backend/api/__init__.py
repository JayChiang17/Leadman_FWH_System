# backend/api/__init__.py
"""
集中所有 REST router；WebSocket router 獨立不走 /api
"""
from fastapi import APIRouter

# ── REST routers ─────────────────────────────────────
from .auth                import router as auth_router
from .users               import router as users_router
from .model_inventory     import router as model_router
from .assembly_inventory  import router as assembly_router
from .downtime            import router as downtime_router
from .qc_check            import router as qc_router
from .search              import router as search_router
from .module_equipment    import router as equipment_router
from .risk_router         import router as risk_router
from .ai_routes           import router as ai_router
from .production_charts   import router as charts_router
from .pcba                import router as pcba_router      # ★ NEW - PCBA Tracking

# ── WebSocket router（獨立）────────────────────────────
from .ws_router           import router as ws_router

api_router = APIRouter(prefix="/api")

# ---- REST (JWT + RBAC) ----
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(model_router)
api_router.include_router(assembly_router)
api_router.include_router(downtime_router)
api_router.include_router(qc_router)
api_router.include_router(search_router)
api_router.include_router(equipment_router)
api_router.include_router(risk_router)
api_router.include_router(ai_router)
api_router.include_router(charts_router)
api_router.include_router(pcba_router)              # ★ NEW – PCBA Production Tracking

# ---- WebSocket ----
# ws_router is still included directly in main.py without the /api prefix