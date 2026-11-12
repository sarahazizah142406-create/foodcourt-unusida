/* ============================================================
   Panel Admin — kelola kantin, rekap pembayaran per kantin, akun kasir, meja & QR
   ============================================================ */
const { api, esc, rupiah, icon, toast, safeImg, store, openSheet, confirmDialog, compressImage, $, $$ } = FC;

const state = { token: store.get("fc_dev_token"), username: store.get("fc_dev_user"), role: store.get("fc_dev_role") || "dev", izin: (store.get("fc_dev_izin") || "").split(",").filter(Boolean), tab: "kantin", tenants: [], tables: [], metrics: null };
const $root = document.getElementById("root");
const call = (path, opt = {}) => api(path, { ...opt, token: state.token });

function logout(msg) {
  store.del("fc_dev_token"); store.del("fc_dev_user"); store.del("fc_dev_role"); store.del("fc_dev_izin");
  state.token = null; if (msg) toast(msg, "error"); render();
}
function fail(e, fallback) {
  // 401 / salah role -> login ulang. 403 karena hak akses -> cukup tampilkan pesan, jangan logout.
  if (e.status === 401 || (e.status === 403 && /Akses ditolak/.test(e.message || ""))) return logout("Sesi habis, silakan login lagi");
  toast(e.message || fallback, "error");
}

// ---------- LOGIN ----------
function renderLogin() {
  $root.innerHTML = `
    <div class="login-wrap"><form class="login-box" id="f">
      <div class="logo" style="background:#25302A">${icon("key")}</div>
      <h1>Panel Admin</h1><p>Food Court UNUSIDA — kelola kantin, rekap pembayaran, dan meja.</p>
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
      state.token = r.token; state.username = r.username; state.role = r.role; state.izin = r.izin || [];
      store.set("fc_dev_token", r.token); store.set("fc_dev_user", r.username); store.set("fc_dev_role", r.role); store.set("fc_dev_izin", state.izin.join(","));
      render();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Masuk"; }
  });
}

// ---------- KERANGKA ----------
const can = (k) => state.role === "dev" || state.izin.includes(k);
function tabList() {
  return [["kantin", "store", "Kantin"], ["rekap", "wallet", "Rekap"], ["meja", "table", "Meja & QR"], ["admin", "key", "Admin"], ["log", "note", "Log"]]
    .filter(([k]) => (k === "admin" || k === "log" ? state.role === "dev" : can(k === "kantin" ? "kantin_lihat" : k)));
}
function renderShell() {
  const tabs = tabList();
  if (tabs.length && !tabs.some((t) => t[0] === state.tab)) state.tab = tabs[0][0];
  document.body.classList.add("has-tabbar");
  $root.innerHTML = `
    <header class="top"><div class="wrap">
      <div class="row">
        <div class="who"><div class="logo">${icon("key")}</div><div><h1>${"Panel Admin"}</h1><small>@${esc(state.username)}</small></div></div>
        <button class="btn ghost icon" id="pw" aria-label="Ganti password" title="Ganti password">${icon("key")}</button>
        <button class="btn ghost icon" id="out" aria-label="Keluar">${icon("logout")}</button>
      </div>
    </div></header>
    <nav class="tabbar dock" id="tabs" aria-label="Navigasi panel">
      ${tabList().map(([k, ic, l]) => `<button class="tab" data-tab="${k}">${icon(ic)}${l}</button>`).join("")}
    </nav>
    <main><div class="wrap" id="content"></div></main>`;
  if (!document.getElementById("printArea")) {
    const pa = document.createElement("div");
    pa.className = "print-area";
    pa.id = "printArea";
    document.body.appendChild(pa);
  }
  $("#out").addEventListener("click", async () => { if (await confirmDialog({ title: "Keluar dari panel?", okText: "Keluar" })) logout(); });
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { state.tab = b.dataset.tab; drawTab(); } });
  $("#pw").addEventListener("click", passwordModal);
  drawTab();
}
const content = () => $("#content");
function drawTab() {
  if (!tabList().length) { content().innerHTML = `<div class="state"><h3>Belum ada akses</h3><p>Hubungi admin utama untuk mengaktifkan hak akses akun ini.</p></div>`; return; }
  $$("#tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  if (state.tab === "kantin") viewKantin(); else if (state.tab === "rekap") viewRekap(); else if (state.tab === "admin") viewAdmin(); else if (state.tab === "log") viewLog(); else viewMeja();
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
      <div class="card stat"><div class="k">Total meja</div><div class="v">${m.total_meja}</div></div>
      <div class="card stat"><div class="k">Total menu</div><div class="v">${m.total_menu}</div></div>
    </div>
    <div class="section-title"><h2>Data kantin</h2>${can("kantin_tambah") ? `<button class="btn" id="add">${icon("plus", "sm")}Tambah kantin</button>` : ""}</div>
    <div class="toolbar" style="margin-bottom:12px"><div class="search">${icon("search")}<input class="input" id="tq" placeholder="Cari kantin atau akun kasir..." value="${esc(state.q || "")}"></div></div><div class="tenants" id="tenants"></div>`;
  $("#add")?.addEventListener("click", () => tenantModal());
  $("#tq")?.addEventListener("input", (e) => { state.q = e.target.value; drawTenants(); });
  drawTenants();
}

function drawTenants() {
  const el = $("#tenants");
  if (!state.tenants.length) { el.innerHTML = `<div class="state" style="grid-column:1/-1">${icon("store")}<h3>Belum ada kantin</h3><p>Tambahkan kantin pertama.</p></div>`; return; }
  const q = String(state.q || "").trim().toLowerCase();
  const list = q ? state.tenants.filter((t) => `${t.nama_kantin} ${t.kasir_username || ""}`.toLowerCase().includes(q)) : state.tenants;
  if (!list.length) { el.innerHTML = `<div class="state" style="grid-column:1/-1"><h3>Tidak ditemukan</h3></div>`; return; }
  el.innerHTML = list.map((t) => {
    const foto = safeImg(t.foto); const open = t.status === "buka";
    return `<article class="card tenant" data-id="${t.id}">
      <div class="t-head">
        <div class="thumb">${foto ? `<img src="${esc(foto)}" alt="">` : `<div class="ph">${icon("store")}</div>`}</div>
        <div style="flex:1;min-width:0"><h3>${esc(t.nama_kantin)}</h3><small>ID ${t.id} · ${t.menu_count} menu</small>${t.menu_count === 0 ? `<span class="badge amber" style="margin-left:6px">Belum ada menu</span>` : ""}</div>
        <button class="sw ${open ? "on" : ""}" ${can("kantin_status") ? `data-status="${t.id}"` : "disabled"} role="switch" aria-checked="${open}" aria-label="${open ? "Tutup kantin" : "Buka kantin"}" title="${open ? "Buka" : "Tutup"}"></button>
      </div>
      <div class="t-body">
        ${state.role === "dev" ? `<div class="r"><span>Akun kasir</span><b>${t.kasir_username ? "@" + esc(t.kasir_username) : "Belum ada"}</b></div>` : ""}
        <div class="r"><span>Status</span><span class="badge ${open ? "green" : ""}">${open ? "Buka" : "Tutup"}</span></div>
      </div>
      <div class="t-actions">
        ${can("kantin_edit") ? `<button class="btn ghost sm" data-edit="${t.id}">${icon("pencil", "sm")}Edit</button>` : ""}
        ${state.role === "dev" ? `<button class="btn ghost sm" data-kasir="${t.id}">${icon("key", "sm")}Akun</button>` : ""}
        ${state.role === "dev" ? `<button class="btn danger-soft sm" data-del="${t.id}">${icon("trash", "sm")}Hapus</button>` : ""}
      </div>
    </article>`;
  }).join("");
}

document.addEventListener("click", async (e) => {
  const find = (a) => { const b = e.target.closest(`[data-${a}]`); return b ? state.tenants.find((t) => t.id === Number(b.dataset[a])) : null; };
  let t;
  if ((t = find("status"))) {
    const next = t.status === "buka" ? "tutup" : "buka";
    try { await call(`/api/dev/tenants/${t.id}/status`, { method: "PATCH", body: { status: next } }); t.status = next; drawTenants(); } catch (err) { fail(err, "Gagal mengubah status"); }
  } else if ((t = find("edit"))) tenantModal(t);
  else if ((t = find("kasir"))) kasirModal(t);
  else if ((t = find("del"))) {
    const ketik = await confirmType(t.nama_kantin); if (!ketik) return;
    try { await call(`/api/dev/tenants/${t.id}`, { method: "DELETE", body: { konfirmasi: ketik } }); toast("Kantin dihapus"); viewKantin(); } catch (err) { fail(err, "Gagal menghapus"); }
  }
});

// uploader gambar kecil yang dipakai berulang (foto kantin)
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

function tenantModal(t = null) {
  const s = openSheet(`
    <div class="sheet-head"><div><h3>${t ? "Edit kantin" : "Tambah kantin"}</h3><p>${t ? "Ubah nama atau foto kantin." : (state.role === "dev" ? "Sekalian buatkan akun kasir untuk kantin ini." : "Isi nama dan foto kantin.")}</p></div>
      <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
    <div class="field"><label for="nm">Nama kantin</label><input class="input" id="nm" maxlength="100" placeholder="Contoh: Kantin Bu Ani" value="${esc(t?.nama_kantin || "")}"></div>
    <div class="field" id="foto"></div>
    ${t ? "" : state.role !== "dev" ? `<p class="hint" style="margin:0 0 6px">Akun kasir untuk kantin ini dibuat oleh admin utama.</p>` : `
      <div class="field"><label for="un">Username kasir</label><input class="input" id="un" autocapitalize="none" placeholder="kasir_ani"></div>
      <div class="field"><label for="pw">Password kasir</label><input class="input" id="pw" type="text" placeholder="Minimal 6 karakter"></div>
      <p class="hint" style="margin:0 0 6px">Pembayaran QRIS memakai satu akun food court, jadi tidak perlu mengunggah QRIS per kantin.</p>`}
    <div class="form-error" id="err" hidden></div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Simpan</button></div>`);
  const pf = imagePicker($("#foto", s.el), { label: "Foto kantin asli (tampil di halaman pelanggan)", current: t?.foto, format: "jpeg", max: 800 });
  $("#save", s.el).addEventListener("click", async (ev) => {
    const err = $("#err", s.el); err.hidden = true;
    const nama = $("#nm", s.el).value.trim();
    if (!nama) { err.textContent = "Nama kantin wajib diisi."; err.hidden = false; return; }
    const form = new FormData();
    form.append("nama_kantin", nama);
    if (pf.file) form.append("foto", pf.file);
    if (pf.remove) form.append("hapus_foto", "true");
    if (!t && state.role === "dev") {
      form.append("username", $("#un", s.el).value.trim()); form.append("password", $("#pw", s.el).value);
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

// ---------- TAB: REKAP PEMBAYARAN ----------
// QRIS masuk ke satu akun food court -> panel ini menunjukkan berapa yang harus disetor ke tiap kantin.
// Cash sudah dipegang kantin masing-masing.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rangeOf(preset) {
  const t = new Date(), end = ymd(t);
  if (preset === "hari") return [end, end];
  if (preset === "7" || preset === "30") { const d = new Date(); d.setDate(d.getDate() - (Number(preset) - 1)); return [ymd(d), end]; }
  return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), end]; // bulan ini
}
const PRESETS = [["hari", "Hari ini"], ["7", "7 hari"], ["30", "30 hari"], ["bulan", "Bulan ini"], ["custom", "Pilih tanggal"]];

async function viewRekap() {
  if (!state.rekap) { const [dari, sampai] = rangeOf("hari"); state.rekap = { preset: "hari", dari, sampai }; }
  const R = state.rekap;
  content().innerHTML = `
    <div class="section-title" style="margin-top:0"><h2>Rekap pembayaran</h2><div style="display:flex;gap:8px"><button class="btn ghost" id="rkPrint">${icon("printer", "sm")}Cetak</button><button class="btn ghost" id="rkExcel" title="Unduh Excel (.xls) dengan warna & kolom rapi">${icon("download", "sm")}Excel</button><button class="btn ghost" id="rkCsv" title="Unduh format CSV">${icon("download", "sm")}CSV</button></div></div>
    <div class="chips" id="rkChips">${PRESETS.map(([k, l]) => `<button class="chip ${R.preset === k ? "active" : ""}" data-rk="${k}">${l}</button>`).join("")}</div>
    <div class="rk-dates" ${R.preset === "custom" ? "" : "hidden"}>
      <div class="field"><label for="rk1">Dari</label><input class="input" type="date" id="rk1" value="${R.dari}"></div>
      <div class="field"><label for="rk2">Sampai</label><input class="input" type="date" id="rk2" value="${R.sampai}"></div>
    </div>
    <div id="rkBody"><div class="state"><div class="spinner"></div>Memuat rekap...</div></div>`;

  const load = async () => {
    $("#rkBody").innerHTML = `<div class="state"><div class="spinner"></div>Memuat rekap...</div>`;
    try {
      const d = await call(`/api/dev/rekap?dari=${R.dari}&sampai=${R.sampai}`);
      state.rekapData = d;
      drawRekap(d);
    } catch (e) { fail(e); $("#rkBody").innerHTML = `<div class="state error">${icon("alert")}<h3>Gagal memuat rekap</h3><p>${esc(e.message)}</p></div>`; }
  };
  $("#rkChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rk]"); if (!b) return;
    R.preset = b.dataset.rk;
    if (R.preset !== "custom") [R.dari, R.sampai] = rangeOf(R.preset);
    $$("#rkChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.rk === R.preset));
    $(".rk-dates").hidden = R.preset !== "custom";
    if (R.preset !== "custom") load();
  });
  const onDate = () => { const a = $("#rk1").value, z = $("#rk2").value; if (a && z && a <= z) { R.dari = a; R.sampai = z; load(); } };
  $("#rk1").addEventListener("change", onDate); $("#rk2").addEventListener("change", onDate);
  $("#rkCsv").addEventListener("click", () => exportRekapCsv(state.rekapData));
  $("#rkExcel").addEventListener("click", () => exportRekapExcel(state.rekapData));
  $("#rkPrint").addEventListener("click", () => printRekap(state.rekapData));
  load();
}

function drawRekap(d) {
  const t = d.total;
  const rows = d.kantin.map((k) => `
    <tr data-rk-tenant="${k.tenant_id}" tabindex="0" role="button" aria-label="Rincian ${esc(k.nama_kantin)}">
      <td><b>${esc(k.nama_kantin)}</b></td>
      <td class="n">${rupiah(k.qris_total)}<small>${k.qris_order} order</small></td>
      <td class="n">${rupiah(k.cash_total)}<small>${k.cash_order} order</small></td>
      <td class="n"><b>${rupiah(k.total)}</b><small>${k.jumlah_order} order</small></td>
      <td class="n">${k.qris_total > 0 ? (k.sisa_qris > 0 ? `<b>${rupiah(k.sisa_qris)}</b><small><button class="btn soft sm" data-setor="${k.tenant_id}">Tandai disetor</button></small>` : `<span class="badge green">Sudah disetor</span>`) : "–"}</td>
    </tr>`).join("");
  $("#rkBody").innerHTML = `
    <div class="stats rk-stats">
      <div class="card stat"><div class="k">Total penjualan lunas</div><div class="v" style="font-size:19px">${rupiah(t.total)}</div><div class="s">${t.jumlah_order} order</div></div>
      <div class="card stat"><div class="k">${icon("qr", "sm")}Via QRIS (disetor ke kantin)</div><div class="v" style="font-size:19px">${rupiah(t.qris_total)}</div><div class="s">${t.qris_order} order</div></div>
      <div class="card stat"><div class="k">${icon("cash", "sm")}Via Cash (dipegang kantin)</div><div class="v" style="font-size:19px">${rupiah(t.cash_total)}</div><div class="s">${t.cash_order} order</div></div>
    </div>
    ${t.biaya_layanan_qris > 0 ? `<p class="hint" style="margin:10px 2px 0">Biaya layanan QRIS yang dibayar pelanggan pada periode ini: ${rupiah(t.biaya_layanan_qris)} (tidak termasuk angka di atas).</p>` : ""}
    <div class="card rk-card">
      <div class="rk-scroll"><table class="rk-table">
        <thead><tr><th>Kantin</th><th class="n">QRIS</th><th class="n">Cash</th><th class="n">Total</th><th class="n">Sisa QRIS</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="state">Belum ada kantin.</td></tr>`}</tbody>
        <tfoot><tr><td>Total</td><td class="n">${rupiah(t.qris_total)}</td><td class="n">${rupiah(t.cash_total)}</td><td class="n">${rupiah(t.total)}</td><td class="n">${rupiah(t.sisa_qris || 0)}</td></tr></tfoot>
      </table></div>
    </div>
    <p class="hint" style="margin:8px 2px">Ketuk satu kantin untuk melihat rincian transaksinya. Hanya pesanan yang sudah lunas yang dihitung.</p>`;
}

function exportRekapCsv(d) {
  if (!d || !d.kantin) return;
  const t = d.total || {};
  const tglUnduh = new Date().toLocaleString("id-ID");
  const lines = [
    "sep=;",
    `"LAPORAN REKAPITULASI PENJUALAN - FOOD COURT UNUSIDA (Periode: ${d.dari} s/d ${d.sampai})"`,
    `"Total Penjualan: ${rupiah(t.total || 0)} (${t.jumlah_order || 0} order) | Via QRIS: ${rupiah(t.qris_total || 0)} | Via Cash: ${rupiah(t.cash_total || 0)} | Diunduh: ${tglUnduh}"`,
    "",
    '"No";"Kantin";"Order QRIS";"Total QRIS";"Order Tunai";"Total Tunai";"Total Order";"Total Omzet";"Sisa QRIS";"Status Setoran"'
  ];

  d.kantin.forEach((k, idx) => {
    const sisa = Number(k.sisa_qris) || 0;
    const qTotal = Number(k.qris_total) || 0;
    const statusSetor = qTotal > 0 ? (sisa > 0 ? "Belum disetor" : "Sudah disetor") : "Tidak ada QRIS";
    lines.push([
      idx + 1,
      `"${String(k.nama_kantin || '').replace(/"/g, '""')}"`,
      Number(k.qris_order) || 0,
      `"${rupiah(qTotal)}"`,
      Number(k.cash_order) || 0,
      `"${rupiah(Number(k.cash_total) || 0)}"`,
      Number(k.jumlah_order) || 0,
      `"${rupiah(Number(k.total) || 0)}"`,
      `"${rupiah(sisa)}"`,
      `"${statusSetor}"`
    ].join(";"));
  });

  // Baris Total
  lines.push([
    "",
    `"TOTAL KESELURUHAN"`,
    Number(t.qris_order) || 0,
    `"${rupiah(Number(t.qris_total) || 0)}"`,
    Number(t.cash_order) || 0,
    `"${rupiah(Number(t.cash_total) || 0)}"`,
    Number(t.jumlah_order) || 0,
    `"${rupiah(Number(t.total) || 0)}"`,
    `"${rupiah(Number(t.sisa_qris) || 0)}"`,
    `""`
  ].join(";"));

  const csv = lines.join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `rekap-pembayaran_${d.dari}_${d.sampai}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportRekapExcel(d) {
  if (!d || !d.kantin) return;
  const t = d.total || {};
  const tglUnduh = new Date().toLocaleString("id-ID");
  const rows = d.kantin.map((k, idx) => {
    const sisa = Number(k.sisa_qris) || 0;
    const qTotal = Number(k.qris_total) || 0;
    const statusSetor = qTotal > 0 ? (sisa > 0 ? "Belum disetor" : "Sudah disetor") : "Tidak ada QRIS";
    return `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td><b>${esc(k.nama_kantin)}</b></td>
        <td style="text-align:center">${k.qris_order || 0}</td>
        <td style="text-align:right">${rupiah(qTotal)}</td>
        <td style="text-align:center">${k.cash_order || 0}</td>
        <td style="text-align:right">${rupiah(k.cash_total || 0)}</td>
        <td style="text-align:center"><b>${k.jumlah_order || 0}</b></td>
        <td style="text-align:right"><b>${rupiah(k.total || 0)}</b></td>
        <td style="text-align:right">${rupiah(sisa)}</td>
        <td style="text-align:center">${esc(statusSetor)}</td>
      </tr>`;
  }).join("");

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Rekap Pembayaran</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      <style>
        body, table { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; }
        .title { font-size: 15pt; font-weight: bold; color: #1B5E20; padding: 6px 0; }
        .meta { color: #555555; font-size: 10.5pt; padding: 2px 0; }
        th { background-color: #1B5E20; color: #FFFFFF; font-weight: bold; text-align: center; border: 1px solid #777; padding: 8px 12px; }
        td { border: 1px solid #DDD; padding: 6px 10px; }
        .tot { background-color: #E8F5E9; font-weight: bold; border-top: 2px solid #1B5E20; border-bottom: 2px solid #1B5E20; }
      </style>
    </head>
    <body>
      <table>
        <tr><td colspan="10" class="title">LAPORAN REKAPITULASI PENJUALAN - FOOD COURT UNUSIDA</td></tr>
        <tr><td colspan="10" class="meta">Periode: <b>${esc(d.dari)} s/d ${esc(d.sampai)}</b> &nbsp;|&nbsp; Tanggal Unduh: ${esc(tglUnduh)}</td></tr>
        <tr><td colspan="10" class="meta">Total Penjualan: <b>${rupiah(t.total || 0)}</b> (${t.jumlah_order || 0} order) &nbsp;|&nbsp; QRIS: <b>${rupiah(t.qris_total || 0)}</b> &nbsp;|&nbsp; Cash: <b>${rupiah(t.cash_total || 0)}</b></td></tr>
        <tr><td colspan="10"></td></tr>
        <thead>
          <tr>
            <th style="width:45px">No</th>
            <th style="width:200px">Kantin</th>
            <th style="width:100px">Order QRIS</th>
            <th style="width:130px">Total QRIS</th>
            <th style="width:100px">Order Tunai</th>
            <th style="width:130px">Total Tunai</th>
            <th style="width:100px">Total Order</th>
            <th style="width:140px">Total Omzet</th>
            <th style="width:140px">Sisa QRIS</th>
            <th style="width:130px">Status Setoran</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr class="tot">
            <td style="text-align:center"></td>
            <td>TOTAL KESELURUHAN</td>
            <td style="text-align:center">${t.qris_order || 0}</td>
            <td style="text-align:right">${rupiah(t.qris_total || 0)}</td>
            <td style="text-align:center">${t.cash_order || 0}</td>
            <td style="text-align:right">${rupiah(t.cash_total || 0)}</td>
            <td style="text-align:center">${t.jumlah_order || 0}</td>
            <td style="text-align:right">${rupiah(t.total || 0)}</td>
            <td style="text-align:right">${rupiah(t.sisa_qris || 0)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </body>
    </html>`;

  const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rekap-pembayaran_${d.dari}_${d.sampai}.xls`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportRekapDetailCsv(tenantId, namaKantin) {
  const R = state.rekap;
  try {
    toast("Menyiapkan CSV rincian...");
    const d = await call(`/api/dev/rekap/${tenantId}?dari=${R.dari}&sampai=${R.sampai}&limit=1000`);
    if (!d || !d.rows || !d.rows.length) {
      toast("Tidak ada data transaksi untuk diunduh", "error");
      return;
    }
    const lines = [
      "sep=;",
      `"RINCIAN TRANSAKSI - ${String(namaKantin || '').toUpperCase()} (Periode: ${R.dari} s/d ${R.sampai})"`,
      `"Total Transaksi: ${d.jumlah} order | Total Nominal: ${rupiah(d.nominal || 0)} | Tanggal Unduh: ${new Date().toLocaleString('id-ID')}"`,
      "",
      '"No";"Nomor Antrian";"Nomor Meja";"Tanggal & Waktu";"Metode Pembayaran";"Subtotal"'
    ];
    d.rows.forEach((r, idx) => {
      const tgl = new Date(r.created_at).toLocaleString("id-ID", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
      lines.push([
        idx + 1,
        `"#${r.nomor_antrian}"`,
        `"Meja ${r.nomor_meja}"`,
        `"${tgl}"`,
        `"${r.metode_bayar === 'qris' ? 'QRIS' : 'Tunai'}"`,
        `"${rupiah(Number(r.subtotal) || 0)}"`
      ].join(";"));
    });
    const csv = lines.join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `rincian_${String(namaKantin || '').toLowerCase().replace(/\s+/g, '_')}_${R.dari}_${R.sampai}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("CSV rincian berhasil diunduh", "success");
  } catch (err) {
    fail(err, "Gagal mengunduh CSV rincian");
  }
}

async function exportRekapDetailExcel(tenantId, namaKantin) {
  const R = state.rekap;
  try {
    toast("Menyiapkan Excel rincian...");
    const d = await call(`/api/dev/rekap/${tenantId}?dari=${R.dari}&sampai=${R.sampai}&limit=1000`);
    if (!d || !d.rows || !d.rows.length) {
      toast("Tidak ada data transaksi untuk diunduh", "error");
      return;
    }
    const tglUnduh = new Date().toLocaleString("id-ID");
    const rows = d.rows.map((r, idx) => {
      const tgl = new Date(r.created_at).toLocaleString("id-ID", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
      return `
        <tr>
          <td style="text-align:center">${idx + 1}</td>
          <td style="text-align:center"><b>#${esc(r.nomor_antrian)}</b></td>
          <td style="text-align:center">Meja ${esc(r.nomor_meja)}</td>
          <td style="text-align:center">${esc(tgl)}</td>
          <td style="text-align:center">${r.metode_bayar === 'qris' ? 'QRIS' : 'Tunai'}</td>
          <td style="text-align:right"><b>${rupiah(Number(r.subtotal) || 0)}</b></td>
        </tr>`;
    }).join("");

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Rincian Transaksi</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <style>
          body, table { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; }
          .title { font-size: 15pt; font-weight: bold; color: #1B5E20; padding: 6px 0; }
          .meta { color: #555555; font-size: 10.5pt; padding: 2px 0; }
          th { background-color: #1B5E20; color: #FFFFFF; font-weight: bold; text-align: center; border: 1px solid #777; padding: 8px 12px; }
          td { border: 1px solid #DDD; padding: 6px 10px; }
          .tot { background-color: #E8F5E9; font-weight: bold; border-top: 2px solid #1B5E20; border-bottom: 2px solid #1B5E20; }
        </style>
      </head>
      <body>
        <table>
          <tr><td colspan="6" class="title">RINCIAN TRANSAKSI - ${esc(String(namaKantin || '').toUpperCase())}</td></tr>
          <tr><td colspan="6" class="meta">Periode: <b>${esc(R.dari)} s/d ${esc(R.sampai)}</b> &nbsp;|&nbsp; Tanggal Unduh: ${esc(tglUnduh)}</td></tr>
          <tr><td colspan="6" class="meta">Total Transaksi: <b>${d.jumlah} order</b> &nbsp;|&nbsp; Total Nominal: <b>${rupiah(d.nominal || 0)}</b></td></tr>
          <tr><td colspan="6"></td></tr>
          <thead>
            <tr>
              <th style="width:45px">No</th>
              <th style="width:120px">No Antrian</th>
              <th style="width:100px">Meja</th>
              <th style="width:160px">Tanggal & Waktu</th>
              <th style="width:110px">Pembayaran</th>
              <th style="width:140px">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          <tfoot>
            <tr class="tot">
              <td colspan="5" style="text-align:right">TOTAL NOMINAL:</td>
              <td style="text-align:right">${rupiah(d.nominal || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>`;

    const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rincian_${String(namaKantin || '').toLowerCase().replace(/\s+/g, '_')}_${R.dari}_${R.sampai}.xls`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Excel rincian berhasil diunduh", "success");
  } catch (err) {
    fail(err, "Gagal mengunduh Excel rincian");
  }
}

async function rekapDetail(tenantId) {
  const k = state.rekapData?.kantin.find((x) => x.tenant_id === tenantId);
  if (!k) return;
  const R = state.rekap;
  let metode = "";
  const s = openSheet(`
    <div class="sheet-head"><div><h3>${esc(k.nama_kantin)}</h3><p>${R.dari === R.sampai ? R.dari : `${R.dari} s/d ${R.sampai}`}</p></div>
      <div style="display:flex;gap:6px;align-items:center"><button class="btn ghost sm" id="rdExcel" title="Unduh Excel (.xls) rincian kantin ini">${icon("download", "sm")}Excel</button><button class="btn ghost sm" id="rdCsv" title="Unduh CSV rincian kantin ini">${icon("download", "sm")}CSV</button><button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div></div>
    <div class="chips" id="rdChips">
      <button class="chip active" data-m="">Semua</button><button class="chip" data-m="qris">QRIS</button><button class="chip" data-m="cash">Cash</button>
    </div>
    <div id="rdList" style="margin-top:12px"></div>`);
  $("#rdCsv", s.el).addEventListener("click", () => exportRekapDetailCsv(tenantId, k.nama_kantin));
  $("#rdExcel", s.el).addEventListener("click", () => exportRekapDetailExcel(tenantId, k.nama_kantin));
  const PAGE = 50;
  let offset = 0;
  const rowHtml = (r) => `
    <div class="rd-row"><div><b>#${esc(r.nomor_antrian)}</b> · Meja ${esc(r.nomor_meja)}<small>${new Date(r.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>
      <span class="badge ${r.metode_bayar === "qris" ? "blue" : ""}">${r.metode_bayar === "qris" ? "QRIS" : "Cash"}</span><b>${rupiah(r.subtotal)}</b></div>`;
  const load = async (append = false) => {
    const box = $("#rdList", s.el);
    if (!append) { offset = 0; box.innerHTML = `<div class="state"><div class="spinner"></div>Memuat...</div>`; }
    try {
      const d = await call(`/api/dev/rekap/${tenantId}?dari=${R.dari}&sampai=${R.sampai}${metode ? `&metode=${metode}` : ""}&limit=${PAGE}&offset=${offset}`);
      if (!append) {
        box.innerHTML = d.jumlah
          ? `<div class="rd-sum"><span>${d.jumlah} transaksi</span><b>${rupiah(d.nominal)}</b></div><div class="rd-list" id="rdRows"></div><div id="rdMore"></div>`
          : `<div class="state">${icon("inbox")}<h3>Belum ada transaksi</h3></div>`;
      }
      if (!d.jumlah) return;
      $("#rdRows", s.el).insertAdjacentHTML("beforeend", d.rows.map(rowHtml).join(""));
      offset += d.rows.length;
      $("#rdMore", s.el).innerHTML = d.ada_lagi ? `<button class="btn ghost block" id="rdMoreBtn" style="margin-top:10px">Muat lagi (${d.jumlah - offset} tersisa)</button>` : "";
      const mb = $("#rdMoreBtn", s.el);
      if (mb) mb.addEventListener("click", () => { mb.disabled = true; load(true); });
    } catch (e) {
      if (append) { toast(e.message, "error"); const mb = $("#rdMoreBtn", s.el); if (mb) mb.disabled = false; }
      else box.innerHTML = `<div class="state error">${esc(e.message)}</div>`;
    }
  };
  $("#rdChips", s.el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    metode = b.dataset.m;
    $$("#rdChips .chip", s.el).forEach((c) => c.classList.toggle("active", c === b));
    load();
  });
  load();
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-setor]")) return;
  const r = e.target.closest("[data-rk-tenant]");
  if (r) rekapDetail(Number(r.dataset.rkTenant));
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const r = e.target.closest?.("[data-rk-tenant]");
  if (r) rekapDetail(Number(r.dataset.rkTenant));
});

// ---------- TAB: MEJA & QR ----------
function qrSvg(text, cell = 4) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true });
}
function qrDataUrl(text, cell = 10) {
  const q = qrcode(0, "M"); q.addData(text); q.make();
  return q.createDataURL(cell, cell * 2);
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
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="print">${icon("printer", "sm")}Cetak semua</button><button class="btn ghost" id="printSel" disabled>${icon("printer", "sm")}<span id="selN">Cetak terpilih</span></button><button class="btn" id="addT">${icon("plus", "sm")}Tambah meja</button></div></div>
    <div class="link-box">${icon("qr", "sm")}<span>QR mengarah ke <b>${esc(location.origin)}/customer/?qr=…</b>. Kalau halaman customer di-hosting di domain lain, buka panel ini dari domain tersebut sebelum mencetak QR.</span></div>
    <div class="meja-grid" id="mg" style="margin-top:14px"></div>`;
  $("#addT").addEventListener("click", tableModal);
  selMeja = new Set();
  $("#print").addEventListener("click", printAll);
  $("#printSel").addEventListener("click", () => printTables(state.tables.filter((t) => selMeja.has(t.id))));
  const mg = $("#mg");
  if (!state.tables.length) { mg.innerHTML = `<div class="state" style="grid-column:1/-1">${icon("table")}<h3>Belum ada meja</h3></div>`; return; }
  mg.innerHTML = state.tables.map((t) => `
    <div class="card meja"><label class="pick"><input type="checkbox" data-pick="${t.id}"> pilih</label><b>Meja ${esc(t.nomor_meja)}</b>
      <div class="qrbox">${qrSvg(customerUrl(t.qr_code))}</div>
      <code>${esc(t.qr_code)}</code>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center"><button class="btn ghost sm" data-open="${esc(customerUrl(t.qr_code))}">Buka</button><button class="btn ghost sm" data-copyurl="${esc(customerUrl(t.qr_code))}" title="Salin link meja" aria-label="Salin link">${icon("copy", "sm")}Salin</button><button class="btn soft sm" data-printtable="${t.id}" aria-label="Cetak QR meja ${esc(t.nomor_meja)}" title="Cetak QR meja ini">${icon("printer", "sm")}</button><button class="btn ghost sm" data-edittable="${t.id}" title="Ubah nomor meja" aria-label="Ubah nomor meja">${icon("pencil", "sm")}</button><button class="btn ghost sm" data-regen="${t.id}" title="Buat ulang QR" aria-label="Buat ulang QR">${icon("refresh", "sm")}</button><button class="btn danger-soft sm" data-deltable="${t.id}" aria-label="Hapus meja ${esc(t.nomor_meja)}">${icon("trash", "sm")}</button></div>
    </div>`).join("");
}

document.addEventListener("click", async (e) => {
  const cp = e.target.closest("[data-copyurl]");
  if (cp) {
    try {
      await navigator.clipboard.writeText(cp.dataset.copyurl);
      toast("Link meja disalin ke clipboard", "success");
    } catch {
      toast("Gagal menyalin link");
    }
    return;
  }
  const o = e.target.closest("[data-open]");
  if (o) return window.open(o.dataset.open, "_blank", "noopener");
  const pt = e.target.closest("[data-printtable]");
  if (pt) {
    const t = state.tables.find((x) => x.id === Number(pt.dataset.printtable));
    if (t) printTables([t]);
    return;
  }
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

function printTables(list) {
  if (!list.length) return toast("Belum ada meja");
  let pa = document.getElementById("printArea");
  if (!pa) {
    pa = document.createElement("div");
    pa.className = "print-area";
    pa.id = "printArea";
    document.body.appendChild(pa);
  }
  pa.innerHTML = list.map((t) => {
    const url = customerUrl(t.qr_code);
    return `
    <div class="print-card">
      <h2>Meja ${esc(t.nomor_meja)}</h2>
      <p>Scan untuk memesan makanan</p>
      <div class="qr"><img src="${qrDataUrl(url, 8)}" alt="QR Meja ${esc(t.nomor_meja)}"></div>
      <small>Food Court UNUSIDA</small>
    </div>`;
  }).join("");
  const imgs = [...pa.querySelectorAll("img")];
  Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })))
    .then(() => setTimeout(() => window.print(), 60));
}

function printAll() {
  printTables(state.tables);
}

async function render() {
  if (!state.token) return renderLogin();
  try {   // ambil hak akses terbaru dari server (dev bisa mengubahnya kapan saja)
    const m = await call("/api/dev/me");
    state.role = m.role; state.izin = m.izin;
    store.set("fc_dev_role", m.role); store.set("fc_dev_izin", m.izin.join(","));
  } catch (e) { if (e.status === 401 || e.status === 403) return logout("Sesi habis, silakan login lagi"); }
  renderShell();
}
render();

// ---------- AKUN ADMIN FOOD COURT + HAK AKSES ----------
const IZIN_LABEL = {
  kantin_lihat: "Lihat daftar kantin", kantin_tambah: "Tambah kantin baru", kantin_edit: "Edit nama & foto kantin",
  kantin_status: "Buka / tutup kantin", rekap: "Lihat rekap pembayaran", meja: "Kelola meja & QR"
};
async function viewAdmin() {
  loading();
  let d;
  try { d = await call("/api/dev/admin"); } catch (e) { return fail(e); }
  content().innerHTML = `
    <div class="section-title" style="margin-top:0"><h2>Akun admin food court</h2></div>
    <div class="card" style="padding:16px">
      <p style="margin:0 0 12px">Admin login di halaman yang sama dengan panel ini dan hanya melihat fitur yang dicentang. ${d.username ? "Perubahan hak akses langsung berlaku." : "Belum ada akun admin."}</p>
      <div class="field"><label for="adU">Username</label><input class="input" id="adU" value="${esc(d.username || "")}" autocapitalize="none"></div>
      <div class="field"><label for="adP">Password ${d.username ? "baru (kosongkan jika tidak diganti)" : "(min. 6 karakter)"}</label><input class="input" id="adP" type="password" autocomplete="new-password"></div>
      <div class="label" style="margin:12px 0 6px">Hak akses</div>
      ${d.semua.map((k) => `<label style="display:flex;align-items:center;gap:10px;padding:6px 0"><input type="checkbox" data-izin="${k}" ${d.izin.includes(k) ? "checked" : ""}> ${esc(IZIN_LABEL[k] || k)}</label>`).join("")}
      <p class="hint" style="margin:10px 0 0">Selalu khusus admin utama (tidak bisa diberikan): reset akun kasir, hapus kantin, dan kelola akun admin. Dengan begitu admin tidak bisa masuk ke akun kantin mana pun.</p>
      <button class="btn block" id="adGo" style="margin-top:12px">${d.username ? "Simpan" : "Buat akun admin"}</button>
    </div>`;
  const boxes = Array.from($$("[data-izin]"));
  const lihat = boxes.find((b) => b.dataset.izin === "kantin_lihat");
  boxes.forEach((b) => b.addEventListener("change", () => {
    const k = b.dataset.izin;
    if (k.startsWith("kantin_") && k !== "kantin_lihat" && b.checked) lihat.checked = true;   // butuh daftar kantin
    if (b === lihat && !b.checked) boxes.forEach((x) => { if (x.dataset.izin.startsWith("kantin_")) x.checked = false; });
  }));
  $("#adGo").addEventListener("click", async () => {
    const izin = boxes.filter((b) => b.checked).map((b) => b.dataset.izin);
    try {
      await call("/api/dev/admin", { method: "PUT", body: { username: $("#adU").value.trim(), password: $("#adP").value, izin } });
      toast("Akun admin disimpan"); viewAdmin();
    } catch (e) { fail(e, "Gagal menyimpan"); }
  });
}


// ====================== TAMBAHAN ======================
let selMeja = new Set();

// Konfirmasi hapus dengan mengetik nama (mencegah salah pencet)
function confirmType(nama) {
  return new Promise((resolve) => {
    const s = openSheet(`
      <div class="sheet-head"><div><h3>Hapus "${esc(nama)}"?</h3><p>Semua menu, akun kasir, dan riwayat pesanan kantin ini ikut terhapus permanen. Ketik nama kantin untuk memastikan.</p></div></div>
      <div class="field"><input class="input" id="ct" placeholder="${esc(nama)}" autocomplete="off"></div>
      <div class="sheet-actions"><button class="btn ghost" data-act="no">Batal</button><button class="btn danger" data-act="yes" disabled>Hapus permanen</button></div>`);
    const yes = $('[data-act="yes"]', s.el), inp = $("#ct", s.el);
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
    inp.addEventListener("input", () => { yes.disabled = inp.value.trim().toLowerCase() !== nama.trim().toLowerCase(); });
    yes.addEventListener("click", () => finish(inp.value.trim()));
    $('[data-act="no"]', s.el).addEventListener("click", () => finish(null));
    s.overlay.addEventListener("mousedown", (e) => { if (e.target === s.overlay) finish(null); });
    inp.focus();
  });
}

// Ganti password akun sendiri
function passwordModal() {
  const s = openSheet(`
    <div class="sheet-head"><div><h3>Ganti password</h3><p>Minimal 8 karakter. Gunakan password yang tidak dipakai di tempat lain.</p></div>
      <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
    <div class="field"><label for="pl">Password lama</label><input class="input" id="pl" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="pb">Password baru</label><input class="input" id="pb" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="pu">Ulangi password baru</label><input class="input" id="pu" type="password" autocomplete="new-password"></div>
    <div class="form-error" id="err" hidden></div>
    <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Simpan</button></div>`);
  $("#save", s.el).addEventListener("click", async (ev) => {
    const err = $("#err", s.el); err.hidden = true;
    const lama = $("#pl", s.el).value, baru = $("#pb", s.el).value;
    if (baru.length < 8) { err.textContent = "Password baru minimal 8 karakter."; err.hidden = false; return; }
    if (baru !== $("#pu", s.el).value) { err.textContent = "Pengulangan password tidak sama."; err.hidden = false; return; }
    const b = ev.currentTarget; b.disabled = true; b.textContent = "Menyimpan...";
    try { await call("/api/dev/password", { method: "PUT", body: { lama, baru } }); s.close(); toast("Password berhasil diganti", "success"); }
    catch (ex) { if (ex.status === 401) return fail(ex); err.textContent = ex.message; err.hidden = false; b.disabled = false; b.textContent = "Simpan"; }
  });
}

// Grafik penjualan di dashboard
async function loadGrafik() {
  const el = $("#grafik"); if (!el) return;
  const hari = state.hari || 7;
  try {
    const g = await call(`/api/dev/grafik?hari=${hari}`);
    const max = Math.max(1, ...g.harian.map((h) => h.total));
    const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    el.innerHTML = `
      <div class="section-title"><h2>Penjualan</h2>
        <div class="chips">${[7, 30].map((n) => `<button class="chip ${hari === n ? "active" : ""}" data-gh="${n}">${n} hari</button>`).join("")}</div></div>
      <div class="gr-wrap">
        <div class="card bars">${g.harian.length ? g.harian.map((h) => `
          <div class="bar-row"><span>${fmt(h.tanggal)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (h.total / max) * 100)}%"></div></div><b>${rupiah(h.total)}</b></div>`).join("") : `<div class="state" style="padding:20px">Belum ada penjualan lunas.</div>`}</div>
        <div class="card top-list">
          <div class="label" style="padding:10px 0 2px">Kantin terlaris</div>
          ${g.terlaris.length ? g.terlaris.map((k, i) => `<div class="r"><span class="n">${i + 1}</span><span class="t">${esc(k.nama_kantin)}</span><span class="q">${rupiah(k.total)}<br>${k.jumlah_order} order</span></div>`).join("") : `<div class="state" style="padding:16px">Belum ada data.</div>`}
          ${g.jam_ramai.length ? `<div class="hint" style="padding:8px 0 10px">Jam ramai: ${g.jam_ramai.map((j) => `${String(j.jam).padStart(2, "0")}.00`).join(", ")}</div>` : ""}
        </div>
      </div>`;
  } catch (e) { el.innerHTML = ""; }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-gh]"); if (!b) return;
  state.hari = Number(b.dataset.gh); loadGrafik();
});

// Setoran QRIS ke kantin
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-setor]"); if (!b) return;
  const k = state.rekapData?.kantin.find((x) => x.tenant_id === Number(b.dataset.setor));
  if (!k || !k.sisa_qris) return;
  const R = state.rekap;
  if (!(await confirmDialog({ title: `Tandai setoran ${k.nama_kantin}?`, message: `Setoran QRIS ${rupiah(k.sisa_qris)} untuk periode ${R.dari} s/d ${R.sampai} dicatat sudah dibayarkan ke kantin.`, okText: "Ya, sudah disetor" }))) return;
  b.disabled = true;
  try {
    await call("/api/dev/setoran", { method: "POST", body: { tenant_id: k.tenant_id, dari: R.dari, sampai: R.sampai, nominal: k.sisa_qris } });
    toast("Setoran dicatat", "success"); viewRekap();
  } catch (err) { fail(err, "Gagal mencatat setoran"); b.disabled = false; }
});

// Cetak rekap pembayaran
function printRekap(d) {
  if (!d) return;
  let pa = document.getElementById("printArea");
  if (!pa) { pa = document.createElement("div"); pa.className = "print-area"; pa.id = "printArea"; document.body.appendChild(pa); }
  const t = d.total;
  const rows = d.kantin.map((k) => `<tr><td>${esc(k.nama_kantin)}</td><td class="n">${rupiah(k.qris_total)}</td><td class="n">${rupiah(k.cash_total)}</td><td class="n">${rupiah(k.total)}</td><td class="n">${rupiah(k.sisa_qris || 0)}</td><td class="par"></td></tr>`).join("");
  pa.innerHTML = `<div class="print-doc">
    <h2>Rekap Pembayaran</h2>
    <p>Food Court UNUSIDA &middot; Periode ${esc(d.dari)} s/d ${esc(d.sampai)}</p>
    <table><thead><tr><th>Kantin</th><th class="n">QRIS</th><th class="n">Cash</th><th class="n">Total</th><th class="n">Sisa setor QRIS</th><th>Paraf</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>TOTAL</td><td class="n">${rupiah(t.qris_total)}</td><td class="n">${rupiah(t.cash_total)}</td><td class="n">${rupiah(t.total)}</td><td class="n">${rupiah(t.sisa_qris || 0)}</td><td></td></tr></tfoot></table>
    <small>Dicetak ${new Date().toLocaleString("id-ID")}</small></div>`;
  setTimeout(() => window.print(), 80);
}

// Meja: pilih, ubah nomor, buat ulang QR
document.addEventListener("change", (e) => {
  const c = e.target.closest("[data-pick]"); if (!c) return;
  const id = Number(c.dataset.pick);
  if (c.checked) selMeja.add(id); else selMeja.delete(id);
  const b = $("#printSel"); if (!b) return;
  b.disabled = selMeja.size === 0;
  $("#selN").textContent = selMeja.size ? `Cetak terpilih (${selMeja.size})` : "Cetak terpilih";
});
document.addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-edittable]");
  if (ed) {
    const t = state.tables.find((x) => x.id === Number(ed.dataset.edittable)); if (!t) return;
    const s = openSheet(`
      <div class="sheet-head"><div><h3>Ubah nomor meja</h3><p>QR tidak berubah, hanya nama/nomor meja.</p></div>
        <button class="btn ghost icon sm" data-close aria-label="Tutup">${icon("x")}</button></div>
      <div class="field"><label for="nm">Nomor / nama meja</label><input class="input" id="nm" maxlength="10" value="${esc(t.nomor_meja)}"></div>
      <div class="form-error" id="err" hidden></div>
      <div class="sheet-actions"><button class="btn ghost" data-close>Batal</button><button class="btn" id="save">Simpan</button></div>`);
    $("#save", s.el).addEventListener("click", async (ev) => {
      const err = $("#err", s.el); err.hidden = true;
      const b = ev.currentTarget; b.disabled = true;
      try { await call(`/api/dev/tables/${t.id}`, { method: "PATCH", body: { nomor_meja: $("#nm", s.el).value.trim() } }); s.close(); toast("Nomor meja diperbarui", "success"); viewMeja(); }
      catch (ex) { if (ex.status === 401) return fail(ex); err.textContent = ex.message; err.hidden = false; b.disabled = false; }
    });
    return;
  }
  const rg = e.target.closest("[data-regen]");
  if (rg) {
    const t = state.tables.find((x) => x.id === Number(rg.dataset.regen)); if (!t) return;
    if (!(await confirmDialog({ title: `Buat ulang QR meja ${t.nomor_meja}?`, message: "QR yang sudah tercetak di meja ini langsung tidak bisa dipakai lagi. Kamu harus mencetak QR baru.", okText: "Buat ulang", danger: true }))) return;
    try { await call(`/api/dev/tables/${t.id}/qr`, { method: "POST" }); toast("QR dibuat ulang, cetak QR barunya", "success"); viewMeja(); }
    catch (err) { fail(err, "Gagal membuat ulang QR"); }
  }
});

// Tab: log aktivitas (khusus dev)
async function viewLog() {
  loading();
  let rows;
  try { rows = await call("/api/dev/audit?limit=150"); }
  catch (e) { fail(e); return (content().innerHTML = `<div class="state error">${icon("alert")}<h3>Gagal memuat log</h3><p>${esc(e.message)}</p></div>`); }
  content().innerHTML = `
    <div class="section-title" style="margin-top:0"><h2>Log aktivitas</h2><span class="hint">150 aksi terakhir</span></div>
    <div class="card rk-card"><div class="rk-scroll"><table class="rk-table">
      <thead><tr><th>Waktu</th><th>Akun</th><th>Aktivitas</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr style="cursor:default"><td>${new Date(r.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(r.username || "-")}<small>${esc(r.role || "")}</small></td><td>${esc(r.aksi)}</td></tr>`).join("") : `<tr><td colspan="3" class="state">Belum ada aktivitas tercatat.</td></tr>`}</tbody>
    </table></div></div>`;
}
