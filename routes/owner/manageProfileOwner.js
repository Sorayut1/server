const express = require("express");
const router = express.Router();
const db = require("../../config/db");
const bcrypt = require("bcrypt");
const { verifyToken } = require("../../middleware/auth");

router.use(verifyToken); // ต้องเข้าสู่ระบบก่อนทุกเส้นทาง

// ดึงข้อมูลโปรไฟล์ตัวเอง
router.get("/", (req, res) => {
  const userId = req.user?.id;

  // ตรวจสอบว่า userId มีค่าหรือไม่
  if (!userId) {
    console.error("userId ไม่พบใน req.user");
    return res.status(401).json({ message: "ไม่พบข้อมูลผู้ใช้จาก token" });
  }

  const query = `
    SELECT id, first_name, last_name, username, phone_number, role, created_at, updated_at
    FROM users
    WHERE id = ?`;

  db.query(query, [userId], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        message: "เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
    if (results.length === 0) {
      console.error(`ไม่พบผู้ใช้ที่มี ID: ${userId}`);
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }
    console.log(`ดึงข้อมูลผู้ใช้สำเร็จ: ID ${userId}`);
    res.json(results[0]);
  });
});

// แก้ไขโปรไฟล์
router.put("/", async (req, res) => {
  const userId = req.user?.id;
  const { first_name, last_name, username, phone_number, password } = req.body;

  // ตรวจสอบว่า userId มีค่าหรือไม่
  if (!userId) {
    console.error("userId ไม่พบใน req.user");
    return res.status(401).json({ message: "ไม่พบข้อมูลผู้ใช้จาก token" });
  }

  // ตรวจสอบข้อมูลที่จำเป็น
  if (!first_name?.trim()) {
    return res.status(400).json({ message: "กรุณากรอกชื่อ" });
  }
  if (!last_name?.trim()) {
    return res.status(400).json({ message: "กรุณากรอกนามสกุล" });
  }
  if (!username?.trim()) {
    return res.status(400).json({ message: "กรุณากรอกชื่อผู้ใช้" });
  }
  if (!phone_number?.trim()) {
    return res.status(400).json({ message: "กรุณากรอกเบอร์โทร" });
  }

  // ตรวจสอบรูปแบบเบอร์โทร
  const phoneRegex = /^[0-9]{10}$/;
  if (!phoneRegex.test(phone_number)) {
    return res.status(400).json({ message: "เบอร์โทรต้องมี 10 หลักและเป็นตัวเลขเท่านั้น" });
  }

  // ตรวจสอบความยาวรหัสผ่าน (ถ้ามี)
  if (password && password.length < 6) {
    return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
  }

  try {
    // ตรวจสอบว่า username ซ้ำกับผู้ใช้อื่นหรือไม่
    const [usernameCheck] = await db
      .promise()
      .query("SELECT id FROM users WHERE username = ? AND id != ?", [username, userId]);
    if (usernameCheck.length > 0) {
      return res.status(400).json({ message: "ชื่อผู้ใช้นี้มีผู้ใช้งานแล้ว" });
    }

    // ตรวจสอบว่า phone_number ซ้ำกับผู้ใช้อื่นหรือไม่
    const [phoneCheck] = await db
      .promise()
      .query("SELECT id FROM users WHERE phone_number = ? AND id != ?", [
        phone_number,
        userId,
      ]);
    if (phoneCheck.length > 0) {
      return res.status(400).json({ message: "เบอร์โทรนี้มีผู้ใช้งานแล้ว" });
    }

    // เตรียมข้อมูลสำหรับอัปเดต
    let updateQuery =
      "UPDATE users SET first_name = ?, last_name = ?, username = ?, phone_number = ?, updated_at = NOW()";
    const values = [first_name, last_name, username, phone_number];

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery += ", password = ?";
      values.push(hashedPassword);
    }

    updateQuery += " WHERE id = ?";
    values.push(userId);

    // อัปเดตข้อมูล
    const [result] = await db.promise().query(updateQuery, values);
    if (result.affectedRows === 0) {
      console.error(`ไม่สามารถอัปเดตผู้ใช้ที่มี ID: ${userId}`);
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }

    console.log(`อัปเดตโปรไฟล์สำเร็จ: ID ${userId}`);
    res.json({ message: "อัปเดตโปรไฟล์เรียบร้อยแล้ว" });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;