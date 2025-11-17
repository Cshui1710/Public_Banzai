# quiz.py
from __future__ import annotations
import asyncio
import secrets
import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse
from starlette.websockets import WebSocketState
from fastapi.templating import Jinja2Templates
import glob,time,os
from pathlib import Path
from auth import get_current_user, login_required
from models import UserQuestion, engine
from sqlmodel import Session

from sqlmodel import Session, select
from models import engine, Character, UserCharacter

STAMP_COOLDOWN_SEC     = 4   # 同一ユーザーの連打を抑制
STAMP_MAX_PER_ROUND    = 10     # 1ラウンドに送れる上限
BASE_DIR = Path(__file__).resolve().parent  # quiz.pyの場所
# staticがプロジェクト直下なら parent を調整してください
# STAMP_DIR = str((BASE_DIR.parent / "static" / "stamp").resolve())
# STAMP_ALLOW_EXTS       = {".png", ".webp", ".gif"}        # 許可拡張子

router = APIRouter()
templates = Jinja2Templates(directory="templates")

NEEDED_PLAYERS = 4         # 目標人数（ここまでCPUで補充）
CPU_CORRECT_PROB = 0.40    # CPUの正解確率
CPU_MIN_DELAY = 4.0        # 回答遅延（秒） 最小
CPU_MAX_DELAY = 8.0        # 回答遅延（秒） 最大
MM_GRACE_SEC = 10.0          # ← ここを追加：待機者が揃わなくてもこの秒数で切り上げ
AUTO_START_ON_FIRST_HUMAN = False# ← ここを追加：最初の人が入ったら自動開始
# ==== 自動開始（4人そろったらカウントダウンして開始） ====
READY_HUMANS = 4                 # 人間がこの人数に到達したら
PRESTART_COUNTDOWN_SEC = 5       # 5,4,3,2,1 の秒数
ANSWER_OPEN_DELAY_SEC = 0.8

# ==== 追加（スコア＆制限時間） ====
QUESTION_TIME_LIMIT_SEC = 12.0       # 1問の制限時間（秒）
FIRST_CORRECT_POINTS    = 2          # 先着正解
LATER_CORRECT_POINTS    = 1          # 2人目以降の正解
WRONG_POINTS            = 0          # 誤答

HEAD_START_STAMP_KEYS = {
    "marmot.png",
    "tanuki.png",
    "kitsune.png",
}

from typing import Any

PUBLIC_FACILITY_CSV = "data/170003_public_facility.csv"  # ここに実ファイルパスを設定
# ===================== 質問バンク =====================
print(PUBLIC_FACILITY_CSV)
import csv, os, io 

@dataclass
class Question:
    qid: str
    stem: str
    choices: List[str]
    correct_idx: int
    hint: Optional[str] = None   # ★ 追加
    
class QuestionBank:
    """
    170003_public_facility.csv を優先して読み込み、
    公共施設・公園から4択問題を生成する。
      - 主タスク: 『名称』の所在地（市町）当て
      - サブタスク: 『名称』の種別/分類 当て（データにある場合）
    フィールド名の揺れに強く、なければフォールバック問題を返す。
    """
    def __init__(self):
        self.rows: List[dict] = []
        self._load_csv()

        # 都市名・種別の全集合（選択肢作成用）
        self.city_set: List[str] = sorted(list({r["city"] for r in self.rows if r.get("city")}))
        self.kind_set: List[str] = sorted(list({r["kind"] for r in self.rows if r.get("kind")}))

        # フォールバック
        self._fallback = [
            Question("F1","金沢市にある有名な庭園はどれ？",["兼六園","後楽園","偕楽園","万博記念公園"],0),
            Question("F2","石川県で最も人口が多い市は？",["金沢市","白山市","小松市","七尾市"],0),
            Question("F3","能登半島の先端に近い町は？",["珠洲市","加賀市","野々市市","内灘町"],0),
        ]

    # ------- CSV 読込 -------
    def _load_csv(self):
        path = PUBLIC_FACILITY_CSV
        if not os.path.exists(path):
            # 既存ローダ（data_csv）にフォールバック
            try:
                from data_csv import _load_main_csv  # type: ignore
                for r in _load_main_csv():
                    self._append_normalized(r)
                return
            except Exception:
                return

        # ---- ここから：エンコード＆区切り自動判定で読む ----
        enc_candidates = ["utf-8-sig", "cp932", "utf-16", "utf-8", "latin1"]
        last_err = None
        for enc in enc_candidates:
            try:
                with open(path, "r", encoding=enc, newline="") as f:
                    # 先頭サンプルで区切り推定
                    sample = f.read(4096)
                    f.seek(0)
                    try:
                        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
                    except csv.Error:
                        dialect = csv.excel  # カンマ前提

                    reader = csv.DictReader(f, dialect=dialect)
                    for r in reader:
                        self._append_normalized(r)
                # 1件でも読めたら成功
                if self.rows:
                    return
            except UnicodeDecodeError as e:
                last_err = e
                continue
            except Exception:
                # ほかのエラーは次の候補へ
                continue

        # どうしてもダメなら「無理やり読み」（文字化けはあり得る）
        try:
            with open(path, "r", encoding="utf-8", errors="ignore", newline="") as f:
                sample = f.read(4096); f.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
                except csv.Error:
                    dialect = csv.excel
                reader = csv.DictReader(f, dialect=dialect)
                for r in reader:
                    self._append_normalized(r)
        except Exception:
            # 最終フォールバックは何もしない（fallback問題を使う）
            return

    def _pick_city(self, r: dict) -> str:
        """市区町村名をレコードから頑健に抽出（県名は除外）"""
        # 最優先：所在地_市区町村 / 市区町村 / 市町村 / 市町名
        keys_pref = ["所在地_市区町村", "市区町村", "市町村", "市町名", "所在地_市町村名"]
        for k in keys_pref:
            v = (r.get(k) or "").strip()
            if v:
                return v

        # 予備1：所在地_連結表記 から抽出（スペース区切りの中から「◯◯市/区/町/村」を探す）
        s = (r.get("所在地_連結表記") or "").strip()
        if s:
            for token in s.replace("　", " ").split():
                if token.endswith(("市", "区", "町", "村")):
                    return token

        # 予備2：地方公共団体名（県名などは除外）
        v = (r.get("地方公共団体名") or "").strip()
        if v.endswith(("市", "区", "町", "村")):
            return v

        return ""


    def _append_normalized(self, r: dict):
        # 名称
        name = (r.get("名称") or r.get("name") or r.get("名称_通称") or r.get("名称_英字") or "").strip()
        # ★ 修正：市区町村の抽出を専用ヘルパーで
        city = self._pick_city(r)

        # 種別/分類（あれば使う）
        kind = (
            r.get("分類") or r.get("種別") or r.get("用途") or
            r.get("大分類") or r.get("中分類") or ""
        ).strip()

        if not name or not city:
            return

        # 公園/公共施設のざっくりラベル（名称や種別に「公園」が含まれれば公園）
        norm = (kind or name)
        label = "公園" if ("公園" in norm) else "公共施設"
        self.rows.append({"name": name, "city": city, "kind": (kind or label)})


    # ------- 出題生成 -------
    def sample(self) -> Question:
        # 25%の確率でユーザー作問から出題
        if random.random() < 0.5:
            uq = self._sample_user_question()
            if uq:
                return uq
        # 既存のCSV問題
        if len(self.rows) >= 8 and len(self.city_set) >= 4:
            if random.random() < 0.5:
                return self._make_city_question()
            else:
                kq = self._make_kind_question()
                return kq or self._make_city_question()
        q = random.choice(self._fallback)
        return Question(q.qid + "_" + secrets.token_hex(2), q.stem, q.choices[:], q.correct_idx)

    def _make_city_question(self) -> Question:
        row = random.choice(self.rows)
        name, city = row["name"], row["city"]

        # ほかの市からダミー3つ
        others = [c for c in self.city_set if c != city]
        random.shuffle(others)
        distract = others[:3]
        choices = distract + [city]
        random.shuffle(choices)
        return Question(
            qid="C" + secrets.token_hex(3).upper(),
            stem=f"「{name}」がある市町はどれ？",
            choices=choices,
            correct_idx=choices.index(city),
        )

    def _make_kind_question(self) -> Optional[Question]:
        # 種別情報が弱い場合は None
        good = [r for r in self.rows if r.get("kind")]
        if len(good) < 4:
            return None
        row = random.choice(good)
        name, kind = row["name"], row["kind"]

        # ほかの種別からダミー3つ
        kinds = list({r["kind"] for r in good if r["kind"] != kind})
        random.shuffle(kinds)
        if len(kinds) < 3:
            return None
        distract = kinds[:3]
        choices = distract + [kind]
        random.shuffle(choices)
        return Question(
            qid="K" + secrets.token_hex(3).upper(),
            stem=f"「{name}」の種別（分類）はどれ？",
            choices=choices,
            correct_idx=choices.index(kind),
        )

    def _sample_user_question(self) -> Optional[Question]:
        try:
            with Session(engine) as s:
                qs = s.query(UserQuestion).all()
                if not qs:
                    return None
                q = random.choice(qs)
                return Question(
                    qid=f"U{q.id}",
                    stem=q.stem,
                    choices=[q.choice1, q.choice2, q.choice3, q.choice4],
                    correct_idx=q.correct_idx,
                    hint=(q.hint or None),    # ★ ヒント付き                    
                )
        except Exception:
            return None
QBANK = QuestionBank()


# ===================== マッチング & ルーム =====================
def _resolve_stamp_dir() -> str:
    here = Path(__file__).resolve().parent                # quiz.py の場所
    cands = [
        here / "static" / "stamp",
        here.parent / "static" / "stamp",
        Path.cwd() / "static" / "stamp",
    ]
    for p in cands:
        if p.is_dir():
            return str(p.resolve())
    # どこにも無ければ一番有力な候補を返す（作成はしない）
    return str((here.parent / "static" / "stamp").resolve())

STAMP_DIR = _resolve_stamp_dir()
STAMP_ALLOW_EXTS = {".png", ".webp", ".gif"}  # 論理的には小文字で比較

print("[quiz] STAMP_DIR =", STAMP_DIR)  # 一度ログで出して確認

def get_allowed_stamp_keys(user_id: int | None) -> set[str]:
    """
    クイズでこのユーザーが使用可能なスタンプの「ファイル名集合」を返す。

    - いつでも使える最初の3つ (HEAD_START_STAMP_KEYS)
    - ＋ UserCharacter で所有している Character.sprite_path の basename
    """
    allowed: set[str] = set(HEAD_START_STAMP_KEYS)

    # ユーザーIDが無い（未ログイン or ゲスト）場合は初期3つだけ
    if not user_id:
        return allowed

    try:
        with Session(engine) as session:
            rows = session.exec(
                select(Character.sprite_path)
                .join(UserCharacter, UserCharacter.character_id == Character.id)
                .where(UserCharacter.user_id == user_id)
            ).all()

            for row in rows:
                # row が ('/static/stamp/marmot.png',) みたいなタプルの場合もケア
                sprite_path = row[0] if isinstance(row, (tuple, list)) else row
                if not sprite_path:
                    continue
                key = os.path.basename(str(sprite_path))
                allowed.add(key)
    except Exception as e:
        print("[quiz] get_allowed_stamp_keys error:", repr(e))

    return allowed

def _make_code(n: int = 6) -> str:
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(n))

@dataclass
class PlayerConn:
    user_id: int
    name: str
    ws: Optional[WebSocket] = None
    is_bot: bool = False

@dataclass
class Room:
    code: str
    players: Dict[int, PlayerConn] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    round_max: int = 5
    round_no: int = 0
    scores: Dict[int, int] = field(default_factory=dict)
    current_q: Optional[Question] = None
    answered: set = field(default_factory=set)
    running: bool = False
    prestart_task: Optional[asyncio.Task] = None
    is_prestarting: bool = False
        
    round_timer_task: Optional[asyncio.Task] = None  # このラウンドの締切タスク
    deadline_ts: float = 0.0                         # 締切の epoch 秒
    first_correct_user: Optional[int] = None         # 先着正解を取った user_id
    
    # 追加: この時刻より前の回答は無視する（ラウンドごとに更新）
    answer_open_ts: float = 0.0
    
    host_id: Optional[int] = None         # フレンドマッチのホスト
    is_random: bool = False               # ランダムマッチ部屋なら True

    last_stamp_ts: Dict[int, float] = field(default_factory=dict)    # 直近送信時刻
    stamp_count_round: Dict[int, int] = field(default_factory=dict)  # 今ラウンドの送信回数
    
    async def start_with_countdown(self, seconds: int = PRESTART_COUNTDOWN_SEC):
        async with self.lock:
            if self.running:
                return
            # すでにプレスタート中ならリセット
            self.is_prestarting = True
            if self.prestart_task and not self.prestart_task.done():
                self.prestart_task.cancel()
            # クライアントに「5,4,3,2,1」を出す
            await self.broadcast({"type": "prestart", "seconds": seconds})
            # 5秒後に本開始
            async def _go():
                try:
                    await asyncio.sleep(seconds)
                    async with self.lock:
                        if not self.is_prestarting or self.running:
                            return
                        self.is_prestarting = False
                    await self.start_game()
                except asyncio.CancelledError:
                    return
            self.prestart_task = asyncio.create_task(_go())
    async def broadcast(self, payload: dict):
        dead = []
        for uid, pc in list(self.players.items()):
            if pc.ws and pc.ws.client_state == WebSocketState.CONNECTED:
                try:
                    await pc.ws.send_json(payload)
                except Exception:
                    dead.append(uid)
        for uid in dead:
            self.players.pop(uid, None)

    def member_list(self):
        return [{"id": uid, "name": pc.name, "score": self.scores.get(uid,0)} for uid, pc in self.players.items()]

    def _human_ids(self) -> list[int]:
        """CPUを除いた人間プレイヤーのID一覧"""
        return [uid for uid, pc in self.players.items() if not getattr(pc, "is_bot", False)]

    def can_start(self, by_user_id: int) -> bool:
        # ランダムは自動開始（手動開始禁止）、フレンドはホストのみ
        if self.is_random:
            return False
        return (self.host_id is not None and by_user_id == self.host_id
                and not self.running and not self.is_prestarting)

    async def join(self, conn: PlayerConn):
        async with self.lock:
            self.players[conn.user_id] = conn
            self.scores.setdefault(conn.user_id, 0)
            # ホスト未設定かつ人間ならホストに
            if not conn.is_bot and self.host_id is None:
                self.host_id = conn.user_id
            await self.broadcast({
                "type":"system","event":"join","user_id":conn.user_id,"name":conn.name,
                "members":self.member_list(),"host_id": self.host_id, "is_random": self.is_random
            })
        await self._maybe_auto_prestart()
        
    async def leave(self, user_id: int):
        async with self.lock:
            if user_id in self.players:
                name = self.players[user_id].name
                self.players.pop(user_id, None)
                if self.host_id == user_id:
                    humans = [uid for uid, pc in self.players.items() if not pc.is_bot]
                    self.host_id = humans[0] if humans else None
                await self.broadcast({
                    "type":"system","event":"leave","user_id":user_id,"name":name,
                    "members":self.member_list(),"host_id": self.host_id, "is_random": self.is_random
                })
        await self._maybe_auto_prestart()

        
    # ---- CPU補充 ----
    def _need_cpu_count(self) -> int:
        human = sum(1 for p in self.players.values() if not p.is_bot)
        return max(0, NEEDED_PLAYERS - human)

    async def _spawn_bots(self, n: int):
        for i in range(n):
            # 安定的な負ID（被らなければOK）
            uid = -random.randint(100000, 999999)
            name = f"CPU-{str(uid)[-4:]}"
            self.players[uid] = PlayerConn(user_id=uid, name=name, ws=None, is_bot=True)
            self.scores.setdefault(uid, 0)
        await self.broadcast({"type":"system","event":"join","user_id":-1,"name":"CPU-Group","members":self.member_list()})

    async def start_game(self):
        async with self.lock:
            self.is_prestarting = False
            if self.prestart_task and not self.prestart_task.done():
                self.prestart_task.cancel()
            if self.running:
                return
            # 必要人数までCPUで補充
            need = self._need_cpu_count()
            if need > 0:
                # ロック外のawaitを避けるため、後で呼ぶ
                pass_needed = need
            else:
                pass_needed = 0

        if pass_needed:
            await self._spawn_bots(pass_needed)

        async with self.lock:
            if len(self.players) < 1:
                return
            self.running = True
            self.round_no = 0
            for uid in list(self.players.keys()):
                self.scores[uid] = 0
        await self.broadcast({"type":"game","event":"started","round_max":self.round_max,"members":self.member_list()})
        await self.next_round()

    async def next_round(self):
        # ★既存ロジック先頭そのまま
        async with self.lock:
            # 既存: ラウンド終了→_finish
            if self.round_no >= self.round_max:
                await self._finish()
                return

            if self.running and self.current_q and self.round_timer_task and not self.round_timer_task.done():
                # すでに同じ round_no の問題が動作中なら return
                return

            # 既存: ラウンド番号＋問題生成
            self.round_no += 1
            self.current_q = QBANK.sample()
            self.answered = set()
            self.first_correct_user = None

            self.stamp_count_round.clear()
            # 既存: 問題ブロードキャスト用ペイロード
            q = self.current_q
            banner = {"type": "round_banner", "round_no": self.round_no}
            payload = {
                "type": "q",
                "round_no": self.round_no,
                "round_max": self.round_max,
                "qid": q.qid,
                "stem": q.stem,
                "choices": q.choices,
                "hint": q.hint or "",   # ★ 追加：ヒントを送る（空文字も可）                
            }

            # ★追加：前ラウンドの締切タスクをキャンセル
            if self.round_timer_task and not self.round_timer_task.done():
                self.round_timer_task.cancel()
            # ★追加：新しい締切を設定
            self.deadline_ts = asyncio.get_event_loop().time() + QUESTION_TIME_LIMIT_SEC
            self.answer_open_ts = asyncio.get_event_loop().time() + ANSWER_OPEN_DELAY_SEC
            # ★追加：締切監視タスクを起動
            self.round_timer_task = asyncio.create_task(self._deadline_watch(q.qid, self.deadline_ts))

        # 既存: 問題を全員へ送信
        await self.broadcast(banner)
        await self.broadcast(payload)
        # 既存: CPU の遅延回答スケジュール
        await self._schedule_cpu_answers()

    async def _deadline_watch(self, qid: str, deadline_ts: float):
        """制限時間になったら強制的に正解公開→次問へ"""
        try:
            now = asyncio.get_event_loop().time()
            remain = max(0.0, deadline_ts - now)
            await asyncio.sleep(remain)
            async with self.lock:
                # すでに別問に移っている / 期限が更新されている場合は何もしない
                if not self.current_q or self.current_q.qid != qid or self.deadline_ts != deadline_ts:
                    return
                # ★ ここで「このラウンドのタイマーは終わった」とマークする
                self.round_timer_task = None

                # ここで締切、正解を公開
                reveal = {"type": "reveal", "qid": qid, "correct_idx": self.current_q.correct_idx}
            await self.broadcast(reveal)
            await asyncio.sleep(2.0)
            await self.next_round()
        except asyncio.CancelledError:
            # ラウンド中に全員回答などでキャンセルされた場合
            return


    async def _schedule_cpu_answers(self):
        # 現在のプレイヤーからCPUだけ抽出
        cpu_ids = [uid for uid, pc in self.players.items() if pc.is_bot]
        q = self.current_q
        if not q or not cpu_ids:
            return
        for uid in cpu_ids:
            delay = random.uniform(CPU_MIN_DELAY, CPU_MAX_DELAY)
            asyncio.create_task(self._cpu_answer_after(uid, q.qid, delay))

    async def _cpu_answer_after(self, cpu_uid: int, qid: str, delay: float):
        await asyncio.sleep(delay)
        async with self.lock:
            # まだ同じ問題中？
            if not self.current_q or self.current_q.qid != qid:
                return
            if cpu_uid in self.answered:
                return
            # 答えを選ぶ
            if random.random() < CPU_CORRECT_PROB:
                idx = self.current_q.correct_idx
            else:
                wrongs = [i for i in range(len(self.current_q.choices)) if i != self.current_q.correct_idx]
                idx = random.choice(wrongs) if wrongs else self.current_q.correct_idx

        # ロック外で通常ルートと同じ処理へ
        await self.receive_answer(cpu_uid, qid, idx)

    async def receive_answer(self, user_id: int, qid: str, idx: int):
        async with self.lock:
            # 問題が違う / 未設定
            if not self.current_q or self.current_q.qid != qid:
                return None
            if asyncio.get_event_loop().time() < self.answer_open_ts:
                 return None
            # 締切超過は無効
            if asyncio.get_event_loop().time() > self.deadline_ts:
                return None
            # 二重回答は無視
            if user_id in self.answered:
                return None

            self.answered.add(user_id)

            correct = int(idx) == int(self.current_q.correct_idx)
            # ★先着加点：first_correct_user が未設定で、今回が正解なら 2点
            if correct:
                if self.first_correct_user is None:
                    self.first_correct_user = user_id
                    gain = FIRST_CORRECT_POINTS
                else:
                    gain = LATER_CORRECT_POINTS
            else:
                gain = WRONG_POINTS

            if gain:
                self.scores[user_id] = self.scores.get(user_id, 0) + gain

            # 返す（スコアボード更新用に members を同梱）
            result = {
                "type": "answer_result",
                "user_id": user_id,
                "name": self.players[user_id].name if user_id in self.players else f"User{user_id}",
                "qid": qid,
                "choice_idx": idx,
                "correct": correct,
                "scores": self.member_list(),
                "answered": len(self.answered),
                "total": max(1, len(self.players)),
            }

            # 全員回答したら早期終了：締切タスクをキャンセル→正解公開→次問
            human_ids = set(self._human_ids())
            human_answered = len(human_ids & set(self.answered))
            everyone = (len(human_ids) > 0) and (human_answered >= len(human_ids))
            if everyone:
                # ★締切タスクを止める
                if self.round_timer_task and not self.round_timer_task.done():
                    self.round_timer_task.cancel()
                reveal = {"type": "reveal", "qid": qid, "correct_idx": self.current_q.correct_idx}
            else:
                reveal = None

        await self.broadcast(result)

        if reveal:
            await self.broadcast(reveal)
            await asyncio.sleep(2.0)
            asyncio.create_task(self.next_round())

        return True


    async def _finish(self):
        if self.prestart_task and not self.prestart_task.done():
            self.prestart_task.cancel()
        self.is_prestarting = False
        
        if self.round_timer_task and not self.round_timer_task.done():
            self.round_timer_task.cancel()        
        self.running = False
        ranking = sorted(self.scores.items(), key=lambda kv: (-kv[1], kv[0]))
        await self.broadcast({"type":"game","event":"finished","ranking":[
            {"id":uid,"name": self.players[uid].name if uid in self.players else f"User{uid}","score":sc}
            for uid, sc in ranking
        ]})

    async def _maybe_auto_prestart(self):
        """人間が READY_HUMANS に達したらカウントダウンを開始／割れたら中止"""
        async with self.lock:
            if self.running:
                return
            humans = len(self._human_ids())
            # 条件満たす & 未開始なら → prestart
            if humans >= READY_HUMANS and not self.is_prestarting:
                self.is_prestarting = True
                # 既存のタスクがあれば念のためキャンセル
                if self.prestart_task and not self.prestart_task.done():
                    self.prestart_task.cancel()
                # クライアントにカウントダウン開始を通知
                await self.broadcast({"type": "prestart", "seconds": PRESTART_COUNTDOWN_SEC})
                # カウントダウン終了で start_game
                self.prestart_task = asyncio.create_task(self._prestart_countdown_start())
                return

            # 条件割れ & カウントダウン中なら → 中止
            if humans < READY_HUMANS and self.is_prestarting:
                self.is_prestarting = False
                if self.prestart_task and not self.prestart_task.done():
                    self.prestart_task.cancel()
                # 中止通知（必要なら）
                await self.broadcast({"type": "prestart_cancel"})
                return

    async def _prestart_countdown_start(self):
        try:
            await asyncio.sleep(PRESTART_COUNTDOWN_SEC)
            async with self.lock:
                # 直前に条件が崩れていないか確認
                if not self.is_prestarting or len(self._human_ids()) < READY_HUMANS or self.running:
                    return
            # 実開始（CPU補充は start_game 内で実行）
            await self.start_game()
        except asyncio.CancelledError:
            return

class RoomManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self.lock = asyncio.Lock()
    async def create_room(self, *, is_random: bool = False) -> Room:
        async with self.lock:
            for _ in range(8):
                code = _make_code()
                if code not in self.rooms:
                    room = Room(code=code, is_random=is_random)
                    self.rooms[code] = room
                    return room
            raise RuntimeError("room code allocation failed")
    def get(self, code: str) -> Optional[Room]:
        return self.rooms.get(code)
    async def ensure(self, code: str) -> Room:
        async with self.lock:
            if code in self.rooms:
                return self.rooms[code]
            room = Room(code=code)
            self.rooms[code] = room
            return room

ROOMS = RoomManager()


class MatchQueue:
    def __init__(self, need: int = NEEDED_PLAYERS):
        self.need = need
        self.waiting: List[Tuple[int, str]] = []
        self.matched: Dict[int, str] = {}
        self.cv = asyncio.Condition()
        self._loop_task: Optional[asyncio.Task] = None

    async def join(self, user_id: int, name: str):
        async with self.cv:
            if user_id in self.matched:
                return
            if user_id not in [uid for uid, _ in self.waiting]:
                self.waiting.append((user_id, name))
            self.cv.notify_all()

    async def cancel(self, user_id: int):
        async with self.cv:
            self.waiting = [(uid, nm) for uid, nm in self.waiting if uid != user_id]
            self.cv.notify_all()

    async def poll(self, user_id: int) -> Optional[str]:
        return self.matched.get(user_id)

    def clear_for(self, user_id: int):
        """このユーザーの既存マッチ結果を消して、次回は新規マッチにする"""
        self.matched.pop(user_id, None)
        
    async def run_matchmaker(self):
        while True:
            async with self.cv:
                # まずは規定人数を待つ。ダメならグレースタイムで切り上げ
                try:
                    await asyncio.wait_for(self.cv.wait_for(lambda: len(self.waiting) >= self.need), timeout=MM_GRACE_SEC)
                    # ここに来たら self.need 人揃った
                    group = self.waiting[: self.need]
                    self.waiting = self.waiting[self.need :]
                except asyncio.TimeoutError:
                    # タイムアウト：待機者がいればその人数で開始（1〜need-1）
                    if len(self.waiting) >= 1:
                        take = min(self.need, len(self.waiting))
                        group = self.waiting[: take]
                        self.waiting = self.waiting[take :]
                    else:
                        # 誰もいないので次ループ
                        continue

            # ルーム作成し、全員にコードを割当
            room = await ROOMS.create_room(is_random=True)
            for uid, _name in group:
                self.matched[uid] = room.code

    def ensure_started(self):
        if not self._loop_task or self._loop_task.done():
            self._loop_task = asyncio.create_task(self.run_matchmaker())

MATCH = MatchQueue(need=4)
MATCH.ensure_started()

# ===================== 画面ルーティング =====================

@router.get("/quiz/random", response_class=HTMLResponse)
async def quiz_random(request: Request, user=Depends(get_current_user)):
    login_required(user, allow_guest=True)
    return templates.TemplateResponse("quiz.html", {"request": request, "mode": "random-wait", "code": "", "user": user})

@router.get("/quiz/room/new", response_class=HTMLResponse)
async def quiz_room_new(request: Request, user=Depends(get_current_user)):
    login_required(user, allow_guest=True)
    room = await ROOMS.create_room()
    return templates.TemplateResponse("quiz.html", {"request": request, "mode": "room-created", "code": room.code, "user": user})

@router.get("/quiz/room/join", response_class=HTMLResponse)
async def quiz_room_join(request: Request, user=Depends(get_current_user)):
    login_required(user, allow_guest=True)
    return templates.TemplateResponse("quiz.html", {"request": request, "mode": "room-join", "code": "", "user": user})

@router.get("/quiz", response_class=HTMLResponse)
async def quiz_play(request: Request, code: str, user=Depends(get_current_user)):
    login_required(user, allow_guest=True)
    MATCH.clear_for(user.id)
    room = await ROOMS.ensure(code)  
    return templates.TemplateResponse("quiz.html", {
        "request": request,
        "mode": "play",
        "code": code,
        "user": user,
        "is_random": getattr(room, "is_random", False)
    })

# ===================== マッチメイクAPI =====================

@router.post("/api/matchmaking/join")
async def api_mm_join(request: Request, user=Depends(get_current_user)):
    login_required(user, allow_guest=True)
    MATCH.clear_for(user.id)

    dn = getattr(user, "display_name", None)
    email = getattr(user, "email", None)
    is_guest = bool(getattr(user, "is_guest", False))

    if dn:
        name = dn
    elif email and not is_guest:
        # 本登録だが display_name が空の場合だけメールを使う
        name = email
    else:
        # ゲストは Guest1234 形式
        name = f"Guest{abs(user.id) % 10000:04d}"

    await MATCH.join(user.id, name)
    return {"ok": True}


@router.post("/api/matchmaking/cancel")
async def api_mm_cancel(request: Request, user=Depends(get_current_user)):
    login_required(user, allow_guest=True)
    await MATCH.cancel(user.id)
    return {"ok": True}

@router.get("/api/matchmaking/poll")
async def api_mm_poll(request: Request, user=Depends(get_current_user)):
    login_required(user, allow_guest=True)
    code = await MATCH.poll(user.id)
    return {"ok": True, "code": code}

# 置き換え（衝突回避）
# API の実装を置き換え（大小拡張子・安全列挙）
@router.get("/api/quiz/stamps")
async def api_quiz_stamps(request: Request):
    try:
        user = get_current_user(request)  # auth.py のやつ
        user_id = getattr(user, "id", None)

        # そのユーザーが使えるスタンプのファイル名集合
        allowed = get_allowed_stamp_keys(user_id)

        names: list[str] = []
        with os.scandir(STAMP_DIR) as it:
            for e in it:
                if not e.is_file():
                    continue
                base = e.name
                ext = os.path.splitext(base)[1].lower()
                # 「拡張子OK」かつ「allowed に含まれるものだけ」をリストアップ
                if ext in STAMP_ALLOW_EXTS and base in allowed:
                    names.append(base)

        names.sort()
        return {"ok": True, "stamps": names}
    except Exception as e:
        return {"ok": False, "stamps": [], "error": str(e)}

@router.get("/quiz/maker", response_class=HTMLResponse)
async def quiz_maker_page(request: Request, user=Depends(get_current_user)):
    login_required(user, allow_guest=False)
    return templates.TemplateResponse("quiz_maker.html", {"request": request, "user": user})

# ===================== WebSocket =====================

@router.websocket("/ws/quiz/{code}")
async def ws_quiz(websocket: WebSocket, code: str):
    await websocket.accept()

    user_id = None
    name = None
    room = await ROOMS.ensure(code)

    try:
        hello = await websocket.receive_json()
        if not (isinstance(hello, dict) and hello.get("type") == "hello"):
            await websocket.send_json({"type": "error", "msg": "invalid hello"})
            await websocket.close()
            return
        user_id = int(hello.get("user_id"))
        name = str(hello.get("name") or f"User{user_id}")

        MATCH.clear_for(user_id)
        
        conn = PlayerConn(user_id=user_id, name=name, ws=websocket)
        await room.join(conn)

        if room.is_random and not room.running:
            human_count = sum(1 for p in room.players.values() if not p.is_bot)
            if human_count >= 1:
                # PRESTART_COUNTDOWN_SEC(=5) を使う。別秒数にしたいなら引数で変更可能
                asyncio.create_task(room.start_with_countdown(PRESTART_COUNTDOWN_SEC))

                # 参加直後：自動開始（ヒューマンが最初に入ったら）
        if AUTO_START_ON_FIRST_HUMAN:
            try:
                # 人間プレイヤーが1人以上で、まだゲームが走ってなければ開始
                if not room.running:
                    # “人間がいるか” を簡易判定（負IDはCPU想定）
                    human_count = sum(1 for p in room.players.values() if not getattr(p, "is_bot", False))
                    if human_count >= 1:
                        asyncio.create_task(room.start_game())
            except Exception:
                pass

        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            t = data.get("type")

            if t == "start":

                if room.can_start(user_id):
                    await room.start_with_countdown(PRESTART_COUNTDOWN_SEC)
                else:
                    await room.broadcast({"type":"error","msg":"開始できるのはホストのみです。"})                
            elif t == "answer":
                qid = str(data.get("qid") or "")
                idx = int(data.get("choice_idx"))
                await room.receive_answer(user_id, qid, idx)

            elif t == "chat":
                msg = str(data.get("msg", "")).strip()[:200]
                if msg:
                    await room.broadcast({"type": "chat", "user_id": user_id, "name": name, "msg": msg})

            elif t == "buzz":
                await room.broadcast({"type": "buzz", "user_id": user_id, "name": name})
# WebSocket ハンドラ内の message 分岐に「stamp」を追加
            elif t == "stamp":
                key = str(data.get("key") or "").strip()
                base = os.path.basename(key)
                ext = os.path.splitext(base)[1].lower()

                # ★ このユーザーが使えるスタンプかチェック
                allowed_keys = get_allowed_stamp_keys(user_id)
                if base not in allowed_keys:
                    await room.broadcast({
                        "type": "error",
                        "msg": "そのスタンプはまだ使えません。"
                    })
                    continue

                # バリデーション：拡張子と実在チェック（ベース名のみ許可）
                if ext not in STAMP_ALLOW_EXTS:
                    await room.broadcast({"type": "error", "msg": "不正なスタンプです。"})
                    continue
                full = os.path.join(STAMP_DIR, base)
                if not os.path.exists(full):
                    await room.broadcast({"type": "error", "msg": "スタンプが見つかりません。"})
                    continue


                now = time.time()
                async with room.lock:
                    # クールダウン
                    last = room.last_stamp_ts.get(user_id, 0.0)
                    if now - last < STAMP_COOLDOWN_SEC:
                        # 速すぎる → 無視（エラー返さずスルーでもOK）
                        continue
                    # ラウンド上限
                    cnt = room.stamp_count_round.get(user_id, 0)
                    if cnt >= STAMP_MAX_PER_ROUND:
                        continue

                    room.last_stamp_ts[user_id] = now
                    room.stamp_count_round[user_id] = cnt + 1

                # 全員にブロードキャスト
                await room.broadcast({
                    "type": "stamp",
                    "user_id": user_id,
                    "name": name,
                    "key": base,   # クライアントは /static/stamp/{key} で取得
                })

            else:
                pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "msg": f"{e.__class__.__name__}: {e}"})
        except Exception:
            pass
    finally:
        if user_id is not None:
            await room.leave(user_id)
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close()
