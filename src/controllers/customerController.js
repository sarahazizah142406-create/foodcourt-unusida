import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { emitToTenant } from "../sockets/socket.js";
import { HttpError, toInt } from "../utils.js";
import { gatewayOn, mockOn } from "../config/mutasiku.js";
import { batalkanSubOrder, bersihAlasan } from "./cancelService.js";
import { cleanupStaleOrders } from "../config/cleanup.js";

const MAX_QTY = 99;
const MAX_ITEMS_PER_CART = 40;

// GET /api/customer/tables/:qr_code -> validasi meja dari hasil scan
export async function getTableByQR(req, res) {
  const [rows] = await pool.query(
    "SELECT id, nomor_meja FROM tables_fc WHERE qr_code = ?",
    [req.params.qr_code]
  );
  if (rows.length === 0) throw new HttpError(404, "Meja tidak ditemukan, coba scan ulang QR di meja");
  res.json(rows[0]);
}

// GET /api/customer/config -> pengaturan umum untuk tampilan pelanggan
export async function getConfig(req, res) {
  res.json({ qris_aktif: gatewayOn(), mock: mockOn() });
}

// GET /api/customer/tenants -> daftar kantin beserta antrian aktif saat ini
export async function getTenants(req, res) {
  const [rows] = await pool.query(
    `SELECT t.id, t.nama_kantin, t.foto, t.status,
            COALESCE(q.antrian_aktif, 0) AS antrian_aktif
     FROM tenants t
     LEFT JOIN (
       SELECT tenant_id, COUNT(*) AS antrian_aktif
       FROM order_tenants
       WHERE DATE(created_at) = CURDATE()
         AND status_order IN ('diterima', 'diproses')
         AND (status_bayar = 'lunas' OR metode_bayar = 'cash')
       GROUP BY tenant_id
     ) q ON q.tenant_id = t.id
     ORDER BY (t.status = 'buka') DESC, t.nama_kantin ASC`
  );
  res.json(rows.map((r) => ({ ...r, antrian_aktif: Number(r.antrian_aktif) })));
}

// GET /api/customer/menus -> semua menu dari semua kantin (untuk pencarian & perbandingan harga)
export async function getAllMenus(req, res) {
  const [rows] = await pool.query(
    `SELECT m.id, m.tenant_id, m.nama_menu, m.harga, m.foto AS image_url, m.status,
            t.nama_kantin, t.status AS kantin_status
     FROM menus m JOIN tenants t ON t.id = m.tenant_id
     ORDER BY m.nama_menu ASC, m.harga ASC`
  );
  res.json(rows);
}

// GET /api/customer/tenants/:tenantId/menus
export async function getMenusByTenant(req, res) {
  const tenantId = toInt(req.params.tenantId);
  if (Number.isNaN(tenantId)) throw new HttpError(400, "ID kantin tidak valid");
  const [rows] = await pool.query(
    `SELECT id, nama_menu, harga, foto AS image_url, status
     FROM menus WHERE tenant_id = ?
     ORDER BY (status = 'tersedia') DESC, nama_menu ASC`,
    [tenantId]
  );
  res.json(rows);
}

// POST /api/customer/checkout
// body: { table_id, metode_bayar, carts: [ { tenant_id, tipe_makan, catatan?, items: [{menu_id, qty}] } ] }
// metode_bayar berlaku untuk SELURUH checkout: QRIS = satu QR untuk semua kantin, Cash = bayar di kasir tiap kantin.
export async function checkout(req, res) {
  const { table_id, carts, metode_bayar: metode } = req.body || {};
  const tableId = toInt(table_id);
  if (Number.isNaN(tableId) || !Array.isArray(carts) || carts.length === 0 || carts.length > 10) {
    throw new HttpError(400, "Data pesanan tidak lengkap");
  }
  if (!["qris", "cash"].includes(metode)) throw new HttpError(400, "Metode pembayaran tidak valid");
  if (metode === "qris" && !gatewayOn()) throw new HttpError(409, "QRIS belum aktif, pilih bayar Cash");
  if (new Set(carts.map((c) => toInt(c?.tenant_id))).size !== carts.length) throw new HttpError(400, "Kantin yang sama muncul dua kali di keranjang");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tbl] = await conn.query("SELECT id FROM tables_fc WHERE id = ?", [tableId]);
    if (tbl.length === 0) throw new HttpError(404, "Meja tidak valid, silakan scan ulang QR");

    const tokenBatal = crypto.randomBytes(16).toString("hex");
    const [orderResult] = await conn.query("INSERT INTO orders (table_id, metode_bayar, token_batal) VALUES (?, ?, ?)", [tableId, metode, tokenBatal]);
    const orderId = orderResult.insertId;
    const created = [];
    let grandTotal = 0;

    for (const cart of carts) {
      const tenantId = toInt(cart?.tenant_id);
      const tipeMakan = cart?.tipe_makan;
      const catatan = typeof cart?.catatan === "string" ? cart.catatan.trim().slice(0, 255) || null : null;

      if (Number.isNaN(tenantId)) throw new HttpError(400, "Kantin tidak valid");
      if (tipeMakan !== "dine_in" && tipeMakan !== "takeaway") throw new HttpError(400, "Pilih makan di tempat atau bungkus");
      if (!Array.isArray(cart.items) || cart.items.length === 0 || cart.items.length > MAX_ITEMS_PER_CART) {
        throw new HttpError(400, "Isi pesanan kantin tidak valid");
      }

      const [tenants] = await conn.query(
        "SELECT id, nama_kantin, status FROM tenants WHERE id = ?",
        [tenantId]
      );
      const tenant = tenants[0];
      if (!tenant) throw new HttpError(404, "Kantin tidak ditemukan");
      if (tenant.status !== "buka") throw new HttpError(409, `${tenant.nama_kantin} sedang tutup`);

      // gabungkan item duplikat + validasi qty
      const qtyByMenu = new Map();
      for (const it of cart.items) {
        const menuId = toInt(it?.menu_id);
        const qty = toInt(it?.qty);
        if (Number.isNaN(menuId) || Number.isNaN(qty) || qty < 1 || qty > MAX_QTY) {
          throw new HttpError(400, "Jumlah item tidak valid");
        }
        qtyByMenu.set(menuId, (qtyByMenu.get(menuId) || 0) + qty);
      }

      // Harga SELALU diambil dari database, bukan dari client
      const [menuRows] = await conn.query(
        "SELECT id, nama_menu, harga, status FROM menus WHERE tenant_id = ? AND id IN (?)",
        [tenantId, [...qtyByMenu.keys()]]
      );
      const menuMap = new Map(menuRows.map((m) => [m.id, m]));

      let subtotal = 0;
      const lines = [];
      for (const [menuId, qty] of qtyByMenu) {
        const m = menuMap.get(menuId);
        if (!m) throw new HttpError(409, "Ada menu yang sudah tidak tersedia, muat ulang halaman");
        if (m.status !== "tersedia") throw new HttpError(409, `${m.nama_menu} sedang habis`);
        if (qty > MAX_QTY) throw new HttpError(400, "Jumlah item terlalu banyak");
        subtotal += m.harga * qty;
        lines.push({ menuId, nama: m.nama_menu, harga: m.harga, qty });
      }

      // Nomor antrian atomik per kantin per hari (aman walau 2 order masuk bersamaan)
      const [counter] = await conn.query(
        `INSERT INTO queue_counters (tenant_id, tanggal, last_no)
         VALUES (?, CURDATE(), LAST_INSERT_ID(1))
         ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no + 1)`,
        [tenantId]
      );
      const nomorAntrian = String(counter.insertId).padStart(3, "0");

      const [otResult] = await conn.query(
        `INSERT INTO order_tenants (order_id, tenant_id, nomor_antrian, metode_bayar, subtotal, catatan, tipe_makan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, tenantId, nomorAntrian, metode, subtotal, catatan, tipeMakan]
      );
      const otId = otResult.insertId;
      grandTotal += subtotal;

      await conn.query(
        "INSERT INTO order_items (order_tenant_id, menu_id, nama_menu, qty, harga_satuan) VALUES ?",
        [lines.map((l) => [otId, l.menuId, l.nama, l.qty, l.harga])]
      );

      created.push({
        order_tenant_id: otId,
        tenant_id: tenantId,
        nama_kantin: tenant.nama_kantin,
        nomor_antrian: nomorAntrian,
        metode_bayar: metode,
        subtotal
      });
    }

    await conn.query("UPDATE orders SET total = ?, total_bayar = ? WHERE id = ?", [grandTotal, grandTotal, orderId]);
    await conn.commit();

    for (const ot of created) {
      emitToTenant(ot.tenant_id, "order_baru", {
        order_id: orderId,
        order_tenant_id: ot.order_tenant_id,
        nomor_antrian: ot.nomor_antrian,
        metode_bayar: metode,
        subtotal: ot.subtotal
      });
    }

    res.status(201).json({ order_id: orderId, token_batal: tokenBatal, metode_bayar: metode, total: grandTotal, kantin: created });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function loadStatus(orderIds) {
  cleanupStaleOrders().catch(() => {});
  if (orderIds.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT ot.id AS order_tenant_id, ot.order_id, ot.nomor_antrian, ot.status_bayar, ot.status_order,
            ot.subtotal, ot.metode_bayar, ot.catatan, ot.tipe_makan, ot.created_at, ot.paid_via,
            ot.alasan_batal, ot.dibatalkan_oleh,
            o.total AS order_total, o.biaya_layanan, o.total_bayar, o.status_bayar AS order_status_bayar,
            CASE WHEN o.metode_bayar = 'qris' AND o.status_bayar = 'pending' THEN o.qris_string END AS qris_string,
            CASE WHEN o.metode_bayar = 'qris' AND o.status_bayar = 'pending' THEN o.qris_expires_ms END AS qris_expires_ms,
            t.id AS tenant_id, t.nama_kantin
     FROM order_tenants ot
     JOIN orders o ON o.id = ot.order_id
     JOIN tenants t ON t.id = ot.tenant_id
     WHERE ot.order_id IN (?)
     ORDER BY ot.created_at DESC, ot.id DESC`,
    [orderIds]
  );
  if (rows.length === 0) return [];
  const [items] = await pool.query(
    "SELECT order_tenant_id, nama_menu, qty, harga_satuan FROM order_items WHERE order_tenant_id IN (?)",
    [rows.map((r) => r.order_tenant_id)]
  );
  return rows.map((r) => ({
    ...r,
    qris_expires_ms: r.qris_expires_ms == null ? null : Number(r.qris_expires_ms),
    items: items.filter((i) => i.order_tenant_id === r.order_tenant_id)
  }));
}

// GET /api/customer/orders/:orderId/status
export async function getOrderStatus(req, res) {
  const orderId = toInt(req.params.orderId);
  if (Number.isNaN(orderId)) throw new HttpError(400, "ID pesanan tidak valid");
  res.json(await loadStatus([orderId]));
}

// GET /api/customer/orders/status?ids=1,2,3 -> status banyak order sekaligus (1 request)
export async function getOrdersStatus(req, res) {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => toInt(s))
    .filter((n) => !Number.isNaN(n))
    .slice(0, 30);
  res.json(await loadStatus(ids));
}

// POST /api/customer/orders/:orderId/tenants/:orderTenantId/batal   body: { token, alasan? }
// Pelanggan tidak punya akun, jadi pembatalan dijaga token rahasia yang hanya diterima perangkat yang membuat pesanan
// (id pesanan berurutan dan mudah ditebak, tanpa token orang lain bisa membatalkan pesanan siapa saja).
// Hanya boleh selama kantin belum menekan "Mulai proses".
export async function batalkanPesanan(req, res) {
  const orderId = toInt(req.params.orderId);
  const otId = toInt(req.params.orderTenantId);
  if (Number.isNaN(orderId) || Number.isNaN(otId)) throw new HttpError(400, "ID pesanan tidak valid");

  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const [rows] = await pool.query("SELECT token_batal FROM orders WHERE id = ?", [orderId]);
  const stored = rows[0]?.token_batal;
  const ok = stored && token.length === stored.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(stored));
  if (!ok) throw new HttpError(403, "Pesanan ini hanya bisa dibatalkan dari perangkat yang membuatnya");

  const alasan = bersihAlasan(req.body?.alasan) || "Dibatalkan oleh pelanggan";
  const r = await batalkanSubOrder({ otId, orderId, oleh: "pelanggan", alasan, bolehDari: ["diterima"] });
  res.json({ message: "Pesanan dibatalkan", ...r });
}
