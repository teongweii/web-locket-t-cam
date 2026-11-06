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
const activeCtvTokens = new Map(); // token -> ctvUsername
 
// ============================================================
// DATA STORAGE HELPERS
// ============================================================
// 7 Mẫu Khung Kawaii Mới Trích Xuất Từ PDF
const DEFAULT_KAWAII_FRAMES = [
  {
    id: 'frame_kawaii_01',
    name: 'Bé Mèo, Gấu Nâu, Panda & Cầu Vồng Pastel 🎀',
    url: '/images/frames_kawaii/frame_kawaii_01_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:00.000Z'
  },
  {
    id: 'frame_kawaii_02',
    name: 'Thỏ Con, Gấu Nâu Nơ Xanh & Trà Sữa 🧸',
    url: '/images/frames_kawaii/frame_kawaii_02_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:01.000Z'
  },
  {
    id: 'frame_kawaii_03',
    name: 'Shin-chan & Siêu Nhân Hành Động Action Mask 🦸',
    url: '/images/frames_kawaii/frame_kawaii_03_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:02.000Z'
  },
  {
    id: 'frame_kawaii_04',
    name: 'Hoa Anh Đào Sakura, Thỏ & Mèo Cổng Torii 🌸',
    url: '/images/frames_kawaii/frame_kawaii_04_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:03.000Z'
  },
  {
    id: 'frame_kawaii_05',
    name: 'Shin-chan Ngày Nghỉ & Khủng Long Xanh 💤',
    url: '/images/frames_kawaii/frame_kawaii_05_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:04.000Z'
  },
  {
    id: 'frame_kawaii_06',
    name: 'Thế Giới Kawaii Giấc Mơ Xanh Thỏ & Gấu ☁️',
    url: '/images/frames_kawaii/frame_kawaii_06_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:05.000Z'
  },
  {
    id: 'frame_kawaii_07',
    name: 'Cún Corgi, Panda & Bé Khủng Long Nơ Hồng 🐶',
    url: '/images/frames_kawaii/frame_kawaii_07_trans.png',
    isVip: true,
    createdAt: '2026-11-05T01:20:06.000Z'
  }
];
 
// Danh sách mã giảm giá mặc định cho Locket VIP & Gold
const DEFAULT_COUPONS = [
  {
    id: 'coup_vipcam20',
    code: 'VIPCAM20',
    name: 'Giảm 20.000đ Gói Locket VIP',
    type: 'fixed', // 'fixed' (VNĐ) | 'percent' (%)
    value: 20000,
    maxDiscount: 0,
    minOrder: 50000,
    applicablePlans: 'vip', // 'all' | 'vip' | 'regular' | specific plan id
    usageLimit: 500,
    usedCount: 0,
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'coup_chaoban10',
    code: 'CHAOBAN10',
    name: 'Chào Bạn Mới - Giảm 10%',
    type: 'percent',
    value: 10,
    maxDiscount: 25000,
    minOrder: 50000,
    applicablePlans: 'all',
    usageLimit: 500,
    usedCount: 0,
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'coup_gold5k',
    code: 'GOLD5K',
    name: 'Khuyến Mãi Locket Gold Thường -5k',
    type: 'fixed',
    value: 5000,
    maxDiscount: 0,
    minOrder: 30000,
    applicablePlans: 'regular',
    usageLimit: 300,
    usedCount: 0,
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    isActive: true,
    createdAt: new Date().toISOString()
  }
];
 
function evaluateCoupon({ code, planType, planId, originalPrice }, settings = loadSettings()) {
  const coupons = settings.coupons || [];
  const cleanCode = String(code || '').trim().toUpperCase();
 
  if (!cleanCode) {
    return { ok: false, message: 'Vui lòng nhập mã giảm giá!' };
  }
 
  const coupon = coupons.find(c => String(c.code).trim().toUpperCase() === cleanCode);
  if (!coupon) {
    return { ok: false, message: `Mã giảm giá "${cleanCode}" không tồn tại hoặc đã hết hiệu lực!` };
  }
 
  if (!coupon.isActive) {
    return { ok: false, message: `Mã giảm giá "${cleanCode}" hiện đang tạm dừng!` };
  }
 
  // Kiểm tra hạn sử dụng
  const now = new Date();
  if (coupon.startDate) {
    const sDate = new Date(coupon.startDate);
    if (!isNaN(sDate.getTime()) && now < sDate) {
      return { ok: false, message: `Mã giảm giá "${cleanCode}" chưa đến ngày kích hoạt!` };
    }
  }
  if (coupon.endDate) {
    const eDate = new Date(coupon.endDate);
    if (!isNaN(eDate.getTime())) {
      eDate.setHours(23, 59, 59, 999);
      if (now > eDate) {
        return { ok: false, message: `Mã giảm giá "${cleanCode}" đã hết hạn sử dụng!` };
      }
    }
  }
 
  // Kiểm tra giới hạn số lượt sử dụng
  const limit = Number(coupon.usageLimit) || 0;
  const used = Number(coupon.usedCount) || 0;
  if (limit > 0 && used >= limit) {
    return { ok: false, message: `Mã giảm giá "${cleanCode}" đã hết lượt sử dụng!` };
  }
 
  // Kiểm tra giá trị đơn tối thiểu
  const price = Number(originalPrice) || 0;
  const minOrder = Number(coupon.minOrder) || 0;
  if (minOrder > 0 && price < minOrder) {
    return {
      ok: false,
      message: `Đơn hàng tối thiểu phải từ ${minOrder.toLocaleString('vi-VN')}đ để sử dụng mã này!`
    };
  }
 
  // Kiểm tra gói dịch vụ áp dụng
  const app = coupon.applicablePlans || 'all';
  if (app === 'vip' && planType !== 'vip') {
    return { ok: false, message: 'Mã giảm giá này chỉ áp dụng cho các gói Locket VIP!' };
  }
  if (app === 'regular' && planType !== 'regular') {
    return { ok: false, message: 'Mã giảm giá này chỉ áp dụng cho các gói Locket Gold Thường!' };
  }
  if (app !== 'all' && app !== 'vip' && app !== 'regular') {
    if (planId && app !== planId) {
      return { ok: false, message: 'Mã giảm giá này không áp dụng cho gói đã chọn!' };
    }
  }
 
  // Tính số tiền giảm giá
  let discountAmount = 0;
  const val = Number(coupon.value) || 0;
  if (coupon.type === 'percent') {
    discountAmount = Math.round((price * val) / 100);
    const maxCap = Number(coupon.maxDiscount) || 0;
    if (maxCap > 0 && discountAmount > maxCap) {
      discountAmount = maxCap;
    }
  } else {
    discountAmount = val;
  }
 
  if (discountAmount > price) {
    discountAmount = price;
  }
 
  // Tối thiểu thanh toán 1,000 VND
  const finalPrice = Math.max(1000, price - discountAmount);
 
  return {
    ok: true,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      name: coupon.name,
      type: coupon.type,
      value: coupon.value,
      discountAmount: discountAmount,
      finalPrice: finalPrice,
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
 
// Thời gian hiệu lực của đơn hàng chờ thanh toán: đúng 3 phút
const ORDER_EXPIRATION_MS = 3 * 60 * 1000;
 
function autoExpirePendingOrders(orders) {
  if (!Array.isArray(orders)) return false;
  const now = Date.now();
  let changed = false;
 
  for (const o of orders) {
    if (o && o.status === 'PENDING') {
      const createdTime = new Date(o.createdAt || Date.now()).getTime();
      const expiryTime = o.expiresAt ? new Date(o.expiresAt).getTime() : (createdTime + ORDER_EXPIRATION_MS);
 
      // Quá 3 phút mà chưa thanh toán -> CANCELLED
      if (now >= expiryTime) {
        o.status = 'CANCELLED';
        o.cancelReason = o.cancelReason || 'Đơn hết hạn sau 3 phút chưa thanh toán (tự động đóng)';
        o.expiredAt = new Date().toISOString();
        changed = true;
      }
    }
  }
 
  return changed;
}
 
function loadOrders() {
  const orders = loadCollection('orders', ORDERS_FILE, []);
  let changed = autoExpirePendingOrders(orders);
 
 
  if (changed) {
    saveCollection('orders', ORDERS_FILE, orders, 'ORDERS');
  }
  return orders;
}
 
function saveOrders(orders) {
  return saveCollection('orders', ORDERS_FILE, orders, 'ORDERS');
}
 
function ensureDefaultCtvAccounts(users, settings = loadSettings()) {
  if (!Array.isArray(users)) return false;
  let changed = false;
 
  // 1. Tài khoản CTV tocam_ctv (bỏ qua bước nạp 150k, kích hoạt sẵn, có sẵn 100 coin)
  if (!settings._deleted_tocam_ctv && !users.some(u => u && String(u.username).toLowerCase() === 'tocam_ctv')) {
    users.push({
      username: 'tocam_ctv',
      password: 'Tocam123456',
      fullName: 'Tổ Cam VIP CTV',
      phone: '',
      email: 'ctv@tocams.xyz',
      balance: 100000,
      coins: 100,
      status: 'ACTIVE',
      firstDepositDone: true,
      createdAt: new Date().toISOString()
    });
    changed = true;
  }
 
  // 2. Tài khoản CTV xuandieu09
  if (!settings._deleted_xuandieu09 && !users.some(u => u && String(u.username).toLowerCase() === 'xuandieu09')) {
    users.push({
      username: 'xuandieu09',
      password: 'xuandieu123',
      fullName: 'xuandieu09',
      phone: '',
      email: 'xuandieu09@gmail.com',
      balance: 0,
      coins: 0,
      status: 'ACTIVE',
      firstDepositDone: true,
      createdAt: '2026-11-05T03:30:00.000Z'
    });
    changed = true;
  }
 
  return changed;
}
 
function loadCtvUsers() {
  const users = loadCollection('ctv_users', CTV_USERS_FILE, []);
  const now = Date.now();
  const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
  let changed = false;
  const validUsers = users.filter(u => {
    if ((u.status === 'PENDING_ACTIVATION' || u.firstDepositDone === false) && (u.balance || 0) === 0 && u.createdAt) {
      const age = now - new Date(u.createdAt).getTime();
      if (age > FORTY_EIGHT_HOURS) {
        console.log(`[CTV PURGE] 🗑️ Đã tự động xóa vĩnh viễn tài khoản CTV quá 48h chưa kích hoạt: @${u.username} (${u.email})`);
        changed = true;
        return false;
      }
    }
    return true;
  });
  if (ensureDefaultCtvAccounts(validUsers)) {
    changed = true;
  }
  if (changed) {
    saveCtvUsers(validUsers).catch(e => console.error('Lỗi lưu sau khi dọn dẹp CTV hết hạn:', e));
  }
  return validUsers;
}
 
function saveCtvUsers(users) {
  return saveCollection('ctv_users', CTV_USERS_FILE, users, 'CTV');
}
 
function loadCtvCustomers() {
  return loadCollection('ctv_customers', CTV_CUSTOMERS_FILE, []);
}
 
function saveCtvCustomers(custs) {
  return saveCollection('ctv_customers', CTV_CUSTOMERS_FILE, custs, 'CTV CUSTOMERS');
}
 
function loadCtvDeposits() {
  return loadCollection('ctv_deposits', CTV_DEPOSITS_FILE, []);
}
 
function saveCtvDeposits(deps) {
  return saveCollection('ctv_deposits', CTV_DEPOSITS_FILE, deps, 'CTV DEPOSITS');
}
 
function loadUsers() {
  return loadCollection('users', USERS_FILE, {});
}
 
function saveUsers(users) {
  return saveCollection('users', USERS_FILE, users, 'USERS');
}
 
async function initializeDatabase() {
  if (!DATABASE_URL) return;
 
  const { Pool } = require('pg');
  const connectionHost = new URL(DATABASE_URL).hostname;
  const isLocalDatabase = ['localhost', '127.0.0.1'].includes(connectionHost);
  databasePool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' || isLocalDatabase
      ? false
      : { rejectUnauthorized: false }
  });
 
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      collection_name TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
 
  const { rows } = await databasePool.query('SELECT collection_name, payload FROM app_data');
  for (const row of rows) databaseCache.set(row.collection_name, row.payload);
 
  const collections = [
    { name: 'settings', file: SETTINGS_FILE, fallback: {}, example: SETTINGS_EXAMPLE_FILE },
    { name: 'orders', file: ORDERS_FILE, fallback: [] },
    { name: 'users', file: USERS_FILE, fallback: {} },
    { name: 'sessions', file: SESSIONS_FILE, fallback: [] },
    { name: 'ctv_users', file: CTV_USERS_FILE, fallback: [] },
    { name: 'ctv_customers', file: CTV_CUSTOMERS_FILE, fallback: [] },
    { name: 'ctv_deposits', file: CTV_DEPOSITS_FILE, fallback: [] }
  ];
 
  for (const collection of collections) {
    if (databaseCache.has(collection.name)) continue;
 
    let value = readJsonFile(collection.file);
    if (value === undefined && collection.example) value = readJsonFile(collection.example);
    if (value === undefined) value = collection.fallback;
 
    await databasePool.query(
      'INSERT INTO app_data (collection_name, payload) VALUES ($1, $2::jsonb) ON CONFLICT (collection_name) DO NOTHING',
      [collection.name, JSON.stringify(value)]
    );
    databaseCache.set(collection.name, cloneJson(value));
  }
 
  for (const token of loadSessions()) activeAdminTokens.add(token);
  console.log('[DATABASE] PostgreSQL đã kết nối; dữ liệu JSON local được nạp nếu collection còn trống.');
 
  // Tự động khôi phục và đảm bảo các tài khoản CTV mặc định (tocam_ctv, xuandieu09) trong PostgreSQL
  try {
    const ctvData = databaseCache.get('ctv_users');
    let ctvList = Array.isArray(ctvData) ? ctvData : [];
    const settingsData = databaseCache.get('settings') || {};
    if (ensureDefaultCtvAccounts(ctvList, settingsData)) {
      databaseCache.set('ctv_users', ctvList);
      await databasePool.query(
        'INSERT INTO app_data (collection_name, payload, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (collection_name) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()',
        ['ctv_users', JSON.stringify(ctvList)]
      );
      console.log('[DATABASE] ✅ Đã cập nhật các tài khoản CTV mặc định (@tocam_ctv, @xuandieu09) vào PostgreSQL!');
    }
  } catch (recErr) {
    console.error('[DATABASE] Lỗi cập nhật CTV mặc định:', recErr);
  }
}
 
// Clean username helper
function cleanLocketUsername(str) {
  if (!str) return '';
  let u = String(str).toLowerCase().trim().replace(/^@/, '');
  if (u.includes('locket.cam/')) {
    u = u.split('locket.cam/')[1].split(/[/?#]/)[0];
  } else if (u.includes('locket.camera/')) {
    u = u.split('locket.camera/')[1].split(/[/?#]/)[0];
  }
  return u.replace(/[^a-zA-Z0-9._-]/g, '');
}
 
function normalizePaymentText(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
 
function getConfiguredDnsUrl(username, configuredLink, fallbackLink) {
  const cleanUser = cleanLocketUsername(username);
  const encodedUsername = encodeURIComponent(cleanUser);
  const linkTemplate = String(configuredLink || fallbackLink || '').trim();
  if (!linkTemplate) return fallbackLink || '';
 
  // 1. Nếu có chứa {username} -> thay thế chính xác username vào URL template
  if (linkTemplate.includes('{username}')) {
    return linkTemplate.replace(/\{username\}/gi, encodedUsername);
  }
 
  // 2. Nếu là link profile/cai-dns cố định, file .mobileconfig hoặc có query params -> giữ nguyên, không ghi đè path
  const lower = linkTemplate.toLowerCase();
  if (lower.endsWith('.mobileconfig') || lower.includes('/cai-dns') || lower.includes('/api/public/dns') || lower.includes('?')) {
    return linkTemplate;
  }
 
  // 3. Nếu là link dạng host/ hoặc host/dns (dành cho Cụ Cam DoH) -> thêm username vào cuối
  try {
    const configuredUrl = new URL(linkTemplate);
    const pathParts = configuredUrl.pathname.split('/').filter(Boolean);
    const finalPart = pathParts[pathParts.length - 1]?.toLowerCase();
 
    if (pathParts.length === 0 || configuredUrl.pathname.endsWith('/') || finalPart === 'dns') {
      if (finalPart === 'dns') pathParts.pop();
      pathParts.push(encodedUsername);
      configuredUrl.pathname = `/${pathParts.join('/')}`;
      return configuredUrl.toString();
    }
 
    return configuredUrl.toString();
  } catch (err) {
    return linkTemplate;
  }
}
 
function getRegularDnsUrl(username, settings = loadSettings()) {
  return getConfiguredDnsUrl(username, settings.dnsLinkRegular, '/profile?username={username}');
}
 
function personalizeMobileConfig(buffer, username) {
  const cleanUsername = cleanLocketUsername(username);
  if (!cleanUsername) return buffer;
 
  const source = buffer.toString('utf8').trimStart();
  if (!source.startsWith('<?xml') && !source.startsWith('<plist')) return buffer;
 
  try {
    const profile = plist.parse(source);
    if (!profile || typeof profile !== 'object' || profile.PayloadSignature) return buffer;
 
    const displayName = `LocketGold - ${cleanUsername}`;
    profile.PayloadDisplayName = displayName;
    if (typeof profile.PayloadDescription === 'string' && /locketgold/i.test(profile.PayloadDescription)) {
      profile.PayloadDescription = displayName;
    }
 
    const updatePayloadNames = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(updatePayloadNames);
        return;
      }
 
      if (typeof value.PayloadDisplayName === 'string' && /locketgold/i.test(value.PayloadDisplayName)) {
        value.PayloadDisplayName = displayName;
      }
      if (typeof value.PayloadDescription === 'string' && /locketgold/i.test(value.PayloadDescription)) {
        value.PayloadDescription = displayName;
      }
      Object.values(value).forEach(updatePayloadNames);
    };
 
    updatePayloadNames(profile.PayloadContent);
    return Buffer.from(plist.build(profile), 'utf8');
  } catch (err) {
    console.warn('[PROFILE] Không thể cá nhân hóa tên profile; trả file gốc:', err.message);
    return buffer;
  }
}
 
// ============================================================
// SECURITY HARDENING & MIDDLEWARES
// ============================================================
app.disable('x-powered-by');
 
// Cookie helper
function getCookie(req, name) {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}
 
// Anti Brute-Force Tracker (IP-based)
const failedLoginAttempts = new Map();
 
function checkBruteForce(ip) {
  const record = failedLoginAttempts.get(ip);
  if (!record) return { allowed: true };
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const remainingMin = Math.max(1, Math.ceil((record.lockedUntil - Date.now()) / 60000));
    return {
      allowed: false,
      message: `Hệ thống tạm khóa do nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau ${remainingMin} phút.`
    };
  }
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    failedLoginAttempts.delete(ip);
    return { allowed: true };
  }
  return { allowed: true };
}
 
function recordFailedLogin(ip) {
  const record = failedLoginAttempts.get(ip) || { count: 0, lockedUntil: null };
  record.count += 1;
  if (record.count >= 5) {
    record.lockedUntil = Date.now() + 15 * 60 * 1000; // Khóa 15 phút
  }
  failedLoginAttempts.set(ip, record);
}
 
function recordSuccessfulLogin(ip) {
  failedLoginAttempts.delete(ip);
}
 
// Token extraction & Auth Check
function extractAdminToken(req) {
  const authHeader = req.headers['authorization'] || '';
  const headerToken = authHeader.replace(/^Bearer\s+/i, '').trim() || req.headers['x-admin-token'];
  const cookieToken = getCookie(req, 'admin_session');
  return headerToken || cookieToken || '';
}
 
function isAdminAuthenticated(req) {
  const token = extractAdminToken(req);
  if (!token) return false;
  if (activeAdminTokens.has(token)) return true;
  const saved = loadSessions();
  if (saved.has(token)) {
    activeAdminTokens.add(token);
    return true;
  }
  return false;
}
 
// Security HTTP Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
 
// Chặn dò tìm và tải trái phép các file hệ thống / source code
app.use((req, res, next) => {
  const reqPath = decodeURIComponent(req.path || '').toLowerCase();
  if (
    reqPath.includes('..') ||
    reqPath.includes('.env') ||
    reqPath.includes('server.js') ||
    reqPath.includes('obfuscate.js') ||
    reqPath.includes('package.json') ||
    reqPath.includes('package-lock.json') ||
    reqPath.includes('js_src') ||
    reqPath.includes('.git') ||
    reqPath.endsWith('.bat') ||
    reqPath.endsWith('.md') ||
    (reqPath.startsWith('/data') && !reqPath.startsWith('/api'))
  ) {
    return res.status(403).json({ ok: false, error: 'Access Denied: 403 Forbidden.' });
  }
  next();
});
 
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
 
// BẢO VỆ MÃ NGUỒN ADMIN JS KHỎI XEM TRÁI PHÉP
app.get(['/js/admin.js', '/admin.js'], (req, res, next) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(403).type('application/javascript').send('/* Access Denied: 403 Forbidden. Vui lòng đăng nhập quản trị viên. */');
  }
  next();
});
 
// Static files
app.use('/css', express.static(path.join(ROOT_DIR, 'css')));
app.use('/js', express.static(path.join(ROOT_DIR, 'js')));
app.use('/images', express.static(path.join(ROOT_DIR, 'images')));
 
// HTML Routes
app.get(['/', '/index.html', '/gold', '/gold.html'], (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});
 
// Route /admin bảo mật tuyệt đối: chỉ phục vụ admin.html khi đã xác thực, ngược lại phục vụ admin-login.html
app.get(['/admin', '/admin.html'], (req, res) => {
  if (isAdminAuthenticated(req)) {
    res.sendFile(path.join(ROOT_DIR, 'admin.html'));
  } else {
    res.sendFile(path.join(ROOT_DIR, 'admin-login.html'));
  }
});
 
app.get(['/ctv', '/ctv.html'], (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'ctv.html'));
});
 
app.get(['/khung', '/khung.html', '/khung-anh', '/khung-anh.html', '/widget', '/khung-widget'], (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'khung.html'));
});
 
// Admin Auth Middleware (Xác thực API tuyệt đối, xóa bỏ hoàn toàn lỗ hổng token rác)
async function requireAdmin(req, res, next) {
  const token = extractAdminToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Chưa đăng nhập quản trị viên!' });
  }
  if (!activeAdminTokens.has(token)) {
    const saved = loadSessions();
    if (saved.has(token)) {
      activeAdminTokens.add(token);
    } else {
      return res.status(401).json({ ok: false, error: 'Phiên làm việc đã hết hạn hoặc không hợp lệ!' });
    }
  }
  next();
}
 
// CTV Auth Middleware
function requireCtv(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || req.headers['x-ctv-token'];
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Chưa đăng nhập tài khoản CTV!' });
  }
 
  const username = activeCtvTokens.get(token);
  if (!username) {
    return res.status(401).json({ ok: false, error: 'Phiên làm việc CTV đã hết hạn. Vui lòng đăng nhập lại!' });
  }
 
  const users = loadCtvUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Tài khoản CTV không tồn tại!' });
  }
 
  if (user.status === 'BLOCKED') {
    return res.status(403).json({ ok: false, error: 'Tài khoản CTV của bạn đã bị tạm khoá. Vui lòng liên hệ Admin!' });
  }
 
  req.ctvUser = user;
  next();
}
 
function requireCtvActive(req, res, next) {
  requireCtv(req, res, () => {
    if (req.ctvUser.status === 'PENDING_ACTIVATION' || req.ctvUser.firstDepositDone === false) {
      return res.status(403).json({
        ok: false,
        requireActivation: true,
        message: 'Bạn cần nạp tối thiểu 150.000đ để kích hoạt tài khoản CTV trước khi sử dụng!'
      });
    }
    next();
  });
}
 
// ============================================================
// 1. PUBLIC CONFIG API
// ============================================================
app.get('/api/config/public', (req, res) => {
  const settings = loadSettings();
  const publicData = {
    siteName: settings.siteName || 'TỔ CAM — LOCKET VIP 👑',
    siteSlogan: settings.siteSlogan || 'Cổng Nâng Cấp Locket Gold & VIP Pro 49+ Filter Camera AI',
    brandLogo: settings.brandLogo || '👑',
    hotline: settings.hotline || '0386.116.104',
    zaloUrl: settings.zaloUrl || 'https://zalo.me/0386116104',
    supportGroupUrl: settings.supportGroupUrl || 'https://zalo.me/0386116104',
    zaloGroup1Url: settings.zaloGroup1Url || 'https://zalo.me/g/shprtxgdepc6wscxwmtg',
    zaloGroup2Url: settings.zaloGroup2Url || 'https://zalo.me/g/qyke3ds1tqzjwudjznrc',
    dnsLinkRegular: settings.dnsLinkRegular || '/profile',
    dnsLinkVip: settings.dnsLinkVip || '/profile',
    marqueeNotice: settings.marqueeNotice || '',
    bankInfo: settings.bankInfo || {
      bankId: 'VPBANK',
      bankName: 'VPBank',
      accountNumber: '2027022007',
      accountName: 'NGUYEN MINH HIEP',
      memoPrefix: 'VIPCAM'
    },
    plans: settings.plans || { regular: [], vip: [] },
    vipGallery: settings.vipGallery || [],
    ctvSettings: settings.ctvSettings || { allowRegister: true, tabLocket: true, tabVipFilter: true, tabSpotify: true },
    customerFeatures: settings.customerFeatures || {
      enableVipMode: true,
      enableRegularMode: true,
      defaultMode: 'vip',
      showMarqueeNotice: true,
      showHeroBadge: true,
      showShowroom: true,
      showPricing: true,
      showDnsGuide: true,
      showLookupOrder: true,
      showCtvNav: true,
      showZaloButton: true,
      allowCancelOrder: true,
      autoCheckPayment: true,
      heroTitle: 'Cổng Nâng Cấp Locket VIP Pro & Locket Gold Chính Chủ',
      heroSubtitle: 'Quay video siêu dài 60s, mở khoá 49+ bộ lọc camera AI độc quyền: Photobooth 4 ô hot trend, xé túi mù trúng tiền thật. Kích hoạt 1 chạm tự động 100% qua Safari.',
      heroBadgeText: 'BẢN LOCKET VIP ĐỈNH CAO: 60S VIDEO & 49+ AI FILTER'
    }
  };
  res.json({ ok: true, data: publicData });
});
 
// ============================================================
// 2. USERNAME LOOKUP API (TRA CỨU PROFILE THẬT QUA KAWAII / LOCKET)
// ============================================================
app.get('/api/user/lookup', async (req, res) => {
  const rawUser = req.query.username || req.query.user || '';
  const username = cleanLocketUsername(rawUser);
 
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp username Locket!' });
  }
 
 
  const settings = loadSettings();
  const kawaiiKey = settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
 
  console.log(`[LOOKUP] Đang tra cứu tài khoản: @${username}`);
 
  // 1. Gọi API Kawaii Locket userinfo
  try {
    const ctvUrl = `https://ctv.nodns.vn/api/v1/userinfo?user=${encodeURIComponent(username)}`;
    const ctvRes = await fetch(ctvUrl, {
      headers: {
        'x-api-key': kawaiiKey,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
 
    const ctvData = await ctvRes.json().catch(() => null);
 
    if (ctvRes.ok && ctvData && (ctvData.status === 'success' || ctvData.uid)) {
      console.log(`[LOOKUP] ✅ Tìm thấy qua Kawaii API: @${username} (UID: ${ctvData.uid})`);
      return res.json({
        ok: true,
        found: true,
        data: {
          username: ctvData.username || username,
          fullName: ctvData.full_name || username,
          uid: ctvData.uid || null,
          avatarUrl: ctvData.profile_picture_url || null,
          hasGold: ctvData.gold?.has_gold || false,
          goldExpiry: ctvData.gold?.expiry_date || null,
          daysLeft: ctvData.gold?.days_left || 0
        }
      });
    }
  } catch (err) {
    console.warn('[LOOKUP] Kawaii userinfo error:', err.message);
  }
 
  // 1.5. Fallback: Tra cứu qua Locket Cụ Cam API
  try {
    const cucamKey = settings.apiConfig?.cucamApiKey || '';
    const cucamBase = settings.apiConfig?.cucamApiBase || 'https://locket.2707226.xyz';
    if (cucamKey) {
      const ccRes = await fetch(`${cucamBase}/api/uid/check?username=${encodeURIComponent(username)}`, {
        headers: { 'Authorization': `Bearer ${cucamKey}` }
      });
      const ccData = await ccRes.json().catch(() => null);
      if (ccRes.ok && ccData?.data?.uid) {
        console.log(`[LOOKUP] ✅ Tìm thấy qua Cụ Cam API: @${username} (UID: ${ccData.data.uid})`);
        return res.json({
          ok: true,
          found: true,
          data: {
            username: ccData.data.username || username,
            fullName: ccData.data.username || username,
            uid: ccData.data.uid,
            avatarUrl: ccData.data.avatarUrl || null,
            hasGold: ccData.data.active || false,
            goldExpiry: ccData.data.expiresAt || null,
            daysLeft: 0
          }
        });
      }
    }
  } catch (err) {
    console.warn('[LOOKUP] Cụ Cam check error:', err.message);
  }
 
  // 2. Fallback: Tra cứu trực tiếp từ link profile web locket.cam
  try {
    const locketRes = await fetch(`https://locket.cam/${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
      }
    });
 
    if (locketRes.ok) {
      const html = await locketRes.text();
      const uidMatch = html.match(/invites%2F([a-zA-Z0-9]{28})/i) || html.match(/invites\/([a-zA-Z0-9]{28})/i);
      const avatarMatch = html.match(/class="profile-pic-img"\s+src="([^"]+)"/i);
 
      const uid = uidMatch ? uidMatch[1] : null;
      const avatarUrl = avatarMatch ? avatarMatch[1].replace(/&amp;/g, '&') : null;
 
      console.log(`[LOOKUP] ✅ Tìm thấy qua Locket Web: @${username} (UID: ${uid})`);
      return res.json({
        ok: true,
        found: true,
        data: {
          username: username,
          fullName: username,
          uid: uid,
          avatarUrl: avatarUrl,
          hasGold: false,
          goldExpiry: null,
          daysLeft: 0
        }
      });
    }
  } catch (err) {
    console.warn('[LOOKUP] Locket Web error:', err.message);
  }
 
  // Nếu không tìm thấy
  return res.status(404).json({
    ok: false,
    found: false,
    message: `Không tìm thấy tài khoản "@${username}" trên Locket. Vui lòng kiểm tra lại chính xác username!`
  });
});
 
// ============================================================
// KIỂM TRA MÃ GIẢM GIÁ (COUPON)
// ============================================================
app.post('/api/coupon/check', (req, res) => {
  const { code, planType, planId, amount } = req.body || {};
  const settings = loadSettings();
 
  const type = planType === 'vip' ? 'vip' : 'regular';
  const plansList = (settings.plans && settings.plans[type]) ? settings.plans[type] : [];
  const matchedPlan = plansList.find(p => p.id === planId || p.code === planId) || plansList[0];
  const originalPrice = matchedPlan ? Number(matchedPlan.price) : Number(amount) || 75000;
 
  const result = evaluateCoupon({
    code,
    planType: type,
    planId: matchedPlan ? matchedPlan.id : planId,
    originalPrice
  }, settings);
 
  if (!result.ok) {
    return res.status(400).json({ ok: false, message: result.message });
  }
 
  res.json({
    ok: true,
    data: result.coupon
  });
});
 
// ============================================================
// 3. TẠO ĐƠN HÀNG & MÃ THANH TOÁN VIETQR
// ============================================================
app.post('/api/order/create', async (req, res) => {
  const { username: rawUser, planType, planId, couponCode } = req.body || {};
  const username = cleanLocketUsername(rawUser);
 
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Thiếu username Locket!' });
  }
 
  const settings = loadSettings();
  const bank = settings.bankInfo || {};
  const type = planType === 'vip' ? 'vip' : 'regular';
  const plansList = (settings.plans && settings.plans[type]) ? settings.plans[type] : [];
 
  const matchedPlan = plansList.find(p => p.id === planId || p.code === planId) || plansList[0];
  if (!matchedPlan) {
    return res.status(400).json({ ok: false, message: 'Gói dịch vụ không hợp lệ!' });
  }
 
  // Tạo mã đơn độc nhất
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const memoPrefix = (bank.memoPrefix || 'VIPCAM').toUpperCase().replace(/\s+/g, '');
  const orderCode = `${memoPrefix}${randNum}`;
  const orderId = `ORD_${Date.now()}_${randNum}`;
 
  // Kiểm tra & áp dụng mã giảm giá (nếu có)
  const originalPrice = Number(matchedPlan.price) || 75000;
  let finalAmount = originalPrice;
  let appliedCoupon = null;
 
  if (couponCode && String(couponCode).trim()) {
    const coupCheck = evaluateCoupon({
      code: couponCode,
      planType: type,
      planId: matchedPlan.id,
      originalPrice
    }, settings);
 
    if (coupCheck.ok && coupCheck.coupon) {
      finalAmount = coupCheck.coupon.finalPrice;
      appliedCoupon = {
        code: coupCheck.coupon.code,
        name: coupCheck.coupon.name,
        type: coupCheck.coupon.type,
        value: coupCheck.coupon.value,
        discountAmount: coupCheck.coupon.discountAmount,
        originalAmount: coupCheck.coupon.originalPrice
      };
 
      // Tăng số lượt đã sử dụng của coupon
      if (Array.isArray(settings.coupons)) {
        const cTarget = settings.coupons.find(c => String(c.code).trim().toUpperCase() === String(couponCode).trim().toUpperCase());
        if (cTarget) {
          cTarget.usedCount = (Number(cTarget.usedCount) || 0) + 1;
          await saveSettings(settings);
        }
      }
    } else {
      console.warn(`[ORDER_COUPON_REJECTED] Mã "${couponCode}": ${coupCheck.message}`);
    }
  }
 
  // VietQR link
  const bankId = bank.bankId || 'VPBANK';
  const accNum = bank.accountNumber || '2027022007';
  const accName = bank.accountName || 'NGUYEN MINH HIEP';
  const amount = finalAmount;
 
  const qrUrl = `https://img.vietqr.io/image/${bankId}-${accNum}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(accName)}`;
 
  const newOrder = {
    id: orderId,
    orderCode: orderCode,
    username: username,
    planType: type,
    planId: matchedPlan.id,
    planCode: matchedPlan.code,
    packageKey: matchedPlan.packageKey || 'filter_1year',
    planName: matchedPlan.name,
    amount: amount,
    originalAmount: originalPrice,
    coupon: appliedCoupon,
    status: 'PENDING', // PENDING, PAID, ACTIVATED, FAILED, CANCELLED
    qrUrl: qrUrl,
    bankInfo: {
      bankId,
      bankName: bank.bankName || 'VPBank',
      accountNumber: accNum,
      accountName: accName,
      memo: orderCode
    },
    mobileconfigUrl: null,
    filterShortUrl: null,
    activationLog: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ORDER_EXPIRATION_MS).toISOString() // Đơn có hiệu lực đúng 3 phút
  };
 
  const orders = loadOrders();
 
  // Tự động hủy các đơn PENDING cũ của cùng username (tránh treo nhiều đơn rác khi khách đổi gói)
  let cancelledOldCount = 0;
  orders.forEach(o => {
    if (o.status === 'PENDING' && cleanLocketUsername(o.username) === username) {
      o.status = 'CANCELLED';
      o.cancelReason = `Khách chuyển sang tạo đơn mới ${orderCode}`;
      o.cancelledAt = new Date().toISOString();
      cancelledOldCount++;
    }
  });
  if (cancelledOldCount > 0) {
    console.log(`[ORDER] Đã tự động hủy ${cancelledOldCount} đơn chờ cũ của @${username} để tạo đơn mới ${orderCode}`);
  }
 
  orders.unshift(newOrder);
  if (!(await saveOrders(orders.slice(0, 500)))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu đơn hàng!' });
  }
 
  console.log(`[ORDER] Tạo đơn mới: ${orderCode} - @${username} - ${matchedPlan.name} (${amount.toLocaleString('vi-VN')}đ)`);
 
  res.json({
    ok: true,
    order: newOrder
  });
});
 
// Khách hủy đơn hàng (Nhấn X đổi gói hoặc hết hạn)
app.post('/api/order/cancel', async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
 
  const rawCode = body.orderCode || body.code || req.query.orderCode || '';
  const orderCode = String(rawCode).trim().toUpperCase();
  const reason = (body.reason || 'Khách nhấn X đổi gói / hủy thanh toán').trim();
 
  if (!orderCode) {
    return res.status(400).json({ ok: false, message: 'Thiếu mã đơn hàng!' });
  }
 
  const orders = loadOrders();
  const order = orders.find(o => (o.orderCode || '').toUpperCase() === orderCode || o.id === orderCode);
 
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn hàng!' });
  }
 
  // Chỉ hủy nếu đơn đang ở trạng thái PENDING
  if (order.status === 'PENDING') {
    order.status = 'CANCELLED';
    order.cancelReason = reason;
    order.cancelledAt = new Date().toISOString();
    if (order.coupon && order.coupon.code) {
      const settings = loadSettings();
      if (Array.isArray(settings.coupons)) {
        const cTarget = settings.coupons.find(c => String(c.code).trim().toUpperCase() === String(order.coupon.code).trim().toUpperCase());
        if (cTarget && Number(cTarget.usedCount) > 0) {
          cTarget.usedCount = Number(cTarget.usedCount) - 1;
          await saveSettings(settings);
        }
      }
    }
 
    await saveOrders(orders);
    console.log(`[ORDER] ❌ Đã hủy đơn ${orderCode} (@${order.username}) — Lý do: ${reason}`);
    return res.json({ ok: true, message: 'Đã hủy đơn hàng thành công!', order });
  }
 
  return res.json({ ok: true, message: 'Đơn hàng không ở trạng thái chờ thanh toán', order });
});
 
// Kiểm tra trạng thái đơn hàng (Polling từ frontend)
app.get('/api/order/check', (req, res) => {
  const orderCode = (req.query.orderCode || req.query.code || '').trim().toUpperCase();
  if (!orderCode) {
    return res.status(400).json({ ok: false, message: 'Thiếu mã đơn hàng!' });
  }
 
  const orders = loadOrders();
  const order = orders.find(o => (o.orderCode || '').toUpperCase() === orderCode || o.id === orderCode);
 
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn hàng!' });
  }
 
  // Kiểm tra nếu đã quá hạn 3 phút mà chưa thanh toán
  if (order.status === 'PENDING') {
    const createdTime = new Date(order.createdAt || Date.now()).getTime();
    const expiryTime = order.expiresAt ? new Date(order.expiresAt).getTime() : (createdTime + ORDER_EXPIRATION_MS);
    if (Date.now() >= expiryTime) {
      order.status = 'CANCELLED';
      order.cancelReason = 'Đơn hết hạn sau 3 phút chưa thanh toán';
      order.expiredAt = new Date().toISOString();
      saveOrders(orders);
    }
  }
 
  res.json({
    ok: true,
    order: order
  });
});
 
// Tra cứu lịch sử đơn hàng của username
app.get('/api/order/lookup-history', (req, res) => {
  const username = cleanLocketUsername(req.query.username || '');
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Thiếu username!' });
  }
 
  const orders = loadOrders();
  const userOrders = orders.filter(o => cleanLocketUsername(o.username) === username);
 
  res.json({
    ok: true,
    username: username,
    orders: userOrders
  });
});
 
// ============================================================
// 4. KÍCH HOẠT API THẬT QUA KAWAII / CỤ CAM
// ============================================================
async function executeActivation(order) {
  const settings = loadSettings();
  const apiConfig = settings.apiConfig || {};
 
  console.log(`[ACTIVATE] 🚀 Đang tiến hành kích hoạt cho đơn ${order.orderCode} (@${order.username}) - Loại: ${order.planType}`);
 
  if (order.planType === 'vip') {
    // KÍCH HOẠT LOCKET VIP + 49 FILTER QUA KAWAII CTV
    const apiKey = apiConfig.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
    const apiUrl = 'https://ctv.nodns.vn/api/v1/ctv/gold';
    const pkg = order.packageKey || 'filter_1year';
 
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'User-Agent': BROWSER_USER_AGENT
        },
        body: JSON.stringify({
          user: order.username,
          isFilter: true,
          package: pkg
        })
      });
 
      const resData = await response.json().catch(() => ({}));
      console.log(`[KAWAII RESPONSE] Status: ${response.status}`, resData);
 
      if (response.ok && (resData.status === 'success' || resData.ok || resData.data)) {
        order.status = 'ACTIVATED';
        order.uid = resData.data?.uid || order.uid || null;
        order.expiresAt = resData.data?.expiresAt || order.expiresAt || null;
        order.mobileconfigUrl = resData.data?.mobileconfigUrl || resData.mobileconfigUrl || getConfiguredDnsUrl(
          order.username,
          settings.dnsLinkVip,
          'https://locket.2707226.xyz/{username}'
        );
        order.filterShortUrl = resData.data?.filterShortUrl || resData.filterShortUrl || null;
        order.activationLog = {
          success: true,
          provider: 'KAWAII_VIP_FILTER',
          time: new Date().toISOString(),
          response: resData
        };
        return { success: true, data: resData };
      } else {
        // Trường hợp API báo lỗi số dư hoặc lỗi khác
        order.status = 'PAID'; // Đã thanh toán, chờ admin duyệt
        order.activationLog = {
          success: false,
          provider: 'KAWAII_VIP_FILTER',
          time: new Date().toISOString(),
          error: resData.error || resData.message || `Lỗi HTTP ${response.status}`
        };
        return { success: false, error: resData.error || resData.message };
      }
    } catch (err) {
      console.error('[ACTIVATE] Lỗi gọi Kawaii API:', err.message);
      order.activationLog = {
        success: false,
        provider: 'KAWAII_VIP_FILTER',
        time: new Date().toISOString(),
        error: err.message
      };
      return { success: false, error: err.message };
    }
  } else {
    // KÍCH HOẠT LOCKET THƯỜNG QUA CỤ CAM HOẶC KAWAII GOLD
    const cucamKey = apiConfig.cucamApiKey || '';
    const cucamBase = apiConfig.cucamApiBase || 'https://locket.2707226.xyz';
 
    if (cucamKey) {
      try {
        const pkgCode = order.planCode === 'TEST' ? 'LKGT3D' : (order.planCode === 'MONTH6' ? 'LKG6M' : (order.planCode === 'YEARLY' ? 'LKG1Y' : 'LKGVV'));
        const response = await fetch(`${cucamBase}/api/uid/create`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cucamKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: order.username,
            packageCode: pkgCode
          })
        });
 
        const resData = await response.json().catch(() => ({}));
        if ((response.ok || response.status === 201) && (resData.ok || resData.success || resData.status === 'success')) {
          order.status = 'ACTIVATED';
          const uidStr = resData.data?.uid?.uidString || resData.data?.uid?.uid || resData.data?.uid || resData.uid || null;
          order.uid = typeof uidStr === 'string' ? uidStr : (uidStr?.uidString || null);
          order.mobileconfigUrl = getRegularDnsUrl(order.username, settings);
          order.activationLog = {
            success: true,
            provider: 'CUCAM_DNS',
            time: new Date().toISOString(),
            response: resData
          };
          return { success: true, data: resData };
        } else {
          console.warn('[ACTIVATE CỤ CAM ERROR RESPONSE]:', resData);
        }
      } catch (err) {
        console.warn('[ACTIVATE CỤ CAM ERROR]:', err.message);
      }
    }
 
    order.status = 'PAID';
    return { success: false, message: 'Đã nhận thanh toán, đơn hàng đang chờ duyệt kích hoạt!' };
  }
}
 
// ============================================================
// 5. WEBHOOK XÁC NHẬN THANH TOÁN (CASSO & SEPAY)
// ============================================================
async function processIncomingTransaction(tx) {
  const { amount, description, id } = tx;
  const desc = (description || '').toUpperCase();
 
  console.log(`[WEBHOOK] 💰 Nhận giao dịch: +${amount}đ | Nội dung: "${desc}" | TxID: ${id}`);
 
  // 1. Kiểm tra đơn hàng khách mua lẻ
  const orders = loadOrders();
  const normalizedDescription = normalizePaymentText(desc);
  const matchedOrder = orders.find(o => {
    if (o.status === 'ACTIVATED' || o.status === 'CANCELLED') return false;
    const code = (o.orderCode || '').toUpperCase();
    const user = (o.username || '').toUpperCase();
    const isAmountOk = Number(amount) >= Number(o.amount) * 0.95; // Cho phép dung sai nhỏ nếu có phí
    const hasOrderCode = code && normalizedDescription.includes(normalizePaymentText(code));
    return isAmountOk && (hasOrderCode || (user && desc.includes(user)));
  });
 
  if (matchedOrder) {
    console.log(`[WEBHOOK] ✅ Khớp đơn hàng khách mua ${matchedOrder.orderCode} (@${matchedOrder.username})!`);
    matchedOrder.status = 'PAID';
    matchedOrder.paymentRef = id || `PAY_${Date.now()}`;
    matchedOrder.paidAt = new Date().toISOString();
 
    const settings = loadSettings();
    const shouldAuto = matchedOrder.planType === 'vip'
      ? settings.apiConfig?.autoActivateVIP !== false
      : settings.apiConfig?.autoActivateRegular !== false;
 
    if (shouldAuto) {
      await executeActivation(matchedOrder);
    }
 
    if (!(await saveOrders(orders))) throw new Error('Không thể lưu trạng thái đơn hàng sau thanh toán.');
    return true;
  }
 
  // 2. Kiểm tra lệnh nạp tiền ví CTV
  const deposits = loadCtvDeposits();
  const matchedDeposit = deposits.find(d => {
    if (d.status === 'COMPLETED') return false;
    const memo = (d.memo || d.depositCode || '').toUpperCase();
    const isAmountOk = Number(amount) >= Number(d.amount) * 0.95;
    return isAmountOk && memo && desc.includes(memo);
  });
 
  if (matchedDeposit) {
    console.log(`[WEBHOOK] ✅ Khớp lệnh nạp tiền CTV ${matchedDeposit.depositCode} (@${matchedDeposit.username})!`);
    matchedDeposit.status = 'COMPLETED';
    matchedDeposit.paymentRef = id || `PAY_${Date.now()}`;
    matchedDeposit.completedAt = new Date().toISOString();
    if (!(await saveCtvDeposits(deposits))) throw new Error('Không thể lưu lệnh nạp CTV sau thanh toán.');
 
    // Tự động cộng số dư tiền và Coin cho CTV
    const users = loadCtvUsers();
    const user = users.find(u => u.username.toLowerCase() === matchedDeposit.username.toLowerCase());
    if (user) {
      user.balance = (user.balance || 0) + matchedDeposit.amount;
      user.coins = Math.floor(user.balance / 1000);
 
      // Tự động kích hoạt nếu là lần nạp đầu hoặc đang chờ kích hoạt và nạp >= 150.000đ
      if (user.firstDepositDone === false || user.status === 'PENDING_ACTIVATION') {
        if (matchedDeposit.amount >= 150000 || user.balance >= 150000) {
          user.firstDepositDone = true;
          user.status = 'ACTIVE';
          user.activatedAt = new Date().toISOString();
          console.log(`[WEBHOOK] 🎉 Kích hoạt thành công tài khoản CTV @${user.username} với lần nạp đầu ${matchedDeposit.amount.toLocaleString('vi-VN')}đ!`);
        }
      }
 
      if (!(await saveCtvUsers(users))) throw new Error('Không thể cập nhật số dư CTV sau thanh toán.');
      console.log(`[WEBHOOK] 💰 Đã tự động cộng +${matchedDeposit.amount.toLocaleString('vi-VN')}đ (+${matchedDeposit.coins} Coins) cho CTV @${user.username}!`);
    }
    return true;
  }
 
  // 3. Fallback xử lý chuyển khoản trực tiếp (như locket thường: memo chứa "TOCAM <username>" hoặc "VIPCAM <username>")
  const sanitizedMemo = desc.replace(/[\._\s-]+(CT|IBFT|CHUYEN TIEN|CHUYENTIEN)(\s+TU.*)?$/i, '');
  const match = sanitizedMemo.match(/(?:TOCAM|VIPCAM|LOCKET)\s*([A-Za-z0-9_.-]+)/i) || desc.match(/(?:TOCAM|VIPCAM|LOCKET)\s*([A-Za-z0-9_.-]+)/i);
  let rawUser = match && match[1] ? match[1] : '';
 
  if (!rawUser) {
    const parts = sanitizedMemo.split(/\s+/);
    const prefixIdx = parts.findIndex(p => ['TOCAM', 'VIPCAM', 'LOCKET'].includes(p));
    if (prefixIdx !== -1 && parts[prefixIdx + 1]) {
      rawUser = parts[prefixIdx + 1];
    }
  }
 
  const cleanUser = cleanLocketUsername(rawUser);
  if (cleanUser && Number(amount) >= 5000) {
    console.log(`[WEBHOOK] 🎯 Phát hiện chuyển khoản trực tiếp cho @${cleanUser} (+${Number(amount).toLocaleString('vi-VN')}đ)! Đang tự động xử lý...`);
 
    const settings = loadSettings();
    let planType = 'regular';
    let planCode = 'TEST';
    let planName = 'Locket Gold Dùng Thử';
    let packageKey = null;
 
    if (Number(amount) >= 95000) {
      planType = 'vip';
      planCode = 'VIP_2Y';
      planName = 'Locket VIP Pro 2 Năm';
      packageKey = 'filter_2year';
    } else if (Number(amount) >= 75000) {
      planType = 'vip';
      planCode = 'VIP_1Y';
      planName = 'Locket VIP Pro 1 Năm';
      packageKey = 'filter_1year';
    } else if (Number(amount) >= 49000) {
      planType = 'regular';
      planCode = 'YEARLY';
      planName = 'Locket Gold 1 Năm';
    } else if (Number(amount) >= 29000) {
      planType = 'regular';
      planCode = 'MONTH6';
      planName = 'Locket Gold Tiết Kiệm';
    } else {
      planType = 'regular';
      planCode = 'TEST';
      planName = 'Locket Gold Dùng Thử';
    }
 
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const orderCode = `TOCAM${randNum}`;
    const newOrder = {
      id: `ord_${Date.now()}_${randNum}`,
      orderCode: orderCode,
      username: cleanUser,
      planType: planType,
      planId: planCode,
      planCode: planCode,
      planName: planName,
      packageKey: packageKey,
      amount: Number(amount),
      status: 'PAID',
      paymentRef: id || `PAY_${Date.now()}`,
      paidAt: new Date().toISOString(),
      bankDetails: {
        bankName: settings.bankInfo?.bankName || 'VPBank',
        accountNumber: settings.bankInfo?.accountNumber || '2027022007',
        accountName: settings.bankInfo?.accountName || 'NGUYEN MINH HIEP',
        memo: `TOCAM ${cleanUser}`
      },
      mobileconfigUrl: null,
      filterShortUrl: null,
      activationLog: null,
      createdAt: new Date().toISOString()
    };
 
    const shouldAuto = planType === 'vip'
      ? settings.apiConfig?.autoActivateVIP !== false
      : settings.apiConfig?.autoActivateRegular !== false;
 
    if (shouldAuto) {
      await executeActivation(newOrder);
    }
 
    orders.unshift(newOrder);
    if (!(await saveOrders(orders.slice(0, 500)))) throw new Error('Không thể lưu đơn hàng chuyển khoản trực tiếp.');
    console.log(`[WEBHOOK] 🚀 Đã tạo đơn và kích hoạt tự động thành công cho @${cleanUser} (${newOrder.orderCode})!`);
    return true;
  }
 
  console.warn('[WEBHOOK] ⚠️ Không tìm thấy đơn hàng, lệnh nạp CTV hoặc username hợp lệ nào khớp với nội dung chuyển khoản!');
  return false;
}
 
// Webhook Casso
app.all('/webhook/casso', async (req, res) => {
  try {
    const body = req.body || {};
    const data = body.data || (Array.isArray(body) ? body : [body]);
 
    for (const item of (Array.isArray(data) ? data : [data])) {
      if (item && item.amount) {
        await processIncomingTransaction({
          id: item.id || item.tid,
          amount: item.amount,
          description: item.description || item.corresponsiveName || ''
        });
      }
    }
 
    return res.json({ error: 0, message: 'OK' });
  } catch (err) {
    console.error('[CASSO] Không thể lưu giao dịch:', err.message);
    return res.status(500).json({ error: 1, message: 'Không thể lưu giao dịch, vui lòng gửi lại.' });
  }
});
 
// Webhook SePay (Tương thích 100% với SePay từ locket thường)
app.all('/webhook/sepay', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('[SEPAY] Webhook nhận dữ liệu:', JSON.stringify(body));
 
    const settings = loadSettings();
    const apiKey = settings.apiConfig?.sepayApiKey;
    if (apiKey) {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader !== `Apikey ${apiKey}` && authHeader !== apiKey) {
        console.warn('[SEPAY] API Key không hợp lệ!');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
 
    const amount = body.transferAmount || body.amount || 0;
    const description = body.content || body.description || '';
    const id = body.id || body.referenceCode || Date.now();
 
    if (amount) {
      await processIncomingTransaction({
        id: id,
        amount: Number(amount),
        description: String(description)
      });
    }
 
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[SEPAY] Không thể lưu giao dịch:', err.message);
    return res.status(500).json({ success: false, message: 'Không thể lưu giao dịch, vui lòng gửi lại.' });
  }
});
 
// ============================================================
// HỖ TRỢ ĐỒNG BỘ TỪ LOCKET THƯỜNG (CHECK PAYMENT, RECENT TRANSACTIONS, PROFILE)
// ============================================================
 
// Polling kiểm tra trạng thái thanh toán theo username (Tương thích frontend locket thường)
app.get('/check-payment', (req, res) => {
  const raw = (req.query.username || '').toLowerCase().trim().replace('@', '');
  const username = cleanLocketUsername(raw);
  if (!username) {
    return res.status(400).json({ error: 'Thiếu username' });
  }
 
 
  const orders = loadOrders();
  const matched = orders.find(o => cleanLocketUsername(o.username) === username);
 
  if (matched && (matched.status === 'ACTIVATED' || matched.status === 'PAID')) {
    return res.json({
      paid: true,
      plan: matched.planCode || matched.planId,
      amount: matched.amount,
      paidAt: matched.paidAt || matched.createdAt,
      username: matched.username,
      locketStatus: matched.status === 'ACTIVATED' ? 'success' : 'pending',
      uid: matched.uid || null,
      mobileconfigUrl: matched.mobileconfigUrl || (matched.planType === 'regular'
        ? getRegularDnsUrl(username)
        : `/profile?username=${encodeURIComponent(username)}`),
      filterShortUrl: matched.filterShortUrl || null
    });
  }
 
  res.json({
    paid: false,
    username: username
  });
});
 
// Lấy danh sách giao dịch thành công gần đây (Tương thích locket thường)
app.get('/api/recent-transactions', (req, res) => {
  const orders = loadOrders();
  const recent = orders
    .filter(o => o.status === 'ACTIVATED' || o.status === 'PAID')
    .slice(0, 30)
    .map(o => ({
      username: o.username,
      plan: o.planName || o.planCode,
      amount: o.amount,
      time: o.paidAt || o.createdAt,
      txId: o.paymentRef || o.orderCode,
      status: 'success',
      avatarUrl: o.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(o.username)}&background=FFA033&color=fff&size=128&bold=true`
    }));
  res.json(recent);
});
 
// ============================================================
// PROFILE & DNS DOWNLOAD (.mobileconfig) CHO IOS / SAFARI
// Kết nối trực tiếp Cụ Cam API, tải cấu hình DNS 1 chạm
// ============================================================
function buildPublicDohMobileConfig(username = '') {
  const cleanUser = cleanLocketUsername(username);
  const label = cleanUser ? `To Cam DNS - ${cleanUser}` : 'To Cam DNS - Cloudflare';
  const configUuid = crypto.randomUUID().toUpperCase();
  const dnsUuid = crypto.randomUUID().toUpperCase();
  const payload = {
    PayloadContent: [{
      DNSSettings: {
        DNSProtocol: 'HTTPS',
        ServerURL: 'https://cloudflare-dns.com/dns-query'
      },
      PayloadDescription: 'Cau hinh DNS-over-HTTPS cong khai cua Cloudflare. Khong kich hoat Locket Gold.',
      PayloadDisplayName: label,
      PayloadIdentifier: `vn.tocam.dns.${dnsUuid.toLowerCase()}`,
      PayloadType: 'com.apple.dnsSettings.managed',
      PayloadUUID: dnsUuid,
      PayloadVersion: 1
    }],
    PayloadDescription: 'Ho so nay chi thay doi nha cung cap DNS tren thiet bi; khong cap quyen Locket Gold.',
    PayloadDisplayName: label,
    PayloadIdentifier: `vn.tocam.profile.${configUuid.toLowerCase()}`,
    PayloadRemovalDisallowed: false,
    PayloadType: 'Configuration',
    PayloadUUID: configUuid,
    PayloadVersion: 1
  };
  return Buffer.from(plist.build(payload), 'utf8');
}
 
app.all([
  '/api/profile/download',
  '/api/locket/profile/download',
  '/profile',
  '/dns',
  '/profile/download',
  '/locket.mobileconfig',
  '/LocketGold.mobileconfig'
], (req, res) => {
  const rawUser = req.query.username || req.body?.username || '';
  const username = cleanLocketUsername(rawUser);
  const profile = buildPublicDohMobileConfig(username);
  const filename = `ToCam-DNS${username ? `-${username}` : ''}.mobileconfig`;
  res.setHeader('Content-Type', 'application/x-apple-aspen-config; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(profile);
});
 
// ============================================================
// KHUNG ẢNH WIDGET LOCKET API (TÍCH HỢP https://khunganh.nodns.vn)
// ============================================================
 
// Helper ghi nhật ký đổi khung
function addFrameLog(logEntry) {
  try {
    const settings = loadSettings();
    if (!Array.isArray(settings.frameLogs)) {
      settings.frameLogs = [];
    }
    settings.frameLogs.unshift({
      id: 'flog_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toISOString(),
      ...logEntry
    });
    if (settings.frameLogs.length > 100) {
      settings.frameLogs = settings.frameLogs.slice(0, 100);
    }
    saveSettings(settings);
  } catch (err) {
    console.warn('[FRAME LOG] Lỗi ghi log:', err.message);
  }
}
 
// 1. Gallery khung ảnh cộng đồng (Kết hợp cả kho nodns và khung riêng do Admin tạo)
app.get('/api/frame/gallery', async (req, res) => {
  const settings = loadSettings();
  const apiKey = settings.apiConfig?.frameApiKey || settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
  let frames = [];
 
  try {
    const resp = await fetch('https://khunganh.nodns.vn/api/v1/frame/gallery', {
      headers: { 'x-api-key': apiKey, 'User-Agent': BROWSER_USER_AGENT }
    });
    const data = await resp.json().catch(() => null);
    if (resp.ok && data && Array.isArray(data.data?.frames)) {
      frames = data.data.frames;
    }
  } catch (e) {
    console.warn('[FRAME GALLERY] Lỗi tải gallery nodns:', e.message);
  }
 
  // Kết hợp các mẫu khung riêng do Admin tải lên trong settings
  const customFrames = Array.isArray(settings.customFrames) ? settings.customFrames : [];
  if (customFrames.length > 0) {
    const mapped = customFrames.map(cf => ({
      name: cf.name + (cf.isVip ? ' 👑' : ''),
      url: cf.url,
      isCustom: true,
      id: cf.id
    }));
    frames = [...mapped, ...frames];
  }
 
  // Lọc bỏ các mẫu khung Admin đã ẩn / xóa khỏi hệ thống
  const hiddenFrames = Array.isArray(settings.hiddenFrames) ? settings.hiddenFrames : [];
  if (hiddenFrames.length > 0) {
    frames = frames.filter(f => f.url && !hiddenFrames.includes(f.url));
  }
 
  return res.json({
    status: 'success',
    data: {
      frames: frames,
      count: frames.length,
      noticeMessage: settings.frameSettings?.noticeMessage || ''
    }
  });
});
 
// Endpoint tải file khung ảnh PNG về máy (Attachment download proxy chống lỗi CORS)
app.get('/api/frame/download', async (req, res) => {
  const fileUrl = req.query.url;
  const rawName = req.query.name || 'khung-locket';
  if (!fileUrl) {
    return res.status(400).send('Thiếu URL tệp khung cần tải!');
  }
 
  const safeName = String(rawName).replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1EA0-\u1EF9 ]/g, '').trim().replace(/\s+/g, '-') || 'khung-locket';
 
  // Hỗ trợ tải trực tiếp tệp ảnh nội bộ trên máy chủ (/images/...)
  if (fileUrl.startsWith('/images/') || fileUrl.startsWith('images/')) {
    const localRel = fileUrl.replace(/^\//, '');
    const localAbs = path.join(ROOT_DIR, localRel);
    if (fs.existsSync(localAbs)) {
      const buffer = fs.readFileSync(localAbs);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.png"`);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(buffer);
    }
  }
 
  try {
    const fetchRes = await fetch(fileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!fetchRes.ok) {
      return res.status(fetchRes.status || 404).send('Không thể tải ảnh từ nguồn');
    }
 
    const contentType = fetchRes.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await fetchRes.arrayBuffer());
 
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.png"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(buffer);
  } catch (err) {
    console.warn('[FRAME DOWNLOAD] Lỗi proxy download:', err.message);
    return res.status(502).send('Lỗi tải tệp: ' + err.message);
  }
});
 
// 2. Tra cứu trạng thái khung hiện tại theo username hoặc UID
app.get('/api/frame/status', async (req, res) => {
  const rawId = req.query.identifier || req.query.id || req.query.username || '';
  const identifier = cleanLocketUsername(rawId);
  if (!identifier) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp username hoặc UID Locket!' });
  }
 
 
  const settings = loadSettings();
  const apiKey = settings.apiConfig?.frameApiKey || settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
  try {
    const resp = await fetch(`https://khunganh.nodns.vn/api/v1/frame?identifier=${encodeURIComponent(identifier)}`, {
      headers: { 'x-api-key': apiKey, 'User-Agent': BROWSER_USER_AGENT }
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      return res.status(resp.status || 500).json({ status: 'error', message: data?.message || 'Không tìm thấy thông tin khung' });
    }
 
    // Tự động làm giàu thông tin tài khoản thật từ Locket (Ảnh đại diện, Họ tên, Username, Gói Gold)
    if (data && data.data) {
      const resolvedUid = data.data.uid || identifier;
      let profileFound = false;
 
      // 1. Thử qua Kawaii userinfo
      try {
        const userInfoRes = await fetch(`https://ctv.nodns.vn/api/v1/userinfo?user=${encodeURIComponent(identifier)}`, {
          headers: {
            'x-api-key': apiKey,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
          }
        });
        const uData = await userInfoRes.json().catch(() => null);
        if (userInfoRes.ok && uData && (uData.status === 'success' || uData.uid)) {
          data.data.username = uData.username || identifier;
          data.data.fullName = uData.full_name || uData.username || identifier;
          data.data.avatarUrl = uData.profile_picture_url || null;
          data.data.hasGold = uData.gold?.has_gold || false;
          data.data.goldExpiry = uData.gold?.expiry_date || null;
          profileFound = true;
        }
      } catch (_) { }
 
      // 2. Fallback qua Cụ Cam nếu chưa có avatar
      if (!profileFound || !data.data.avatarUrl) {
        try {
          const cucamKey = settings.apiConfig?.cucamApiKey || '';
          const cucamBase = settings.apiConfig?.cucamApiBase || 'https://locket.2707226.xyz';
          if (cucamKey) {
            const ccRes = await fetch(`${cucamBase}/api/uid/check?username=${encodeURIComponent(identifier)}`, {
              headers: { 'Authorization': `Bearer ${cucamKey}` }
            });
            const ccData = await ccRes.json().catch(() => null);
            if (ccRes.ok && ccData?.data) {
              data.data.username = data.data.username || ccData.data.username || identifier;
              data.data.fullName = data.data.fullName || ccData.data.username || identifier;
              data.data.avatarUrl = data.data.avatarUrl || ccData.data.avatarUrl || null;
              if (ccData.data.active) data.data.hasGold = true;
            }
          }
        } catch (_) { }
      }
 
      // 3. Fallback qua danh sách CTV Customers
      if (!data.data.avatarUrl) {
        const ctvCusts = loadCtvCustomers();
        const foundCust = ctvCusts.find(c =>
          (c.username && cleanLocketUsername(c.username) === identifier.toLowerCase()) ||
          (c.uid && c.uid.toLowerCase() === resolvedUid.toLowerCase())
        );
        if (foundCust) {
          data.data.username = data.data.username || foundCust.username || identifier;
          data.data.fullName = data.data.fullName || foundCust.fullName || identifier;
          data.data.avatarUrl = data.data.avatarUrl || foundCust.avatarUrl || null;
          if (foundCust.active) data.data.hasGold = true;
        }
      }
    }
 
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ status: 'error', message: 'Lỗi kết nối kiểm tra khung: ' + e.message });
  }
});
 
// 3. Áp dụng / Đổi khung cho tài khoản Locket
app.post('/api/frame/set', async (req, res) => {
  const { identifier: rawId, image, frameUrl, name, share, mime } = req.body || {};
  const identifier = cleanLocketUsername(rawId || '');
  if (!identifier) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp username hoặc UID Locket!' });
  }
  if (!image && !frameUrl) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng chọn khung từ gallery hoặc tải ảnh khung PNG lên!' });
  }
 
  const settings = loadSettings();
  const fSettings = settings.frameSettings || {};
 
  // Kiểm tra chính sách cấu hình Admin
  if (fSettings.enabled === false) {
    return res.status(403).json({ status: 'error', message: 'Chức năng Đổi Khung Widget hiện đang tạm đóng để bảo trì!' });
  }
  if (image && fSettings.allowCustomUpload === false) {
    return res.status(403).json({ status: 'error', message: 'Hệ thống hiện chỉ cho phép chọn mẫu có sẵn, tạm khóa chức năng tự tải ảnh PNG riêng!' });
  }
 
  const apiKey = settings.apiConfig?.frameApiKey || settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
  try {
    const payload = {
      identifier: identifier,
      name: (name || '').trim().slice(0, 40) || undefined,
      share: !!share
    };
    if (image) payload.image = image;
    if (frameUrl) payload.frameUrl = frameUrl;
    if (mime) payload.mime = mime;
 
    // Tự động chuyển đổi ảnh local thành base64 nếu frameUrl là đường dẫn nội bộ máy chủ
    if (payload.frameUrl && !payload.image) {
      if (payload.frameUrl.startsWith('/images/') || payload.frameUrl.startsWith('images/')) {
        const localRel = payload.frameUrl.replace(/^\//, '');
        const localAbs = path.join(ROOT_DIR, localRel);
        if (fs.existsSync(localAbs)) {
          const buf = fs.readFileSync(localAbs);
          payload.image = `data:image/png;base64,${buf.toString('base64')}`;
          delete payload.frameUrl;
        }
      }
    }
 
    const resp = await fetch('https://khunganh.nodns.vn/api/v1/frame', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      return res.status(resp.status || 500).json({ status: 'error', message: data?.message || 'Đổi khung thất bại!' });
    }
 
    // Ghi nhật ký đổi khung thành công
    addFrameLog({
      action: 'USER_SET_FRAME',
      identifier: identifier,
      frameName: payload.name || 'Khung Widget',
      frameUrl: payload.frameUrl || (image ? 'Ảnh tự tải' : ''),
      actor: 'Khách hàng',
      status: 'SUCCESS'
    });
 
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ status: 'error', message: 'Lỗi kết nối máy chủ đổi khung: ' + e.message });
  }
});
 
// 4. Gỡ khung về mặc định
app.post('/api/frame/remove', async (req, res) => {
  const { identifier: rawId } = req.body || {};
  const identifier = cleanLocketUsername(rawId || req.query.identifier || '');
  if (!identifier) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng cung cấp username hoặc UID Locket!' });
  }
 
  const settings = loadSettings();
  const apiKey = settings.apiConfig?.frameApiKey || settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
  try {
    const resp = await fetch('https://khunganh.nodns.vn/api/v1/frame', {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ identifier: identifier })
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      return res.status(resp.status || 500).json({ status: 'error', message: data?.message || 'Gỡ khung thất bại!' });
    }
 
    addFrameLog({
      action: 'USER_REMOVE_FRAME',
      identifier: identifier,
      actor: 'Khách hàng',
      status: 'SUCCESS'
    });
 
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ status: 'error', message: 'Lỗi kết nối gỡ khung: ' + e.message });
  }
});
 
// ============================================================
// 5. ADMIN FRAME MANAGEMENT APIS (QUẢN LÝ TOÀN BỘ HỆ THỐNG KHUNG)
// ============================================================
 
// 5.1. Lấy toàn bộ dữ liệu quản lý khung: Gallery, Khung riêng, Cài đặt, Nhật ký
app.get('/api/admin/frames/data', requireAdmin, async (req, res) => {
  const settings = loadSettings();
  const apiKey = settings.apiConfig?.frameApiKey || settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
 
  let gallery = [];
  let apiStatus = 'ONLINE';
  let apiError = null;
 
  try {
    const resp = await fetch('https://khunganh.nodns.vn/api/v1/frame/gallery', {
      headers: { 'x-api-key': apiKey, 'User-Agent': BROWSER_USER_AGENT }
    });
    const data = await resp.json().catch(() => null);
    if (resp.ok && data && Array.isArray(data.data?.frames)) {
      gallery = data.data.frames;
    } else {
      apiStatus = 'API_ERROR';
      apiError = data?.message || 'Không thể lấy gallery từ khunganh.nodns.vn';
    }
  } catch (err) {
    apiStatus = 'OFFLINE';
    apiError = err.message;
  }
 
  const frameSettings = settings.frameSettings || {
    enabled: true,
    allowCustomUpload: true,
    requireGold: false,
    maxUploadMb: 8,
    noticeMessage: ''
  };
 
  const customFrames = settings.customFrames || [];
  const hiddenFrames = settings.hiddenFrames || [];
  const logs = settings.frameLogs || [];
 
  return res.json({
    ok: true,
    data: {
      apiStatus,
      apiError,
      apiKey: apiKey ? (apiKey.slice(0, 8) + '...' + apiKey.slice(-4)) : '',
      fullApiKey: apiKey,
      frameSettings,
      customFrames,
      hiddenFrames,
      gallery,
      totalFramesCount: gallery.length + customFrames.length,
      logs
    }
  });
});
 
// 5.2. Lưu cài đặt hệ thống khung
app.post('/api/admin/frames/settings', requireAdmin, async (req, res) => {
  const { frameSettings, frameApiKey } = req.body || {};
  const settings = loadSettings();
 
  if (frameSettings && typeof frameSettings === 'object') {
    settings.frameSettings = {
      ...(settings.frameSettings || {}),
      ...frameSettings
    };
  }
 
  if (typeof frameApiKey === 'string') {
    if (!settings.apiConfig) settings.apiConfig = {};
    settings.apiConfig.frameApiKey = frameApiKey.trim();
  }
 
  if (await saveSettings(settings)) {
    return res.json({ ok: true, message: 'Đã lưu cấu hình quản lý khung thành công!' });
  }
  return res.status(500).json({ ok: false, message: 'Lỗi ghi cấu hình khung!' });
});
 
// 5.3. Thêm mẫu khung mới vào kho (Admin tải lên hoặc dán URL)
app.post('/api/admin/frames/gallery/add', requireAdmin, async (req, res) => {
  const { name, url, image, isVip } = req.body || {};
  if (!name || (!url && !image)) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập tên khung và cung cấp ảnh!' });
  }
 
  const settings = loadSettings();
  if (!Array.isArray(settings.customFrames)) settings.customFrames = [];
 
  const newFrame = {
    id: 'frame_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name.trim().slice(0, 50),
    url: url || image,
    isVip: !!isVip,
    createdAt: new Date().toISOString()
  };
 
  settings.customFrames.unshift(newFrame);
 
  if (await saveSettings(settings)) {
    addFrameLog({
      action: 'ADMIN_ADD_FRAME',
      details: `Thêm mẫu khung mới: ${newFrame.name}`,
      actor: 'Admin',
      status: 'SUCCESS'
    });
    return res.json({ ok: true, message: 'Đã thêm mẫu khung mới vào kho thành công!', frame: newFrame });
  }
  return res.status(500).json({ ok: false, message: 'Lỗi lưu mẫu khung!' });
});
 
// 5.4. Xóa / Ẩn mẫu khung khỏi kho (Hỗ trợ xóa khung riêng Shop và ẩn khung cộng đồng)
app.post('/api/admin/frames/gallery/delete', requireAdmin, async (req, res) => {
  const { id, url, name } = req.body || {};
  if (!id && !url) return res.status(400).json({ ok: false, message: 'Thiếu ID hoặc URL mẫu khung cần xóa!' });
 
  const settings = loadSettings();
  if (!Array.isArray(settings.customFrames)) settings.customFrames = [];
  if (!Array.isArray(settings.hiddenFrames)) settings.hiddenFrames = [];
 
  let deleted = false;
  let frameName = name || 'Khung Widget';
 
  // 1. Nếu có ID hoặc URL trùng với khung riêng Shop
  if (id) {
    const found = settings.customFrames.find(f => f.id === id);
    if (found) frameName = found.name;
    const initialLen = settings.customFrames.length;
    settings.customFrames = settings.customFrames.filter(f => f.id !== id);
    if (settings.customFrames.length !== initialLen) {
      deleted = true;
    }
  }
 
  // 2. Nếu có URL (Xóa khỏi customFrames và đưa vào hiddenFrames để ẩn vĩnh viễn khỏi trang khách)
  if (url) {
    const initialLenCustom = settings.customFrames.length;
    settings.customFrames = settings.customFrames.filter(f => f.url !== url);
    if (settings.customFrames.length !== initialLenCustom) {
      deleted = true;
    }
 
    if (!settings.hiddenFrames.includes(url)) {
      settings.hiddenFrames.push(url);
      deleted = true;
    }
  }
 
  if (deleted) {
    await saveSettings(settings);
    addFrameLog({
      action: 'ADMIN_DELETE_FRAME',
      details: `Xóa mẫu khung: ${frameName}`,
      actor: 'Admin',
      status: 'SUCCESS'
    });
    return res.json({ ok: true, message: `Đã xóa mẫu khung "${frameName}" khỏi hệ thống thành công!` });
  }
  return res.status(404).json({ ok: false, message: 'Không tìm thấy mẫu khung cần xóa!' });
});
 
// 5.4.1. Khôi phục hiển thị mẫu khung đã xóa / ẩn
app.post('/api/admin/frames/gallery/restore', requireAdmin, async (req, res) => {
  const { url, name } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, message: 'Thiếu URL mẫu khung cần khôi phục!' });
 
  const settings = loadSettings();
  if (!Array.isArray(settings.hiddenFrames)) settings.hiddenFrames = [];
 
  const initialLen = settings.hiddenFrames.length;
  settings.hiddenFrames = settings.hiddenFrames.filter(u => u !== url);
 
  if (settings.hiddenFrames.length !== initialLen) {
    await saveSettings(settings);
    addFrameLog({
      action: 'ADMIN_RESTORE_FRAME',
      details: `Khôi phục mẫu khung: ${name || url}`,
      actor: 'Admin',
      status: 'SUCCESS'
    });
    return res.json({ ok: true, message: `Đã khôi phục hiển thị mẫu khung thành công!` });
  }
  return res.status(404).json({ ok: false, message: 'Mẫu khung không nằm trong danh sách đã xóa / ẩn!' });
});
 
// 5.5. Admin thao tác trực tiếp lên tài khoản khách (Gán khung / Gỡ khung)
app.post('/api/admin/frames/user-action', requireAdmin, async (req, res) => {
  const { action, identifier: rawId, frameUrl, image, name } = req.body || {};
  const identifier = cleanLocketUsername(rawId || '');
  if (!identifier) {
    return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp username hoặc UID Locket!' });
  }
 
  const settings = loadSettings();
  const apiKey = settings.apiConfig?.frameApiKey || settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
 
  if (action === 'set') {
    if (!frameUrl && !image) {
      return res.status(400).json({ ok: false, message: 'Vui lòng chọn khung từ gallery hoặc tải ảnh khung lên!' });
    }
 
    try {
      const payload = {
        identifier: identifier,
        name: (name || 'Khung Admin Gán').trim().slice(0, 40)
      };
      if (image) payload.image = image;
      if (frameUrl) payload.frameUrl = frameUrl;
 
      // Tự động chuyển đổi ảnh local thành base64 nếu frameUrl là đường dẫn nội bộ máy chủ
      if (payload.frameUrl && !payload.image) {
        if (payload.frameUrl.startsWith('/images/') || payload.frameUrl.startsWith('images/')) {
          const localRel = payload.frameUrl.replace(/^\//, '');
          const localAbs = path.join(ROOT_DIR, localRel);
          if (fs.existsSync(localAbs)) {
            const buf = fs.readFileSync(localAbs);
            payload.image = `data:image/png;base64,${buf.toString('base64')}`;
            delete payload.frameUrl;
          }
        }
      }
 
      const resp = await fetch('https://khunganh.nodns.vn/api/v1/frame', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || data.status !== 'success') {
        return res.status(400).json({ ok: false, message: data?.message || 'Không thể đổi khung cho tài khoản này!' });
      }
 
      addFrameLog({
        action: 'ADMIN_SET_FRAME',
        identifier,
        frameName: name || 'Khung tùy biến',
        actor: 'Admin',
        status: 'SUCCESS'
      });
 
      return res.json({ ok: true, message: `Đã gán khung thành công cho tài khoản @${identifier}!`, data: data.data });
    } catch (err) {
      return res.status(502).json({ ok: false, message: 'Lỗi kết nối máy chủ gán khung: ' + err.message });
    }
  } else if (action === 'remove') {
    try {
      const resp = await fetch('https://khunganh.nodns.vn/api/v1/frame', {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ identifier })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || data.status !== 'success') {
        return res.status(400).json({ ok: false, message: data?.message || 'Không thể gỡ khung cho tài khoản này!' });
      }
 
      addFrameLog({
        action: 'ADMIN_REMOVE_FRAME',
        identifier,
        actor: 'Admin',
        status: 'SUCCESS'
      });
 
      return res.json({ ok: true, message: `Đã gỡ khung thành công cho tài khoản @${identifier} về mặc định!` });
    } catch (err) {
      return res.status(502).json({ ok: false, message: 'Lỗi kết nối máy chủ gỡ khung: ' + err.message });
    }
  } else {
    return res.status(400).json({ ok: false, message: 'Hành động không hợp lệ!' });
  }
});
 
// 5.6. Dọn sạch nhật ký đổi khung
app.post('/api/admin/frames/logs/clear', requireAdmin, async (req, res) => {
  const settings = loadSettings();
  settings.frameLogs = [];
  await saveSettings(settings);
  return res.json({ ok: true, message: 'Đã dọn sạch nhật ký đổi khung!' });
});
 
// ============================================================
// 6. ADMIN API (BẢO VỆ MẬT KHẨU & PHIÊN LÀM VIỆC CAO CẤP)
// ============================================================
 
// Đăng nhập Admin
app.post('/api/admin/login', async (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const bruteCheck = checkBruteForce(clientIp);
  if (!bruteCheck.allowed) {
    return res.status(429).json({ ok: false, message: bruteCheck.message });
  }
 
  const { password } = req.body || {};
  const settings = loadSettings();
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const currentPass = process.env.ADMIN_PASSWORD || settings.adminPassword || (isProduction ? '' : 'admin123');
 
  if (!currentPass) {
    return res.status(503).json({ ok: false, message: 'Chưa cấu hình ADMIN_PASSWORD trên server!' });
  }
 
  if (!password || password !== currentPass) {
    recordFailedLogin(clientIp);
    // Delay 800ms để chống timing attack & brute force tự động
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ ok: false, message: 'Mật khẩu quản trị viên không chính xác!' });
  }
 
  recordSuccessfulLogin(clientIp);
  const token = 'adm_' + crypto.randomBytes(32).toString('hex');
  activeAdminTokens.add(token);
  await saveSessions(activeAdminTokens);
 
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isHttps ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', `admin_session=${token}; ${cookieFlags}`);
 
  console.log(`[ADMIN] ✅ Đăng nhập thành công từ IP: ${clientIp}`);
  return res.json({ ok: true, token: token, message: 'Đăng nhập thành công!' });
});
 
// Đăng xuất Admin
app.all(['/api/admin/logout', '/admin/logout'], async (req, res) => {
  const token = extractAdminToken(req);
  if (token) {
    activeAdminTokens.delete(token);
    await saveSessions(activeAdminTokens);
  }
 
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isHttps ? '; Secure' : ''}`);
 
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.json({ ok: true, message: 'Đã đăng xuất thành công!' });
  }
  return res.redirect('/admin');
});
 
// Đổi mật khẩu Admin an toàn (Xác thực mật khẩu hiện tại)
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const settings = loadSettings();
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const currentPass = process.env.ADMIN_PASSWORD || settings.adminPassword || (isProduction ? '' : 'admin123');
 
  if (!currentPassword || currentPassword !== currentPass) {
    return res.status(401).json({ ok: false, message: 'Mật khẩu hiện tại không chính xác!' });
  }
 
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ ok: false, message: 'Mật khẩu mới phải từ 6 ký tự trở lên!' });
  }
 
  settings.adminPassword = newPassword;
  if (await saveSettings(settings)) {
    // Thu hồi tất cả phiên cũ, tạo phiên mới cho phiên hiện tại
    activeAdminTokens.clear();
    const token = 'adm_' + crypto.randomBytes(32).toString('hex');
    activeAdminTokens.add(token);
    await saveSessions(activeAdminTokens);
 
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isHttps ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', `admin_session=${token}; ${cookieFlags}`);
 
    console.log('[ADMIN] 🔐 Đã cập nhật mật khẩu Admin mới thành công');
    return res.json({ ok: true, token, message: 'Đổi mật khẩu thành công! Tất cả các phiên khác đã đăng xuất an toàn.' });
  }
 
  return res.status(500).json({ ok: false, message: 'Không thể lưu mật khẩu mới!' });
});
 
// Thống kê tổng quan Overview
app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  const orders = loadOrders();
  const settings = loadSettings();
 
  const totalOrders = orders.length;
  const activatedOrders = orders.filter(o => o.status === 'ACTIVATED').length;
  const pendingOrders = orders.filter(o => o.status === 'PENDING').length;
 
  let totalRevenue = 0;
  let todayRevenue = 0;
  const todayStr = new Date().toISOString().split('T')[0];
 
  orders.forEach(o => {
    if (o.status === 'ACTIVATED' || o.status === 'PAID') {
      const amt = Number(o.amount) || 0;
      totalRevenue += amt;
      if (o.createdAt && o.createdAt.startsWith(todayStr)) {
        todayRevenue += amt;
      }
    }
  });
 
  const vipCount = orders.filter(o => o.planType === 'vip' && (o.status === 'ACTIVATED' || o.status === 'PAID')).length;
  const regularCount = orders.filter(o => o.planType === 'regular' && (o.status === 'ACTIVATED' || o.status === 'PAID')).length;
 
  // Lấy live balance và quota từ Kawaii API
  let kawaiiInfo = null;
  try {
    const kRes = await fetch('https://ctv.nodns.vn/api/v1/ctv/me', {
      headers: {
        'x-api-key': settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '',
        'User-Agent': BROWSER_USER_AGENT
      }
    });
    if (kRes.ok) {
      const kData = await kRes.json();
      kawaiiInfo = kData.data || null;
    }
  } catch (e) {
    // ignore
  }
 
  res.json({
    ok: true,
    data: {
      totalRevenue,
      todayRevenue,
      totalOrders,
      activatedOrders,
      pendingOrders,
      vipCount,
      regularCount,
      kawaiiInfo
    }
  });
});
 
// Lấy toàn bộ Settings (Bảo mật: không bao giờ gửi mật khẩu admin về client)
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = loadSettings();
  const sanitized = { ...settings };
  delete sanitized.adminPassword;
  sanitized.hasAdminPassword = !!(settings.adminPassword || process.env.ADMIN_PASSWORD);
  res.json({ ok: true, data: sanitized });
});
 
// Cập nhật Settings (Chặn sửa adminPassword qua route này)
app.post('/api/admin/settings', requireAdmin, async (req, res) => {
  const newSettings = req.body;
  if (!newSettings || typeof newSettings !== 'object') {
    return res.status(400).json({ ok: false, message: 'Dữ liệu không hợp lệ!' });
  }
 
  // Không cho phép đổi mật khẩu admin qua route settings thông thường
  delete newSettings.adminPassword;
 
  const current = loadSettings();
  const merged = { ...current, ...newSettings };
 
  if (await saveSettings(merged)) {
    console.log('[ADMIN] ✅ Cập nhật settings thành công');
    return res.json({ ok: true, message: 'Đã lưu cấu hình thành công!' });
  }
 
  return res.status(500).json({ ok: false, message: 'Lỗi ghi file cấu hình!' });
});
 
// ============================================================
// ADMIN: QUẢN LÝ MÃ GIẢM GIÁ (COUPONS)
// ============================================================
 
// 1. Lấy danh sách mã giảm giá & thống kê
app.get('/api/admin/coupons', requireAdmin, (req, res) => {
  const settings = loadSettings();
  const coupons = settings.coupons || [];
 
  const totalCoupons = coupons.length;
  const activeCoupons = coupons.filter(c => c.isActive).length;
  const totalUsed = coupons.reduce((sum, c) => sum + (Number(c.usedCount) || 0), 0);
 
  res.json({
    ok: true,
    data: {
      coupons,
      stats: {
        totalCoupons,
        activeCoupons,
        totalUsed
      }
    }
  });
});
 
// 2. Thêm hoặc Sửa mã giảm giá
app.post('/api/admin/coupons/save', requireAdmin, async (req, res) => {
  const couponData = req.body || {};
  const code = String(couponData.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
 
  if (!code) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập mã giảm giá (Mã Code)!' });
  }
 
  const name = String(couponData.name || '').trim() || `Mã giảm giá ${code}`;
  const type = couponData.type === 'percent' ? 'percent' : 'fixed';
  const value = Number(couponData.value) || 0;
  if (value <= 0) {
    return res.status(400).json({ ok: false, message: 'Mức giảm giá phải lớn hơn 0!' });
  }
  if (type === 'percent' && value > 100) {
    return res.status(400).json({ ok: false, message: 'Giảm theo phần trăm không được vượt quá 100%!' });
  }
 
  const maxDiscount = Number(couponData.maxDiscount) || 0;
  const minOrder = Number(couponData.minOrder) || 0;
  const applicablePlans = couponData.applicablePlans || 'all'; // 'all', 'vip', 'regular', or specific planId
  const usageLimit = Number(couponData.usageLimit) || 0;
  const startDate = couponData.startDate ? String(couponData.startDate).trim() : '';
  const endDate = couponData.endDate ? String(couponData.endDate).trim() : '';
  const isActive = typeof couponData.isActive === 'boolean' ? couponData.isActive : true;
 
  const settings = loadSettings();
  if (!Array.isArray(settings.coupons)) settings.coupons = [];
 
  const id = couponData.id || `coup_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const existingIdx = settings.coupons.findIndex(c => c.id === id || String(c.code).trim().toUpperCase() === code);
 
  const newCoupon = {
    id: (existingIdx > -1) ? settings.coupons[existingIdx].id : id,
    code,
    name,
    type,
    value,
    maxDiscount,
    minOrder,
    applicablePlans,
    usageLimit,
    usedCount: (existingIdx > -1) ? (Number(settings.coupons[existingIdx].usedCount) || 0) : 0,
    startDate,
    endDate,
    isActive,
    createdAt: (existingIdx > -1) ? (settings.coupons[existingIdx].createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
 
  if (existingIdx > -1) {
    settings.coupons[existingIdx] = newCoupon;
  } else {
    settings.coupons.unshift(newCoupon);
  }
 
  if (await saveSettings(settings)) {
    console.log(`[ADMIN] ✅ Lưu mã giảm giá: ${code} - ${name} (${type === 'percent' ? value + '%' : value.toLocaleString('vi-VN') + 'đ'})`);
    return res.json({ ok: true, message: `Đã lưu mã giảm giá "${code}" thành công!`, coupon: newCoupon });
  }
 
  res.status(500).json({ ok: false, message: 'Lỗi ghi file dữ liệu!' });
});
 
// 3. Bật / Tắt trạng thái mã giảm giá nhanh
app.post('/api/admin/coupons/toggle', requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, message: 'Thiếu ID mã giảm giá!' });
 
  const settings = loadSettings();
  const coupon = (settings.coupons || []).find(c => c.id === id);
  if (!coupon) return res.status(404).json({ ok: false, message: 'Không tìm thấy mã giảm giá!' });
 
  coupon.isActive = !coupon.isActive;
  coupon.updatedAt = new Date().toISOString();
 
  if (await saveSettings(settings)) {
    return res.json({
      ok: true,
      message: `Đã ${coupon.isActive ? 'kích hoạt' : 'tạm dừng'} mã "${coupon.code}"!`,
      isActive: coupon.isActive
    });
  }
 
  res.status(500).json({ ok: false, message: 'Lỗi ghi file dữ liệu!' });
});
 
// 4. Xóa mã giảm giá
app.post('/api/admin/coupons/delete', requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, message: 'Thiếu ID mã giảm giá!' });
 
  const settings = loadSettings();
  const beforeLen = (settings.coupons || []).length;
  settings.coupons = (settings.coupons || []).filter(c => c.id !== id);
 
  if (settings.coupons.length < beforeLen) {
    await saveSettings(settings);
    return res.json({ ok: true, message: 'Đã xóa mã giảm giá thành công!' });
  }
 
  res.status(404).json({ ok: false, message: 'Không tìm thấy mã giảm giá để xóa!' });
});
 
// Cập nhật cài đặt chức năng trang khách hàng
app.post('/api/admin/customer-features', requireAdmin, async (req, res) => {
  const newFeatures = req.body;
  if (!newFeatures || typeof newFeatures !== 'object') {
    return res.status(400).json({ ok: false, message: 'Dữ liệu không hợp lệ!' });
  }
 
  const settings = loadSettings();
  settings.customerFeatures = {
    ...(settings.customerFeatures || {}),
    ...newFeatures
  };
 
  // Cập nhật cả marqueeNotice nếu có
  if (typeof newFeatures.marqueeNotice === 'string') {
    settings.marqueeNotice = newFeatures.marqueeNotice;
  }
 
  if (await saveSettings(settings)) {
    console.log('[ADMIN] ✅ Đã lưu cấu hình chức năng trang khách hàng');
    return res.json({
      ok: true,
      message: 'Đã lưu cấu hình chức năng trang khách hàng thành công!',
      customerFeatures: settings.customerFeatures
    });
  }
 
  return res.status(500).json({ ok: false, message: 'Lỗi ghi file cấu hình!' });
});
 
// Lấy danh sách đơn hàng cho Admin (Tự động quét hết hạn 3 phút)
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = loadOrders();
  res.json({ ok: true, orders: orders });
});
 
// Dọn dẹp toàn bộ đơn đã hủy / hết hạn cho Admin
app.post('/api/admin/orders/cleanup-cancelled', requireAdmin, async (req, res) => {
  let orders = loadOrders();
  const beforeCount = orders.length;
  orders = orders.filter(o => o.status !== 'CANCELLED');
  const removedCount = beforeCount - orders.length;
  await saveOrders(orders);
  return res.json({ ok: true, message: `Đã dọn dẹp ${removedCount} đơn đã hủy / hết hạn thành công!`, remainingCount: orders.length });
});
 
app.post('/api/admin/order/mark-paid', requireAdmin, async (req, res) => {
  const { orderId } = req.body || {};
  const orders = loadOrders();
  const order = orders.find(o => o.id === orderId || o.orderCode === orderId);
 
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn hàng!' });
  }
  if (order.status !== 'PENDING') {
    return res.status(400).json({ ok: false, message: 'Chỉ xác nhận thanh toán cho đơn đang chờ thanh toán!' });
  }
 
  order.status = 'PAID';
  order.paymentRef = `ADMIN_${Date.now()}`;
  order.paidAt = new Date().toISOString();
  if (!(await saveOrders(orders))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu trạng thái đơn hàng!' });
  }
 
  return res.json({ ok: true, message: 'Đã xác nhận đã nhận tiền. Có thể kích hoạt đơn hàng.', order });
});
 
// Kích hoạt thủ công 1-Click
app.post('/api/admin/order/manual-activate', requireAdmin, async (req, res) => {
  const { orderId } = req.body || {};
  const orders = loadOrders();
  const order = orders.find(o => o.id === orderId || o.orderCode === orderId);
 
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn hàng!' });
  }
  if (order.status !== 'PAID') {
    return res.status(400).json({ ok: false, message: 'Cần xác nhận đã nhận thanh toán trước khi kích hoạt!' });
  }
 
  const result = await executeActivation(order);
  if (!(await saveOrders(orders))) {
    return res.status(500).json({ ok: false, message: 'Kích hoạt đã được gửi nhưng không lưu được trạng thái đơn hàng!', order });
  }
 
  if (result.success) {
    return res.json({ ok: true, message: 'Kích hoạt đơn hàng thành công!', order: order });
  } else {
    return res.status(400).json({ ok: false, message: result.error || 'Kích hoạt thất bại. Vui lòng kiểm tra số dư ví hoặc API Key!', order: order });
  }
});
 
// Cập nhật trạng thái đơn (Đã duyệt / Hủy)
app.post('/api/admin/order/update-status', requireAdmin, async (req, res) => {
  const { orderId, status } = req.body || {};
  const orders = loadOrders();
  const order = orders.find(o => o.id === orderId || o.orderCode === orderId);
 
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn hàng!' });
  }
 
  order.status = status;
  if (!(await saveOrders(orders))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu trạng thái đơn hàng!' });
  }
 
  res.json({ ok: true, message: 'Đã cập nhật trạng thái đơn hàng!', order: order });
});
 
// Xoá đơn hàng
app.post('/api/admin/order/delete', requireAdmin, async (req, res) => {
  const { orderId } = req.body || {};
  let orders = loadOrders();
  const beforeLen = orders.length;
  orders = orders.filter(o => o.id !== orderId && o.orderCode !== orderId);
 
  if (orders.length === beforeLen) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy đơn để xoá!' });
  }
 
  if (!(await saveOrders(orders))) {
    return res.status(500).json({ ok: false, message: 'Không thể xóa đơn hàng!' });
  }
  res.json({ ok: true, message: 'Đã xoá đơn hàng thành công!' });
});
 
// Nút Test API Key Kawaii
app.post('/api/admin/test-kawaii', requireAdmin, async (req, res) => {
  const { apiKey } = req.body || {};
  const settings = loadSettings();
  const keyToTest = apiKey || settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
 
  try {
    const kRes = await fetch('https://ctv.nodns.vn/api/v1/ctv/me', {
      headers: { 'x-api-key': keyToTest, 'User-Agent': BROWSER_USER_AGENT }
    });
 
    const kData = await kRes.json();
    if (kRes.ok && kData.status === 'success') {
      return res.json({
        ok: true,
        message: 'Kết nối API Kawaii thành công!',
        data: kData.data
      });
    } else {
      return res.status(400).json({
        ok: false,
        message: kData.error || kData.message || 'Key không hợp lệ hoặc bị khoá!',
        data: kData
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Lỗi kết nối máy chủ Kawaii: ' + err.message });
  }
});
 
// Nút Test API Key Cụ Cam
app.post('/api/admin/test-cucam', requireAdmin, async (req, res) => {
  const { apiKey, apiBase } = req.body || {};
  const settings = loadSettings();
  const keyToTest = apiKey || settings.apiConfig?.cucamApiKey || '';
  const baseToTest = apiBase || settings.apiConfig?.cucamApiBase || 'https://locket.2707226.xyz';
 
  try {
    const resPackages = await fetch(`${baseToTest}/api/packages`, {
      headers: { 'Authorization': `Bearer ${keyToTest}` }
    });
    const pData = await resPackages.json().catch(() => ({}));
    if (resPackages.ok && pData.ok) {
      return res.json({
        ok: true,
        message: 'Kết nối API Cụ Cam thành công!',
        data: pData.data
      });
    } else {
      return res.status(400).json({
        ok: false,
        message: pData.message || 'Key Cụ Cam không hợp lệ hoặc bị từ chối!',
        data: pData
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Lỗi kết nối máy chủ Cụ Cam: ' + err.message });
  }
});
 
// ============================================================
// QUẢN LÝ ẢNH SHOWROOM VIP (UPLOAD & GALLERY CRUD)
// ============================================================
 
// 1. Tải ảnh lên server (Base64)
app.post('/api/admin/upload-image', requireAdmin, (req, res) => {
  try {
    const { base64Data, filename } = req.body || {};
    if (!base64Data) {
      return res.status(400).json({ ok: false, message: 'Dữ liệu ảnh không hợp lệ!' });
    }
 
    let ext = '.jpg';
    let cleanBase64 = base64Data;
    if (base64Data.startsWith('data:image/png;base64,')) {
      ext = '.png';
      cleanBase64 = base64Data.replace('data:image/png;base64,', '');
    } else if (base64Data.startsWith('data:image/jpeg;base64,') || base64Data.startsWith('data:image/jpg;base64,')) {
      ext = '.jpg';
      cleanBase64 = base64Data.replace(/^data:image\/(jpeg|jpg);base64,/, '');
    } else if (base64Data.startsWith('data:image/webp;base64,')) {
      ext = '.webp';
      cleanBase64 = base64Data.replace('data:image/webp;base64,', '');
    } else if (base64Data.includes(';base64,')) {
      cleanBase64 = base64Data.split(';base64,')[1];
    }
 
    const imagesDir = path.join(ROOT_DIR, 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
 
    const uniqueName = `filter-${Date.now()}-${Math.floor(Math.random() * 1000)}${ext}`;
    const targetPath = path.join(imagesDir, uniqueName);
 
    const buffer = Buffer.from(cleanBase64, 'base64');
    fs.writeFileSync(targetPath, buffer);
 
    console.log('[ADMIN] ✅ Upload ảnh filter thành công:', uniqueName);
    return res.json({ ok: true, imageUrl: `images/${uniqueName}`, filename: uniqueName });
  } catch (err) {
    console.error('[ADMIN] Lỗi upload ảnh:', err);
    return res.status(500).json({ ok: false, message: 'Lỗi lưu ảnh: ' + err.message });
  }
});
 
// 2. Thêm ảnh vào VIP Gallery
app.post('/api/admin/gallery/add', requireAdmin, async (req, res) => {
  try {
    const { title, tag, imageUrl, caption } = req.body || {};
    if (!imageUrl || !title) {
      return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp link ảnh và tiêu đề!' });
    }
 
    const settings = loadSettings();
    if (!Array.isArray(settings.vipGallery)) {
      settings.vipGallery = [];
    }
 
    const newItem = {
      id: 'gallery_' + Date.now(),
      title: title.trim(),
      tag: (tag || 'HOT TREND').trim(),
      imageUrl: imageUrl.trim(),
      caption: (caption || '').trim(),
      createdAt: new Date().toISOString()
    };
 
    settings.vipGallery.push(newItem);
    if (!(await saveSettings(settings))) {
      return res.status(500).json({ ok: false, message: 'Không thể lưu ảnh vào showroom!' });
    }
 
    return res.json({ ok: true, message: 'Đã thêm ảnh vào showroom VIP thành công!', item: newItem, gallery: settings.vipGallery });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});
 
// 3. Xóa ảnh khỏi VIP Gallery
app.post('/api/admin/gallery/delete', requireAdmin, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ ok: false, message: 'Thiếu ID ảnh cần xóa!' });
    }
 
    const settings = loadSettings();
    if (!Array.isArray(settings.vipGallery)) {
      settings.vipGallery = [];
    }
 
    settings.vipGallery = settings.vipGallery.filter(item => item.id !== id);
    if (!(await saveSettings(settings))) {
      return res.status(500).json({ ok: false, message: 'Không thể lưu thay đổi showroom!' });
    }
 
    return res.json({ ok: true, message: 'Đã xóa ảnh khỏi showroom VIP!', gallery: settings.vipGallery });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});
 
// ============================================================
// CTV PORTAL APIS (LUỒNG ĐĂNG KÝ, ĐĂNG NHẬP, NẠP TIỀN, KÍCH KHÁCH)
// ============================================================
 
// 1. Đăng ký tài khoản CTV mới
app.post('/api/ctv/register', async (req, res) => {
  const { username, password, email: rawEmail } = req.body || {};
  const settings = loadSettings();
  if (settings.ctvSettings && settings.ctvSettings.allowRegister === false) {
    return res.status(403).json({ ok: false, message: 'Hệ thống hiện đang tạm đóng đăng ký CTV mới!' });
  }
 
  const cleanUser = cleanLocketUsername(username || '');
  if (!cleanUser || cleanUser.length < 3) {
    return res.status(400).json({ ok: false, message: 'Tên đăng nhập phải từ 3 ký tự trở lên (không dấu)!' });
  }
  const email = String(rawEmail || '').trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập đúng địa chỉ email hợp lệ (ví dụ: yourname@gmail.com)!' });
  }
 
  const hasLetter = /[a-zA-Z]/.test(password || '');
  const hasDigit = /[0-9]/.test(password || '');
  if (!password || password.length < 6 || !hasLetter || !hasDigit) {
    return res.status(400).json({
      ok: false,
      message: 'Mật khẩu phải từ 6 ký tự trở lên và bao gồm cả chữ cái và chữ số (ví dụ: Matkhau123)!'
    });
  }
 
  const users = loadCtvUsers();
  if (users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase())) {
    return res.status(400).json({ ok: false, message: 'Tên đăng nhập này đã có người sử dụng!' });
  }
  if (users.find(u => (u.email || '').toLowerCase() === email)) {
    return res.status(400).json({ ok: false, message: 'Email này đã được dùng cho một tài khoản CTV khác!' });
  }
 
  const newCtv = {
    username: cleanUser,
    email: email,
    password: password,
    fullName: cleanUser,
    phone: '',
    balance: 0,
    coins: 0,
    status: 'PENDING_ACTIVATION',
    firstDepositDone: false,
    createdAt: new Date().toISOString()
  };
 
  users.push(newCtv);
  if (!(await saveCtvUsers(users))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu tài khoản CTV!' });
  }
 
  const token = 'ctv_tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  activeCtvTokens.set(token, cleanUser);
 
  return res.json({
    ok: true,
    message: 'Đăng ký tài khoản CTV thành công! Vui lòng nạp tối thiểu 150.000đ để kích hoạt tài khoản.',
    token: token,
    requireActivation: true,
    user: {
      username: newCtv.username,
      email: newCtv.email,
      fullName: newCtv.fullName,
      balance: newCtv.balance,
      coins: newCtv.coins,
      status: newCtv.status,
      firstDepositDone: false
    }
  });
});
 
// 2. Đăng nhập CTV
app.post('/api/ctv/login', (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = cleanLocketUsername(username || '');
  if (!cleanUser || !password) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu!' });
  }
 
  const users = loadCtvUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase() && u.password === password);
  if (!user) {
    return res.status(401).json({ ok: false, message: 'Sai tên đăng nhập hoặc mật khẩu CTV!' });
  }
 
  if (user.status === 'BLOCKED') {
    return res.status(403).json({ ok: false, message: 'Tài khoản CTV này đã bị khóa!' });
  }
 
  const token = 'ctv_tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  activeCtvTokens.set(token, user.username);
 
  const isActivated = user.firstDepositDone !== false && user.status !== 'PENDING_ACTIVATION';
 
  return res.json({
    ok: true,
    message: 'Đăng nhập thành công!',
    token: token,
    requireActivation: !isActivated,
    user: {
      username: user.username,
      email: user.email || '',
      fullName: user.fullName || user.username,
      phone: user.phone || '',
      balance: user.balance || 0,
      coins: user.coins || 0,
      status: user.status || 'ACTIVE',
      firstDepositDone: user.firstDepositDone !== false
    }
  });
});
 
// 3. Lấy thông tin tài khoản CTV hiện tại & Cấu hình tabs
app.get('/api/ctv/me', requireCtv, (req, res) => {
  const settings = loadSettings();
  const ctvSettings = settings.ctvSettings || {
    allowRegister: true,
    tabLocket: true,
    tabVipFilter: true,
    tabSpotify: true,
    wholesalePlans: []
  };
 
  ctvSettings.dnsLinkRegular = settings.dnsLinkRegular || '/profile';
  ctvSettings.dnsLinkVip = settings.dnsLinkVip || '/profile';
 
  const isActivated = req.ctvUser.firstDepositDone !== false && req.ctvUser.status !== 'PENDING_ACTIVATION';
 
  return res.json({
    ok: true,
    requireActivation: !isActivated,
    user: {
      username: req.ctvUser.username,
      email: req.ctvUser.email || '',
      fullName: req.ctvUser.fullName || req.ctvUser.username,
      phone: req.ctvUser.phone || '',
      balance: req.ctvUser.balance || 0,
      coins: req.ctvUser.coins || Math.floor((req.ctvUser.balance || 0) / 1000),
      status: req.ctvUser.status || 'ACTIVE',
      firstDepositDone: req.ctvUser.firstDepositDone !== false
    },
    settings: ctvSettings
  });
});
 
// 4. Tạo yêu cầu nạp tiền VietQR cho CTV
app.post('/api/ctv/deposit/create', requireCtv, async (req, res) => {
  const { amount } = req.body || {};
  const numAmount = parseInt(amount, 10);
 
  const isActivated = req.ctvUser.firstDepositDone !== false && req.ctvUser.status !== 'PENDING_ACTIVATION';
  const minRequired = isActivated ? 50000 : 150000;
 
  if (!numAmount || numAmount < minRequired) {
    if (!isActivated) {
      return res.status(400).json({ ok: false, message: 'Số tiền nạp kích hoạt tài khoản CTV lần đầu tối thiểu là 150.000đ (150k)!' });
    } else {
      return res.status(400).json({ ok: false, message: 'Số tiền nạp tối thiểu là 50.000đ (50k)!' });
    }
  }
 
  const settings = loadSettings();
  const bank = settings.bankInfo || {
    bankId: 'VPBANK',
    bankName: 'VPBank',
    accountNumber: '2027022007',
    accountName: 'NGUYEN MINH HIEP',
    memoPrefix: 'VIPCAM'
  };
 
  // Nội dung nạp tiền ngắn gọn (chỉ 7 ký tự: NAP + 4 số, ví dụ NAP9542)
  // Không chứa dấu cách, không kèm username dài để tránh xung đột hoặc lỗi app ngân hàng
  const ctvMemoPrefix = settings.ctvSettings?.depositPrefix || 'NAP';
  const depositCode = ctvMemoPrefix + Math.floor(1000 + Math.random() * 9000);
  const memo = depositCode;
  const qrUrl = `https://img.vietqr.io/image/${bank.bankId}-${bank.accountNumber}-compact2.png?amount=${numAmount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(bank.accountName)}`;
 
  const depositOrder = {
    id: 'DEP_' + Date.now(),
    depositCode: depositCode,
    username: req.ctvUser.username,
    amount: numAmount,
    coins: Math.floor(numAmount / 1000),
    memo: memo,
    qrUrl: qrUrl,
    bankInfo: bank,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
 
  const deposits = loadCtvDeposits();
  deposits.unshift(depositOrder);
  if (!(await saveCtvDeposits(deposits))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu yêu cầu nạp tiền!' });
  }
 
  return res.json({
    ok: true,
    deposit: depositOrder
  });
});
 
// 4b. Tra cứu nhanh trạng thái đơn nạp tiền
app.get('/api/ctv/deposit/status/:code', requireCtv, (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const deposits = loadCtvDeposits();
  const dep = deposits.find(d => (d.depositCode || '').toUpperCase() === code && d.username.toLowerCase() === req.ctvUser.username.toLowerCase());
  if (!dep) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy lệnh nạp!' });
  }
  const isActivated = req.ctvUser.firstDepositDone !== false && req.ctvUser.status !== 'PENDING_ACTIVATION';
  return res.json({
    ok: true,
    status: dep.status,
    isActivated: isActivated,
    userBalance: req.ctvUser.balance || 0,
    userCoins: req.ctvUser.coins || 0
  });
});
 
// 5. Tra cứu UID khách hàng (Hỗ trợ tra tự động qua Kawaii & Cụ Cam)
app.get('/api/ctv/lookup-user', requireCtvActive, async (req, res) => {
  const rawUser = req.query.username || '';
  const username = cleanLocketUsername(rawUser);
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập username Locket!' });
  }
 
  const settings = loadSettings();
  const kawaiiKey = settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
  const cucamKey = settings.apiConfig?.cucamApiKey || '';
  const cucamBase = settings.apiConfig?.cucamApiBase || 'https://locket.2707226.xyz';
 
  // 1. Tra cứu qua Kawaii
  try {
    const ctvUrl = `https://ctv.nodns.vn/api/v1/userinfo?user=${encodeURIComponent(username)}`;
    const ctvRes = await fetch(ctvUrl, {
      headers: { 'x-api-key': kawaiiKey, 'User-Agent': BROWSER_USER_AGENT }
    });
    const ctvData = await ctvRes.json().catch(() => null);
    if (ctvRes.ok && ctvData && (ctvData.status === 'success' || ctvData.uid)) {
      return res.json({
        ok: true,
        data: {
          username: ctvData.username || username,
          fullName: ctvData.full_name || username,
          uid: ctvData.uid,
          avatarUrl: ctvData.profile_picture_url || null,
          hasGold: ctvData.gold?.has_gold || false,
          goldExpiry: ctvData.gold?.expiry_date || null
        }
      });
    }
  } catch (e) { }
 
  // 2. Tra cứu qua Cụ Cam
  if (cucamKey) {
    try {
      const ccRes = await fetch(`${cucamBase}/api/uid/check?username=${encodeURIComponent(username)}`, {
        headers: { 'Authorization': `Bearer ${cucamKey}` }
      });
      const ccData = await ccRes.json().catch(() => null);
      if (ccRes.ok && ccData?.data?.uid) {
        return res.json({
          ok: true,
          data: {
            username: ccData.data.username || username,
            fullName: ccData.data.username || username,
            uid: ccData.data.uid,
            avatarUrl: ccData.data.avatarUrl || null,
            hasGold: ccData.data.active || false,
            goldExpiry: ccData.data.expiresAt || null
          }
        });
      }
    } catch (e) { }
  }
 
  // 3. Fallback locket.cam web
  try {
    const locketRes = await fetch(`https://locket.cam/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
    });
    if (locketRes.ok) {
      const html = await locketRes.text();
      const uidMatch = html.match(/invites%2F([a-zA-Z0-9]{28})/i) || html.match(/invites\/([a-zA-Z0-9]{28})/i);
      const avatarMatch = html.match(/class="profile-pic-img"\s+src="([^"]+)"/i);
      if (uidMatch) {
        return res.json({
          ok: true,
          data: {
            username: username,
            fullName: username,
            uid: uidMatch[1],
            avatarUrl: avatarMatch ? avatarMatch[1].replace(/&amp;/g, '&') : null,
            hasGold: false,
            goldExpiry: null
          }
        });
      }
    }
  } catch (e) { }
 
  return res.status(404).json({
    ok: false,
    message: `Không tìm thấy tài khoản Locket @${username}! Vui lòng kiểm tra lại username.`
  });
});
 
// 5b. Tra cứu DNS & Cấu hình toàn diện cho CTV (Hỗ trợ tra DNS, profile link, khung widget, tin nhắn mẫu)
app.get('/api/ctv/dns-lookup', requireCtvActive, async (req, res) => {
  const rawQuery = req.query.query || req.query.username || req.query.uid || '';
  const cleanId = cleanLocketUsername(rawQuery);
  if (!cleanId) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập Username hoặc UID Locket của khách!' });
  }
 
 
  const settings = loadSettings();
  const kawaiiKey = settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
  const cucamKey = settings.apiConfig?.cucamApiKey || '';
  const cucamBase = settings.apiConfig?.cucamApiBase || 'https://locket.2707226.xyz';
 
  let resolvedUid = '';
  let resolvedUser = cleanId;
  let fullName = cleanId;
  let avatarUrl = null;
  let hasGold = false;
  let goldExpiry = null;
  let source = 'unknown';
  let packageType = 'REGULAR';
  let packageName = 'Locket Gold Thường';
 
  // 1. Kiểm tra trong danh sách khách hàng CTV đã lưu (ưu tiên đơn nội bộ CTV)
  const customers = loadCtvCustomers();
  const foundCust = customers.find(c =>
    (c.username && cleanLocketUsername(c.username) === cleanId) ||
    (c.uid && c.uid.toLowerCase() === cleanId.toLowerCase())
  );
  if (foundCust) {
    if (foundCust.uid) resolvedUid = foundCust.uid;
    if (foundCust.username) resolvedUser = cleanLocketUsername(foundCust.username);
    if (foundCust.fullName) fullName = foundCust.fullName;
    if (foundCust.avatarUrl) avatarUrl = foundCust.avatarUrl;
    if (foundCust.active) hasGold = true;
    if (foundCust.expiresAt) goldExpiry = foundCust.expiresAt;
    if (foundCust.service === 'filter') {
      packageType = 'VIP';
      packageName = foundCust.planName || 'Locket VIP (Filter Camera AI)';
      source = 'CTV_CUSTOMER_VIP';
    } else if (foundCust.service === 'spotify') {
      packageType = 'SPOTIFY';
      packageName = foundCust.planName || 'Spotify VIP';
      source = 'CTV_CUSTOMER_SPOTIFY';
    } else {
      packageType = 'REGULAR';
      packageName = foundCust.planName || 'Locket Gold Thường';
      source = 'CTV_CUSTOMER_REGULAR';
    }
  }
 
  // 2. Kiểm tra trong danh sách đơn hàng đã mua trên web
  const orders = loadOrders();
  const foundOrder = orders.find(o =>
    (o.username && cleanLocketUsername(o.username) === cleanId) ||
    (o.uid && o.uid.toLowerCase() === cleanId.toLowerCase())
  );
  if (foundOrder) {
    if (!resolvedUid && foundOrder.uid) resolvedUid = foundOrder.uid;
    if (foundOrder.username && resolvedUser === cleanId) resolvedUser = cleanLocketUsername(foundOrder.username);
    if (foundOrder.status === 'ACTIVATED') hasGold = true;
    if (foundOrder.expiresAt) goldExpiry = foundOrder.expiresAt;
    if (foundOrder.planType === 'vip') {
      packageType = 'VIP';
      packageName = foundOrder.planName || 'Locket VIP (Filter Camera AI)';
      source = 'ORDER_VIP';
    } else if (foundOrder.service === 'spotify' || foundOrder.planType === 'spotify') {
      packageType = 'SPOTIFY';
      packageName = foundOrder.planName || 'Spotify VIP';
      source = 'ORDER_SPOTIFY';
    } else if (foundOrder.planType === 'regular') {
      packageType = 'REGULAR';
      packageName = foundOrder.planName || 'Locket Gold Thường';
      source = 'ORDER_REGULAR';
    }
  }
 
  // 3. Tra cứu qua Kawaii API (ĐÂY LÀ HỆ THỐNG CẤP VIP & 49 FILTER CHÍNH THỨC)
  let ctvData = null;
  let isKawaiiVip = false;
  try {
    const ctvUrl = `https://ctv.nodns.vn/api/v1/userinfo?user=${encodeURIComponent(cleanId)}`;
    const ctvRes = await fetch(ctvUrl, {
      headers: {
        'x-api-key': kawaiiKey,
        'User-Agent': BROWSER_USER_AGENT
      }
    });
    ctvData = await ctvRes.json().catch(() => null);
    if (ctvRes.ok && ctvData && (ctvData.status === 'success' || ctvData.uid)) {
      if (!resolvedUid && ctvData.uid) resolvedUid = ctvData.uid;
      resolvedUser = ctvData.username || resolvedUser;
      if (ctvData.full_name && (fullName === cleanId || !fullName)) fullName = ctvData.full_name;
      if (!avatarUrl && ctvData.profile_picture_url) avatarUrl = ctvData.profile_picture_url;
      if (ctvData.gold?.has_gold) {
        hasGold = true;
        isKawaiiVip = true;
      }
      if (ctvData.gold?.expiry_date) goldExpiry = ctvData.gold.expiry_date;
    }
  } catch (e) {
    console.warn('[CTV DNS] Kawaii userinfo error:', e.message);
  }
 
  // 4. Tra cứu qua API Cụ Cam (Hệ thống Locket Thường & Spotify)
  let ccData = null;
  if (cucamKey) {
    try {
      const ccRes = await fetch(`${cucamBase}/api/uid/check?username=${encodeURIComponent(cleanId)}`, {
        headers: {
          'Authorization': `Bearer ${cucamKey}`,
          'User-Agent': BROWSER_USER_AGENT
        }
      });
      ccData = await ccRes.json().catch(() => null);
      if (ccRes.ok && ccData?.data?.uid) {
        if (!resolvedUid) resolvedUid = typeof ccData.data.uid === 'string' ? ccData.data.uid : ccData.data.uid.uidString;
        resolvedUser = ccData.data.username || resolvedUser;
        if (fullName === cleanId) fullName = ccData.data.username || cleanId;
        if (!avatarUrl && ccData.data.avatarUrl) avatarUrl = ccData.data.avatarUrl;
        if (ccData.data.active) hasGold = true;
        if (!goldExpiry && ccData.data.expiresAt) goldExpiry = ccData.data.expiresAt;
      }
    } catch (e) {
      console.warn('[CTV DNS] CuCam check error:', e.message);
    }
  }
 
  // 5. PHÂN LOẠI GÓI CHÍNH XÁC:
  // - Nếu Kawaii API trả về has_gold = true -> 100% là khách VIP (Kawaii Filter Camera AI Pro)
  // - Hoặc nếu đơn hàng / CTV ghi nhận là VIP -> VIP
  // - Nếu là Spotify -> SPOTIFY
  // - Nếu Cụ Cam active (mà không phải Kawaii VIP) -> REGULAR
  if (isKawaiiVip || (foundOrder && foundOrder.planType === 'vip') || (foundCust && foundCust.service === 'filter')) {
    packageType = 'VIP';
    source = 'KAWAII_VIP';
    const daysLeft = ctvData?.gold?.days_left || 0;
    if (daysLeft >= 700) {
      packageName = 'Locket VIP Pro Vĩnh Viễn';
    } else if (daysLeft >= 300) {
      packageName = 'Locket VIP Pro 1 Năm';
    } else if (daysLeft >= 150) {
      packageName = 'Locket VIP Pro 6 Tháng';
    } else if (daysLeft > 0) {
      packageName = `Locket VIP (${daysLeft} ngày)`;
    } else {
      packageName = foundOrder?.planName || foundCust?.planName || 'Locket VIP (Filter Camera AI)';
    }
  } else if ((foundOrder && (foundOrder.service === 'spotify' || foundOrder.planType === 'spotify')) || (foundCust && foundCust.service === 'spotify') || (ccData?.data?.package?.name?.toLowerCase().includes('spotify'))) {
    packageType = 'SPOTIFY';
    packageName = foundOrder?.planName || foundCust?.planName || ccData?.data?.package?.name || 'Spotify VIP';
    source = 'SPOTIFY';
  } else if (ccData?.data?.active || (foundOrder && foundOrder.planType === 'regular') || (foundCust && foundCust.service === 'locket')) {
    packageType = 'REGULAR';
    packageName = ccData?.data?.package?.name || foundOrder?.planName || foundCust?.planName || 'Locket Gold Thường';
    source = 'CUCAM';
  } else {
    packageType = 'REGULAR';
    packageName = 'Locket Gold Thường';
  }
 
  // 6. Tra cứu link Profile từ Kawaii Profile API (nếu có)
  let kawaiiProfileUrl = '';
  try {
    const kpRes = await fetch(`https://ctv.nodns.vn/api/v1/profile?user=${encodeURIComponent(resolvedUser)}`, {
      headers: {
        'x-api-key': kawaiiKey,
        'User-Agent': BROWSER_USER_AGENT
      }
    });
    const kpData = await kpRes.json().catch(() => null);
    if (kpRes.ok && kpData?.status === 'success' && kpData?.data?.profile_url) {
      kawaiiProfileUrl = kpData.data.profile_url;
    }
  } catch (e) {}
 
  // 7. Tra trạng thái khung ảnh widget
  let frameInfo = null;
  try {
    const frameResp = await fetch(`https://khunganh.nodns.vn/api/v1/frame?identifier=${encodeURIComponent(resolvedUid || resolvedUser)}`, {
      headers: {
        'x-api-key': kawaiiKey,
        'User-Agent': BROWSER_USER_AGENT
      }
    });
    const fData = await frameResp.json().catch(() => null);
    if (fData && fData.status === 'success' && fData.data) {
      frameInfo = fData.data;
      if (!resolvedUid && fData.data.uid) resolvedUid = fData.data.uid;
    }
  } catch (e) { }
 
  // 8. Xây dựng URLs cho các loại DNS
  const regularDnsUrl = settings.dnsLinkRegular || '/profile';
  const regularProfileUrl = resolvedUid ? `${cucamBase}/api/profile?uid=${encodeURIComponent(resolvedUid)}` : regularDnsUrl;
 
  // Link VIP: nếu có cấu hình riêng trong settings thì thay thế {username}, nếu không thì lấy từ Kawaii Profile API
  let vipDnsUrl = '';
  if (settings.dnsLinkVip && settings.dnsLinkVip !== '/profile') {
    vipDnsUrl = getConfiguredDnsUrl(resolvedUser, settings.dnsLinkVip, kawaiiProfileUrl || '/profile');
  } else if (kawaiiProfileUrl) {
    vipDnsUrl = kawaiiProfileUrl;
  } else {
    vipDnsUrl = '/profile';
  }
 
  const spotifyDnsUrl = 'http://103.101.161.228:8082/spotify-mitm.mobileconfig';
  const customProfileUrl = foundCust?.mobileconfigUrl || '';
 
  // 9. Tin nhắn mẫu gửi khách khớp chuẩn 100% với gói đã mua
  let messageTemplate = '';
  if (packageType === 'VIP') {
    messageTemplate = `👑 HƯỚNG DẪN CÀI ĐẶT LOCKET VIP (49+ FILTER CAMERA AI):
👤 Tài khoản: @${resolvedUser}${resolvedUid ? ` (UID: ${resolvedUid})` : ''}
⚡ Gói kích hoạt: ${packageName}
✨ Trạng thái: ${hasGold ? '✅ Đã kích hoạt VIP' : '⏳ Cần tải DNS cấu hình'}
🌐 Link tải cấu hình DNS VIP (Mở trực tiếp trên Safari iPhone):
${vipDnsUrl}
 
📋 4 BƯỚC CÀI ĐẶT TRÊN SAFARI (BẮT BUỘC):
1. Dán link trên vào Safari -> Bấm 'Cho phép' khi hỏi tải tệp cấu hình.
2. Vào Cài đặt -> Cài đặt chung -> Quản lý VPN & Thiết bị -> Chọn Locket VIP -> Bấm Cài đặt -> Nhập mật khẩu iPhone -> Xác nhận.
3. Vào Cài đặt chung -> Giới thiệu -> Cài đặt tin cậy chứng chỉ -> BẬT CÔNG TẮC Locket VIP -> Chọn Tiếp tục.
4. Tắt hẳn app Locket (vuốt tắt trong đa nhiệm) rồi mở lại -> Thấy 49+ Filter Camera AI & Locket Gold là thành công!`;
  } else if (packageType === 'SPOTIFY') {
    messageTemplate = `🎵 HƯỚNG DẪN CÀI ĐẶT SPOTIFY VIP:
👤 Tài khoản: @${resolvedUser}
⚡ Gói kích hoạt: ${packageName}
✨ Trạng thái: ${hasGold ? '✅ Đã kích hoạt' : '⏳ Cần tải DNS cấu hình'}
🌐 Link tải cấu hình Spotify (Mở trực tiếp trên Safari iPhone):
${spotifyDnsUrl}
 
📋 CÁC BƯỚC CÀI ĐẶT TRÊN SAFARI:
1. Dán link trên vào Safari -> Bấm 'Cho phép' khi hỏi tải tệp cấu hình.
2. Vào Cài đặt -> Cài đặt chung -> Quản lý VPN & Thiết bị -> Chọn Spotify VIP -> Cài đặt.
3. Vào Cài đặt chung -> Giới thiệu -> Cài đặt tin cậy chứng chỉ -> BẬT CÔNG TẮC tin cậy.
4. Mở Spotify và tận hưởng âm nhạc không quảng cáo!`;
  } else {
    messageTemplate = `⚡ HƯỚNG DẪN CÀI ĐẶT LOCKET GOLD (CỤ CAM):
👤 Tài khoản: @${resolvedUser}${resolvedUid ? ` (UID: ${resolvedUid})` : ''}
⚡ Gói kích hoạt: ${packageName}
✨ Trạng thái: ${hasGold ? '✅ Đã kích hoạt Gold' : '⏳ Cần tải DNS cấu hình'}
🌐 Link tải cấu hình DNS (Mở trực tiếp trên Safari iPhone):
${regularProfileUrl}
 
📋 4 BƯỚC CÀI ĐẶT TRÊN SAFARI (BẮT BUỘC):
1. Dán link trên vào Safari -> Bấm 'Cho phép' khi hỏi tải tệp cấu hình.
2. Vào Cài đặt -> Cài đặt chung -> Quản lý VPN & Thiết bị -> Chọn LocketGold -> Bấm Cài đặt -> Nhập mật khẩu iPhone -> Xác nhận.
3. Vào Cài đặt chung -> Giới thiệu -> Cài đặt tin cậy chứng chỉ -> BẬT CÔNG TẮC LocketGold -> Chọn Tiếp tục.
4. Tắt hẳn app Locket (vuốt tắt trong đa nhiệm) rồi mở lại -> Vào Hồ sơ thấy huy hiệu Gold là thành công!`;
  }
 
  return res.json({
    ok: true,
    data: {
      username: resolvedUser,
      uid: resolvedUid,
      fullName: fullName,
      avatarUrl: avatarUrl,
      hasGold: hasGold,
      goldExpiry: goldExpiry,
      packageType: packageType,
      packageName: packageName,
      source: source,
      dnsLinks: {
        regularDns: regularDnsUrl,
        regularProfile: regularProfileUrl,
        vipDns: vipDnsUrl,
        customProfile: customProfileUrl,
        spotifyDns: spotifyDnsUrl
      },
      frame: frameInfo,
      messageTemplate: messageTemplate
    }
  });
});
 
// 6. CTV Kích hoạt gói cho khách hàng (Đồng bộ gọi API Kawaii VIP HOẶC Cụ Cam Gold/Spotify)
app.post('/api/ctv/activate', requireCtvActive, async (req, res) => {
  const { username, service, planId, uid, fullName, avatarUrl } = req.body || {};
  const cleanUser = cleanLocketUsername(username || '');
  if (!cleanUser) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập Username khách!' });
  }
 
  const settings = loadSettings();
  const ctvSettings = settings.ctvSettings || {};
  const plans = ctvSettings.wholesalePlans || [];
  const selectedPlan = plans.find(p => p.id === planId) || plans[0] || { id: 'locket_test', name: 'Locket Gold Test', coin: 1, durationDays: 1 };
 
  const requiredCoin = selectedPlan.coin || 1;
  const userCoins = req.ctvUser.coins || Math.floor((req.ctvUser.balance || 0) / 1000);
 
  if (userCoins < requiredCoin) {
    return res.status(400).json({
      ok: false,
      message: `Số dư không đủ! Gói này cần ${requiredCoin} coin (${(requiredCoin * 1000).toLocaleString('vi-VN')}đ), số dư hiện tại: ${userCoins} coin. Vui lòng nạp thêm tiền!`
    });
  }
 
  // Trừ coin CTV
  const users = loadCtvUsers();
  const currentCtv = users.find(u => u.username.toLowerCase() === req.ctvUser.username.toLowerCase());
  if (currentCtv) {
    currentCtv.coins = (currentCtv.coins || userCoins) - requiredCoin;
    currentCtv.balance = (currentCtv.balance || (userCoins * 1000)) - (requiredCoin * 1000);
    if (!(await saveCtvUsers(users))) {
      return res.status(500).json({ ok: false, message: 'Không thể cập nhật số dư CTV; chưa thực hiện kích hoạt.' });
    }
  }
 
  let resolvedUid = uid || null;
  let mobileconfigUrl = null;
  let filterShortUrl = null;
  let activationSuccess = false;
  let apiLog = null;
 
  const isVip = service === 'filter' || planId.startsWith('vip');
 
  if (isVip) {
    // KÍCH HOẠT QUA KAWAII (VIP 49+ Filter Camera AI)
    try {
      const kawaiiKey = settings.apiConfig?.kawaiiApiKey || process.env.KAWAII_API_KEY || '';
      const pkg = planId === 'vip_lifetime' ? 'filter_lifetime' : (planId === 'vip_2y' ? 'filter_2year' : 'filter_1year');
      const kwRes = await fetch('https://ctv.nodns.vn/api/v1/ctv/gold', {
        method: 'POST',
        headers: {
          'x-api-key': kawaiiKey,
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_USER_AGENT
        },
        body: JSON.stringify({ user: cleanUser, isFilter: true, package: pkg })
      });
      const kwData = await kwRes.json().catch(() => ({}));
      console.log(`[CTV KAWAII ACTIVATE] @${cleanUser} -> Status ${kwRes.status}:`, kwData);
 
      if (kwRes.ok && (kwData.status === 'success' || kwData.ok || kwData.data)) {
        activationSuccess = true;
        resolvedUid = kwData.data?.uid || resolvedUid;
        mobileconfigUrl = kwData.data?.mobileconfigUrl || kwData.mobileconfigUrl || getConfiguredDnsUrl(
          cleanUser,
          settings.dnsLinkVip,
          'https://locket.2707226.xyz/{username}'
        );
        filterShortUrl = kwData.data?.filterShortUrl || kwData.filterShortUrl || null;
        apiLog = { provider: 'KAWAII_VIP', success: true, response: kwData };
      } else {
        apiLog = { provider: 'KAWAII_VIP', success: false, error: kwData.message || `HTTP ${kwRes.status}` };
      }
    } catch (e) {
      console.warn('[CTV] Kawaii VIP activate error:', e.message);
      apiLog = { provider: 'KAWAII_VIP', success: false, error: e.message };
    }
  } else {
    // KÍCH HOẠT QUA CỤ CAM (LOCKET GOLD & SPOTIFY)
    const cucamKey = settings.apiConfig?.cucamApiKey || '';
    const cucamBase = settings.apiConfig?.cucamApiBase || 'https://locket.2707226.xyz';
 
    if (cucamKey) {
      try {
        let pkgCode = 'LKGT3D';
        if (service === 'spotify') {
          pkgCode = planId.includes('1y') ? 'SPOTIFY1Y' : (planId.includes('vv') ? 'SPVV' : 'SP6M');
        } else {
          if (planId === 'locket_lifetime') pkgCode = 'LKGVV';
          else if (planId === 'locket_1y') pkgCode = 'LKG1Y';
          else if (planId === 'locket_6m') pkgCode = 'LKG6M';
          else if (planId === 'locket_1m') pkgCode = 'LKG1M';
          else pkgCode = 'LKGT3D';
        }
 
        const ccRes = await fetch(`${cucamBase}/api/uid/create`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cucamKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: cleanUser,
            packageCode: pkgCode
          })
        });
 
        const ccData = await ccRes.json().catch(() => ({}));
        console.log(`[CTV CỤ CAM ACTIVATE] @${cleanUser} -> Status ${ccRes.status}:`, ccData);
 
        if ((ccRes.ok || ccRes.status === 201) && (ccData.ok || ccData.success || ccData.status === 'success')) {
          activationSuccess = true;
          const uidStr = ccData.data?.uid?.uidString || ccData.data?.uid?.uid || ccData.data?.uid || ccData.uid || null;
          resolvedUid = typeof uidStr === 'string' ? uidStr : (uidStr?.uidString || resolvedUid);
          mobileconfigUrl = `/profile?username=${encodeURIComponent(cleanUser)}`;
          apiLog = { provider: 'CUCAM_DNS', success: true, response: ccData };
        } else {
          apiLog = { provider: 'CUCAM_DNS', success: false, error: ccData.message || `HTTP ${ccRes.status}` };
        }
      } catch (e) {
        console.warn('[CTV] Cụ Cam activate error:', e.message);
        apiLog = { provider: 'CUCAM_DNS', success: false, error: e.message };
      }
    }
  }
 
  // Tính hạn dùng
  const now = new Date();
  const days = selectedPlan.durationDays || 30;
  const expiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const formatDate = (d) => {
    return d.toLocaleTimeString('vi-VN', { hour12: false }) + ' ' + d.toLocaleDateString('vi-VN');
  };
 
  const newCust = {
    id: 'CUST_' + Date.now(),
    ctvUsername: req.ctvUser.username,
    username: cleanUser,
    fullName: fullName || cleanUser,
    avatarUrl: avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
    uid: resolvedUid || 'Chờ cập nhật',
    service: service || 'locket',
    planId: selectedPlan.id,
    planName: selectedPlan.name,
    coinsDeducted: requiredCoin,
    status: activationSuccess ? 'ACTIVE' : 'FAILED',
    mobileconfigUrl: activationSuccess ? (mobileconfigUrl || `/profile?username=${encodeURIComponent(cleanUser)}`) : null,
    filterShortUrl: filterShortUrl || null,
    apiLog: apiLog,
    expiresAt: formatDate(expiryDate),
    lastSeen: formatDate(now),
    createdAt: now.toISOString()
  };
 
  const customers = loadCtvCustomers();
  customers.unshift(newCust);
  if (!(await saveCtvCustomers(customers))) {
    return res.status(500).json({ ok: false, message: 'Kích hoạt đã được gửi nhưng không lưu được hồ sơ khách hàng!' });
  }
 
  return res.json({
    ok: activationSuccess,
    activationSuccess,
    message: activationSuccess
      ? `Đã kích hoạt thành công gói "${selectedPlan.name}" cho @${cleanUser}!`
      : (apiLog?.error || 'Nhà cung cấp chưa xác nhận kích hoạt; chưa có link DNS.'),
    customer: newCust,
    remainingCoins: currentCtv ? currentCtv.coins : userCoins - requiredCoin,
    dnsUrl: activationSuccess ? (mobileconfigUrl || `/profile?username=${encodeURIComponent(cleanUser)}`) : null,
    filterShortUrl: filterShortUrl
  });
});
 
// 7. Lấy danh sách khách hàng của CTV
app.get('/api/ctv/customers', requireCtvActive, (req, res) => {
  const customers = loadCtvCustomers();
  const ctvCusts = customers.filter(c => c.ctvUsername.toLowerCase() === req.ctvUser.username.toLowerCase());
  return res.json({ ok: true, customers: ctvCusts });
});
 
// 8. CTV Xóa khách khỏi danh sách
app.post('/api/ctv/customer/delete', requireCtvActive, async (req, res) => {
  const { id } = req.body || {};
  let customers = loadCtvCustomers();
  customers = customers.filter(c => !(c.id === id && c.ctvUsername.toLowerCase() === req.ctvUser.username.toLowerCase()));
  if (!(await saveCtvCustomers(customers))) {
    return res.status(500).json({ ok: false, message: 'Không thể xóa khách hàng!' });
  }
  return res.json({ ok: true, message: 'Đã xóa khách hàng khỏi danh sách!' });
});
 
// ============================================================
// ADMIN CTV MANAGEMENT ENDPOINTS
// ============================================================
 
// 1. Admin lấy danh sách toàn bộ CTV
app.get('/api/admin/ctv/list', requireAdmin, async (req, res) => {
  let users = loadCtvUsers();
  const settings = loadSettings();
  if (!settings._deleted_xuandieu09 && !users.some(u => u && String(u.username).toLowerCase() === 'xuandieu09')) {
    users.push({
      username: 'xuandieu09',
      password: 'xuandieu123',
      fullName: 'xuandieu09',
      phone: '',
      email: 'xuandieu09@gmail.com',
      balance: 0,
      coins: 0,
      status: 'ACTIVE',
      firstDepositDone: true,
      createdAt: '2026-11-05T03:30:00.000Z'
    });
    await saveCtvUsers(users);
  }
  const customers = loadCtvCustomers();
  const data = users.map(u => {
    const custCount = customers.filter(c => c.ctvUsername.toLowerCase() === u.username.toLowerCase()).length;
    return {
      username: u.username,
      fullName: u.fullName,
      phone: u.phone || '',
      email: u.email || '',
      balance: u.balance || 0,
      coins: u.coins || Math.floor((u.balance || 0) / 1000),
      status: u.status || 'ACTIVE',
      firstDepositDone: u.firstDepositDone !== false,
      customerCount: custCount,
      createdAt: u.createdAt
    };
  });
  return res.json({ ok: true, ctvList: data });
});
 
// 2. Admin nạp/sửa/cộng/trừ Coin & tiền cho CTV
app.post('/api/admin/ctv/adjust-balance', requireAdmin, async (req, res) => {
  const { username, amount, coins, type } = req.body || {};
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp username CTV!' });
  }
 
  const users = loadCtvUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy CTV!' });
  }
 
  let finalCoins = user.coins || 0;
  let actionDesc = '';
 
  if (coins !== undefined && coins !== null && coins !== '') {
    const numCoins = parseInt(coins, 10);
    if (isNaN(numCoins)) {
      return res.status(400).json({ ok: false, message: 'Số coin không hợp lệ!' });
    }
    if (type === 'SET') {
      finalCoins = Math.max(0, numCoins);
      actionDesc = `đặt lại thành ${finalCoins.toLocaleString('vi-VN')} Coins`;
    } else if (type === 'SUB') {
      finalCoins = Math.max(0, (user.coins || 0) - Math.abs(numCoins));
      actionDesc = `trừ ${Math.abs(numCoins).toLocaleString('vi-VN')} Coins (còn lại ${finalCoins.toLocaleString('vi-VN')} Coins)`;
    } else {
      // ADD
      finalCoins = (user.coins || 0) + Math.abs(numCoins);
      actionDesc = `cộng thêm ${Math.abs(numCoins).toLocaleString('vi-VN')} Coins (tổng ${finalCoins.toLocaleString('vi-VN')} Coins)`;
    }
  } else if (amount !== undefined && amount !== null && amount !== '') {
    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount)) {
      return res.status(400).json({ ok: false, message: 'Số tiền không hợp lệ!' });
    }
    if (type === 'SET') {
      finalCoins = Math.max(0, Math.floor(numAmount / 1000));
      actionDesc = `đặt lại thành ${finalCoins.toLocaleString('vi-VN')} Coins`;
    } else if (type === 'SUB') {
      const delta = -Math.abs(numAmount);
      const newBalance = Math.max(0, (user.balance || 0) + delta);
      finalCoins = Math.floor(newBalance / 1000);
      actionDesc = `trừ ${Math.abs(numAmount).toLocaleString('vi-VN')}đ`;
    } else {
      const delta = Math.abs(numAmount);
      const newBalance = (user.balance || 0) + delta;
      finalCoins = Math.floor(newBalance / 1000);
      actionDesc = `cộng ${Math.abs(numAmount).toLocaleString('vi-VN')}đ`;
    }
  } else {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập số coin hoặc số tiền!' });
  }
 
  user.coins = finalCoins;
  user.balance = finalCoins * 1000;
  if ((user.status === 'PENDING_ACTIVATION' || user.firstDepositDone === false) && user.balance >= 150000) {
    user.firstDepositDone = true;
    user.status = 'ACTIVE';
    user.activatedAt = new Date().toISOString();
  }
  if (!(await saveCtvUsers(users))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu số dư CTV!' });
  }
 
  return res.json({
    ok: true,
    message: `Đã ${actionDesc} cho CTV @${username}!`,
    user: {
      username: user.username,
      coins: user.coins,
      balance: user.balance
    }
  });
});
 
// 3. Admin khóa / mở khóa CTV
app.post('/api/admin/ctv/toggle-status', requireAdmin, async (req, res) => {
  const { username } = req.body || {};
  const users = loadCtvUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy CTV!' });
  }
 
  user.status = user.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
  if (!(await saveCtvUsers(users))) {
    return res.status(500).json({ ok: false, message: 'Không thể cập nhật trạng thái CTV!' });
  }
  return res.json({
    ok: true,
    message: `Đã ${user.status === 'BLOCKED' ? 'khóa' : 'mở khóa'} CTV @${username}!`,
    status: user.status
  });
});
 
// 3b. Admin xóa vĩnh viễn tài khoản CTV
app.post('/api/admin/ctv/delete', requireAdmin, async (req, res) => {
  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp username CTV cần xóa!' });
  }
 
  let users = loadCtvUsers();
  const target = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!target) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy tài khoản CTV!' });
  }
 
  users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
  if (!(await saveCtvUsers(users))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu sau khi xóa CTV!' });
  }
 
  for (const [token, user] of activeCtvTokens.entries()) {
    if (user.toLowerCase() === username.toLowerCase()) {
      activeCtvTokens.delete(token);
    }
  }
 
  if (username.toLowerCase() === 'xuandieu09') {
    const settings = loadSettings();
    settings._deleted_xuandieu09 = true;
    await saveSettings(settings);
  }
  if (username.toLowerCase() === 'tocam_ctv') {
    const settings = loadSettings();
    settings._deleted_tocam_ctv = true;
    await saveSettings(settings);
  }
 
  console.log(`[ADMIN CTV] 🗑️ Admin đã xóa vĩnh viễn tài khoản CTV @${username}!`);
  return res.json({
    ok: true,
    message: `Đã xóa vĩnh viễn tài khoản CTV @${username} khỏi hệ thống!`
  });
});
 
// 3c. Admin đổi mật khẩu tài khoản CTV
app.post('/api/admin/ctv/reset-password', requireAdmin, async (req, res) => {
  const { username, newPassword } = req.body || {};
  if (!username || !newPassword) {
    return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp username và mật khẩu mới!' });
  }
 
  const cleanPass = String(newPassword).trim();
  if (cleanPass.length < 6 || !/[a-zA-Z]/.test(cleanPass) || !/[0-9]/.test(cleanPass)) {
    return res.status(400).json({ ok: false, message: 'Mật khẩu mới phải từ 6 ký tự trở lên và bao gồm cả chữ cái và số!' });
  }
 
  const users = loadCtvUsers();
  const target = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!target) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy tài khoản CTV!' });
  }
 
  target.password = cleanPass;
  if (!(await saveCtvUsers(users))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu mật khẩu CTV mới!' });
  }
 
  return res.json({
    ok: true,
    message: `Đã đổi mật khẩu cho CTV @${username} thành công!`
  });
});
 
// 3d. Admin thêm mới hoặc khôi phục tài khoản CTV
app.post('/api/admin/ctv/create-or-restore', requireAdmin, async (req, res) => {
  const { username, password, email, fullName, coins, status } = req.body || {};
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Vui lòng cung cấp tên tài khoản CTV!' });
  }
 
  const cleanUser = cleanLocketUsername(username);
  if (!cleanUser || cleanUser.length < 3) {
    return res.status(400).json({ ok: false, message: 'Tên tài khoản CTV tối thiểu 3 ký tự (chữ cái, số, gạch dưới)!' });
  }
 
  const users = loadCtvUsers();
  let target = users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase());
 
  const numCoins = Math.max(0, parseInt(coins, 10) || 0);
  const userPass = String(password || '').trim() || `${cleanUser}123`;
  const userEmail = String(email || '').trim().toLowerCase() || `${cleanUser}@gmail.com`;
 
  if (cleanUser.toLowerCase() === 'xuandieu09') {
    const settings = loadSettings();
    delete settings._deleted_xuandieu09;
    await saveSettings(settings);
  }
  if (cleanUser.toLowerCase() === 'tocam_ctv') {
    const settings = loadSettings();
    delete settings._deleted_tocam_ctv;
    await saveSettings(settings);
  }
 
  if (target) {
    target.status = status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE';
    target.firstDepositDone = true;
    if (password) target.password = userPass;
    if (email) target.email = userEmail;
    if (fullName) target.fullName = fullName;
    if (coins !== undefined && coins !== null && coins !== '') {
      target.coins = numCoins;
      target.balance = numCoins * 1000;
    }
    if (!(await saveCtvUsers(users))) {
      return res.status(500).json({ ok: false, message: 'Không thể cập nhật tài khoản CTV!' });
    }
    return res.json({
      ok: true,
      message: `Đã khôi phục/cập nhật thông tin tài khoản CTV @${cleanUser}!`,
      user: target
    });
  } else {
    const newUser = {
      username: cleanUser,
      password: userPass,
      fullName: fullName || cleanUser,
      phone: '',
      email: userEmail,
      balance: numCoins * 1000,
      coins: numCoins,
      status: status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE',
      firstDepositDone: true,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    if (!(await saveCtvUsers(users))) {
      return res.status(500).json({ ok: false, message: 'Không thể thêm tài khoản CTV!' });
    }
    return res.json({
      ok: true,
      message: `Đã thêm/khôi phục tài khoản CTV @${cleanUser} thành công!`,
      user: newUser
    });
  }
});
 
// 4. Admin lưu cài đặt & bật/tắt chức năng CTV & Bảng giá sỉ
app.post('/api/admin/ctv/settings', requireAdmin, async (req, res) => {
  const { allowRegister, tabLocket, tabVipFilter, tabSpotify, wholesalePlans, depositPrefix } = req.body || {};
  const settings = loadSettings();
  if (!settings.ctvSettings) settings.ctvSettings = {};
 
  if (typeof allowRegister === 'boolean') settings.ctvSettings.allowRegister = allowRegister;
  if (typeof tabLocket === 'boolean') settings.ctvSettings.tabLocket = tabLocket;
  if (typeof tabVipFilter === 'boolean') settings.ctvSettings.tabVipFilter = tabVipFilter;
  if (typeof tabSpotify === 'boolean') settings.ctvSettings.tabSpotify = tabSpotify;
  if (depositPrefix && typeof depositPrefix === 'string') settings.ctvSettings.depositPrefix = depositPrefix.trim().toUpperCase();
  if (Array.isArray(wholesalePlans)) settings.ctvSettings.wholesalePlans = wholesalePlans;
 
  if (!(await saveSettings(settings))) {
    return res.status(500).json({ ok: false, message: 'Không thể lưu cấu hình CTV!' });
  }
  return res.json({ ok: true, message: 'Đã lưu cấu hình CTV thành công!', ctvSettings: settings.ctvSettings });
});
 
// Khởi chạy server sau khi storage sẵn sàng
async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`
============================================================
👑 TỔ CAM — LOCKET VIP & LOCKET GOLD SYSTEM V2
🌐 Server đang chạy tại: http://localhost:${PORT}
🔐 Trang Quản Trị Admin: http://localhost:${PORT}/admin
============================================================
      `);
 
      // Quét và tự động đóng các đơn PENDING quá 3 phút theo định kỳ mỗi 30 giây
      setInterval(() => {
        try {
          loadOrders();
        } catch (_) { }
      }, 30000);
    });
  } catch (err) {
    console.error('[DATABASE] Không thể khởi động storage:', err.message);
    process.exit(1);
  }
}
 
startServer();
