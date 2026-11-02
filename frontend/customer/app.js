/* ============================================================
   Customer — scan QR meja → pilih kantin → pesan → bayar → lacak
   ============================================================ */
const { api, esc, rupiah, jam, icon, toast, safeImg, store, $, $$ } = FC;

const ORDER_TTL = 12 * 3600 * 1000; // riwayat pesanan di perangkat disimpan 12 jam
const STEPS = ["diterima", "diproses", "siap", "diambil"];
const STEP_LABEL = { diterima: "Diterima", diproses: "Dimasak", siap: "Siap", diambil: "Selesai" };

const state = {
  table: null,
  tenants: [],
  cfg: { qris_aktif: false },            // pengaturan dari server (QRIS aktif atau tidak)
  payMethod: store.get("fc_pay_v3", null), // "qris" | "cash" — berlaku untuk seluruh pesanan
  cart: store.get("fc_cart_v3", {}),     // { [tenantId]: { nama_kantin, catatan, tipe_makan, items: { [menuId]: {nama, harga, qty} } } }
  orders: [],                             // status pesanan dari server
  highlight: null                         // order_id yang baru dibuat
};
const payMethodNow = () => (state.cfg.qris_aktif && state.payMethod !== "cash" ? "qris" : "cash");

const $app = document.getElementById("app");

// ---------- penyimpanan ----------
const saveCart = () => store.set("fc_cart_v3", state.cart);
function getOrderIds() {
  const s = store.get("fc_orders_v2", null);
  if (!s || Date.now() - s.t > ORDER_TTL) { store.del("fc_orders_v2"); return []; }
  return s.ids;
}
function addOrderId(id) {
  const ids = getOrderIds();
  if (!ids.includes(id)) ids.push(id);
  store.set("fc_orders_v2", { t: Date.now(), ids });
}
function clearCustomerSession() {
  state.cart = {};
  saveCart();
  store.del("fc_orders_v2");
  store.del("fc_pay_v3");
  state.payMethod = null;
  state.orders = [];
}

// ---------- keranjang ----------
const cartCount = () => Object.values(state.cart).reduce((n, c) => n + Object.values(c.items).reduce((a, i) => a + i.qty, 0), 0);
const cartTotal = () => Object.values(state.cart).reduce((n, c) => n + tenantSubtotal(c), 0);
const tenantSubtotal = (c) => Object.values(c.items).reduce((a, i) => a + i.harga * i.qty, 0);
const getQty = (tid, mid) => state.cart[tid]?.items[mid]?.qty || 0;

function setQty(tenant, menu, qty) {
  const tid = tenant.id;
  if (qty <= 0) {
    if (!state.cart[tid]) return;
    delete state.cart[tid].items[menu.id];
    if (Object.keys(state.cart[tid].items).length === 0) delete state.cart[tid];
  } else {
    if (!state.cart[tid]) {
      state.cart[tid] = { nama_kantin: tenant.nama_kantin, catatan: "", tipe_makan: "dine_in", items: {} };
    }
    state.cart[tid].items[menu.id] = { nama: menu.nama_menu, harga: menu.harga, qty: Math.min(qty, 99) };
  }
  saveCart();
}

// ---------- kerangka halaman ----------
const logoBox = () => {
  const light = window.FOODCOURT_LOGO || "../assets/logo.png";
  const dark = window.FOODCOURT_LOGO_DARK || "../assets/logo2.png";
  return `<div class="logo-box">
    <picture>
      <source srcset="${dark}" media="(prefers-color-scheme: dark)">
      <img src="${light}" alt="Logo" class="logo-img" onload="this.closest('.logo-box').querySelector('.ico')?.remove()" onerror="this.remove()">
    </picture>
    ${icon("utensils")}
  </div>`;
};
function shell() {
  document.body.classList.add("has-tabbar");
  $app.innerHTML = `
    <header class="top">
      <div class="wrap">
        ${logoBox()}
        <div class="top-r"><span class="meja-chip">${icon("table")}Meja ${esc(state.table.nomor_meja)}</span>${soundBtn()}</div>
      </div>
    </header>
    <nav class="tabbar center" id="nav" aria-label="Navigasi utama">
      <a href="#/" data-r="kantin">${icon("store")}<span>Kantin</span></a>
      <a href="#/cart" data-r="cart">${icon("bag")}<span>Keranjang</span><i class="count" id="cCart" hidden></i></a>
      <a href="#/pesanan" data-r="pesanan">${icon("receipt")}<span>Pesanan</span><i class="count" id="cOrder" hidden></i></a>
    </nav>
    <div id="view"></div>
    <div id="floating"></div>`;
}

const soundBtn = () => `<button class="btn ghost icon sound-btn" data-sound aria-label="Suara notifikasi" aria-pressed="${FC.sound.on}" title="Suara notifikasi">${icon("bell")}</button>`;
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sound]");
  if (!b) return;
  FC.sound.set(!FC.sound.on);
  FC.notify.ask();
  document.querySelectorAll("[data-sound]").forEach((x) => x.setAttribute("aria-pressed", FC.sound.on));
  toast(FC.sound.on ? "Suara notifikasi aktif" : "Suara notifikasi mati");
  if (FC.sound.on) FC.sound.play("tap");
});

function updateBadges(route) {
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === route));
  const c = cartCount();
  const cc = $("#cCart"); cc.hidden = c === 0; cc.textContent = c;
  const active = state.orders.filter((o) => o.status_order !== "diambil").length;
  const co = $("#cOrder"); co.hidden = active === 0; co.textContent = active;
}

const view = () => $("#view");
const currentRoute = () => {
  const r = location.hash.replace(/^#\/?/, "").split("/")[0];
  return r === "cart" || r === "pesanan" ? r : "kantin";
};
function loadingView(text = "Memuat...") {
  view().innerHTML = `<div class="state"><div class="spinner"></div>${esc(text)}</div>`;
}
function errorView(msg, retry) {
  view().innerHTML = `<div class="state error">${icon("alert")}<h3>Ups, ada kendala</h3><p>${esc(msg)}</p>${retry ? `<button class="btn ghost" style="margin-top:14px" id="retry">Coba lagi</button>` : ""}</div>`;
  if (retry) $("#retry").addEventListener("click", retry);
}

// ---------- router (hash) ----------
async function router() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [, name, arg] = hash.split("/");
  $("#floating").innerHTML = "";
  window.scrollTo(0, 0);
  const isHome = !(name === "menu" || name === "cart" || name === "pesanan");
  view().classList.toggle("pg", !isHome);
  document.body.classList.toggle("is-home", isHome);
  if (name === "menu" && arg) { updateBadges("kantin"); return viewMenu(Number(arg)); }
  if (name === "cart") { updateBadges("cart"); return viewCart(); }
  if (name === "pesanan") { updateBadges("pesanan"); return viewPesanan(); }
  updateBadges("kantin");
  return viewKantin();
}

async function fetchTenants() {
  state.tenants = await api("/api/customer/tenants");
  return state.tenants;
}

// ---------- daftar kantin ----------
async function viewKantin() {
  const nOpen = () => state.tenants.filter((t) => t.status === "buka").length;
  const activeOrders = () => state.orders.filter((o) => o.status_order !== "diambil").length;
  view().innerHTML = `
    <section class="hero"><div class="wrap">
      <div class="hero-row"><div class="brand">${logoBox()}<span>Food Court UNUSIDA</span></div>
        <div class="top-r"><span class="meja-chip">${icon("table")}Meja ${esc(state.table.nomor_meja)}</span>${soundBtn()}</div></div>
      <p class="hi">Selamat datang 👋</p>
      <h1>Mau makan apa hari ini?</h1>
    </div></section>
    <main><div class="wrap">
      <div class="hero-card">
        <div class="search">${icon("search")}<input class="input" id="q" placeholder="Cari kantin atau makanan..." autocomplete="off"></div>
        <div id="found" class="found" hidden></div>
        <div class="mini-stats"><div><b id="sOpen">–</b><span>Kantin buka</span></div><div><b id="sCart">${cartCount()}</b><span>Di keranjang</span></div><div><b>${activeOrders()}</b><span>Pesanan aktif</span></div></div>
      </div>
      <div class="sec-head"><h2>Pilih Kantin</h2><small>Pesan dari banyak kantin, bayar sekali</small></div>
      <div class="grid" id="grid">${Array(4).fill('<div class="skeleton" style="height:210px"></div>').join("")}</div>
    </div></main>`;
  try {
    await fetchTenants();
  } catch (e) { return errorView(e.message, viewKantin); }
  let allMenus = null;
  const loadAllMenus = async () => (allMenus = allMenus || (await api("/api/customer/menus")));
  const drawFound = async (k) => {
    const box = $("#found");
    if (!k) { box.hidden = true; return; }
    let menus;
    try { menus = await loadAllMenus(); } catch { menus = []; }
    if ($("#q").value.trim().toLowerCase() !== k) return;
    const groups = groupMenus(menus, k);
    box.hidden = !groups.length;
    box.innerHTML = groups.map(cmpGroup).join("");
    if (!groups.length && !state.tenants.some((t) => t.nama_kantin.toLowerCase().includes(k))) {
      $("#grid").innerHTML = `<div class="state" style="grid-column:1/-1">${icon("search")}<h3>Tidak ditemukan</h3><p>Coba kata kunci lain: nama kantin atau nama makanan.</p></div>`;
    }
  };
  const draw = (q = "") => {
    const k = q.trim().toLowerCase();
    const list = state.tenants.filter((t) => t.nama_kantin.toLowerCase().includes(k));
    $("#grid").innerHTML = list.map(kantinCard).join("");
    drawFound(k);
  };
  draw();
  // tambah / kurangi langsung dari hasil pencarian (bandingkan harga antar kedai tanpa buka satu per satu)
  $("#found").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn || !allMenus) return;
    const m = allMenus.find((x) => x.id === Number(btn.dataset.menu));
    const tenant = m && state.tenants.find((t) => t.id === m.tenant_id);
    if (!tenant) return;
    const cur = getQty(tenant.id, m.id);
    setQty(tenant, { id: m.id, nama_menu: m.nama_menu, harga: m.harga }, btn.dataset.act === "plus" ? cur + 1 : cur - 1);
    drawFound($("#q").value.trim().toLowerCase());
    $("#sCart").textContent = cartCount();
    renderCartBar();
    updateBadges("kantin");
  });
  $("#sOpen").textContent = nOpen();
  $("#q").addEventListener("input", (e) => draw(e.target.value));
  updateBadges("kantin");
}

// ---------- pencarian menu: kelompokkan menu bernama sama dari banyak kedai ----------
const norm = (x) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
function groupMenus(menus, q) {
  const words = norm(q).split(" ").filter(Boolean);
  const map = new Map();
  for (const m of menus) {
    const n = norm(m.nama_menu);
    if (!words.every((w) => n.includes(w))) continue;
    if (!map.has(n)) map.set(n, { nama: m.nama_menu, opts: [] });
    map.get(n).opts.push(m);
  }
  const ready = (m) => m.status === "tersedia" && m.kantin_status === "buka";
  return [...map.values()].map((g) => {
    g.opts.sort((a, b) => (ready(b) - ready(a)) || a.harga - b.harga); // yang bisa dipesan dulu, lalu termurah
    const first = g.opts.find(ready);
    g.nReady = g.opts.filter(ready).length;
    g.cheapestId = first ? first.id : null;
    g.min = (first || g.opts[0]).harga;
    return g;
  }).sort((a, b) => (b.opts.length - a.opts.length) || a.nama.localeCompare(b.nama)).slice(0, 10);
}
function cmpGroup(g) {
  const multi = g.nReady > 1;
  return `<div class="cmp">
    <div class="cmp-head"><b>${esc(g.nama)}</b><small>${multi ? `${g.nReady} kedai · mulai ${rupiah(g.min)}` : esc(g.opts[0].nama_kantin)}</small></div>
    ${g.opts.map((m) => cmpRow(m, g)).join("")}
  </div>`;
}
function cmpRow(m, g) {
  const open = m.kantin_status === "buka", sold = m.status === "habis";
  const qty = getQty(m.tenant_id, m.id);
  const img = safeImg(m.image_url);
  let action;
  if (sold) action = `<span class="badge red">Habis</span>`;
  else if (!open) action = `<span class="badge">Tutup</span>`;
  else if (qty > 0) action = `<div class="qty"><button data-act="minus" data-menu="${m.id}" aria-label="Kurangi">${icon("minus", "sm")}</button><span>${qty}</span><button data-act="plus" data-menu="${m.id}" aria-label="Tambah">${icon("plus", "sm")}</button></div>`;
  else action = `<button class="add" data-act="plus" data-menu="${m.id}" aria-label="Tambah ${esc(m.nama_menu)} dari ${esc(m.nama_kantin)}">${icon("plus")}</button>`;
  return `<div class="cmp-row ${sold || !open ? "off" : ""}">
    <a class="t" href="#/menu/${m.tenant_id}" aria-label="Buka ${esc(m.nama_kantin)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="ph">${icon("utensils")}</div>`}</a>
    <a class="who" href="#/menu/${m.tenant_id}"><b>${esc(m.nama_kantin)}</b>${m.id === g.cheapestId && g.nReady > 1 ? `<span class="badge green">Termurah</span>` : ""}</a>
    <span class="p">${rupiah(m.harga)}</span>${action}
  </div>`;
}

function kantinCard(t) {
  const open = t.status === "buka";
  const img = safeImg(t.foto);
  return `
    <button class="kantin ${open ? "" : "closed"}" data-id="${t.id}" ${open ? "" : "disabled"} aria-label="${esc(t.nama_kantin)}${open ? "" : " (tutup)"}">
      <div class="thumb">${img ? `<img src="${esc(img)}" alt="Foto ${esc(t.nama_kantin)}" loading="lazy">` : `<div class="ph">${icon("store")}</div>`}<span class="tag">${open ? "Buka" : "Tutup"}</span></div>
      <div class="body">
        <h3>${esc(t.nama_kantin)}</h3>
        <small class="k-sub">${open ? "Lihat menu" : "Sedang tutup"}${open ? icon("chev", "sm") : ""}</small>
      </div>
    </button>`;
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".kantin[data-id]");
  if (card && !card.disabled) location.hash = `#/menu/${card.dataset.id}`;
});

// ---------- menu 1 kantin ----------
async function viewMenu(tenantId) {
  loadingView("Memuat menu...");
  let menus;
  try {
    if (!state.tenants.length) await fetchTenants();
    menus = await api(`/api/customer/tenants/${tenantId}/menus`);
  } catch (e) { return errorView(e.message, () => viewMenu(tenantId)); }

  const tenant = state.tenants.find((t) => t.id === tenantId);
  if (!tenant) return errorView("Kantin tidak ditemukan", () => (location.hash = "#/"));
  const open = tenant.status === "buka";

  let mq = "";
  const draw = () => {
    const shown = menus.filter((m) => m.nama_menu.toLowerCase().includes(mq));
    $("#menus").innerHTML = shown.length ? shown.map((m) => menuRow(tenant, m, open)).join("")
      : `<div class="state" style="grid-column:1/-1">${icon("utensils")}<h3>Menu tidak ditemukan</h3><p>Coba kata kunci lain.</p></div>`;
    renderCartBar();
  };

  view().innerHTML = `
    <a class="back" href="#/">${icon("chevron-left")}Semua kantin</a>
    <div class="kantin-cover">
      ${safeImg(tenant.foto) ? `<img src="${esc(safeImg(tenant.foto))}" alt="Foto ${esc(tenant.nama_kantin)}">` : ""}
      <div class="cap"><h1>${esc(tenant.nama_kantin)}</h1>
        <div class="badges">
          <span class="badge ${open ? "green" : ""}">${open ? '<i class="dot"></i>Buka' : "Tutup"}</span>
        </div></div>
    </div>
    ${open ? "" : `<div class="form-error" style="margin:0 0 12px">Kantin ini sedang tutup, pesanan belum bisa dibuat.</div>`}
    <div class="search menu-search">${icon("search")}<input class="input" id="mq" placeholder="Cari menu di kantin ini..." autocomplete="off"></div>
    <div class="menu-grid" id="menus"></div>`;
  draw();
  $("#mq").addEventListener("input", (e) => { mq = e.target.value.trim().toLowerCase(); draw(); });

  $("#menus").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const menu = menus.find((m) => m.id === Number(btn.dataset.menu));
    if (!menu) return;
    const cur = getQty(tenant.id, menu.id);
    setQty(tenant, menu, btn.dataset.act === "plus" ? cur + 1 : cur - 1);
    draw();
    updateBadges("kantin");
  });
}

function menuRow(tenant, m, open) {
  const sold = m.status === "habis";
  const qty = getQty(tenant.id, m.id);
  const img = safeImg(m.image_url);
  let action = "";
  if (sold) action = `<span class="badge red">Habis</span>`;
  else if (!open) action = "";
  else if (qty > 0) action = `<div class="qty"><button data-act="minus" data-menu="${m.id}" aria-label="Kurangi">${icon("minus", "sm")}</button><span>${qty}</span><button data-act="plus" data-menu="${m.id}" aria-label="Tambah">${icon("plus", "sm")}</button></div>`;
  else action = `<button class="add" data-act="plus" data-menu="${m.id}" aria-label="Tambah ${esc(m.nama_menu)}">${icon("plus")}</button>`;
  return `
    <div class="card menu-item ${sold ? "sold" : ""}">
      <div class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="ph">${icon("utensils")}</div>`}</div>
      <div class="info"><h4>${esc(m.nama_menu)}</h4></div>
      <div class="foot"><span class="price">${rupiah(m.harga)}</span>${action}</div>
    </div>`;
}

function renderCartBar() {
  const n = cartCount();
  $("#floating").innerHTML = n === 0 ? "" : `
    <a class="cartbar" href="#/cart">
      <div>${n} item di keranjang<small>${rupiah(cartTotal())}</small></div>
      <span class="go">Lihat keranjang ${icon("chevron-right")}</span>
    </a>`;
}

// ---------- keranjang & checkout (satu pembayaran untuk semua kantin) ----------
async function viewCart() {
  const ids = Object.keys(state.cart);
  if (ids.length === 0) {
    view().innerHTML = `<div class="state">${icon("bag")}<h3>Keranjang masih kosong</h3><p>Pilih kantin dan tambahkan menu favoritmu.</p><a class="btn" style="margin-top:16px" href="#/">Lihat kantin</a></div>`;
    return;
  }
  if (!state.tenants.length) { try { await fetchTenants(); } catch { /* tetap lanjut */ } }
  const m = payMethodNow();
  view().innerHTML = `
    <h1 class="page-title">Keranjang</h1>
    <p class="page-sub">Pesan dari beberapa kantin sekaligus, bayarnya cukup satu kali.</p>
    <div class="cart-list">${ids.map(cartCard).join("")}</div>
    <section class="card cart-sum">
      <div class="label">Cara bayar</div>
      <div class="pay-opts">
        <button class="pay-opt ${m === "qris" ? "active" : ""}" data-pay="qris" ${state.cfg.qris_aktif ? "" : "disabled"}>${icon("qr")}<span><strong>QRIS</strong><small>${state.cfg.qris_aktif ? "Satu QR untuk semua kantin" : "Belum tersedia"}</small></span></button>
        <button class="pay-opt ${m === "cash" ? "active" : ""}" data-pay="cash">${icon("cash")}<span><strong>Cash</strong><small>Bayar di kasir tiap kantin</small></span></button>
      </div>
      <p class="pay-hint">${m === "qris" ? "Setelah memesan, muncul satu QR dengan nominal gabungan. Lunas terdeteksi otomatis." : "Sebutkan nomor antrian dan bayar tunai langsung ke kasir masing-masing kantin."}</p>
      <div class="total"><span>Total (${ids.length} kantin)</span><span>${rupiah(cartTotal())}</span></div>
      <button class="btn block" id="placeOrder">${m === "qris" ? "Pesan & bayar QRIS" : "Pesan sekarang"}</button>
    </section>`;
}

function cartCard(tid) {
  const c = state.cart[tid];
  const tenant = state.tenants.find((t) => t.id === Number(tid));
  const closed = tenant && tenant.status !== "buka";
  const tipe = c.tipe_makan === "takeaway" ? "takeaway" : "dine_in";
  const lines = Object.entries(c.items).map(([mid, it]) => `
    <div class="line">
      <div><div class="name">${esc(it.nama)}</div><div class="sub">${rupiah(it.harga)} × ${it.qty} = ${rupiah(it.harga * it.qty)}</div></div>
      <div class="qty"><button data-act="minus" data-t="${tid}" data-m="${mid}" aria-label="Kurangi">${icon("minus", "sm")}</button><span>${it.qty}</span><button data-act="plus" data-t="${tid}" data-m="${mid}" aria-label="Tambah">${icon("plus", "sm")}</button></div>
    </div>`).join("");
  return `
    <section class="card cart-card" data-t="${tid}">
      <h3>${esc(c.nama_kantin)}<a class="link-btn" href="#/menu/${tid}">${icon("plus", "sm")}Tambah menu</a></h3>
      ${closed ? `<div class="form-error" style="margin:0 0 10px">Kantin ini sedang tutup. Hapus item atau tunggu sampai buka.</div>` : ""}
      ${lines}
      <div class="tipe-row">
        <button class="tipe-chip ${tipe === "dine_in" ? "active" : ""}" data-tipe="dine_in" data-t="${tid}">${icon("utensils", "sm")}Makan di tempat</button>
        <button class="tipe-chip ${tipe === "takeaway" ? "active" : ""}" data-tipe="takeaway" data-t="${tid}">${icon("bag", "sm")}Bungkus</button>
      </div>
      <div class="field" style="margin:12px 0 0"><label>Catatan untuk kantin (opsional)</label>
        <input class="input" data-note="${tid}" maxlength="255" placeholder="Contoh: tidak pedas, es dipisah" value="${esc(c.catatan)}"></div>
      <div class="total"><span>Subtotal</span><span>${rupiah(tenantSubtotal(c))}</span></div>
    </section>`;
}

document.addEventListener("click", async (e) => {
  const qtyBtn = e.target.closest(".cart-card [data-act]");
  if (qtyBtn) {
    const { t, m, act } = qtyBtn.dataset;
    const it = state.cart[t]?.items[m];
    if (!it) return;
    const tenant = { id: Number(t), nama_kantin: state.cart[t].nama_kantin };
    setQty(tenant, { id: Number(m), nama_menu: it.nama, harga: it.harga }, it.qty + (act === "plus" ? 1 : -1));
    updateBadges("cart");
    return viewCart();
  }
  const tipeBtn = e.target.closest("[data-tipe]");
  if (tipeBtn && state.cart[tipeBtn.dataset.t]) {
    state.cart[tipeBtn.dataset.t].tipe_makan = tipeBtn.dataset.tipe;
    saveCart();
    return viewCart();
  }
  const payBtn = e.target.closest("[data-pay]");
  if (payBtn && !payBtn.disabled) {
    state.payMethod = payBtn.dataset.pay;
    store.set("fc_pay_v3", state.payMethod);
    return viewCart();
  }
  const orderBtn = e.target.closest("#placeOrder");
  if (orderBtn) return placeOrder(orderBtn);
});
document.addEventListener("input", (e) => {
  const note = e.target.closest("[data-note]");
  if (note && state.cart[note.dataset.note]) { state.cart[note.dataset.note].catatan = note.value; saveCart(); }
});

async function placeOrder(btn) {
  const ids = Object.keys(state.cart);
  if (!ids.length) return;
  const metode = payMethodNow();
  btn.disabled = true;
  FC.notify.ask(); // klik ini adalah sentuhan pengguna, jadi izin notifikasi boleh diminta sekarang
  const label = btn.textContent;
  btn.textContent = "Mengirim pesanan...";
  try {
    const res = await api("/api/customer/checkout", {
      method: "POST",
      body: {
        table_id: state.table.id,
        metode_bayar: metode,
        carts: ids.map((tid) => ({
          tenant_id: Number(tid),
          tipe_makan: state.cart[tid].tipe_makan === "takeaway" ? "takeaway" : "dine_in",
          catatan: state.cart[tid].catatan,
          items: Object.entries(state.cart[tid].items).map(([mid, it]) => ({ menu_id: Number(mid), qty: it.qty }))
        }))
      }
    });
    addOrderId(res.order_id);
    state.cart = {};
    saveCart();
    state.highlight = res.order_id;
    joinRooms();
    // Kembali ke beranda, tampilkan sheet sukses
    location.hash = "#/";
    setTimeout(() => showOrderSuccessSheet(res.order_id, metode), 100);
  } catch (e) {
    toast(e.message, "error");
    btn.disabled = false;
    btn.textContent = label;
    if (e.status === 409 || e.status === 404) { try { await fetchTenants(); } catch { /* abaikan */ } viewCart(); }
  }
}

// ---------- sheet sukses setelah checkout ----------
function showOrderSuccessSheet(orderId, metode) {
  const isQris = metode === "qris";
  const sheets = FC.openSheet(
    '<div class="success-sheet">' +
    '<div class="success-icon">' + icon("check") + '</div>' +
    '<h2 class="success-title">Pesanan Terkirim!</h2>' +
    '<p class="success-sub">Pesanan <b>#' + orderId + '</b> sudah diterima kantin.</p>' +
    (isQris
      ? '<div class="success-hint">' + icon("qr") + '<span>Buka tab <b>Pesanan</b> untuk scan QR pembayaran QRIS.</span></div>'
      : '<div class="success-hint cash-hint">' + icon("cash") + '<span>Sebutkan nomor antrian &amp; bayar tunai ke kasir tiap kantin.</span></div>'
    ) +
    '<div class="success-actions">' +
    '<a class="btn block" href="#/pesanan" id="goOrders">Lihat status pesanan</a>' +
    '<button class="btn ghost block" id="goHome" style="margin-top:8px">Pesan lagi</button>' +
    '</div></div>'
  );
  const el = sheets.el, close = sheets.close;
  el.querySelector("#goOrders").addEventListener("click", close);
  el.querySelector("#goHome").addEventListener("click", close);
}

// ---------- pesanan & pembayaran ----------
let socket = null;
let pollTimer = null;

async function loadOrders() {
  const ids = getOrderIds();
  if (!ids.length) { state.orders = []; return; }
  state.orders = await api(`/api/customer/orders/status?ids=${ids.join(",")}`);
}

async function viewPesanan() {
  loadingView("Memuat pesanan...");
  try { await loadOrders(); } catch (e) { return errorView(e.message, viewPesanan); }
  drawOrders();
  updateBadges("pesanan");
  joinRooms();
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => { // cadangan kalau koneksi realtime putus
    if (!location.hash.startsWith("#/pesanan")) return clearInterval(pollTimer);
    try { await loadOrders(); drawOrders(); updateBadges("pesanan"); } catch { /* abaikan */ }
  }, 20000);
}

function groupOrders() {
  const m = new Map();
  for (const o of state.orders) { if (!m.has(o.order_id)) m.set(o.order_id, []); m.get(o.order_id).push(o); }
  return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([id, rows]) => ({ id, rows }));
}

function drawOrders() {
  if (!location.hash.startsWith("#/pesanan")) return;
  if (!state.orders.length) {
    view().innerHTML = `<div class="state">${icon("receipt")}<h3>Belum ada pesanan</h3><p>Pesananmu akan muncul di sini beserta statusnya.</p><a class="btn" style="margin-top:16px" href="#/">Pesan sekarang</a></div>`;
    return;
  }
  const allCompleted = state.orders.length > 0 && state.orders.every((o) => o.status_order === "diambil");
  view().innerHTML = `
    <h1 class="page-title">Pesananmu</h1>
    <p class="page-sub">Status diperbarui otomatis dan berbunyi saat pesanan siap. Tunjukkan nomor antrian saat mengambil.</p>
    ${allCompleted ? `
      <div class="order-done-banner">
        <div class="done-icon">${icon("check")}</div>
        <h4>Semua pesanan selesai!</h4>
        <p>Terima kasih telah berkunjung ke Food Court UNUSIDA. Meja siap untuk pelanggan berikutnya.</p>
        <button class="btn sm" id="btnFinishTable">${icon("check", "sm")}Selesai &amp; Kosongkan Meja</button>
      </div>` : ""
    }
    <div class="orders">${groupOrders().map(orderGroup).join("")}</div>
    <div style="text-align:center;margin-top:20px"><a class="btn ghost" href="#/">${icon("plus", "sm")}Pesan lagi</a></div>`;
  const btnFinish = document.getElementById("btnFinishTable");
  if (btnFinish) {
    btnFinish.addEventListener("click", () => {
      clearCustomerSession();
      updateBadges(currentRoute());
      toast("Sesi meja telah diselesaikan. Terima kasih!", "success");
      location.hash = "#/";
    });
  }
  if (state.highlight) {
    const el = document.getElementById(`og-${state.highlight}`);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    state.highlight = null;
  }
}

function orderGroup(g) {
  const first = g.rows[0];
  const qris = first.metode_bayar === "qris";
  return `
    <section class="og ${state.highlight === g.id ? "highlight" : ""}" id="og-${g.id}">
      <div class="og-head"><b>Pesanan #${g.id}</b><span>${jam(first.created_at)} · ${qris ? "QRIS" : "Cash"} · ${rupiah(first.order_total)}</span></div>
      ${qris ? qrisBox(g) : ""}
      ${g.rows.map((o) => orderCard(o, !qris)).join("")}
    </section>`;
}

function orderCard(o, showCash) {
  const idx = STEPS.indexOf(o.status_order);
  const steps = STEPS.map((s, i) => `
    <div class="step ${i < idx ? "done" : ""} ${i === idx ? "active" : ""}">
      <div class="dotn">${i < idx ? icon("check", "sm") : i + 1}</div>${STEP_LABEL[s]}
    </div>`).join("");
  const items = o.items.map((i) => `<div><span>${esc(i.nama_menu)} × ${i.qty}</span><span>${rupiah(i.harga_satuan * i.qty)}</span></div>`).join("");
  return `
    <article class="card order" id="ot-${o.order_tenant_id}">
      <div class="order-head">
        <div><h3>${esc(o.nama_kantin)}</h3><div class="when">${o.tipe_makan === "takeaway" ? "Bungkus" : "Makan di tempat"}</div>
          <div style="margin-top:8px"><span class="badge ${o.status_bayar === "lunas" ? "green" : "amber"}">${o.status_bayar === "lunas" ? "Lunas" : "Belum dibayar"}</span></div></div>
        <div class="queue"><small>Antrian</small><b>${esc(o.nomor_antrian)}</b></div>
      </div>
      <div class="steps">${steps}</div>
      ${o.status_order === "siap" ? `<div class="ready-banner">${icon("bell")}Pesananmu sudah siap! Ambil di ${esc(o.nama_kantin)}.</div>` : ""}
      ${o.status_order === "diambil" ? `<div class="ready-banner" style="background:var(--brand-soft);color:var(--brand-dark)">${icon("check")}Selesai. Selamat menikmati!</div>` : ""}
      <div class="items-sum">${items}${o.catatan ? `<div class="note">Catatan: ${esc(o.catatan)}</div>` : ""}
        <div style="color:var(--text);font-weight:700;margin-top:4px"><span>Subtotal</span><span>${rupiah(o.subtotal)}</span></div></div>
      ${showCash ? cashBox(o) : ""}
    </article>`;
}

function cashBox(o) {
  if (o.status_bayar === "lunas") {
    const done = o.status_order === "diambil";
    return '<div class="pay-box paid">' +
      '<h4>' + icon("check") + 'Pembayaran sudah diterima kasir</h4>' +
      (done ? '<div class="paid-done-label">' + icon("utensils","sm") + ' Pesanan selesai — selamat menikmati!</div>' : '') +
      '</div>';
  }
  return '<div class="pay-box cash">' +
    '<h4>' + icon("cash") + 'Bayar tunai ke kasir</h4>' +
    '<div class="cash-detail">' +
    '<div class="cash-row"><span>Antrian</span><b>#' + esc(o.nomor_antrian) + '</b></div>' +
    '<div class="cash-row"><span>Total</span><b>' + rupiah(o.subtotal) + '</b></div>' +
    '<p class="cash-note">Bayar di kasir <b>' + esc(o.nama_kantin) + '</b></p>' +
    '</div></div>';
}

// ---------- QRIS: satu QR untuk seluruh pesanan, nominal terkunci, lunas terdeteksi sendiri ----------
const qrBusy = new Set();     // order_id yang sedang dibuatkan QR
const qrFailed = new Set();   // order_id yang gagal dibuatkan QR (menunggu pelanggan menekan "Buat QR baru")
const paidShown = new Set();
const isImgUrl = (t) => /^https?:\/\//.test(String(t || ""));
const qrSvg = (text) => {
  if (isImgUrl(text)) return `<img class="qr-photo" src="${esc(text)}" alt="Kode QRIS pembayaran" referrerpolicy="no-referrer" onerror="this.closest('.qr-live').classList.add('qr-err')">`;
  const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
};
const fmtLeft = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function qrisBox(g) {
  const o = g.rows[0];
  const bayar = o.total_bayar || o.order_total;
  if (o.order_status_bayar === "lunas") {
    return `<div class="pay-box paid"><h4>${icon("check")}Pembayaran QRIS berhasil</h4><div class="pay-amount">${rupiah(bayar)}</div></div>`;
  }
  const live = o.qris_string && o.qris_expires_ms && o.qris_expires_ms > Date.now();
  if (!live) {
    if (qrFailed.has(g.id)) {
      return `<div class="pay-box cash"><h4>${icon("alert")}QR belum bisa dibuat</h4>Coba lagi, atau bayar tunai di kasir tiap kantin.
        <div class="pay-actions"><button class="btn block" data-renew="${g.id}">Buat QR baru</button></div></div>`;
    }
    if (!qrBusy.has(g.id)) setTimeout(() => ensureQris(g.id), 0);
    return `<div class="pay-box"><h4>${icon("qr")}Bayar dengan QRIS</h4>
      <div class="state" style="padding:18px 0"><div class="spinner"></div>${o.qris_string ? "QR kedaluwarsa, membuat QR baru…" : "Menyiapkan QR pembayaran…"}</div></div>`;
  }
  const fee = Number(o.biaya_layanan) || 0;
  return `
    <div class="pay-box pay-qris"><h4>${icon("qr")}Bayar dengan QRIS (satu QR untuk semua kantin)</h4>
      <div class="qris-img qr-live">${qrSvg(o.qris_string)}<div class="qr-fail">QR gagal dimuat.<br><button class="btn soft" data-renew="${g.id}">Muat ulang QR</button></div></div>
      <div class="pay-name">Bayar tepat nominal ini</div>
      <div class="pay-amount">${rupiah(bayar)}</div>
      ${fee > 0 ? `<div class="pay-fee">Pesanan ${rupiah(o.order_total)} + biaya layanan ${rupiah(fee)}</div>` : ""}
      <ol class="pay-steps"><li>Buka e-wallet / m-banking, pilih <b>Scan QR</b>.</li><li>Scan QR di atas. Pastikan nominal <b>${rupiah(bayar)}</b> sama persis.</li><li>Selesai bayar, halaman ini otomatis menandai <b>lunas</b> dan berbunyi.</li></ol>
      ${isImgUrl(o.qris_string) ? `<div class="pay-actions"><button class="btn soft block" data-saveqr="${esc(o.qris_string)}">${icon("download", "sm")}Simpan QR ke galeri</button></div><div class="pay-hint">Bayar dari HP ini? Simpan QR, lalu di aplikasi e-wallet pilih <b>Scan</b> &rarr; <b>Galeri / Unggah QR</b>.</div>` : ""}
      <div class="pay-wait">${icon("clock", "sm")}Menunggu pembayaran… berlaku <b data-left="${o.qris_expires_ms}">${fmtLeft(o.qris_expires_ms - Date.now())}</b></div>
      ${state.cfg.mock ? `<div class="pay-actions"><button class="btn soft block" data-mockpay="${g.id}">Simulasi bayar (mode tes)</button></div>` : ""}
    </div>`;
}

async function ensureQris(orderId) {
  if (qrBusy.has(orderId)) return;
  qrBusy.add(orderId);
  qrFailed.delete(orderId);
  try {
    const r = await api(`/api/customer/orders/${orderId}/qris`, { method: "POST" });
    if (r.status_bayar === "lunas") await loadOrders();
    else state.orders.filter((o) => o.order_id === orderId).forEach((o) => {
      o.qris_string = r.qris_string; o.qris_expires_ms = r.qris_expires_ms;
      o.biaya_layanan = r.biaya_layanan; o.total_bayar = r.total_bayar;
    });
  } catch (err) {
    qrFailed.add(orderId);
    toast(err.message, "error");
  } finally { qrBusy.delete(orderId); drawOrders(); }
}

function onPaid(orderId, nominal) {
  if (paidShown.has(orderId)) return;
  paidShown.add(orderId);
  toast(`Pembayaran berhasil${nominal ? " " + rupiah(nominal) : ""}`, "success");
  FC.sound.play("paid");
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  FC.notify.show("Pembayaran berhasil", `Pesanan #${orderId} sudah lunas${nominal ? " · " + rupiah(nominal) : ""}`, { tag: "paid-" + orderId });
  FC.attention("Pembayaran berhasil");
}

document.addEventListener("click", async (e) => {
  const renew = e.target.closest("[data-renew]");
  if (renew) ensureQris(Number(renew.dataset.renew));
  const save = e.target.closest("[data-saveqr]");
  if (save) {
    const url = save.dataset.saveqr;
    try {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "qris-pembayaran.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("QR disimpan. Buka e-wallet, pilih Scan lalu Galeri.", "success");
    } catch { window.open(url, "_blank", "noopener"); toast("Tekan lama gambar QR di tab baru lalu pilih Simpan.", "info"); }
  }
  const mock = e.target.closest("[data-mockpay]");
  if (mock) {
    mock.disabled = true;
    try { await api("/api/payments/mock/pay", { method: "POST", body: { order_id: Number(mock.dataset.mockpay) } }); }
    catch (err) { toast(err.message, "error"); mock.disabled = false; }
  }
});

// Hitung mundur QR + cek berkala ke server (cadangan jika notifikasi realtime terlambat)
setInterval(() => {
  let expired = false;
  document.querySelectorAll("[data-left]").forEach((el) => {
    const left = Number(el.dataset.left) - Date.now();
    el.textContent = fmtLeft(left);
    if (left <= 0) expired = true;
  });
  if (expired) drawOrders(); // QR habis waktu -> otomatis dibuatkan yang baru
}, 1000);
setInterval(async () => {
  const waiting = groupOrders().filter((g) => g.rows[0].metode_bayar === "qris" && g.rows[0].order_status_bayar === "pending" && g.rows[0].qris_string);
  for (const g of waiting) {
    try {
      const r = await api(`/api/customer/orders/${g.id}/cek-bayar`, { method: "POST" });
      if (r.status_bayar === "lunas") {
        await loadOrders(); drawOrders(); updateBadges(currentRoute());
        const n = state.orders.find((x) => x.order_id === g.id);
        onPaid(g.id, n && (n.total_bayar || n.order_total));
      }
    } catch { /* abaikan, coba lagi di putaran berikutnya */ }
  }
}, 4000);

// ---------- realtime ----------
function joinRooms() {
  if (!socket) {
    socket = FC.connectSocket();
    if (!socket) return;
    socket.on("connect", joinRooms);
    const refresh = async (data) => {
      const before = data.order_tenant_id ? state.orders.find((o) => o.order_tenant_id === data.order_tenant_id) : null;
      try { await loadOrders(); } catch { return; }
      if (data.status_order === "siap" && before && before.status_order !== "siap") {
        toast(`Pesanan ${before.nama_kantin} sudah siap!`, "success");
        FC.sound.play("ready");
        FC.sound.nag("ready", { every: 25000, max: 5 });   // ingatkan lagi sampai layar disentuh
        if (navigator.vibrate) navigator.vibrate([400, 120, 400, 120, 400, 120, 600]);
        FC.notify.show("Pesanan siap diambil!", `Antrian ${before.nomor_antrian} di ${before.nama_kantin}`, { tag: "siap-" + before.order_tenant_id });
        FC.attention("Pesanan siap!");
      }
      drawOrders(); updateBadges(currentRoute());
      if (data.status_bayar === "lunas") {
        if (data.order_id) {
          const n = state.orders.find((o) => o.order_id === data.order_id);
          onPaid(data.order_id, n && (n.total_bayar || n.order_total));
        } else if (before) {
          toast(`Pembayaran ${before.nama_kantin} diterima kasir`, "success");
          FC.sound.play("paid");
        }
      }
    };
    socket.on("status_update", refresh);
    socket.on("bayar_update", refresh);
  }
  getOrderIds().forEach((id) => socket.emit("join_order_room", id));
}

// ---------- start: validasi meja dari QR ----------
function fatal(title, text) {
  $app.innerHTML = `<div class="fatal">${icon("qr")}<h1>${esc(title)}</h1><p>${esc(text)}</p></div>`;
}

async function init() {
  const p = new URLSearchParams(location.search);
  const qr = p.get("qr") || p.get("meja");
  const saved = store.get("fc_table_v2", null);
  try {
    if (qr) {
      const table = await api(`/api/customer/tables/${encodeURIComponent(qr)}`);
      state.table = table;
      store.set("fc_table_v2", { qr, table });
      const existingIds = getOrderIds();
      if (!saved || saved.qr !== qr) {
        // Meja berbeda -> bersihkan sesi pelanggan sebelumnya
        clearCustomerSession();
      } else if (existingIds.length > 0) {
        // Meja sama tapi scan baru: jika semua pesanan lama sudah diambil/selesai -> bersihkan
        try {
          const pastOrders = await api(`/api/customer/orders/status?ids=${existingIds.join(",")}`);
          const hasActive = pastOrders.some((o) => o.status_order !== "diambil");
          if (!hasActive) clearCustomerSession();
        } catch {
          clearCustomerSession();
        }
      }
    } else if (saved) {
      state.table = saved.table;
    } else {
      return fatal("Scan QR di mejamu", "Buka halaman ini lewat QR code yang ada di meja supaya kami tahu pesananmu diantar ke meja mana.");
    }
  } catch (e) {
    return fatal("Meja tidak dikenali", e.status === 404 ? "QR meja tidak valid. Coba scan ulang QR di mejamu." : e.message);
  }
  try { state.cfg = await api("/api/customer/config"); } catch { /* QRIS dianggap belum aktif */ }
  shell();
  window.addEventListener("hashchange", router);
  if (getOrderIds().length) { loadOrders().then(() => updateBadges(currentRoute())).catch(() => {}); joinRooms(); }
  router();
}

init();
