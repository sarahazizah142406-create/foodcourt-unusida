import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import "dotenv/config";

import { assertDatabase } from "./config/db.js";
import { migrate } from "./config/migrate.js";
import { setIO } from "./sockets/socket.js";
import customerRoutes from "./routes/customer.js";
import kasirRoutes from "./routes/kasir.js";
import devRoutes from "./routes/dev.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "../frontend");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith("replace_with")) {
  console.error("❌ JWT_SECRET belum diisi di .env (isi dengan teks acak yang panjang).");
  process.exit(1);
}

// CORS_ORIGIN boleh diisi daftar domain frontend dipisah koma. Kosong = semua boleh.
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : "*";

const app = express();
app.set("trust proxy", 1); // di belakang proxy Render/Vercel, supaya rate-limit membaca IP asli
const httpServer = createServer(app);

const io = new Server(httpServer, { cors: { origin: corsOrigin } });
setIO(io);

// Socket: kasir wajib kirim token JWT; room kantin ditentukan dari token (bukan dari input client)
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const d = jwt.verify(token, process.env.JWT_SECRET);
      if (d.role === "kasir" && d.tenantId) socket.data.tenantId = d.tenantId;
    } catch { /* token salah -> diperlakukan sebagai customer biasa */ }
  }
  next();
});

io.on("connection", (socket) => {
  socket.on("join_tenant_room", () => {
    if (socket.data.tenantId) socket.join(`tenant_${socket.data.tenantId}`);
  });
  socket.on("join_order_room", (orderId) => {
    const id = Number(orderId);
    if (Number.isSafeInteger(id)) socket.join(`order_${id}`);
  });
});

// CSP dimatikan karena halaman frontend ikut dilayani dari server ini
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, message: "Food Court UNUSIDA API jalan" }));
app.use("/api/customer", customerRoutes);
app.use("/api/kasir", kasirRoutes);
app.use("/api/dev", devRoutes);
app.use("/api", (req, res) => res.status(404).json({ message: "Endpoint tidak ditemukan" }));

// Frontend (customer / kantin / dev) dilayani langsung dari server ini
app.use(express.static(FRONTEND_DIR, { extensions: ["html"] }));

// Error handler terpusat
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Format data tidak valid" });
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: "Terjadi kesalahan di server, coba lagi" });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await assertDatabase();
    await migrate();
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server jalan di port ${PORT}`);
      console.log(`   Customer : http://localhost:${PORT}/customer/?qr=MEJA-01-A1B2C3`);
      console.log(`   Kantin   : http://localhost:${PORT}/kantin/`);
      console.log(`   Panel Dev: http://localhost:${PORT}/dev/`);
    });
  } catch (err) {
    console.error("❌ Gagal start:", err.message);
    console.error("   Cek DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME di .env");
    process.exit(1);
  }
}

start();
