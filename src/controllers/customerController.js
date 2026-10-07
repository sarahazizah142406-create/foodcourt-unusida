import { pool } from "../config/db.js";
import { emitToTenant } from "../sockets/socket.js";
import { HttpError, toInt } from "../utils.js";

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

// GET /api/customer/tenants -> daftar kantin (QRIS tidak ikut dikirim, cukup penanda qris_aktif)
export async function getTenants(req, res) {
  const [rows] = await pool.query(
    `SELECT id, nama_kantin, foto, status,
            (qris_image IS NOT NULL AND qris_image <> '') AS qris_aktif
     FROM tenants ORDER BY (status = 'buka') DESC, nama_kantin ASC`
  );
  res.json(rows.map((r) => ({ ...r, qris_aktif: Boolean(r.qris_aktif) })));
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
// body: { table_id, carts: [ { tenant_id, metode_bayar, tipe_makan, catatan?, items: [{menu_id, qty}] } ] }
export async function checkout(req, res) {
  const { table_id, carts } = req.body || {};
  const tableId = toInt(table_id);
  if (Number.isNaN(tableId) || !Array.isArray(carts) || carts.length === 0 || carts.length > 10) {
    throw new HttpError(400, "Data pesanan tidak lengkap");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tbl] = await conn.query("SELECT id FROM tables_fc WHERE id = ?", [tableId]);
    if (tbl.length === 0) throw new HttpError(404, "Meja tidak valid, silakan scan ulang QR");

    const [orderResult] = await conn.query("INSERT INTO orders (table_id) VALUES (?)", [tableId]);
    const orderId = orderResult.insertId;
    const created = [];

    for (const cart of carts) {
      const tenantId = toInt(cart?.tenant_id);
      const metode = cart?.metode_bayar;
      const tipeMakan = cart?.tipe_makan;
      const catatan = typeof cart?.catatan === "string" ? cart.catatan.trim().slice(0, 255) || null : null;

      if (Number.isNaN(tenantId)) throw new HttpError(400, "Kantin tidak valid");
      if (tipeMakan !== "dine_in" && tipeMakan !== "takeaway") throw new HttpError(400, "Pilih makan di tempat atau bungkus");
      if (!["qris", "cash"].includes(metode)) throw new HttpError(400, "Metode pembayaran tidak valid");
      if (!Array.isArray(cart.items) || cart.items.length === 0 || cart.items.length > MAX_ITEMS_PER_CART) {
        throw new HttpError(400, "Isi pesanan kantin tidak valid");
      }

      const [tenants] = await conn.query(
        `SELECT id, nama_kantin, status, (qris_image IS NOT NULL AND qris_image <> '') AS qris_aktif
         FROM tenants WHERE id = ?`,
        [tenantId]
      );
      const tenant = tenants[0];
      if (!tenant) throw new HttpError(404, "Kantin tidak ditemukan");
      if (tenant.status !== "buka") throw new HttpError(409, `${tenant.nama_kantin} sedang tutup`);
      if (metode === "qris" && !tenant.qris_aktif) {
        throw new HttpError(409, `${tenant.nama_kantin} belum mengaktifkan QRIS, pilih bayar Cash`);
      }

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

    await conn.commit();

    for (const ot of created) {
      emitToTenant(ot.tenant_id, "order_baru", {
        order_id: orderId,
        order_tenant_id: ot.order_tenant_id,
        nomor_antrian: ot.nomor_antrian
      });
    }

    res.status(201).json({ order_id: orderId, kantin: created });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function loadStatus(orderIds) {
  if (orderIds.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT ot.id AS order_tenant_id, ot.order_id, ot.nomor_antrian, ot.status_bayar, ot.status_order,
            ot.subtotal, ot.metode_bayar, ot.klaim_bayar, ot.catatan, ot.tipe_makan, ot.created_at,
            t.id AS tenant_id, t.nama_kantin,
            CASE WHEN ot.metode_bayar = 'qris' AND ot.status_bayar = 'pending' THEN t.qris_image END AS qris_image,
            t.qris_nama
     FROM order_tenants ot
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
    klaim_bayar: Boolean(r.klaim_bayar),
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

// POST /api/customer/order-tenants/:id/klaim-bayar -> pelanggan menandai "sudah bayar QRIS"
export async function klaimBayar(req, res) {
  const id = toInt(req.params.id);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const [result] = await pool.query(
    `UPDATE order_tenants SET klaim_bayar = 1
     WHERE id = ? AND status_bayar = 'pending' AND metode_bayar = 'qris'`,
    [id]
  );
  if (result.affectedRows === 0) throw new HttpError(404, "Pesanan tidak ditemukan atau sudah lunas");
  const [rows] = await pool.query(
    "SELECT tenant_id, order_id, nomor_antrian FROM order_tenants WHERE id = ?",
    [id]
  );
  emitToTenant(rows[0].tenant_id, "bayar_klaim", {
    order_tenant_id: id,
    nomor_antrian: rows[0].nomor_antrian
  });
  res.json({ message: "Kasir akan segera memeriksa pembayaranmu" });
}
