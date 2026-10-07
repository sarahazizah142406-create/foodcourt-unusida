import mysql from "mysql2/promise";
import "dotenv/config";

// Semua waktu memakai WIB supaya "hari ini" di laporan sesuai jam kantin,
// bukan UTC milik server database/hosting.
const TZ = process.env.DB_TIMEZONE || "+07:00";

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

export async function assertDatabase() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
    console.log("✅ Database MySQL terhubung");
  } finally {
    conn.release();
  }
}
