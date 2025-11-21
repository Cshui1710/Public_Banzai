/* static/quiz.js */
(() => {
  const mode = window.__PAGE_MODE__ || "";
  const user = window.__USER__ || { id: 0, email: null, is_guest: true };
  const isRandom = window.__IS_RANDOM__ === true || window.__IS_RANDOM__ === "true";
  const j = (sel) => document.querySelector(sel);

  const MY_NAME = (() => {
    if (user.display_name) return user.display_name;              // ニックネーム最優先
    if (user.email && !user.is_guest) return user.email;          // 本登録で display_name 未設定ならメール
    const id = user.id || 0;
    return `Guest${String(Math.abs(id) % 10000).padStart(4, "0")}`;  // ゲスト
  })();

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

    // ソートして順位を表示
    const sorted = (members || []).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    sorted.forEach((m, index) => {
      const row = document.createElement("div");
      row.className = "score-row";

      // 順位アイコン/テキスト
      let rankText = `${index + 1}位`;
      if (index === 0) rankText = "🥇 1st";
      if (index === 1) rankText = "🥈 2nd";
      if (index === 2) rankText = "🥉 3rd";

      row.innerHTML = `
        <div style="display:flex; gap:8px; align-items:center;">
          <span style="font-weight:bold; color:var(--primary); width:50px;">${rankText}</span>
          <span>${m.name}</span>
        </div>
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

  // ========= O/X Feedback Overlay =========
  const showFeedback = (isCorrect) => {
    const el = document.getElementById("feedbackOverlay");
    const mark = document.getElementById("feedbackMark");
    if (!el || !mark) return;

    // Reset animation
    mark.className = "feedback-mark";
    void mark.offsetWidth; // trigger reflow

    mark.textContent = isCorrect ? "〇" : "×";
    mark.classList.add(isCorrect ? "feedback-correct" : "feedback-wrong");

    // Make visible (opacity handled by animation)
    el.style.opacity = "1";

    // Hide after animation
    setTimeout(() => {
      el.style.opacity = "0";
    }, 1000);
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
      } catch (e) { }
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
      } catch (e) { }
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
    const stamp = { list: [], cooldownMs: 1500, lastSendAt: 0 };

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
          const now = Date.now();
          if (now - stamp.lastSendAt < stamp.cooldownMs) return;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "stamp", key: name }));
            stamp.lastSendAt = now;
            btn.disabled = true;
            setTimeout(() => (btn.disabled = false), 600);
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

    const playStampFx = (key, whoName) => {
      const img = document.createElement("img");
      img.src = `/static/stamp/${encodeURIComponent(key)}`;
      img.className = "stamp-fx";
      img.alt = whoName ? `${whoName}のスタンプ` : "stamp";

      // 右下パネルの位置・サイズから、表示位置と大きさを決める
      const panel = document.getElementById("stampFloat");
      const pad = 12; // パネルとの間隔
      let left = 0, top = 0, w = 160;

      if (panel) {
        const r = panel.getBoundingClientRect();
        // パネル幅の90%（最大200px）で表示 → 以前よりグッと小さめ（≒1/4想定）
        w = Math.min(Math.max(Math.floor(r.width * 0.5), 120), 200);
        left = Math.max(8, Math.floor(r.left + r.width - w)); // パネル右端に合わせる
        top = Math.max(8, Math.floor(r.top - w - pad));      // パネルの少し上
      } else {
        // パネルが無い/まだ測れない時のフォールバック（右下付近）
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        w = 160;
        left = vw - w - 24;
        top = vh - w - 120;
      }

      img.style.width = `${w}px`;
      img.style.left = `${left}px`;
      img.style.top = `${top}px`;

      document.body.appendChild(img);
      setTimeout(() => img.remove(), 1200);
    };


    // ========= 問題レンダリング =========
    const renderQuestion = (q) => {
      j("#qStem").textContent = q.stem;

      // ★ ヒント処理
      const hintBox = j("#qHintBox");
      const hintText = j("#qHintText");

      // 前のヒントタイマーをクリア
      if (hintTimer) {
        clearTimeout(hintTimer);
        hintTimer = null;
      }

      if (hintBox && hintText) {
        const h = (q.hint || "").trim();
        if (h) {
          // テキストは先にセットしておき、4秒後に表示
          hintText.textContent = h;
          hintBox.style.display = "none";  // 最初は非表示

          hintTimer = setTimeout(() => {
            hintBox.style.display = "block";
          }, 4000);  // ★ 4秒後に表示
        } else {
          // ヒントが無い問題は常に非表示
          hintText.textContent = "";
          hintBox.style.display = "none";
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

      // サーバ側の回答受付ディレイとのバランス用
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
      const hintBox = j("#qHintBox");
      if (hintBox) {
        hintBox.style.display = "none";
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
      const meIsHost = hostId !== null && hostId === user.id;
      btn.disabled = !meIsHost;
      btn.title = meIsHost ? "" : "開始できるのはホストのみです";
    };

    // ========= WebSocket =========
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", user_id: user.id, name: MY_NAME }));
      // スタンプ一覧ロード（初回）
      fetchStamps();
    });

    ws.addEventListener("message", (ev) => {
      try {
        const m = JSON.parse(ev.data);

        if (m.type === "stamp") {
          playStampFx(m.key, m.name);
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

            // Show O/X feedback
            showFeedback(m.correct);

            if (btn) btn.classList.add(m.correct ? "choice-correct" : "choice-wrong");
          }
        }

        if (m.type === "reveal") {
          markReveal(m.correct_idx);
        }

        if (m.type === "game" && m.event === "finished") {
          const r = m.ranking || [];
          const msg = r.map((x, i) => `${i + 1}位 ${x.name}（${x.score}）`).join("<br>");
          showOverlay(`<div class="text-center"><div class="mb-2">🎉 試合終了！</div>${msg}</div>`);
          setTimeout(hideOverlay, 4000);

          j("#startBtn")?.removeAttribute("disabled");
          setRoundInfo(null, null);
          j("#qStem").textContent = "ゲーム終了。もう一度「ゲーム開始」を押すと新しい問題が始まります。";

          // Add buttons below the message (in #choices)
          const box = j("#choices");
          box.innerHTML = `
            <div class="flex gap-4 mt-4">
              <a href="/home" class="btn btn-secondary flex-1 text-center">ホームへ戻る</a>
              <button id="restartBtn" class="btn btn-primary flex-1">ゲーム開始</button>
            </div>
          `;

          // Attach event listener to the new restart button
          j("#restartBtn")?.addEventListener("click", () => {
            // ランダムマッチの場合は新しいマッチングへ、フレンドマッチは同じ部屋で再戦
            if (isRandom) {
              location.href = "/quiz/random";
            } else {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "start" }));
              }
            }
          });

          stopQuestionTimer(true);
          current.locked = true;
        }

        if (m.type === "error") {
          showOverlay(`<div class="text-center">⚠ ${m.msg}</div>`);
          setTimeout(hideOverlay, 2500);
        }
      } catch (e) { }
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
      if (isRandom) return; // 念押し
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
