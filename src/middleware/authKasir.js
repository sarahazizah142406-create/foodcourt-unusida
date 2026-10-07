import jwt from "jsonwebtoken";

// Cek token JWT kasir, lalu tempelkan tenantId ke req supaya semua query
// otomatis ter-scope ke kantin yang sedang login.
export function authKasir(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token tidak ditemukan, silakan login" });
  }
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
    if (decoded.role !== "kasir" || !decoded.tenantId) {
      return res.status(403).json({ message: "Akses khusus akun kasir kantin" });
    }
    req.tenantId = decoded.tenantId;
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ message: "Sesi habis, silakan login lagi" });
  }
}
