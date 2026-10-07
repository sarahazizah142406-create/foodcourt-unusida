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
  cart: store.get("fc_cart_v2", {}),   // { [tenantId]: { nama_kantin, metode, catatan, items: { [menuId]: {nama, harga, qty} } } }
  orders: [],                           // status pesanan dari server
  highlight: null
};

const $app = document.getElementById("app");

// ---------- penyimpanan ----------
const saveCart = () => store.set("fc_cart_v2", state.cart);
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
      state.cart[tid] = { nama_kantin: tenant.nama_kantin, metode: tenant.qris_aktif ? "qris" : "cash", catatan: "", items: {} };
    }
    state.cart[tid].items[menu.id] = { nama: menu.nama_menu, harga: menu.harga, qty: Math.min(qty, 99) };
  }
  saveCart();
}

// ---------- kerangka halaman ----------
const logoBox = () => `<div class="logo-box"><img src="${window.FOODCOURT_LOGO || "../assets/logo.png"}" alt="Logo" onload="this.nextElementSibling.remove()" onerror="this.remove()">${icon("utensils")}</div>`;
function shell() {
  document.body.classList.add("has-tabbar");
  $app.innerHTML = `
    <header class="top">
      <div class="wrap">
        ${logoBox()}
        <span class="meja-chip">${icon("table")}Meja ${esc(state.table.nomor_meja)}</span>
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
        <span class="meja-chip">${icon("table")}Meja ${esc(state.table.nomor_meja)}</span></div>
      <p class="hi">Selamat datang 👋</p>
      <h1>Mau makan apa hari ini?</h1>
    </div></section>
    <main><div class="wrap">
      <div class="hero-card">
        <div class="search">${icon("search")}<input class="input" id="q" placeholder="Cari kantin atau makanan..." autocomplete="off"></div>
        <div id="found" class="found" hidden></div>
        <div class="mini-stats"><div><b id="sOpen">–</b><span>Kantin buka</span></div><div><b>${cartCount()}</b><span>Di keranjang</span></div><div><b>${activeOrders()}</b><span>Pesanan aktif</span></div></div>
      </div>
      <div class="sec-head"><h2>Pilih Kantin</h2><small>Bayar langsung ke tiap kantin</small></div>
      <div class="grid" id="grid">${Array(4).fill('<div class="skeleton" style="height:210px"></div>').join("")}</div>
    </div></main>`;
  try {
    await fetchTenants();
  } catch (e) { return errorView(e.message, viewKantin); }
  let allMenus = null;
  const loadAllMenus = async () => {
    if (allMenus) return allMenus;
    const lists = await Promise.all(state.tenants.map((t) => api(`/api/customer/tenants/${t.id}/menus`).then((ms) => ms.map((m) => ({ ...m, tenant: t }))).catch(() => [])));
    return (allMenus = lists.flat());
  };
  const draw = async (q = "") => {
    const k = q.trim().toLowerCase();
    const list = state.tenants.filter((t) => t.nama_kantin.toLowerCase().includes(k));
    $("#grid").innerHTML = list.length ? list.map(kantinCard).join("") : `<div class="state" style="grid-column:1/-1">${icon("search")}<h3>Kantin tidak ditemukan</h3></div>`;
    const box = $("#found");
    if (!k) { box.hidden = true; return; }
    const menus = (await loadAllMenus()).filter((m) => m.nama_menu.toLowerCase().includes(k)).slice(0, 12);
    if ($("#q").value.trim().toLowerCase() !== k) return;
    box.hidden = !menus.length;
    box.innerHTML = menus.map((m) => `<a class="res" href="#/menu/${m.tenant.id}">
      <div class="t">${safeImg(m.image_url) ? `<img src="${esc(safeImg(m.image_url))}" alt="" loading="lazy">` : `<div class="ph">${icon("utensils")}</div>`}</div>
      <div><b>${esc(m.nama_menu)}</b><small>${esc(m.tenant.nama_kantin)}${m.status === "habis" ? " · Habis" : ""}</small></div><span class="p">${rupiah(m.harga)}</span></a>`).join("");
  };
  draw();
  $("#sOpen").textContent = nOpen();
  $("#q").addEventListener("input", (e) => draw(e.target.value));
  updateBadges("kantin");
}

function kantinCard(t) {
  const open = t.status === "buka";
  const img = safeImg(t.foto);
  return `
    <button class="kantin ${open ? "" : "closed"}" data-id="${t.id}" ${open ? "" : "disabled"} aria-label="${esc(t.nama_kantin)}${open ? "" : " (tutup)"}">
      <div class="thumb">${img ? `<img src="${esc(img)}" alt="Foto ${esc(t.nama_kantin)}" loading="lazy">` : `<div class="ph">${icon("store")}</div>`}<span class="tag">${open ? "Buka" : "Tutup"}</span></div>
      <div class="body">
        <h3>${esc(t.nama_kantin)}</h3>
        <div class="meta">
          <span class="badge ${open ? "green" : ""}">${open ? '<i class="dot"></i>Buka' : "Tutup"}</span>
          ${t.qris_aktif ? `<span class="badge blue">${icon("qr", "sm")}QRIS</span>` : ""}
        </div>
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
          ${tenant.qris_aktif ? `<span class="badge blue">${icon("qr", "sm")}Terima QRIS</span>` : `<span class="badge amber">${icon("cash", "sm")}Cash saja</span>`}
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

// ---------- keranjang & checkout (bayar per kantin) ----------
async function viewCart() {
  const ids = Object.keys(state.cart);
  if (ids.length === 0) {
    view().innerHTML = `<div class="state">${icon("bag")}<h3>Keranjang masih kosong</h3><p>Pilih kantin dan tambahkan menu favoritmu.</p><a class="btn" style="margin-top:16px" href="#/">Lihat kantin</a></div>`;
    return;
  }
  if (!state.tenants.length) { try { await fetchTenants(); } catch { /* tetap lanjut */ } }

  view().innerHTML = `
    <h1 class="page-title">Keranjang</h1>
    <p class="page-sub">Tiap kantin dibayar terpisah, langsung ke kantin yang bersangkutan.</p>
    <div class="cart-list">${ids.map(cartCard).join("")}</div>`;
}

function cartCard(tid) {
  const c = state.cart[tid];
  const tenant = state.tenants.find((t) => t.id === Number(tid));
  const qrisOk = tenant ? tenant.qris_aktif : false;
  if (c.metode === "qris" && !qrisOk) c.metode = "cash";
  const lines = Object.entries(c.items).map(([mid, it]) => `
    <div class="line">
      <div><div class="name">${esc(it.nama)}</div><div class="sub">${rupiah(it.harga)} × ${it.qty} = ${rupiah(it.harga * it.qty)}</div></div>
      <div class="qty"><button data-act="minus" data-t="${tid}" data-m="${mid}" aria-label="Kurangi">${icon("minus", "sm")}</button><span>${it.qty}</span><button data-act="plus" data-t="${tid}" data-m="${mid}" aria-label="Tambah">${icon("plus", "sm")}</button></div>
    </div>`).join("");
  return `
    <section class="card cart-card" data-t="${tid}">
      <h3>${esc(c.nama_kantin)}<a class="link-btn" href="#/menu/${tid}">${icon("plus", "sm")}Tambah menu</a></h3>
      ${lines}
      <div class="field" style="margin:12px 0 0"><label>Catatan untuk kantin (opsional)</label>
        <input class="input" data-note="${tid}" maxlength="255" placeholder="Contoh: tidak pedas, es dipisah" value="${esc(c.catatan)}"></div>
      <div class="label" style="margin-top:12px">Cara bayar</div>
      <div class="pay-opts">
        <button class="pay-opt ${c.metode === "qris" ? "active" : ""}" data-pay="qris" data-t="${tid}" ${qrisOk ? "" : "disabled"}>${icon("qr")}<span><strong>QRIS</strong><small>${qrisOk ? "Scan & bayar" : "Belum tersedia"}</small></span></button>
        <button class="pay-opt ${c.metode === "cash" ? "active" : ""}" data-pay="cash" data-t="${tid}">${icon("cash")}<span><strong>Cash</strong><small>Bayar di kasir</small></span></button>
      </div>
      <div class="total"><span>Total</span><span>${rupiah(tenantSubtotal(c))}</span></div>
      <button class="btn block" data-order="${tid}">Pesan ke ${esc(c.nama_kantin)}</button>
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
  const payBtn = e.target.closest("[data-pay]");
  if (payBtn && !payBtn.disabled) {
    state.cart[payBtn.dataset.t].metode = payBtn.dataset.pay;
    saveCart();
    return viewCart();
  }
  const orderBtn = e.target.closest("[data-order]");
  if (orderBtn) return askTipe(orderBtn.dataset.order, orderBtn);
});
document.addEventListener("input", (e) => {
  const note = e.target.closest("[data-note]");
  if (note && state.cart[note.dataset.note]) { state.cart[note.dataset.note].catatan = note.value; saveCart(); }
});

// Konfirmasi sebelum pesan: makan di tempat atau bungkus
function askTipe(tid, btn) {
  const c = state.cart[tid];
  if (!c) return;
  const el = document.createElement("div");
  el.className = "sheet-bg";
  el.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <h3>Pesan ke ${esc(c.nama_kantin)}</h3>
      <p class="page-sub" style="margin:4px 0 14px">Pesananmu mau dimakan di sini atau dibungkus?</p>
      <div class="tipe-opts">
        <button class="tipe-opt" data-tipe="dine_in">${icon("utensils")}<strong>Makan di tempat</strong><small>Diantar / diambil di meja</small></button>
        <button class="tipe-opt" data-tipe="takeaway">${icon("bag")}<strong>Bungkus</strong><small>Dibawa pulang</small></button>
      </div>
      <div class="total" style="margin:14px 0 10px"><span>Total</span><span>${rupiah(tenantSubtotal(c))}</span></div>
      <button class="btn ghost block" data-cancel>Batal</button>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tipe]");
    if (t) { c.tipe_makan = t.dataset.tipe; saveCart(); el.remove(); return placeOrder(tid, btn); }
    if (e.target === el || e.target.closest("[data-cancel]")) el.remove();
  });
}

async function placeOrder(tid, btn) {
  const c = state.cart[tid];
  if (!c) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Mengirim pesanan...";
  try {
    const res = await api("/api/customer/checkout", {
      method: "POST",
      body: {
        table_id: state.table.id,
        carts: [{
          tenant_id: Number(tid),
          metode_bayar: c.metode,
          tipe_makan: c.tipe_makan,
          catatan: c.catatan,
          items: Object.entries(c.items).map(([mid, it]) => ({ menu_id: Number(mid), qty: it.qty }))
        }]
      }
    });
    addOrderId(res.order_id);
    delete state.cart[tid];
    saveCart();
    state.highlight = res.kantin[0].order_tenant_id;
    toast("Pesanan terkirim ke kantin", "success");
    location.hash = "#/pesanan";
  } catch (e) {
    toast(e.message, "error");
    btn.disabled = false;
    btn.textContent = label;
    if (e.status === 409 || e.status === 404) { try { await fetchTenants(); } catch { /* abaikan */ } viewCart(); }
  }
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

function drawOrders() {
  if (!location.hash.startsWith("#/pesanan")) return;
  if (!state.orders.length) {
    view().innerHTML = `<div class="state">${icon("receipt")}<h3>Belum ada pesanan</h3><p>Pesananmu akan muncul di sini beserta statusnya.</p><a class="btn" style="margin-top:16px" href="#/">Pesan sekarang</a></div>`;
    return;
  }
  view().innerHTML = `
    <h1 class="page-title">Pesananmu</h1>
    <p class="page-sub">Status diperbarui otomatis. Tunjukkan nomor antrian saat mengambil pesanan.</p>
    <div class="orders">${state.orders.map(orderCard).join("")}</div>
    <div style="text-align:center;margin-top:20px"><a class="btn ghost" href="#/">${icon("plus", "sm")}Pesan lagi</a></div>`;
  if (state.highlight) {
    const el = document.getElementById(`ot-${state.highlight}`);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    state.highlight = null;
  }
}

function orderCard(o) {
  const idx = STEPS.indexOf(o.status_order);
  const steps = STEPS.map((s, i) => `
    <div class="step ${i < idx ? "done" : ""} ${i === idx ? "active" : ""}">
      <div class="dotn">${i < idx ? icon("check", "sm") : i + 1}</div>${STEP_LABEL[s]}
    </div>`).join("");
  const items = o.items.map((i) => `<div><span>${esc(i.nama_menu)} × ${i.qty}</span><span>${rupiah(i.harga_satuan * i.qty)}</span></div>`).join("");
  return `
    <article class="card order ${state.highlight === o.order_tenant_id ? "highlight" : ""}" id="ot-${o.order_tenant_id}">
      <div class="order-head">
        <div><h3>${esc(o.nama_kantin)}</h3><div class="when">${jam(o.created_at)} · ${o.metode_bayar === "qris" ? "QRIS" : "Cash"} · ${o.tipe_makan === "takeaway" ? "Bungkus" : "Makan di tempat"}</div>
          <div style="margin-top:8px"><span class="badge ${o.status_bayar === "lunas" ? "green" : "amber"}">${o.status_bayar === "lunas" ? "Lunas" : "Belum dibayar"}</span></div></div>
        <div class="queue"><small>Antrian</small><b>${esc(o.nomor_antrian)}</b></div>
      </div>
      <div class="steps">${steps}</div>
      ${o.status_order === "siap" ? `<div class="ready-banner">${icon("bell")}Pesananmu sudah siap! Ambil di ${esc(o.nama_kantin)}.</div>` : ""}
      ${o.status_order === "diambil" ? `<div class="ready-banner" style="background:var(--brand-soft);color:var(--brand-dark)">${icon("check")}Selesai. Selamat menikmati!</div>` : ""}
      <div class="items-sum">${items}${o.catatan ? `<div class="note">Catatan: ${esc(o.catatan)}</div>` : ""}
        <div style="color:var(--text);font-weight:700;margin-top:4px"><span>Total</span><span>${rupiah(o.subtotal)}</span></div></div>
      ${paymentBox(o)}
    </article>`;
}

function paymentBox(o) {
  if (o.status_bayar === "lunas") return `<div class="pay-box paid"><h4>${icon("check")}Pembayaran sudah diterima kasir</h4></div>`;
  if (o.metode_bayar === "cash") {
    return `<div class="pay-box cash"><h4>${icon("cash")}Bayar tunai ke kasir</h4>
      Sebutkan nomor antrian <b>${esc(o.nomor_antrian)}</b> dan bayar <b>${rupiah(o.subtotal)}</b> di ${esc(o.nama_kantin)}.</div>`;
  }
  const img = safeImg(o.qris_image);
  if (!img) {
    return `<div class="pay-box cash"><h4>${icon("alert")}QRIS kantin belum tersedia</h4>Silakan bayar tunai di kasir ${esc(o.nama_kantin)}.</div>`;
  }
  return `
    <div class="pay-box"><h4>${icon("qr")}Bayar dengan QRIS</h4>
      <img class="qris-img" src="${esc(img)}" alt="QRIS ${esc(o.nama_kantin)}">
      ${o.qris_nama ? `<div class="pay-name">${esc(o.qris_nama)}</div>` : ""}
      <div class="pay-amount">${rupiah(o.subtotal)}<button class="btn ghost icon sm" data-copy="${o.subtotal}" aria-label="Salin nominal">${icon("copy", "sm")}</button></div>
      <ol class="pay-steps"><li>Buka e-wallet / m-banking, pilih <b>Scan QR</b>.</li><li>Scan QR di atas, masukkan nominal <b>${rupiah(o.subtotal)}</b>.</li><li>Setelah berhasil, tekan tombol di bawah — kamu langsung kembali ke beranda dan kasir akan mengecek.</li></ol>
      <div class="pay-actions">
        ${o.klaim_bayar
          ? `<button class="btn soft block" disabled>${icon("clock")}Kasir sedang mengecek pembayaran</button>`
          : `<button class="btn block" data-klaim="${o.order_tenant_id}">${icon("check")}Selesai bayar, kembali ke beranda</button>`}
        <a class="link-btn" href="${esc(img)}" download="qris-${esc(o.nama_kantin)}.png" target="_blank" rel="noopener">${icon("download", "sm")}Simpan gambar QR</a>
      </div>
    </div>`;
}

document.addEventListener("click", async (e) => {
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); toast("Nominal disalin", "success"); } catch { toast("Salin manual: " + copy.dataset.copy); }
  }
  const klaim = e.target.closest("[data-klaim]");
  if (klaim) {
    klaim.disabled = true;
    try {
      const r = await api(`/api/customer/order-tenants/${klaim.dataset.klaim}/klaim-bayar`, { method: "POST" });
      toast("Terima kasih! Kasir akan mengecek pembayaranmu.", "success");
      await loadOrders().catch(() => {});
      location.hash = "#/";
    } catch (err) { toast(err.message, "error"); klaim.disabled = false; }
  }
});

function joinRooms() {
  if (!socket) {
    socket = FC.connectSocket();
    if (!socket) return;
    socket.on("connect", joinRooms);
    const refresh = async (data) => {
      const before = state.orders.find((o) => o.order_tenant_id === data.order_tenant_id);
      try { await loadOrders(); } catch { return; }
      if (data.status_order === "siap" && before && before.status_order !== "siap") {
        toast(`Pesanan ${before.nama_kantin} sudah siap!`, "success");
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
      drawOrders(); updateBadges(currentRoute());
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
  const qr = new URLSearchParams(location.search).get("qr");
  const saved = store.get("fc_table_v2", null);
  try {
    if (qr && (!saved || saved.qr !== qr)) {
      const table = await api(`/api/customer/tables/${encodeURIComponent(qr)}`);
      state.table = table;
      store.set("fc_table_v2", { qr, table });
    } else if (saved) {
      state.table = saved.table;
    } else {
      return fatal("Scan QR di mejamu", "Buka halaman ini lewat QR code yang ada di meja supaya kami tahu pesananmu diantar ke meja mana.");
    }
  } catch (e) {
    return fatal("Meja tidak dikenali", e.status === 404 ? "QR meja tidak valid. Coba scan ulang QR di mejamu." : e.message);
  }
  shell();
  window.addEventListener("hashchange", router);
  if (getOrderIds().length) { loadOrders().then(() => updateBadges(currentRoute())).catch(() => {}); }
  router();
}

init();
