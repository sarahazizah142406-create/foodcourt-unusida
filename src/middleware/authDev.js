import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

// Hak akses admin (dev selalu penuh). Reset akun kasir, hapus kantin, dan kelola admin SELALU khusus dev.
export const IZIN_VALID = ["kantin_lihat", "kantin_tambah", "kantin_edit", "kantin_status", "rekap", "meja"];
export function parseIzin(str) {
  let list = String(str || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (list.includes("kantin")) list = [...list, "kantin_lihat", "kantin_tambah", "kantin_edit", "kantin_status"];   // nilai lama
  list = [...new Set(list.filter((x) => IZIN_VALID.includes(x)))];
  if (list.some((x) => x.startsWith("kantin_")) && !list.includes("kantin_lihat")) list.unshift("kantin_lihat");
  return list;
}

export async function authDev(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token tidak ditemukan, silakan login" });
  }
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
    if (decoded.role !== "dev" && decoded.role !== "admin") {
      return res.status(403).json({ message: "Akses ditolak, khusus akun developer / admin" });
    }
    req.userId = decoded.userId;
    req.role = decoded.role;
    if (decoded.role === "admin") {
      const [rows] = await pool.query("SELECT izin FROM users WHERE id = ? AND role = 'admin'", [decoded.userId]);
      if (!rows[0]) return res.status(401).json({ message: "Sesi habis, silakan login lagi" });
      req.izin = new Set(parseIzin(rows[0].izin));
    }
    next();
  } catch {
    return res.status(401).json({ message: "Sesi habis, silakan login lagi" });
  }
}

// Dev selalu lolos. Admin hanya kalau fiturnya dicentang di Panel Dev.
export const izin = (nama) => (req, res, next) =>
  req.role === "dev" || req.izin?.has(nama)
    ? next()
    : res.status(403).json({ message: "Akun ini tidak punya akses ke fitur tersebut" });

export const hanyaDev = (req, res, next) =>
  req.role === "dev" ? next() : res.status(403).json({ message: "Khusus akun developer" });
