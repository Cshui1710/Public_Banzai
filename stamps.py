# stamps.py — シングル画像（256x256）表示版：重複レコード抑止＋毎回モーダル(awarded=True)＋自動アップデート
from datetime import datetime
from math import radians, sin, cos, atan2
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, confloat
from sqlmodel import Session, select

from config import ARRIVAL_RADIUS_M
from models import engine, User, Stamp, Character, UserCharacter

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
def get_current_user(request: Request) -> User:
    from auth import get_current_user as _get
    user = _get(request)
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です")
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
    {"code": "marmot",  "name": "マーモット", "sprite": "/static/characters/marmot.png",  "w": 256, "h": 256},
    {"code": "tanuki",  "name": "タヌキ",     "sprite": "/static/characters/tanuki.png",  "w": 256, "h": 256},
    {"code": "kitsune", "name": "キツネ",     "sprite": "/static/characters/kitsune.png", "w": 256, "h": 256},
    {"code": "neko",    "name": "ネコ",       "sprite": "/static/characters/neko.png",    "w": 256, "h": 256},
    {"code": "inu",     "name": "イヌ",       "sprite": "/static/characters/inu.png",     "w": 256, "h": 256},
    {"code": "kappa",   "name": "カッパ",     "sprite": "/static/characters/kappa.png",   "w": 256, "h": 256},
    {"code": "tori",    "name": "トリ",       "sprite": "/static/characters/tori.png",    "w": 256, "h": 256},
    {"code": "usagi",   "name": "ウサギ",     "sprite": "/static/characters/usagi.png",   "w": 256, "h": 256},
    {"code": "kanazawa","name": "かなざわ君", "sprite": "/static/characters/kanazawa.png","w": 256, "h": 256},
    {"code": "nanao",   "name": "ななお君",   "sprite": "/static/characters/nanao.png",   "w": 256, "h": 256},
]

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

    # 1) 距離チェック
    dist = haversine_m(req.user_lat, req.user_lon, req.lat, req.lon)
    if dist > ARRIVAL_RADIUS_M:
        raise HTTPException(
            status_code=400,
            detail=f"チェックインできる距離にいません（現在 {int(dist)}m / 必要 {int(ARRIVAL_RADIUS_M)}m 以内）",
        )

    # 2) 30分クールダウン（UTC基準のローリング判定）
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
        remain_min = max(1, (remain_sec + 59) // 60)  # 表示用に切り上げ分
        return {
            "ok": True,
            "repeat": True,
            "message": f"直近{COOLDOWN_MINUTES}分以内にチェックイン済みです（残り 約{remain_min}分）",
            "distance_m": round(dist, 1),
            "cooldown_sec": remain_sec,
            "last_checked_at": last.checked_at.isoformat() + "Z",
            "next_available_at": (now_utc + timedelta(seconds=remain_sec)).isoformat() + "Z",
            # 毎回モーダル出すなら下2行は維持（演出的に出したくないなら False に）
            "awarded": True,
            "character": {
                "code": "marmot",
                "name": "マーモット",
                "sprite": "/static/characters/marmot.png",
                "frames": 1, "w": 512, "h": 512,
                "image": "/static/characters/marmot.png",
            },
        }

    # 3) 新規記録
    session.add(
        Stamp(
            user_id=user.id,
            place_id=req.place_id,
            place_name=req.place_name,
            kind=req.kind or "地点",
            lat=req.lat,
            lon=req.lon,
        )
    )
    session.commit()

    # 4) キャラ情報の自動生成／更新（シングル画像）
    DESIRED_IMAGE = "/static/characters/marmot.png"
    DESIRED_FRAMES = 1
    DESIRED_W = 256
    DESIRED_H = 256

    char = session.exec(select(Character).where(Character.code == "marmot")).first()
    if not char:
        char = Character(
            code="marmot",
            name="マーモット",
            sprite_path=DESIRED_IMAGE,
            frames=DESIRED_FRAMES,
            frame_w=DESIRED_W,
            frame_h=DESIRED_H,
        )
        session.add(char); session.commit(); session.refresh(char)
    else:
        changed = False
        if char.sprite_path != DESIRED_IMAGE:
            char.sprite_path = DESIRED_IMAGE; changed = True
        if char.frames != DESIRED_FRAMES or char.frame_w != DESIRED_W or char.frame_h != DESIRED_H:
            char.frames = DESIRED_FRAMES; char.frame_w = DESIRED_W; char.frame_h = DESIRED_H; changed = True
        if changed:
            session.add(char); session.commit(); session.refresh(char)

    # 5) ユーザーが未所持なら付与（重複登録はしない）
    owned = session.exec(
        select(UserCharacter).where(UserCharacter.user_id == user.id, UserCharacter.character_id == char.id)
    ).first()
    if not owned:
        session.add(UserCharacter(user_id=user.id, character_id=char.id))
        session.commit()

    # 6) モーダル演出は毎回行う
    return {
        "ok": True,
        "repeat": False,
        "message": "チェックイン完了",
        "distance_m": round(dist, 1),
        "awarded": True,
        "render": "single",
        "is_sprite": False,
        "character": {
            "code": char.code,
            "name": char.name,
            "sprite": char.sprite_path,
            "frames": char.frames,
            "w": char.frame_w,
            "h": char.frame_h,
            "image": char.sprite_path,
        },
    }
