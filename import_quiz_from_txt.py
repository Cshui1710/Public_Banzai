# import_quiz_from_txt.py
import sys
import re
from pathlib import Path
from typing import List, Dict
from datetime import datetime

from sqlmodel import Session, select
from models import engine, UserQuestion


# ===== 1) テキストファイルパース =====



# 選択肢: "1) ...", "1. ...", "1．...", "1: ...", "1：..." など
CHOICE_RE = re.compile(r"^\s*([1-4])\s*[\)\.\．、:：]\s*(.+?)\s*$")

# 正解行: "答え：4" / "正解：4" / "正解：4. 泣き砂の浜" / "正解: 1. 1台**" など
ANSWER_ANY_RE = re.compile(
    r"^\s*(答え|正解)\s*[:：]\s*([1-4])(?:\s*[\)\.\．、:：]\s*.*)?\s*$"
)

def parse_quiz_txt(path: Path) -> List[Dict]:
    text = path.read_text(encoding="utf-8")
    lines = [ln.rstrip("\n") for ln in text.splitlines()]
    lines.append("")

    results: List[Dict] = []
    cur: Dict = {}
    choices_map: Dict[int, str] = {}

    def flush_current():
        nonlocal cur, choices_map
        if not cur:
            choices_map = {}
            return

        if choices_map:
            cur["choices"] = [choices_map.get(i, "").strip() for i in (1, 2, 3, 4)]

        results.append(cur)
        cur = {}
        choices_map = {}

    for raw in lines:
        line = raw.strip()

        # 空行で区切り
        if not line:
            # ★ 正解行をまだ読んでない空行は「ただの見やすさ用改行」とみなして無視
            if cur and ("answer" not in cur):
                continue
            flush_current()
            continue

        # 見出しの全角/半角ゆれ対応
        if line.startswith("問題：") or line.startswith("問題:"):
            cur["stem"] = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            continue

        if line.startswith("ヒント：") or line.startswith("ヒント:"):
            cur["hint"] = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            continue

        # 正解/答え行（番号＋本文でも番号だけでもOK）
        m_ans = ANSWER_ANY_RE.match(line.replace("**", "").strip())
        if m_ans:
            cur["answer"] = int(m_ans.group(2))
            continue

        # 選択肢行
        m_choice = CHOICE_RE.match(line)
        if m_choice:
            idx = int(m_choice.group(1))
            txt = m_choice.group(2).strip()
            # 末尾装飾を軽く除去（必要なら増やせる）
            txt = txt.rstrip("*").strip()
            choices_map[idx] = txt
            continue

        # それ以外の行は、問題文の続きとして結合（長文・改行対策）
        if "stem" in cur and cur["stem"]:
            cur["stem"] += " " + line
        else:
            cur["stem"] = line

    return results



# ===== 2) 重複チェック用キー =====

def build_key(stem: str, choices: List[str], correct_idx: int):
    return (
        stem.strip(),
        choices[0].strip(),
        choices[1].strip(),
        choices[2].strip(),
        choices[3].strip(),
        correct_idx,
    )


# ===== 3) DB に追加 =====

def insert_questions_to_db(quiz_data: List[Dict], default_user_id: int = 1):
    if not quiz_data:
        print("インポート対象が 0 件のため終了します。")
        return

    with Session(engine) as session:
        existing = session.exec(select(UserQuestion)).all()
        existing_keys = {
            build_key(q.stem, [q.choice1, q.choice2, q.choice3, q.choice4], q.correct_idx)
            for q in existing
        }

        print(f"既存問題: {len(existing_keys)} 件")

        inserted = 0
        skipped = 0
        now_str = datetime.now().isoformat(timespec="seconds")

        for q in quiz_data:
            stem = (q.get("stem") or "").strip()
            hint = (q.get("hint") or None)
            choices = q.get("choices") or []
            answer = q.get("answer")

            if not stem:
                print("⚠ stem が空のためスキップ")
                skipped += 1
                continue

            if len(choices) != 4 or any(not c.strip() for c in choices):
                print(f"⚠ 選択肢が4つ揃っていないためスキップ: {stem[:40]}")
                skipped += 1
                continue

            if not isinstance(answer, int) or not (1 <= answer <= 4):
                print(f"⚠ 答え番号が1〜4ではないためスキップ: {stem[:40]}")
                skipped += 1
                continue

            correct_idx = answer - 1
            key = build_key(stem, choices, correct_idx)

            if key in existing_keys:
                print(f"⏭ 重複のためスキップ: {stem[:40]}")
                skipped += 1
                continue

            uq = UserQuestion(
                user_id=default_user_id,
                stem=stem,
                choice1=choices[0].strip(),
                choice2=choices[1].strip(),
                choice3=choices[2].strip(),
                choice4=choices[3].strip(),
                correct_idx=correct_idx,
                created_at=now_str,
                hint=hint,
            )
            session.add(uq)
            existing_keys.add(key)
            inserted += 1

        session.commit()
        print(f"✅ 完了: {inserted} 件追加 / {skipped} 件スキップ")


# ===== 4) メイン =====

def main():
    txt_path = Path("data/mondai.txt")

    if not txt_path.exists():
        print("❌ data/mondai.txt が見つかりません。")
        print("カレントディレクトリ:", Path().resolve())
        sys.exit(1)

    default_user_id = int(sys.argv[1]) if len(sys.argv) >= 2 else 1

    print(f"📂 読み込み: {txt_path}")
    quiz_data = parse_quiz_txt(txt_path)
    print(f"📝 パース: {len(quiz_data)} 問")

    insert_questions_to_db(quiz_data, default_user_id=default_user_id)


if __name__ == "__main__":
    main()
