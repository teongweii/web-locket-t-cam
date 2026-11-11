/**
 * ============================================================
 * 👑 TỔ CAM - LOCKET VIP & LOCKET GOLD SYSTEM
 * Backend Server tích hợp API Kawaii Locket CTV & Locket Cụ Cam
 * Tự động tạo mã QR VietQR Napas, Webhook Casso/SePay
 * Quản trị Admin Dashboard toàn diện
 * ============================================================
 */
 
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const plist = require('plist');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
 
require('dotenv').config();
 
const app = express();
const PORT = process.env.PORT || 3000;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
 
// Directories
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const CTV_USERS_FILE = path.join(DATA_DIR, 'ctv_users.json');
const CTV_CUSTOMERS_FILE = path.join(DATA_DIR, 'ctv_customers.json');
const CTV_DEPOSITS_FILE = path.join(DATA_DIR, 'ctv_deposits.json');
const SETTINGS_EXAMPLE_FILE = path.join(DATA_DIR, 'settings.example.json');
const DATABASE_URL = process.env.DATABASE_URL || '';
const databaseCache = new Map();
let databasePool = null;
 
// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
 
// Session persistence for Admin & CTV
function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
 
function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`[STORAGE] Lỗi đọc ${path.basename(filePath)}:`, err.message);
  }
  return undefined;
}
 
function loadCollection(name, filePath, fallbackValue, exampleFile = null) {
  if (DATABASE_URL) {
    return cloneJson(databaseCache.has(name) ? databaseCache.get(name) : fallbackValue);
  }
 
  const localValue = readJsonFile(filePath);
  if (localValue !== undefined) return localValue;
 
  if (exampleFile) {
    const exampleValue = readJsonFile(exampleFile);
    if (exampleValue !== undefined) {
      try {
        fs.copyFileSync(exampleFile, filePath);
      } catch (err) {
        console.error('[SETTINGS] Lỗi tạo settings.json:', err.message);
      }
      return exampleValue;
    }
  }
 
  return cloneJson(fallbackValue);
}
 
function saveCollection(name, filePath, value, logLabel) {
  const safeValue = cloneJson(value);
  if (DATABASE_URL) {
    if (!databasePool) {
      console.error(`[${logLabel}] Database chưa khởi tạo; không thể lưu dữ liệu.`);
      return Promise.resolve(false);
    }
 
    return databasePool.query(
      `INSERT INTO app_data (collection_name, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (collection_name) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [name, JSON.stringify(safeValue)]
    ).then(() => {
      databaseCache.set(name, safeValue);
      return true;
    }).catch(err => {
      console.error(`[${logLabel}] Lỗi ghi PostgreSQL:`, err.message);
      return false;
    });
  }
 
  try {
    fs.writeFileSync(filePath, JSON.stringify(safeValue, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[${logLabel}] Lỗi ghi ${path.basename(filePath)}:`, err.message);
    return false;
  }
}
 
function loadSessions() {
  return new Set(loadCollection('sessions', SESSIONS_FILE, []));
}
 
function saveSessions(tokenSet) {
  return saveCollection('sessions', SESSIONS_FILE, [...tokenSet], 'SESSIONS');
}
 
const activeAdminTokens = loadSessions();
const activeCtvTokens = new Map();
 
const DEFAULT_KAWAII_FRAMES = [
  {
    id: 'frame_kawaii_01',
    name: 'Bé Mèo, Gấu Nâu, Panda & Cầu Vồng Pastel 🎀',
    url: '/images/frames_kawaii/frame_kawaii_01_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:00.000Z'
  }
];
 
const DEFAULT_COUPONS = [
  {
    id: 'coup_vipcam20',
    code: 'VIPCAM20',
    name: 'Giảm 20.000đ Gói Locket VIP',
    type: 'fixed',
    value: 20000,
    minOrder: 50000,
    applicablePlans: 'vip',
    usageLimit: 500,
    usedCount: 0,
    isActive: true,
    createdAt: new Date().toISOString()
  }
];
 
function evaluateCoupon({ code, planType, planId, originalPrice }, settings = loadSettings()) {
  const coupons = settings.coupons || [];
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) return { ok: false, message: 'Vui lòng nhập mã giảm giá!' };
 
  const coupon = coupons.find(c => String(c.code).trim().toUpperCase() === cleanCode);
  if (!coupon || !coupon.isActive) return { ok: false, message: `Mã giảm giá "${cleanCode}" không tồn tại hoặc đã hết hiệu lực!` };
 
  const price = Number(originalPrice) || 0;
  const minOrder = Number(coupon.minOrder) || 0;
  if (minOrder > 0 && price < minOrder) {
    return { ok: false, message: `Đơn hàng tối thiểu phải từ ${minOrder.toLocaleString('vi-VN')}đ để sử dụng mã này!` };
  }
 
  let discountAmount = coupon.type === 'percent' ? Math.round((price * coupon.value) / 100) : coupon.value;
  if (discountAmount > price) discountAmount = price;
  const finalPrice = Math.max(1000, price - discountAmount);
 
  return {
    ok: true,
    coupon: {
      code: coupon.code,
      name: coupon.name,
      discountAmount,
      finalPrice,
      originalPrice: price
    }
  };
}
 
function loadSettings() {
  const settings = loadCollection('settings', SETTINGS_FILE, {}, SETTINGS_EXAMPLE_FILE);
  if (!Array.isArray(settings.customFrames) || settings.customFrames.length === 0) {
    settings.customFrames = [...DEFAULT_KAWAII_FRAMES];
  }
  if (!Array.isArray(settings.coupons) || settings.coupons.length === 0) {
    settings.coupons = [...DEFAULT_COUPONS];
  }
  return settings;
}
 
function saveSettings(settings) {
  return saveCollection('settings', SETTINGS_FILE, settings, 'SETTINGS');
}
 
const ORDER_EXPIRATION_MS = 3 * 60 * 1000;
 
function autoExpirePendingOrders(orders) {
  if (!Array.isArray(orders)) return false;
  const now = Date.now();
  let changed = false;
  for (const o of orders) {
    if (o && o.status === 'PENDING') {
      const createdTime = new Date(o.createdAt || Date.now()).getTime();
      const expiryTime = o.expiresAt ? new Date(o.expiresAt).getTime() : (createdTime + ORDER_EXPIRATION_MS);
      if (now >= expiryTime) {
        o.status = 'CANCELLED';
        o.cancelReason = 'Đơn hết hạn sau 3 phút chưa thanh toán';
        changed = true;
      }
    }
  }
  return changed;
}
 
function loadOrders() {
  const orders = loadCollection('orders', ORDERS_FILE, []);
  if (autoExpirePendingOrders(orders)) {
    saveCollection('orders', ORDERS_FILE, orders, 'ORDERS');
  }
  return orders;
}
 
function saveOrders(orders) {
  return saveCollection('orders', ORDERS_FILE, orders, 'ORDERS');
}
 
function loadCtvUsers() { return loadCollection('ctv_users', CTV_USERS_FILE, []); }
function saveCtvUsers(users) { return saveCollection('ctv_users', CTV_USERS_FILE, users, 'CTV'); }
function loadCtvCustomers() { return loadCollection('ctv_customers', CTV_CUSTOMERS_FILE, []); }
function saveCtvCustomers(custs) { return saveCollection('ctv_customers', CTV_CUSTOMERS_FILE, custs, 'CTV CUSTOMERS'); }
function loadCtvDeposits() { return loadCollection('ctv_deposits', CTV_DEPOSITS_FILE, []); }
function saveCtvDeposits(deps) { return saveCollection('ctv_deposits', CTV_DEPOSITS_FILE, deps, 'CTV DEPOSITS'); }
 
function cleanLocketUsername(str) {
  if (!str) return '';
  let u = String(str).toLowerCase().trim().replace(/^@/, '');
  if (u.includes('locket.cam/')) u = u.split('locket.cam/')[1].split(/[/?#]/)[0];
  return u.replace(/[^a-zA-Z0-9._-]/g, '');
}
 
function normalizePaymentText(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
 
function getConfiguredDnsUrl(username, configuredLink, fallbackLink) {
  const cleanUser = cleanLocketUsername(username);
  const linkTemplate = String(configuredLink || fallbackLink || '').trim();
  if (!linkTemplate) return fallbackLink || '';
  if (linkTemplate.includes('{username}')) return linkTemplate.replace(/\{username\}/gi, encodeURIComponent(cleanUser));
  return linkTemplate;
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
 
// Public config
app.get('/api/config/public', (req, res) => {
  const settings = loadSettings();
  res.json({
    ok: true,
    data: {
      siteName: settings.siteName || 'TỔ CAM — LOCKET VIP 👑',
      bankInfo: settings.bankInfo || {
        bankId: 'MB',
        accountNumber: '0382864171',
        accountName: 'TRUONG PHU TRONG',
        memoPrefix: 'VIPCAM'
      },
      plans: settings.plans || { regular: [], vip: [] }
    }
  });
});
 
// Tạo đơn hàng
app.post('/api/order/create', async (req, res) => {
  const { username: rawUser, planType, planId, couponCode } = req.body || {};
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
  const originalPrice = Number(matchedPlan.price) || 75000;
  let finalAmount = originalPrice;
 
  if (couponCode) {
    const coupCheck = evaluateCoupon({ code: couponCode, originalPrice }, settings);
    if (coupCheck.ok) finalAmount = coupCheck.coupon.finalPrice;
  }
 
  const qrUrl = `https://img.vietqr.io/image/${bank.bankId || 'MB'}-${bank.accountNumber || '0382864171'}-compact2.png?amount=${finalAmount}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(bank.accountName || 'TRUONG PHU TRONG')}`;
 
  const newOrder = {
    id: orderId,
    orderCode,
    username,
    planType: type,
    planId: matchedPlan.id,
    planName: matchedPlan.name,
    amount: finalAmount,
    status: 'PENDING',
    qrUrl,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ORDER_EXPIRATION_MS).toISOString()
  };
 
  const orders = loadOrders();
  orders.unshift(newOrder);
  await saveOrders(orders.slice(0, 500));
  res.json({ ok: true, order: newOrder });
});
 
// Lấy danh sách đơn hàng cho Admin
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = loadOrders();
  res.json({ ok: true, orders });
});
 
// Duyệt đơn hàng / Cập nhật trạng thái
app.post('/api/admin/order/update-status', requireAdmin, async (req, res) => {
  const { orderId, status } = req.body || {};
  const orders = loadOrders();
  const order = orders.find(o => o.id === orderId || o.orderCode === orderId);
  if (!order) return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn hàng!' });
 
  order.status = status;
  await saveOrders(orders);
  res.json({ ok: true, message: 'Đã cập nhật trạng thái đơn hàng!', order });
});
 
// Admin Login
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body || {};
  const settings = loadSettings();
  const currentPass = process.env.ADMIN_PASSWORD || settings.adminPassword || 'admin123';
 
  if (!password || password !== currentPass) {
    return res.status(401).json({ ok: false, message: 'Mật khẩu quản trị viên không chính xác!' });
  }
 
  const token = 'adm_' + crypto.randomBytes(32).toString('hex');
  activeAdminTokens.add(token);
  await saveSessions(activeAdminTokens);
  res.json({ ok: true, token, message: 'Đăng nhập thành công!' });
});
 
async function startServer() {
  app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
  });
}
 
startServer();
