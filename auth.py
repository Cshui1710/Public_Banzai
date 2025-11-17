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
import secrets
from fastapi.templating import Jinja2Templates

from config import (
    JWT_SECRET, JWT_ALG, JWT_EXPIRE_MIN, AUTH_COOKIE, MIN_PW, MAX_PW,
    BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, LINE_CLIENT_ID, LINE_CLIENT_SECRET
)
from models import User, OAuthAccount, engine, Character, UserCharacter

router = APIRouter()

templates = Jinja2Templates(directory="templates")

pwd_ctx = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ★ 最初から所持していてほしいキャラクターコード
#   ※ Character.code に合わせてください（"kitune" ならそこに合わせる）
DEFAULT_CHAR_CODES = ["marmot", "tanuki", "kitsune"]  # ←必要なら "kitune" に修正

def _ensure_default_characters_for_user(user_id: int):
    """
    ログイン中のユーザーに、デフォルトキャラクター
    (marmot / tanuki / kitsune) を「所持済み」として付与する。
    すでに付与済みなら何もしない。
    """
    if not user_id or user_id <= 0:
        return

    with Session(engine) as s:
        # コードが DEFAULT_CHAR_CODES のキャラクターを取得
        chars = s.exec(
            select(Character).where(Character.code.in_(DEFAULT_CHAR_CODES))
        ).all()
        if not chars:
            # まだ Character テーブルにレコードが無い場合は何もしない
            return

        # すでに所持しているキャラIDを取得
        existing = {
            uc.character_id
            for uc in s.exec(
                select(UserCharacter).where(UserCharacter.user_id == user_id)
            )
        }

        # 足りないものだけ追加
        added = False
        for ch in chars:
            if ch.id not in existing:
                s.add(UserCharacter(user_id=user_id, character_id=ch.id))
                added = True

        if added:
            s.commit()


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



def set_login_cookie(user_id: int) -> JSONResponse:
    token_jwt = create_token({"uid": user_id})
    res = JSONResponse({"ok": True, "msg": "ログイン成功"})
    res.set_cookie(AUTH_COOKIE, token_jwt, httponly=True, samesite="lax", secure=False, max_age=60*60*24*30)
    return res

def _login_redirect(user_id: int, to="/home"):
    resp = RedirectResponse(url=to, status_code=303)
    resp.set_cookie(
        AUTH_COOKIE,
        create_token({"uid": user_id}),
        httponly=True,
        samesite="lax",
        secure=False,          # 本番 https なら True に
        max_age=60*60*24*30,
        path="/",
    )
    return resp

def _logout_response():
    resp = RedirectResponse(url="/auth/login", status_code=303)
    resp.delete_cookie(AUTH_COOKIE, httponly=True, samesite="lax", secure=False, path="/")
    return resp

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

@router.get("/auth/login")
def login_page(request: Request):
    # 既にログイン済みなら /home へ
    token = request.cookies.get(AUTH_COOKIE)
    if token:
        try:
            payload = read_token(token)
            if int(payload.get("uid", 0)) > 0:
                return RedirectResponse(url="/home", status_code=303)
        except Exception:
            pass
    from main import templates
    return templates.TemplateResponse("login.html", {"request": request})

from fastapi import Body, Form, Request
from urllib.parse import parse_qs
@router.post("/auth/login")
async def login(
    request: Request,
    email: Optional[str] = Form(None),
    password: Optional[str] = Form(None),
    json: Optional[dict] = Body(None),
):
    # 1) JSONで来た場合
    if (email is None or password is None) and json:
        email = json.get("email")
        password = json.get("password")

    # 2) ヘッダが微妙でも raw body を form として読む
    if email is None or password is None:
        raw = (await request.body() or b"").decode("utf-8", errors="ignore")
        if raw:
            q = parse_qs(raw)
            email = email or (q.get("email",[None])[0])
            password = password or (q.get("password",[None])[0])

    # 最終チェック
    if not email or not password:
        raise HTTPException(422, "email/password を指定してください")

    with Session(engine) as s:
        u = s.exec(select(User).where(User.email == email)).first()
        if not u or not verify_pw(password, u.password_hash):
            raise HTTPException(401, "メールまたはパスワードが違います")

        # ★ ここでリダイレクト先を決める
        target = "/home"
        if not getattr(u, "display_name", None):
            target = "/name"

    print("[DEBUG] CT:", request.headers.get("content-type"))
    print("[DEBUG] email:", repr(email), "password_len:", len(password) if password else None)

    return _login_redirect(u.id, to=target)


SESSION_KEYS_TO_CLEAR = [
    # 既存実装で使っているキーをここに列挙
    "user", "user_id", "email", "access_token", "refresh_token",
    # ゲスト関連
    "guest_id", "guest_created_at",
]

def _clear_session(req: Request):
    # 指定キーを安全に削除
    for k in SESSION_KEYS_TO_CLEAR:
        if k in req.session:
            try:
                del req.session[k]
            except Exception:
                req.session.pop(k, None)

@router.post("/auth/logout")
def logout_post(request: Request):
    _clear_session(request)  # あなたの既存ヘルパ
    return _logout_response()

@router.get("/auth/logout")
def logout_get(request: Request):
    _clear_session(request)  # あなたの既存ヘルパ
    return _logout_response()


@router.get("/me")
def whoami(request: Request):
    u = get_current_user(request)
    if not u:
        return JSONResponse({}, status_code=200)
    return {
        "id": getattr(u, "id", None),
        "email": getattr(u, "email", None),
        "is_guest": bool(getattr(u, "is_guest", False)),
        "display_name": getattr(u, "display_name", None),
    }


@router.get("/name")
def name_page(request: Request):
    u = get_current_user(request)
    login_required(u, allow_guest=False)  # ゲストはNG（本登録ユーザーのみ）
    return templates.TemplateResponse(
        "name.html",
        {
            "request": request,
            "user": u,
            "message": "",
        },
    )

@router.post("/name")
def name_update(
    request: Request,
    display_name: str = Form(...),
):
    u = get_current_user(request)
    login_required(u, allow_guest=False)

    dn = (display_name or "").strip()
    if not (1 <= len(dn) <= 20):
        # エラー時はページ再表示
        return templates.TemplateResponse(
            "name.html",
            {
                "request": request,
                "user": u,
                "message": "名前は1〜20文字で入力してください。",
            },
        )

    from models import User
    with Session(engine) as s:
        dbu = s.get(User, u.id)
        if not dbu:
            raise HTTPException(404, "ユーザーが見つかりません")
        dbu.display_name = dn
        s.add(dbu)
        s.commit()

    # 変更後、/home に戻る
    return RedirectResponse(url="/home", status_code=303)


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

    # ★ display_name の有無で行き先を決定
    from models import User
    with Session(engine) as s:
        u = s.get(User, user_id)
        target = "/home"
        if not u or not getattr(u, "display_name", None):
            target = "/name"

    resp = RedirectResponse(url=target, status_code=303)
    resp.set_cookie(
        AUTH_COOKIE,
        create_token({"uid": user_id}),
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60*60*24*30,
    )
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
    email = str(userinfo.get("email") or "").strip().lower()
    sub = str(userinfo.get("sub") or "").strip()
    if not sub:
        raise HTTPException(400, "LINE: sub が取得できませんでした")
    user_id = _get_or_create_user_for_oidc("line", sub, email)

    # ★ display_name の有無で行き先を決定
    from models import User
    with Session(engine) as s:
        u = s.get(User, user_id)
        target = "/home"
        if not u or not getattr(u, "display_name", None):
            target = "/name"

    resp = RedirectResponse(url=target, status_code=303)
    resp.set_cookie(
        AUTH_COOKIE,
        create_token({"uid": user_id}),
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60*60*24*30,
    )
    return resp



# --- auth.py の 該当箇所 置き換え ---

from starlette.requests import Request
from starlette.responses import JSONResponse
from fastapi import HTTPException
import secrets
from datetime import datetime

GUEST_PREFIX = "guest_"

class _SimpleUser:
    def __init__(self, id, email, is_guest=False, display_name=None):
        self.id = id
        self.email = email
        self.is_guest = is_guest
        self.display_name = display_name
        
def _mk_guest_user(req: Request):
    """
    セッションにゲストIDを発行し、擬似ユーザー情報を dict で返す。
    """
    g = req.session.get("guest_id")
    if not g:
        g = GUEST_PREFIX + secrets.token_hex(4)  # 8桁
        req.session["guest_id"] = g
        req.session["guest_created_at"] = datetime.utcnow().isoformat()
    # id は負数の安定値に（DBと衝突しないように）
    gid = -abs(hash(g)) % (10**9)
    pseudo_email = f"{g}@example.local"
    pseudo_name  = f"ゲスト{str(gid)[-4:]}"
    return {"id": gid, "email": f"{g}@example.local", "is_guest": True}

@router.post("/auth/guest")
def guest_login(request: Request):
    guest = _mk_guest_user(request)
    return JSONResponse({"ok": True, **guest})

def _normalize_user(u) -> _SimpleUser | None:
    if u is None or u is ...:
        return None
    # dict
    if isinstance(u, dict):
        uid = u.get("id")
        if uid is None:
            return None
        return _SimpleUser(
            id=uid,
            email=u.get("email"),
            is_guest=bool(u.get("is_guest")),
            display_name=u.get("display_name"),
        )
    # SQLModel 等
    uid = getattr(u, "id", None)
    if uid is None:
        return None
    email = getattr(u, "email", None)
    is_guest = bool(getattr(u, "is_guest", False))
    display_name = getattr(u, "display_name", None)
    return _SimpleUser(uid, email, is_guest, display_name)

# まず、後半にある get_current_user / _normalize_user など
# 「セッションだけを見る版」の重複定義は削除してください。
# （_SimpleUser と _mk_guest_user はこのまま使います）

def get_current_user(request: Request) -> Optional[_SimpleUser]:
    # 1) JWT cookie
    token = request.cookies.get(AUTH_COOKIE)
    if token:
        try:
            payload = read_token(token)
            uid = int(payload.get("uid", 0))
            if uid > 0:
                with Session(engine) as s:
                    u = s.get(User, uid)
                    if u:
                        # ★ ログインしている本ユーザーにデフォルトキャラを付与
                        _ensure_default_characters_for_user(u.id)
                        return _SimpleUser(
                            id=u.id,
                            email=u.email,
                            is_guest=False,
                            display_name=getattr(u, "display_name", None),
                        )
        except JWTError:
            pass

    # 2) guest session
    if request.session.get("guest_id"):
        gdict = _mk_guest_user(request)
        return _normalize_user(gdict)

    # 3) 未ログイン
    return None



def login_required(u, *, allow_guest: bool = True):
    """
    認可ヘルパ：
      - allow_guest=True ならゲストも通す（クイズ用）
      - allow_guest=False にすれば本ログインのみ許可（写真投稿など）
    """
    if u is None:
        raise HTTPException(status_code=401, detail="ログインが必要です")
    if getattr(u, "is_guest", False) and not allow_guest:
        raise HTTPException(status_code=401, detail="ゲストは許可されていません")
    return True
