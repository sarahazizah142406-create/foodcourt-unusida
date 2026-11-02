import mysql from "mysql2/promise";
import { HttpError } from "../utils.js";
import "dotenv/config";

// Semua waktu memakai WIB supaya "hari ini" di laporan sesuai jam kantin,
// bukan UTC milik server database/hosting.
const TZ = /^[+-]\d{2}:\d{2}$/.test(process.env.DB_TIMEZONE || "") ? process.env.DB_TIMEZONE : "+07:00";

// SSL: Aiven wajib SSL. Untuk MySQL lokal (localhost) matikan dengan DB_SSL=false.
const useSSL = String(process.env.DB_SSL ?? "true").toLowerCase() !== "false";

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  timezone: TZ,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true
});

pool.pool.on("connection", (conn) => {
  conn.query(`SET time_zone = '${TZ}'`);
});

// Lapis pengaman: mysql2 .query() meng-escape di sisi client dan MEMBONGKAR objek menjadi `kolom = nilai`.
// Kalau ada input objek / NaN lolos sampai sini, tolak daripada diteruskan ke SQL.
const badParam = (v) =>
  (typeof v === "number" && !Number.isFinite(v)) ||
  (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v));
function guardParams(params) {
  if (!Array.isArray(params)) return;
  for (const p of params) {
    const list = Array.isArray(p) ? p.flat(1) : [p];
    if (list.some(badParam)) throw new HttpError(400, "Input tidak valid");
  }
}
const rawQuery = pool.query.bind(pool);
pool.query = (sql, params, ...rest) => { guardParams(params); return rawQuery(sql, params, ...rest); };
const rawGetConnection = pool.getConnection.bind(pool);
pool.getConnection = async () => {
  const conn = await rawGetConnection();
  if (!conn.__guarded) {
    const q = conn.query.bind(conn);
    conn.query = (sql, params, ...rest) => { guardParams(params); return q(sql, params, ...rest); };
    conn.__guarded = true;
  }
  return conn;
};

export async function assertDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
    console.log("✅ Database MySQL terhubung");
  } finally {
    conn.release();
  }
}
