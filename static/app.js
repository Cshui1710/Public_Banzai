// 石川県全域をカバーする中心・ズーム
const CENTER = [36.77, 136.90];
const map = L.map('map').setView(CENTER, 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

const meMarker = L.circleMarker(CENTER, {
  radius:7, color:'#0ea5e9', fillColor:'#0ea5e9', fillOpacity:0.9
});

let mePos = null;  // まだ現在地は未取得

const layerParks = L.layerGroup().addTo(map);
const layerFacilities = L.layerGroup().addTo(map);

// 茅野（金ピン）用レイヤ（常時ON）
const layerNaganoFacilities = L.layerGroup().addTo(map);
const layerNaganoParks = L.layerGroup().addTo(map);

const layerSearch = L.layerGroup().addTo(map);

let cacheParks = [];
let cacheFacilities = [];
let cacheNaganoFacilities = [];
let cacheNaganoParks = [];

const markerIndex = new Map();

function toast(msg, ok=true){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.style.background=ok?'#111827':'#b91c1c';
  t.style.display='block';
  setTimeout(()=>t.style.display='none',3000);
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

function pinSVGIcon(){
  const html=`
  <svg class="fancy-pin" viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs>
    <path d="M32 2c-14 0-25 11-25 25 0 17 20 36 24 40a 2 2 0 0 0 2.8 0c4-4 24-23 24-40C58 13 46 2 32 2z" fill="url(#g)"/>
    <circle cx="32" cy="28" r="9" fill="white" fill-opacity=".9"/>
  </svg>`;
  return L.divIcon({className:"",html,iconSize:[34,42],iconAnchor:[17,42], popupAnchor:[0,-42]});
}
function goldPinSVGIcon(){
  const html = `
  <svg class="fancy-pin" viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="goldg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#facc15"/></linearGradient></defs>
    <path d="M32 2c-14 0-25 11-25 25 0 17 20 36 24 40a 2 2 0 0 0 2.8 0c4-4 24-23 24-40C58 13 46 2 32 2z" fill="url(#goldg)"/>
    <circle cx="32" cy="28" r="9" fill="white" fill-opacity=".9"/>
  </svg>`;
  return L.divIcon({className:"", html, iconSize:[34,42], iconAnchor:[17,42], popupAnchor:[0,-42]});
}

function chip(label, ok){
  const on = ok ? '#16a34a' : '#94a3b8';
  return `<span class="pill" style="background:${ok?'#ecfdf5':'#f1f5f9'};color:${on};border:1px solid ${ok?'#a7f3d0':'#e5e7eb'}">${label}${ok?'：可':'：無'}</span>`;
}

function popHtml(r,kind){
  const lat=r.lat, lon=r.lon;
  const name=r.name ?? r["名称"] ?? r["施設名"] ?? "(名称不明)";
  const addr=r["address"] ?? r["所在地_連結表記"] ?? r["住所"] ?? r["所在地"] ?? "";
  const id  = r.id ?? r["ID"] ?? `${kind}-${lat}-${lon}`;

  // 追加表示項目（app.py 側で正規化済み）
  const wd  = r.weekdays ? `利用曜日: ${r.weekdays}` : "";
  const tm  = (r.open_time || r.close_time) ? `時間: ${(r.open_time||"?")} - ${(r.close_time||"?")}` : "";
  const tn  = r.time_note ? `備考: ${r.time_note}` : "";
  const ds  = r.desc ? `${r.desc}` : "";
  const url = r.url ? `<a href="${r.url}" target="_blank" rel="noopener">公式ページ</a>` : "";
  const img = r.image ? `<div style="margin-top:6px"><img src="${r.image}" alt="" style="max-width:220px;border:1px solid #e5e7eb;border-radius:8px"></div>` : "";

  const a = r.a11y || {};
  const a11y = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
      ${chip('車椅子', a.wheelchair)}
      ${chip('盲導犬', a.guide_dog)}
      ${chip('点字ブロック', a.braille_block)}
      ${chip('優先駐車', a.priority_parking)}
      ${chip('オストメイト', a.ostomy)}
      ${chip('授乳室', a.baby_room)}
      ${chip('おむつ替え', a.diaper)}
    </div>`;

  const btnCk = `<button class="btn primary" onclick='checkin(${JSON.stringify(id)},${lat},${lon},${JSON.stringify(name)},${JSON.stringify(kind)})'>チェックイン</button>`;

  const btnPh = `<button class="btn" style="margin-left:8px" onclick="openPhotoPanel('${esc(id)}','${esc(name)}')">写真</button>`;

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

async function fetchPlaces(kind){
  const r=await fetch(`/api/local/places?kind=${kind}`);
  if(!r.ok) throw new Error('fetch error');
  const js=await r.json();
  return js.items||js||[];
}
async function fetchNagano(kind){
  const r = await fetch(`/api/nagano/places?kind=${kind}`);
  if(!r.ok) throw new Error('fetch nagano error');
  const js = await r.json();
  return js.items || [];
}

function addMarkers(records, kind, group) {
  group.clearLayers();
  console.log(`[${kind}] データ追加開始: ${records.length}件`); // コンソールに件数を出す

  records.forEach(r => {
    // 厳密な型チェック(typeof)をやめて、数値変換を試みる
    const lat = Number(r.lat);
    const lon = Number(r.lon);

    // 数値として不正(NaN)ならスキップ
    if (isNaN(lat) || isNaN(lon)) {
      console.warn(`[${kind}] 座標不正のためスキップ:`, r.name);
      return;
    }

    const m = L.marker([lat, lon], { icon: pinSVGIcon() });
    m.bindPopup(popHtml(r, kind));
    group.addLayer(m);
    
    const rid = r.id ?? r["ID"] ?? `${kind}-${lat}-${lon}`;
    markerIndex.set(String(rid), m);
  });
}
function addMarkersWithIcon(records, kind, group, iconFn){
  group.clearLayers();
  records.forEach(r=>{
    if(typeof r.lat!=="number" || typeof r.lon!=="number") return;
    const m = L.marker([r.lat, r.lon], { icon: iconFn ? iconFn() : pinSVGIcon() });
    m.bindPopup(popHtml(r, kind));
    group.addLayer(m);
    const rid = r.id ?? r["ID"] ?? `${kind}-${r.lat}-${r.lon}`;
    markerIndex.set(String(rid), m);
  });
}

function updateMeMarker(lat, lon, zoom = 16) {
  mePos = [lat, lon];
  meMarker.setLatLng(mePos).addTo(map);
  if (zoom) {
    map.setView(mePos, zoom);
  }
}

async function init(){
  try{
    const [parks, facilities] = await Promise.all([fetchPlaces("park"), fetchPlaces("facility")]);
    cacheParks = parks; cacheFacilities = facilities;
    addMarkers(cacheParks, "公園", layerParks);
    addMarkers(cacheFacilities, "公共施設", layerFacilities);

    // 茅野（金ピン）常時表示
    const [nfac, npark] = await Promise.all([fetchNagano("facility"), fetchNagano("park")]);
    cacheNaganoFacilities = nfac;
    cacheNaganoParks = npark;
    addMarkersWithIcon(cacheNaganoFacilities, "公共施設", layerNaganoFacilities, goldPinSVGIcon);
    addMarkersWithIcon(cacheNaganoParks, "公園", layerNaganoParks, goldPinSVGIcon);

    toast(`読み込み完了：${parks.length+facilities.length+nfac.length+npark.length}地点`);
  }catch(e){console.error(e);toast('データ読込エラー',false);}
  refreshAuthUI();
  autoLocateOnLoad();
}

function autoLocateOnLoad(){
  if (!navigator.geolocation) {
    console.warn("Geolocation未対応");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    p => {
      console.log("初回現在地取得成功:", p.coords);
      updateMeMarker(p.coords.latitude, p.coords.longitude, 16);
    },
    err => {
      console.warn("初回現在地取得失敗:", err);
      // ここでトーストも出してOK
      toast("現在地の取得に失敗しました", false);
    },
    { enableHighAccuracy:true, timeout:10000 }
  );
}

// HTMLの onclick="locateUser()" から呼ばれる関数として定義します
function locateUser(){
  if(!navigator.geolocation) return toast('位置情報未対応',false);
  navigator.geolocation.getCurrentPosition(p=>{
    updateMeMarker(p.coords.latitude, p.coords.longitude, 16);
  },()=>toast('現在地取得失敗',false));
}

async function refreshAuthUI(){
  const authArea   = document.getElementById('authArea');
  const loggedArea = document.getElementById('loggedArea');
  const whoami     = document.getElementById('whoami');

  // すでにテンプレートなどから設定されている __USER__ を尊重
  const prevUser = window.__USER__ || { id: null, email: null, name: null };

  let js = null;
  try {
    const r = await fetch('/me', {
      method: 'GET',
      credentials: 'include',   // ★ クッキーを必ず送る
    });
    js = await r.json();
  } catch (e) {
    console.warn('/me の取得に失敗しました', e);
    js = null;  // 失敗したら無理に未ログイン扱いにしない
  }

  // /me がちゃんと「ユーザーいるよ」と教えてくれた場合だけ UI を更新
  if (js && js.authenticated) {
    if (authArea)   authArea.style.display   = 'none';
    if (loggedArea) loggedArea.style.display = 'flex';
    if (whoami)     whoami.textContent       = `ログイン中: ${js.email}`;

    window.__USER__ = {
      id: js.id,
      email: js.email,
      name: js.email,
    };
  } else {
    // ここでは UI をいじらない（サーバが描画したログイン表示をそのままにする）
    window.__USER__ = prevUser;
  }

  console.log(
    "refreshAuthUI: 現在のユーザー:",
    window.__USER__?.email ?? '(未ログイン)',
    "ID:",
    window.__USER__?.id ?? 'なし'
  );
}



async function register(){
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  const r=await fetch('/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  toast(r.ok?'登録完了':'登録失敗',r.ok);
}
async function login(){
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  toast(r.ok?'ログイン成功':'ログイン失敗',r.ok);
  refreshAuthUI();
}
async function logout(){
  await fetch('/auth/logout',{method:'POST'});
  toast('ログアウトしました');
  refreshAuthUI();
}
async function loadStamps(){
  const r=await fetch('/api/stamps');
  if(r.status===401) return toast('ログインが必要',false);
  const js=await r.json();
  toast(`スタンプ所持：${js.count}件`);
}
function googleLogin(){ location.href = '/auth/google/login'; }
function lineLogin(){ location.href = '/auth/line/login'; }

// ページ読込時に半径を使いたい場合（index.html のどこかに埋め込むと便利）
// <script>window.ARRIVAL_RADIUS = {{ radius_m|int }};</script>
// 無ければデフォルト 50m
const ARRIVAL_RADIUS = Number(window.ARRIVAL_RADIUS ?? 50000);

// クライアント側でも距離を概算しておく
function haversineM(lat1, lon1, lat2, lon2){
  const R=6371000;
  const toRad = d => d*Math.PI/180;
  const dlat=toRad(lat2-lat1), dlon=toRad(lon2-lon1);
  const a=Math.sin(dlat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dlon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function checkin(id, lat, lon, name, kind){
  // 1) 認証チェック
  const me = (window.__USER__ || null);

  // id が無ければ未ログイン扱い
  if (!me || me.id == null) {
    return toast('ログインが必要です', false);
  }

  // 2) 現在地（未取得ならここで取る）
  if(!mePos){
    try{
      const p = await new Promise((res,rej)=>{
        if(!navigator.geolocation) return rej({code:'NO_GEO', message:'Geolocation未対応'});
        navigator.geolocation.getCurrentPosition(res, rej, {enableHighAccuracy:true, timeout:10000});
      });
      mePos = [p.coords.latitude, p.coords.longitude];
      updateMeMarker(p.coords.latitude, p.coords.longitude, 16);
    }catch(err){
      if (err && typeof err.code !== 'undefined') {
        if (err.code === err.PERMISSION_DENIED)   return toast('位置情報の許可が必要です（ブラウザ設定を確認）', false);
        if (err.code === err.POSITION_UNAVAILABLE)return toast('位置情報を取得できませんでした', false);
        if (err.code === err.TIMEOUT)             return toast('位置情報の取得がタイムアウトしました', false);
      }
      return toast('現在地の取得に失敗しました', false);
    }
  }

  // （以下はそのままでOK）
  const clientDist = haversineM(mePos[0], mePos[1], lat, lon);
  if (clientDist > ARRIVAL_RADIUS + 5) {
    return toast(`チェックインできる距離にいません（現在 約${Math.round(clientDist)}m / 必要 ${ARRIVAL_RADIUS}m 以内）`, false);
  }

  const body = {
    place_id: id, place_name: name, kind,
    lat, lon,
    user_lat: mePos[0], user_lon: mePos[1]
  };

  let r, js;
  try{
    r = await fetch('/api/checkin', {
      method:'POST',
      credentials: 'include', // つけておくとより安全
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    js = await r.clone().json().catch(async ()=>({ detail: await r.text().catch(()=>null) }));
  }catch(e){
    return toast('サーバに接続できませんでした', false);
  }

  if (r.status === 401) return toast('ログインが必要です', false);
  if (r.status === 422) return toast('入力が不正です（緯度経度などを確認）', false);
  if (!r.ok) {
    return toast(js?.detail || 'チェックインに失敗しました', false);
  }

  if (js?.repeat) {
    toast(js?.message || '本日は既にチェックイン済みです');
    return;
  }
  toast(js?.distance_m!=null ? `距離: ${js.distance_m}m / チェックイン成功` : 'チェックイン成功');

  if (js?.awarded && js?.character) {
    showCharacterModal(js.character);
  }
}


// どこか一度だけ
window.checkin = checkin;
window.openPhotoPanel = openPhotoPanel;
console.log(
  "現在のユーザー:",
  window.__USER__ ? window.__USER__.name : '(未ログイン)',
  "（ID:",
  window.__USER__ ? window.__USER__.id : 'なし',
  "）"
);

function searchCSV(){
  const element = document.getElementById('searchInput'); 
  if (!element) return; // 安全のため、見つからなければ何もしない
  const q = element.value.trim();
  
  const list=document.getElementById('searchResults');
  const panel=document.getElementById('searchPanel');
  if(!q){ list.innerHTML='<div>検索語を入力してください</div>'; panel.style.display='block'; return; }
  const hay = (cacheParks.concat(cacheFacilities, cacheNaganoFacilities, cacheNaganoParks));
  const hits = hay.filter(x=>{
    const name = (x.name ?? x["名称"] ?? x["施設名"] ?? "").toString();
    const addr = (x.address ?? x["所在地_連結表記"] ?? x["住所"] ?? x["所在地"] ?? "").toString();
    return name.includes(q) || addr.includes(q);
  });
  if(hits.length===0){ list.innerHTML='<div>該当なし</div>'; }
  else{
    list.innerHTML = hits.slice(0,200).map(it=>{
      const rid = esc(String(it.id));
      const k = it.kind || (it.name?.includes('公園') ? '公園' : '公共施設');
      return `<div style="padding:8px;border:1px solid #ddd;border-radius:8px;margin-bottom:8px;">
        <div style="font-weight:600">${esc(it.name||'(名称不明)')}</div>
        <div style="font-size:12px;color:#555;">${esc(k)}${it.source==='nagano'?'（茅野）':''}</div>
        <div style="font-size:12px;color:#334;">${esc(it.address||'')}</div>
        <div style="display:flex;gap:8px;margin-top:6px;align-items:center;">
          <code style="font-size:12px;">${rid}</code>
          <button class="btn" onclick="flyToItem('${rid}')">地図で表示</button>
          <button class="btn" onclick="openPhotoPanel('${rid}','${esc(it.name||'(名称不明)')}')">写真</button>
        </div></div>`;
    }).join("");
  }
  panel.style.display='block';
}

async function flyToItem(id){
  const r = await fetch(`/api/local/place?id=${encodeURIComponent(id)}`);
  if(!r.ok){ toast('読み込みに失敗しました', false); return; }
  const js = await r.json();
  const it = js.item;
  map.setView([it.lat,it.lon], 17);
  const m = markerIndex.get(String(id));
  if(m){ m.openPopup(); }
  else{
    const temp = L.marker([it.lat,it.lon],{icon:(it.source==='nagano'?goldPinSVGIcon():pinSVGIcon())}).addTo(layerSearch);
    temp.bindPopup(popHtml(it, it.kind || "地点")).openPopup();
  }
}

function openPhotoPanel(placeId, placeName){
  document.getElementById('photoPanelTitle').textContent = placeName || placeId;
  document.getElementById('photoPlaceId').value = placeId;
  document.getElementById('photoPanel').classList.add('open');
  loadPhotos(placeId);
  refreshComments(); // ★ 追加：コメント読み込み
}
function closePhotoPanel(){
  document.getElementById('photoPanel').classList.remove('open');
  document.getElementById('photoList').innerHTML = '';
}

async function loadPhotos(placeId){
  const r = await fetch(`/api/photos?place_id=${encodeURIComponent(placeId)}`);
  if(!r.ok){ toast('写真の取得に失敗', false); return; }
  const js = await r.json();
  const list = document.getElementById('photoList');
  if(js.count === 0){ list.innerHTML = '<div style="padding:12px;color:#475569;">まだ写真がありません。最初の一枚を投稿しませんか？</div>'; }
  else{ list.innerHTML = js.items.map(it => `<img src="${it.url}" alt="">`).join(""); }
}

async function submitPhoto(ev){
  ev.preventDefault();
  const me = window.__USER__ || null;
  if (!me || me.id == null) {
    toast('ログインが必要です', false);
    return false;
  }
  const placeId = document.getElementById('photoPlaceId').value;
  const fileEl  = document.getElementById('photoFile');
  if(!fileEl.files || fileEl.files.length === 0){ toast('ファイルを選択してください', false); return false; }
  const fd = new FormData();
  fd.append('place_id', placeId);
  fd.append('file', fileEl.files[0]);
  const r = await fetch('/api/photos', { method:'POST', body: fd });
  const js = await r.json().catch(()=>null);
  if(!r.ok){ toast(js?.detail || 'アップロード失敗', false); return false; }
  toast('アップロード完了！'); fileEl.value = ''; loadPhotos(placeId); return false;
}

// 例：ピン生成部のポップアップHTML
// place: { id, name, kind, lat, lon } を持っている前提


function showCharacterModal(ch) {
  const modal = document.getElementById("charModal");
  if (!modal) return;
  modal.style.display = "flex";
  document.body.classList.add('modal-open');  
  const character = {
    name: ch?.name || 'スタンプ',
    image: ch?.image || ch?.sprite || '/static/stamp/marmot.png'
  };
  startYamGame(character);  // ← サツマイモ投げ版を起動
}

function closeCharModal(){
  stopYamGame();
  document.getElementById("charModal").style.display = "none";
  document.body.classList.remove('modal-open');
}


window.checkin = checkin;
window.addEventListener('error', e => toast(e.message || 'スクリプトエラー', false));
window.addEventListener('unhandledrejection', e => toast((e.reason && e.reason.message) || '通信エラー', false));

// 汎用：位置取得
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation未対応"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
  });
}
async function openCharsAll(){
  try{
    const r = await fetch('/api/characters');
    if(r.status===401) return toast('ログインが必要', false);
    if(!r.ok) return toast('図鑑の取得に失敗', false);
    const js = await r.json();
    renderCharsModalAll(js);
  }catch(e){ console.error(e); toast('図鑑の取得に失敗', false); }
}

function closeChars(){ document.getElementById('charsModal').style.display='none'; }

function renderCharsModalAll(data){
  const modal = document.getElementById('charsModal');
  const grid  = document.getElementById('charsGrid');
  const head  = document.getElementById('charsHeader');

  head.textContent = `チェックイン：${data.stamp_count}回 / 図鑑：全${data.count}種（所持 ${data.items.filter(x=>x.owned).length}）`;

  grid.innerHTML = data.items.map(it=>{
    const url = new URL(it.image, location.origin).href + `?v=${Date.now()}`;
    return `
      <div class="card ${it.owned?'owned':'locked'}">
        <img src="${url}" alt="${esc(it.name)}" width="${it.w||256}" height="${it.h||256}">
        <div style="margin-top:6px;font-weight:600">${esc(it.name)}</div>
        <div class="badge">${esc(it.code)} ${it.owned?'✅':'🔒'}</div>
      </div>`;
  }).join('');

  modal.style.display='flex';
}

// ===== コメント =====
async function refreshComments(){
  const placeId = document.getElementById('photoPlaceId').value;
  if(!placeId) return;
  try{
    const r = await fetch(`/api/comments?place_id=${encodeURIComponent(placeId)}`);
    const js = await r.json();
    if(!js.ok) throw new Error('failed');
    renderComments(js.items || []);
    const cc = document.getElementById('commentCount');
    if (cc) cc.textContent = `${js.count}件`;
  }catch(e){
    console.error(e); toast('コメントの取得に失敗', false);
  }
}

function renderComments(items){
  const box = document.getElementById('commentList');
  if(!box) return;
  if(!items.length){
    box.innerHTML = `<div style="color:#64748b;">まだコメントはありません。</div>`;
    return;
  }
  box.innerHTML = items.map(it => {
    const when = new Date(it.created_at).toLocaleString();
    const who  = it.user?.email || '匿名';
    const id   = it.id;
    return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;">
        <div style="font-size:12px;color:#64748b;display:flex;justify-content:space-between;gap:8px;">
          <span>${esc(who)} ・ ${esc(when)}</span>
          <button class="btn" style="padding:2px 8px;" onclick="deleteComment(${id})">削除</button>
        </div>
        <div style="margin-top:4px;white-space:pre-wrap;">${esc(it.content)}</div>
      </div>`;
  }).join('');
}

async function submitComment(ev){
  ev.preventDefault();
  const me = window.__USER__ || null;
  if (!me || me.id == null) {
    toast('ログインが必要です', false);
    return false;
  }
  const placeId = document.getElementById('photoPlaceId').value;
  const textEl  = document.getElementById('commentText');
  const content = (textEl.value || '').trim();
  if(!content){ toast('コメントを入力してください', false); return false; }
  if(content.length > 500){ toast('500文字以内で入力してください', false); return false; }

  try{
    const r = await fetch('/api/comments', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ place_id: placeId, content })
    });
    const js = await r.json().catch(()=>null);
    if(!r.ok || !js?.ok){ throw new Error(js?.detail || '送信失敗'); }
    textEl.value = '';
    toast('コメントを投稿しました');
    refreshComments();
  }catch(e){
    toast(e.message || 'コメント送信に失敗', false);
  }
  return false;
}

async function deleteComment(id){
  const ok = confirm('このコメントを削除しますか？（本人投稿のみ可）');
  if(!ok) return;
  try{
    const r = await fetch(`/api/comments/${id}`, { method:'DELETE' });
    const js = await r.json().catch(()=>null);
    if(!r.ok || !js?.ok) throw new Error(js?.detail || '削除失敗');
    toast('削除しました');
    refreshComments();
  }catch(e){
    toast(e.message || '削除に失敗', false);
  }
}




// ===================== ヒートマップ / ダッシュボード =====================
let heatmapLayer, heatmapMap, tsChart, kindChart;
let heatCfg = { radius: 20, maxOpacity: 0.6, maxValue: 10 };
// 最新のヒートデータを保持（レイヤ再生成時に再適用する）
let heatDataCache = []; // [{lat,lng,value}, ...]

function buildHeatmapOverlay(){
  if (heatmapLayer) {
    try { heatmapMap.removeLayer(heatmapLayer); } catch(_) {}
    heatmapLayer = null;
  }
  const cfg = {
    radius: heatCfg.radius,
    maxOpacity: heatCfg.maxOpacity,
    minOpacity: 0.25,
    scaleRadius: false,     // ← ★ これを false に変更！
    useLocalExtrema: false,
    latField: 'lat',
    lngField: 'lng',
    valueField: 'value'
  };
  heatmapLayer = new HeatmapOverlay(cfg).addTo(heatmapMap);
  heatmapLayer.setData({ max: heatCfg.maxValue, data: heatDataCache || [] });
}


function openDash(){
  // デフォルト: 直近30日
  const now = new Date();
  const from = new Date(now.getTime() - 30*24*60*60*1000);

  const dashFrom = document.getElementById('dashFrom');
  const dashTo   = document.getElementById('dashTo');
  if (dashFrom) dashFrom.value = toLocalInput(from);
  if (dashTo)   dashTo.value   = toLocalInput(now);

  // モーダル表示
  const modal = document.getElementById('dashModal');
  if (modal) modal.style.display = 'flex';

  // マップ初期化（初回のみ）→ レイヤ作成
  if(!heatmapMap){
    heatmapMap = L.map('heatwrap').setView(CENTER, 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {maxZoom: 19, attribution:'&copy; OpenStreetMap'}
    ).addTo(heatmapMap);
    buildHeatmapOverlay(); // ★ここで作成
  }

  // スライダの表示値を反映（nullガード）
  const rSpan = document.getElementById('heatRadiusVal');
  const oSpan = document.getElementById('heatOpacityVal');
  const mSpan = document.getElementById('heatMaxVal');
  if (rSpan) rSpan.textContent = heatCfg.radius;
  if (oSpan) oSpan.textContent = heatCfg.maxOpacity;
  if (mSpan) mSpan.textContent = heatCfg.maxValue;

  loadDashboard();
}

function closeDash(){ 
  const modal = document.getElementById('dashModal');
  if (modal) modal.style.display='none';
}

function toLocalInput(d){
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// API から取得したヒートポイントを適用＆キャッシュ
function setHeatData(points){
  // points: [{lat,lng,value}, ...]
  heatDataCache = points || [];
  if (heatmapLayer) {
    heatmapLayer.setData({ max: heatCfg.maxValue, data: heatDataCache });
  }
}

async function loadDashboard(){
  const from = document.getElementById('dashFrom')?.value;
  const to   = document.getElementById('dashTo')?.value;
  const kind = document.getElementById('dashKind')?.value;
  const tod  = document.getElementById('dashTod')?.value;

  const params = new URLSearchParams();
  if(from) params.set('date_from', new Date(from).toISOString());
  if(to)   params.set('date_to',   new Date(to).toISOString());
  if(kind) params.set('kind', kind);
  if(tod)  params.set('tod', tod);

  const geoLink = document.getElementById('geojsonLink');
  if (geoLink) geoLink.href = `/api/export/checkins.geojson?${params.toString()}`;

  try{
    // 1) Heatmap
    const h = await fetch(`/api/stats/heatmap?${params.toString()}`).then(r=>r.json());
    if(h.ok){
      const data = h.points.map(p => ({lat: p[0], lng: p[1], value: p[2] || 1}));
      setHeatData(data); // ★キャッシュ経由で適用
      if(data.length){
        const bounds = L.latLngBounds(data.map(d=>[d.lat,d.lng]));
        heatmapMap.fitBounds(bounds.pad(0.2));
      }
    }

    // 2) 時系列（日別）
    const t = await fetch(`/api/stats/timeseries?bucket=day&${params.toString()}`).then(r=>r.json());
    if(t.ok){
      const labels = t.items.map(i=>i.t);
      const values = t.items.map(i=>i.count);
      drawTsChart(labels, values);
    }

    // 3) 種別内訳
    const k = await fetch(`/api/stats/by-kind?${params.toString()}`).then(r=>r.json());
    if(k.ok){
      const labels = k.items.map(i=>i.kind);
      const values = k.items.map(i=>i.count);
      drawKindChart(labels, values);
    }

    toast?.('分析データを更新しました');
  }catch(e){
    console.error(e); toast?.('分析データの取得に失敗', false);
  }
}

function drawTsChart(labels, values){
  const ctx = document.getElementById('tsChart');
  if(!ctx) return;
  if(tsChart) tsChart.destroy();
  tsChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'チェックイン（日別）', data: values }] },
    options: { responsive: true, maintainAspectRatio:false }
  });
}

function drawKindChart(labels, values){
  const ctx = document.getElementById('kindChart');
  if(!ctx) return;
  if(kindChart) kindChart.destroy();
  kindChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: '種別内訳', data: values }] },
    options: { responsive: true, maintainAspectRatio:false }
  });
}

// スライダ変更 → レイヤ再生成（configure は使わない）
function applyHeatConfig(){
  const rEl = document.getElementById('heatRadius');
  const oEl = document.getElementById('heatOpacity');
  const mEl = document.getElementById('heatMax');

  const r = Number(rEl ? rEl.value : heatCfg.radius);
  const o = Number(oEl ? oEl.value : heatCfg.maxOpacity);
  const m = Number(mEl ? mEl.value : heatCfg.maxValue);

  heatCfg.radius = r; heatCfg.maxOpacity = o; heatCfg.maxValue = m;

  // 表示に反映（nullガード）
  const rSpan = document.getElementById('heatRadiusVal');
  const oSpan = document.getElementById('heatOpacityVal');
  const mSpan = document.getElementById('heatMaxVal');
  if (rSpan) rSpan.textContent = r;
  if (oSpan) oSpan.textContent = o.toFixed(2);
  if (mSpan) mSpan.textContent = m;

  // レイヤを作り直し、直近データを再適用
  if (heatmapMap) buildHeatmapOverlay();
}
// ===================== /ヒートマップ / ダッシュボード =====================
// ===== ARタップゲーム（逃げるマーモット） =====
// ===== ARサツマイモ投げゲーム =====
let AR = {
  running: false,
  stream: null,
  raf: 0,
  marmotImg: null,
  yamImg: null,
  // marmot（動く的）
  mx: 150, my: 100, mw: 110, mh: 110, mvx: 1.6, mvy: 1.2,
  // 投擲物
  shots: [], // {x,y,vx,vy,r}
  // 入力
  dragging: false, sx: 0, sy: 0, ex: 0, ey: 0,
  // クリア
  hit: false,
};

function vecLen(x,y){ return Math.hypot(x,y); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

// サツマイモ投げ ARゲーム（1回でも当たればクリア）
async function startYamGame(character){
  // 必須要素取得
  const nameEl = document.getElementById('charName');
  const video  = document.getElementById('arVideo');
  const canvas = document.getElementById('arCanvas');
  const hint   = document.getElementById('arHint');
  if(!video || !canvas){ console.warn('AR video/canvas not found'); return; }
  const ctx = canvas.getContext('2d');

  // 共有状態（無ければ初期化）
  if (typeof window.AR !== 'object') window.AR = {};
  Object.assign(AR, {
    running: false, stream: null, raf: 0,
    marmotImg: null, yamImg: null,
    // 的（マーモット）
    mx: 150, my: 100, mw: 110, mh: 110, mvx: 1.6, mvy: 1.2,
    // 投擲物
    shots: [], // {x,y,vx,vy,r}
    // 入力ドラッグ
    dragging: false, sx: 0, sy: 0, ex: 0, ey: 0,
    // 成功
    hit: false,
    currentCharacter: {
      name: character?.name || 'マーモット',
      image: character?.image || character?.sprite || '/static/characters/marmot.png'
    }
  });

  // 画面ラベル
  if (nameEl) nameEl.textContent = `${AR.currentCharacter.name} を当てよう！`;
  if (hint)   hint.textContent   = 'ドラッグしてサツマイモ投げ！（1回当たればゲット）';

  // ---------- 補助関数 ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const vecLen = (x,y) => Math.hypot(x,y);
  const loadImage = (url)=> new Promise((res, rej)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>res(img);
    img.onerror = rej;
    img.src = url;
  });
  const pointerPos = (ev)=>{
    const t = ev.touches?.[0] || ev;
    const rect = canvas.getBoundingClientRect();
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const circleRectHit = (cx, cy, cr, rx, ry, rw, rh)=>{
    const nx = clamp(cx, rx, rx+rw);
    const ny = clamp(cy, ry, ry+rh);
    const dx = cx - nx, dy = cy - ny;
    return (dx*dx + dy*dy) <= cr*cr;
  };
  const throwYam = ()=>{
    // ドラッグの反対方向に投げる（スリングショット）
    const dx = AR.sx - AR.ex;
    const dy = AR.sy - AR.ey;
    const k = 0.06; // 速度スケール
    AR.shots.push({ x: AR.sx, y: AR.sy, vx: dx*k, vy: dy*k, r: 18 });
    AR.sx = AR.ex; AR.sy = AR.ey;
  };

  // ---------- 画像ロード ----------
  AR.marmotImg = await loadImage(AR.currentCharacter.image);
  AR.yamImg    = await loadImage('/static/stamp/yam.png').catch(()=>null); // なくてもOK（丸で代用）

  // ---------- Canvas DPI/サイズ ----------
  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width  = Math.floor(rect.width  * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);
    // 的のスケール
    AR.mw = Math.max(90, Math.min(140, rect.width * 0.22));
    AR.mh = AR.mw;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });

  // ---------- iOS向け video 属性 ----------
  video.setAttribute('playsinline','');
  video.setAttribute('webkit-playsinline','true');
  video.setAttribute('autoplay','');
  video.setAttribute('muted','');

  // ---------- カメラ起動（背面→前面フォールバック） ----------
  try{
    AR.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal:'environment' } }, audio:false
    });
  }catch{
    try{
      AR.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }, audio:false
      });
    }catch(e){
      console.warn('getUserMedia failed:', e);
    }
  }
  if (AR.stream) video.srcObject = AR.stream;

  // ---------- 入力（パッシブfalse＋preventDefaultで画面揺れ防止） ----------
  const onDown = (ev)=>{
    ev.preventDefault();
    AR.dragging = true;
    const p = pointerPos(ev);
    AR.sx = AR.ex = p.x; AR.sy = AR.ey = p.y;
  };
  const onMove = (ev)=>{
    if(!AR.dragging) return;
    ev.preventDefault();
    const p = pointerPos(ev);
    AR.ex = p.x; AR.ey = p.y;
  };
  const onUp = (ev)=>{
    if(!AR.dragging) return;
    ev.preventDefault();
    const p = pointerPos(ev);
    AR.ex = p.x; AR.ey = p.y;
    AR.dragging = false;
    throwYam();
  };
  canvas.addEventListener('pointerdown', onDown, { passive:false });
  canvas.addEventListener('pointermove', onMove, { passive:false });
  canvas.addEventListener('pointerup',   onUp,   { passive:false });
  canvas.addEventListener('pointercancel', ()=> (AR.dragging=false), { passive:false });

  // ---------- 初期化 ----------
  {
    const rect = canvas.getBoundingClientRect();
    AR.mx = rect.width * 0.35; AR.my = rect.height * 0.35;
    AR.mvx = 1.6; AR.mvy = 1.2;
    AR.shots = [];
    AR.hit = false;
    AR.running = true;
  }

  // ---------- ループ（背景は <video> に任せ、Canvas は前景のみ描画） ----------
  let t0 = performance.now();
  function loop(t){
    if(!AR.running) return;
    const dt = Math.min(32, t - t0); t0 = t;

    // 背景は video DOM（黒帯対策）。Canvas は毎フレーム透明クリア
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // 的の移動（壁バウンド）
    const crect = canvas.getBoundingClientRect();
    AR.mx += AR.mvx * (dt/16);
    AR.my += AR.mvy * (dt/16);
    const pad = 8;
    if (AR.mx < pad) { AR.mx = pad; AR.mvx = Math.abs(AR.mvx); }
    if (AR.my < pad) { AR.my = pad; AR.mvy = Math.abs(AR.mvy); }
    if (AR.mx + AR.mw > crect.width - pad)  { AR.mx = crect.width  - pad - AR.mw; AR.mvx = -Math.abs(AR.mvx); }
    if (AR.my + AR.mh > crect.height - pad) { AR.my = crect.height - pad - AR.mh; AR.mvy = -Math.abs(AR.mvy); }

    // 投擲物の更新（重力＋抵抗）
    const g = 0.45, drag = 0.998;
    AR.shots.forEach(s => { s.vy += g; s.x += s.vx; s.y += s.vy; s.vx *= drag; s.vy *= drag; });
    AR.shots = AR.shots.filter(s => s.x>-80 && s.x<crect.width+80 && s.y>-80 && s.y<crect.height+80);

    // 当たり判定（円×矩形）
    for (const s of AR.shots){
      if (circleRectHit(s.x, s.y, s.r, AR.mx, AR.my, AR.mw, AR.mh)){
        AR.hit = true;
        // 成功処理（モーダルや共有は外側の finishYamGame に任せる）
        finishYamGame?.(true);
        return;
      }
    }

    // 弾の描画
    for (const s of AR.shots){
      if (AR.yamImg){
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate((s.x+s.y)*0.02);
        const w = s.r*2, h = s.r*2;
        ctx.drawImage(AR.yamImg, -w/2, -h/2, w, h);
        ctx.restore();
      }else{
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
        ctx.fillStyle = '#7c2d12'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#facc15'; ctx.stroke();
      }
    }

    // 的の描画（影付き）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 6;
    ctx.drawImage(AR.marmotImg, AR.mx, AR.my, AR.mw, AR.mh);
    ctx.restore();

    // ガイド（ドラッグ中の照準線）
    if (AR.dragging){
      ctx.beginPath(); ctx.moveTo(AR.sx, AR.sy); ctx.lineTo(AR.ex, AR.ey);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(AR.sx, AR.sy, 6, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
    }

    if (hint && !AR.hit){
      const v = vecLen(AR.ex-AR.sx, AR.ey-AR.sy);
      hint.textContent = AR.dragging
        ? `離すと投げる（強さ: ${Math.round(v)})`
        : 'ドラッグしてサツマイモを投げよう';
    }

    AR.raf = requestAnimationFrame(loop);
  }
  AR.raf = requestAnimationFrame(loop);
}


// function drawBackground(video, ctx, canvas){
//   if (video.readyState >= 2) {
//     const vw = video.videoWidth, vh = video.videoHeight;
//     const cw = canvas.width, ch = canvas.height;
//     const vRatio = vw / vh, cRatio = cw / ch;
//     let dw, dh, dx, dy;
//     if (vRatio > cRatio){ dw = cw; dh = cw / vRatio; dx = 0; dy = (ch - dh)/2; }
//     else{ dh = ch; dw = ch * vRatio; dy = 0; dx = (cw - dw)/2; }
//     ctx.drawImage(video, dx, dy, dw, dh);
//   }else{
//     ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
//   }
// }

function drawYam(ctx, x, y, r){
  if (AR.yamImg){
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((x+y) * 0.02); // くるっと回す
    const w = r*2, h = r*2;
    ctx.drawImage(AR.yamImg, -w/2, -h/2, w, h);
    ctx.restore();
  }else{
    // 画像が無い場合の簡易描画
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = '#7c2d12'; // さつまいも色
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#facc15'; ctx.stroke();
  }
}

function circleRectHit(cx, cy, cr, rx, ry, rw, rh){
  // 円と矩形の最短距離が半径以内ならヒット
  const nx = clamp(cx, rx, rx+rw);
  const ny = clamp(cy, ry, ry+rh);
  const dx = cx - nx, dy = cy - ny;
  return (dx*dx + dy*dy) <= cr*cr;
}

function throwYam(){
  // ドラッグの反対方向に投げる（スリングショット）
  const dx = AR.sx - AR.ex;
  const dy = AR.sy - AR.ey;
  const power = clamp(vecLen(dx,dy), 10, 400);
  const k = 0.06; // 速度スケール
  const vx = dx * k;
  const vy = dy * k;
  const r = 18; // 半径
  AR.shots.push({ x: AR.sx, y: AR.sy, vx, vy, r });
  // 投げた後は始点を末端に戻す
  AR.sx = AR.ex; AR.sy = AR.ey;
}


// クリア処理でゲット確認モーダルを開く
function finishYamGame(success){
  if (!AR.running) return;
  AR.running = false;
  cancelAnimationFrame(AR.raf);

  try{
    if (AR.stream){
      AR.stream.getTracks().forEach(tr => tr.stop());
      AR.stream = null;
    }
  }catch(_){}

  const hint = document.getElementById('arHint');
  if (hint) hint.textContent = success ? '命中！ゲット🎉' : 'また挑戦してね';
  if (success){
    toast('命中！スタンプをゲット！');
    // ★ ゲット確認を表示（図鑑へ誘導）
    openGotModal(AR.currentCharacter);
  }
}


function stopYamGame(){ finishYamGame(false); }
function restartMarmotGame(){
  const name = document.getElementById('charName')?.textContent?.replace(' を当てよう！','') || 'スタンプ';
  startYamGame({ name, image: AR?.marmotImg?.src || '/static/stamp/marmot.png' });
}

function loadImage(url){
  return new Promise((res, rej)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>res(img);
    img.onerror = rej;
    img.src = url;
  });
}
// ===== /ARサツマイモ投げゲーム =====

// ===== ゲット確認モーダル =====
function openGotModal(ch){
  const m = document.getElementById('gotModal');
  if(!m) return;
  document.getElementById('gotImg').src = ch?.image || ch?.sprite || '/static/stamp/marmot.png';
  document.getElementById('gotName').textContent = ch?.name || 'スタンプ';
  m.style.display = 'flex';
}
function closeGotModal(){
  const m = document.getElementById('gotModal');
  if(m) m.style.display = 'none';
}
async function shareGot(){
  // Web Share API（対応端末のみ）。非対応ならクリップボードにコピー
  const title = 'スタンプをゲット！';
  const text  = document.getElementById('gotName').textContent + ' を手に入れたよ';
  const url   = location.href;
  if (navigator.share){
    try{ await navigator.share({ title, text, url }); }catch(_){}
  } else if (navigator.clipboard){
    try{ await navigator.clipboard.writeText(`${title}\n${text}\n${url}`); toast('リンクをコピーしました'); }catch(_){}
  } else {
    alert('共有に対応していない端末です');
  }
}
// ===== /ゲット確認モーダル =====
// いちばん下にある `init();` を削除して、代わりにこれを追加
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
// 検索パネルの開閉
function toggleSearch() {
  const panel = document.getElementById('searchPanel');
  if (!panel) return;

  // 表示・非表示を切り替え
  if (panel.style.display === 'block') {
    panel.style.display = 'none';
  } else {
    panel.style.display = 'block';
    // パネルを開いたら入力欄にカーソルを合わせる
    const input = document.getElementById('searchInput');
    if (input) input.focus();
  }
}

// 検索のクリアボタン用
function clearSearch() {
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  const results = document.getElementById('searchResults');
  if (results) results.innerHTML = '';
}
