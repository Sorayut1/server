const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// ผูก io เข้า express เพื่อใช้ใน req.app.get("io")
app.set('io', io);

// Middleware พื้นฐาน
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// เชื่อมต่อ Socket.IO
io.on('connection', (socket) => {
  console.log(`🟢 Client connected: ${socket.id}`);

  // ส่งจำนวนออเดอร์วันนี้เมื่อเชื่อมต่อ
  const { getTodayCount } = require('./routes/owner/getTodayCount');
  getTodayCount()
    .then((count) => {
      socket.emit('orderCountUpdated', { count });
    })
    .catch((err) => {
      console.error('ดึงจำนวนออเดอร์วันนี้ล้มเหลว:', err.message);
    });

  // จัดการ Socket.IO room สำหรับ order_code
  // รองรับทั้งชื่อเหตุการณ์แบบเก่าและใหม่
  const joinRoom = (order_code) => {
    if (order_code) {
      socket.join(order_code);
      console.log(`Client ${socket.id} joined room ${order_code}`);
    }
  };
  const leaveRoom = (order_code) => {
    if (order_code) {
      socket.leave(order_code);
      console.log(`Client ${socket.id} left room ${order_code}`);
    }
  };

  socket.on('joinOrder', joinRoom);
  socket.on('leaveOrder', leaveRoom);
  socket.on('join_room', joinRoom);
  socket.on('leave_room', leaveRoom);

  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
  });
});

// Routes
// Auth
app.use('/api/auth', require('./routes/auth/auth'));

// Owner Routes
app.use('/api/owner/menu-types', require('./routes/owner/manageCategory'));
app.use('/api/owner/menu', require('./routes/owner/manageMenu'));
app.use('/api/owner/tables', require('./routes/owner/manageTables'));
app.use('/api/owner/staff', require('./routes/owner/manageStaff'));
app.use('/api/owner/temp-receipts', require('./routes/owner/manageOrder'));

app.use('/api/owner/order-history', require('./routes/owner/orderHistory'));
app.use('/api/owner/order-sale', require('./routes/owner/manageSale'));
app.use('/api/owner/store', require('./routes/owner/store'));
app.use('/api/owner/profile', require('./routes/owner/manageProfileOwner'));

// Staff Routes
app.use('/api/staff/profile', require('./routes/staff/manageProfileStaff'));
app.use('/api/staff/orders', require('./routes/staff/staffManageOrder'));

// User Routes
app.use('/api/user/home', require('./routes/user/userHome'));
app.use('/api/user/order', require('./routes/user/userOrder'));
app.use('/api/user/check-table', require('./routes/user/checkTable'));
app.use('/api/user/order-list', require('./routes/user/userOrderList'));
app.use('/api/user/viewOrder-list', require('./routes/user/viewBill'));
app.use('/api/user/viewres', require('./routes/user/viewRes'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// เริ่ม Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server with WebSocket running at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Performing graceful shutdown...');
  server.close(() => {
    console.log('Server closed');
    db.end().then(() => {
      console.log('Database connection closed');
      process.exit(0);
    });
  });
});