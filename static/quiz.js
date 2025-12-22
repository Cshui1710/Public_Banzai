/* static/quiz.js */
(() => {
  const mode = window.__PAGE_MODE__ || "";
  const user = window.__USER__ || { id: 0, email: null, is_guest: true };
  const isRandom = window.__IS_RANDOM__ === true || window.__IS_RANDOM__ === "true";
  const IS_CHALLENGE = !!window.__CHALLENGE_LEVEL__;   // ★ チャレンジモード判定
  const j = (sel) => document.querySelector(sel);

  // ★ モバイル判定（ざっくり）
  const IS_MOBILE = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent || "");

  // ★ タイマーの更新間隔（モバイルは少し長めにして軽量化）
  const TIMER_INTERVAL_MS = IS_MOBILE ? 1000 : 400;

  const MY_NAME = (() => {
    if (user.display_name) return user.display_name;              // ニックネーム最優先
    if (user.email && !user.is_guest) return user.email;          // 本登録で display_name 未設定ならメール
    const id = user.id || 0;
    return `Guest${String(Math.abs(id) % 10000).padStart(4, "0")}`;  // ゲスト
  })();

  // ★ここをあなたのファイル名に合わせて変更
  const JUDGE_IMG_CORRECT = "/static/judge/hanamaru.png";   // 正解用 ○
  const JUDGE_IMG_WRONG   = "/static/judge/batsu.png";      // 不正解用 ×

  // ★ 追加：正解／不正解の音声ファイル
  const JUDGE_SE_CORRECT = "/static/bgm/クイズ・正解.mp3";
  const JUDGE_SE_WRONG   = "/static/bgm/クイズ・間違い03.mp3";

  const SE_QUESTION_START = "/static/bgm/クイズ・出題02.mp3";
  const SE_THINKING       = "/static/bgm/クイズ・シンキングタイム.mp3";

  // ★ Audio は 1 回だけ作って再利用
  let thinkingAudio = null;
  let questionStartAudio = null;
  let judgeAudioCorrect = null;
  let judgeAudioWrong = null;

// ===== Audio Unlock（スマホの autoplay 制限対策）=====
  let audioUnlocked = false;

  const JUDGE_SE_VOLUME = 0.6;
  const THINKING_VOLUME = 1.0;
  const START_VOLUME    = 1.0;

  const unlockAudio = async () => {
    if (audioUnlocked) return;
    audioUnlocked = true;

    try {
      // ここで Audio を全部作っておく（後で使い回す）
      if (!questionStartAudio) {
        questionStartAudio = new Audio(SE_QUESTION_START);
        questionStartAudio.volume = START_VOLUME;
        questionStartAudio.preload = "auto";
      }
      if (!thinkingAudio) {
        thinkingAudio = new Audio(SE_THINKING);
        thinkingAudio.volume = THINKING_VOLUME;
        thinkingAudio.loop = true;
        thinkingAudio.preload = "auto";
      }

      // ★追加：正解／不正解SEもここで作る（iOS対策の本命）
      if (!judgeAudioCorrect) {
        judgeAudioCorrect = new Audio(JUDGE_SE_CORRECT);
        judgeAudioCorrect.volume = JUDGE_SE_VOLUME;
        judgeAudioCorrect.preload = "auto";
      }
      if (!judgeAudioWrong) {
        judgeAudioWrong = new Audio(JUDGE_SE_WRONG);
        judgeAudioWrong.volume = JUDGE_SE_VOLUME;
        judgeAudioWrong.preload = "auto";
      }

      // iOS対策：無音(極小音)で一瞬だけ再生→停止して「解禁」する
      // なるべく全Audioを一度ずつ解禁しておく
      const audios = [questionStartAudio, thinkingAudio, judgeAudioCorrect, judgeAudioWrong];

      for (const a of audios) {
        if (!a) continue;
        const prevVol = a.volume;
        try {
          a.volume = 0.001;
          a.currentTime = 0;
          // playが失敗しても次のユーザー操作で再試行できるようにする
          await a.play().catch(() => {});
          a.pause();
          a.currentTime = 0;
        } catch (e) {
          // ignore
        } finally {
          a.volume = prevVol;
        }
      }
    } catch (e) {
      // 失敗しても次のユーザー操作でまた解禁される
      audioUnlocked = false;
    }
  };


  // ページ上の「最初のユーザー操作」で解禁（スマホはこれが重要）
  const bindAudioUnlock = () => {
    const once = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", once);
      window.removeEventListener("touchstart", once);
      window.removeEventListener("click", once);
    };
    window.addEventListener("pointerdown", once, { passive: true });
    window.addEventListener("touchstart", once, { passive: true });
    window.addEventListener("click", once, { passive: true });
  };

  document.addEventListener("DOMContentLoaded", bindAudioUnlock);


  // ========= チュートリアルモーダル（全モード共通） =========
  const TUTORIAL_HIDE_KEY = "ifp_quiz_tutorial_hide";

  const setupTutorial = () => {
    const backdrop   = document.getElementById("tutorialBackdrop");
    const helpBtn    = document.getElementById("helpBtn");
    if (!backdrop) return;  // quiz.html にチュートリアルがない場合は何もしない

    const pages      = Array.from(backdrop.querySelectorAll(".tutorial-page"));
    const prevBtn    = document.getElementById("tutorialPrevBtn");
    const nextBtn    = document.getElementById("tutorialNextBtn");
    const closeBtn   = document.getElementById("tutorialCloseBtn");
    const stepLabel  = document.getElementById("tutorialStepLabel");
    const dontShowCb = document.getElementById("tutorialDontShow");

    if (!pages.length || !prevBtn || !nextBtn || !closeBtn || !stepLabel) return;

    const total = pages.length;
    let currentPage = 1;

    const applyPage = () => {
      pages.forEach((p) => {
        const pageNo = Number(p.dataset.page || "0");
        p.classList.toggle("active", pageNo === currentPage);
      });
      stepLabel.textContent = `${currentPage} / ${total}`;

      prevBtn.disabled = currentPage === 1;
      nextBtn.style.display = currentPage < total ? "inline-block" : "none";
      closeBtn.style.display = currentPage === total ? "inline-block" : "none";
    };

    const openTutorial = (page = 1) => {
      currentPage = Math.min(Math.max(1, page), total);
      applyPage();
      backdrop.style.display = "flex";
    };

    const closeTutorial = () => {
      backdrop.style.display = "none";
      if (dontShowCb && dontShowCb.checked) {
        try {
          localStorage.setItem(TUTORIAL_HIDE_KEY, "true");
        } catch (e) {}
      }
    };

    prevBtn.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage -= 1;
        applyPage();
      }
    });

    nextBtn.addEventListener("click", () => {
      if (currentPage < total) {
        currentPage += 1;
        applyPage();
      }
    });

    closeBtn.addEventListener("click", () => {
      closeTutorial();
    });

    // 背景クリックで閉じる（カード内クリックでは閉じない）
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) {
        closeTutorial();
      }
    });

    // ESCキーでも閉じる
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && backdrop.style.display !== "none") {
        closeTutorial();
      }
    });

    // 🔹「❓ あそびかた」ボタン → いつでも開ける（自動表示フラグは無視）
    if (helpBtn) {
      helpBtn.addEventListener("click", () => {
        openTutorial(1);
      });
    }

    // 🔹 自動表示（初回のみ）※ random-wait のときは自動表示しない
    try {
      const hide = localStorage.getItem(TUTORIAL_HIDE_KEY) === "true";
      if (!hide && mode !== "random-wait") {
        openTutorial(1);
      }
    } catch (e) {
      if (mode !== "random-wait") {
        openTutorial(1);
      }
    }
  };



  document.addEventListener("DOMContentLoaded", setupTutorial);

  // ========= メンバー & スコア =========
  const renderMembers = (members) => {
    const box = j("#members");
    if (!box) return;
    box.innerHTML = "";
    (members || []).forEach((m) => {
      const s = document.createElement("span");
      s.className = "member-pill";
      s.textContent = m.name || `User${m.id}`;
      box.appendChild(s);
    });
    renderScoreboard(members);
  };

  // ========= スコアボード（差分更新版） =========
  const scoreboardCache = new Map(); // userId(or name) -> rowEl

  const keyOfMember = (m) => {
    if (m && m.id != null) return `id:${m.id}`;
    if (m && m.user_id != null) return `id:${m.user_id}`;
    return `name:${m?.name ?? ""}`;
  };

  const renderScoreboard = (members) => {
    const box = j("#scoreboard");
    if (!box) return;

    const list = (members || [])
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // まず必要な順序を確定
    const usedKeys = new Set();

    // DocumentFragmentで一気に並べ替え（レイアウト負荷を減らす）
    const frag = document.createDocumentFragment();

    for (const m of list) {
      const k = keyOfMember(m);
      usedKeys.add(k);

      let row = scoreboardCache.get(k);
      if (!row) {
        row = document.createElement("div");
        row.className = "score-row";
        row.dataset.userId = (m.id ?? m.user_id) != null ? String(m.id ?? m.user_id) : "";
        row.dataset.name = m.name || "";
        row.innerHTML = `
          <span class="score-name"></span>
          <b></b>
        `;
        scoreboardCache.set(k, row);
      }

      // 値だけ更新（DOM再生成しない）
      const nameEl = row.querySelector(".score-name");
      const scoreEl = row.querySelector("b");
      if (nameEl) nameEl.textContent = m.name || `User${m.id ?? m.user_id ?? ""}`;
      if (scoreEl) scoreEl.textContent = String(m.score ?? 0);

      frag.appendChild(row);
    }

    // 使われなくなった行を掃除
    for (const [k, el] of scoreboardCache.entries()) {
      if (!usedKeys.has(k)) {
        scoreboardCache.delete(k);
        try { el.remove(); } catch (e) {}
      }
    }

    // まとめて差し替え
    box.innerHTML = "";
    box.appendChild(frag);
  };


  // ========= 画面中央オーバーレイ =========
  const overlay = () => document.getElementById("overlay");
  const overlayContent = () => document.getElementById("overlayContent");
  const showOverlay = (html) => {
    const o = overlay(), c = overlayContent();
    if (!o || !c) return;
    c.innerHTML = html;
    o.style.display = "grid";
  };
  const hideOverlay = () => {
    const o = overlay();
    if (!o) return;
    o.style.display = "none";
  };

  // ========= 5→1 カウントダウン =========
  let prestartTimer = null;
  const playCountdown = (seconds = 5) => {
    clearInterval(prestartTimer);
    let n = seconds;
    showOverlay(String(n));
    prestartTimer = setInterval(() => {
      n -= 1;
      if (n > 0) {
        showOverlay(String(n));
      } else {
        clearInterval(prestartTimer);
        showOverlay("スタート！");
        setTimeout(hideOverlay, 700);
      }
    }, 1000);
  };

  // ========= 回答時間タイマー（問題ごと） =========
  const CLIENT_TIME_LIMIT_SEC = 12; // quiz.pyのQUESTION_TIME_LIMIT_SECと合わせる
  let qTimer = null;      // setIntervalハンドル
  let qEndAt = 0;         // performance.now() のターゲット時刻(ms)
  const fmtSeconds = (s) => `${s.toFixed(1)} 秒`;

  const ensureTimerUI = () => {
    if (j("#qTimerWrap")) return;
    const stem = j("#qStem");
    if (!stem) return;
    const wrap = document.createElement("div");
    wrap.id = "qTimerWrap";
    wrap.className = "mb-3";

    const row = document.createElement("div");
    row.className = "d-flex justify-content-between align-items-center mb-1";
    row.innerHTML = `
      <div class="small text-muted">回答時間</div>
      <div id="qTimeLabel" class="fw-bold">--.- 秒</div>
    `;

    const prog = document.createElement("div");
    prog.className = "progress";
    prog.innerHTML = `<div id="qTimeBar" class="progress-bar" role="progressbar" style="width: 100%" aria-valuemin="0" aria-valuemax="100"></div>`;

    wrap.appendChild(row);
    wrap.appendChild(prog);
    stem.after(wrap);
  };

  const stopQuestionTimer = (toZero = false) => {
    if (qTimer) clearInterval(qTimer);
    qTimer = null;
    const label = j("#qTimeLabel");
    const bar = j("#qTimeBar");
    if (label && toZero) label.textContent = fmtSeconds(0.0);
    if (bar && toZero) bar.style.width = "0%";
  };

  // ========= ランダム待機 =========
  if (mode === "random-wait") {
    fetch("/api/matchmaking/join", { method: "POST" });
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      try {
        const r = await fetch("/api/matchmaking/poll");
        const js = await r.json();
        if (js.code) {
          location.href = `/quiz?code=${encodeURIComponent(js.code)}`;
          return;
        }
      } catch (e) {}
      setTimeout(poll, 800);
    };
    poll();

    j("#cancelBtn")?.addEventListener("click", async () => {
      alive = false;
      try {
        await fetch("/api/matchmaking/cancel", { method: "POST" });
      } catch (e) {
        // 失敗してもとりあえずホームへ戻る
      }
      window.location.href = "/home";   // ★ ここを history.back() の代わりに
    });
    return;
  }


  // ========= ルーム作成 =========
  if (mode === "room-created") {
    j("#copyBtn")?.addEventListener("click", async () => {
      const v = j("#roomCode")?.value || "";
      try {
        await navigator.clipboard.writeText(v);
        j("#copyBtn").textContent = "コピーしました";
        setTimeout(() => (j("#copyBtn").textContent = "コピー"), 1200);
      } catch (e) {}
    });
    return;
  }

  // ========= ルーム参加 =========
  if (mode === "room-join") {
    j("#joinBtn")?.addEventListener("click", () => {
      const code = (j("#joinCode")?.value || "").trim();
      if (!code) return;
      location.href = `/quiz?code=${encodeURIComponent(code)}`;
    });
    return;
  }

  // ========= プレイ画面 =========
  if (mode === "play") {
    const code = window.__ROOM_CODE__;
    const wsProto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${wsProto}://${location.host}/ws/quiz/${encodeURIComponent(code)}`);

    const stampFloat = document.getElementById("stampFloat");
    const stampToggleBtn = document.getElementById("stampToggleBtn");
    const showStampFloat = () => { if (stampFloat) stampFloat.style.display = "block"; };
    const hideStampFloat = () => { if (stampFloat) stampFloat.style.display = "none"; };
    let hintTimer = null;

    // ゲーム終了状態フラグ
    let gameFinished = false;

    // ▼ スタンプパネル表示/非表示（パネルそのもの）
    // ▼ 最初は「畳んである」状態にする
    let stampCollapsed = true;  // ← 初期値を true に変更

    if (stampFloat) {
      const body = stampFloat.querySelector(".stamp-fab-body");
      if (body) body.style.display = "none";       // 中身を非表示
    }
    if (stampToggleBtn) {
      stampToggleBtn.textContent = "開く";       // ボタンの初期表示
      stampToggleBtn.addEventListener("click", () => {
        stampCollapsed = !stampCollapsed;
        const body = stampFloat?.querySelector(".stamp-fab-body");
        if (!body) return;
        if (stampCollapsed) {
          body.style.display = "none";
          stampToggleBtn.textContent = "開く";
        } else {
          body.style.display = "block";
          stampToggleBtn.textContent = "閉じる";
        }
      });
    }

    // 開始ボタン（ランダムは非表示）
    if (isRandom) {
      const sb = document.getElementById("startBtn");
      if (sb) sb.style.display = "none";
    }

    let current = { qid: null, choices: [], locked: true };
    const setRoundInfo = (no, max) => {
      const inlineEl = j("#roundInfo");         // カード内の表示（従来の場所）
      const topBar   = j("#roundTopBar");       // 新しい上部バー
      const label    = j("#roundInfoLabel");    // バー内のテキスト部分

      let text = "";
      if (no && max) {
        text = `第 ${no} 問 / 全 ${max} 問`;
      } else if (max) {
        text = `全 ${max} 問`;
      } else {
        text = "";
      }

      // 既存位置にも一応反映（残しておきたい場合用）
      if (inlineEl) inlineEl.textContent = text;

      // 新しい上部バーに反映
      if (label) label.textContent = text;

      // 文言があるときだけバーを表示
      if (topBar) {
        if (text) {
          topBar.style.display = "block";
        } else {
          topBar.style.display = "none";
        }
      }
    };


    const disableAllChoices = () => {
      document.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = true));
    };
    const enableAllChoices = () => {
      document.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = false));
    };

    const startQuestionTimer = (seconds = CLIENT_TIME_LIMIT_SEC) => {
      ensureTimerUI();
      stopQuestionTimer(false);
      const label = j("#qTimeLabel");
      const bar = j("#qTimeBar");
      if (!label || !bar) return;

      const now = performance.now();
      qEndAt = now + seconds * 1000;
      label.textContent = fmtSeconds(seconds);

      // ★バーはCSSアニメで流す（JSで毎秒width更新しない）
      bar.style.transition = "none";
      bar.style.width = "100%";
      // reflowを1回だけ発生させてから
      bar.getBoundingClientRect();
      bar.style.transition = `width ${seconds}s linear`;
      bar.style.width = "0%";

      qTimer = setInterval(() => {
        const remainMs = Math.max(0, qEndAt - performance.now());
        const remain = remainMs / 1000;
        label.textContent = fmtSeconds(remain);

        if (remainMs <= 0) {
          stopQuestionTimer(true);
          current.locked = true;
          disableAllChoices();
        }
      }, TIMER_INTERVAL_MS);
    };

    // ========= スタンプUI =========
    const stamp = { list: [] };  // ★ クールタイム関連は削除（サーバ側で制御）

    const renderStampGrid = () => {
      // 優先：右下パネル、なければ従来サイドバー
      const grid =
        document.getElementById("stampFloatGrid") ||
        document.getElementById("stampGrid");
      if (!grid) return;

      grid.innerHTML = "";
      stamp.list.forEach((name) => {
        const btn = document.createElement("button");
        btn.className = "stamp-btn";
        btn.title = name;
        btn.innerHTML = `<img src="/static/stamp/${encodeURIComponent(name)}" alt="">`;
        btn.addEventListener("click", () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "stamp", key: name }));
          }
        });
        grid.appendChild(btn);
      });
      // スタンプリストが取れたら右下パネルを表示
      showStampFloat();
    };

    const fetchStamps = async () => {
      try {
        const r = await fetch("/api/quiz/stamps");
        const js = await r.json();
        if (js && js.ok && Array.isArray(js.stamps)) {
          stamp.list = js.stamps;
          renderStampGrid();
        }
      } catch (e) { /* ignore */ }
    };

    // ★ 自分のスタンプ：右下パネルの上に大きくポップ
    const playStampFxSelf = (key) => {
      const img = document.createElement("img");
      img.src = `/static/stamp/${encodeURIComponent(key)}`;
      img.className = "stamp-fx";
      img.alt = "自分のスタンプ";

      const panel = document.getElementById("stampFloat");
      const pad = 12;
      let left = 0, top = 0, w = 160;

      if (panel) {
        const r = panel.getBoundingClientRect();
        w = Math.min(Math.max(Math.floor(r.width * 0.5), 120), 200);
        left = Math.max(8, Math.floor(r.left + (r.width - w) / 2));
        top  = Math.max(8, Math.floor(r.top - w - pad));
      } else {
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        w = 160;
        left = vw - w - 24;
        top  = vh - w - 120;
      }

      img.style.width = `${w}px`;
      img.style.left  = `${left}px`;
      img.style.top   = `${top}px`;

      document.body.appendChild(img);
      setTimeout(() => img.remove(), 1200);
    };

    // ★ 他人のスタンプ：その人のスコア名の右横に小さくポップ
    const playStampFxOther = (key, whoName, whoId) => {
      // （もしスマホで重ければ、ここを無効化することも可能）
      if (IS_MOBILE) {
        // モバイル負荷を減らしたければ return; にしてもOK
        // return;
      }

      const rows = Array.from(document.querySelectorAll(".score-row"));
      let targetRow = null;

      if (whoId != null) {
        targetRow = rows.find(r => r.dataset.userId && Number(r.dataset.userId) === Number(whoId));
      }
      if (!targetRow && whoName) {
        targetRow = rows.find(r => {
          if (!r.dataset.name) return false;
          return r.dataset.name === whoName;
        });
      }
      if (!targetRow) return;

      const nameEl = targetRow.querySelector(".score-name") || targetRow;
      const r = nameEl.getBoundingClientRect();

      const img = document.createElement("img");
      img.src = `/static/stamp/${encodeURIComponent(key)}`;
      img.className = "stamp-fx";
      img.alt = `${whoName || "プレイヤー"}のスタンプ`;

      const size = 40; // 小さめ
      const left = r.right + 8;
      const top  = r.top - 4;

      img.style.width = `${size}px`;
      img.style.left  = `${left}px`;
      img.style.top   = `${top}px`;

      document.body.appendChild(img);
      setTimeout(() => img.remove(), 900);
    };

    // ========= ○× ジャッジ画像表示 =========
    const playJudgeFx = (isCorrect) => {
      // ★ Audio を再利用
      try {
        if (isCorrect) {
          if (!judgeAudioCorrect) {
            judgeAudioCorrect = new Audio(JUDGE_SE_CORRECT);
            judgeAudioCorrect.volume = 0.6;
          }
          judgeAudioCorrect.currentTime = 0;
          judgeAudioCorrect.play().catch(() => {});
        } else {
          if (!judgeAudioWrong) {
            judgeAudioWrong = new Audio(JUDGE_SE_WRONG);
            judgeAudioWrong.volume = 0.6;
          }
          judgeAudioWrong.currentTime = 0;
          judgeAudioWrong.play().catch(() => {});
        }
      } catch (e) {}

      const src = isCorrect ? JUDGE_IMG_CORRECT : JUDGE_IMG_WRONG;
      if (!src) return;

      const img = document.createElement("img");
      img.src = src;
      img.alt = isCorrect ? "正解！" : "不正解";
      img.style.position = "fixed";
      img.style.zIndex = "2200";
      img.style.left = "50%";
      img.style.top = "50%";
      img.style.transform = "translate(-50%, -50%) scale(0.8)";
      img.style.opacity = "0";
      img.style.width = "min(480px, 80vw)";
      img.style.pointerEvents = "none";
      img.style.transition = "opacity 0.2s ease-out, transform 0.2s ease-out";

      document.body.appendChild(img);

      requestAnimationFrame(() => {
        img.style.opacity = "1";
        img.style.transform = "translate(-50%, -50%) scale(1.0)";
      });

      setTimeout(() => {
        img.style.opacity = "0";
        img.style.transform = "translate(-50%, -50%) scale(1.05)";
        setTimeout(() => img.remove(), 250);
      }, 550);
    };

    // ========= 問題レンダリング =========
    const renderQuestion = (q) => {
      j("#qStem").textContent = q.stem;
      unlockAudio();
      // 出題音：Audio を再利用
      try {
        if (!questionStartAudio) {
          questionStartAudio = new Audio(SE_QUESTION_START);
          questionStartAudio.volume = 1.0;
        }
        questionStartAudio.currentTime = 0;
        questionStartAudio.play().catch(() => {});
      } catch (e) {}

      // シンキングタイム開始（ループ再生）
      // ★ モバイルは負荷軽減のためオフ
      try {
        if (!IS_MOBILE) {                 // ★これを追加
          if (!thinkingAudio) {
            thinkingAudio = new Audio(SE_THINKING);
            thinkingAudio.volume = 1.0;
            thinkingAudio.loop = true;
          }
          thinkingAudio.currentTime = 0;
          thinkingAudio.play().catch(() => {});
        }
      } catch (e) {}

      // ヒント処理
      const hintBox  = j("#qHintBox");
      const hintText = j("#qHintText");

      if (hintTimer) {
        clearTimeout(hintTimer);
        hintTimer = null;
      }

      if (hintBox && hintText) {
        const h = (q.hint || "").trim();

        hintBox.style.display = "block";

        if (h) {
          hintText.textContent = h;
          hintBox.style.visibility = "hidden";
          hintBox.style.opacity = "0";

          hintTimer = setTimeout(() => {
            hintBox.style.visibility = "visible";
            hintBox.style.opacity = "1";
          }, 1000);
        } else {
          hintText.textContent = "　"; // 全角スペース
          hintBox.style.visibility = "hidden";
          hintBox.style.opacity = "0";
        }
      }

      const box = j("#choices");
      box.innerHTML = "";
      current.qid = q.qid;
      current.choices = q.choices.slice();
      current.locked = false;

      startQuestionTimer(CLIENT_TIME_LIMIT_SEC);

      q.choices.forEach((text, i) => {
        const btn = document.createElement("button");
        btn.className = "btn btn-outline-primary choice-btn";
        btn.innerHTML = `<b>${"ABCD"[i]}.</b> ${text}`;
        btn.addEventListener("click", () => {
          if (current.locked) return;
          current.locked = true;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "answer", qid: current.qid, choice_idx: i }));
          }
          btn.classList.add("choice-wrong");
          disableAllChoices();
        });
        box.appendChild(btn);
      });

      setTimeout(enableAllChoices, 800);
    };

    const markReveal = (correctIdx) => {
      const list = Array.from(document.querySelectorAll(".choice-btn"));
      list.forEach((btn, idx) => {
        btn.classList.toggle("choice-correct", idx === correctIdx);
        if (idx !== correctIdx) btn.classList.add("choice-wrong");
      });
      disableAllChoices();
      stopQuestionTimer(true);
      current.locked = true;
      const hintBox  = j("#qHintBox");
      if (hintBox) {
        hintBox.style.visibility = "hidden";
        hintBox.style.opacity = "0";
      }
    };

    // ========= ホストだけ開始可（フレンド） =========
    let hostId = null;
    const updateStartButton = () => {
      const btn = document.getElementById("startBtn");
      if (!btn) return;

      if (isRandom) {
        btn.style.display = "none";
        return;
      }

      if (gameFinished) {
        btn.disabled = true;
        btn.textContent = "ゲーム終了";
        btn.title = "この部屋ではこれ以上開始できません。";
        return;
      }

      const meIsHost = hostId !== null && hostId === user.id;
      btn.disabled = !meIsHost;
      btn.title = meIsHost ? "" : "開始できるのはホストのみです";
    };

    // ========= WebSocket =========
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", user_id: user.id, name: MY_NAME }));
      fetchStamps();

      // ★ 念のためここでもHP初期化（接続成功時）
      if (IS_CHALLENGE && typeof window.initBossBattleHp === "function") {
        window.initBossBattleHp();
      }
    });

    ws.addEventListener("message", (ev) => {
      try {
        const m = JSON.parse(ev.data);

        if (m.type === "stamp") {
          const isMe = (m.user_id != null && m.user_id === user.id) || (m.name === MY_NAME);
          if (isMe) {
            playStampFxSelf(m.key);
          } else {
            playStampFxOther(m.key, m.name, m.user_id);
          }
        }

        if (m.type === "prestart") {
          playCountdown(m.seconds ?? 5);
        }
        if (m.type === "prestart_cancel") {
          clearInterval(prestartTimer);
          hideOverlay();
        }
        if (m.type === "game" && m.event === "started") {
          clearInterval(prestartTimer);
          hideOverlay();
        }
        if (m.type === "round_banner") {
          showOverlay(`第${m.round_no}問目！`);
          setTimeout(hideOverlay, 900);
        }

        if (m.type === "system") {
          if (m.event === "join" || m.event === "leave") {
            renderMembers(m.members);
            if ("host_id" in m) hostId = m.host_id;
            updateStartButton();
          }
        }

        if (m.type === "game" && m.event === "started") {
          // ★ ゲーム開始時にヘッダ説明を消す
          const intro = document.getElementById("playIntro");
          if (intro) {
            intro.classList.add("d-none");   // 説明を隠す
          }

          // ★ ゲーム開始ボタン自体を消す（バトル中は非表示）
          const startBtn = document.getElementById("startBtn");
          if (startBtn) {
            startBtn.style.display = "none";
          }

          // ★ 一番上のタブ（IF / あそびかた / ホームへ）をバトル中だけ消す
          const nav = document.getElementById("quizNavbar");
          if (nav) {
            nav.classList.add("d-none");
          }

          const topBar = document.getElementById("roundTopBar");
          if (topBar) {
            topBar.classList.remove("d-none");
          }

          setRoundInfo(1, m.round_max);
          renderMembers(m.members);
          // j("#startBtn")?.setAttribute("disabled", "disabled");  // 非表示にするのでこれは不要
        }


        if (m.type === "q") {
          // ★ 問題が来たタイミングでも念のため非表示にしておく
          const intro = document.getElementById("playIntro");
          if (intro) {
            intro.classList.add("d-none");
          }

          // ★ バトル中なので開始ボタンは消したまま
          const startBtn = document.getElementById("startBtn");
          if (startBtn) {
            startBtn.style.display = "none";
          }

          // ★ 念のため、タブも隠しておく（started が飛ばないパターン対策）
          const nav = document.getElementById("quizNavbar");
          if (nav) {
            nav.classList.add("d-none");
          }

          const topBar = document.getElementById("roundTopBar");
          if (topBar) {
            topBar.classList.remove("d-none");
          }          
          setRoundInfo(m.round_no, m.round_max);
          renderQuestion(m);
        }



        if (m.type === "answer_result") {
          // renderMembers(m.scores);
          renderScoreboard(m.scores);
          const mine = m.user_id === user.id;
          if (mine) {
            const list = Array.from(document.querySelectorAll(".choice-btn"));
            const btn = list[m.choice_idx];
            if (btn) btn.classList.add(m.correct ? "choice-correct" : "choice-wrong");

            try {
              if (thinkingAudio) {
                thinkingAudio.pause();
                thinkingAudio.currentTime = 0; // ★追加：完全停止（競合減らす）
              }
            } catch (e) {}

            requestAnimationFrame(() => {
              // ★判定SE/画像を1拍置いて鳴らす（競合回避）
              playJudgeFx(!!m.correct);
            });

            // ★★★ チャレンジモードのHP減少処理 ★★★
            if (IS_CHALLENGE && typeof window.applyBossBattleRound === "function") {
              // 今のところ「自分が正解 → ボスに攻撃」「自分が不正解 → 自分がダメージ」
              const userFasterAndCorrect = !!m.correct;
              window.applyBossBattleRound(userFasterAndCorrect);
            }
          }
        }

        if (m.type === "reveal") {
          try { if (thinkingAudio) thinkingAudio.pause(); } catch(e) {}
          markReveal(m.correct_idx);
        }

        if (m.type === "game" && m.event === "finished") {
          const ranking = Array.isArray(m.ranking) ? m.ranking : [];
          const myId = user.id;
          const myName = MY_NAME;

          const rowsHtml = ranking
            .map((x, i) => {
              const rank = i + 1;
              let medal = "";
              let extraClass = "";

              if (rank === 1) {
                medal = "🥇";
                extraClass = " rank-1";
              } else if (rank === 2) {
                medal = "🥈";
                extraClass = " rank-2";
              } else if (rank === 3) {
                medal = "🥉";
                extraClass = " rank-3";
              }

              const name  = x.name ?? `プレイヤー${rank}`;
              const score = x.score ?? 0;

              // ★ 自分の行かどうか判定
              const isMe =
                (x.user_id != null && Number(x.user_id) === Number(myId)) ||
                (x.id != null && Number(x.id) === Number(myId)) ||
                (x.name && x.name === myName);

              const meClass = isMe ? " me" : "";

              return `
                <li class="result-ranking-item${extraClass}${meClass}">
                  <div class="result-rank-left">
                    <span class="result-rank-no">${rank}</span>
                    <span class="result-rank-medal">${medal}</span>
                    <span class="result-rank-name">
                      ${name}
                      ${isMe ? '<span class="result-rank-you">YOU</span>' : ""}
                    </span>
                  </div>
                  <div class="result-rank-score">${score} pt</div>
                </li>
              `;
            })
            .join("");

          const html = `
            <div class="result-card">
              <div class="result-card-icon">🏁</div>
              <div class="result-card-title">試合終了！</div>
              <div class="result-card-sub">今回の順位</div>
              <ol class="result-ranking">
                ${
                  rowsHtml
                    || '<li class="result-ranking-empty">参加者がいませんでした。</li>'
                }
              </ol>
              <div class="result-card-footer">
                この結果は数秒後に自動で閉じます。
              </div>
            </div>
          `;

          showOverlay(html);
          setTimeout(hideOverlay, 7000);

          gameFinished = true;
          updateStartButton();

          const nav = document.getElementById("quizNavbar");
          if (nav) {
            nav.classList.remove("d-none");
          }

          // ★ ゲーム開始ボタンも（フレンド戦なら）位置だけ戻す
          const startBtn = document.getElementById("startBtn");
          if (startBtn && !isRandom) {
            startBtn.style.display = "inline-block";  // or ""
          }        

          const topBar = document.getElementById("roundTopBar");
          if (topBar) {
            topBar.classList.add("d-none");
          }

          setRoundInfo(null, null);
          j("#qStem").textContent = "ゲーム終了。この部屋ではこれ以上対戦できません。";
          j("#choices").innerHTML = "";
          stopQuestionTimer(true);
          current.locked = true;
        }

        if (m.type === "error") {
          showOverlay(`<div class="text-center">⚠ ${m.msg}</div>`);
          setTimeout(hideOverlay, 2500);
        }
      } catch (e) {}
    });

    ws.addEventListener("close", () => {
      showOverlay(`<div class="text-center text-wrap">接続が終了しました。</div>`);
      setTimeout(hideOverlay, 2000);
      disableAllChoices();
      stopQuestionTimer(true);
      current.locked = true;

      // ★ 接続が切れたらタブを戻す
      const nav = document.getElementById("quizNavbar");
      if (nav) {
        nav.classList.remove("d-none");
      }

      const topBar = document.getElementById("roundTopBar");
      if (topBar) {
        topBar.classList.add("d-none");
      }      
      // ★ 開始ボタンも（フレンド戦なら）位置だけ戻す
      const startBtn = document.getElementById("startBtn");
      if (startBtn && !isRandom) {
        startBtn.style.display = "inline-block";  // or ""
      }

      try { if (thinkingAudio) thinkingAudio.pause(); } catch(e) {}
    });


    // ========= ボタンイベント =========
    j("#startBtn")?.addEventListener("click", () => {
      if (isRandom) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "start" }));
      }
    });

    j("#buzzBtn")?.addEventListener("click", () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "buzz" }));
      }
    });
  }
})();
