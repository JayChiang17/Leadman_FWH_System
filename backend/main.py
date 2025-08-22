# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import api_router
from api.ws_router import router as ws_router

app = FastAPI(title="Leadman FWH Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(api_router)

# WebSocket 路由直接挂载
app.include_router(ws_router)

