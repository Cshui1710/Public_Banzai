# migrate_role.py
from sqlmodel import Session, select
from sqlalchemy.exc import OperationalError
from models import engine, User

def migrate_add_role_column():
    print("Checking if 'role' column exists...")

    with Session(engine) as session:
        try:
            # 既に role が存在するかチェック
            session.exec(select(User).limit(1)).all()
            # role を参照すれば、存在しない時だけ例外が出る
            test = session.exec("SELECT role FROM user LIMIT 1;")  
            print("Already exists → no migration needed")
            return
        except OperationalError:
            print("role column missing → adding column...")

        # ここで ALTER TABLE する
        try:
            session.exec("ALTER TABLE user ADD COLUMN role TEXT DEFAULT 'normal';")
            session.commit()
            print("Migration complete: role column added.")
        except Exception as e:
            print("Migration failed:", e)

if __name__ == "__main__":
    migrate_add_role_column()
