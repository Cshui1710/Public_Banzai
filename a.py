import sqlite3

conn = sqlite3.connect("../nonoji.db")
cur = conn.cursor()

cur.execute("""
SELECT name
FROM sqlite_master
WHERE type='table'
AND name NOT LIKE 'sqlite_%'
""")

tables = [row[0] for row in cur.fetchall()]

for table in tables:
    cur.execute(f"PRAGMA table_info({table})")
    columns = cur.fetchall()
    print(f"{table}: レコード数 = ", end="")
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    print(cur.fetchone()[0], end="")
    print(f" 件 / 属性数 = {len(columns)}")

conn.close()
