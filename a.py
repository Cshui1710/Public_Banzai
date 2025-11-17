from models import engine
from sqlalchemy import text

with engine.begin() as conn:
    conn.execute(text("ALTER TABLE userquestion ADD COLUMN hint TEXT;"))
