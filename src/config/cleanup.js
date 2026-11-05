import { pool } from "./db.js";

// Pesanan hari-hari sebelumnya otomatis dibersihkan, termasuk yang belum dibayar
// (mis. QRIS simulasi yang tidak pernah diklik "bayar"):
//  1) belum dibayar & belum selesai  -> dibatalkan otomatis oleh sistem
//  2) semua pesanan sebelum hari ini -> disembunyikan dari dashboard kantin
// Data tetap tersimpan, laporan hanya menghitung pesanan lunas yang tidak dibatalkan.
export async function cleanupStaleOrders() {
  const [a] = await pool.query(
    `UPDATE order_tenants
     SET status_order = 'dibatalkan', alasan_batal = 'Kedaluwarsa: tidak dibayar sampai hari berganti',
         dibatalkan_oleh = 'sistem', dibatalkan_at = NOW()
     WHERE DATE(created_at) < CURDATE() AND status_bayar = 'pending' AND status_order NOT IN ('diambil','dibatalkan')`
  );
  const [b] = await pool.query(
    "UPDATE order_tenants SET disembunyikan_kantin = 1 WHERE DATE(created_at) < CURDATE() AND disembunyikan_kantin = 0"
  );
  const [c] = await pool.query(
    `UPDATE orders
     SET payment_ref = NULL, qris_string = NULL, qris_expires_ms = NULL
     WHERE DATE(created_at) < CURDATE() AND status_bayar = 'pending'`
  );
  if (a.affectedRows || b.affectedRows || c.affectedRows) {
    console.log(`🧹 Pesanan kemarin: ${a.affectedRows} dibatalkan otomatis, ${b.affectedRows} disembunyikan, ${c.affectedRows} pesanan kedaluwarsa dibersihkan`);
  }
}

export function startCleanup(intervalMs = 30 * 60 * 1000) {
  const run = () => cleanupStaleOrders().catch((e) => console.error("[cleanup]", e.message));
  run();
  setInterval(run, intervalMs);
}

