const express = require("express");
const router = express.Router();
const db = require("../../config/db");
const { verifyToken, isOwner } = require("../../middleware/auth");

// Middleware ตรวจสอบ token และสิทธิ์เจ้าของร้าน
router.use(verifyToken, isOwner);

router.get("/all", async (req, res) => {
  try {
    const [receipts] = await db
      .promise()
      .query(
        `SELECT DISTINCT receipt_code, receipt_time 
         FROM receipts 
         ORDER BY receipt_time DESC`
      );

    const [orders] = await db
      .promise()
      .query(
        `SELECT po.pending_order_id, po.order_code, po.table_number, po.order_time, 
                po.status, po.total_price, po.status_pay, po.payment_slip
         FROM pending_orders po
         JOIN receipts r ON po.order_code = r.receipt_code
         ORDER BY po.order_time DESC`
      );

    const [orderItems] = await db
      .promise()
      .query(
        `SELECT poi.*, m.menu_name
         FROM pending_order_items poi
         JOIN menu m ON poi.menu_id = m.menu_id`
      );

    const receiptsWithDetails = receipts.map((receipt) => {
      const relatedOrders = orders.filter(
        (order) => order.order_code === receipt.receipt_code
      );
      const ordersWithItems = relatedOrders.map((order) => {
        const items = orderItems.filter(
          (item) => item.pending_order_id === order.pending_order_id
        );
        return {
          ...order,
          items,
        };
      });
      return {
        receipt_code: receipt.receipt_code,
        receipt_time: receipt.receipt_time,
        orders: ordersWithItems,
      };
    });

    res.json({ receipts: receiptsWithDetails });
  } catch (error) {
    console.error("เกิดข้อผิดพลาดใน backend:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์" });
  }
});

module.exports = router;