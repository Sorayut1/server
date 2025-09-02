const express = require("express");
const router = express.Router();
const db = require("../../config/db");
const { verifyToken } = require("../../middleware/auth");
const path = require("path");
const fs = require("fs");

const API_URL_IMAGE = "http://localhost:3000/uploads/bill";

router.use(verifyToken);
const { getTodayRevenue } = require("../owner/getTodayRevenue");
const { getTodayCount } = require("../owner/getTodayCount");

// ดึงออเดอร์ทั้งหมดของวันนี้
router.get("/all", verifyToken, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Bangkok",
    });

    const [rows] = await db.promise().query(
      `SELECT order_id, table_number, order_time, status, total_price, order_code, status_pay, payment_slip 
       FROM orders 
       WHERE DATE(order_time) = ?`,
      [today]
    );

    res.json({ orders: rows });
  } catch (error) {
    console.error("เกิดข้อผิดพลาดใน backend:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์" });
  }
});

// ดึงจำนวนออเดอร์วันนี้
router.get("/count", verifyToken, async (req, res) => {
  try {
    const count = await getTodayCount();

    const io = req.app.get("io");
    if (io) {
      io.emit("orderCountUpdated", { count });
    }

    return res.json({ count });
  } catch (error) {
    console.error("เกิดข้อผิดพลาด:", error);
    return res
      .status(500)
      .json({ message: "ไม่สามารถดึงจำนวนออเดอร์วันนี้ได้" });
  }
});

// คำนวณยอดขายวันนี้
router.get("/today-revenue", async (req, res) => {
  try {
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Bangkok",
    });

    const [result] = await db.promise().query(
      `SELECT 
        COALESCE(SUM(total_price), 0) AS totalRevenue,
        COUNT(*) AS totalOrders
      FROM orders
      WHERE DATE(order_time) = ?
        AND status = 'completed'`,
      [today]
    );

    res.json({
      totalRevenue: parseFloat(result[0].totalRevenue) || 0,
      totalOrders: result[0].totalOrders,
      date: new Date().toLocaleDateString("th-TH"),
    });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({
      message: "ดึงยอดขายวันนี้ล้มเหลว",
      error: err.message,
    });
  }
});

// ดึงรายละเอียดออเดอร์
router.get("/:orderId", verifyToken, async (req, res) => {
  const orderId = req.params.orderId;

  if (!orderId || isNaN(orderId)) {
    return res.status(400).json({
      message: "รหัสออเดอร์ไม่ถูกต้อง",
      success: false,
    });
  }

  try {
    const [orderDetails] = await db.promise().query(
      `SELECT order_id, table_number, order_time, status, total_price, order_code, status_pay, payment_slip 
       FROM orders 
       WHERE order_id = ?`,
      [orderId]
    );

    const [items] = await db.promise().query(
      `SELECT 
         oi.item_id,
         oi.order_id,
         oi.menu_id,
         COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name,
         oi.quantity,
         oi.note,
         oi.specialRequest,
         oi.price,
         (oi.quantity * oi.price) as subtotal
       FROM order_items oi
       LEFT JOIN menu m ON oi.menu_id = m.menu_id
       WHERE oi.order_id = ?
       ORDER BY oi.item_id`,
      [orderId]
    );

    if (orderDetails.length === 0) {
      return res.status(404).json({
        message: "ไม่พบออเดอร์นี้",
        success: false,
      });
    }

    res.json({
      success: true,
      order: orderDetails[0],
      items,
      orderId: parseInt(orderId),
      totalItems: items.length,
    });
  } catch (error) {
    console.error("เกิดข้อผิดพลาดใน backend (orderId):", error);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์",
      success: false,
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// อัปเดตสถานะออเดอร์
router.put("/:orderId/status", verifyToken, async (req, res) => {
  const orderId = Number(req.params.orderId);
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ message: "กรุณาระบุสถานะ" });
  }

  try {
    const [result] = await db
      .promise()
      .query("UPDATE orders SET status = ? WHERE order_id = ?", [
        status,
        orderId,
      ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบ order นี้" });
    }

    if (status === "completed") {
      const [orderRows] = await db
        .promise()
        .query(`SELECT order_code, table_number, order_time, status, total_price, status_pay, payment_slip FROM orders WHERE order_id = ?`, [orderId]);

      if (orderRows.length > 0) {
        const [pendingOrderInsertResult] = await db.promise().query(
          `INSERT INTO pending_orders (order_code, table_number, order_time, status, total_price, status_pay, payment_slip)
           SELECT order_code, table_number, order_time, status, total_price, status_pay, payment_slip
           FROM orders WHERE order_id = ?`,
          [orderId]
        );

        const newPendingOrderId = pendingOrderInsertResult.insertId;

        await db.promise().query(
          `INSERT INTO pending_order_items (pending_order_id, menu_id, quantity, price, note, specialRequest)
           SELECT ?, menu_id, quantity, price, note, specialRequest
           FROM order_items WHERE order_id = ?`,
          [newPendingOrderId, orderId]
        );

        const orderCode = orderRows[0].order_code;
        const [existingReceipt] = await db
          .promise()
          .query(`SELECT 1 FROM receipts WHERE receipt_code = ? LIMIT 1`, [
            orderCode,
          ]);

        if (existingReceipt.length === 0) {
          await db.promise().query(
            `INSERT INTO receipts (receipt_code, receipt_order_id)
             VALUES (?, ?)`,
            [orderCode, newPendingOrderId]
          );
        }
      }
    }

    const io = req.app.get("io");
    if (io) {
      try {
        io.emit("order_status_updated", { orderId, status });
        const revenueData = await getTodayRevenue();
        io.emit("today_revenue_updated", revenueData);
        const count = await getTodayCount();
        io.emit("orderCountUpdated", { count });
      } catch (ioErr) {
        console.error("ส่งข้อมูล realtime ล้มเหลว:", ioErr);
      }
    }

    res.json({
      message: "อัปเดตสถานะสำเร็จ",
      orderId,
      status,
      success: true,
    });
  } catch (err) {
    console.error("อัปเดตสถานะล้มเหลว:", err);
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์", success: false });
  }
});

module.exports = router;