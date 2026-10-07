import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authKasir } from "../middleware/authKasir.js";
import { parseImages } from "../middleware/upload.js";
import { wrap } from "../utils.js";
import {
  login, getMe, setKantinStatus, getDashboard, getOrdersMasuk, getOrderItems,
  updateStatusOrder, konfirmasiBayar, listMenus, tambahMenu, updateMenu,
  updateStatusMenu, deleteMenu, getLaporan
} from "../controllers/kasirController.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Terlalu banyak percobaan login, coba lagi 15 menit lagi" }
});

router.post("/login", loginLimiter, wrap(login));

router.use(authKasir);
router.get("/me", wrap(getMe));
router.patch("/status", wrap(setKantinStatus));
router.get("/dashboard", wrap(getDashboard));
router.get("/orders", wrap(getOrdersMasuk));
router.get("/orders/:orderTenantId/items", wrap(getOrderItems));
router.patch("/orders/:orderTenantId/status", wrap(updateStatusOrder));
router.patch("/orders/:orderTenantId/bayar", wrap(konfirmasiBayar));
router.get("/menus", wrap(listMenus));
router.post("/menus", parseImages(["foto"]), wrap(tambahMenu));
router.put("/menus/:menuId", parseImages(["foto"]), wrap(updateMenu));
router.patch("/menus/:menuId/status", wrap(updateStatusMenu));
router.delete("/menus/:menuId", wrap(deleteMenu));
router.get("/laporan", wrap(getLaporan));

export default router;
