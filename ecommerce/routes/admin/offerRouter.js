
import express from "express";
import {
  createOffer,
  loadOffersPage,
  showCreateOffer,
  showEditOffer,
  updateOffer,
  listOffers,
  deleteOffer,
} from "../../controllers/admin/offerController.js";
import {
  isAdminAuthenticated,
} from "../../middleware/authMidilware.js";

const router = express.Router();

router.get("/", isAdminAuthenticated, loadOffersPage);
router.get("/add", isAdminAuthenticated, showCreateOffer);
router.get("/edit/:offerId", isAdminAuthenticated, showEditOffer);
router.post("/edit/:offerId", isAdminAuthenticated, updateOffer);
router.put("/edit/:offerId", isAdminAuthenticated, updateOffer);
router.patch("/edit/:offerId", isAdminAuthenticated, updateOffer);
router.get("/api", isAdminAuthenticated, listOffers);
router.post("/", isAdminAuthenticated, createOffer);
router.post("/add", isAdminAuthenticated, createOffer);
router.delete(
  "/:offerId",
  isAdminAuthenticated,
  deleteOffer
);

export default router;
