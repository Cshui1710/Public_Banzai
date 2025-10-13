# analytics.py — チェックイン可視化/分析用 API
from datetime import datetime, timedelta
from typing import Optional, List, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func

from models import engine, Stamp

router = APIRouter(prefix="/api", tags=["analytics"])

def get_session():
    with Session(engine) as s:
        yield s

def parse_iso(dt: Optional[str], default: Optional[datetime]) -> datetime:
    if dt:
        try:
            return datetime.fromisoformat(dt.replace("Z",""))
        except Exception:
            raise HTTPException(400, "invalid datetime format (ISO8601 expected)")
    if default is None:
        raise HTTPException(400, "datetime required")
    return default

# ====== 1) ヒートマップ用のポイント ======
@router.get("/stats/heatmap")
def stats_heatmap(
    session: Session = Depends(get_session),
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    kind: Optional[str] = None,
    max_points: int = Query(20000, ge=1000, le=200000),

    # ★追加
    tod: Optional[str] = Query(None, description="morning/noon/evening/night/late"),
    hour_from: Optional[int] = None,
    hour_to:   Optional[int] = None,
):
    now = datetime.utcnow()
    dt_from = parse_iso(date_from, now - timedelta(days=30))
    dt_to   = parse_iso(date_to,   now)

    q = select(Stamp.lat, Stamp.lon).where(Stamp.checked_at >= dt_from, Stamp.checked_at < dt_to)
    if kind:
        q = q.where(Stamp.kind == kind)

    hr = resolve_hour_range(tod, hour_from, hour_to)
    if hr:
        hcol = hour_extract_expr()
        a, b = hr
        if a <= b:
            q = q.where(and_(hcol >= a, hcol < b))
        else:
            # 深夜など跨ぐケース (例: 23-5)
            q = q.where(or_(hcol >= a, hcol < b))

    rows = session.exec(q.limit(max_points)).all()
    points = [[float(lat), float(lon), 1.0] for (lat, lon) in rows if lat is not None and lon is not None]
    meta = {"from": dt_from.isoformat()+"Z", "to": dt_to.isoformat()+"Z", "kind": kind or "all"}
    if hr: meta["hour_range"] = hr
    return {"ok": True, "count": len(points), "points": points, **meta}


# ====== 2) 時系列（時間/日/週） ======
@router.get("/stats/timeseries")
def stats_timeseries(
    session: Session = Depends(get_session),
    bucket: str = Query("day", regex="^(hour|day|week)$"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    kind: Optional[str] = None,

    tod: Optional[str] = None, hour_from: Optional[int] = None, hour_to: Optional[int] = None,
):
    now = datetime.utcnow()
    dt_from = parse_iso(date_from, now - timedelta(days=30))
    dt_to   = parse_iso(date_to,   now)

    ts_col = Stamp.checked_at
    if bucket == "hour":
        key = func.strftime("%Y-%m-%d %H:00", ts_col) if engine.url.get_backend_name()=="sqlite" else func.to_char(ts_col, "YYYY-MM-DD HH24:00")
    elif bucket == "week":
        key = func.strftime("%Y-W%W", ts_col) if engine.url.get_backend_name()=="sqlite" else func.to_char(ts_col, "IYYY-IW")
    else:
        key = func.strftime("%Y-%m-%d", ts_col) if engine.url.get_backend_name()=="sqlite" else func.to_char(ts_col, "YYYY-MM-DD")

    q = select(key.label("k"), func.count().label("c")).where(ts_col >= dt_from, ts_col < dt_to)
    if kind:
        q = q.where(Stamp.kind == kind)

    hr = resolve_hour_range(tod, hour_from, hour_to)
    if hr:
        hcol = hour_extract_expr()
        a,b = hr
        if a <= b:
            q = q.where(and_(hcol >= a, hcol < b))
        else:
            q = q.where(or_(hcol >= a, hcol < b))

    q = q.group_by("k").order_by("k")
    rows = session.exec(q).all()
    series = [{"t": r[0], "count": int(r[1])} for r in rows]
    res = {"ok": True, "bucket": bucket, "from": dt_from.isoformat()+"Z", "to": dt_to.isoformat()+"Z", "kind": kind or "all", "items": series}
    if hr: res["hour_range"] = hr
    return res


# ====== 3) 種別内訳（施設カテゴリ別） ======
@router.get("/stats/by-kind")
def stats_by_kind(
    session: Session = Depends(get_session),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    tod: Optional[str] = None, hour_from: Optional[int] = None, hour_to: Optional[int] = None,
):
    now = datetime.utcnow()
    dt_from = parse_iso(date_from, now - timedelta(days=30))
    dt_to   = parse_iso(date_to,   now)

    q = select(Stamp.kind, func.count()).where(Stamp.checked_at >= dt_from, Stamp.checked_at < dt_to)

    hr = resolve_hour_range(tod, hour_from, hour_to)
    if hr:
        hcol = hour_extract_expr()
        a,b = hr
        if a <= b:
            q = q.where(and_(hcol >= a, hcol < b))
        else:
            q = q.where(or_(hcol >= a, hcol < b))

    q = q.group_by(Stamp.kind)
    rows = session.exec(q).all()
    items = [{"kind": k or "不明", "count": int(c)} for (k, c) in rows]
    res = {"ok": True, "from": dt_from.isoformat()+"Z", "to": dt_to.isoformat()+"Z", "items": items}
    if hr: res["hour_range"] = hr
    return res


# ====== 4) GeoJSON エクスポート ======
@router.get("/export/checkins.geojson")
def export_geojson(
    session: Session = Depends(get_session),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = Query(50000, ge=1000, le=200000)
):
    now = datetime.utcnow()
    dt_from = parse_iso(date_from, now - timedelta(days=90))
    dt_to   = parse_iso(date_to,   now)

    q = select(Stamp).where(Stamp.checked_at >= dt_from, Stamp.checked_at < dt_to).order_by(Stamp.checked_at.desc()).limit(limit)
    if kind:
        q = q.where(Stamp.kind == kind)
    rows = session.exec(q).all()

    feats = []
    for st in rows:
        if st.lat is None or st.lon is None: 
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(st.lon), float(st.lat)]},
            "properties": {
                "place_id": st.place_id, "place_name": st.place_name, "kind": st.kind,
                "checked_at": st.checked_at.isoformat()+"Z"
            }
        })
    return {"type": "FeatureCollection", "features": feats}

# 追加インポート
from sqlalchemy import Integer, and_, or_
from sqlmodel import col

# 共通: 時間帯パラメータ解釈
def resolve_hour_range(tod: Optional[str], hour_from: Optional[int], hour_to: Optional[int]):
    if tod:
        m = {
            "morning": (5, 10),
            "noon":    (10, 15),
            "evening": (15, 19),
            "night":   (19, 23),
            "late":    (23, 5),  # 深夜
        }
        if tod not in m:
            raise HTTPException(400, "invalid tod (morning/noon/evening/night/late)")
        return m[tod]
    if hour_from is not None and hour_to is not None:
        if not (0 <= hour_from <= 23 and 0 <= hour_to <= 23):
            raise HTTPException(400, "hour_from/hour_to must be 0-23")
        return (hour_from, hour_to)
    return None  # フィルタなし

def hour_extract_expr():
    # SQLite と Postgres の両対応
    if engine.url.get_backend_name() == "sqlite":
        return func.cast(func.strftime("%H", Stamp.checked_at), Integer)  # 0..23
    else:
        return func.extract("hour", Stamp.checked_at)  # 0..23 (float扱いなのでCASTしてもOK)
