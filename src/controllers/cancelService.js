import { pool } from "../config/db.js";
import { emitToOrder, emitToTenant } from "../sockets/socket.js";
import { HttpError } from "../utils.js";
import { gatewayOn, getStatus, isPaid } from "../config/mutasiku.js";
import { markPaid } from "./paymentController.js";

export const ALASAN_MAX = 255;

// rapikan alasan dari input pengguna (spasi ganda, panjang)
export function bersihAlasan(v) {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, ALASAN_MAX) : "";
}

const PESAN_TOLAK = {
  diproses: "Pesanan sudah mulai diproses kantin, tidak bisa dibatalkan lagi",
  siap: "Pesanan sudah siap diambil, tidak bisa dibatalkan lagi",
  diambil: "Pesanan sudah selesai diambil",
  dibatalkan: "Pesanan ini sudah dibatalkan"
};

// Batalkan SATU pesanan kantin (order_tenants). Dipakai pelanggan dan kantin.
//  oleh      : 'pelanggan' | 'kantin'
//  bolehDari : status_order yang masih boleh dibatalkan
//  tenantId  : bila diisi, pesanan harus milik kantin itu
//  orderId   : bila diisi, pesanan harus bagian dari checkout itu
// Pembatalan memakai UPDATE bersyarat (status harus masih di bolehDari), jadi kalau kantin menekan
// "Mulai proses" bersamaan dengan pelanggan menekan "Batalkan", hanya salah satu yang menang.
export async function batalkanSubOrder({ otId, oleh, alasan, bolehDari, tenantId = null, orderId = null }) {
  const [pre] = await pool.query(
    `SELECT ot.order_id, ot.tenant_id, o.metode_bayar, o.status_bayar, o.payment_ref
     FROM order_tenants ot JOIN orders o ON o.id = ot.order_id WHERE ot.id = ?`,
    [otId]
  );
  const p = pre[0];
  if (!p || (tenantId != null && p.tenant_id !== tenantId) || (orderId != null && p.order_id !== orderId)) {
    throw new HttpError(404, "Pesanan tidak ditemukan");
  }
  // QRIS yang barusan dibayar tapi belum tercatat: catat dulu, supaya tidak ada uang masuk yang "hilang"
  if (gatewayOn() && p.metode_bayar === "qris" && p.status_bayar === "pending" && p.payment_ref) {
    try { if (isPaid(await getStatus(p.payment_ref))) await markPaid(p.order_id, "gateway"); } catch { /* lanjut saja */ }
  }

  const conn = await pool.getConnection();
  let r, qrReset = false;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT ot.id, ot.order_id, ot.tenant_id, ot.nomor_antrian, ot.status_order, ot.status_bayar, ot.subtotal,
              o.metode_bayar AS o_metode, o.status_bayar AS o_bayar
       FROM order_tenants ot JOIN orders o ON o.id = ot.order_id
       WHERE ot.id = ? FOR UPDATE`,
      [otId]
    );
    r = rows[0];
    if (!r) throw new HttpError(404, "Pesanan tidak ditemukan");
    if (!bolehDari.includes(r.status_order)) throw new HttpError(409, PESAN_TOLAK[r.status_order] || "Pesanan tidak bisa dibatalkan");

    const [u] = await conn.query(
      `UPDATE order_tenants SET status_order = 'dibatalkan', alasan_batal = ?, dibatalkan_oleh = ?, dibatalkan_at = NOW()
       WHERE id = ? AND status_order IN (?)`,
      [alasan, oleh, otId, bolehDari]
    );
    if (u.affectedRows === 0) throw new HttpError(409, "Status pesanan baru saja berubah, muat ulang lalu coba lagi");

    // QRIS belum dibayar: nominal QR terkunci, jadi hitung ulang total dari kantin yang masih aktif
    // dan kosongkan QR lama. Pelanggan otomatis dibuatkan QR baru dengan nominal yang benar.
    if (r.o_metode === "qris" && r.o_bayar === "pending") {
      const [[s]] = await conn.query(
        "SELECT COALESCE(SUM(subtotal), 0) AS t FROM order_tenants WHERE order_id = ? AND status_order <> 'dibatalkan'",
        [r.order_id]
      );
      const total = Number(s.t);
      await conn.query(
        `UPDATE orders SET total = ?, total_bayar = ?, biaya_layanan = 0, payment_ref = NULL, qris_string = NULL, qris_expires_ms = NULL
         WHERE id = ? AND status_bayar = 'pending'`,
        [total, total, r.order_id]
      );
      qrReset = true;
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const sudahBayar = r.status_bayar === "lunas" || r.o_bayar === "lunas";
  const payload = { order_tenant_id: otId, order_id: r.order_id, status_order: "dibatalkan", alasan_batal: alasan, dibatalkan_oleh: oleh };
  emitToOrder(r.order_id, "status_update", payload);
  emitToTenant(r.tenant_id, "order_batal", { ...payload, oleh, nomor_antrian: r.nomor_antrian, subtotal: r.subtotal, sudah_bayar: sudahBayar });

  return {
    order_id: r.order_id,
    nomor_antrian: r.nomor_antrian,
    qr_direset: qrReset,
    // sudah dibayar -> uangnya perlu dikembalikan (tunai: oleh kantin, QRIS: lewat admin food court)
    perlu_refund: sudahBayar ? (r.o_metode === "qris" ? "qris" : "cash") : null
  };
}
