import express from "express";
import salesReportController from "../../controllers/admin/salesreportController.js";
import { isAdminAuthenticated } from "../../middleware/authMidilware.js";

const router = express.Router();

router.get("/", isAdminAuthenticated, salesReportController.loadSalesReport);
router.get(
  "/export/pdf",
  isAdminAuthenticated,
  salesReportController.exportSalesReportPdf
);
router.get(
  "/export/excel",
  isAdminAuthenticated,
  salesReportController.exportSalesReportExcel
);

export default router;
