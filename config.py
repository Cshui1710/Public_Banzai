import os
from pathlib import Path
from dotenv import load_dotenv

# .env ロード
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# JWT/セッション
JWT_SECRET = (os.getenv("JWT_SECRET", "CHANGE_ME") or "").strip()
JWT_ALG = (os.getenv("JWT_ALG", "HS256") or "").strip()
JWT_EXPIRE_MIN = int((os.getenv("JWT_EXPIRE_MIN", "43200") or "43200").strip())
SESSION_SECRET = (os.getenv("SESSION_SECRET", "dev-session-secret-change-me") or "").strip()

# 半径・BASE
ARRIVAL_RADIUS_M = float((os.getenv("ARRIVAL_RADIUS_M", "50000") or "50000").strip())
BASE_URL = (os.getenv("BASE_URL", "http://127.0.0.1:8000") or "").strip().rstrip("/")

# OAuth
GOOGLE_CLIENT_ID = (os.getenv("GOOGLE_CLIENT_ID", "") or "").strip()
GOOGLE_CLIENT_SECRET = (os.getenv("GOOGLE_CLIENT_SECRET", "") or "").strip()
LINE_CLIENT_ID = (os.getenv("LINE_CLIENT_ID", "") or "").strip()
LINE_CLIENT_SECRET = (os.getenv("LINE_CLIENT_SECRET", "") or "").strip()

# CSV
BASE_DIR = Path(__file__).parent

# ここを data/ 配下に変更（絶対パスで安全に）
LOCAL_CSV_PATH = str(BASE_DIR / "data" / "public_facility.csv")
NAGANO_FAC_CSV = str(BASE_DIR / "data" / "202142_public_facility.csv")
NAGANO_PARK_CSV = str(BASE_DIR / "data" / "202142_public_park.csv")

# アップロード
UPLOAD_DIR = (os.getenv("UPLOAD_DIR", "uploads") or "").strip()
os.makedirs(UPLOAD_DIR, exist_ok=True)

# パスワード長
MIN_PW = 8
MAX_PW = 256

AUTH_COOKIE = "nonoji_session"

