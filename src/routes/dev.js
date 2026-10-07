import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authDev } from "../middleware/authDev.js";
import { parseImages } from "../middleware/upload.js";
import { wrap } from "../utils.js";
import {
  loginDev, getMetrics, getAllTenants, getTenantQris, createTenant, updateTenant,
  toggleTenantStatus, setKasirAccount, deleteTenant, listTables, createTables, deleteTable
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
router.get("/metrics", wrap(getMetrics));
router.get("/tenants", wrap(getAllTenants));
router.get("/tenants/:id/qris", wrap(getTenantQris));
router.post("/tenants", parseImages(["foto", "qris"]), wrap(createTenant));
router.patch("/tenants/:id", parseImages(["foto", "qris"]), wrap(updateTenant));
router.patch("/tenants/:id/status", wrap(toggleTenantStatus));
router.patch("/tenants/:id/kasir", wrap(setKasirAccount));
router.delete("/tenants/:id", wrap(deleteTenant));
router.get("/tables", wrap(listTables));
router.post("/tables", wrap(createTables));
router.delete("/tables/:id", wrap(deleteTable));

export default router;
