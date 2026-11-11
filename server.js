/**
 * ============================================================
 * 👑 TỔ CAM - LOCKET VIP & LOCKET GOLD SYSTEM
 * Backend Server chuẩn đầy đủ tính năng & lưu trữ orders.json
 * ============================================================
 */
 
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
 
require('dotenv').config();
 
const app = express();
const PORT = process.env.PORT || 3000;
 
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
 
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
 
function readJsonFile(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`[STORAGE] Lỗi đọc ${path.basename(filePath)}:`, err.message);
  }
  return fallback;
}
 
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[STORAGE] Lỗi ghi ${path.basename(filePath)}:`, err.message);
    return false;
  }
}
 
function loadOrders() {
  return readJsonFile(ORDERS_FILE, []);
}
 
function saveOrders(orders) {
  return writeJsonFile(ORDERS_FILE, orders);
}
 
function loadSettings() {
  const defaultSettings = {
    siteName: 'TỔ CAM — LOCKET VIP 👑',
    bankInfo: {
      bankId: 'MB',
      accountNumber: '0382864171',
      accountName: 'TRUONG PHU TRONG',
      memoPrefix: 'VIPCAM'
    },
    plans: {
      vip: [
        { id: 'VIP_1Y', code: 'VIP_1Y', name: 'Locket VIP Pro 1 Năm', price: 75000 },
        { id: 'VIP_2Y', code: 'VIP_2Y', name: 'Locket VIP Pro 2 Năm', price: 95000 },
        { id: 'VIP_VV', code: 'VIP_LIFETIME', name: 'Locket VIP Vĩnh Viễn', price: 150000 }
      ],
      regular: [
        { id: 'REG_TEST', code: 'TEST', name: 'Locket Gold Dùng Thử', price: 5000 },
        { id: 'REG_1Y', code: 'YEARLY', name: 'Locket Gold 1 Năm', price: 49000 }
      ]
    }
  };
  return readJsonFile(SETTINGS_FILE, defaultSettings);
}
 
function loadSessions() {
  return new Set(readJsonFile(SESSIONS_FILE, []));
}
 
function saveSessions(tokenSet) {
  return writeJsonFile(SESSIONS_FILE, [...tokenSet]);
}
 
const activeAdminTokens = loadSessions();
 
function cleanLocketUsername(str) {
  if (!str) return '';
  let u = String(str).toLowerCase().trim().replace(/^@/, '');
  if (u.includes('locket.cam/')) u = u.split('locket.cam/')[1].split(/[/?#]/)[0];
  return u.replace(/[^a-zA-Z0-9._-]/g, '');
}
 
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
 
app.use('/css', express.static(path.join(ROOT_DIR, 'css')));
app.use('/js', express.static(path.join(ROOT_DIR, 'js')));
app.use('/images', express.static(path.join(ROOT_DIR, 'images')));
 
app.get(['/', '/index.html', '/gold', '/gold.html'], (req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.get(['/admin', '/admin.html'], (req, res) => res.sendFile(path.join(ROOT_DIR, 'admin.html')));
 
function extractAdminToken(req) {
  const authHeader = req.headers['authorization'] || '';
  return authHeader.replace(/^Bearer\s+/i, '').trim() || req.headers['x-admin-token'] || '';
}
 
function requireAdmin(req, res, next) {
  const token = extractAdminToken(req);
  if (!token || !activeAdminTokens.has(token)) {
    return res.status(401).json({ ok: false, error: 'Chưa đăng nhập quản trị viên!' });
  }
  next();
}
 
// 1. Public config
app.get('/api/config/public', (req, res) => {
  const settings = loadSettings();
  res.json({ ok: true, data: settings });
});
 
// 2. Tra cứu username Locket
app.get('/api/user/lookup', (req, res) => {
  const username = cleanLocketUsername(req.query.username || req.query.user || '');
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp username Locket!' });
  }
 
  res.json({
    ok: true,
    found: true,
    status: 'success',
    data: {
      username: username,
      fullName: username,
      uid: 'uid_' + username,
      avatarUrl: null,
      hasGold: false,
      daysLeft: 0,
      gold: { has_gold: false, days_left: 0 }
    }
  });
});
 
// 3. Tạo đơn hàng mới
app.post('/api/order/create', (req, res) => {
  const { username: rawUser, planType, planId } = req.body || {};
  const username = cleanLocketUsername(rawUser);
  if (!username) return res.status(400).json({ ok: false, message: 'Thiếu username Locket!' });
 
  const settings = loadSettings();
  const bank = settings.bankInfo || {};
  const type = planType === 'vip' ? 'vip' : 'regular';
  const plansList = (settings.plans && settings.plans[type]) ? settings.plans[type] : [];
  const matchedPlan = plansList.find(p => p.id === planId || p.code === planId) || plansList[0];
  if (!matchedPlan) return res.status(400).json({ ok: false, message: 'Gói dịch vụ không hợp lệ!' });
 
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const memoPrefix = (bank.memoPrefix || 'VIPCAM').toUpperCase();
  const orderCode = `${memoPrefix}${randNum}`;
  const orderId = `ORD_${Date.now()}_${randNum}`;
  const amount = Number(matchedPlan.price) || 75000;
 
  const qrUrl = `https://img.vietqr.io/image/${bank.bankId || 'MB'}-${bank.accountNumber || '0382864171'}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(bank.accountName || 'TRUONG PHU TRONG')}`;
 
  const newOrder = {
    id: orderId,
    orderCode,
    username,
    planType: type,
    planId: matchedPlan.id,
    planName: matchedPlan.name,
    amount,
    status: 'PENDING',
    qrUrl,
    createdAt: new Date().toISOString()
  };
 
  const orders = loadOrders();
  orders.unshift(newOrder);
  saveOrders(orders.slice(0, 500));
 
  res.json({ ok: true, order: newOrder });
});
 
// 4. Kiểm tra trạng thái thanh toán
app.get('/check-payment', (req, res) => {
  const username = cleanLocketUsername(req.query.username || '');
  if (!username) return res.status(400).json({ error: 'Thiếu username' });
 
  const orders = loadOrders();
  const matched = orders.find(o => cleanLocketUsername(o.username) === username);
 
  if (matched && (matched.status === 'ACTIVATED' || matched.status === 'PAID')) {
    return res.json({
      paid: true,
      plan: matched.planCode || matched.planId,
      amount: matched.amount,
      username: matched.username,
      locketStatus: matched.status === 'ACTIVATED' ? 'success' : 'pending',
      mobileconfigUrl: '/profile?username=' + encodeURIComponent(username)
    });
  }
 
  res.json({ paid: false, username });
});
 
// 5. Admin API lấy danh sách đơn hàng
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = loadOrders();
  res.json({ ok: true, orders });
});
 
// 6. Admin cập nhật trạng thái đơn hàng
app.post('/api/admin/order/update-status', requireAdmin, (req, res) => {
  const { orderId, status } = req.body || {};
  const orders = loadOrders();
  const order = orders.find(o => o.id === orderId || o.orderCode === orderId);
  if (!order) return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn hàng!' });
 
  order.status = status;
  saveOrders(orders);
  res.json({ ok: true, message: 'Đã cập nhật trạng thái đơn hàng!', order });
});
 
// 7. Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const settings = loadSettings();
  const currentPass = process.env.ADMIN_PASSWORD || settings.adminPassword || 'admin123';
 
  if (!password || password !== currentPass) {
    return res.status(401).json({ ok: false, message: 'Mật khẩu quản trị viên không chính xác!' });
  }
 
  const token = 'adm_' + crypto.randomBytes(32).toString('hex');
  activeAdminTokens.add(token);
  saveSessions(activeAdminTokens);
  res.json({ ok: true, token, message: 'Đăng nhập thành công!' });
});
 
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại cổng ${PORT}`);
});
