const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const auth = require('./auth');
const { PrayerTimes, INDONESIA_CITIES } = require('./prayer-times');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Uploads Directory
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${cleanName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|svg|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar (JPG, PNG, WebP, GIF, SVG) yang diperbolehkan!'));
    }
  }
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth: per-member accounts with persistent sessions (see auth.js)
function readToken(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function authMiddleware(req, res, next) {
  const token = readToken(req);
  const user = auth.getSessionUser(token);
  if (user) {
    req.user = user;
    req.sessionToken = token;
    return next();
  }
  return res.status(401).json({ error: 'Sesi berakhir. Silakan login kembali.' });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Hanya admin yang dapat mengelola akun pengurus.' });
}

// Login throttling: 5 failed attempts per IP+username, then a 15 minute lockout
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginFailures = new Map();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function loginKey(req, username) {
  return `${clientIp(req)}|${String(username || '').toLowerCase()}`;
}

function isLoginLocked(key) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_LOCK_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILS;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginFailures) {
    if (now - entry.first > LOGIN_LOCK_MS) loginFailures.delete(key);
  }
}, LOGIN_LOCK_MS).unref();

function recordLoginFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_LOCK_MS) {
    loginFailures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

// SSE (Server-Sent Events) clients for live real-time sync with Google TV
let sseClients = [];

function broadcastSSE(eventType, data = {}) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (err) {
      // client disconnected
    }
  });
}

// Route: SSE Connection for TV displays
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('\n');

  const clientId = req.query.clientId || Math.random().toString(36).substring(7);
  const clientObj = { id: clientId, res };
  sseClients.push(clientObj);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== clientObj);
  });
});

// Helper: Calculate Today and Tomorrow Prayer Times
function calculateAllPrayerTimes() {
  const settings = db.getSettings();
  const lat = parseFloat(settings.latitude) || -6.2088;
  const lng = parseFloat(settings.longitude) || 106.8456;
  const timezone = parseFloat(settings.timezone) || 7;
  const elevation = parseFloat(settings.elevation) || 10;
  const fajrAngle = parseFloat(settings.fajr_angle) || 20.0;
  const ishaAngle = parseFloat(settings.isha_angle) || 18.0;

  const ihtiyat = {
    imsak: parseInt(settings.ihtiyat_imsak || 0, 10),
    subuh: parseInt(settings.ihtiyat_subuh !== undefined ? settings.ihtiyat_subuh : 2, 10),
    terbit: parseInt(settings.ihtiyat_terbit !== undefined ? settings.ihtiyat_terbit : -2, 10),
    dhuha: parseInt(settings.ihtiyat_dhuha || 0, 10),
    dzuhur: parseInt(settings.ihtiyat_dzuhur !== undefined ? settings.ihtiyat_dzuhur : 2, 10),
    ashar: parseInt(settings.ihtiyat_ashar !== undefined ? settings.ihtiyat_ashar : 2, 10),
    maghrib: parseInt(settings.ihtiyat_maghrib !== undefined ? settings.ihtiyat_maghrib : 2, 10),
    isya: parseInt(settings.ihtiyat_isya !== undefined ? settings.ihtiyat_isya : 2, 10)
  };

  const pt = new PrayerTimes({ lat, lng, timezone, elevation, fajrAngle, ishaAngle, ihtiyat });
  const now = new Date();
  const todayTimes = pt.getTimes(now);

  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowTimes = pt.getTimes(tomorrow);

  const hijriOffset = parseInt(settings.hijri_offset || 0, 10);
  const hijriDate = pt.getHijriDate(now, hijriOffset);

  return {
    today: todayTimes,
    tomorrow: tomorrowTimes,
    hijri: hijriDate
  };
}

// Public API: Get Full Data Bundle for Google TV
app.get('/api/data', (req, res) => {
  try {
    const settings = db.getSettings();
    // Do not leak admin password in public data
    const safeSettings = { ...settings };
    delete safeSettings.admin_password;

    const timesData = calculateAllPrayerTimes();
    const runningTexts = db.getRunningTexts(true);
    const slides = db.getSlides(true).filter(s => s.type !== 'kas');

    res.json({
      success: true,
      serverTime: Date.now(),
      settings: safeSettings,
      prayerTimes: timesData.today,
      tomorrowPrayerTimes: timesData.tomorrow,
      hijri: timesData.hijri,
      runningTexts,
      slides
    });
  } catch (err) {
    console.error('Error in /api/data:', err);
    res.status(500).json({ error: 'Gagal memuat data jadwal sholat' });
  }
});

// Public API: Google TV Heartbeat & Telemetry
app.post('/api/client/heartbeat', (req, res) => {
  const { clientId, name, screenRes, userAgent } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId wajib ada' });
  }
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  db.registerOrUpdateClient({
    id: clientId,
    name,
    ip: String(ip),
    userAgent: userAgent || req.headers['user-agent'] || '',
    screenRes: screenRes || ''
  });
  res.json({ success: true, serverTime: Date.now() });
});

// Admin Auth Routes
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Nama pengguna dan kata sandi wajib diisi.' });
  }
  const key = loginKey(req, username);
  if (isLoginLocked(key)) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.' });
  }
  const user = auth.authenticate(username, password);
  if (!user) {
    recordLoginFailure(key);
    return res.status(401).json({ error: 'Nama pengguna atau kata sandi salah.' });
  }
  loginFailures.delete(key);
  const token = auth.createSession(user.id, req.headers['user-agent']);
  auth.logAudit(user, 'Masuk', `dari ${clientIp(req)}`);
  res.json({ success: true, token, user });
});

app.post('/api/admin/logout', authMiddleware, (req, res) => {
  auth.deleteSession(req.sessionToken);
  res.json({ success: true });
});

app.get('/api/admin/check-auth', authMiddleware, (req, res) => {
  res.json({ authenticated: true, user: req.user });
});

app.get('/api/admin/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Change own password; signs out the user's other devices
app.post('/api/admin/me/password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!auth.checkPassword(req.user.id, current_password || '')) {
    return res.status(400).json({ error: 'Kata sandi saat ini salah.' });
  }
  const pwError = auth.validatePassword(new_password);
  if (pwError) return res.status(400).json({ error: pwError });
  auth.setPassword(req.user.id, new_password);
  auth.deleteUserSessions(req.user.id, req.sessionToken);
  auth.logAudit(req.user, 'Ganti kata sandi sendiri');
  res.json({ success: true });
});

// Admin API: Settings
const SETTINGS_LABELS = {
  mosque_name: 'nama masjid', mosque_address: 'alamat', city_name: 'kota', latitude: 'lintang',
  longitude: 'bujur', timezone: 'zona waktu', tv_bg_image: 'foto latar', tv_bg_overlay: 'overlay latar',
  jumat_khatib: 'khatib', jumat_imam: 'imam', jumat_muadzin: 'muadzin', jumat_tanggal: "tanggal Jum'at"
};

app.get('/api/admin/settings', authMiddleware, (req, res) => {
  res.json({ settings: db.getSettings() });
});

app.post('/api/admin/settings', authMiddleware, (req, res) => {
  const updates = { ...(req.body || {}) };
  // Passwords are managed per account, never through settings
  delete updates.admin_password;
  delete updates.new_password;
  const keys = Object.keys(updates);
  if (keys.length === 0) return res.status(400).json({ error: 'Tidak ada perubahan.' });
  const updated = db.updateSettings(updates);
  const labels = [...new Set(keys.map(k => SETTINGS_LABELS[k] || k.split('_')[0]))];
  auth.logAudit(req.user, 'Ubah pengaturan', labels.join(', '));
  broadcastSSE('data-update', { message: 'Pengaturan diperbarui' });
  res.json({ success: true, settings: updated });
});

// Admin API: Accounts (admin role only)
app.get('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  res.json(auth.listUsers());
});

app.post('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  const input = { ...(req.body || {}), role: (req.body && req.body.role) || 'pengurus' };
  const error = auth.validateNewUser(input);
  if (error) return res.status(400).json({ error });
  try {
    const user = auth.createUser(input);
    auth.logAudit(req.user, 'Tambah akun', `${user.display_name} (@${user.username}, ${user.role})`);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { display_name, role, is_active } = req.body || {};
  if (id === req.user.id && (is_active === false || is_active === 0)) {
    return res.status(400).json({ error: 'Tidak bisa menonaktifkan akun sendiri.' });
  }
  try {
    const before = auth.getUser(id);
    const user = auth.updateUser(id, { display_name, role, is_active });
    const changes = [];
    if (before && before.role !== user.role) changes.push(`peran → ${user.role}`);
    if (before && before.is_active !== user.is_active) changes.push(user.is_active ? 'diaktifkan' : 'dinonaktifkan');
    if (before && before.display_name !== user.display_name) changes.push(`nama → ${user.display_name}`);
    auth.logAudit(req.user, 'Ubah akun', `@${user.username}: ${changes.join(', ') || 'tanpa perubahan'}`);
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/password', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = auth.getUser(id);
  if (!target) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
  const pwError = auth.validatePassword(req.body && req.body.new_password);
  if (pwError) return res.status(400).json({ error: pwError });
  auth.setPassword(id, req.body.new_password);
  auth.deleteUserSessions(id, id === req.user.id ? req.sessionToken : null);
  auth.logAudit(req.user, 'Reset kata sandi', `@${target.username}`);
  res.json({ success: true });
});

app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri.' });
  const target = auth.getUser(id);
  if (!target) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
  try {
    auth.deleteUser(id);
    auth.logAudit(req.user, 'Hapus akun', `${target.display_name} (@${target.username})`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/audit', authMiddleware, requireAdmin, (req, res) => {
  res.json(auth.getAuditLog(req.query.limit));
});

// Admin API: Cities Preset List
app.get('/api/admin/cities', authMiddleware, (req, res) => {
  res.json(INDONESIA_CITIES);
});

// Admin API: Running Texts
app.get('/api/admin/running-texts', authMiddleware, (req, res) => {
  res.json(db.getRunningTexts(false));
});

app.post('/api/admin/running-texts', authMiddleware, (req, res) => {
  const { text, sort_order } = req.body;
  if (!text) return res.status(400).json({ error: 'Teks tidak boleh kosong' });
  const id = db.addRunningText(text, sort_order || 0);
  auth.logAudit(req.user, 'Tambah running text', String(text).slice(0, 80));
  broadcastSSE('data-update', { message: 'Running text diperbarui' });
  res.json({ success: true, id });
});

app.put('/api/admin/running-texts/:id', authMiddleware, (req, res) => {
  const { text, is_active, sort_order } = req.body;
  db.updateRunningText(req.params.id, text, is_active, sort_order);
  auth.logAudit(req.user, is_active ? 'Tayangkan running text' : 'Sembunyikan running text', String(text || '').slice(0, 80));
  broadcastSSE('data-update', { message: 'Running text diperbarui' });
  res.json({ success: true });
});

app.delete('/api/admin/running-texts/:id', authMiddleware, (req, res) => {
  db.deleteRunningText(req.params.id);
  auth.logAudit(req.user, 'Hapus running text', `#${req.params.id}`);
  broadcastSSE('data-update', { message: 'Running text dihapus' });
  res.json({ success: true });
});

// Admin API: Slides
app.get('/api/admin/slides', authMiddleware, (req, res) => {
  res.json(db.getSlides(false));
});

app.post('/api/admin/slides', authMiddleware, (req, res) => {
  const id = db.addSlide(req.body);
  auth.logAudit(req.user, 'Tambah slide', String((req.body && req.body.title) || '').slice(0, 80));
  broadcastSSE('data-update', { message: 'Slide ditambahkan' });
  res.json({ success: true, id });
});

app.put('/api/admin/slides/:id', authMiddleware, (req, res) => {
  db.updateSlide(req.params.id, req.body);
  auth.logAudit(req.user, 'Ubah slide', String((req.body && req.body.title) || `#${req.params.id}`).slice(0, 80));
  broadcastSSE('data-update', { message: 'Slide diperbarui' });
  res.json({ success: true });
});

app.delete('/api/admin/slides/:id', authMiddleware, (req, res) => {
  db.deleteSlide(req.params.id);
  auth.logAudit(req.user, 'Hapus slide', `#${req.params.id}`);
  broadcastSSE('data-update', { message: 'Slide dihapus' });
  res.json({ success: true });
});

// Admin API: Upload Image
app.post('/api/admin/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  auth.logAudit(req.user, 'Unggah gambar', req.file.filename);
  res.json({ success: true, url: fileUrl, filename: req.file.filename });
});

// Admin API: Connected TV Devices
app.get('/api/admin/tv-clients', authMiddleware, (req, res) => {
  res.json(db.getTvClients());
});

app.delete('/api/admin/tv-clients/:id', authMiddleware, (req, res) => {
  const client = db.getTvClients().find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'TV tidak ditemukan.' });
  db.deleteTvClient(req.params.id);
  auth.logAudit(req.user, 'Hapus TV dari daftar', `${client.name} (${client.id})`);
  res.json({ success: true });
});

// Admin API: Broadcast Actions to TV (Test Beep, Reload, etc.)
const TV_ACTIONS = { 'test-beep': 'Tes bip', reload: 'Muat ulang' };
app.post('/api/admin/action', authMiddleware, (req, res) => {
  const { action, targetClientId } = req.body || {};
  if (!TV_ACTIONS[action]) return res.status(400).json({ error: 'Aksi tidak dikenal' });

  auth.logAudit(req.user, `${TV_ACTIONS[action]} TV`, targetClientId ? `TV ${targetClientId}` : 'semua TV');
  broadcastSSE(action, { targetClientId, timestamp: Date.now() });
  res.json({ success: true, message: `Aksi ${action} berhasil dikirim ke TV.` });
});

// HTML Page Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🕌 AZAN DISPLAY TV & ADMIN SERVER BERJALAN`);
  console.log(`- Port       : ${PORT}`);
  console.log(`- Display TV : http://localhost:${PORT}/tv`);
  console.log(`- Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`- Login      : akun pengurus (kelola di panel → Akun Pengurus)`);
  console.log(`=======================================================`);
});
