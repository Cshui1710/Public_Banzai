# analytics.py — チェックイン可視化/分析用 API
from datetime import datetime, timedelta
from typing import Optional, List, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query,Request
from sqlmodel import Session, select, func

from models import engine, Stamp
from auth import require_research_role   # ★ 追加
from sqlalchemy import Integer, and_, or_, case
from fastapi.responses import StreamingResponse
from sqlmodel import col
from models import engine, Stamp , User
from fastapi.responses import JSONResponse, HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(prefix="/api", tags=["analytics"])
templates = Jinja2Templates(directory="templates")
def get_session():
    with Session(engine) as s:
        yield s

@router.get("/checkins/summary", response_class=HTMLResponse)
async def checkins_summary_page(
    request: Request,
    # 必要なら権限チェックも:
    # user = Depends(require_research_role),
):
    return templates.TemplateResponse(
        "checkins_summary.html",
        {"request": request}
    )

    
from datetime import datetime

@router.get("/checkins/summary/data")
async def api_checkins_summary(
    date_from: str | None = Query(None, description="ISO8601形式の開始日時"),
    date_to:   str | None = Query(None, description="ISO8601形式の終了日時"),
    kind:      str | None = Query(None, description="公園/公共施設 等"),
    session: Session = Depends(get_session),
):
    """
    施設ごとのチェックイン数を集計して返すJSON API。
    Stamp テーブルを集計対象とする。
    """
    q = select(
        Stamp.place_id,
        Stamp.place_name,
        Stamp.kind,
        func.count(Stamp.id).label("count"),
        func.min(Stamp.checked_at).label("first_ts"),
        func.max(Stamp.checked_at).label("last_ts"),
    )

    # 日時フィルタ（checked_at を対象）
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at >= dt_from)
        except Exception:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at <= dt_to)
        except Exception:
            pass

    # 種別フィルタ
    if kind:
        q = q.where(Stamp.kind == kind)

    q = q.group_by(Stamp.place_id, Stamp.place_name, Stamp.kind)
    q = q.order_by(func.count(Stamp.id).desc())

    rows = session.exec(q).all()

    total_count = sum(r.count for r in rows) if rows else 0
    facility_count = len(rows)

    # 期間（日数）
    all_first = [r.first_ts for r in rows if r.first_ts is not None]
    all_last  = [r.last_ts for r in rows if r.last_ts is not None]
    if all_first and all_last:
        span_days = (max(all_last) - min(all_first)).days + 1
    else:
        span_days = None

    items = [
        {
            "place_id":   r.place_id,
            "place_name": r.place_name,
            "kind":       r.kind,
            "count":      r.count,
            "first_ts":   r.first_ts.isoformat() if r.first_ts else None,
            "last_ts":    r.last_ts.isoformat()  if r.last_ts else None,
        }
        for r in rows
    ]

    return JSONResponse({
        "ok": True,
        "items": items,
        "total_count": total_count,
        "facility_count": facility_count,
        "day_span": span_days,
    })
    
import io
import csv

@router.get("/export/checkins_summary.csv")
async def export_checkins_summary_csv(
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    kind:      str | None = Query(None),
    session: Session = Depends(get_session),
):
    """
    チェックイン集計結果を CSV としてダウンロードするエンドポイント。
    集計対象は Stamp（チェックインログ）。
    """
    q = select(
        Stamp.place_id,
        Stamp.place_name,
        Stamp.kind,
        func.count(Stamp.id).label("count"),
        func.min(Stamp.checked_at).label("first_ts"),
        func.max(Stamp.checked_at).label("last_ts"),
    )

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at >= dt_from)
        except Exception:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at <= dt_to)
        except Exception:
            pass
    if kind:
        q = q.where(Stamp.kind == kind)

    q = q.group_by(Stamp.place_id, Stamp.place_name, Stamp.kind)
    q = q.order_by(func.count(Stamp.id).desc())

    rows = session.exec(q).all()

    bom = "\ufeff"  # ★ これが BOM
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["place_id", "place_name", "kind", "count", "first_ts", "last_ts"])
    for r in rows:
        writer.writerow([
            r.place_id,
            r.place_name,
            r.kind,
            r.count,
            r.first_ts.isoformat() if r.first_ts else "",
            r.last_ts.isoformat()  if r.last_ts else "",
        ])

    buf.seek(0)
    text = bom + buf.getvalue() 
    
    headers = {
      "Content-Disposition": 'attachment; filename="checkins_summary.csv"'
    }
    return StreamingResponse(
        iter([text]),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )

        
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
    user = Depends(require_research_role),   # ★ 追加
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
    user = Depends(require_research_role),   # ★ 追加
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
    user = Depends(require_research_role),   # ★ 追加
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

@router.get("/checkins/by-age")
async def api_checkins_by_age(
    date_from: str | None = Query(None, description="ISO8601形式の開始日時"),
    date_to:   str | None = Query(None, description="ISO8601形式の終了日時"),
    kind:      str | None = Query(None, description="公園/公共施設 等"),
    age_group: str | None = Query(None, description="child/adult/senior"),
    session: Session = Depends(get_session),
):
    """
    年代別（User.age_group）に施設ごとのチェックイン数を集計して返す。
    """
    valid_age_groups = {"child", "adult", "senior"}
    if age_group and age_group not in valid_age_groups:
        raise HTTPException(400, "invalid age_group (child/adult/senior)")

    q = select(
        Stamp.place_id,
        Stamp.place_name,
        Stamp.kind,
        func.coalesce(User.age_group, "unknown").label("age_group"),
        func.count(Stamp.id).label("count"),
        func.min(Stamp.checked_at).label("first_ts"),
        func.max(Stamp.checked_at).label("last_ts"),
    ).join(User, User.id == Stamp.user_id)

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at >= dt_from)
        except Exception:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at <= dt_to)
        except Exception:
            pass

    if kind:
        q = q.where(Stamp.kind == kind)
    if age_group:
        q = q.where(User.age_group == age_group)

    q = q.group_by(
        Stamp.place_id,
        Stamp.place_name,
        Stamp.kind,
        User.age_group,
    ).order_by(func.count(Stamp.id).desc())

    rows = session.exec(q).all()

    total_count = sum(r.count for r in rows) if rows else 0
    items = [
        {
            "place_id":   r.place_id,
            "place_name": r.place_name,
            "kind":       r.kind,
            "age_group":  r.age_group,
            "count":      r.count,
            "first_ts":   r.first_ts.isoformat() if r.first_ts else None,
            "last_ts":    r.last_ts.isoformat()  if r.last_ts else None,
        }
        for r in rows
    ]

    return JSONResponse({
        "ok": True,
        "items": items,
        "total_count": total_count,
    })

@router.get("/export/checkins_by_age.csv")
async def export_checkins_by_age_csv(
    date_from: str | None = Query(None),
    date_to:   str | None = Query(None),
    kind:      str | None = Query(None),
    age_group: str | None = Query(None),
    session: Session = Depends(get_session),
):
    """
    年代別チェックイン集計を CSV としてダウンロードするエンドポイント。
    """
    valid_age_groups = {"child", "adult", "senior"}
    if age_group and age_group not in valid_age_groups:
        raise HTTPException(400, "invalid age_group (child/adult/senior)")

    q = select(
        Stamp.place_id,
        Stamp.place_name,
        Stamp.kind,
        func.coalesce(User.age_group, "unknown").label("age_group"),
        func.count(Stamp.id).label("count"),
        func.min(Stamp.checked_at).label("first_ts"),
        func.max(Stamp.checked_at).label("last_ts"),
    ).join(User, User.id == Stamp.user_id)

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at >= dt_from)
        except Exception:
            pass
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            q = q.where(Stamp.checked_at <= dt_to)
        except Exception:
            pass
    if kind:
        q = q.where(Stamp.kind == kind)
    if age_group:
        q = q.where(User.age_group == age_group)

    q = q.group_by(
        Stamp.place_id,
        Stamp.place_name,
        Stamp.kind,
        User.age_group,
    ).order_by(func.count(Stamp.id).desc())

    rows = session.exec(q).all()

    bom = "\ufeff"
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["place_id", "place_name", "kind", "age_group", "count", "first_ts", "last_ts"])
    for r in rows:
        writer.writerow([
            r.place_id,
            r.place_name,
            r.kind,
            r.age_group,
            r.count,
            r.first_ts.isoformat() if r.first_ts else "",
            r.last_ts.isoformat()  if r.last_ts else "",
        ])

    buf.seek(0)
    text = bom + buf.getvalue()
    headers = {
        "Content-Disposition": 'attachment; filename="checkins_by_age.csv"'
    }
    return StreamingResponse(
        iter([text]),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )



# ====== 4) GeoJSON エクスポート ======
@router.get("/export/checkins.geojson")
def export_geojson(
    session: Session = Depends(get_session),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = Query(50000, ge=1000, le=200000),
    user = Depends(require_research_role),   # ★ 追加
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

# ====== 5) 施設別チェックイン集計（時間帯ごと） ======
@router.get("/stats/facility-checkins")
def stats_facility_checkins(
    session: Session = Depends(get_session),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    place_id: Optional[str] = None,
    min_total: int = Query(1, ge=0, description="この件数以上の施設のみ返す（フィルタ）"),
    limit: int = Query(5000, ge=1, le=50000),
):
    """
    施設ごとのチェックイン数（期間内）を、時間帯別に集計して返す。
      - band_0_8   : 0〜8時
      - band_8_16  : 8〜16時
      - band_16_24 : 16〜24時
      - total      : 期間内の総チェックイン
    """
    now = datetime.utcnow()
    dt_from = parse_iso(date_from, now - timedelta(days=30))
    dt_to   = parse_iso(date_to,   now)

    ts_col = Stamp.checked_at
    hcol = hour_extract_expr()

    # 時間帯ごとの CASE 集計
    band_0_8 = func.sum(
        case(
            (and_(hcol >= 0,  hcol < 8), 1),
            else_=0,
        )
    ).label("band_0_8")

    band_8_16 = func.sum(
        case(
            (and_(hcol >= 8,  hcol < 16), 1),
            else_=0,
        )
    ).label("band_8_16")

    band_16_24 = func.sum(
        case(
            (and_(hcol >= 16, hcol < 24), 1),
            else_=0,
        )
    ).label("band_16_24")

    total = func.count().label("total")

    q = (
        select(
            Stamp.place_id,
            Stamp.place_name,
            band_0_8,
            band_8_16,
            band_16_24,
            total,
        )
        .where(ts_col >= dt_from, ts_col < dt_to)
    )

    if place_id:
        q = q.where(Stamp.place_id == place_id)

    q = q.group_by(Stamp.place_id, Stamp.place_name)
    # total の多い順に上位施設から
    q = q.having(total >= min_total).order_by(total.desc()).limit(limit)

    rows = session.exec(q).all()

    items = []
    for r in rows:
        pid, name, c0_8, c8_16, c16_24, tot = r
        items.append({
            "place_id": pid,
            "place_name": name,
            "band_0_8": int(c0_8 or 0),
            "band_8_16": int(c8_16 or 0),
            "band_16_24": int(c16_24 or 0),
            "total": int(tot or 0),
        })

    return {
        "ok": True,
        "from": dt_from.isoformat() + "Z",
        "to": dt_to.isoformat() + "Z",
        "items": items,
        "count": len(items),
    }

# ====== 6) 施設別チェックイン集計 CSV エクスポート ======
@router.get("/export/facility_checkins.csv")
def export_facility_checkins_csv(
    session: Session = Depends(get_session),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    place_id: Optional[str] = None,
    min_total: int = Query(1, ge=0),
    limit: int = Query(50000, ge=1, le=200000),
):
    """
    施設ごとのチェックイン数（時間帯別）を CSV でエクスポートする。
    カラム:
      place_id, place_name, band_0_8, band_8_16, band_16_24, total
    """
    now = datetime.utcnow()
    dt_from = parse_iso(date_from, now - timedelta(days=30))
    dt_to   = parse_iso(date_to,   now)

    ts_col = Stamp.checked_at
    hcol = hour_extract_expr()

    band_0_8 = func.sum(
        case(
            (and_(hcol >= 0,  hcol < 8), 1),
            else_=0,
        )
    ).label("band_0_8")

    band_8_16 = func.sum(
        case(
            (and_(hcol >= 8,  hcol < 16), 1),
            else_=0,
        )
    ).label("band_8_16")

    band_16_24 = func.sum(
        case(
            (and_(hcol >= 16, hcol < 24), 1),
            else_=0,
        )
    ).label("band_16_24")

    total = func.count().label("total")

    q = (
        select(
            Stamp.place_id,
            Stamp.place_name,
            band_0_8,
            band_8_16,
            band_16_24,
            total,
        )
        .where(ts_col >= dt_from, ts_col < dt_to)
    )

    if place_id:
        q = q.where(Stamp.place_id == place_id)

    q = q.group_by(Stamp.place_id, Stamp.place_name)
    q = q.having(total >= min_total).order_by(total.desc()).limit(limit)

    rows = list(session.exec(q).all())
    bom = "\ufeff"
    from io import StringIO
    buf = StringIO()
    
    def generate():
        import csv
        from io import StringIO

        header = ["place_id", "place_name", "band_0_8", "band_8_16", "band_16_24", "total"]
        sio = StringIO()
        writer = csv.writer(sio)
        writer.writerow(header)
        yield sio.getvalue()
        sio.seek(0); sio.truncate(0)

        for r in rows:
            pid, name, c0_8, c8_16, c16_24, tot = r
            writer.writerow([
                pid,
                name,
                int(c0_8 or 0),
                int(c8_16 or 0),
                int(c16_24 or 0),
                int(tot or 0),
            ])
            yield sio.getvalue()
            sio.seek(0); sio.truncate(0)
    text = bom + buf.getvalue()
    filename = f"facility_checkins_{dt_from.date()}_{dt_to.date()}.csv"
    return StreamingResponse(
        iter([text]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


