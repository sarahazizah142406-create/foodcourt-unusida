import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authDev, izin, hanyaDev } from "../middleware/authDev.js";
import { parseImages } from "../middleware/upload.js";
import { wrap } from "../utils.js";
import {
  loginDev, getMetrics, getAllTenants, createTenant, updateTenant,
  toggleTenantStatus, setKasirAccount, deleteTenant, listTables, createTables, deleteTable,
  getRekap, getRekapDetail, getAdminAccount, setAdminAccount, me
} from "../controllers/devController.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Terlalu banyak percobaan login, coba lagi 15 menit lagi" }
});

router.post("/login", loginLimiter, wrap(loginDev));

router.use(authDev);
router.get("/me", wrap(me));
router.get("/metrics", izin("kantin_lihat"), wrap(getMetrics));
router.get("/tenants", izin("kantin_lihat"), wrap(getAllTenants));
router.post("/tenants", izin("kantin_tambah"), parseImages(["foto"]), wrap(createTenant));
router.patch("/tenants/:id", izin("kantin_edit"), parseImages(["foto"]), wrap(updateTenant));
router.patch("/tenants/:id/status", izin("kantin_status"), wrap(toggleTenantStatus));
router.patch("/tenants/:id/kasir", hanyaDev, wrap(setKasirAccount));
router.delete("/tenants/:id", hanyaDev, wrap(deleteTenant));
router.get("/rekap", izin("rekap"), wrap(getRekap));
router.get("/rekap/:tenantId", izin("rekap"), wrap(getRekapDetail));
router.get("/admin", hanyaDev, wrap(getAdminAccount));
router.put("/admin", hanyaDev, wrap(setAdminAccount));
router.get("/tables", izin("meja"), wrap(listTables));
router.post("/tables", izin("meja"), wrap(createTables));
router.delete("/tables/:id", izin("meja"), wrap(deleteTable));

export default router;
