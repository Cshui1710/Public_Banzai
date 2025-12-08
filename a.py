# check_users.py
from sqlmodel import Session, select
from models import engine, User


def main():
    with Session(engine) as session:
        # 1) ユーザー一覧をざっくり確認（先頭20件）
        rows = session.exec(
            select(User.id, User.email, User.display_name).order_by(User.id).limit(20)
        ).all()

        print("=== 先頭20件のユーザー ===")
        for uid, email, display_name in rows:
            print(f"id={uid}, email={email!r}, display_name={display_name!r}")

        # 2) email / display_name が入っているか統計を見る
        total = session.exec(select(User)).count()
        email_ok = session.exec(select(User).where(User.email != None)).count()
        name_ok = session.exec(
            select(User).where(
                (User.display_name != None) & (User.display_name != "")
            )
        ).count()

        print("\n=== 集計 ===")
        print(f"総ユーザー数: {total}")
        print(f"email が入っているユーザー数: {email_ok}")
        print(f"display_name が入っているユーザー数: {name_ok}")

        # 3) 完全に「匿名候補」なユーザー（email も display_name もない）
        anon_like = session.exec(
            select(User.id, User.email, User.display_name).where(
                (User.email == None) | (User.email == ""),
            )
        ).all()

        print("\n=== email が空 or NULL のユーザー（先頭20件表示） ===")
        for uid, email, display_name in anon_like[:20]:
            print(f"id={uid}, email={email!r}, display_name={display_name!r}")


if __name__ == "__main__":
    main()
