import { Router } from "express";
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController.js";
import { requireAuth } from "../middleware/auth.js";
import { tenantLimiter } from "../middleware/rateLimiters.js";

const router = Router();

router.use(requireAuth, tenantLimiter);

router.get("/", listNotifications);
router.get("/unread-count", getUnreadCount);
router.post("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);

export default router;
