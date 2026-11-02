import crypto from "node:crypto";
import { pool } from "../config/db.js";
import { emitToOrder, emitToTenant } from "../sockets/socket.js";
import { HttpError, toInt } from "../utils.js";
import { gatewayOn, mockOn, mockPay, createQris, getStatus, cancelQris, isPaid, verifyWebhook, parseOrderId } from "../config/mutasiku.js";

// Tandai satu CHECKOUT lunas (idempotent). Semua sub-pesanan kantin ikut lunas, kasir tiap kantin diberi tahu.
export async function markPaid(orderId, via) {
  const [r] = await pool.query(
    "UPDATE orders SET status_bayar = 'lunas', paid_at = NOW(), paid_via = ? WHERE id = ? AND status_bayar = 'pending' AND metode_bayar = 'qris'",
    [via, orderId]
  );
  if (r.affectedRows === 0) return false;
  await pool.query(
    "UPDATE order_tenants SET status_bayar = 'lunas', paid_at = NOW(), paid_via = ? WHERE order_id = ? AND status_bayar = 'pending' AND status_order <> 'dibatalkan'",
    [via, orderId]
  );
  const [ots] = await pool.query("SELECT id, tenant_id, nomor_antrian, subtotal FROM order_tenants WHERE order_id = ? AND status_order <> 'dibatalkan'", [orderId]);
  emitToOrder(orderId, "bayar_update", { order_id: orderId, status_bayar: "lunas" });
  for (const ot of ots) {
    emitToTenant(ot.tenant_id, "bayar_lunas", { order_tenant_id: ot.id, nomor_antrian: ot.nomor_antrian, subtotal: ot.subtotal });
  }
  return true;
}

async function loadOrder(id) {
  const [rows] = await pool.query(
    "SELECT id, metode_bayar, total, biaya_layanan, total_bayar, status_bayar, payment_ref, qris_string, qris_expires_ms FROM orders WHERE id = ?", [id]);
  if (!rows[0]) throw new HttpError(404, "Pesanan tidak ditemukan");
  return rows[0];
}
const idOf = (req) => {
  const id = toInt(req.params.orderId);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  return id;
};

// POST /api/customer/orders/:orderId/qris -> buat (atau ambil) satu QRIS untuk seluruh checkout
export async function ensureQris(req, res) {
  if (!gatewayOn()) throw new HttpError(404, "QRIS belum aktif");
  const id = idOf(req);
  const o = await loadOrder(id);
  if (o.metode_bayar !== "qris") throw new HttpError(409, "Pesanan ini bukan pembayaran QRIS");
  if (o.status_bayar === "lunas") return res.json({ status_bayar: "lunas" });
  if (!(Number(o.total) > 0)) throw new HttpError(409, "Semua pesanan di checkout ini sudah dibatalkan");

  const alive = o.qris_string && Number(o.qris_expires_ms) > Date.now() + 5000;
  if (alive) {
    return res.json({ qris_string: o.qris_string, qris_expires_ms: Number(o.qris_expires_ms), total: o.total, biaya_layanan: o.biaya_layanan, total_bayar: o.total_bayar || o.total });
  }
  if (o.payment_ref) await cancelQris(o.payment_ref); // QR lama kedaluwarsa sendiri di Mutasiku

  const ref = `FC${id}-${crypto.randomBytes(3).toString("hex")}`;
  const q = await createQris(ref, o.total);
  await pool.query(
    "UPDATE orders SET payment_ref = ?, qris_string = ?, qris_expires_ms = ?, biaya_layanan = ?, total_bayar = ? WHERE id = ? AND status_bayar = 'pending'",
    [q.paymentId, q.qr, q.expiresMs, q.fee, q.total, id]
  );
  res.json({ qris_string: q.qr, qris_expires_ms: q.expiresMs, total: o.total, biaya_layanan: q.fee, total_bayar: q.total });
}

// POST /api/customer/orders/:orderId/cek-bayar -> tanya status resmi ke Mutasiku (tidak percaya klien)
export async function cekBayar(req, res) {
  const id = idOf(req);
  const o = await loadOrder(id);
  if (o.status_bayar === "lunas") return res.json({ status_bayar: "lunas" });
  if (gatewayOn() && o.metode_bayar === "qris" && o.payment_ref) {
    const st = await getStatus(o.payment_ref);
    if (isPaid(st)) { await markPaid(id, "gateway"); return res.json({ status_bayar: "lunas" }); }
  }
  res.json({ status_bayar: "pending" });
}

// Pemeriksa latar belakang: server menanyakan status QR yang masih menunggu.
// Dipakai saat webhook belum/ tidak bisa masuk (misalnya di localhost).
let reconciling = false;
export async function reconcileOnce() {
  if (reconciling) return;
  reconciling = true;
  try {
    const [rows] = await pool.query(
      `SELECT id, payment_ref FROM orders
       WHERE metode_bayar = 'qris' AND status_bayar = 'pending' AND payment_ref IS NOT NULL AND qris_expires_ms > ?
       ORDER BY id DESC LIMIT 30`,
      [Date.now() - 20 * 60 * 1000]
    );
    if (rows.length === 0) return;
    for (const o of rows) {
      const st = await getStatus(o.payment_ref).catch(() => null);
      if (st && isPaid(st)) await markPaid(o.id, "gateway");
    }
  } finally { reconciling = false; }
}
export function startPaymentReconciler(intervalMs = 8000) {
  if (!gatewayOn()) { console.log("   QRIS belum aktif (isi MUTASIKU_API_KEY & MUTASIKU_WALLET_ACCOUNT_ID, atau MUTASIKU_MOCK=true untuk simulasi)"); return; }
  setInterval(() => reconcileOnce().catch((err) => console.error("[reconciler]", err.message)), intervalMs);
  console.log(`   QRIS GoPay Merchant ${mockOn() ? "(MODE SIMULASI) " : ""}aktif: status dicek ke Mutasiku tiap ${intervalMs / 1000} detik`);
}

// POST /api/payments/mutasiku/notify -> webhook Mutasiku (event payment.completed).
// Tanda tangan diverifikasi, lalu status TETAP dikonfirmasi ulang ke API Mutasiku sebelum menandai lunas.
export async function mutasikuNotify(req, res) {
  if (!verifyWebhook(req)) return res.status(401).json({ message: "Signature tidak valid" });
  res.json({ received: true });
  try {
    const { type, data } = req.body || {};
    if (type !== "payment.completed") return;
    const id = parseOrderId(data?.orderId);
    if (Number.isNaN(id)) return;
    const o = await loadOrder(id);
    if (o.status_bayar === "lunas" || !o.payment_ref || o.payment_ref !== data?.id) return;
    if (isPaid(await getStatus(o.payment_ref))) await markPaid(id, "gateway");
  } catch (err) { console.error("[webhook]", err.message); }
}

// POST /api/payments/mock/pay  body: { order_id }  -> hanya aktif di MUTASIKU_MOCK=true (untuk tes/demo)
export async function mockPayOrder(req, res) {
  if (!mockOn()) throw new HttpError(404, "Tidak tersedia");
  const id = toInt(req.body?.order_id);
  if (Number.isNaN(id)) throw new HttpError(400, "order_id tidak valid");
  const o = await loadOrder(id);
  if (!o.payment_ref) throw new HttpError(409, "QR belum dibuat");
  mockPay(o.payment_ref);
  await markPaid(id, "gateway");
  res.json({ ok: true });
}
