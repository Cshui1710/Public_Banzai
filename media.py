import os, uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from config import UPLOAD_DIR, ARRIVAL_RADIUS_M
from models import engine, Photo, Stamp
from auth import get_current_user, login_required

router = APIRouter()

# ===== Utilities =====
def haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6371000.0
    import math as m
    phi1, phi2 = m.radians(lat1), m.radians(lat2)
    dphi = m.radians(lat2 - lat1); dl = m.radians(lon2 - lon1)
    a = m.sin(dphi/2)**2 + m.cos(phi1)*m.cos(phi2)*m.sin(dl/2)**2
    return 2*R*m.asin(m.sqrt(a))

# ===== Stamps =====
@router.get("/api/stamps")
def api_stamps(request: Request):
    user = get_current_user(request)
    login_required(user)
    with Session(engine) as s:
        rows = s.exec(select(Stamp).where(Stamp.user_id == user.id)).all()
    return {"count": len(rows)}

# ===== Photos =====
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_BYTES = 8 * 1024 * 1024  # 8MB

@router.get("/api/photos")
def list_photos(place_id: str = Query(..., min_length=1)):
    with Session(engine) as s:
        rows = s.exec(
            select(Photo).where(Photo.place_id == place_id).order_by(Photo.created_at.desc())
        ).all()
    return {
        "count": len(rows),
        "items": [
            {"id": p.id, "place_id": p.place_id, "url": p.url, "created_at": p.created_at.isoformat()}
            for p in rows
        ]
    }

@router.post("/api/photos")
async def upload_photo(
    request: Request,
    place_id: str = Form(...),
    file: UploadFile = File(...),
):
    user = get_current_user(request)
    login_required(user)

    name_lower = (file.filename or "").lower()
    ext = os.path.splitext(name_lower)[1]
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"対応拡張子: {', '.join(sorted(ALLOWED_EXT))}")

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(400, "空のファイルです")
    if len(data) > MAX_BYTES:
        raise HTTPException(400, f"ファイルサイズ上限 {MAX_BYTES//(1024*1024)}MB を超えています")

    uid = uuid.uuid4().hex[:12]
    safe_id = "".join(ch for ch in place_id if ch.isalnum() or ch in ("-","_"))
    filename = f"{safe_id}_{uid}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        f.write(data)

    url = f"/uploads/{filename}"

    with Session(engine) as s:
        p = Photo(user_id=user.id, place_id=place_id, filename=filename, url=url)
        s.add(p); s.commit(); s.refresh(p)

    return {"ok": True, "url": url, "id": p.id}

# ===== Check-in =====
from pydantic import BaseModel

class CheckinPayload(BaseModel):
    place_id: str
    place_name: str
    kind: Optional[str] = "地点"
    lat: float
    lon: float
    me_lat: float
    me_lon: float


