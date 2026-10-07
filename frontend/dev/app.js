/* ============================================================
   Panel Developer — kelola kantin, QRIS per kantin, akun kasir, meja & QR
   ============================================================ */
const { api, esc, rupiah, icon, toast, safeImg, store, openSheet, confirmDialog, compressImage, $, $$ } = FC;

const state = { token: store.get("fc_dev_token"), username: store.get("fc_dev_user"), tab: "kantin", tenants: [], tables: [], metrics: null };
const $root = document.getElementById("root");
const call = (path, opt = {}) => api(path, { ...opt, token: state.token });

function logout(msg) {
  store.del("fc_dev_token"); store.del("fc_dev_user");
  state.token = null; if (msg) toast(msg, "error"); render();
}
function fail(e, fallback) {
  if (e.status === 401 || e.status === 403) return logout("Sesi habis, silakan login lagi");
  toast(e.message || fallback, "error");
}

// ---------- LOGIN ----------
function renderLogin() {
  $root.innerHTML = `
    <div class="login-wrap"><form class="login-box" id="f">
      <div class="logo" style="background:#25302A">${icon("key")}</div>
      <h1>Panel Developer</h1><p>Food Court UNUSIDA — kelola kantin, QRIS, dan meja.</p>
      <div class="field"><label for="u">Username</label><input class="input" id="u" autocomplete="username" autocapitalize="none" required></div>
      <div class="field"><label for="p">Password</label><input class="input" id="p" type="password" autocomplete="current-password" required></div>
      <div class="form-error" id="err" hidden></div>
      <button class="btn block" id="go" style="margin-top:14px">Masuk</button>
    </form></div>`;
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#err"); err.hidden = true;
    const b = $("#go"); b.disabled = true; b.textContent = "Masuk...";
    try {
      const r = await api("/api/dev/login", { method: "POST", body: { username: $("#u").value.trim(), password: $("#p").value } });
      state.token = r.token; state.username = r.username;
      store.set("fc_dev_token", r.token); store.set("fc_dev_user", r.username);
      render();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Masuk"; }
  });
}

// ---------- KERANGKA ----------
function renderShell() {
  document.body.classList.add("has-tabbar");
  $root.innerHTML = `
    <header class="top"><div class="wrap">
      <div class="row">
        <div class="who"><div class="logo">${icon("key")}</div><div><h1>Panel Developer</h1><small>@${esc(state.username)}</small></div></div>
        <button class="btn ghost icon" id="out" aria-label="Keluar">${icon("logout")}</button>
      </div>
    </div></header>
    <nav class="tabbar dock" id="tabs" aria-label="Navigasi panel">
      <button class="tab" data-tab="kantin">${icon("store")}Kantin & QRIS</button>
      <button class="tab" data-tab="meja">${icon("table")}Meja & QR</button>
    </nav>
    <main><div class="wrap" id="content"></div></main>
    <div class="print-area" id="printArea"></div>`;
  $("#out").addEventListener("click", async () => { if (await confirmDialog({ title: "Keluar dari panel?", okText: "Keluar" })) logout(); });
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { state.tab = b.dataset.tab; drawTab(); } });
  drawTab();
}
const content = () => $("#content");
function drawTab() {
  $$("#tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  if (state.tab === "kantin") viewKantin(); else viewMeja();
}
const loading = () => { content().innerHTML = `<div class="state"><div class="spinner"></div>Memuat...</div>`; };

// ---------- TAB: KANTIN ----------
async function viewKantin() {
  loading();
  try {
    [state.metrics, state.tenants] = await Promise.all([call("/api/dev/metrics"), call("/api/dev/tenants")]);
  } catch (e) { fail(e); return (content().innerHTML = `<div class="state error">${icon("alert")}<h3>Gagal memuat data</h3><p>${esc(e.message)}</p></div>`); }
  const m = state.metrics;
  content().innerHTML = `
    <div class="stats">
      <div class="card stat"><div class="k">Total kantin</div><div class="v">${m.total_kantin}</div></div>
      <div class="card stat"><div class="k">Sedang buka</div><div class="v">${m.kantin_buka}</div></div>
      <div class="card stat"><div class="k">QRIS terpasang</div><div class="v">${m.kantin_qris}/${m.total_kantin}</div></div>
      <div class="card stat"><div class="k">Total menu</div><div class="v">${m.total_menu}</div></div>
      <div class="card stat"><div class="k">Order hari ini</div><div class="v">${m.total_order_hari_ini}</div></div>
      <div class="card stat"><div class="k">Omzet lunas hari ini</div><div class="v" style="font-size:19px">${rupiah(m.omzet_hari_ini)}</div></div>
    </div>
    <div class="section-title"><h2>Data kantin</h2><button class="btn" id="add">${icon("plus", "sm")}Tambah kantin</button></div>
    <div class="tenants" id="tenants"></div>`;
  $("#add").addEventListener("click", () => tenantModal());
  drawTenants();
}

function drawTenants() {
  const el = $("#tenants");
  if (!state.tenants.length) { el.innerHTML = `<div class="state" style="grid-column:1/-1">${icon("store")}<h3>Belum ada kantin</h3><p>Tambahkan kantin pertama.</p></div>`; return; }
  el.innerHTML = state.tenants.map((t) => {
    const foto = safeImg(t.foto); const open = t.status === "buka";
    return `<article class="card tenant" data-id="${t.id}">
      <div class="t-head">
        <div class="thumb">${foto ? `<img src="${esc(foto)}" alt="">` : `<div class="ph">${icon("store")}</div>`}</div>
        <div style="flex:1;min-width:0"><h3>${esc(t.nama_kantin)}</h3><small>ID ${t.id}</small></div>
        <button class="sw ${open ? "on" : ""}" data-status="${t.id}" role="switch" aria-checked="${open}" aria-label="${open ? "Tutup kantin" : "Buka kantin"}" title="${open ? "Buka" : "Tutup"}"></button>
      </div>
      <div class="qris-prev" data-qris="${t.id}" style="cursor:pointer" title="Atur QRIS">
        <div class="none">${icon("qr")}</div>
        <div class="txt"><b>${t.qris_aktif ? "QRIS terpasang" : "QRIS belum dipasang"}</b>${t.qris_aktif ? esc(t.qris_nama || "Ketuk untuk lihat / ganti") : "Ketuk untuk upload QRIS kantin ini"}</div>
        <span class="badge ${t.qris_aktif ? "green" : "amber"}">${t.qris_aktif ? "Aktif" : "Kosong"}</span>
      </div>
      <div class="t-body">
        <div class="r"><span>Akun kasir</span><b>${t.kasir_username ? "@" + esc(t.kasir_username) : "—"}</b></div>
        <div class="r"><span>Status</span><span class="badge ${open ? "green" : ""}">${open ? "Buka" : "Tutup"}</span></div>
      </div>
      <div class="t-actions">
        <button class="btn ghost sm" data-edit="${t.id}">${icon("pencil", "sm")}Edit</button>
        <button class="btn ghost sm" data-kasir="${t.id}">${icon("key", "sm")}Akun</button>
        <button class="btn danger-soft sm" data-del="${t.id}">${icon("trash", "sm")}Hapus</button>
      </div>
    </article>`;
  }).join("");
  // muat pratinjau QRIS (gambar besar tidak ikut di daftar supaya ringan)
  state.tenants.filter((t) => t.qris_aktif).forEach(async (t) => {
    try {
      const q = await call(`/api/dev/tenants/${t.id}/qris`);
      const box = $(`[data-qris="${t.id}"] .none`);
      const src = safeImg(q.qris_image);
      if (box && src) box.outerHTML = `<img src="${esc(src)}" alt="QRIS ${esc(t.nama_kantin)}">`;
    } catch { /* abaikan */ }
  });
}

document.addEventListener("click", async (e) => {
  const find = (a) => { const b = e.target.closest(`[data-${a}]`); return b ? state.tenants.find((t) => t.id === Number(b.dataset[a])) : null; };
  let t;
  if ((t = find("status"))) {
    const next = t.status === "buka" ? "tutup" : "buka";
    try { await call(`/api/dev/tenants/${t.id}/status`, { method: "PATCH", body: { status: next } }); t.status = next; drawTenants(); } catch (err) { fail(err, "Gagal mengubah status"); }
  } else if ((t = find("qris"))) qrisModal(t);
  else if ((t = find("edit"))) tenantModal(t);
  else if ((t = find("kasir"))) kasirModal(t);
  else if ((t = find("del"))) {
    if (!(await confirmDialog({ title: `Hapus "${t.nama_kantin}"?`, message: "Semua menu, akun kasir, dan riwayat pesanan kantin ini ikut terhapus permanen.", okText: "Hapus permanen", danger: true }))) return;
    try { await call(`/api/dev/tenants/${t.id}`, { method: "DELETE" }); toast("Kantin dihapus"); viewKantin(); } catch (err) { fail(err, "Gagal menghapus"); }
  }
});

// uploader gambar kecil yang dipakai berulang (foto kantin / QRIS)
function imagePicker(root, { label, current, format, max, hint }) {
  const pk = { file: null, remove: false, src: safeImg(current) };
  root.innerHTML = `<span class="label">${esc(label)}</span>
    <label class="dropzone"><input type="file" accept="image/jpeg,image/png,image/webp"><div class="in"></div></label>
    <button type="button" class="btn danger-soft sm rm" hidden style="justify-self:start">${icon("trash", "sm")}Hapus</button>
    ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}`;
  const draw = () => {
    $(".in", root).innerHTML = pk.src ? `<img src="${esc(pk.src)}" alt=""><small>Ketuk untuk ganti</small>` : `${icon("image")}<strong>Pilih gambar</strong><small>JPG, PNG, atau WebP</small>`;
    $(".rm", root).hidden = !pk.src;
  };
  draw();
  $("input", root).addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { pk.file = await compressImage(f, { max, format, quality: 0.9 }); pk.src = URL.createObjectURL(pk.file); pk.remove = false; draw(); }
    catch (ex) { toast(ex.message, "error"); }
  });
  $(".rm", root).addEventListener("click", () => { pk.file = null; pk.src = ""; pk.remove = Boolean(current); $("input", root).value = ""; draw(); });
  return pk;
}

// ---------- MODAL: QRIS ----------
async function qrisModal(t) {
  const s = openSheet(`<div class="state"><div class="spinner"></div>Memuat...</div>`);
  let cur = { qris_image: null, qris_nama: t.qris_nama };
  try { cur = await call(`/api/dev/tenants/${t.id}/qris`); } catch (e) { s.close(); return fail(e); }
  s.el.innerHTML = `
    <div class="sheet-head"><div><h3>QRIS ${esc(t.nama_kantin)}</h3><p>Upload gambar QRIS milik kantin ini. Dana masuk langsung ke rekening/e-wallet kantin.</p></div>
      <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
    <div class="field" id="pick"></div>
    <div class="field"><label for="qn">Nama merchant (tampil di bawah QR)</label><input class="input" id="qn" maxlength="100" placeholder="Contoh: KANTIN BU SITI" value="${esc(cur.qris_nama || "")}"></div>
    <div class="form-error" id="err" hidden></div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Simpan QRIS</button></div>`;
  s.el.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", s.close));
  const pk = imagePicker($("#pick", s.el), { label: "Gambar QRIS", current: cur.qris_image, format: "png", max: 900, hint: "Pakai gambar QRIS asli (dari aplikasi merchant / stiker kantin) yang jelas dan tidak terpotong. Pastikan bisa discan sebelum disimpan." });
  $("#save", s.el).addEventListener("click", async (ev) => {
    const err = $("#err", s.el); err.hidden = true;
    const form = new FormData();
    form.append("qris_nama", $("#qn", s.el).value.trim());
    if (pk.file) form.append("qris", pk.file);
    if (pk.remove) form.append("hapus_qris", "true");
    const b = ev.currentTarget; b.disabled = true; b.textContent = "Menyimpan...";
    try { await call(`/api/dev/tenants/${t.id}`, { method: "PATCH", form }); s.close(); toast("QRIS disimpan", "success"); viewKantin(); }
    catch (ex) { if (ex.status === 401) return fail(ex); err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Simpan QRIS"; }
  });
}

// ---------- MODAL: TAMBAH / EDIT KANTIN ----------
function tenantModal(t = null) {
  const s = openSheet(`
    <div class="sheet-head"><div><h3>${t ? "Edit kantin" : "Tambah kantin"}</h3><p>${t ? "Ubah nama atau foto kantin." : "Sekalian buatkan akun kasir dan pasang QRIS kantin."}</p></div>
      <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
    <div class="field"><label for="nm">Nama kantin</label><input class="input" id="nm" maxlength="100" placeholder="Contoh: Kantin Bu Ani" value="${esc(t?.nama_kantin || "")}"></div>
    <div class="field" id="foto"></div>
    ${t ? "" : `
      <div class="field"><label for="un">Username kasir</label><input class="input" id="un" autocapitalize="none" placeholder="kasir_ani"></div>
      <div class="field"><label for="pw">Password kasir</label><input class="input" id="pw" type="text" placeholder="Minimal 6 karakter"></div>
      <div class="field" id="qr"></div>
      <div class="field"><label for="qn">Nama merchant QRIS</label><input class="input" id="qn" maxlength="100" placeholder="KANTIN BU ANI"></div>`}
    <div class="form-error" id="err" hidden></div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Simpan</button></div>`);
  const pf = imagePicker($("#foto", s.el), { label: "Foto kantin asli (tampil di halaman pelanggan)", current: t?.foto, format: "jpeg", max: 800 });
  const pq = t ? null : imagePicker($("#qr", s.el), { label: "Gambar QRIS kantin (opsional, bisa menyusul)", current: null, format: "png", max: 900 });
  $("#save", s.el).addEventListener("click", async (ev) => {
    const err = $("#err", s.el); err.hidden = true;
    const nama = $("#nm", s.el).value.trim();
    if (!nama) { err.textContent = "Nama kantin wajib diisi."; err.hidden = false; return; }
    const form = new FormData();
    form.append("nama_kantin", nama);
    if (pf.file) form.append("foto", pf.file);
    if (pf.remove) form.append("hapus_foto", "true");
    if (!t) {
      form.append("username", $("#un", s.el).value.trim()); form.append("password", $("#pw", s.el).value);
      form.append("qris_nama", $("#qn", s.el).value.trim());
      if (pq.file) form.append("qris", pq.file);
    }
    const b = ev.currentTarget; b.disabled = true; b.textContent = "Menyimpan...";
    try {
      await call(t ? `/api/dev/tenants/${t.id}` : "/api/dev/tenants", { method: t ? "PATCH" : "POST", form });
      s.close(); toast(t ? "Kantin diperbarui" : "Kantin ditambahkan", "success"); viewKantin();
    } catch (ex) { if (ex.status === 401) return fail(ex); err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Simpan"; }
  });
}

// ---------- MODAL: AKUN KASIR ----------
function kasirModal(t) {
  const s = openSheet(`
    <div class="sheet-head"><div><h3>Akun kasir</h3><p>${esc(t.nama_kantin)} — ${t.kasir_username ? "reset password / ganti username" : "buat akun kasir"}.</p></div>
      <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
    <div class="field"><label for="un">Username</label><input class="input" id="un" autocapitalize="none" value="${esc(t.kasir_username || "")}" placeholder="kasir_kantin"></div>
    <div class="field"><label for="pw">Password baru</label><input class="input" id="pw" type="text" placeholder="Minimal 6 karakter"></div>
    <div class="form-error" id="err" hidden></div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Simpan</button></div>`);
  $("#save", s.el).addEventListener("click", async (ev) => {
    const err = $("#err", s.el); err.hidden = true;
    const b = ev.currentTarget; b.disabled = true;
    try {
      await call(`/api/dev/tenants/${t.id}/kasir`, { method: "PATCH", body: { username: $("#un", s.el).value.trim(), password: $("#pw", s.el).value } });
      s.close(); toast("Akun kasir diperbarui", "success"); viewKantin();
    } catch (ex) { if (ex.status === 401) return fail(ex); err.textContent = ex.message; err.hidden = false; b.disabled = false; }
  });
}

// ---------- TAB: MEJA & QR ----------
function qrSvg(text, cell = 4) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true });
}
function customerUrl(code) {
  // URL halaman customer: disesuaikan dengan alamat tempat panel ini dibuka
  return `${location.origin}/customer/?qr=${encodeURIComponent(code)}`;
}

async function viewMeja() {
  loading();
  try { state.tables = await call("/api/dev/tables"); } catch (e) { fail(e); return (content().innerHTML = `<div class="state error">${icon("alert")}<h3>Gagal memuat meja</h3><p>${esc(e.message)}</p></div>`); }
  content().innerHTML = `
    <div class="section-title" style="margin-top:0"><h2>Meja & QR code <span class="badge">${state.tables.length}</span></h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="print">${icon("printer", "sm")}Cetak semua QR</button><button class="btn" id="addT">${icon("plus", "sm")}Tambah meja</button></div></div>
    <div class="link-box">${icon("qr", "sm")}<span>QR mengarah ke <b>${esc(location.origin)}/customer/?qr=…</b>. Kalau halaman customer di-hosting di domain lain, buka panel ini dari domain tersebut sebelum mencetak QR.</span></div>
    <div class="meja-grid" id="mg" style="margin-top:14px"></div>`;
  $("#addT").addEventListener("click", tableModal);
  $("#print").addEventListener("click", printAll);
  const mg = $("#mg");
  if (!state.tables.length) { mg.innerHTML = `<div class="state" style="grid-column:1/-1">${icon("table")}<h3>Belum ada meja</h3></div>`; return; }
  mg.innerHTML = state.tables.map((t) => `
    <div class="card meja"><b>Meja ${esc(t.nomor_meja)}</b>
      <div class="qrbox">${qrSvg(customerUrl(t.qr_code))}</div>
      <code>${esc(t.qr_code)}</code>
      <div style="display:flex;gap:6px"><button class="btn ghost sm" data-open="${esc(customerUrl(t.qr_code))}">Buka</button><button class="btn danger-soft sm" data-deltable="${t.id}" aria-label="Hapus meja ${esc(t.nomor_meja)}">${icon("trash", "sm")}</button></div>
    </div>`).join("");
}

document.addEventListener("click", async (e) => {
  const o = e.target.closest("[data-open]");
  if (o) return window.open(o.dataset.open, "_blank", "noopener");
  const d = e.target.closest("[data-deltable]");
  if (d) {
    if (!(await confirmDialog({ title: "Hapus meja ini?", message: "QR meja ini tidak akan bisa dipakai lagi.", okText: "Hapus", danger: true }))) return;
    try { await call(`/api/dev/tables/${d.dataset.deltable}`, { method: "DELETE" }); toast("Meja dihapus"); viewMeja(); } catch (err) { fail(err, "Gagal menghapus meja"); }
  }
});

function tableModal() {
  const s = openSheet(`
    <div class="sheet-head"><div><h3>Tambah meja</h3><p>Tambah satu meja, atau buat banyak sekaligus dengan rentang nomor.</p></div>
      <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
    <div class="chips" id="mode" style="margin-bottom:14px"><button class="chip active" data-m="one">Satu meja</button><button class="chip" data-m="range">Rentang</button></div>
    <div id="one" class="field"><label for="no">Nomor / nama meja</label><input class="input" id="no" maxlength="10" placeholder="Contoh: 04 atau VIP1"></div>
    <div id="range" hidden style="display:none;gap:10px;grid-template-columns:1fr 1fr">
      <div class="field"><label for="a">Dari nomor</label><input class="input" id="a" type="number" min="1" placeholder="1"></div>
      <div class="field"><label for="z">Sampai nomor</label><input class="input" id="z" type="number" min="1" placeholder="20"></div></div>
    <div class="form-error" id="err" hidden></div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Tambah</button></div>`);
  let mode = "one";
  $("#mode", s.el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m;
    $$("#mode .chip", s.el).forEach((c) => c.classList.toggle("active", c === b));
    $("#one", s.el).style.display = mode === "one" ? "" : "none";
    $("#range", s.el).style.display = mode === "range" ? "grid" : "none";
  });
  $("#save", s.el).addEventListener("click", async (ev) => {
    const err = $("#err", s.el); err.hidden = true;
    const body = mode === "one" ? { nomor_meja: $("#no", s.el).value.trim() } : { dari: Number($("#a", s.el).value), sampai: Number($("#z", s.el).value) };
    const b = ev.currentTarget; b.disabled = true;
    try { const r = await call("/api/dev/tables", { method: "POST", body }); s.close(); toast(r.message, "success"); viewMeja(); }
    catch (ex) { if (ex.status === 401) return fail(ex); err.textContent = ex.message; err.hidden = false; b.disabled = false; }
  });
}

function printAll() {
  if (!state.tables.length) return toast("Belum ada meja");
  $("#printArea").innerHTML = state.tables.map((t) => `
    <div class="print-card"><h2>Meja ${esc(t.nomor_meja)}</h2><p>Scan untuk memesan makanan</p>
      <div class="qr">${qrSvg(customerUrl(t.qr_code))}</div><small>Food Court UNUSIDA</small></div>`).join("");
  setTimeout(() => window.print(), 100);
}

function render() { if (!state.token) renderLogin(); else renderShell(); }
render();
