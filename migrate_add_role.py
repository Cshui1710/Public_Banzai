# set_role.py
from sqlmodel import Session, select
from models import engine, User

def set_role(email: str, role: str):
    """
    指定ユーザーの role を更新する。
    存在しなければ警告のみ表示して終了。
    """
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == email)).first()
        if not user:
            print(f"[WARN] User not found: {email}")
            return

        old_role = getattr(user, "role", None)
        user.role = role
        session.add(user)
        session.commit()

        print(f"[OK] {email}: role '{old_role}' → '{role}'")

if __name__ == "__main__":
    # ▼ ここを好きに書き換える
    set_role("c1204247@gmail.com", "admin")
