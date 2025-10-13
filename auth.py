import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlmodel import Session, select
from authlib.integrations.starlette_client import OAuth

from config import (
    JWT_SECRET, JWT_ALG, JWT_EXPIRE_MIN, AUTH_COOKIE, MIN_PW, MAX_PW,
    BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, LINE_CLIENT_ID, LINE_CLIENT_SECRET
)
from models import User, OAuthAccount, engine

router = APIRouter()

pwd_ctx = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

def hash_pw(p: str) -> str:
    return pwd_ctx.hash(p)

def verify_pw(p: str, ph: str) -> bool:
    return pwd_ctx.verify(p, ph)

def create_token(data: dict) -> str:
    exp = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MIN)
    payload = {**data, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def read_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])

def get_current_user(request: Request) -> Optional[User]:
    token = request.cookies.get(AUTH_COOKIE)
    if not token:
        return None
    try:
        payload = read_token(token)
        uid = int(payload.get("uid", 0))
        with Session(engine) as s:
            return s.get(User, uid)
    except JWTError:
        return None

def login_required(user: Optional[User]):
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です")

def set_login_cookie(user_id: int) -> JSONResponse:
    token_jwt = create_token({"uid": user_id})
    res = JSONResponse({"ok": True, "msg": "ログイン成功"})
    res.set_cookie(AUTH_COOKIE, token_jwt, httponly=True, samesite="lax", secure=False, max_age=60*60*24*30)
    return res

# ===== Password auth =====
class RegisterForm(BaseModel):
    email: str
    password: str

class LoginForm(BaseModel):
    email: str
    password: str

@router.post("/auth/register")
def register(form: RegisterForm):
    with Session(engine) as s:
        if not (MIN_PW <= len(form.password) <= MAX_PW):
            raise HTTPException(400, f"パスワードは{MIN_PW}〜{MAX_PW}文字で入力してください")
        if s.exec(select(User).where(User.email == form.email)).first():
            raise HTTPException(400, "このメールは登録済みです")
        u = User(email=form.email, password_hash=hash_pw(form.password))
        s.add(u); s.commit(); s.refresh(u)
        return {"ok": True, "msg": "登録完了"}

@router.post("/auth/login")
def login(form: LoginForm):
    with Session(engine) as s:
        u = s.exec(select(User).where(User.email == form.email)).first()
        if not u or not verify_pw(form.password, u.password_hash):
            raise HTTPException(401, "メールまたはパスワードが違います")
        return set_login_cookie(u.id)

@router.post("/auth/logout")
def logout():
    res = JSONResponse({"ok": True, "msg": "ログアウトしました"})
    res.delete_cookie(AUTH_COOKIE)
    return res

@router.get("/me")
def me(request: Request):
    u = get_current_user(request)
    if not u:
        return {"authenticated": False}
    return {"authenticated": True, "email": u.email, "created_at": u.created_at.isoformat()}

# ===== OAuth =====
oauth = OAuth()
oauth.register(
    name="google",
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    client_kwargs={"scope": "openid email profile"},
)
oauth.register(
    name="line",
    server_metadata_url="https://access.line.me/.well-known/openid-configuration",
    client_id=LINE_CLIENT_ID,
    client_secret=LINE_CLIENT_SECRET,
    client_kwargs={"scope": "openid email profile"},
)

def _get_or_create_user_for_oidc(provider: str, sub: str, email: str) -> int:
    email = (email or "").strip().lower()
    if not sub:
        raise HTTPException(400, f"{provider}: sub が空です")
    with Session(engine) as s:
        link = s.exec(
            select(OAuthAccount).where(
                (OAuthAccount.provider == provider) & (OAuthAccount.subject == sub)
            )
        ).first()
        if link:
            return link.user_id

        u = None
        if email:
            u = s.exec(select(User).where(User.email == email)).first()
        if not u:
            dummy_pw = hash_pw(os.urandom(16).hex())
            u = User(email=email or f"{provider}:{sub}", password_hash=dummy_pw)
            s.add(u); s.commit(); s.refresh(u)

        link = OAuthAccount(provider=provider, subject=sub, user_id=u.id)
        s.add(link); s.commit(); s.refresh(link)
        return u.id

@router.get("/auth/google/login")
async def google_login(request: Request):
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(500, "Google OAuth の環境変数が未設定です")
    redirect_uri = f"{BASE_URL}/auth/google/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)

@router.get("/auth/google/callback")
async def google_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as e:
        raise HTTPException(400, f"Google認証エラー: {e}")
    userinfo = token.get("userinfo") or await oauth.google.parse_id_token(request, token)
    email = str(userinfo.get("email") or "").strip().lower()
    sub = str(userinfo.get("sub") or "").strip()
    user_id = _get_or_create_user_for_oidc("google", sub, email)
    resp = RedirectResponse(url="/")
    resp.set_cookie(AUTH_COOKIE, create_token({"uid": user_id}), httponly=True, samesite="lax", secure=False, max_age=60*60*24*30)
    return resp

@router.get("/auth/line/login")
async def line_login(request: Request):
    if not LINE_CLIENT_ID or not LINE_CLIENT_SECRET:
        raise HTTPException(500, "LINE OAuth の環境変数が未設定です")
    redirect_uri = f"{BASE_URL}/auth/line/callback"
    return await oauth.line.authorize_redirect(request, redirect_uri)

@router.get("/auth/line/callback")
async def line_callback(request: Request):
    try:
        token = await oauth.line.authorize_access_token(request)
    except Exception as e:
        raise HTTPException(400, f"LINE認証エラー: {e}")
    userinfo = token.get("userinfo") or await oauth.line.parse_id_token(request, token)
    email = str(userinfo.get("email") or "").strip().lower()  # email未取得の可能性あり
    sub = str(userinfo.get("sub") or "").strip()
    if not sub:
        raise HTTPException(400, "LINE: sub が取得できませんでした")
    user_id = _get_or_create_user_for_oidc("line", sub, email)
    resp = RedirectResponse(url="/")
    resp.set_cookie(AUTH_COOKIE, create_token({"uid": user_id}), httponly=True, samesite="lax", secure=False, max_age=60*60*24*30)
    return resp
