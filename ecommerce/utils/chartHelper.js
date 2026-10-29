import Order from "../models/orderSchema.js";

export const getChartDataHelper = async (filter = "monthly") => {
  const now = new Date();
  const validOrderMatch = {
    order_status: { $nin: ["cancelled"] },
  };

  if (filter === "yearly") {
    const currentYear = now.getFullYear();
    const startYear = currentYear - 4;
    const startDate = new Date(startYear, 0, 1);

    const data = await Order.aggregate([
      {
        $match: {
          ...validOrderMatch,
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: { $year: "$createdAt" },
          revenue: { $sum: "$final_amount" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const labels = [];
    const revenueData = [];
    const ordersData = [];

    for (let y = startYear; y <= currentYear; y++) {
      labels.push(String(y));
      const found = data.find((d) => d._id === y);
      revenueData.push(found ? Math.round(found.revenue) : 0);
      ordersData.push(found ? found.orders : 0);
    }

    return {
      filter: "yearly",
      labels,
      revenueData,
      ordersData,
      totalRevenue: revenueData.reduce((a, b) => a + b, 0),
      totalOrders: ordersData.reduce((a, b) => a + b, 0),
    };
  }

  if (filter === "weekly") {
    const labels = [];
    const revenueData = [];
    const ordersData = [];
    const days = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = `${year}-${month}-${day}`;
      const dayLabel = d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
      });
      days.push(key);
      labels.push(dayLabel);
    }

    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const data = await Order.aggregate([
      {
        $match: {
          ...validOrderMatch,
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$final_amount" },
          orders: { $sum: 1 },
        },
      },
    ]);

    const dataMap = new Map(data.map((d) => [d._id, d]));
    for (const key of days) {
      const item = dataMap.get(key);
      revenueData.push(item ? Math.round(item.revenue) : 0);
      ordersData.push(item ? item.orders : 0);
    }

    return {
      filter: "weekly",
      labels,
      revenueData,
      ordersData,
      totalRevenue: revenueData.reduce((a, b) => a + b, 0),
      totalOrders: ordersData.reduce((a, b) => a + b, 0),
    };
  }

  // Default: monthly (current year)
  const currentYear = now.getFullYear();
  const startOfYear = new Date(currentYear, 0, 1);
  const endOfYear = new Date(currentYear + 1, 0, 1);

  const data = await Order.aggregate([
    {
      $match: {
        ...validOrderMatch,
        createdAt: { $gte: startOfYear, $lt: endOfYear },
      },
    },
    {
      $group: {
        _id: { $month: "$createdAt" },
        revenue: { $sum: "$final_amount" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const revenueData = [];
  const ordersData = [];

  for (let m = 1; m <= 12; m++) {
    const found = data.find((d) => d._id === m);
    revenueData.push(found ? Math.round(found.revenue) : 0);
    ordersData.push(found ? found.orders : 0);
  }

  return {
    filter: "monthly",
    labels: monthNames,
    revenueData,
    ordersData,
    totalRevenue: revenueData.reduce((a, b) => a + b, 0),
    totalOrders: ordersData.reduce((a, b) => a + b, 0),
  };
};

export default {
  getChartDataHelper,
};
