import { pool } from "./db.js";

// Push notification ke aplikasi Android kantin lewat Firebase Cloud Messaging (FCM).
// Aktif hanya bila env FIREBASE_SERVICE_ACCOUNT berisi JSON service account (satu baris).
// Tanpa itu semua fungsi di sini diam saja, jadi aplikasi web tetap jalan normal.
const rupiah = (n) => "Rp" + new Intl.NumberFormat("id-ID").format(Math.round(Number(n) || 0));
export const pushOn = () => !!process.env.FIREBASE_SERVICE_ACCOUNT;

let messaging = null;
async function getMessagingClient() {
  if (messaging) return messaging;
  const cred = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getMessaging } = await import("firebase-admin/messaging");
  const app = getApps()[0] || initializeApp({ credential: cert(cred) });
  messaging = getMessaging(app);
  return messaging;
}

// Isi notifikasi sesuai event socket. Mengembalikan null bila event tidak perlu push.
export function buildMessage(event, d = {}) {
  if (event === "order_baru") {
    if (d.metode_bayar === "qris") return null; // QRIS: tunggu lunas dulu, sama seperti notifikasi di web
    return { title: "Pesanan baru", body: `#${d.nomor_antrian} · Cash · ${rupiah(d.subtotal)} - bayar di kasir`, tag: "order-" + d.order_tenant_id };
  }
  if (event === "bayar_lunas") {
    return { title: "Pembayaran QRIS masuk", body: `#${d.nomor_antrian} · ${rupiah(d.subtotal)} - siap diproses`, tag: "paid-" + d.order_tenant_id };
  }
  if (event === "order_batal") {
    if (d.oleh !== "pelanggan") return null; // dibatalkan kantin sendiri: tidak perlu notifikasi
    return { title: "Pesanan dibatalkan pelanggan", body: `#${d.nomor_antrian}${d.alasan_batal ? " · " + d.alasan_batal : ""}`, tag: "batal-" + d.order_tenant_id };
  }
  return null;
}

export async function saveToken(tenantId, token, platform = "android") {
  await pool.query(
    "INSERT INTO device_tokens (tenant_id, token, platform) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), platform = VALUES(platform)",
    [tenantId, token, platform]
  );
}
export async function deleteToken(token) { await pool.query("DELETE FROM device_tokens WHERE token = ?", [token]); }

// Dipanggil dari emitToTenant; tidak pernah melempar error ke pemanggil.
export async function pushToTenant(tenantId, event, payload) {
  try {
    if (!pushOn()) return;
    const msg = buildMessage(event, payload);
    if (!msg) return;
    const [rows] = await pool.query("SELECT token FROM device_tokens WHERE tenant_id = ?", [tenantId]);
    if (rows.length === 0) return;
    const tokens = rows.map((r) => r.token);
    const res = await (await getMessagingClient()).sendEachForMulticast({
      tokens,
      notification: { title: msg.title, body: msg.body },
      data: { event, order_tenant_id: String(payload.order_tenant_id ?? "") },
      android: { priority: "high", notification: { channelId: "pesanan", sound: "default", tag: msg.tag } }
    });
    // buang token yang sudah tidak berlaku (aplikasi dihapus / logout)
    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code || "";
      if (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) dead.push(tokens[i]);
    });
    if (dead.length) await pool.query("DELETE FROM device_tokens WHERE token IN (?)", [dead]);
  } catch (err) { console.error("[push]", err.message); }
}
