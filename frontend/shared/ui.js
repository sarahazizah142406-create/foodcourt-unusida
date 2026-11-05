/* ============================================================
   Helper bersama: API, ikon, toast, modal, konfirmasi, kompres gambar
   Dipakai oleh customer, kantin, dan dev (tanpa library eksternal).
   ============================================================ */
(function () {
  const API = window.FOODCOURT_API_BASE || "http://localhost:3000";

  // ---------- IKON (SVG inline) ----------
  const ICONS = {
    "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    store: '<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9h18v0a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 12v8h14v-8"/><path d="M10 20v-4h4v4"/>',
    utensils: '<path d="M4 3v7a2 2 0 0 0 2 2v9"/><path d="M8 3v7"/><path d="M12 3v7a2 2 0 0 1-2 2"/><path d="M18 21V3c-2.5 1.5-4 4.5-4 8v2h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    receipt: '<path d="M4 2v20l3-2 2.5 2 2.5-2 2.5 2 2.5-2 3 2V2l-3 2-2.5-2-2.5 2-2.5-2L7 4z"/><path d="M8 9h8M8 13h8"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    refresh: '<path d="M21 12a9 9 0 0 0-15.5-6.3L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15.5 6.3L21 16"/><path d="M21 21v-5h-5"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M16 7l3 3M14 9l2 2"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1"/><path d="M16 14h.01"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.38 0 2.5-1.12 2.5-2.5 0-1.63-1.07-2.68-1.74-3.34A12.75 12.75 0 0 1 10.1 7c-.24 1.8-.82 3.12-1.6 4.16-.7 1-1 2.05-1 3.34z"/><path d="M12 2c1 3 4 4.5 4 8.5a7.5 7.5 0 1 1-15 0C1 6.5 6 4 7.5 2c0 2 1.5 3 2.5 3s1.5-1 2-3z"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1z"/>'
  };
  function icon(name, cls = "") {
    return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  }

  // ---------- UTIL ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const rupiah = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
  const jam = (d) => new Date(d).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const tanggal = (d) => new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  // URL gambar dari server hanya boleh https:// atau data:image (cegah javascript: dsb)
  const safeImg = (u) => (typeof u === "string" && /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(u) ? u : "");

  // ---------- API ----------
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  async function api(path, { method = "GET", body, token, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: payload });
    } catch {
      throw new ApiError("Tidak bisa terhubung ke server. Periksa koneksi internetmu.", 0);
    }
    let data = null;
    try { data = await res.json(); } catch { /* bukan JSON */ }
    if (!res.ok) throw new ApiError((data && data.message) || "Terjadi kesalahan, coba lagi", res.status);
    return data;
  }

  // ---------- SOCKET ----------
  function connectSocket(token) {
    if (typeof io !== "function") return null;
    return io(API, { auth: token ? { token } : {}, transports: ["websocket", "polling"] });
  }

  // ---------- TOAST ----------
  function toast(msg, type = "") {
    let box = document.querySelector(".toasts");
    if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.setAttribute("role", "status");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), type === "error" ? 4200 : 2600);
  }

  // ---------- MODAL ----------
  function openSheet(html) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    const close = () => {
      overlay.remove();
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    return { el: overlay.firstElementChild, overlay, close };
  }

  function confirmDialog({ title, message, okText = "Ya", cancelText = "Batal", danger = false }) {
    return new Promise((resolve) => {
      const s = openSheet(`
        <div class="sheet-head"><div><h3>${esc(title)}</h3><p>${esc(message || "")}</p></div></div>
        <div class="sheet-actions">
          <button class="btn ghost" data-act="no">${esc(cancelText)}</button>
          <button class="btn ${danger ? "danger" : ""}" data-act="yes">${esc(okText)}</button>
        </div>`);
      let done = false;
      const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
      s.el.querySelector('[data-act="yes"]').addEventListener("click", () => finish(true));
      s.el.querySelector('[data-act="no"]').addEventListener("click", () => finish(false));
      s.overlay.addEventListener("mousedown", (e) => { if (e.target === s.overlay) finish(false); });
    });
  }

  // ---------- KOMPRES GAMBAR (di browser, sebelum upload) ----------
  // format "jpeg" untuk foto menu, "png" untuk QRIS (supaya tetap tajam & terbaca scanner)
  async function compressImage(file, { max = 900, format = "jpeg", quality = 0.82 } = {}) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Pilih gambar JPG, PNG, atau WebP");
    let imgSource;
    try {
      imgSource = await createImageBitmap(file);
    } catch {
      imgSource = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Format gambar tidak didukung"));
        img.src = URL.createObjectURL(file);
      });
    }
    const width = imgSource.width || imgSource.naturalWidth || max;
    const height = imgSource.height || imgSource.naturalHeight || max;
    const scale = Math.min(1, max / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (format === "jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(imgSource, 0, 0, w, h);
    if (imgSource.close) { try { imgSource.close(); } catch {} }
    const blob = await new Promise((r) => canvas.toBlob(r, "image/" + format, quality));
    if (!blob) throw new Error("Gagal memproses gambar");
    return new File([blob], "gambar." + (format === "png" ? "png" : "jpg"), { type: blob.type });
  }

  // Penyimpanan lokal yang aman (tidak crash kalau diblokir browser)
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* abaikan */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } }
  };

  // ---------- suara notifikasi (Web Audio, tanpa file audio) ----------
  // Browser baru mau bersuara setelah pengguna menyentuh layar sekali, jadi AudioContext dibuka saat sentuhan pertama.
  // ---------- suara notifikasi (Web Audio, tanpa file audio) ----------
  // Menggunakan gelombang triangle yang nyaring di speaker HP + getar (vibration API)
  const sound = (() => {
    let ctx = null, master = null;
    let on = store.get("fc_sound", true);
    const AC = window.AudioContext || window.webkitAudioContext;
    const ensure = () => {
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        // rantai master: gain -> compressor -> speaker, supaya bunyi lebih keras & padat tanpa pecah
        master = ctx.createGain(); master.gain.value = 1;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -24; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.15;
        master.connect(comp); comp.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    };
    // [frekuensi Hz, mulai (detik), lama (detik)] — diulang beberapa kali supaya sulit terlewat
    const seq = (base, times, gap) => Array.from({ length: times }, (_, i) => base.map(([f, at, d]) => [f, at + i * gap, d])).flat();
    const PATTERNS = {
      order: seq([[784, 0, 0.18], [1046, 0.2, 0.25], [784, 0.55, 0.18], [1046, 0.75, 0.35]], 3, 1.5), // pesanan baru masuk (kasir), ±4 dtk
      paid:  seq([[523, 0, 0.14], [659, 0.14, 0.14], [784, 0.28, 0.14], [1046, 0.44, 0.32]], 2, 0.95), // pembayaran berhasil
      ready: seq([[659, 0, 0.15], [784, 0.16, 0.15], [988, 0.32, 0.18], [1319, 0.52, 0.38]], 3, 1.2),  // pesanan siap diambil
      tap:   [[660, 0, 0.08]]
    };
    const play = (name, force = false) => {
      if (!on && !force) return;
      try {
        const c = ensure();
        if (c) {
          (PATTERNS[name] || PATTERNS.tap).forEach(([f, at, dur]) => {
            // dua lapis: triangle (jernih) + square (tajam, menembus keramaian kantin)
            [["triangle", 1], ["square", 0.35]].forEach(([type, peak]) => {
              const o = c.createOscillator(), g = c.createGain();
              o.type = type;
              o.frequency.value = f;
              o.connect(g); g.connect(master);
              const t = c.currentTime + at;
              g.gain.setValueAtTime(0.0001, t);
              g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
              g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
              o.start(t); o.stop(t + dur + 0.04);
            });
          });
        }
      } catch { /* audio diblokir browser */ }
      // Getar ponsel
      try {
        if (navigator.vibrate) {
          if (name === "order") navigator.vibrate([500, 150, 500, 150, 500, 150, 700]);
          else if (name === "ready") navigator.vibrate([400, 120, 400, 120, 400, 120, 600]);
          else if (name === "paid") navigator.vibrate([250, 100, 250, 100, 250]);
        }
      } catch {}
    };
    const unlock = () => { try { ensure(); } catch {} };
    ["pointerdown", "touchstart", "click", "touchend"].forEach((ev) => {
      document.addEventListener(ev, unlock, { once: true, passive: true });
    });
    // Ulangi pengingat sampai pengguna menyentuh layar (atau batas maksimal tercapai)
    let nagTimer = null;
    const stopNag = () => { if (nagTimer) { clearInterval(nagTimer); nagTimer = null; } };
    const nag = (name, { every = 20000, max = 5 } = {}) => {
      stopNag();
      let n = 0; const t0 = Date.now();
      nagTimer = setInterval(() => { if (++n > max) return stopNag(); play(name); }, every);
      const off = () => { if (Date.now() - t0 > 1500) { stopNag(); document.removeEventListener("pointerdown", off); } };
      document.addEventListener("pointerdown", off);
    };
    return { get on() { return on; }, set(v) { on = !!v; store.set("fc_sound", on); }, play, unlock, nag, stopNag };
  })();

  // ---------- notifikasi sistem (muncul walau tab/aplikasi di latar belakang / layar redup) ----------
  const notify = (() => {
    const supported = "Notification" in window;
    let reg = null;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((r) => { reg = r; }).catch(() => {});
    }
    const permission = () => (supported ? Notification.permission : "unsupported");
    const ask = async () => {
      if (!supported || Notification.permission !== "default") return permission();
      try { return await Notification.requestPermission(); } catch { return "denied"; }
    };
    const show = async (title, body, { tag, always = false } = {}) => {
      if (!supported || Notification.permission !== "granted") return false;
      if (!always && !document.hidden) return false;
      const opts = {
        body,
        tag,
        renotify: !!tag,
        icon: window.FOODCOURT_LOGO || "/assets/logo.png",
        badge: window.FOODCOURT_LOGO || "/assets/logo.png",
        vibrate: [500, 150, 500, 150, 500, 150, 700], silent: false,
        requireInteraction: true,
        data: { url: location.pathname + location.search + location.hash }
      };
      try {
        const r = reg || (navigator.serviceWorker && (await navigator.serviceWorker.ready));
        if (r && r.showNotification) { await r.showNotification(title, opts); return true; }
      } catch {}
      try { new Notification(title, opts); return true; } catch { return false; }
    };
    return { supported, permission, ask, show };
  })();

  // judul tab berkedip saat ada kabar penting dan tab tidak sedang dilihat
  const attention = (() => {
    let timer = null, base = document.title;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; document.title = base; } };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) stop(); });
    return (text) => {
      if (!document.hidden || timer) return;
      base = document.title;
      let on = false;
      timer = setInterval(() => { on = !on; document.title = on ? text : base; }, 600);
    };
  })();

  // Layar tetap menyala (Screen Wake Lock) agar dashboard kasir / notifikasi tidak tertidur saat sepi
  const keepAwake = (() => {
    let sentinel = null;
    const enable = async () => {
      try {
        if ("wakeLock" in navigator && !sentinel) {
          sentinel = await navigator.wakeLock.request("screen");
          sentinel.addEventListener("release", () => { sentinel = null; });
        }
      } catch {}
    };
    const disable = () => {
      if (sentinel) { try { sentinel.release(); } catch {} sentinel = null; }
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !sentinel) enable();
    });
    return { enable, disable };
  })();

  window.FC = { API, api, ApiError, icon, esc, rupiah, jam, tanggal, $, $$, safeImg, toast, openSheet, confirmDialog, compressImage, connectSocket, store, sound, notify, attention, keepAwake };
})();

// ---------- Tombol mata: tampilkan / sembunyikan password di semua input password ----------
(function () {
  const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const EYE = svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
  const EYE_OFF = svg('<path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>');
  function enhance(input) {
    if (input.dataset.eye) return;
    input.dataset.eye = "1";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.style.paddingRight = "46px";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Tampilkan password");
    btn.innerHTML = EYE;
    btn.style.cssText = "position:absolute;right:6px;top:50%;transform:translateY(-50%);width:36px;height:36px;display:grid;place-items:center;border:0;background:transparent;color:var(--muted);cursor:pointer;border-radius:8px";
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute("aria-label", show ? "Sembunyikan password" : "Tampilkan password");
      input.focus();
    });
    wrap.appendChild(btn);
  }
  const scan = (root) => root.querySelectorAll && root.querySelectorAll('input[type="password"]').forEach(enhance);
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    if (n.matches && n.matches('input[type="password"]')) enhance(n); else scan(n);
  }))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => scan(document));
})();
