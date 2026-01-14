# main.py
import sys
import io
import os

# Fix UTF-8 encoding for console output (支持 emoji 和中文)
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Load environment variables BEFORE importing any modules that need them
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import api_router
from api.ws_router import router as ws_router
from core.scheduler import start_scheduler, stop_scheduler

app = FastAPI(title="Leadman FWH Backend")

# CORS 配置：從環境變量讀取允許的來源，預設為開發環境的前端地址
# 生產環境應在 .env 中設置 CORS_ORIGINS=https://your-domain.com
CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "https://192.168.10.100:3000,http://192.168.10.100:3000,http://localhost:3000")
ALLOWED_ORIGINS = [origin.strip() for origin in CORS_ORIGINS_ENV.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(api_router)

# WebSocket 路由直接挂载
app.include_router(ws_router)


# 应用启动时启动调度器
@app.on_event("startup")
async def startup_event():
    """应用启动时的初始化操作"""
    print("\n" + "=" * 70)
    print("🚀 应用启动中...")
    print("=" * 70)

    # 启动邮件报告调度器
    try:
        start_scheduler()
    except Exception as e:
        print(f"⚠️  调度器启动失败: {e}")
        print("   应用将继续运行，但定时邮件功能不可用")

    print("=" * 70)
    print("✅ 应用启动完成")
    print("=" * 70 + "\n")


# 应用关闭时停止调度器
@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时的清理操作"""
    print("\n" + "=" * 70)
    print("⏹️  应用关闭中...")
    print("=" * 70)

    # 停止调度器
    try:
        stop_scheduler()
    except Exception as e:
        print(f"⚠️  调度器停止失败: {e}")

    print("=" * 70)
    print("✅ 应用已关闭")
    print("=" * 70 + "\n")

