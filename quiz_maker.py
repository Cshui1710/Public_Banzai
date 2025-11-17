# quiz_maker.py
from fastapi import APIRouter, Depends, Form
from datetime import datetime
from sqlmodel import Session
from models import UserQuestion, engine
from auth import get_current_user, login_required

router = APIRouter(prefix="/api/quiz/maker")

@router.post("/add")
async def add_question(
    stem: str = Form(...),
    choice1: str = Form(...),
    choice2: str = Form(...),
    choice3: str = Form(...),
    choice4: str = Form(...),
    correct_idx: int = Form(...),
    hint: str = Form("", description="任意のヒント"),  # ★ 追加
    user=Depends(get_current_user)
):
    login_required(user, allow_guest=False)

    # ★ここで1〜4入力を0〜3に変換（安全にクリップ）
    correct_idx = max(0, min(3, correct_idx - 1))

    with Session(engine) as s:
        q = UserQuestion(
            user_id=user.id,
            stem=stem.strip(),
            choice1=choice1.strip(),
            choice2=choice2.strip(),
            choice3=choice3.strip(),
            choice4=choice4.strip(),
            correct_idx=correct_idx,  # ← 内部保存は0〜3
            hint=hint,  
            created_at=datetime.now().isoformat(),
        )
        s.add(q)
        s.commit()
        s.refresh(q)
    return {"ok": True, "id": q.id}


@router.get("/list")
async def list_questions(user=Depends(get_current_user)):
    login_required(user, allow_guest=False)
    with Session(engine) as s:
        qs = s.query(UserQuestion).filter(UserQuestion.user_id == user.id).all()
        return {"ok": True, "questions": [
            {
                "id": q.id,
                "stem": q.stem,
                "choices": [q.choice1,q.choice2,q.choice3,q.choice4],
                "correct_idx": q.correct_idx,
                "hint": q.hint or ""       # ★ ヒントも返す                
            } for q in qs
        ]}
