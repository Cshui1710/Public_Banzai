# admin_roles.py
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlmodel import Session, select

from models import engine, User
from auth import get_current_user, login_required

router = APIRouter(prefix="/admin", tags=["admin"])


class RoleRequest(BaseModel):
    email: str
    role: str  # "admin", "researcher", "normal" など


def ensure_admin(user: User):
    """
    admin 以外は 403
    """
    role = getattr(user, "role", "normal")
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="管理者専用機能です。",
        )


@router.post("/set_role")
async def api_set_role(body: RoleRequest, user=Depends(get_current_user)):
    """
    メールアドレスでユーザーを検索し、role を上書きする。
    ※ admin ユーザーのみ利用可能
    """
    login_required(user, allow_guest=False)
    ensure_admin(user)

    email = body.email.strip()
    role = body.role.strip()

    # 許可するロールだけに制限
    allowed_roles = {"admin", "researcher", "normal"}
    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"role は {', '.join(sorted(allowed_roles))} のいずれかを指定してください。",
        )

    with Session(engine) as session:
        target = session.exec(
            select(User).where(User.email == email)
        ).first()

        if not target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"ユーザーが見つかりません: {email}",
            )

        old_role = getattr(target, "role", None)
        target.role = role
        session.add(target)
        session.commit()

        return {
            "ok": True,
            "email": email,
            "old_role": old_role,
            "new_role": role,
            "message": f"{email}: role '{old_role}' → '{role}' に更新しました。",
        }
