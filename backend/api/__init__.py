# backend/api/__init__.py
"""
集中所有 REST router；WebSocket router 獨立不走 /api
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

# ── REST routers ─────────────────────────────────────
from .auth                import router as auth_router
from .users               import router as users_router
from .model_inventory     import router as model_router
from .assembly_inventory  import router as assembly_router
from .downtime            import router as downtime_router
from .qc_check            import router as qc_router
from .search              import router as search_router
from .risk_router         import router as risk_router
from .ai_routes           import router as ai_router
from .production_charts   import router as charts_router
from .pcba                import router as pcba_router      # ★ NEW - PCBA Tracking
from .email_settings      import router as email_settings_router  # ★ NEW - Email Settings
from .ate_testing         import router as ate_router            # ★ NEW - ATE Testing NG Management
from .monitor             import router as monitor_router        # ★ NEW - System Monitor
from .wip                 import router as wip_router             # ★ NEW - WIP Tracking
from .ml                  import router as ml_router              # ★ NEW - ML predictions & clusters

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
api_router.include_router(risk_router)
api_router.include_router(ai_router)
api_router.include_router(charts_router)
api_router.include_router(pcba_router)              # ★ NEW – PCBA Production Tracking
api_router.include_router(email_settings_router)    # ★ NEW – Email Settings (Admin Only)
api_router.include_router(ate_router)               # ★ NEW – ATE Testing NG Management
api_router.include_router(monitor_router)           # ★ NEW – System Monitor (Admin Only)
api_router.include_router(wip_router)               # ★ NEW – WIP Tracking
api_router.include_router(ml_router)                # ★ NEW – ML predictions & clusters

# ---- Health Check (無需認證，供前端 proxy warmup 使用) ----
@api_router.get("/health", tags=["System"])
async def health_check():
    """Simple health check endpoint for proxy warmup and monitoring."""
    return JSONResponse(content={"status": "ok"}, status_code=200)

# ---- WebSocket ----
# ws_router is still included directly in main.py without the /api prefix