const express = require("express");
const router = express.Router();
const db = require("../../config/db");

// ยอดขายวันนี้
router.get("/today-revenue", async (req, res) => {
  console.log("เรียก today-revenue แล้ว");
  try {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
    const [result] = await db.promise().query(
      `SELECT 
         COALESCE(SUM(total_price), 0) AS totalRevenue, 
         COUNT(DISTINCT order_id) AS totalOrders 
       FROM orders 
       WHERE DATE(order_time) = ? AND status = 'completed'`,
      [today]
    );

    res.json({
      totalRevenue: parseFloat(result[0].totalRevenue) || 0,
      totalOrders: parseInt(result[0].totalOrders) || 0,
      date: new Date().toLocaleDateString("th-TH", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "Asia/Bangkok",
      }),
    });
  } catch (err) {
    console.error("ดึงยอดขายวันนี้ล้มเหลว:", err.message);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงยอดขาย", error: err.message });
  }
});

// ดึงข้อมูลจาก temp_receipts พร้อม join เดียวกัน (รายวัน)
// router.get("/all", async (req, res) => {
//   try {
//     const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
//     const [receipts] = await db.promise().query(
//       `SELECT 
//         tr.temp_receipt_id, tr.temp_receipt_code, tr.temp_receipt_time, tr.table_number,
//         o.order_id, o.order_time, o.status, o.total_price, o.order_code, o.status_pay, o.payment_slip,
//         oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name, 
//         oi.quantity, oi.price, oi.note, oi.specialRequest
//       FROM temp_receipts tr 
//       LEFT JOIN orders o ON tr.temp_receipt_code = o.order_code 
//       LEFT JOIN order_items oi ON o.order_id = oi.order_id
//       LEFT JOIN menu m ON oi.menu_id = m.menu_id
//       WHERE DATE(tr.temp_receipt_time) = ?`,
//       [today]
//     );

//     const groupedReceipts = receipts.reduce((acc, row) => {
//       if (!acc[row.temp_receipt_code]) {
//         acc[row.temp_receipt_code] = {
//           temp_receipt_id: row.temp_receipt_id,
//           temp_receipt_code: row.temp_receipt_code,
//           table_number: row.table_number,
//           temp_receipt_time: row.temp_receipt_time,
//           orders: [],
//         };
//       }
//       if (row.order_id) {
//         let order = acc[row.temp_receipt_code].orders.find(o => o.order_id === row.order_id);
//         if (!order) {
//           order = {
//             order_id: row.order_id,
//             table_number: row.table_number,
//             order_time: row.order_time,
//             status: row.status,
//             total_price: parseFloat(row.total_price) || 0,
//             order_code: row.order_code,
//             status_pay: row.status_pay,
//             payment_slip: row.payment_slip,
//             items: [],
//           };
//           acc[row.temp_receipt_code].orders.push(order);
//         }
//         if (row.item_id) {
//           order.items.push({
//             item_id: row.item_id,
//             menu_id: row.menu_id,
//             menu_name: row.menu_name,
//             quantity: row.quantity,
//             price: parseFloat(row.price) || 0,
//             note: row.note || '',
//             specialRequest: row.specialRequest || '',
//           });
//         }
//       }
//       return acc;
//     }, {});

//     res.json(Object.values(groupedReceipts));
//   } catch (err) {
//     console.error("ดึง temp_receipts ล้มเหลว:", err.message);
//     res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล", error: err.message });
//   }
// });
const { groupReceipts } = require("./groupReceipts");

// ฟังก์ชันดึง temp_receipts + orders และจัดกลุ่ม
async function fetchGroupedReceipts() {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

  // 1️⃣ ดึง temp_receipts ของวันนี้
  const [tempReceipts] = await db.promise().query(
    `SELECT temp_receipt_id, temp_receipt_code, temp_receipt_time, table_number
     FROM temp_receipts
     WHERE DATE(temp_receipt_time) = ?`,
    [today]
  );

  if (!tempReceipts.length) return [];

  // 2️⃣ ดึง orders + items สำหรับ temp_receipt_code ของวันนี้
  const receiptCodes = tempReceipts.map(r => r.temp_receipt_code);
  const [ordersRows] = await db.promise().query(
    `SELECT 
      o.order_id, o.order_code, o.order_time, o.status, o.total_price, o.status_pay, o.payment_slip,
      oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name,
      oi.quantity, oi.price, oi.note, oi.specialRequest
     FROM orders o
     LEFT JOIN order_items oi ON o.order_id = oi.order_id
     LEFT JOIN menu m ON oi.menu_id = m.menu_id
     WHERE o.order_code IN (?)`,
    [receiptCodes]
  );

  // 3️⃣ รวม temp_receipts + orders
  const combinedRows = tempReceipts.map(tr => {
    const relatedOrders = ordersRows.filter(o => o.order_code === tr.temp_receipt_code);
    if (!relatedOrders.length) return { ...tr }; // ไม่มี order
    return relatedOrders.map(o => ({ ...tr, ...o }));
  }).flat();

  // 4️⃣ จัดกลุ่ม
  const groupedReceipts = groupReceipts(combinedRows);

  return Object.values(groupedReceipts);
}

// Route GET /all
router.get("/all", async (req, res) => {
  try {
    const groupedReceipts = await fetchGroupedReceipts();
    res.json(groupedReceipts);
  } catch (err) {
    console.error("ดึง temp_receipts ล้มเหลว:", err.message);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล", error: err.message });
  }
});

// Route POST /add-order หรือ route เพิ่ม/แก้ไข order ใด ๆ
// router.post("/update-order", async (req, res) => {
//   const io = req.app.get("io"); // ดึง io จาก server
//   try {
//     const { order_id, status, status_pay, payment_slip } = req.body;

//     await db.promise().query(
//       `UPDATE orders SET status=?, status_pay=?, payment_slip=? WHERE order_id=?`,
//       [status, status_pay, payment_slip, order_id]
//     );

//     const groupedReceipts = await fetchGroupedReceipts();

//     // ส่งทั้งชื่อเหตุการณ์เดิมและใหม่เพื่อความเข้ากันได้
//     io.emit("receiptsUpdated", groupedReceipts);
//     // หากทราบรหัสออเดอร์โค้ด สามารถเลือก emit เฉพาะใบเสร็จได้ แต่ที่นี่ส่งรวมไปก่อน
//     groupedReceipts.forEach((receipt) => io.emit("temp_receipt_updated", receipt));

//     res.json({ message: "อัปเดต order เรียบร้อย", data: groupedReceipts });
//   } catch (err) {
//     console.error("อัปเดต order ล้มเหลว:", err.message);
//     res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดต order", error: err.message });
//   }
// });

// (ลบ route ซ้ำที่ประกาศซ้ำด้านบนออก)

// router.get("/all", async (req, res) => {
//   try {
//     const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
//     const [receipts] = await db.promise().query(
//       `SELECT 
//         tr.temp_receipt_id, tr.temp_receipt_code, tr.temp_receipt_time, tr.table_number,
//         o.order_id, o.order_time, o.status, o.total_price, o.order_code, o.status_pay, o.payment_slip,
//         oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name, 
//         oi.quantity, oi.price, oi.note, oi.specialRequest
//       FROM temp_receipts tr 
//       LEFT JOIN orders o ON tr.temp_receipt_code = o.order_code 
//       LEFT JOIN order_items oi ON o.order_id = oi.order_id
//       LEFT JOIN menu m ON oi.menu_id = m.menu_id
//       WHERE DATE(tr.temp_receipt_time) = ?`,
//       [today]
//     );

//    const groupedReceipts = receipts.reduce((acc, row) => {
//   if (!acc[row.temp_receipt_code]) {
//     acc[row.temp_receipt_code] = {
//       temp_receipt_id: row.temp_receipt_id,
//       temp_receipt_code: row.temp_receipt_code,
//       table_number: row.table_number,
//       temp_receipt_time: row.temp_receipt_time,
//       orders: [],
//     };
//   }
//   if (row.order_id) {
//     let order = acc[row.temp_receipt_code].orders.find(o => o.order_id === row.order_id);
//     if (!order) {
//       order = {
//         order_id: row.order_id,
//         table_number: row.table_number,
//         order_time: row.order_time,
//         status: row.status,
//         total_price: parseFloat(row.total_price) || 0,
//         order_code: row.order_code,
//         status_pay: row.status_pay,
//         payment_slip: row.payment_slip,
//         items: [],
//       };
//       acc[row.temp_receipt_code].orders.push(order);
//     }
//     if (row.item_id) {
//       order.items.push({
//         item_id: row.item_id,
//         menu_id: row.menu_id,
//         menu_name: row.menu_name,
//         quantity: row.quantity,
//         price: parseFloat(row.price) || 0,
//         note: row.note || '',
//         specialRequest: row.specialRequest || '',
//       });
//     }
//   }
//   return acc;
// }, {});
// res.json(Object.values(groupedReceipts));

//   } catch (err) {
//     console.error("ดึง temp_receipts ล้มเหลว:", err.message);
//     res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล", error: err.message });
//   }
// });

// อัปเดตสถานะออเดอร์เดี่ยว
// // อัปเดตสถานะออเดอร์เดี่ยว
// router.put("/:orderId/status", async (req, res) => {
//   const { orderId } = req.params;
//   const { status } = req.body;

//   if (!status) {
//     return res.status(400).json({ message: "กรุณาระบุสถานะ" });
//   }

//   try {
//     // อัปเดตสถานะ
//     const [result] = await db.promise().query(
//       `UPDATE orders SET status = ? WHERE order_id = ?`,
//       [status, orderId]
//     );

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ message: "ไม่พบออเดอร์นี้" });
//     }

//     // ดึงข้อมูล order_code สำหรับ emit
//     const [orderInfoRows] = await db.promise().query(
//       `SELECT order_code FROM orders WHERE order_id = ?`,
//       [orderId]
//     );
//     const orderCode = orderInfoRows.length ? orderInfoRows[0].order_code : null;

//     // ถ้า status เป็น completed ให้ทำการย้ายไป pending_orders
//     if (status === "completed") {
//       const [orderRows] = await db.promise().query(
//         `SELECT order_code, table_number, order_time, status, total_price, status_pay, payment_slip 
//          FROM orders 
//          WHERE order_id = ?`,
//         [orderId]
//       );

//       if (orderRows.length === 0) {
//         return res.status(404).json({ message: "ไม่พบข้อมูลออเดอร์" });
//       }

//       const [pendingOrderInsertResult] = await db.promise().query(
//         `INSERT INTO pending_orders (order_code, table_number, order_time, status, total_price, status_pay, payment_slip)
//          VALUES (?, ?, ?, ?, ?, ?, ?)`,
//         [
//           orderRows[0].order_code,
//           orderRows[0].table_number,
//           orderRows[0].order_time,
//           orderRows[0].status,
//           orderRows[0].total_price,
//           orderRows[0].status_pay,
//           orderRows[0].payment_slip,
//         ]
//       );

//       const newPendingOrderId = pendingOrderInsertResult.insertId;

//       await db.promise().query(
//         `INSERT INTO pending_order_items (pending_order_id, menu_id, quantity, price, note, specialRequest)
//          SELECT ?, menu_id, quantity, price, note, specialRequest 
//          FROM order_items 
//          WHERE order_id = ?`,
//         [newPendingOrderId, orderId]
//       );

//       const [existingReceipt] = await db.promise().query(
//         `SELECT 1 FROM receipts WHERE receipt_code = ? LIMIT 1`,
//         [orderRows[0].order_code]
//       );

//       if (existingReceipt.length === 0) {
//         await db.promise().query(
//           `INSERT INTO receipts (receipt_code, receipt_order_id) VALUES (?, ?)`,
//           [orderRows[0].order_code, newPendingOrderId]
//         );
//       }
//     }

//     // ส่ง event ผ่าน socket
//     const io = req.app.get("io");
//     if (io && orderCode) {
//       io.emit("order_status_updated", { orderId: parseInt(orderId), status });

//       // ดึงข้อมูลใบเสร็จของ orderCode ที่อัปเดต แล้ว emit เพื่อให้ Client อัปเดตแบบเรียลไทม์
//       const [updatedReceipts] = await db.promise().query(
//         `SELECT 
//            tr.temp_receipt_id, tr.temp_receipt_code, tr.temp_receipt_time, tr.table_number,
//            o.order_id, o.order_time, o.status, o.total_price, o.order_code, o.status_pay, o.payment_slip,
//            oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name,
//            oi.quantity, oi.price, oi.note, oi.specialRequest
//          FROM temp_receipts tr
//          LEFT JOIN orders o ON tr.temp_receipt_code = o.order_code
//          LEFT JOIN order_items oi ON o.order_id = oi.order_id
//          LEFT JOIN menu m ON oi.menu_id = m.menu_id
//          WHERE tr.temp_receipt_code = ?`,
//         [orderCode]
//       );
//       const { groupReceipts } = require("./groupReceipts");
//       const grouped = groupReceipts(updatedReceipts);
//       const updatedReceiptData = Object.values(grouped)[0];
//       if (updatedReceiptData) {
//         // ส่งเข้าห้องของ orderCode และ broadcast ทั่วไปเพื่อความเข้ากันได้
//         io.to(orderCode).emit("temp_receipt_updated", updatedReceiptData);
//         io.emit("temp_receipt_updated", updatedReceiptData);
//       }

//       const { getTodayRevenue } = require("./getTodayRevenue");
//       const revenueData = await getTodayRevenue();
//       io.to(orderCode).emit("today_revenue_updated", revenueData);

//       const { getTodayCount } = require("./getTodayCount");
//       const count = await getTodayCount();
//       io.to(orderCode).emit("orderCountUpdated", { count });
//     }

//     res.json({ message: "อัปเดตสถานะสำเร็จ", orderId: parseInt(orderId), status });
//   } catch (err) {
//     console.error("อัปเดตสถานะล้มเหลว:", err.message);
//     res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ", error: err.message });
//   }
// });
router.put("/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ message: "กรุณาระบุสถานะ" });
  }

  try {
    // 1. อัปเดตสถานะใน DB
    const [result] = await db.promise().query(
      `UPDATE orders SET status = ? WHERE order_id = ?`,
      [status, orderId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "ไม่พบออเดอร์นี้" });
    }

    // 2. ดึง order_code สำหรับ emit
    const [orderInfoRows] = await db.promise().query(
      `SELECT order_code FROM orders WHERE order_id = ?`,
      [orderId]
    );
    const orderCode = orderInfoRows[0]?.order_code;

    // 3. ถ้า status เป็น completed ให้ย้ายไป pending_orders
    if (status === "completed") {
      const [orderRows] = await db.promise().query(
        `SELECT * FROM orders WHERE order_id = ?`,
        [orderId]
      );
      const orderData = orderRows[0];

      if (orderData) {
        const [pendingInsert] = await db.promise().query(
          `INSERT INTO pending_orders (order_code, table_number, order_time, status, total_price, status_pay, payment_slip)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            orderData.order_code,
            orderData.table_number,
            orderData.order_time,
            orderData.status,
            orderData.total_price,
            orderData.status_pay,
            orderData.payment_slip,
          ]
        );

        const newPendingOrderId = pendingInsert.insertId;

        await db.promise().query(
          `INSERT INTO pending_order_items (pending_order_id, menu_id, quantity, price, note, specialRequest)
           SELECT ?, menu_id, quantity, price, note, specialRequest
           FROM order_items WHERE order_id = ?`,
          [newPendingOrderId, orderId]
        );

        const [existingReceipt] = await db.promise().query(
          `SELECT 1 FROM receipts WHERE receipt_code = ? LIMIT 1`,
          [orderData.order_code]
        );

        if (existingReceipt.length === 0) {
          await db.promise().query(
            `INSERT INTO receipts (receipt_code, receipt_order_id) VALUES (?, ?)`,
            [orderData.order_code, newPendingOrderId]
          );
        }
      }
    }

    // 4. ส่ง event ผ่าน socket
    const io = req.app.get("io");
    if (io) {
      // อัปเดต status ของ order เฉพาะ
      io.emit("order_status_updated", { orderId: parseInt(orderId), status });

      // ดึงใบเสร็จอัปเดต และ emit
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
        [orderCode]
      );

      const { groupReceipts } = require("./groupReceipts");
      const grouped = groupReceipts(updatedReceipts);
      const updatedReceiptData = Object.values(grouped)[0];

      if (updatedReceiptData) {
        io.emit("temp_receipt_updated", updatedReceiptData); // broadcast ให้ทุก client
      }

      // 5. อัปเดตยอดรายวันและ count แบบ realtime
      const { getTodayRevenue } = require("./getTodayRevenue");
      const revenueData = await getTodayRevenue();
      io.emit("today_revenue_updated", revenueData);

      const { getTodayCount } = require("./getTodayCount");
      const count = await getTodayCount();
      io.emit("orderCountUpdated", { count }); // broadcast ให้ทุก client
    }

    res.json({ message: "อัปเดตสถานะสำเร็จ", orderId: parseInt(orderId), status });
  } catch (err) {
    console.error("อัปเดตสถานะล้มเหลว:", err.message);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ", error: err.message });
  }
});


// ดึงรายละเอียดออเดอร์เดี่ยว
router.get("/:orderId", async (req, res) => {
  const { orderId } = req.params;
  try {
    const [orderDetails] = await db.promise().query(
      `SELECT o.*, tr.temp_receipt_code, tr.temp_receipt_time, tr.table_number 
       FROM orders o 
       LEFT JOIN temp_receipts tr ON o.order_code = tr.temp_receipt_code 
       WHERE o.order_id = ?`,
      [orderId]
    );

    if (orderDetails.length === 0) {
      return res.status(404).json({ message: "ไม่พบออเดอร์นี้" });
    }

    const [items] = await db.promise().query(
      `SELECT oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name, 
       oi.quantity, oi.price, oi.note, oi.specialRequest 
       FROM order_items oi 
       LEFT JOIN menu m ON oi.menu_id = m.menu_id 
       WHERE oi.order_id = ?`,
      [orderId]
    );

    res.json({
      success: true,
      order: {
        ...orderDetails[0],
        total_price: parseFloat(orderDetails[0].total_price) || 0,
      },
      items: items.map(item => ({
        ...item,
        price: parseFloat(item.price) || 0,
        note: item.note || '',
        specialRequest: item.specialRequest || '',
      })),
      orderId: parseInt(orderId),
    });
  } catch (err) {
    console.error("ดึงออเดอร์ล้มเหลว:", err.message);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลออเดอร์", error: err.message });
  }
});


// อัปเดตสถานะทุกออเดอร์ใน temp_receipt_code เป็น completed
// router.put("/:tempReceiptCode/complete-all", async (req, res) => {
//   const { tempReceiptCode } = req.params;

//   try {
//     const [orders] = await db.promise().query(
//       `SELECT order_id, order_code, table_number, order_time, status, total_price, status_pay, payment_slip 
//        FROM orders 
//        WHERE order_code = ? AND status NOT IN ('completed', 'cancelled')`,
//       [tempReceiptCode]
//     );

//     if (orders.length === 0) {
//       return res.status(404).json({ message: "ไม่พบคำสั่งซื้อที่ยังไม่เสร็จสิ้น" });
//     }

//     const completedOrderIds = [];

//     await db.promise().beginTransaction();

//     try {
//       for (const order of orders) {
//         const [result] = await db.promise().query(
//           `UPDATE orders SET status = 'completed' WHERE order_id = ?`,
//           [order.order_id]
//         );

//         if (result.affectedRows > 0) {
//           completedOrderIds.push(order.order_id);

//           const [pendingOrderInsertResult] = await db.promise().query(
//             `INSERT INTO pending_orders (order_code, table_number, order_time, status, total_price, status_pay, payment_slip)
//              VALUES (?, ?, ?, ?, ?, ?, ?)`,
//             [
//               order.order_code,
//               order.table_number,
//               order.order_time,
//               'completed',
//               order.total_price,
//               order.status_pay,
//               order.payment_slip,
//             ]
//           );

//           const newPendingOrderId = pendingOrderInsertResult.insertId;

//           await db.promise().query(
//             `INSERT INTO pending_order_items (pending_order_id, menu_id, quantity, price, note, specialRequest)
//              SELECT ?, menu_id, quantity, price, note, specialRequest 
//              FROM order_items 
//              WHERE order_id = ?`,
//             [newPendingOrderId, order.order_id]
//           );

//           const [existingReceipt] = await db.promise().query(
//             `SELECT 1 FROM receipts WHERE receipt_code = ? LIMIT 1`,
//             [order.order_code]
//           );

//           if (existingReceipt.length === 0) {
//             await db.promise().query(
//               `INSERT INTO receipts (receipt_code, receipt_order_id) 
//                VALUES (?, ?)`,
//               [order.order_code, newPendingOrderId]
//             );
//           }
//         }
//       }

//       await db.promise().commit();

//       const io = req.app.get("io");
//       if (io) {
//         io.to(tempReceiptCode).emit("temp_receipt_updated", { temp_receipt_code: tempReceiptCode });
//         io.to(tempReceiptCode).emit("order_status_updated", { orderIds: completedOrderIds, status: "completed" });

//         const { getTodayRevenue } = require("./getTodayRevenue");
//         const revenueData = await getTodayRevenue();
//         io.to(tempReceiptCode).emit("today_revenue_updated", revenueData);

//         const { getTodayCount } = require("./getTodayCount");
//         const count = await getTodayCount();
//         io.to(tempReceiptCode).emit("orderCountUpdated", { count });
//       }

//       res.json({
//         message: "อัปเดตสถานะทุกออเดอร์เป็นเสร็จสิ้นเรียบร้อย",
//         temp_receipt_code: tempReceiptCode,
//         completedOrderIds,
//         success: true,
//       });
//     } catch (err) {
//       await db.promise().rollback();
//       throw err;
//     }
//   } catch (err) {
//     console.error("อัปเดตสถานะล้มเหลว:", err.message);
//     res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ", error: err.message });
//   }
// });
// อัปเดตสถานะทุกออเดอร์ใน temp_receipt_code เป็น completed
// router.put("/:tempReceiptCode/complete-all", async (req, res) => {
//   const { tempReceiptCode } = req.params;

//   try {
//     const [orders] = await db.promise().query(
//       `SELECT order_id, order_code, table_number, order_time, status, total_price, status_pay, payment_slip 
//        FROM orders 
//        WHERE order_code = ? AND status NOT IN ('completed', 'cancelled')`,
//       [tempReceiptCode]
//     );

//     if (orders.length === 0) {
//       return res.status(404).json({ message: "ไม่พบคำสั่งซื้อที่ยังไม่เสร็จสิ้น" });
//     }

//     const completedOrderIds = [];

//     await db.promise().beginTransaction();

//     try {
//       for (const order of orders) {
//         const [result] = await db.promise().query(
//           `UPDATE orders SET status = 'completed' WHERE order_id = ?`,
//           [order.order_id]
//         );

//         if (result.affectedRows > 0) {
//           completedOrderIds.push(order.order_id);

//           const [pendingOrderInsertResult] = await db.promise().query(
//             `INSERT INTO pending_orders (order_code, table_number, order_time, status, total_price, status_pay, payment_slip)
//              VALUES (?, ?, ?, ?, ?, ?, ?)`,
//             [
//               order.order_code,
//               order.table_number,
//               order.order_time,
//               'completed',
//               order.total_price,
//               order.status_pay,
//               order.payment_slip,
//             ]
//           );

//           const newPendingOrderId = pendingOrderInsertResult.insertId;

//           await db.promise().query(
//             `INSERT INTO pending_order_items (pending_order_id, menu_id, quantity, price, note, specialRequest)
//              SELECT ?, menu_id, quantity, price, note, specialRequest 
//              FROM order_items 
//              WHERE order_id = ?`,
//             [newPendingOrderId, order.order_id]
//           );

//           const [existingReceipt] = await db.promise().query(
//             `SELECT 1 FROM receipts WHERE receipt_code = ? LIMIT 1`,
//             [order.order_code]
//           );

//           if (existingReceipt.length === 0) {
//             await db.promise().query(
//               `INSERT INTO receipts (receipt_code, receipt_order_id) 
//                VALUES (?, ?)`,
//               [order.order_code, newPendingOrderId]
//             );
//           }
//         }
//       }

//       await db.promise().commit();

//       // --- ดึง temp_receipt แบบ grouped เหมือน /all ---
//       const [updatedReceipts] = await db.promise().query(
//         `SELECT 
//           tr.temp_receipt_id, tr.temp_receipt_code, tr.temp_receipt_time, tr.table_number,
//           o.order_id, o.order_time, o.status, o.total_price, o.order_code, o.status_pay, o.payment_slip,
//           oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name, 
//           oi.quantity, oi.price, oi.note, oi.specialRequest
//          FROM temp_receipts tr
//          LEFT JOIN orders o ON tr.temp_receipt_code = o.order_code
//          LEFT JOIN order_items oi ON o.order_id = oi.order_id
//          LEFT JOIN menu m ON oi.menu_id = m.menu_id
//          WHERE tr.temp_receipt_code = ?`,
//         [tempReceiptCode]
//       );

//       const groupedReceipts = updatedReceipts.reduce((acc, row) => {
//         if (!acc[row.temp_receipt_code]) {
//           acc[row.temp_receipt_code] = {
//             temp_receipt_id: row.temp_receipt_id,
//             temp_receipt_code: row.temp_receipt_code,
//             table_number: row.table_number,
//             temp_receipt_time: row.temp_receipt_time,
//             orders: [],
//           };
//         }
//         if (row.order_id) {
//           let order = acc[row.temp_receipt_code].orders.find(o => o.order_id === row.order_id);
//           if (!order) {
//             order = {
//               order_id: row.order_id,
//               table_number: row.table_number,
//               order_time: row.order_time,
//               status: row.status,
//               total_price: parseFloat(row.total_price) || 0,
//               order_code: row.order_code,
//               status_pay: row.status_pay,
//               payment_slip: row.payment_slip,
//               items: [],
//             };
//             acc[row.temp_receipt_code].orders.push(order);
//           }
//           if (row.item_id) {
//             order.items.push({
//               item_id: row.item_id,
//               menu_id: row.menu_id,
//               menu_name: row.menu_name,
//               quantity: row.quantity,
//               price: parseFloat(row.price) || 0,
//               note: row.note || '',
//               specialRequest: row.specialRequest || '',
//             });
//           }
//         }
//         return acc;
//       }, {});

//       // --- ส่ง event ผ่าน socket ---
//       const io = req.app.get("io");
//       if (io) {
//         io.emit("temp_receipt_updated", Object.values(groupedReceipts)[0]);
//         io.emit("order_status_updated", { orderIds: completedOrderIds, status: "completed" });

//         const { getTodayRevenue } = require("./getTodayRevenue");
//         const revenueData = await getTodayRevenue();
//         io.emit("today_revenue_updated", revenueData);

//         const { getTodayCount } = require("./getTodayCount");
//         const count = await getTodayCount();
//         io.emit("orderCountUpdated", { count });
//       }

//       res.json({
//         message: "อัปเดตสถานะทุกออเดอร์เป็นเสร็จสิ้นเรียบร้อย",
//         temp_receipt_code: tempReceiptCode,
//         completedOrderIds,
//         success: true,
//       });
//     } catch (err) {
//       await db.promise().rollback();
//       throw err;
//     }
//   } catch (err) {
//     console.error("อัปเดตสถานะล้มเหลว:", err.message);
//     res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ", error: err.message });
//   }
// });
router.put("/:tempReceiptCode/complete-all", async (req, res) => {
  const { tempReceiptCode } = req.params;

  try {
    // 1️⃣ ดึงคำสั่งซื้อที่ยังไม่เสร็จ
    const [orders] = await db.promise().query(
      `SELECT order_id, order_code, table_number, order_time, status, total_price, status_pay, payment_slip 
       FROM orders 
       WHERE order_code = ? AND status NOT IN ('completed', 'cancelled')`,
      [tempReceiptCode]
    );

    if (!orders.length) {
      return res.status(404).json({ message: "ไม่พบคำสั่งซื้อที่ยังไม่เสร็จสิ้น" });
    }

    const completedOrderIds = [];

    await db.promise().beginTransaction();

    try {
      for (const order of orders) {
        // อัปเดตสถานะ order เป็น completed
        const [result] = await db.promise().query(
          `UPDATE orders SET status = 'completed' WHERE order_id = ?`,
          [order.order_id]
        );

        if (result.affectedRows > 0) {
          completedOrderIds.push(order.order_id);

          // สร้าง pending_order + pending_order_items
          const [pendingOrderInsertResult] = await db.promise().query(
            `INSERT INTO pending_orders (order_code, table_number, order_time, status, total_price, status_pay, payment_slip)
             VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
            [order.order_code, order.table_number, order.order_time, order.total_price, order.status_pay, order.payment_slip]
          );
          const newPendingOrderId = pendingOrderInsertResult.insertId;

          await db.promise().query(
            `INSERT INTO pending_order_items (pending_order_id, menu_id, quantity, price, note, specialRequest)
             SELECT ?, menu_id, quantity, price, note, specialRequest
             FROM order_items
             WHERE order_id = ?`,
            [newPendingOrderId, order.order_id]
          );

          // สร้าง receipt หากยังไม่มี
          const [existingReceipt] = await db.promise().query(
            `SELECT 1 FROM receipts WHERE receipt_code = ? LIMIT 1`,
            [order.order_code]
          );
          if (!existingReceipt.length) {
            await db.promise().query(
              `INSERT INTO receipts (receipt_code, receipt_order_id)
               VALUES (?, ?)`,
              [order.order_code, newPendingOrderId]
            );
          }
        }
      }

      await db.promise().commit();

      // 2️⃣ ดึง temp_receipt + orders + items ครบ
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
        [tempReceiptCode]
      );

      // 3️⃣ จัดกลุ่มเหมือน /all
      const groupedReceipts = updatedReceipts.reduce((acc, row) => {
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
          let order = acc[row.temp_receipt_code].orders.find(o => o.order_id === row.order_id);
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
              note: row.note || '',
              specialRequest: row.specialRequest || '',
            });
          }
        }
        return acc;
      }, {});

      // 4️⃣ ส่ง event ผ่าน socket
      const io = req.app.get("io");
      if (io) {
        const receiptData = Object.values(groupedReceipts)[0];
        io.emit("temp_receipt_updated", receiptData);
        io.emit("order_status_updated", { orderIds: completedOrderIds, status: "completed" });

        const { getTodayRevenue } = require("./getTodayRevenue");
        const revenueData = await getTodayRevenue();
        io.emit("today_revenue_updated", revenueData);

        const { getTodayCount } = require("./getTodayCount");
        const count = await getTodayCount();
        io.emit("orderCountUpdated", { count });
      }

      res.json({
        message: "อัปเดตสถานะทุกออเดอร์เป็นเสร็จสิ้นเรียบร้อย",
        temp_receipt_code: tempReceiptCode,
        completedOrderIds,
        success: true,
      });
    } catch (err) {
      await db.promise().rollback();
      throw err;
    }
  } catch (err) {
    console.error("อัปเดตสถานะล้มเหลว:", err.message);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ", error: err.message });
  }
});
// router.put("/:tempReceiptCode/complete-all", async (req, res) => {
//   const { tempReceiptCode } = req.params;

//   try {
//     console.log("👉 [API] complete-all ถูกเรียก:", tempReceiptCode);

//     const [orders] = await db.promise().query(
//       `SELECT order_id, order_code, table_number, order_time, status, total_price, status_pay, payment_slip 
//        FROM orders 
//        WHERE order_code = ? AND status NOT IN ('completed', 'cancelled')`,
//       [tempReceiptCode]
//     );

//     console.log("📦 Orders ที่เจอ:", orders);

//     if (!orders.length) {
//       return res.status(404).json({ message: "ไม่พบคำสั่งซื้อที่ยังไม่เสร็จสิ้น" });
//     }

//     const completedOrderIds = [];

//     await db.promise().beginTransaction();

//     try {
//       for (const order of orders) {
//         console.log("🔄 กำลังอัปเดต order_id:", order.order_id);

//         const [result] = await db.promise().query(
//           `UPDATE orders SET status = 'completed' WHERE order_id = ?`,
//           [order.order_id]
//         );

//         if (result.affectedRows > 0) {
//           console.log("✅ อัปเดตสำเร็จ:", order.order_id);
//           completedOrderIds.push(order.order_id);

//           // insert pending_order
//           const [pendingOrderInsertResult] = await db.promise().query(
//             `INSERT INTO pending_orders (order_code, table_number, order_time, status, total_price, status_pay, payment_slip)
//              VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
//             [order.order_code, order.table_number, order.order_time, order.total_price, order.status_pay, order.payment_slip]
//           );
//           const newPendingOrderId = pendingOrderInsertResult.insertId;
//           console.log("➕ pending_orders id:", newPendingOrderId);

//           await db.promise().query(
//             `INSERT INTO pending_order_items (pending_order_id, menu_id, quantity, price, note, specialRequest)
//              SELECT ?, menu_id, quantity, price, note, specialRequest
//              FROM order_items
//              WHERE order_id = ?`,
//             [newPendingOrderId, order.order_id]
//           );
//           console.log("➕ pending_order_items copied for order:", order.order_id);

//           // สร้าง receipt หากยังไม่มี
//           const [existingReceipt] = await db.promise().query(
//             `SELECT 1 FROM receipts WHERE receipt_code = ? LIMIT 1`,
//             [order.order_code]
//           );
//           if (!existingReceipt.length) {
//             await db.promise().query(
//               `INSERT INTO receipts (receipt_code, receipt_order_id)
//                VALUES (?, ?)`,
//               [order.order_code, newPendingOrderId]
//             );
//             console.log("🧾 เพิ่ม receipts:", order.order_code);
//           }
//         }
//       }

//       await db.promise().commit();
//       console.log("🎉 Commit transaction เสร็จแล้ว");

//       // --- ดึง temp_receipt + orders + items ครบ
//       const [updatedReceipts] = await db.promise().query(
//         `SELECT 
//           tr.temp_receipt_id, tr.temp_receipt_code, tr.temp_receipt_time, tr.table_number,
//           o.order_id, o.order_time, o.status, o.total_price, o.order_code, o.status_pay, o.payment_slip,
//           oi.item_id, oi.menu_id, COALESCE(m.menu_name, 'ไม่พบชื่อเมนู') as menu_name,
//           oi.quantity, oi.price, oi.note, oi.specialRequest
//          FROM temp_receipts tr
//          LEFT JOIN orders o ON tr.temp_receipt_code = o.order_code
//          LEFT JOIN order_items oi ON o.order_id = oi.order_id
//          LEFT JOIN menu m ON oi.menu_id = m.menu_id
//          WHERE tr.temp_receipt_code = ?`,
//         [tempReceiptCode]
//       );

//       const { groupReceipts } = require("./groupReceipts");
//       const groupedReceipts = groupReceipts(updatedReceipts);
//       const updatedReceiptData = Object.values(groupedReceipts)[0];

//       // --- ส่ง event ผ่าน socket ---
//       const io = req.app.get("io");
//       if (io) {
//         console.log("📢 Emit temp_receipt_updated:", updatedReceiptData);
//         io.emit("temp_receipt_updated", updatedReceiptData);

//         console.log("📢 Emit order_status_updated:", completedOrderIds);
//         io.emit("order_status_updated", { orderIds: completedOrderIds, status: "completed" });

//         const { getTodayRevenue } = require("./getTodayRevenue");
//         const revenueData = await getTodayRevenue();
//         console.log("📢 Emit today_revenue_updated:", revenueData);
//         io.emit("today_revenue_updated", revenueData);

//         const { getTodayCount } = require("./getTodayCount");
//         const count = await getTodayCount();
//         console.log("📢 Emit orderCountUpdated:", count);
//         io.emit("orderCountUpdated", { count });
//       } else {
//         console.warn("⚠️ io ยังไม่ถูกเซ็ตใน app");
//       }

//       res.json({
//         message: "อัปเดตสถานะทุกออเดอร์เป็นเสร็จสิ้นเรียบร้อย",
//         temp_receipt_code: tempReceiptCode,
//         completedOrderIds,
//         success: true,
//       });
//     } catch (err) {
//       await db.promise().rollback();
//       throw err;
//     }
//   } catch (err) {
//     console.error("❌ อัปเดตสถานะล้มเหลว:", err.message);
//     res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ", error: err.message });
//   }
// });



// ยอดขายวันนี้


module.exports = router;