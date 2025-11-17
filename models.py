from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field, create_engine, Session, select

# SQLite エンジン
engine = create_engine("sqlite:///./nonoji.db", echo=False)

# ===== Models =====
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    display_name: Optional[str] = Field(default=None, max_length=32)



class Stamp(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    place_id: str = Field(index=True)
    place_name: str
    kind: str
    lat: float
    lon: float
    checked_at: datetime = Field(default_factory=datetime.utcnow)

class Photo(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    place_id: str = Field(index=True)
    filename: str
    url: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class OAuthAccount(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str = Field(index=True)   # "google" / "line"
    subject: str = Field(index=True)    # OIDC sub
    user_id: int = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

def on_startup():
    SQLModel.metadata.create_all(engine)

# ▼ models.py 追記（末尾あたりに）
class Character(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)     # 例: "marmot"
    name: str                                      # 表示名: "マーモット"
    sprite_path: str                               # "/static/characters/marmot_idle.png"
    frames: int = 4                                # 横スプライトのコマ数
    frame_w: int = 256
    frame_h: int = 256
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCharacter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    character_id: int = Field(index=True)
    obtained_at: datetime = Field(default_factory=datetime.utcnow)

class Comment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    place_id: str = Field(index=True, max_length=128)  # 施設ID（既存の place_id と合わせる）
    content: str = Field(max_length=500)
    parent_id: Optional[int] = Field(default=None, foreign_key="comment.id")
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    
class UserQuestion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int
    stem: str                      # 問題文
    choice1: str
    choice2: str
    choice3: str
    choice4: str
    correct_idx: int               # 0〜3
    created_at: str
    hint: Optional[str] = Field(default=None)    