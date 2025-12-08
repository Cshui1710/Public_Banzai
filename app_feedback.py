# app_feedback.py
from datetime import datetime
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from fastapi.templating import Jinja2Templates

from models import engine, AppFeedback, User
from auth import get_current_user, login_required  # login_requiredはPOSTだけで使う

router = APIRouter(tags=["app-feedback"])

templates = Jinja2Templates(directory="templates")


def get_session():
    with Session(engine) as s:
        yield s


class AppFeedbackIn(BaseModel):
    rating: int = Field(..., ge=1, le=4)
    comment: str = Field(..., min_length=1, max_length=1000)


@router.post("/api/feedback/app")
def create_app_feedback(
    payload: AppFeedbackIn,
    request: Request,
    session: Session = Depends(get_session),
    user = Depends(get_current_user),
):
    """
    アプリ全体へのフィードバックを保存。
    ログイン必須（ゲストもOK）。user_id があれば保存。
    """
    user = login_required(user, allow_guest=True)

    fb = AppFeedback(
        user_id=getattr(user, "id", None),
        page="app",
        rating=payload.rating,
        comment=payload.comment.strip(),
        created_at=datetime.utcnow(),
    )
    session.add(fb)
    session.commit()
    session.refresh(fb)
    return {"ok": True, "id": fb.id}


@router.get("/admin/app_feedback", response_class=HTMLResponse)
def list_app_feedback(
    request: Request,
    session: Session = Depends(get_session),
    user = Depends(get_current_user),
):
    """
    admin ユーザー専用の一覧ページ。
    get_current_user が返す user（role 付き想定）をそのまま信用してチェックする。
    """
    # --- 認証チェック（今のまま） ---
    if user is None or getattr(user, "id", None) is None:
        raise HTTPException(status_code=401, detail="not logged in")

    if getattr(user, "is_guest", False):
        raise HTTPException(status_code=403, detail="guest not allowed")

    if getattr(user, "role", "normal") != "admin":
        raise HTTPException(status_code=403, detail="forbidden")

    # --- フィードバック一覧取得 ---
    rows: List[Tuple[AppFeedback, Optional[User]]] = session.exec(
        select(AppFeedback, User)
        .join(User, User.id == AppFeedback.user_id, isouter=True)
        .order_by(AppFeedback.created_at.desc())
    ).all()

    # ★ ここで平均評価を計算
    ratings = [fb.rating for fb, _ in rows if fb.rating is not None]
    avg_rating: Optional[float] = None
    if ratings:
        avg_rating = round(sum(ratings) / len(ratings), 1)

    # テンプレートには home.html と同じ user + 追加情報を渡す
    return templates.TemplateResponse(
        "admin_app_feedback.html",
        {
            "request": request,
            "user": user,
            "rows": rows,
            "avg_rating": avg_rating,       # 追加
            "ratings_count": len(ratings),  # 追加
        },
    )
