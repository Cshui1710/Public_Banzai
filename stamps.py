# stamps.py — シングル画像（256x256）表示版：重複レコード抑止＋毎回モーダル(awarded=True)＋自動アップデート
from datetime import datetime
from math import radians, sin, cos, atan2
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, confloat
from sqlmodel import Session, select

from config import ARRIVAL_RADIUS_M
from models import engine, User, Stamp, Character, UserCharacter
import random
from auth import get_current_user as _auth_get_current_user, login_required

router = APIRouter(prefix="/api", tags=["stamps"])


# ---------------------------
# DB セッション
# ---------------------------
def get_session():
    with Session(engine) as s:
        yield s


# ---------------------------
# 認証
# ---------------------------

def get_current_user(request: Request):
    """
    auth.py の get_current_user + login_required をそのまま使う。
    ゲストログインもチェックインOKにしたいので allow_guest=True。
    """
    user = _auth_get_current_user(request)
    # ここで「未ログイン」なら HTTPException(401) が飛ぶ
    login_required(user, allow_guest=True)
    return user

# ---------------------------
# 距離（メートル）
# ---------------------------
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    c = 2 * atan2(a ** 0.5, (1 - a) ** 0.5)
    return R * c


# ---------------------------
# 入力モデル
# ---------------------------
Lat = confloat(ge=-90.0, le=90.0)
Lon = confloat(ge=-180.0, le=180.0)


class CheckinIn(BaseModel):
    place_id: str
    place_name: str
    kind: Optional[str] = "地点"
    lat: Lat              # 施設の緯度
    lon: Lon              # 施設の経度
    user_lat: Lat         # 現在地の緯度
    user_lon: Lon         # 現在地の経度


# ---------------------------
# チェックイン（シングル画像返却）
# ---------------------------
# ---------------------------
# チェックイン（シングル画像返却 / 30分クールダウン）
# ---------------------------
from datetime import datetime, timedelta  # 先頭の import 群にありますが念のため

COOLDOWN_MINUTES = 30

# ===== 図鑑カタログ（10種類） =====
CHAR_CATALOG = [
    {"code": "marmot",  "name": "マーモット", "sprite": "/static/stamp/marmot.png",  "w": 256, "h": 256},
    {"code": "tanuki",  "name": "タヌキ",     "sprite": "/static/stamp/tanuki.png",  "w": 256, "h": 256},
    {"code": "kitsune", "name": "キツネ",     "sprite": "/static/stamp/kitsune.png", "w": 256, "h": 256},
    {"code": "odoroki",    "name": "驚き",       "sprite": "/static/stamp/1.png",    "w": 256, "h": 256},
    {"code": "naki",     "name": "泣き泣き",       "sprite": "/static/stamp/2.png",     "w": 256, "h": 256},
    {"code": "sakibi",   "name": "叫び",     "sprite": "/static/stamp/3.png",   "w": 256, "h": 256},
    {"code": "yorosiki",   "name": "よろしく",     "sprite": "/static/stamp/4.png",   "w": 256, "h": 256},
    {"code": "banzai",   "name": "バンザイ",     "sprite": "/static/stamp/banzai.png",   "w": 256, "h": 256},
]
from sqlmodel import Session, select, delete

REMOVE_CODES = ["inu", "neko","kappa","tori","usagi","kanazawa","nanao"]

with Session(engine) as s:
    s.exec(delete(Character).where(Character.code.in_(REMOVE_CODES)))
    s.commit()
    
ALLOWED_CHAR_CODES = {c["code"] for c in CHAR_CATALOG}

from sqlmodel import select
from models import Character

# ===== 安全版ユーティリティ =====
def safe_seed_character(session: Session, code: str, name: str, sprite: str, w: int = 256, h: int = 256):
    ch = session.exec(select(Character).where(Character.code == code)).first()
    if not ch:
        # モデルに無いフィールドがあっても落ちないように setattr をガード
        ch = Character(code=code, name=name)
        if hasattr(ch, "sprite_path"): ch.sprite_path = sprite
        if hasattr(ch, "frames"):      ch.frames = 1
        if hasattr(ch, "frame_w"):     ch.frame_w = w
        if hasattr(ch, "frame_h"):     ch.frame_h = h
        session.add(ch)
        session.commit()
        session.refresh(ch)
        return ch

    # 既存の差分更新（あれば）
    changed = False
    if hasattr(ch, "name") and ch.name != name:
        ch.name = name; changed = True
    if hasattr(ch, "sprite_path") and ch.sprite_path != sprite:
        ch.sprite_path = sprite; changed = True
    if hasattr(ch, "frames") and getattr(ch, "frames", 1) != 1:
        ch.frames = 1; changed = True
    if hasattr(ch, "frame_w") and getattr(ch, "frame_w", w) != w:
        ch.frame_w = w; changed = True
    if hasattr(ch, "frame_h") and getattr(ch, "frame_h", h) != h:
        ch.frame_h = h; changed = True
    if changed:
        session.add(ch); session.commit(); session.refresh(ch)
    return ch

def ensure_char_catalog_safe(session: Session):
    changed = False
    for it in CHAR_CATALOG:
        ch_before = session.exec(select(Character).where(Character.code == it["code"])).first()
        ch_after = safe_seed_character(session, it["code"], it["name"], it["sprite"], it.get("w",256), it.get("h",256))
        if ch_before is None or (ch_after and ch_before != ch_after):
            changed = True
    if changed:
        session.commit()

def ensure_min_stamps_for_user(session: Session, user_id: int, min_count: int = 5):
    """
    ユーザーが最低 min_count 個のスタンプを持つようにする。
    足りないぶんはランダムに付与（重複は避ける）。
    """
    current = session.exec(
        select(UserCharacter).where(UserCharacter.user_id == user_id)
    ).all()
    if len(current) >= min_count:
        return

    all_chars = session.exec(
        select(Character).where(Character.code.in_(ALLOWED_CHAR_CODES))
    ).all()
    if not all_chars:
        return

    owned_ids = {uc.character_id for uc in current}
    candidates = [c for c in all_chars if c.id not in owned_ids]

    need = min_count - len(current)
    pool = candidates if len(candidates) >= need else all_chars
    if not pool:
        return

    chosen = random.sample(pool, k=min(need, len(pool)))
    for ch in chosen:
        session.add(UserCharacter(user_id=user_id, character_id=ch.id))
    session.commit()


# ===== ここを差し替え：全キャラ + 所持フラグ（必ず何か返す） =====
@router.get("/characters")
def list_all_characters(request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request)

    # 1) まず安全にシード（モデルに無いフィールドがあっても落とさない）
    try:
        ensure_char_catalog_safe(session)
    except Exception as e:
        # ログだけ出して後続へ（フォールバックで返す）
        print("[characters] seed error:", repr(e))

    # 2) 所持IDセットを安全に作る
    owned_ids = set()
    try:
        owned_rows = session.exec(
            select(UserCharacter.character_id).where(UserCharacter.user_id == user.id)
        ).all()
        # SQLAlchemy の行オブジェクト/タプルを両対応
        for row in owned_rows:
            owned_ids.add(row[0] if isinstance(row, (list, tuple)) else row)
    except Exception as e:
        print("[characters] owned query error:", repr(e))

    # 3) DB からキャラ一覧を安全に取る。失敗したらカタログの静的情報で返す
    items = []
    try:
        all_chars = session.exec(select(Character)).all()
        if not all_chars:
            raise RuntimeError("no characters in DB")

        for ch in all_chars:
            sprite = getattr(ch, "sprite_path", "/static/characters/placeholder.png")
            frames = getattr(ch, "frames", 1)
            w = getattr(ch, "frame_w", 256)
            h = getattr(ch, "frame_h", 256)
            owned = getattr(ch, "id", None) in owned_ids if getattr(ch, "id", None) is not None else False

            items.append({
                "code": getattr(ch, "code", "unknown"),
                "name": getattr(ch, "name", "キャラクター"),
                "image": sprite,
                "frames": frames,
                "w": w,
                "h": h,
                "owned": owned
            })
    except Exception as e:
        print("[characters] list query error, fallback to catalog:", repr(e))
        # フォールバック：カタログをそのまま返す（未所持扱い）
        for it in CHAR_CATALOG:
            items.append({
                "code": it["code"], "name": it["name"],
                "image": it["sprite"], "frames": 1,
                "w": it.get("w",256), "h": it.get("h",256),
                "owned": False
            })

    # 4) スタンプ数も安全に
    try:
        stamp_count = len(session.exec(select(Stamp).where(Stamp.user_id == user.id)).all())
    except Exception as e:
        print("[characters] stamps query error:", repr(e))
        stamp_count = 0

    return {"ok": True, "count": len(items), "stamp_count": stamp_count, "items": items}



from models import UserCharacter, Stamp


@router.post("/checkin")
def checkin(req: CheckinIn, request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request)
    print(user)
    # 0) スタンプカタログを安全にDBへシード
    try:
        ensure_char_catalog_safe(session)
    except Exception as e:
        print("[checkin] seed error:", repr(e))

    # 0.5) ユーザーに最低5個のスタンプを持たせておく
    try:
        ensure_min_stamps_for_user(session, user.id, min_count=5)
    except Exception as e:
        print("[checkin] ensure_min_stamps_for_user error:", repr(e))

    # 1) 距離チェック
    dist = haversine_m(req.user_lat, req.user_lon, req.lat, req.lon)
    if dist > ARRIVAL_RADIUS_M:
        raise HTTPException(
            status_code=400,
            detail=f"チェックインできる距離にいません（現在 {int(dist)}m / 必要 {int(ARRIVAL_RADIUS_M)}m 以内）",
        )

    # 2) 30分クールダウン
    now_utc = datetime.utcnow()
    cutoff = now_utc - timedelta(minutes=COOLDOWN_MINUTES)

    last = session.exec(
        select(Stamp)
        .where(
            Stamp.user_id == user.id,
            Stamp.place_id == req.place_id,
            Stamp.checked_at >= cutoff,
        )
        .order_by(Stamp.checked_at.desc())
    ).first()

    if last:
        elapsed_sec = int((now_utc - last.checked_at).total_seconds())
        remain_sec = COOLDOWN_MINUTES * 60 - max(elapsed_sec, 0)
        remain_min = max(1, (remain_sec + 59) // 60)
        return {
            "ok": True,
            "repeat": True,
            "message": f"直近{COOLDOWN_MINUTES}分以内にチェックイン済みです（残り 約{remain_min}分）",
            "distance_m": round(dist, 1),
            "cooldown_sec": remain_sec,
            "last_checked_at": last.checked_at.isoformat() + "Z",
            "next_available_at": (now_utc + timedelta(seconds=remain_sec)).isoformat() + "Z",
            # クールダウン中はスタンプ付与なし
            "awarded": False,
        }

    # 3) チェックイン履歴レコードを追加
    stamp_row = Stamp(
        user_id=user.id,
        place_id=req.place_id,
        place_name=req.place_name,
        kind=req.kind or "地点",
        lat=req.lat,
        lon=req.lon,
    )
    session.add(stamp_row)
    session.commit()
    session.refresh(stamp_row)

    # 4) ランダムにスタンプ（Characterレコード）を1つ選び、必要なら付与
    all_chars = session.exec(
        select(Character).where(Character.code.in_(ALLOWED_CHAR_CODES))
    ).all()

    award_char = None
    is_new = False


    if all_chars:
        # 既に持っているもの
        user_chars = session.exec(
            select(UserCharacter).where(UserCharacter.user_id == user.id)
        ).all()
        owned_ids = {uc.character_id for uc in user_chars}

        # まだ持っていないスタンプを優先
        not_owned = [c for c in all_chars if c.id not in owned_ids]
        pool = not_owned if not_owned else all_chars

        award_char = random.choice(pool)
        if award_char.id not in owned_ids:
            session.add(UserCharacter(user_id=user.id, character_id=award_char.id))
            session.commit()
            is_new = True

    # 5) レスポンス（JSは js.awarded && js.character でモーダル表示）
    resp = {
        "ok": True,
        "repeat": False,
        "message": "チェックイン完了",
        "distance_m": round(dist, 1),
        "awarded": bool(award_char),
    }

    if award_char:
        sprite = getattr(award_char, "sprite_path", "/static/stamp/default.png")
        resp["character"] = {  # JS 側のキー名はそのまま character を使う
            "code": award_char.code,
            "name": award_char.name,   # → スタンプ名
            "sprite": sprite,
            "image": sprite,
            "frames": getattr(award_char, "frames", 1),
            "w": getattr(award_char, "frame_w", 256),
            "h": getattr(award_char, "frame_h", 256),
            "is_new": is_new,          # 新規取得かどうか（使いたければフロントで）
        }

    return resp
