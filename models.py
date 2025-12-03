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
    # ★ 追加: ユーザーのロール
    #   - "normal"     : ふつうのプレイヤー（デフォルト）
    #   - "researcher" : 認知率データを見られる人
    #   - "admin"      : 開発者・先生など
    role: str = Field(default="normal", max_length=16, index=True)


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
    
class FacilityStat(SQLModel, table=True):
    """
    施設ごとの認知率・出題統計
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    facility_key: str = Field(index=True, unique=True, max_length=128)  # 例: "170003-00123" or "金沢市::兼六園"
    name: str = Field(max_length=128)   # 施設名（兼六園など）
    city: str = Field(max_length=64)    # 金沢市・野々市市など
    kind: str = Field(max_length=64)    # 公園 / 公共施設 / 図書館…ざっくり分類

    total_shown: int = Field(default=0)      # その施設の問題を「見た」人間プレイヤー数の累計
    total_answered: int = Field(default=0)   # そのうち回答した人数
    total_correct: int = Field(default=0)    # そのうち正解した人数

    last_played_at: datetime = Field(default_factory=datetime.utcnow)


class CityStat(SQLModel, table=True):
    """
    市ごとの認知率・出題統計
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    city: str = Field(index=True, unique=True, max_length=64)  # 金沢市・野々市市など

    total_shown: int = Field(default=0)      # その市の施設をテーマにした問題を「見た」人数
    total_answered: int = Field(default=0)   # そのうち回答した人数
    total_correct: int = Field(default=0)    # そのうち正解した人数

    last_played_at: datetime = Field(default_factory=datetime.utcnow)

# models.py のどこかに追加済み想定
class RecognitionStat(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    place_id: str = Field(index=True)
    place_name: str
    city: str = Field(index=True)
    correct_count: int = Field(default=0)
    total_count: int = Field(default=0)
    last_answered_at: datetime = Field(default_factory=datetime.utcnow)
