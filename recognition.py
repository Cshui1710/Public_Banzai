# recognition.py
from datetime import datetime
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select

from models import engine, RecognitionStat
from auth import get_current_user, login_required

router = APIRouter()
templates = Jinja2Templates(directory="templates")


# === 共通: DB セッション ===
def get_session():
    with Session(engine) as s:
        yield s


# === 共通: ロールチェック ===
def _require_data_role(request: Request):
    u = get_current_user(request)
    login_required(u, allow_guest=False)   # ゲスト不可
    if getattr(u, "role", "normal") not in ("admin", "researcher"):
        raise HTTPException(status_code=403, detail="このページにアクセスする権限がありません")
    return u


# === 1) 認知率ダッシュボード画面 ===
@router.get("/recognition", response_class=HTMLResponse)
def recognition_page(request: Request):
    u = _require_data_role(request)
    return templates.TemplateResponse(
        "recognition.html",
        {
            "request": request,
            "user": u,
        },
    )


# === 2) 認知率サマリ API (棒グラフ用 JSON) ===
@router.get("/api/recognition/summary")
def recognition_summary(
    request: Request,
    session: Session = Depends(get_session),
    min_total: int = 3,   # 集計対象とする最小回答数（ノイズ除去用）
):
    _require_data_role(request)

    rows: List[RecognitionStat] = session.exec(
        select(RecognitionStat)
    ).all()

    facilities: List[Dict] = []
    city_map: Dict[str, Dict[str, int]] = {}  # city -> {correct, total}

    for st in rows:
        if st.total_count <= 0:
            continue

        rate = (st.correct_count / st.total_count) * 100.0
        facilities.append({
            "place_id": st.place_id,
            "place_name": st.place_name,
            "city": st.city,
            "correct": st.correct_count,
            "total": st.total_count,
            "rate": rate,
        })

        c = st.city or "不明"
        if c not in city_map:
            city_map[c] = {"correct": 0, "total": 0}
        city_map[c]["correct"] += st.correct_count
        city_map[c]["total"] += st.total_count

    # 最低回答数フィルタ
    facilities = [f for f in facilities if f["total"] >= min_total]

    # 施設を認知率順にソート（降順）
    facilities.sort(key=lambda x: x["rate"], reverse=True)

    # 市ごとの集計
    cities: List[Dict] = []
    for city, v in city_map.items():
        if v["total"] <= 0:
            continue
        if v["total"] < min_total:
            continue
        rate = (v["correct"] / v["total"]) * 100.0
        cities.append({
            "city": city,
            "correct": v["correct"],
            "total": v["total"],
            "rate": rate,
        })

    cities.sort(key=lambda x: x["rate"], reverse=True)

    # おまけグラフ用：施設の認知率分布（高/中/低）
    dist = {"high": 0, "mid": 0, "low": 0}
    for f in facilities:
        r = f["rate"]
        if r >= 80:
            dist["high"] += 1
        elif r >= 50:
            dist["mid"] += 1
        else:
            dist["low"] += 1

    return {
        "ok": True,
        "facilities": facilities,
        "cities": cities,
        "dist": dist,
        "min_total": min_total,
    }


# === 3) CSV ダウンロード (施設 + 市) ===
@router.get("/api/recognition/export.csv")
def recognition_export_csv(
    request: Request,
    session: Session = Depends(get_session),
    min_total: int = 3,
):
    _require_data_role(request)

    rows: List[RecognitionStat] = session.exec(
        select(RecognitionStat)
    ).all()

    # 施設行
    facility_lines = ["type,place_id,place_name,city,correct,total,rate"]
    city_map: Dict[str, Dict[str, int]] = {}

    for st in rows:
        if st.total_count <= 0:
            continue
        if st.total_count < min_total:
            continue
        rate = (st.correct_count / st.total_count) * 100.0
        facility_lines.append(
            f'facility,"{st.place_id}","{st.place_name}","{st.city}",'
            f'{st.correct_count},{st.total_count},{rate:.2f}'
        )

        c = st.city or "不明"
        if c not in city_map:
            city_map[c] = {"correct": 0, "total": 0}
        city_map[c]["correct"] += st.correct_count
        city_map[c]["total"] += st.total_count

    # 市行
    for city, v in city_map.items():
        if v["total"] <= 0:
            continue
        if v["total"] < min_total:
            continue
        rate = (v["correct"] / v["total"]) * 100.0
        facility_lines.append(
            f'city,,"","{city}",{v["correct"]},{v["total"]},{rate:.2f}'
        )

    csv_body = "\n".join(facility_lines)

    # ★★★ ここで UTF-8 BOM を付与 ★★★
    bom = "\ufeff"
    csv_with_bom = bom + csv_body

    filename = f"recognition_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        iter([csv_with_bom]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )