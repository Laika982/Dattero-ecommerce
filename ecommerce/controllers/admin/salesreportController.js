import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import Order from "../../models/orderSchema.js";
import Product from "../../models/productSchema.js";
import Category from "../../models/categorySchema.js";
import WalletTransaction from "../../models/walletTransactionSchema.js";

const validPeriods = new Set(["daily", "weekly", "monthly", "yearly", "custom"]);

const toDateInput = (date) => date.toISOString().slice(0, 10);

const parseDateInput = (value) => {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return null;
	}

	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) || toDateInput(date) !== value
		? null
		: date;
};

export const resolveReportRange = (query = {}, now = new Date()) => {
	const period = validPeriods.has(query.period) ? query.period : "daily";
	const today = new Date(Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	));
	let start;
	let endExclusive;

	if (period === "daily") {
		start = parseDateInput(query.startDate) || today;
		endExclusive = new Date(start);
		endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
	} else if (period === "weekly") {
		start = new Date(today);
		start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
		endExclusive = new Date(today);
		endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
	} else if (period === "monthly") {
		const parsed = parseDateInput(query.startDate);
		if (parsed) {
			start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
			const nextMonth = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 1));
			if (nextMonth <= today) {
				endExclusive = nextMonth;
			} else {
				endExclusive = new Date(today);
				endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
			}
		} else {
			start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
			endExclusive = new Date(today);
			endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
		}
	} else if (period === "yearly") {
		start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
		endExclusive = new Date(today);
		endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
	} else {
		start = parseDateInput(query.startDate);
		const end = parseDateInput(query.endDate);
		if (!start || !end || end < start) {
			const error = new Error("Choose a valid custom start and end date.");
			error.status = 400;
			throw error;
		}

		endExclusive = new Date(end);
		endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
	}

	const end = new Date(endExclusive);
	end.setUTCDate(end.getUTCDate() - 1);

	return {
		period,
		start,
		end,
		endExclusive,
		startDate: toDateInput(start),
		endDate: toDateInput(end),
	};
};

const toAmount = (value) => {
	const amount = Number(value);
	return Number.isFinite(amount) ? amount : 0;
};

const formatCurrency = (amount) =>
	`₹${toAmount(amount).toLocaleString("en-IN", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

export const getSalesReportData = async (query = {}, now = new Date()) => {
	const range = resolveReportRange(query, now);
	const salesFilter = {
		createdAt: { $gte: range.start, $lt: range.endExclusive },
		order_status: { $nin: ["cancelled", "returned"] },
		$or: [
			{ payment_status: "paid" },
			{ payment_method: "cod", order_status: "delivered" },
		],
	};
	const [orders, fulfillmentOrders] = await Promise.all([
		Order.find(salesFilter).sort({ createdAt: -1 }).lean(),
		Order.find({ createdAt: salesFilter.createdAt }).select("order_status").lean(),
	]);
	const orderIds = orders.map((order) => order._id);
	const returnCredits = orderIds.length
		? await WalletTransaction.find({
				order_id: { $in: orderIds },
				type: "CREDIT",
				reason: "ORDER_RETURN",
			}).lean()
		: [];
	const productIds = [...new Set(orders.flatMap((order) =>
		(order.items || []).map((item) => String(item.product_id)).filter(Boolean),
	))];
	const products = productIds.length
		? await Product.find({ _id: { $in: productIds } }).select("category_id").lean()
		: [];
	const categoryIds = [...new Set(products.map((product) => String(product.category_id)).filter(Boolean))];
	const categories = categoryIds.length
		? await Category.find({ _id: { $in: categoryIds } }).select("category_name").lean()
		: [];
	const refundedByOrder = new Map();
	const productById = new Map(products.map((product) => [String(product._id), product]));
	const categoryById = new Map(categories.map((category) => [String(category._id), category.category_name]));

	for (const transaction of returnCredits) {
		const orderId = String(transaction.order_id);
		refundedByOrder.set(
			orderId,
			(refundedByOrder.get(orderId) || 0) + toAmount(transaction.amount),
		);
	}

	const rows = orders.map((order) => {
		const discount = toAmount(order.discount);
		const couponDeduction = order.coupon_code ? discount : 0;
		const grossAmount = toAmount(order.subtotal);
		const orderAmount = toAmount(order.final_amount);
		const refundAmount = refundedByOrder.get(String(order._id)) || 0;

		return {
			orderId: order.order_id,
			date: order.createdAt,
			status: order.order_status,
			couponCode: order.coupon_code || "—",
			grossAmount,
			discount,
			couponDeduction,
			orderAmount,
			refundAmount,
			netRevenue: Math.max(0, orderAmount - refundAmount),
			grossDisplay: formatCurrency(grossAmount),
			discountDisplay: formatCurrency(discount),
			couponDisplay: formatCurrency(couponDeduction),
			orderDisplay: formatCurrency(orderAmount),
			refundDisplay: formatCurrency(refundAmount),
			netDisplay: formatCurrency(Math.max(0, orderAmount - refundAmount)),
			dateDisplay: new Date(order.createdAt).toLocaleDateString("en-IN", {
				day: "2-digit",
				month: "short",
				year: "numeric",
			}),
		};
	});

	const fulfillmentLabels = {
		pending: "Pending",
		shipped: "Shipped",
		out_for_delivery: "Out for delivery",
		delivered: "Delivered",
		return_requested: "Return requested",
		returned: "Returned",
		cancelled: "Cancelled",
	};
	const fulfillmentColors = {
		pending: "#d97706",
		shipped: "#2563eb",
		out_for_delivery: "#0f766e",
		delivered: "#15803d",
		return_requested: "#7c3aed",
		returned: "#64748b",
		cancelled: "#dc2626",
	};
	const fulfillmentCounts = new Map();
	for (const order of fulfillmentOrders) {
		const status = order.order_status || "pending";
		fulfillmentCounts.set(status, (fulfillmentCounts.get(status) || 0) + 1);
	}
	const fulfillmentTotal = fulfillmentOrders.length;
	const circumference = 2 * Math.PI * 40;
	let fulfillmentOffset = 0;
	const fulfillmentStats = Object.entries(fulfillmentLabels).map(([status, label]) => {
		const count = fulfillmentCounts.get(status) || 0;
		const segmentLength = fulfillmentTotal ? (count / fulfillmentTotal) * circumference : 0;
		const segment = {
			status,
			label,
			count,
			percent: fulfillmentTotal ? Math.round((count / fulfillmentTotal) * 100) : 0,
			color: fulfillmentColors[status],
			dashArray: `${segmentLength.toFixed(2)} ${(circumference - segmentLength).toFixed(2)}`,
			dashOffset: (-fulfillmentOffset).toFixed(2),
		};
		fulfillmentOffset += segmentLength;
		return segment;
	});

	const categoryTotals = new Map();
	const productTotals = new Map();
	for (const order of orders) {
		const items = order.items || [];
		const itemsGross = items.reduce((total, item) =>
			total + toAmount(item.item_total || toAmount(item.price) * toAmount(item.quantity)), 0);
		const allocatedDiscount = toAmount(order.discount);
		const allocatedRefund = refundedByOrder.get(String(order._id)) || 0;

		for (const item of items) {
			const quantity = toAmount(item.quantity);
			const gross = toAmount(item.item_total || toAmount(item.price) * quantity);
			const allocation = itemsGross ? gross / itemsGross : 0;
			const netRevenue = Math.max(
				0,
				Number((gross - allocatedDiscount * allocation - allocatedRefund * allocation).toFixed(2)),
			);
			const productId = String(item.product_id || item.product_name);
			const product = productById.get(productId);
			const categoryName = categoryById.get(String(product?.category_id)) || "Uncategorized";
			const productName = item.product_name || "Unnamed product";

			const categoryTotal = categoryTotals.get(categoryName) || {
				name: categoryName, unitsSold: 0, netRevenue: 0, orderIds: new Set(),
			};
			categoryTotal.unitsSold += quantity;
			categoryTotal.netRevenue += netRevenue;
			categoryTotal.orderIds.add(String(order._id));
			categoryTotals.set(categoryName, categoryTotal);

			const productTotal = productTotals.get(productId) || {
				name: productName, category: categoryName, unitsSold: 0, netRevenue: 0,
			};
			productTotal.unitsSold += quantity;
			productTotal.netRevenue += netRevenue;
			productTotals.set(productId, productTotal);
		}
	}

	const categoryRows = [...categoryTotals.values()]
		.map((category) => ({
			...category,
			orderCount: category.orderIds.size,
			revenueDisplay: formatCurrency(category.netRevenue),
		}))
		.sort((left, right) => right.netRevenue - left.netRevenue);
	const maxCategoryRevenue = Math.max(0, ...categoryRows.map((category) => category.netRevenue));
	for (const category of categoryRows) {
		category.barWidth = maxCategoryRevenue
			? Math.max(2, Math.round((category.netRevenue / maxCategoryRevenue) * 100))
			: 0;
		category.unitsDisplay = `${category.unitsSold} units`;
	}

	const topProducts = [...productTotals.values()]
		.sort((left, right) => right.netRevenue - left.netRevenue)
		.slice(0, 5);
	const maxProductRevenue = Math.max(0, ...topProducts.map((product) => product.netRevenue));
	for (const product of topProducts) {
		product.barWidth = maxProductRevenue
			? Math.max(2, Math.round((product.netRevenue / maxProductRevenue) * 100))
			: 0;
		product.revenueDisplay = formatCurrency(product.netRevenue);
		product.unitsDisplay = `${product.unitsSold} units`;
	}

	const summary = rows.reduce((totals, row) => {
		totals.grossAmount += row.grossAmount;
		totals.discount += row.discount;
		totals.couponDeduction += row.couponDeduction;
		totals.orderAmount += row.orderAmount;
		totals.refundAmount += row.refundAmount;
		totals.netRevenue += row.netRevenue;
		return totals;
	}, {
		salesCount: rows.length,
		grossAmount: 0,
		discount: 0,
		couponDeduction: 0,
		couponUses: rows.filter((row) => row.couponCode !== "—").length,
		orderAmount: 0,
		refundAmount: 0,
		netRevenue: 0,
	});

	summary.averageOrderAmount = summary.salesCount
		? summary.orderAmount / summary.salesCount
		: 0;
	summary.grossDisplay = formatCurrency(summary.grossAmount);
	summary.discountDisplay = formatCurrency(summary.discount);
	summary.couponDisplay = formatCurrency(summary.couponDeduction);
	summary.orderDisplay = formatCurrency(summary.orderAmount);
	summary.refundDisplay = formatCurrency(summary.refundAmount);
	summary.netDisplay = formatCurrency(summary.netRevenue);
	summary.averageDisplay = formatCurrency(summary.averageOrderAmount);

	const filterQuery = new URLSearchParams({
		period: range.period,
		...(range.period === "daily" ? { startDate: range.startDate } : {}),
		...(range.period === "monthly" && query.startDate ? { startDate: range.startDate } : {}),
		...(range.period === "custom"
			? { startDate: range.startDate, endDate: range.endDate }
			: {}),
	}).toString();

	return {
		...range,
		summary,
		rows,
		filterQuery,
		fulfillmentStats,
		fulfillmentTotal,
		categoryRows,
		topProducts,
	};
};

const loadSalesReport = async (req, res) => {
	try {
		const report = await getSalesReportData(req.query);
		return res.render("admin/sales-report", report);
	} catch (error) {
		return res.status(error.status || 500).render("admin/sales-report", {
			period: validPeriods.has(req.query.period) ? req.query.period : "daily",
			startDate: req.query.startDate || toDateInput(new Date()),
			endDate: req.query.endDate || toDateInput(new Date()),
			error: error.status ? error.message : "Unable to load sales report.",
			summary: {
				salesCount: 0,
				grossDisplay: formatCurrency(0),
				discountDisplay: formatCurrency(0),
				couponDisplay: formatCurrency(0),
				orderDisplay: formatCurrency(0),
				refundDisplay: formatCurrency(0),
				netDisplay: formatCurrency(0),
			},
			rows: [],
			filterQuery: "period=daily",
		});
	}
};

const exportSalesReportPdf = async (req, res) => {
	try {
		const report = await getSalesReportData(req.query);
		const filename = `sales-report-${report.startDate}-to-${report.endDate}.pdf`;
		res.setHeader("Content-Type", "application/pdf");
		res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
		const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
		doc.pipe(res);
		doc.fontSize(20).font("Helvetica-Bold").text("Sales Report");
		doc.moveDown(0.3).fontSize(10).font("Helvetica")
			.text(`Period: ${report.startDate} to ${report.endDate}`);
		doc.moveDown().font("Helvetica-Bold").text("Summary");
		doc.font("Helvetica").text(`Sales count: ${report.summary.salesCount}`);
		doc.text(`Gross order amount: ${report.summary.grossDisplay}`);
		doc.text(`Discounts: ${report.summary.discountDisplay}`);
		doc.text(`Coupon deductions: ${report.summary.couponDisplay}`);
		doc.text(`Order amount: ${report.summary.orderDisplay}`);
		doc.text(`Wallet refunds: ${report.summary.refundDisplay}`);
		doc.text(`Net revenue: ${report.summary.netDisplay}`);
	doc.moveDown().font("Helvetica-Bold").text("Order fulfillment");
	doc.font("Helvetica");
	for (const status of report.fulfillmentStats) {
		doc.text(`${status.label}: ${status.count} (${status.percent}%)`);
	}
	doc.moveDown().font("Helvetica-Bold").text("Revenue by category");
	doc.font("Helvetica");
	for (const category of report.categoryRows) {
		if (doc.y > 750) doc.addPage();
		doc.text(`${category.name}: ${category.revenueDisplay} · ${category.unitsSold} units`);
	}
	doc.moveDown().font("Helvetica-Bold").text("Top performing products");
	doc.font("Helvetica");
	for (const product of report.topProducts) {
		if (doc.y > 750) doc.addPage();
		doc.text(`${product.name} (${product.category}): ${product.revenueDisplay} · ${product.unitsSold} units`);
	}
		doc.moveDown().font("Helvetica-Bold").text("Orders");

		const columns = [40, 130, 205, 275, 340, 405, 475];
		const drawTableHeader = () => {
			doc.fontSize(8).font("Helvetica-Bold");
			["Order", "Date", "Coupon", "Gross", "Discount", "Refund", "Net"].forEach((label, index) => {
				doc.text(label, columns[index], doc.y, { width: index === 0 ? 85 : 68 });
			});
			doc.moveDown(0.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
			doc.moveDown(0.4);
		};

		drawTableHeader();
		for (const row of report.rows) {
			if (doc.y > 750) {
				doc.addPage();
				drawTableHeader();
			}
			const y = doc.y;
			doc.fontSize(7).font("Helvetica");
			[row.orderId, row.dateDisplay, row.couponCode, row.grossDisplay, row.discountDisplay, row.refundDisplay, row.netDisplay]
				.forEach((value, index) => doc.text(String(value), columns[index], y, { width: index === 0 ? 85 : 68 }));
			doc.moveDown(0.8);
		}

		doc.end();
	} catch (error) {
		if (!res.headersSent) {
			return res.status(error.status || 500).send(error.message);
		}
		res.end();
	}
};

const exportSalesReportExcel = async (req, res) => {
	try {
		const report = await getSalesReportData(req.query);
		const workbook = new ExcelJS.Workbook();
		workbook.creator = "Nutri Burfi Admin";
		workbook.created = new Date();

		const summarySheet = workbook.addWorksheet("Summary");
		summarySheet.addRows([
			["Sales Report", `${report.startDate} to ${report.endDate}`],
			["Sales count", report.summary.salesCount],
			["Gross order amount", report.summary.grossAmount],
			["Discounts", report.summary.discount],
			["Coupon deductions", report.summary.couponDeduction],
			["Order amount", report.summary.orderAmount],
			["Wallet refunds", report.summary.refundAmount],
			["Net revenue", report.summary.netRevenue],
		]);
		summarySheet.getRow(1).font = { bold: true, size: 14 };
		summarySheet.columns = [{ width: 24 }, { width: 32 }];

		const fulfillmentSheet = workbook.addWorksheet("Fulfillment");
		fulfillmentSheet.columns = [
			{ header: "Order Status", key: "label", width: 24 },
			{ header: "Order Count", key: "count", width: 16 },
			{ header: "Share", key: "percent", width: 14 },
		];
		fulfillmentSheet.getRow(1).font = { bold: true };
		fulfillmentSheet.addRows(report.fulfillmentStats);

		const categoriesSheet = workbook.addWorksheet("Categories");
		categoriesSheet.columns = [
			{ header: "Category", key: "name", width: 28 },
			{ header: "Units Sold", key: "unitsSold", width: 16 },
			{ header: "Orders", key: "orderCount", width: 14 },
			{ header: "Net Revenue", key: "netRevenue", width: 20 },
		];
		categoriesSheet.getRow(1).font = { bold: true };
		categoriesSheet.addRows(report.categoryRows);
		categoriesSheet.getColumn("netRevenue").numFmt = '₹#,##0.00';

		const productsSheet = workbook.addWorksheet("Top Products");
		productsSheet.columns = [
			{ header: "Product", key: "name", width: 32 },
			{ header: "Category", key: "category", width: 24 },
			{ header: "Units Sold", key: "unitsSold", width: 16 },
			{ header: "Net Revenue", key: "netRevenue", width: 20 },
		];
		productsSheet.getRow(1).font = { bold: true };
		productsSheet.addRows(report.topProducts);
		productsSheet.getColumn("netRevenue").numFmt = '₹#,##0.00';

		const ordersSheet = workbook.addWorksheet("Orders");
		ordersSheet.columns = [
			{ header: "Order ID", key: "orderId", width: 24 },
			{ header: "Date", key: "date", width: 16 },
			{ header: "Status", key: "status", width: 20 },
			{ header: "Coupon Code", key: "couponCode", width: 22 },
			{ header: "Gross Order Amount", key: "grossAmount", width: 22 },
			{ header: "Discount", key: "discount", width: 16 },
			{ header: "Coupon Deduction", key: "couponDeduction", width: 19 },
			{ header: "Order Amount", key: "orderAmount", width: 18 },
			{ header: "Wallet Refund", key: "refundAmount", width: 18 },
			{ header: "Net Revenue", key: "netRevenue", width: 18 },
		];
		ordersSheet.getRow(1).font = { bold: true };
		for (const row of report.rows) {
			ordersSheet.addRow({
				...row,
				date: new Date(row.date),
			});
		}
		ordersSheet.getColumn("date").numFmt = "yyyy-mm-dd";
		for (const key of ["grossAmount", "discount", "couponDeduction", "orderAmount", "refundAmount", "netRevenue"]) {
			ordersSheet.getColumn(key).numFmt = '₹#,##0.00';
		}

		const filename = `sales-report-${report.startDate}-to-${report.endDate}.xlsx`;
		res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
		res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
		const buffer = await workbook.xlsx.writeBuffer();
		return res.end(buffer);
	} catch (error) {
		return res.status(error.status || 500).send(error.message);
	}
};

export default {
	loadSalesReport,
	exportSalesReportExcel,
	exportSalesReportPdf
};
