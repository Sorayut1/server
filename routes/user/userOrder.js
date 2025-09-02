const express = require("express");
const router = express.Router();
const db = require("../../config/db");
const { getTodayCount } = require("../owner/getTodayCount"); // ปรับ path ให้ถูกต้องตามโครงสร้างคุณ

// ฟังก์ชันลบออเดอร์เก่าของวันก่อน
const clearOldOrders = async () => {
  try {
    await db.promise().query(`
      DELETE FROM orders WHERE DATE(order_time) < CURDATE()
    `);

    await db.promise().query(`
      DELETE FROM temp_receipts WHERE DATE(temp_receipt_time) < CURDATE()
    `);

    await db.promise().query(`
      DELETE oi FROM order_items oi
      LEFT JOIN orders o ON oi.order_id = o.order_id
      WHERE o.order_id IS NULL
    `);

    console.log("ลบออเดอร์เก่าของวันก่อนเรียบร้อย");
  } catch (err) {
    console.error("Error clearing old orders:", err);
  }
};

// -----------------------------
// เพิ่มออเดอร์ (เก็บใน DB ชั่วคราว)
// -----------------------------
router.post("/", async (req, res) => {
  const { table_number, items, order_code } = req.body;

  if (!table_number || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "ข้อมูลไม่ถูกต้อง" });
  }

  try {
    // เรียก clearOldOrders ทุกครั้งก่อนเพิ่ม order ใหม่
    await clearOldOrders();

    const totalPrice = items.reduce((sum, item) => {
      const price = parseFloat(item.price);
      const quantity = parseInt(item.quantity) || 1;
      return sum + (isNaN(price) ? 0 : price * quantity);
    }, 0);

    // ตรวจสอบ temp_receipts
    const [existingTemp] = await db
      .promise()
      .query(
        "SELECT temp_receipt_id FROM temp_receipts WHERE temp_receipt_code = ?",
        [order_code]
      );

    let tempReceiptId;
    if (existingTemp.length === 0) {
      const [tempResult] = await db
        .promise()
        .query(
          "INSERT INTO temp_receipts (temp_receipt_code, table_number, temp_receipt_time) VALUES (?, ?, NOW())",
          [order_code, table_number]
        );
      tempReceiptId = tempResult.insertId;
    } else {
      tempReceiptId = existingTemp[0].temp_receipt_id;
    }

    // Insert เข้า orders
    const [orderResult] = await db
      .promise()
      .query(
        "INSERT INTO orders (order_code, table_number, status, status_pay, total_price, order_time) VALUES (?, ?, ?, ?, ?, NOW())",
        [order_code, table_number, "pending", "uncash", totalPrice]
      );

    const orderId = orderResult.insertId;

    // Insert order_items
    const insertItemsPromises = items.map((item) => {
      const menuId = item.menu_id || item.id;
      if (!menuId || !item.price) {
        throw new Error(`ข้อมูลรายการอาหารไม่ครบ: ${JSON.stringify(item)}`);
      }
      return db
        .promise()
        .query(
          "INSERT INTO order_items (order_id, menu_id, quantity, price, note, specialRequest) VALUES (?, ?, ?, ?, ?, ?)",
          [
            orderId,
            menuId,
            item.quantity,
            item.price,
            item.note || null,
            item.specialRequest || null,
          ]
        );
    });

    await Promise.all(insertItemsPromises);

    // Emit ผ่าน Socket.IO
    const io = req.app.get("io");
    if (io) {
      const count = await getTodayCount();

      // ดึงข้อมูล grouped receipt สำหรับ order_code นี้
      const [updatedReceipts] = await db.promise().query(
        `SELECT 
      tr.temp_receipt_id, tr.temp_receipt_code, tr.temp_receipt_time, tr.table_number,
      o.order_id, o.order_time, o.status, o.total_price, o.order_code, o.status_pay, o.payment_slip,
      oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name,
      oi.quantity, oi.price, oi.note, oi.specialRequest
     FROM temp_receipts tr
     LEFT JOIN orders o ON tr.temp_receipt_code = o.order_code
     LEFT JOIN order_items oi ON o.order_id = oi.order_id
     LEFT JOIN menu m ON oi.menu_id = m.menu_id
     WHERE tr.temp_receipt_code = ?`,
        [order_code]
      );

      // จัดกลุ่มข้อมูลเหมือนใน manageOrder
      const groupReceipts = (rows) => {
        const grouped = rows.reduce((acc, row) => {
          if (!acc[row.temp_receipt_code]) {
            acc[row.temp_receipt_code] = {
              temp_receipt_id: row.temp_receipt_id,
              temp_receipt_code: row.temp_receipt_code,
              table_number: row.table_number,
              temp_receipt_time: row.temp_receipt_time,
              orders: [],
            };
          }
          if (row.order_id) {
            let order = acc[row.temp_receipt_code].orders.find(
              (o) => o.order_id === row.order_id
            );
            if (!order) {
              order = {
                order_id: row.order_id,
                table_number: row.table_number,
                order_time: row.order_time,
                status: row.status,
                total_price: parseFloat(row.total_price) || 0,
                order_code: row.order_code,
                status_pay: row.status_pay,
                payment_slip: row.payment_slip,
                items: [],
              };
              acc[row.temp_receipt_code].orders.push(order);
            }
            if (row.item_id) {
              order.items.push({
                item_id: row.item_id,
                menu_id: row.menu_id,
                menu_name: row.menu_name,
                quantity: row.quantity,
                price: parseFloat(row.price) || 0,
                note: row.note || "",
                specialRequest: row.specialRequest || "",
              });
            }
          }
          return acc;
        }, {});
        return Object.values(grouped);
      };

      const groupedReceipts = groupReceipts(updatedReceipts);
      const updatedReceipt = groupedReceipts[0]; // ได้ receipt ที่เพิ่ง insert

      // Emit event เดียวกับ manageOrder
      if (updatedReceipt) {
        io.emit("temp_receipt_updated", updatedReceipt);
        console.log("📢 Emitted temp_receipt_updated:", updatedReceipt);
      }

      io.emit("orderCountUpdated", { count });
    }

    // ส่ง response
    return res.json({
      message: "บันทึกคำสั่งซื้อเรียบร้อย",
      tempReceiptId,
      orderId,
      order_code,
      total_price: totalPrice,
    });
  } catch (error) {
    console.error("เพิ่มคำสั่งซื้อไม่สำเร็จ:", error);
    return res.status(500).json({
      message: error.message || "เกิดข้อผิดพลาดในการบันทึกคำสั่งซื้อ",
    });
  }
});

module.exports = router;
