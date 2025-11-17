// static/login.js 〈完成版〉
async function me(){
  const r = await fetch('/me', { credentials:'include' });
  try{
    const j = await r.json();
    return (j && j.id) ? j : null;
  }catch{
    return null;
  }
}


async function register() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const res = await fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // ← 登録はJSONでOK
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    alert("登録完了。続けてログインしてください。");
  } else {
    alert("登録失敗: " + (data?.detail || data?.msg || res.status));
  }
}
async function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("メールとパスワードを入力してください");
    return;
  }

  const body = new URLSearchParams({ email, password });

  const r = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'follow',
    cache: 'no-store',
  });

  if (r.redirected) { location.href = r.url; return; }
  if (r.ok) { location.href = '/home'; return; }
  alert('ログイン失敗: ' + (await r.text()));
}


// 末尾に一発：古いJSキャッシュ対策（自分自身を無効化）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
}



function googleLogin(){ location.href = '/auth/google/login'; }
function lineLogin(){ location.href = '/auth/line/login'; }

async function guestStart(){
  const r = await fetch('/auth/guest',{
    method:'POST',
    credentials:'include'                  // ★ 追加：クッキー送受信
  });
  if(!r.ok){
    alert('ゲスト開始に失敗');
    return;
  }
  // ★ 保存確認してから遷移
  const u = await me();
  if(u && u.id){
    location.href = '/';
  }else{
    alert('ゲストセッションを確認できませんでした。ブラウザのCookie設定を確認してください。');
  }
}

// 既ログインなら / へ
me().then(u => { if(u){ location.href = '/'; }});
