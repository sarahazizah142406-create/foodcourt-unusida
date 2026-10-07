import { Router } from "express";
import rateLimit from "express-rate-limit";
import { wrap } from "../utils.js";
import {
  getTableByQR, getTenants, getMenusByTenant, checkout,
  getOrderStatus, getOrdersStatus, klaimBayar
} from "../controllers/customerController.js";

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Terlalu banyak percobaan, tunggu sebentar lalu coba lagi" }
});

router.get("/tables/:qr_code", wrap(getTableByQR));
router.get("/tenants", wrap(getTenants));
router.get("/tenants/:tenantId/menus", wrap(getMenusByTenant));
router.post("/checkout", checkoutLimiter, wrap(checkout));
router.get("/orders/status", wrap(getOrdersStatus));
router.get("/orders/:orderId/status", wrap(getOrderStatus));
router.post("/order-tenants/:id/klaim-bayar", checkoutLimiter, wrap(klaimBayar));

export default router;
