# delete_user.py 的な一時スクリプト
from sqlmodel import Session, select
from models import engine, User

TARGET_EMAIL = "c1204247@gmail.com"  # ←消したいメールに変える

with Session(engine) as s:
    u = s.exec(select(User).where(User.email == TARGET_EMAIL)).first()
    if not u:
        print("ユーザーが見つかりませんでした")
    else:
        print("削除するユーザー:", u.id, u.email)
        s.delete(u)
        s.commit()
        print("削除完了")
