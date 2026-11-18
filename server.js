const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
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

// Simple Auth Token Store (In-Memory Session Store)
const activeSessions = new Set();

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (token && activeSessions.has(token)) {
    return next();
  }
  return res.status(401).json({ error: 'Akses ditolak. Silakan login terlebih dahulu.' });
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
  const { password } = req.body;
  const settings = db.getSettings();
  if (password === settings.admin_password) {
    const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    activeSessions.add(token);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Password salah! Silakan coba lagi.' });
  }
});

app.get('/api/admin/check-auth', authMiddleware, (req, res) => {
  res.json({ authenticated: true });
});

// Admin API: Settings
app.get('/api/admin/settings', authMiddleware, (req, res) => {
  const settings = db.getSettings();
  const safe = { ...settings };
  delete safe.admin_password;
  res.json({ settings: safe, hasCustomPassword: settings.admin_password !== 'admin123' });
});

app.post('/api/admin/settings', authMiddleware, (req, res) => {
  const updates = req.body;
  // If user changed admin password
  if (updates.new_password) {
    if (updates.new_password.trim().length >= 4) {
      updates.admin_password = updates.new_password.trim();
    }
    delete updates.new_password;
  }
  const updated = db.updateSettings(updates);
  broadcastSSE('data-update', { message: 'Pengaturan diperbarui' });
  res.json({ success: true, settings: updated });
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
  broadcastSSE('data-update', { message: 'Running text diperbarui' });
  res.json({ success: true, id });
});

app.put('/api/admin/running-texts/:id', authMiddleware, (req, res) => {
  const { text, is_active, sort_order } = req.body;
  db.updateRunningText(req.params.id, text, is_active, sort_order);
  broadcastSSE('data-update', { message: 'Running text diperbarui' });
  res.json({ success: true });
});

app.delete('/api/admin/running-texts/:id', authMiddleware, (req, res) => {
  db.deleteRunningText(req.params.id);
  broadcastSSE('data-update', { message: 'Running text dihapus' });
  res.json({ success: true });
});

// Admin API: Slides
app.get('/api/admin/slides', authMiddleware, (req, res) => {
  res.json(db.getSlides(false));
});

app.post('/api/admin/slides', authMiddleware, (req, res) => {
  const id = db.addSlide(req.body);
  broadcastSSE('data-update', { message: 'Slide ditambahkan' });
  res.json({ success: true, id });
});

app.put('/api/admin/slides/:id', authMiddleware, (req, res) => {
  db.updateSlide(req.params.id, req.body);
  broadcastSSE('data-update', { message: 'Slide diperbarui' });
  res.json({ success: true });
});

app.delete('/api/admin/slides/:id', authMiddleware, (req, res) => {
  db.deleteSlide(req.params.id);
  broadcastSSE('data-update', { message: 'Slide dihapus' });
  res.json({ success: true });
});

// Admin API: Upload Image
app.post('/api/admin/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl, filename: req.file.filename });
});

// Admin API: Connected TV Devices
app.get('/api/admin/tv-clients', authMiddleware, (req, res) => {
  res.json(db.getTvClients());
});

app.delete('/api/admin/tv-clients/:id', authMiddleware, (req, res) => {
  db.deleteTvClient(req.params.id);
  res.json({ success: true });
});

// Admin API: Broadcast Actions to TV (Test Beep, Reload, etc.)
app.post('/api/admin/action', authMiddleware, (req, res) => {
  const { action, targetClientId } = req.body;
  if (!action) return res.status(400).json({ error: 'Action diperlukan' });

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
  console.log(`- Password   : dari env ADMIN_PASSWORD saat pertama dibuat (dapat diganti di panel)`);
  console.log(`=======================================================`);
});
