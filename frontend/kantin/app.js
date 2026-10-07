/* ============================================================
   Dashboard Kantin — pesanan masuk realtime, menu, laporan, QRIS
   ============================================================ */
const { api, esc, rupiah, jam, tanggal, icon, toast, safeImg, store, openSheet, confirmDialog, compressImage, $, $$ } = FC;

const STEPS = ["diterima", "diproses", "siap", "diambil"];
const STEP_LABEL = { diterima: "Baru masuk", diproses: "Diproses", siap: "Siap diambil", diambil: "Selesai" };
const NEXT_LABEL = { diterima: "Mulai proses", diproses: "Tandai siap", siap: "Sudah diambil" };

const state = {
  token: store.get("fc_kasir_token"),
  user: store.get("fc_kasir_user"),
  me: null,
  tab: "pesanan",
  filter: "aktif",
  orders: [],
  menus: [],
  menuQuery: "",
  freshIds: new Set(),
  sound: store.get("fc_sound", true)
};
const $root = document.getElementById("root");
const tokenCall = (path, opt = {}) => api(path, { ...opt, token: state.token });

function logout(msg) {
  store.del("fc_kasir_token"); store.del("fc_kasir_user");
  state.token = null; state.user = null; state.me = null;
  if (socket) { socket.disconnect(); socket = null; }
  clearInterval(poll);
  if (msg) toast(msg, "error");
  render();
}
// error handler: sesi habis -> kembali ke login
function fail(e, fallback) {
  if (e.status === 401 || e.status === 403) return logout("Sesi habis, silakan login lagi");
  toast(e.message || fallback, "error");
}

// ---------- LOGIN ----------
function renderLogin() {
  $root.innerHTML = `
    <div class="login-wrap"><form class="login-box" id="f" autocomplete="on">
      <div class="logo">${icon("store")}</div>
      <h1>Dashboard Kantin</h1><p>Food Court UNUSIDA — masuk untuk mengelola pesanan kantinmu.</p>
      <div class="field"><label for="u">Username</label><input class="input" id="u" autocomplete="username" autocapitalize="none" required></div>
      <div class="field"><label for="p">Password</label><input class="input" id="p" type="password" autocomplete="current-password" required></div>
      <div class="form-error" id="err" hidden></div>
      <button class="btn block" id="go" style="margin-top:14px">Masuk</button>
    </form></div>`;
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#err"); err.hidden = true;
    const btn = $("#go"); btn.disabled = true; btn.textContent = "Masuk...";
    try {
      const r = await api("/api/kasir/login", { method: "POST", body: { username: $("#u").value.trim(), password: $("#p").value } });
      state.token = r.token; state.user = { username: r.username, nama_kantin: r.nama_kantin, tenant_id: r.tenant_id };
      store.set("fc_kasir_token", state.token); store.set("fc_kasir_user", state.user);
      render();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Masuk";
    }
  });
}

// ---------- KERANGKA ----------
let socket = null, poll = null, audioCtx = null;

function beep() {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = "sine"; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
  } catch { /* browser memblokir audio, abaikan */ }
}

async function renderShell() {
  document.body.classList.add("has-tabbar");
  $root.innerHTML = `
    <header class="top"><div class="wrap">
      <div class="row">
        <div class="who"><div class="logo">${icon("store")}</div><div style="min-width:0"><h1 id="kName">${esc(state.user?.nama_kantin || "Kantin")}</h1><small>@${esc(state.user?.username || "")}</small></div></div>
        <button class="open-switch" id="openSw" title="Buka / tutup kantin"><span class="knob"></span><span id="openTxt">...</span></button>
        <button class="btn ghost icon sound-btn" id="soundBtn" aria-label="Suara notifikasi" aria-pressed="${state.sound}" title="Suara pesanan baru">${icon("bell")}</button>
        <button class="btn ghost icon" id="outBtn" aria-label="Keluar" title="Keluar">${icon("logout")}</button>
      </div>
    </div></header>
    <nav class="tabbar dock" id="tabs" aria-label="Navigasi dashboard">
      <button class="tab" data-tab="pesanan">${icon("receipt")}Pesanan<span class="count" id="cnt" hidden></span></button>
      <button class="tab" data-tab="menu">${icon("utensils")}Menu</button>
      <button class="tab" data-tab="laporan">${icon("chart")}Laporan</button>
      <button class="tab" data-tab="qris">${icon("qr")}QRIS</button>
    </nav>
    <main><div class="wrap" id="content"></div></main>`;

  $("#outBtn").addEventListener("click", async () => { if (await confirmDialog({ title: "Keluar dari dashboard?", okText: "Keluar" })) logout(); });
  $("#soundBtn").addEventListener("click", (e) => {
    state.sound = !state.sound; store.set("fc_sound", state.sound);
    e.currentTarget.setAttribute("aria-pressed", state.sound); toast(state.sound ? "Suara notifikasi aktif" : "Suara notifikasi mati");
    if (state.sound) beep();
  });
  $("#openSw").addEventListener("click", toggleOpen);
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { state.tab = b.dataset.tab; drawTab(); } });

  try { state.me = await tokenCall("/api/kasir/me"); } catch (e) { return fail(e); }
  drawOpenSwitch();
  drawTab();
  connectRealtime();
  clearInterval(poll);
  poll = setInterval(() => { if (state.tab === "pesanan" && !document.hidden) loadOrders(true); }, 30000);
}

function drawOpenSwitch() {
  const on = state.me?.status === "buka";
  $("#openSw").classList.toggle("on", on);
  $("#openTxt").textContent = on ? "Buka" : "Tutup";
}
async function toggleOpen() {
  const next = state.me.status === "buka" ? "tutup" : "buka";
  if (next === "tutup" && !(await confirmDialog({ title: "Tutup kantin?", message: "Pelanggan tidak bisa memesan sampai kamu membuka kantin lagi.", okText: "Tutup kantin" }))) return;
  try {
    await tokenCall("/api/kasir/status", { method: "PATCH", body: { status: next } });
    state.me.status = next; drawOpenSwitch(); toast(next === "buka" ? "Kantin dibuka" : "Kantin ditutup", "success");
  } catch (e) { fail(e, "Gagal mengubah status"); }
}

function drawTab() {
  $$("#tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  if (state.tab === "pesanan") viewPesanan();
  else if (state.tab === "menu") viewMenu();
  else if (state.tab === "laporan") viewLaporan();
  else viewQris();
}
const content = () => $("#content");
const loading = (t = "Memuat...") => { content().innerHTML = `<div class="state"><div class="spinner"></div>${t}</div>`; };

function connectRealtime() {
  if (socket) return;
  socket = FC.connectSocket(state.token);
  if (!socket) return;
  socket.on("connect", () => socket.emit("join_tenant_room"));
  socket.on("order_baru", (d) => {
    state.freshIds.add(d.order_tenant_id);
    toast(`Pesanan baru #${d.nomor_antrian}`, "success"); beep();
    if (state.tab === "pesanan") loadOrders(true); else refreshCount();
  });
  socket.on("bayar_klaim", (d) => {
    toast(`Pelanggan #${d.nomor_antrian} bilang sudah bayar QRIS`); beep();
    if (state.tab === "pesanan") loadOrders(true); else refreshCount();
  });
}
async function refreshCount() {
  try { state.orders = await tokenCall("/api/kasir/orders"); drawCount(); } catch { /* abaikan */ }
}
function drawCount() {
  const n = state.orders.filter((o) => o.status_order !== "diambil").length;
  const c = $("#cnt"); if (c) { c.hidden = n === 0; c.textContent = n; }
}

// ---------- TAB: PESANAN ----------
async function viewPesanan() {
  content().innerHTML = `<div id="stats" class="stats">${Array(4).fill('<div class="skeleton" style="height:84px"></div>').join("")}</div>
    <div class="section-title"><h2>Pesanan</h2><button class="btn ghost sm" id="refresh">${icon("refresh", "sm")}Muat ulang</button></div>
    <div class="chips" id="chips"></div>
    <div id="orders" style="margin-top:14px"></div>`;
  $("#refresh").addEventListener("click", () => loadOrders());
  $("#chips").addEventListener("click", (e) => { const c = e.target.closest("[data-f]"); if (c) { state.filter = c.dataset.f; drawOrders(); } });
  loadStats();
  await loadOrders();
}

async function loadStats() {
  try {
    const d = await tokenCall("/api/kasir/dashboard");
    const el = $("#stats"); if (!el) return;
    el.innerHTML = `
      <div class="card stat money"><div class="k">${icon("wallet", "sm")}Pemasukan hari ini</div><div class="v">${rupiah(d.total_pemasukan)}</div><div class="s">QRIS ${rupiah(d.pemasukan_qris)} · Cash ${rupiah(d.pemasukan_cash)}</div></div>
      <div class="card stat"><div class="k">${icon("receipt", "sm")}Pesanan hari ini</div><div class="v">${d.total_order}</div><div class="s">${d.total_selesai} selesai</div></div>
      <div class="card stat"><div class="k">${icon("clock", "sm")}Perlu diproses</div><div class="v">${d.perlu_diproses}</div></div>
      <div class="card stat"><div class="k">${icon("alert", "sm")}Belum dibayar</div><div class="v">${d.belum_bayar}</div></div>`;
  } catch (e) { if (e.status === 401 || e.status === 403) fail(e); }
}

async function loadOrders(silent = false) {
  if (!silent && $("#orders")) $("#orders").innerHTML = `<div class="state"><div class="spinner"></div>Memuat pesanan...</div>`;
  try {
    state.orders = await tokenCall("/api/kasir/orders");
    drawCount();
    if (state.tab === "pesanan") { drawOrders(); loadStats(); }
  } catch (e) { fail(e, "Gagal memuat pesanan"); if ($("#orders")) $("#orders").innerHTML = `<div class="state error">${icon("alert")}<h3>Gagal memuat pesanan</h3><p>${esc(e.message)}</p></div>`; }
}

function filtered() {
  const act = state.orders.filter((o) => o.status_order !== "diambil").sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const done = state.orders.filter((o) => o.status_order === "diambil");
  if (state.filter === "aktif") return act;
  if (state.filter === "belum") return state.orders.filter((o) => o.status_bayar === "pending");
  if (state.filter === "selesai") return done;
  return [...act, ...done];
}

function drawOrders() {
  const el = $("#orders"); if (!el) return;
  const cnt = (f) => ({
    aktif: state.orders.filter((o) => o.status_order !== "diambil").length,
    belum: state.orders.filter((o) => o.status_bayar === "pending").length,
    selesai: state.orders.filter((o) => o.status_order === "diambil").length,
    semua: state.orders.length
  })[f];
  $("#chips").innerHTML = [["aktif", "Aktif"], ["belum", "Belum bayar"], ["selesai", "Selesai"], ["semua", "Semua"]]
    .map(([f, l]) => `<button class="chip ${state.filter === f ? "active" : ""}" data-f="${f}">${l} (${cnt(f)})</button>`).join("");
  const list = filtered();
  if (!list.length) {
    el.innerHTML = `<div class="state">${icon("inbox")}<h3>${state.filter === "aktif" ? "Belum ada pesanan aktif" : "Tidak ada pesanan"}</h3><p>Pesanan baru akan muncul otomatis di sini.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="orders">${list.map(orderCard).join("")}</div>`;
}

function orderCard(o) {
  const idx = STEPS.indexOf(o.status_order);
  const pending = o.status_bayar === "pending";
  const isQris = o.metode_bayar === "qris";
  const items = o.items.map((i) => `<div class="it"><b>${i.qty}×</b><span>${esc(i.nama_menu)}</span></div>`).join("");
  return `
  <article class="card order ${state.freshIds.has(o.order_tenant_id) && idx === 0 ? "new" : ""}" data-id="${o.order_tenant_id}">
    <div class="o-head">
      <div><div class="o-q"><small>#</small>${esc(o.nomor_antrian)}</div>
        <div class="o-meta"><span>${icon("table", "sm")} <b>Meja ${esc(o.nomor_meja)}</b></span><span>${jam(o.created_at)}</span><span class="badge ${isQris ? "blue" : ""}">${isQris ? "QRIS" : "Cash"}</span></div></div>
      <span class="badge s-${o.status_order}">${STEP_LABEL[o.status_order]}</span>
    </div>
    <div class="o-items">${items}</div>
    <div class="o-note" style="font-weight:700">${icon(o.tipe_makan === "takeaway" ? "bag" : "utensils", "sm")}<span>${o.tipe_makan === "takeaway" ? "BUNGKUS" : "Makan di tempat"}</span></div>
    ${o.catatan ? `<div class="o-note">${icon("note", "sm")}<span>${esc(o.catatan)}</span></div>` : ""}
    <div class="o-total"><span>Total</span><span>${rupiah(o.subtotal)}</span></div>
    ${pending ? `
      <div class="o-pay">
        <div><span class="badge amber">Belum dibayar</span></div>
        ${isQris && o.klaim_bayar ? `<div class="claim">${icon("bell", "sm")}Pelanggan bilang sudah bayar — cek mutasi/notifikasi QRIS-mu</div>` : ""}
        <button class="btn soft sm" data-pay="${o.order_tenant_id}">${icon("check", "sm")}${isQris ? "Pembayaran masuk, tandai lunas" : "Terima tunai & tandai lunas"}</button>
      </div>` : `<div class="o-pay paid">${icon("check")}Lunas${isQris ? " via QRIS" : " (cash)"}</div>`}
    <div class="pills">${STEPS.map((s, i) => `<span class="pill ${i <= idx ? "on" : ""}"></span>`).join("")}</div>
    <div class="o-actions">
      ${idx < 3 ? `<button class="btn" data-next="${o.order_tenant_id}" data-to="${STEPS[idx + 1]}">${NEXT_LABEL[o.status_order]}</button>` : `<button class="btn ghost" disabled>Selesai</button>`}
      ${idx > 0 ? `<button class="btn ghost icon" data-prev="${o.order_tenant_id}" data-to="${STEPS[idx - 1]}" aria-label="Kembalikan ke status sebelumnya" title="Kembalikan status">${icon("chevron-left")}</button>` : ""}
    </div>
  </article>`;
}

document.addEventListener("click", async (e) => {
  const nxt = e.target.closest("[data-next],[data-prev]");
  if (nxt) {
    const id = nxt.dataset.next || nxt.dataset.prev;
    const order = state.orders.find((o) => o.order_tenant_id === Number(id));
    if (nxt.dataset.to === "diambil" && order?.status_bayar === "pending" &&
        !(await confirmDialog({ title: "Pesanan belum dibayar", message: `Pesanan #${order.nomor_antrian} belum ditandai lunas. Tetap tandai sudah diambil?`, okText: "Tetap lanjut" }))) return;
    nxt.disabled = true;
    try {
      await tokenCall(`/api/kasir/orders/${id}/status`, { method: "PATCH", body: { status_order: nxt.dataset.to } });
      state.freshIds.delete(Number(id));
      await loadOrders(true);
    } catch (err) { fail(err, "Gagal mengubah status"); nxt.disabled = false; }
    return;
  }
  const pay = e.target.closest("[data-pay]");
  if (pay) {
    pay.disabled = true;
    try {
      await tokenCall(`/api/kasir/orders/${pay.dataset.pay}/bayar`, { method: "PATCH" });
      toast("Pembayaran dicatat lunas", "success");
      await loadOrders(true);
    } catch (err) { fail(err, "Gagal menyimpan pembayaran"); pay.disabled = false; }
  }
});

// ---------- TAB: MENU ----------
async function viewMenu() {
  loading("Memuat menu...");
  try { state.menus = await tokenCall("/api/kasir/menus"); } catch (e) { fail(e); return (content().innerHTML = `<div class="state error">${icon("alert")}<h3>Gagal memuat menu</h3><p>${esc(e.message)}</p></div>`); }
  content().innerHTML = `
    <div class="section-title" style="margin-top:0"><h2>Kelola menu <span class="badge">${state.menus.length}</span></h2></div>
    <div class="toolbar">
      <div class="search">${icon("search")}<input class="input" id="mq" placeholder="Cari menu..." value="${esc(state.menuQuery)}"></div>
      <button class="btn" id="addMenu">${icon("plus", "sm")}Tambah menu</button>
    </div>
    <div id="menuList" style="margin-top:14px"></div>`;
  $("#addMenu").addEventListener("click", () => menuModal());
  $("#mq").addEventListener("input", (e) => { state.menuQuery = e.target.value; drawMenus(); });
  drawMenus();
}

function drawMenus() {
  const q = state.menuQuery.toLowerCase();
  const list = state.menus.filter((m) => m.nama_menu.toLowerCase().includes(q));
  const el = $("#menuList"); if (!el) return;
  if (!state.menus.length) { el.innerHTML = `<div class="state">${icon("utensils")}<h3>Belum ada menu</h3><p>Tambahkan menu pertama kantinmu agar bisa dipesan pelanggan.</p></div>`; return; }
  if (!list.length) { el.innerHTML = `<div class="state"><h3>Menu tidak ditemukan</h3></div>`; return; }
  el.innerHTML = `<div class="menu-list">${list.map((m) => {
    const img = safeImg(m.image_url); const ok = m.status === "tersedia";
    return `<div class="card menu-card ${ok ? "" : "sold"}" data-id="${m.id}">
      <div class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="ph">${icon("utensils")}</div>`}</div>
      <div class="info"><h4 title="${esc(m.nama_menu)}">${esc(m.nama_menu)}</h4><div class="price">${rupiah(m.harga)}</div>
        <span class="badge ${ok ? "green" : "red"}" style="margin-top:4px">${ok ? "Tersedia" : "Habis"}</span></div>
      <div class="acts">
        <button class="switch ${ok ? "on" : ""}" data-toggle="${m.id}" role="switch" aria-checked="${ok}" aria-label="${ok ? "Tandai habis" : "Tandai tersedia"}"></button>
        <div class="row-acts">
          <button class="btn ghost icon sm" data-edit="${m.id}" aria-label="Edit ${esc(m.nama_menu)}">${icon("pencil", "sm")}</button>
          <button class="btn danger-soft icon sm" data-del="${m.id}" aria-label="Hapus ${esc(m.nama_menu)}">${icon("trash", "sm")}</button>
        </div>
      </div></div>`;
  }).join("")}</div>`;
}

document.addEventListener("click", async (e) => {
  const tg = e.target.closest("[data-toggle]");
  if (tg) {
    const m = state.menus.find((x) => x.id === Number(tg.dataset.toggle)); if (!m) return;
    const next = m.status === "tersedia" ? "habis" : "tersedia";
    try { await tokenCall(`/api/kasir/menus/${m.id}/status`, { method: "PATCH", body: { status: next } }); m.status = next; drawMenus(); }
    catch (err) { fail(err, "Gagal mengubah status menu"); }
    return;
  }
  const ed = e.target.closest("[data-edit]");
  if (ed) return menuModal(state.menus.find((x) => x.id === Number(ed.dataset.edit)));
  const del = e.target.closest("[data-del]");
  if (del) {
    const m = state.menus.find((x) => x.id === Number(del.dataset.del)); if (!m) return;
    if (!(await confirmDialog({ title: `Hapus "${m.nama_menu}"?`, message: "Riwayat pesanan lama tetap tersimpan.", okText: "Hapus", danger: true }))) return;
    try { await tokenCall(`/api/kasir/menus/${m.id}`, { method: "DELETE" }); state.menus = state.menus.filter((x) => x.id !== m.id); toast("Menu dihapus"); viewMenu(); }
    catch (err) { fail(err, "Gagal menghapus menu"); }
  }
});

function menuModal(menu = null) {
  const s = openSheet(`
    <div class="sheet-head"><div><h3>${menu ? "Edit menu" : "Tambah menu"}</h3><p>Foto membantu pelanggan memilih, tapi boleh dikosongkan.</p></div>
      <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
    <div class="field"><span class="label">Foto menu</span>
      <label class="dropzone" id="dz"><input type="file" id="file" accept="image/jpeg,image/png,image/webp">
        <div id="dzInner"></div></label>
      <button type="button" class="btn danger-soft sm" id="rmImg" hidden style="justify-self:start">${icon("trash", "sm")}Hapus foto</button></div>
    <div class="field"><label for="nm">Nama menu</label><input class="input" id="nm" maxlength="100" placeholder="Contoh: Nasi Goreng Spesial" value="${esc(menu?.nama_menu || "")}"></div>
    <div class="field"><label for="hg">Harga</label><div class="input-group"><span>Rp</span><input class="input" id="hg" type="number" inputmode="numeric" min="1" step="500" placeholder="15000" value="${menu?.harga || ""}"></div></div>
    <div class="form-error" id="err" hidden></div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Simpan</button></div>`);
  let picked = null, removeOld = false, current = safeImg(menu?.image_url);
  const drawDz = () => {
    $("#dzInner", s.el).innerHTML = current
      ? `<img src="${esc(current)}" alt="Pratinjau"><small>Ketuk untuk ganti foto</small>`
      : `${icon("image")}<strong>Pilih foto</strong><small>JPG, PNG, atau WebP</small>`;
    $("#rmImg", s.el).hidden = !current;
  };
  drawDz();
  $("#file", s.el).addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { picked = await compressImage(f, { max: 800, format: "jpeg", quality: 0.82 }); current = URL.createObjectURL(picked); removeOld = false; drawDz(); }
    catch (ex) { $("#err", s.el).textContent = ex.message; $("#err", s.el).hidden = false; }
  });
  $("#rmImg", s.el).addEventListener("click", () => { picked = null; current = ""; removeOld = Boolean(menu?.image_url); $("#file", s.el).value = ""; drawDz(); });
  $("#save", s.el).addEventListener("click", async (ev) => {
    const err = $("#err", s.el); err.hidden = true;
    const nama = $("#nm", s.el).value.trim(); const harga = Number($("#hg", s.el).value);
    if (!nama || !Number.isSafeInteger(harga) || harga <= 0) { err.textContent = "Isi nama menu dan harga (angka bulat lebih dari 0)."; err.hidden = false; return; }
    const form = new FormData();
    form.append("nama_menu", nama); form.append("harga", String(harga));
    if (picked) form.append("foto", picked);
    if (removeOld) form.append("hapus_foto", "true");
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = "Menyimpan...";
    try {
      await tokenCall(menu ? `/api/kasir/menus/${menu.id}` : "/api/kasir/menus", { method: menu ? "PUT" : "POST", form });
      s.close(); toast(menu ? "Menu diperbarui" : "Menu ditambahkan", "success"); viewMenu();
    } catch (ex) {
      if (ex.status === 401) return fail(ex);
      err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = "Simpan";
    }
  });
}

// ---------- TAB: LAPORAN ----------
const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const laporanState = { preset: "hari", dari: iso(new Date()), sampai: iso(new Date()) };

function presetRange(p) {
  const now = new Date(), start = new Date();
  if (p === "7") start.setDate(now.getDate() - 6);
  else if (p === "30") start.setDate(now.getDate() - 29);
  else if (p === "bulan") start.setDate(1);
  return { dari: iso(start), sampai: iso(now) };
}

function viewLaporan() {
  content().innerHTML = `
    <div class="section-title" style="margin-top:0"><h2>Laporan pendapatan</h2></div>
    <p class="hint" style="margin-bottom:12px">Hanya pesanan yang sudah ditandai <b>lunas</b> yang dihitung.</p>
    <div class="chips" id="presets">${[["hari", "Hari ini"], ["7", "7 hari"], ["30", "30 hari"], ["bulan", "Bulan ini"], ["custom", "Pilih tanggal"]]
      .map(([k, l]) => `<button class="chip ${laporanState.preset === k ? "active" : ""}" data-p="${k}">${l}</button>`).join("")}</div>
    <div class="range" id="customRange" style="margin-top:12px" ${laporanState.preset === "custom" ? "" : "hidden"}>
      <div class="field"><label for="d1">Dari</label><input class="input" type="date" id="d1" value="${laporanState.dari}"></div>
      <div class="field"><label for="d2">Sampai</label><input class="input" type="date" id="d2" value="${laporanState.sampai}"></div>
      <button class="btn" id="apply" style="margin-bottom:14px">Tampilkan</button>
    </div>
    <div id="rep" style="margin-top:16px"></div>`;
  $("#presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    laporanState.preset = b.dataset.p;
    if (b.dataset.p !== "custom") Object.assign(laporanState, presetRange(b.dataset.p));
    viewLaporan();
  });
  const ap = $("#apply"); if (ap) ap.addEventListener("click", () => { laporanState.dari = $("#d1").value; laporanState.sampai = $("#d2").value; loadLaporan(); });
  loadLaporan();
}

async function loadLaporan() {
  const el = $("#rep"); el.innerHTML = `<div class="state"><div class="spinner"></div>Menghitung laporan...</div>`;
  if (laporanState.dari > laporanState.sampai) { el.innerHTML = `<div class="form-error">Tanggal "Dari" tidak boleh setelah "Sampai".</div>`; return; }
  try {
    const r = await tokenCall(`/api/kasir/laporan?dari=${laporanState.dari}&sampai=${laporanState.sampai}`);
    const max = Math.max(1, ...r.harian.map((h) => h.total));
    el.innerHTML = `
      <div class="stats">
        <div class="card stat money"><div class="k">Total pendapatan</div><div class="v">${rupiah(r.total_pendapatan)}</div></div>
        <div class="card stat"><div class="k">Jumlah pesanan</div><div class="v">${r.jumlah_order}</div></div>
        <div class="card stat"><div class="k">${icon("qr", "sm")}Via QRIS</div><div class="v">${rupiah(r.total_qris)}</div></div>
        <div class="card stat"><div class="k">${icon("cash", "sm")}Via Cash</div><div class="v">${rupiah(r.total_cash)}</div></div>
      </div>
      <div class="section-title"><h2>Per hari</h2></div>
      ${r.harian.length ? `<div class="card bars">${r.harian.map((h) => `
        <div class="bar-row"><span>${tanggal(h.tanggal + "T00:00:00")}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (h.total / max) * 100)}%"></div></div><b>${rupiah(h.total)}</b></div>`).join("")}</div>`
        : `<div class="card state" style="padding:28px">Belum ada pendapatan pada rentang ini.</div>`}
      <div class="section-title"><h2>Menu terlaris</h2></div>
      ${r.menu_terlaris.length ? `<div class="card top-list">${r.menu_terlaris.map((m, i) => `
        <div class="r"><span class="n">${i + 1}</span><span class="t">${esc(m.nama_menu)}</span><span class="q">${m.qty} terjual<br><b style="color:var(--text)">${rupiah(m.omzet)}</b></span></div>`).join("")}</div>`
        : `<div class="card state" style="padding:28px">Belum ada data penjualan.</div>`}`;
  } catch (e) { fail(e, "Gagal memuat laporan"); el.innerHTML = `<div class="state error">${icon("alert")}<h3>Gagal memuat laporan</h3><p>${esc(e.message)}</p></div>`; }
}

// ---------- TAB: QRIS ----------
function viewQris() {
  const img = safeImg(state.me?.qris_image);
  content().innerHTML = `
    <div class="section-title" style="margin-top:0"><h2>QRIS kantin</h2></div>
    ${img ? `<div class="card qris-card"><img src="${esc(img)}" alt="QRIS ${esc(state.me.nama_kantin)}">
        <h3>${esc(state.me.qris_nama || state.me.nama_kantin)}</h3>
        <p class="hint" style="margin-top:6px">Inilah QRIS yang dilihat pelanggan saat membayar. Dana masuk langsung ke rekening/e-wallet kantinmu. Setelah dana masuk, tandai pesanan <b>lunas</b> di tab Pesanan.</p>
        <p class="hint" style="margin-top:10px">Mau mengganti QRIS? Hubungi developer/admin food court.</p></div>`
      : `<div class="card state">${icon("qr")}<h3>QRIS belum dipasang</h3><p>Pelanggan hanya bisa bayar cash. Minta developer/admin food court untuk memasang QRIS kantinmu.</p></div>`}`;
}

// ---------- start ----------
function render() { if (!state.token) renderLogin(); else renderShell(); }
render();
