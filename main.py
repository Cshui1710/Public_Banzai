from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from config import SESSION_SECRET, UPLOAD_DIR, BASE_URL, ARRIVAL_RADIUS_M
from starlette.middleware.sessions import SessionMiddleware

from models import on_startup  # ensure tables
from auth import router as auth_router
from data_csv import router as data_router
from media import router as media_router
import os
# main.py に追記
from stamps import router as stamps_router
from analytics import router as analytics_router
from comments import router as comments_router


app = FastAPI(title="Ishikawa Facilities & Parks")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, same_site="lax", https_only=False)

# Mount static & uploads
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
templates = Jinja2Templates(directory="templates")

@app.on_event("startup")
def _startup():
    on_startup()

# Index
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    from auth import get_current_user
    user = get_current_user(request)
    return templates.TemplateResponse("index.html", {
        "request": request,
        "user": user,
        "radius_m": ARRIVAL_RADIUS_M
    })

# Health
@app.get("/health")
def health():
    return {"ok": True}

# Debug (safe)
@app.get("/_debug/oauth")
def _debug_oauth():
    from config import (
        GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
        LINE_CLIENT_ID, LINE_CLIENT_SECRET,
        LOCAL_CSV_PATH, NAGANO_FAC_CSV, NAGANO_PARK_CSV
    )
    return {
        "google_id_set": bool(GOOGLE_CLIENT_ID),
        "google_secret_set": bool(GOOGLE_CLIENT_SECRET),
        "line_id_set": bool(LINE_CLIENT_ID),
        "line_secret_set": bool(LINE_CLIENT_SECRET),
        "base_url": BASE_URL,
        "csv_exists": os.path.exists(LOCAL_CSV_PATH),
        "nagano_fac_exists": os.path.exists(NAGANO_FAC_CSV),
        "nagano_park_exists": os.path.exists(NAGANO_PARK_CSV),
    }

# Simple pages
@app.get("/privacy", response_class=HTMLResponse)
def privacy(_request: Request):
    return HTMLResponse("<h1>プライバシーポリシー</h1><p>本アプリはログイン目的でメール/プロフィールを利用します。</p>")

@app.get("/terms", response_class=HTMLResponse)
def terms(_request: Request):
    return HTMLResponse("<h1>利用規約</h1><p>本サービスは予告なく変更/停止する場合があります。</p>")

# Routers
app.include_router(auth_router)
app.include_router(data_router)
app.include_router(media_router)
app.include_router(stamps_router)
app.include_router(analytics_router)
app.include_router(comments_router)