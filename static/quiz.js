/* static/quiz.js */
(() => {
  const mode = window.__PAGE_MODE__ || "";
  const user = window.__USER__ || { id: 0, email: null, is_guest: true };
  const isRandom = window.__IS_RANDOM__ === true || window.__IS_RANDOM__ === "true";
  const IS_CHALLENGE = !!window.__CHALLENGE_LEVEL__;   // ★ 追加：チャレンジモード判定
  const j = (sel) => document.querySelector(sel);

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

  let thinkingAudio = null;
  let questionStartAudio = null;

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

  const renderScoreboard = (members) => {
    const box = j("#scoreboard");
    if (!box) return;
    box.innerHTML = "";
    (members || [])
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .forEach((m) => {
        const row = document.createElement("div");
        row.className = "score-row";
        // ★ スタンプ用に id と name を data-* に入れておく
        row.dataset.userId = m.id != null ? String(m.id) : "";
        row.dataset.name = m.name || "";
        row.innerHTML = `
          <span class="score-name">${m.name}</span>
          <b>${m.score ?? 0}</b>
        `;
        box.appendChild(row);
      });
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
      await fetch("/api/matchmaking/cancel", { method: "POST" });
      history.back();
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
    let stampCollapsed = false;
    let hintTimer = null;

    // ゲーム終了状態フラグ
    let gameFinished = false;

    // ★ ボス戦HPの初期化（window.initBossBattleHp は quiz.html 側で定義）
    if (IS_CHALLENGE && typeof window.initBossBattleHp === "function") {
      window.initBossBattleHp();
    }

    stampToggleBtn?.addEventListener("click", () => {
      stampCollapsed = !stampCollapsed;
      const body = stampFloat?.querySelector(".stamp-fab-body");
      if (!body) return;
      body.style.display = stampCollapsed ? "none" : "block";
      stampToggleBtn.textContent = stampCollapsed ? "ひらく" : "たたむ";
    });

    // 開始ボタン（ランダムは非表示）
    if (isRandom) {
      const sb = document.getElementById("startBtn");
      if (sb) sb.style.display = "none";
    }

    let current = { qid: null, choices: [], locked: true };
    const setRoundInfo = (no, max) => {
      const el = j("#roundInfo");
      if (el) el.textContent = no && max ? `ラウンド ${no} / ${max}` : "";
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
      bar.style.width = "100%";

      qTimer = setInterval(() => {
        const remainMs = Math.max(0, qEndAt - performance.now());
        const remain = remainMs / 1000;
        const pct = Math.max(0, Math.min(100, (remain / seconds) * 100));

        label.textContent = fmtSeconds(remain);
        bar.style.width = `${pct}%`;

        if (remainMs <= 0) {
          stopQuestionTimer(true);
          current.locked = true;
          disableAllChoices();
        }
      }, 100);
    };

    // ========= スタンプUI =========
    const stamp = { list: [] };  // ★ クールタイム関連は削除

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

    // ★ 自分のスタンプ：右下パネルの上に大きくポップ（既存の挙動）
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
      try {
        const audio = new Audio(isCorrect ? JUDGE_SE_CORRECT : JUDGE_SE_WRONG);
        audio.volume = 1.0;
        audio.play().catch(() => {});
      } catch(e) {}

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
      // 出題音
      try {
        if (questionStartAudio) questionStartAudio.pause();
        questionStartAudio = new Audio(SE_QUESTION_START);
        questionStartAudio.volume = 1.0;
        questionStartAudio.play().catch(()=>{});
      } catch(e) {}

      // シンキングタイム開始（ループ再生）
      try {
        if (thinkingAudio) {
          thinkingAudio.pause();
          thinkingAudio = null;
        }
        thinkingAudio = new Audio(SE_THINKING);
        thinkingAudio.volume = 1.0;
        thinkingAudio.loop = true;
        thinkingAudio.play().catch(()=>{});
      } catch(e) {}

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
          }, 4000);
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
          setRoundInfo(1, m.round_max);
          renderMembers(m.members);
          j("#startBtn")?.setAttribute("disabled", "disabled");
        }

        if (m.type === "q") {
          setRoundInfo(m.round_no, m.round_max);
          renderQuestion(m);
        }

        if (m.type === "answer_result") {
          renderMembers(m.scores);
          const mine = m.user_id === user.id;
          if (mine) {
            const list = Array.from(document.querySelectorAll(".choice-btn"));
            const btn = list[m.choice_idx];
            if (btn) btn.classList.add(m.correct ? "choice-correct" : "choice-wrong");

            try { if (thinkingAudio) thinkingAudio.pause(); } catch(e) {}
            playJudgeFx(m.correct);

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
          const r = m.ranking || [];
          const msg = r.map((x, i) => `${i + 1}位 ${x.name}（${x.score}）`).join("<br>");
          showOverlay(`<div class="text-center"><div class="mb-2">🎉 試合終了！</div>${msg}</div>`);
          setTimeout(hideOverlay, 4000);

          gameFinished = true;
          updateStartButton();

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
