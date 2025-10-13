# comments.py
from fastapi import APIRouter, Depends, HTTPException, Request, Query, Path
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta
from sqlmodel import Session, select

from models import engine, Comment, User
from auth import get_current_user, login_required


router = APIRouter(prefix="/api/comments", tags=["comments"])

def get_session():
    with Session(engine) as s:
        yield s

class CommentIn(BaseModel):
    place_id: str = Field(..., min_length=1, max_length=128)
    content: str = Field(..., min_length=1, max_length=500)
    parent_id: Optional[int] = None

@router.get("")
def list_comments(place_id: str = Query(..., min_length=1, max_length=128), session: Session = Depends(get_session)):
    rows = session.exec(
        select(Comment, User).where(Comment.place_id == place_id).join(User, User.id == Comment.user_id).order_by(Comment.created_at.desc())
    ).all()
    items = []
    for c, u in rows:
        items.append({
            "id": c.id,
            "place_id": c.place_id,
            "content": c.content,
            "created_at": c.created_at.isoformat()+"Z",
            "user": {"id": u.id, "email": u.email}
        })
    return {"ok": True, "count": len(items), "items": items}

@router.post("")
def create_comment(payload: CommentIn, request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request)
    login_required(user)

    # 簡易レート制限（同ユーザーが同じ場所に連投 10 秒は不可）
    ten_sec_ago = datetime.utcnow() - timedelta(seconds=10)
    recent = session.exec(
        select(Comment).where(Comment.user_id == user.id, Comment.place_id == payload.place_id, Comment.created_at >= ten_sec_ago)
    ).first()
    if recent:
        raise HTTPException(429, "連続投稿は少し時間をおいてください（10秒）")

    c = Comment(user_id=user.id, place_id=payload.place_id, content=payload.content.strip(), parent_id=payload.parent_id)
    session.add(c); session.commit(); session.refresh(c)
    return {"ok": True, "id": c.id, "created_at": c.created_at.isoformat()+"Z"}

@router.delete("/{comment_id}")
def delete_comment(comment_id: int = Path(..., ge=1), request: Request = None, session: Session = Depends(get_session)):
    user = get_current_user(request)
    login_required(user)

    c = session.get(Comment, comment_id)
    if not c:
        raise HTTPException(404, "コメントが見つかりません")
    if c.user_id != user.id:
        # 管理者権限があればここで許可するなど（今回は本人のみ）
        raise HTTPException(403, "削除権限がありません")

    session.delete(c); session.commit()
    return {"ok": True}
