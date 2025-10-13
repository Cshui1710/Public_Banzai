import csv, io, os
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from config import LOCAL_CSV_PATH, NAGANO_FAC_CSV, NAGANO_PARK_CSV
from functools import lru_cache

router = APIRouter()

def _pick(d: dict, keys: List[str]):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", "null"):
            return v
    return None

def _guess_kind(row: dict) -> str:
    name = str(row.get("名称") or row.get("施設名") or row.get("name") or "").strip()
    cat  = str(row.get("種別") or row.get("分類") or row.get("用途") or "").strip()
    text = f"{name} {cat}"
    if "公園" in text:
        return "公園"
    return "公共施設"

def _parse_csv_record(rec: dict):
    lat = _pick(rec, ["緯度", "lat", "latitude", "Y座標", "y", "Y"])
    lon = _pick(rec, ["経度", "lon", "longitude", "X座標", "x", "X"])
    try:
        if lat is None or lon is None:
            return None
        lat = float(str(lat).strip()); lon = float(str(lon).strip())
    except Exception:
        return None

    name = _pick(rec, ["名称", "施設名", "name", "Name", "名称_通称"]) or ""
    addr = (
        _pick(rec, ["所在地_連結表記", "住所", "所在地", "address"]) or
        " ".join(filter(None, [
            rec.get("所在地_都道府県"), rec.get("所在地_市区町村"),
            rec.get("所在地_町字"), rec.get("所在地_番地以下")
        ])) or ""
    )
    pid  = _pick(rec, ["ID", "_id", "id", "コード"]) or f"{lat}-{lon}"
    kind = _guess_kind(rec)

    # 追加情報
    weekdays   = _pick(rec, ["利用可能曜日"])
    open_time  = _pick(rec, ["開始時間"])
    close_time = _pick(rec, ["終了時間"])
    time_note  = _pick(rec, ["利用可能時間特記事項"])
    desc       = _pick(rec, ["説明"])

    def _tf(v):
        v = str(v or "").strip()
        return True if v in ("有", "可", "はい", "有り", "あり", "Yes", "TRUE", "true") else False

    wheelchair = _tf(rec.get("車椅子可"))
    brailleBlk = _tf(rec.get("点字ブロック等の移動支援"))
    guideDog   = _tf(rec.get("盲導犬・介助犬、聴導犬同伴"))
    ostomy     = _tf(rec.get("オストメイト対応トイレ"))
    babyRoom   = _tf(rec.get("授乳室"))
    diaper     = _tf(rec.get("おむつ替えコーナー"))
    priorityPrk= _tf(rec.get("優先駐車場"))

    url   = _pick(rec, ["URL"])
    image = _pick(rec, ["画像"])

    return {
        "id": str(pid),
        "name": str(name),
        "address": str(addr),
        "lat": float(lat),
        "lon": float(lon),
        "kind": kind,
        "image": str(image) if image else None,
        "url": str(url) if url else None,
        "weekdays": weekdays,
        "open_time": open_time,
        "close_time": close_time,
        "time_note": time_note,
        "desc": desc,
        "a11y": {
            "wheelchair": wheelchair,
            "braille_block": brailleBlk,
            "guide_dog": guideDog,
            "ostomy": ostomy,
            "baby_room": babyRoom,
            "diaper": diaper,
            "priority_parking": priorityPrk,
        },
        "_raw": rec,
    }

def _decode_bytes(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp932", "shift_jis"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "ignore")

def _sniff_delimiter(first_line: str) -> str:
    cand = {",": first_line.count(","), "\t": first_line.count("\t"), ";": first_line.count(";")}
    delim = max(cand, key=cand.get) if first_line else ","
    return delim if cand.get(delim, 0) > 0 else ","

@lru_cache(maxsize=1)
def _load_main_csv() -> list[dict]:
    if not os.path.exists(LOCAL_CSV_PATH):
        raise HTTPException(500, f"CSVが見つかりません: {LOCAL_CSV_PATH}")
    with open(LOCAL_CSV_PATH, "rb") as f:
        text = _decode_bytes(f.read())
    delimiter = _sniff_delimiter(text.splitlines()[0] if text else "")
    rows = list(csv.DictReader(io.StringIO(text), delimiter=delimiter))
    parsed = []
    for r in rows:
        p = _parse_csv_record(r)
        if p:
            parsed.append(p)
    return parsed

def _parse_nagano_record(r: dict, default_kind: str) -> Optional[dict]:
    try:
        lat = float(str(r.get("緯度", "")).strip())
        lon = float(str(r.get("経度", "")).strip())
    except Exception:
        return None
    name = (r.get("名称") or "").strip()
    addr = (r.get("住所") or "").strip()
    pid  = (r.get("NO") or r.get("名称") or f"{lat}-{lon}")
    return {
        "id": str(pid),
        "name": name or "(名称不明)",
        "address": addr,
        "lat": lat,
        "lon": lon,
        "kind": default_kind,
        "source": "nagano"
    }

@lru_cache(maxsize=1)
def _load_nagano_csv(path: str, default_kind: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, "rb") as f:
        text = _decode_bytes(f.read())
    delimiter = _sniff_delimiter(text.splitlines()[0] if text else "")
    rows = list(csv.DictReader(io.StringIO(text), delimiter=delimiter))
    out = []
    for r in rows:
        p = _parse_nagano_record(r, default_kind)
        if p:
            out.append(p)
    return out

# ===== Routes =====
@router.get("/api/local/places")
def api_local_places(kind: str = "park"):
    items = _load_main_csv()
    if kind == "park":
        filtered = [x for x in items if x["kind"] == "公園"]
    elif kind == "facility":
        filtered = [x for x in items if x["kind"] != "公園"]
    else:
        raise HTTPException(400, "kind は 'park' か 'facility'")
    return {"count": len(filtered), "items": filtered}

@router.get("/api/local/place")
def api_local_place(id: str = Query(..., min_length=1)):
    items = _load_main_csv()
    for x in items:
        if str(x["id"]) == id:
            return {"ok": True, "item": x}
    # fallback: nagano
    nag_fac = _load_nagano_csv(NAGANO_FAC_CSV, "公共施設")
    nag_park = _load_nagano_csv(NAGANO_PARK_CSV, "公園")
    for x in (nag_fac + nag_park):
        if str(x["id"]) == id:
            return {"ok": True, "item": x}
    raise HTTPException(404, "not found")

@router.get("/api/nagano/places")
def api_nagano_places(kind: str = "facility"):
    items = _load_nagano_csv(NAGANO_FAC_CSV, "公共施設") if kind == "facility" else _load_nagano_csv(NAGANO_PARK_CSV, "公園")
    if kind not in ("facility", "park"):
        raise HTTPException(400, "kind は 'facility' か 'park'")
    return {"count": len(items), "items": items}
