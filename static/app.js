// =======================
// Ishikawa Facilities & Parks - app.js
// （茅野データなし版 / 現在地アイコン強調 / チェックイン済み黄色ピン）
// =======================

// ------ 基本マップ設定 ------
const CENTER = [36.77, 136.90];
const map = L.map("map").setView(CENTER, 9);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// 到達半径（サーバ側から埋め込み）
const ARRIVAL_RADIUS = Number(window.ARRIVAL_RADIUS ?? 50);

// ------ 現在地マーカー（人アイコン＋波紋） ------
// ------ 現在地マーカー（波紋付きピン） ------
// index.html 側の CSS (.me-pulse-wrapper / .me-pulse-core / .me-pulse-ring) を使う
// ------ 現在地マーカー（人型アイコン＋波紋） ------
function meIcon() {
  const html = `
    <div class="me-pulse-wrapper">
      <!-- 波紋リング（CSSアニメーション） -->
      <div class="me-pulse-ring"></div>
      <div class="me-pulse-ring ring2"></div>

      <!-- 中心の現在地バッジ -->
      <div class="me-pulse-core">
        <div class="me-pulse-inner">
          <!-- 人型シルエットSVG -->
          <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
               style="width:18px;height:18px;display:block;">
            <!-- 頭 -->
            <circle cx="24" cy="16" r="7" fill="#f9fafb" />
            <!-- 体（肩〜胴体のシルエット） -->
            <path d="M14 34c1.5-6 5-9 10-9s8.5 3 10 9"
                  fill="#f9fafb" />
          </svg>
        </div>
      </div>
    </div>
  `;
  return L.divIcon({
    className: "me-pulse-pin",   // index.html の CSS と対応
    html,
    iconSize: [30, 30],          // ラッパー全体のサイズ
    iconAnchor: [15, 15],        // 中心が座標に合うように
  });
}


// ★ ここも整理：波紋は CSS で出すので circle は不要
let meMarker = L.marker(CENTER, { icon: meIcon(), interactive: false });
let mePos = null;

// 現在地を更新（マーカー位置だけ合わせる）
function updateMeMarker(lat, lon, zoom = 16) {
  mePos = [lat, lon];

  // マーカーを現在地へ
  meMarker.setLatLng(mePos);
  if (!map.hasLayer(meMarker)) {
    meMarker.addTo(map);
  }

  // 地図中心も移動
  if (zoom) {
    map.setView(mePos, zoom);
  }
}


let meRipple = null;
let mePulseTimer = null;


// 現在地を更新（マーカー＋波紋）
function updateMeMarker(lat, lon, zoom = 16) {
  mePos = [lat, lon];

  // マーカー
  meMarker.setLatLng(mePos);
  if (!map.hasLayer(meMarker)) {
    meMarker.addTo(map);
  }

  // 到達半径のベース円
  if (!meRipple) {
    meRipple = L.circle(mePos, {
      radius: ARRIVAL_RADIUS,
      color: "#38bdf8",
      weight: 1.5,
      opacity: 0.9,
      fillColor: "#0ea5e9",
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);

    // ふわっと脈打つような簡易アニメーション
    let grow = true;
    mePulseTimer = setInterval(() => {
      if (!mePos || !meRipple) return;
      const baseR = ARRIVAL_RADIUS;
      const r = grow ? baseR * 1.15 : baseR * 0.95;
      const fo = grow ? 0.03 : 0.10;
      meRipple.setLatLng(mePos);
      meRipple.setRadius(r);
      meRipple.setStyle({ fillOpacity: fo });
      grow = !grow;
    }, 900);
  } else {
    meRipple.setLatLng(mePos);
    meRipple.setRadius(ARRIVAL_RADIUS);
  }

  if (zoom) {
    map.setView(mePos, zoom);
  }
}

// ------ レイヤー（クラスタ） ------
const layerParks = L.markerClusterGroup({
  maxClusterRadius: 60,
  spiderfyOnEveryZoom: false,
});
const layerFacilities = L.markerClusterGroup({
  maxClusterRadius: 60,
});

map.addLayer(layerParks);
map.addLayer(layerFacilities);

// 検索結果など一時的に置くレイヤ
const layerSearch = L.layerGroup().addTo(map);

// ------ データキャッシュ／インデックス ------
let cacheParks = [];
let cacheFacilities = [];

// place_id → Leaflet マーカー
const markerIndex = new Map();

// ユーザーがチェックインした place_id の集合
let checkedPlaces = new Set();

// ------ ユーティリティ ------
function toast(msg, ok = true) {
  const t = document.getElementById("toast");
  if (!t) {
    alert(msg);
    return;
  }
  t.textContent = msg;
  t.style.background = ok ? "#111827" : "#b91c1c";
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 3000);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}

// ------ ピンアイコン ------
function pinSVGIcon() {
  const html = `
  <svg class="fancy-pin" viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs>
    <path d="M32 2c-14 0-25 11-25 25 0 17 20 36 24 40a 2 2 0 0 0 2.8 0c4-4 24-23 24-40C58 13 46 2 32 2z" fill="url(#g)"/>
    <circle cx="32" cy="28" r="9" fill="white" fill-opacity=".9"/>
  </svg>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -42],
  });
}

// チェックイン済みの黄色ピン（✔入り）
function checkedPinSVGIcon() {
  const html = `
  <svg class="fancy-pin" viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="checkedg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#facc15"/>
        <stop offset="100%" stop-color="#eab308"/>
      </linearGradient>
    </defs>
    <path d="M32 2c-14 0-25 11-25 25 0 17 20 36 24 40a 2 2 0 0 0 2.8 0c4-4 24-23 24-40C58 13 46 2 32 2z"
      fill="url(#checkedg)" />
    <circle cx="32" cy="28" r="11" fill="#fefce8" />
    <path d="M27 28.5l3.2 3.5 7-7"
      fill="none"
      stroke="#16a34a"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round" />
  </svg>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -42],
  });
}

// ------ アクセシビリティチップ ------
function chip(label, ok) {
  const on = ok ? "#16a34a" : "#94a3b8";
  return `<span class="pill" style="background:${
    ok ? "#ecfdf5" : "#f1f5f9"
  };color:${on};border:1px solid ${
    ok ? "#a7f3d0" : "#e5e7eb"
  }">${label}${ok ? "：可" : "：無"}</span>`;
}

// ------ ポップアップHTML ------
function popHtml(r, kind) {
  const lat = r.lat,
    lon = r.lon;
  const name = r.name ?? r["名称"] ?? r["施設名"] ?? "(名称不明)";
  const addr =
    r["address"] ??
    r["所在地_連結表記"] ??
    r["住所"] ??
    r["所在地"] ??
    "";
  const id = r.id ?? r["ID"] ?? `${kind}-${lat}-${lon}`;

  // 追加表示項目（app.py 側で正規化済み）
  const wd = r.weekdays ? `利用曜日: ${r.weekdays}` : "";
  const tm =
    r.open_time || r.close_time
      ? `時間: ${(r.open_time || "?")} - ${(r.close_time || "?")}`
      : "";
  const tn = r.time_note ? `備考: ${r.time_note}` : "";
  const ds = r.desc ? `${r.desc}` : "";
  const url = r.url
    ? `<a href="${r.url}" target="_blank" rel="noopener">公式ページ</a>`
    : "";
  const img = r.image
    ? `<div style="margin-top:6px"><img src="${r.image}" alt="" style="max-width:220px;border:1px solid #e5e7eb;border-radius:8px"></div>`
    : "";

  const a = r.a11y || {};
  const a11y = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      ${chip("車椅子", a.wheelchair)}
      ${chip("盲導犬", a.guide_dog)}
      ${chip("点字ブロック", a.braille_block)}
      ${chip("優先駐車", a.priority_parking)}
      ${chip("オストメイト", a.ostomy)}
      ${chip("授乳室", a.baby_room)}
      ${chip("おむつ替え", a.diaper)}
    </div>`;

  const btnCk = `<button class="btn primary" onclick='checkin(${JSON.stringify(
    id
  )},${lat},${lon},${JSON.stringify(name)},${JSON.stringify(
    kind
  )})'>チェックイン</button>`;

  const btnPh = `<button class="btn" style="margin-left:8px" onclick="openPhotoPanel('${esc(
    id
  )}','${esc(name)}')">みんなのコメント・写真</button>`;

  return `<div style="min-width:260px">
    <div style="font-weight:700">${esc(name)}</div>
    <div style="font-size:13px;color:#334155">${esc(addr)}</div>

    <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;font-size:13px;color:#0f172a">
      ${wd ? `<div>${esc(wd)}</div>` : ""}
      ${tm ? `<div>${esc(tm)}</div>` : ""}
      ${tn ? `<div>${esc(tn)}</div>` : ""}
      ${ds ? `<div style="color:#334155">${esc(ds)}</div>` : ""}
      ${url ? `<div>${url}</div>` : ""}
    </div>

    ${a11y}
    ${img}

    <div style="margin-top:8px">${btnCk}${btnPh}</div>
  </div>`;
}

// ------ API ラッパ ------

// 石川県CSV（ローカル）: kind = "park" or "facility"
async function fetchPlaces(kind) {
  const r = await fetch(`/api/local/places?kind=${kind}`);
  if (!r.ok) throw new Error("fetch error");
  const js = await r.json();
  return js.items || js || [];
}

// ログイン中ユーザーのチェックイン済み place_id 一覧
async function loadCheckedPlaces() {
  try {
    const r = await fetch("/api/checkins/places", {
      credentials: "include",
    });
    if (!r.ok) {
      console.warn("checkins/places 取得失敗 status=", r.status);
      return;
    }
    const js = await r.json();
    if (js.ok && Array.isArray(js.place_ids)) {
      checkedPlaces = new Set(js.place_ids.map(String));
      console.log("checkedPlaces loaded:", checkedPlaces);
    }
  } catch (e) {
    console.warn("checkins/places 読み込みエラー", e);
  }
}

// ------ マーカー追加 ------

function addMarkers(records, kind, group) {
  group.clearLayers();
  records.forEach((r) => {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") return;
    const rid = r.id ?? r["ID"] ?? `${kind}-${r.lat}-${r.lon}`;

    const icon = checkedPlaces.has(String(rid))
      ? checkedPinSVGIcon()
      : pinSVGIcon();

    const m = L.marker([r.lat, r.lon], { icon });
    m.bindPopup(popHtml(r, kind));
    group.addLayer(m);
    markerIndex.set(String(rid), m);
  });
}

// ------ 位置情報（現在地自動取得） ------

function autoLocateOnLoad() {
  if (!navigator.geolocation) {
    console.warn("Geolocation未対応");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      console.log("初回現在地取得成功:", p.coords);
      updateMeMarker(p.coords.latitude, p.coords.longitude, 16);
    },
    (err) => {
      console.warn("初回現在地取得失敗:", err);
      toast("現在地の取得に失敗しました", false);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

document.getElementById("locateBtn").onclick = () => {
  if (!navigator.geolocation) return toast("位置情報未対応", false);
  navigator.geolocation.getCurrentPosition(
    (p) => {
      updateMeMarker(p.coords.latitude, p.coords.longitude, 16);
    },
    () => toast("現在地取得失敗", false)
  );
};

document.getElementById("toggleParks").onclick = () => {
  map.hasLayer(layerParks)
    ? map.removeLayer(layerParks)
    : layerParks.addTo(map);
};
document.getElementById("toggleFacilities").onclick = () => {
  map.hasLayer(layerFacilities)
    ? map.removeLayer(layerFacilities)
    : layerFacilities.addTo(map);
};

// ------ 認証表示（/me 連携） ------
async function refreshAuthUI() {
  const authArea = document.getElementById("authArea");
  const loggedArea = document.getElementById("loggedArea");
  const whoami = document.getElementById("whoami");

  const prevUser = window.__USER__ || { id: null, email: null, name: null };

  let js = null;
  try {
    const r = await fetch("/me", {
      method: "GET",
      credentials: "include",
    });
    js = await r.json();
  } catch (e) {
    console.warn("/me の取得に失敗しました", e);
    js = null;
  }

  if (js && js.authenticated) {
    if (authArea) authArea.style.display = "none";
    if (loggedArea) loggedArea.style.display = "flex";
    if (whoami) whoami.textContent = `ログイン中: ${js.email}`;

    window.__USER__ = {
      id: js.id,
      email: js.email,
      name: js.email,
    };
  } else {
    window.__USER__ = prevUser;
  }

  console.log(
    "refreshAuthUI: 現在のユーザー:",
    window.__USER__?.email ?? "(未ログイン)",
    "ID:",
    window.__USER__?.id ?? "なし"
  );
}

// ------ 簡易認証API（未使用でも残しておく） ------
async function register() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const r = await fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  toast(r.ok ? "登録完了" : "登録失敗", r.ok);
}
async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const r = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  toast(r.ok ? "ログイン成功" : "ログイン失敗", r.ok);
  refreshAuthUI();
}
async function logout() {
  await fetch("/auth/logout", { method: "POST" });
  toast("ログアウトしました");
  refreshAuthUI();
}
async function loadStamps() {
  const r = await fetch("/api/stamps");
  if (r.status === 401) return toast("ログインが必要", false);
  const js = await r.json();
  toast(`スタンプ所持：${js.count}件`);
}
function googleLogin() {
  location.href = "/auth/google/login";
}
function lineLogin() {
  location.href = "/auth/line/login";
}

// ------ 距離計算 ------
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dlat = toRad(lat2 - lat1),
    dlon = toRad(lon2 - lon1);
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ------ チェックイン処理 ------
async function checkin(id, lat, lon, name, kind) {
  const me = window.__USER__ || null;

  // 未ログイン
  if (!me || me.id == null) {
    return toast("ログインが必要です", false);
  }

  // ★ ゲストはチェックイン不可
  if (me.is_guest === true || me.is_guest === "true") {
    return toast("ゲストモードではチェックインできません。本登録ログインしてください。", false);
  }


  if (!mePos) {
    try {
      const p = await new Promise((res, rej) => {
        if (!navigator.geolocation)
          return rej({ code: "NO_GEO", message: "Geolocation未対応" });
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });
      mePos = [p.coords.latitude, p.coords.longitude];
      updateMeMarker(p.coords.latitude, p.coords.longitude, 16);
    } catch (err) {
      if (err && typeof err.code !== "undefined") {
        if (err.code === err.PERMISSION_DENIED)
          return toast(
            "位置情報の許可が必要です（ブラウザ設定を確認）",
            false
          );
        if (err.code === err.POSITION_UNAVAILABLE)
          return toast("位置情報を取得できませんでした", false);
        if (err.code === err.TIMEOUT)
          return toast("位置情報の取得がタイムアウトしました", false);
      }
      return toast("現在地の取得に失敗しました", false);
    }
  }

  const clientDist = haversineM(mePos[0], mePos[1], lat, lon);
  if (clientDist > ARRIVAL_RADIUS + 5) {
    return toast(
      `チェックインできる距離にいません（現在 約${Math.round(
        clientDist
      )}m / 必要 ${ARRIVAL_RADIUS}m 以内）`,
      false
    );
  }

  const body = {
    place_id: id,
    place_name: name,
    kind,
    lat,
    lon,
    user_lat: mePos[0],
    user_lon: mePos[1],
  };

  let r, js;
  try {
    r = await fetch("/api/checkin", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    js = await r
      .clone()
      .json()
      .catch(async () => ({ detail: await r.text().catch(() => null) }));
  } catch (e) {
    return toast("サーバに接続できませんでした", false);
  }

  if (r.status === 401) return toast("ログインが必要です", false);
  if (r.status === 422)
    return toast("入力が不正です（緯度経度などを確認）", false);
  if (!r.ok) {
    return toast(js?.detail || "チェックインに失敗しました", false);
  }

  if (js?.repeat) {
    toast(js?.message || "本日は既にチェックイン済みです");
    return;
  }
  toast(
    js?.distance_m != null
      ? `距離: ${js.distance_m}m / チェックイン成功`
      : "チェックイン成功"
  );

  // ★ チェックイン済みに追加し、マーカーを黄色ピンに更新
  const idStr = String(id);
  checkedPlaces.add(idStr);
  const mk = markerIndex.get(idStr);
  if (mk) {
    mk.setIcon(checkedPinSVGIcon());
  }

  // スタンプ獲得モーダル
  if (js?.awarded && js?.character) {
    openGotModal(js.character);
  }
}

window.checkin = checkin;
window.openPhotoPanel = openPhotoPanel;

window.addEventListener("error", (e) =>
  toast(e.message || "スクリプトエラー", false)
);
window.addEventListener("unhandledrejection", (e) =>
  toast((e.reason && e.reason.message) || "通信エラー", false)
);

// ------ CSV検索 ------
function searchCSV() {
  const q = document.getElementById("csvQuery").value.trim();
  const list = document.getElementById("searchResults");
  const panel = document.getElementById("searchPanel");
  if (!q) {
    list.innerHTML = "<div>検索語を入力してください</div>";
    panel.style.display = "block";
    return;
  }
  const hay = cacheParks.concat(cacheFacilities);
  const hits = hay.filter((x) => {
    const name = (x.name ?? x["名称"] ?? x["施設名"] ?? "").toString();
    const addr = (
      x.address ??
      x["所在地_連結表記"] ??
      x["住所"] ??
      x["所在地"] ??
      ""
    ).toString();
    return name.includes(q) || addr.includes(q);
  });
  if (hits.length === 0) {
    list.innerHTML = "<div>該当なし</div>";
  } else {
    list.innerHTML = hits
      .slice(0, 200)
      .map((it) => {
        const rid = esc(String(it.id));
        const k = it.kind || (it.name?.includes("公園") ? "公園" : "公共施設");
        return `<div style="padding:8px;border:1px solid #ddd;border-radius:8px;margin-bottom:8px;">
        <div style="font-weight:600">${esc(it.name || "(名称不明)")}</div>
        <div style="font-size:12px;color:#555;">${esc(k)}</div>
        <div style="font-size:12px;color:#334;">${esc(it.address || "")}</div>
        <div style="display:flex;gap:8px;margin-top:6px;align-items:center;">
          <code style="font-size:12px;">${rid}</code>
          <button class="btn" onclick="flyToItem('${rid}')">地図で表示</button>
          <button class="btn" onclick="openPhotoPanel('${rid}','${esc(
          it.name || "(名称不明)"
        )}')">写真</button>
        </div></div>`;
      })
      .join("");
  }
  panel.style.display = "block";
}

async function flyToItem(id) {
  const r = await fetch(`/api/local/place?id=${encodeURIComponent(id)}`);
  if (!r.ok) {
    toast("読み込みに失敗しました", false);
    return;
  }
  const js = await r.json();
  const it = js.item;
  map.setView([it.lat, it.lon], 17);
  const m = markerIndex.get(String(id));
  if (m) {
    m.openPopup();
  } else {
    const temp = L.marker([it.lat, it.lon], { icon: pinSVGIcon() }).addTo(
      layerSearch
    );
    temp.bindPopup(popHtml(it, it.kind || "地点")).openPopup();
  }
}

// ------ 写真パネル・コメント ------
function openPhotoPanel(placeId, placeName) {
  document.getElementById("photoPanelTitle").textContent =
    placeName || placeId;
  document.getElementById("photoPlaceId").value = placeId;
  document.getElementById("photoPanel").classList.add("open");
  loadPhotos(placeId);
  refreshComments();
}
function closePhotoPanel() {
  document.getElementById("photoPanel").classList.remove("open");
  document.getElementById("photoList").innerHTML = "";
}

async function loadPhotos(placeId) {
  const r = await fetch(`/api/photos?place_id=${encodeURIComponent(placeId)}`);
  if (!r.ok) {
    toast("写真の取得に失敗", false);
    return;
  }
  const js = await r.json();
  const list = document.getElementById("photoList");
  if (js.count === 0) {
    list.innerHTML =
      '<div style="padding:12px;color:#475569;">まだ写真がありません。最初の一枚を投稿しませんか？</div>';
  } else {
    list.innerHTML = js.items.map((it) => `<img src="${it.url}" alt="">`).join(
      ""
    );
  }
}

async function submitPhoto(ev) {
  ev.preventDefault();
  const me = window.__USER__ || null;
  if (!me || me.id == null) {
    toast("ログインが必要です", false);
    return false;
  }
  const placeId = document.getElementById("photoPlaceId").value;
  const fileEl = document.getElementById("photoFile");
  if (!fileEl.files || fileEl.files.length === 0) {
    toast("ファイルを選択してください", false);
    return false;
  }
  const fd = new FormData();
  fd.append("place_id", placeId);
  fd.append("file", fileEl.files[0]);
  const r = await fetch("/api/photos", { method: "POST", body: fd });
  const js = await r.json().catch(() => null);
  if (!r.ok) {
    toast(js?.detail || "アップロード失敗", false);
    return false;
  }
  toast("アップロード完了！");
  fileEl.value = "";
  loadPhotos(placeId);
  return false;
}
window.submitPhoto = submitPhoto;

// コメント
async function refreshComments() {
  const placeId = document.getElementById("photoPlaceId").value;
  if (!placeId) return;
  try {
    const r = await fetch(
      `/api/comments?place_id=${encodeURIComponent(placeId)}`
    );
    const js = await r.json();
    if (!js.ok) throw new Error("failed");
    renderComments(js.items || []);
    const cc = document.getElementById("commentCount");
    if (cc) cc.textContent = `${js.count}件`;
  } catch (e) {
    console.error(e);
    toast("コメントの取得に失敗", false);
  }
}

function renderComments(items) {
  const box = document.getElementById("commentList");
  if (!box) return;
  if (!items.length) {
    box.innerHTML = `<div style="color:#64748b;">まだコメントはありません。</div>`;
    return;
  }

  box.innerHTML = items
    .map((it) => {
      const when = new Date(it.created_at).toLocaleString();

      // ★ 表示名の決定
      let who = "匿名ユーザー";
      if (it.user_name) {
        who = it.user_name;
      } else if (it.user && it.user.display_name) {
        who = it.user.display_name;
      } else if (it.user && it.user.email) {
        const em = String(it.user.email);
        who = em.includes("@") ? em.split("@")[0] : em;
      }

      const id = it.id;

      // ★ 削除権限チェック（本人のみ）
      const currentId =
        window.__USER__ && window.__USER__.id != null
          ? Number(window.__USER__.id)
          : null;
      const authorId =
        it.user && it.user.id != null ? Number(it.user.id) : null;
      const canDelete = currentId != null && authorId != null && currentId === authorId;

      return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;">
        <div style="font-size:12px;color:#64748b;display:flex;justify-content:space-between;gap:8px;">
          <span>${esc(who)} ・ ${esc(when)}</span>
          ${
            canDelete
              ? `<button class="btn" style="padding:2px 8px;" onclick="deleteComment(${id})">削除</button>`
              : ""
          }
        </div>
        <div style="margin-top:4px;white-space:pre-wrap;">${esc(
          it.content
        )}</div>
      </div>`;
    })
    .join("");
}




async function submitComment(ev) {
  ev.preventDefault();
  const me = window.__USER__ || null;
  if (!me || me.id == null) {
    toast("ログインが必要です", false);
    return false;
  }
  const placeId = document.getElementById("photoPlaceId").value;
  const textEl = document.getElementById("commentText");
  const content = (textEl.value || "").trim();
  if (!content) {
    toast("コメントを入力してください", false);
    return false;
  }
  if (content.length > 500) {
    toast("500文字以内で入力してください", false);
    return false;
  }

  try {
    const r = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place_id: placeId, content }),
    });
    const js = await r.json().catch(() => null);
    if (!r.ok || !js?.ok) {
      throw new Error(js?.detail || "送信失敗");
    }
    textEl.value = "";
    toast("コメントを投稿しました");
    refreshComments();
  } catch (e) {
    toast(e.message || "コメント送信に失敗", false);
  }
  return false;
}
window.submitComment = submitComment;

async function deleteComment(id) {
  const ok = confirm("このコメントを削除しますか？（本人投稿のみ可）");
  if (!ok) return;
  try {
    const r = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    const js = await r.json().catch(() => null);
    if (!r.ok || !js?.ok) throw new Error(js?.detail || "削除失敗");
    toast("削除しました");
    refreshComments();
  } catch (e) {
    toast(e.message || "削除に失敗", false);
  }
}
window.deleteComment = deleteComment;

// ------ スタンプ図鑑 ------
async function openCharsAll() {
  try {
    const r = await fetch("/api/characters");
    if (r.status === 401) return toast("ログインが必要", false);
    if (!r.ok) return toast("図鑑の取得に失敗", false);
    const js = await r.json();
    renderCharsModalAll(js);
  } catch (e) {
    console.error(e);
    toast("図鑑の取得に失敗", false);
  }
}
window.openCharsAll = openCharsAll;

function closeChars() {
  document.getElementById("charsModal").style.display = "none";
}
window.closeChars = closeChars;

function renderCharsModalAll(data) {
  const modal = document.getElementById("charsModal");
  const grid = document.getElementById("charsGrid");
  const head = document.getElementById("charsHeader");

  head.textContent = `チェックイン：${data.stamp_count}回 / 図鑑：全${data.count}種（所持 ${
    data.items.filter((x) => x.owned).length
  }）`;

  grid.innerHTML = data.items
    .map((it) => {
      const url =
        new URL(it.image, location.origin).href + `?v=${Date.now()}`;
      return `
      <div class="card ${it.owned ? "owned" : "locked"}">
        <img src="${url}" alt="${esc(it.name)}" width="${
        it.w || 256
      }" height="${it.h || 256}">
        <div style="margin-top:6px;font-weight:600">${esc(it.name)}</div>
        <div class="badge">${esc(it.code)} ${it.owned ? "✅" : "🔒"}</div>
      </div>`;
    })
    .join("");

  modal.style.display = "flex";
}

// ------ 分析モーダル（ヒートマップ＋グラフ） ------
document.getElementById("openDash").onclick = () => openDash();

let heatmapLayer,
  heatmapMap,
  tsChart,
  kindChart;
let heatCfg = { radius: 20, maxOpacity: 0.6, maxValue: 10 };
let heatDataCache = [];

function buildHeatmapOverlay() {
  if (heatmapLayer) {
    try {
      heatmapMap.removeLayer(heatmapLayer);
    } catch (_) {}
    heatmapLayer = null;
  }
  const cfg = {
    radius: heatCfg.radius,
    maxOpacity: heatCfg.maxOpacity,
    minOpacity: 0.25,
    scaleRadius: false,
    useLocalExtrema: false,
    latField: "lat",
    lngField: "lng",
    valueField: "value",
  };
  heatmapLayer = new HeatmapOverlay(cfg).addTo(heatmapMap);
  heatmapLayer.setData({ max: heatCfg.maxValue, data: heatDataCache || [] });
}

function openDash() {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const dashFrom = document.getElementById("dashFrom");
  const dashTo = document.getElementById("dashTo");
  if (dashFrom) dashFrom.value = toLocalInput(from);
  if (dashTo) dashTo.value = toLocalInput(now);

  const modal = document.getElementById("dashModal");
  if (modal) modal.style.display = "flex";

  if (!heatmapMap) {
    const ISHIKAWA_CENTER = [36.77, 136.9];
    const ISHIKAWA_ZOOM = 10;

    heatmapMap = L.map("heatwrap", {
      zoomControl: false,
      attributionControl: true,
    }).setView(ISHIKAWA_CENTER, ISHIKAWA_ZOOM);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      minZoom: 4,
      attribution: "&copy; OpenStreetMap",
    }).addTo(heatmapMap);

    buildHeatmapOverlay();
  }

  const rSpan = document.getElementById("heatRadiusVal");
  const oSpan = document.getElementById("heatOpacityVal");
  const mSpan = document.getElementById("heatMaxVal");
  if (rSpan) rSpan.textContent = heatCfg.radius;
  if (oSpan) oSpan.textContent = heatCfg.maxOpacity;
  if (mSpan) mSpan.textContent = heatCfg.maxValue;

  loadDashboard();
}

function closeDash() {
  const modal = document.getElementById("dashModal");
  if (modal) modal.style.display = "none";
}
window.closeDash = closeDash;

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setHeatData(points) {
  heatDataCache = points || [];
  if (heatmapLayer) {
    heatmapLayer.setData({ max: heatCfg.maxValue, data: heatDataCache });
  }
}

async function loadDashboard() {
  const from = document.getElementById("dashFrom")?.value;
  const to = document.getElementById("dashTo")?.value;
  const kind = document.getElementById("dashKind")?.value;
  const tod = document.getElementById("dashTod")?.value;

  const params = new URLSearchParams();
  if (from) params.set("date_from", new Date(from).toISOString());
  if (to) params.set("date_to", new Date(to).toISOString());
  if (kind) params.set("kind", kind);
  if (tod) params.set("tod", tod);

  const geoLink = document.getElementById("geojsonLink");
  if (geoLink) geoLink.href = `/api/export/checkins.geojson?${params.toString()}`;

  try {
    const h = await fetch(
      `/api/stats/heatmap?${params.toString()}`
    ).then((r) => r.json());
    if (h.ok) {
      const data = h.points.map((p) => ({
        lat: p[0],
        lng: p[1],
        value: p[2] || 1,
      }));
      setHeatData(data);
      if (data.length) {
        const bounds = L.latLngBounds(
          data.map((d) => [d.lat, d.lng])
        );

        const ISHIKAWA_BOUNDS = L.latLngBounds(
          [36.0, 135.5],
          [37.8, 137.6]
        );

        if (!ISHIKAWA_BOUNDS.contains(bounds)) {
          heatmapMap.setView([36.77, 136.9], 8);
        } else {
          heatmapMap.fitBounds(bounds.pad(0.2));
        }
      }
    }

    const t = await fetch(
      `/api/stats/timeseries?bucket=day&${params.toString()}`
    ).then((r) => r.json());
    if (t.ok) {
      const labels = t.items.map((i) => i.t);
      const values = t.items.map((i) => i.count);
      drawTsChart(labels, values);
    }

    const k = await fetch(
      `/api/stats/by-kind?${params.toString()}`
    ).then((r) => r.json());
    if (k.ok) {
      const labels = k.items.map((i) => i.kind);
      const values = k.items.map((i) => i.count);
      drawKindChart(labels, values);
    }

    toast?.("分析データを更新しました");
  } catch (e) {
    console.error(e);
    toast?.("分析データの取得に失敗", false);
  }
}

function drawTsChart(labels, values) {
  const ctx = document.getElementById("tsChart");
  if (!ctx) return;
  if (tsChart) tsChart.destroy();
  tsChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "チェックイン（日別）", data: values }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function drawKindChart(labels, values) {
  const ctx = document.getElementById("kindChart");
  if (!ctx) return;
  if (kindChart) kindChart.destroy();
  kindChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "種別内訳", data: values }] },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

function applyHeatConfig() {
  const rEl = document.getElementById("heatRadius");
  const oEl = document.getElementById("heatOpacity");
  const mEl = document.getElementById("heatMax");

  const r = Number(rEl ? rEl.value : heatCfg.radius);
  const o = Number(oEl ? oEl.value : heatCfg.maxOpacity);
  const m = Number(mEl ? mEl.value : heatCfg.maxValue);

  heatCfg.radius = r;
  heatCfg.maxOpacity = o;
  heatCfg.maxValue = m;

  const rSpan = document.getElementById("heatRadiusVal");
  const oSpan = document.getElementById("heatOpacityVal");
  const mSpan = document.getElementById("heatMaxVal");
  if (rSpan) rSpan.textContent = r;
  if (oSpan) oSpan.textContent = o.toFixed(2);
  if (mSpan) mSpan.textContent = m;

  if (heatmapMap) buildHeatmapOverlay();
}
window.applyHeatConfig = applyHeatConfig;

// ------ スタンプ獲得モーダル ------
// ------ スタンプ獲得モーダル ------
function openGotModal(ch) {
  const m = document.getElementById("gotModal");
  if (!m) return;

  // 画像・名前セット
  const imgEl = document.getElementById("gotImg");
  const nameEl = document.getElementById("gotName");
  const titleEl = document.getElementById("gotTitle");

  const name = ch?.name || "スタンプ";
  const imgSrc = ch?.image || ch?.sprite || "/static/stamp/marmot.png";

  if (imgEl) imgEl.src = imgSrc;
  if (nameEl) nameEl.textContent = name;

  // 「○○をゲット！」のタイトルに変更
  if (titleEl) {
    titleEl.textContent = `${name} をゲット！`;
  }

  // モーダル表示
  m.style.display = "flex";

  // 🎁 プレゼント箱アニメ起動
  if (typeof window.triggerGiftOpen === "function") {
    // 少しディレイを入れると「出てきてからパカッ」と強調できる
    setTimeout(() => window.triggerGiftOpen(), 100);
  }
}

function closeGotModal() {
  const m = document.getElementById("gotModal");
  if (m) m.style.display = "none";
}

async function shareGot() {
  const title = "スタンプをゲット！";
  const text =
    (document.getElementById("gotName")?.textContent || "スタンプ") + " を手に入れたよ";
  const url = location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
    } catch (_) {}
  } else if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(`${title}\n${text}\n${url}`);
      toast("リンクをコピーしました");
    } catch (_) {}
  } else {
    alert("共有に対応していない端末です");
  }
}

window.openGotModal = openGotModal;
window.closeGotModal = closeGotModal;
window.shareGot = shareGot;


// ------ 初期化 ------
async function init() {
  try {
    // 1) チェックイン済み一覧をロード
    await loadCheckedPlaces();

    // 2) 公園・公共施設をロードしてマーカー追加
    const [parks, facilities] = await Promise.all([
      fetchPlaces("park"),
      fetchPlaces("facility"),
    ]);
    cacheParks = parks;
    cacheFacilities = facilities;
    addMarkers(cacheParks, "公園", layerParks);
    addMarkers(cacheFacilities, "公共施設", layerFacilities);

    toast(
      `読み込み完了：${parks.length + facilities.length}地点`
    );
  } catch (e) {
    console.error(e);
    toast("データ読込エラー", false);
  }
  refreshAuthUI();
  autoLocateOnLoad();
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
