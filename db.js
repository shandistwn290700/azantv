const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Admin password only seeds a fresh database; afterwards it lives in the
// settings table and is changed from the admin panel.
const ENV_ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const INITIAL_ADMIN_PASSWORD = ENV_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
const LEGACY_DEFAULT_PASSWORD = 'admin123';

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const db = new DatabaseSync(DB_PATH);

// Initialize Tables
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS running_texts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'announcement', -- 'image' | 'announcement' | 'hadith' | 'jumat' | 'kas'
      image_url TEXT DEFAULT '',
      content TEXT DEFAULT '',
      subtitle TEXT DEFAULT '',
      duration INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tv_clients (
      id TEXT PRIMARY KEY,
      name TEXT,
      ip TEXT,
      user_agent TEXT,
      screen_res TEXT,
      last_seen INTEGER,
      status TEXT DEFAULT 'online'
    );
  `);

  // Insert default settings if not exists
  const defaultSettings = {
    mosque_name: "Masjid Luqmanul Hakim",
    mosque_address: "Jl. Gandasoli Kidul No. 42 Ds. Gandasari Kec. Katapang Kab. Bandung, 40921",
    city_name: "Bandung",
    latitude: "-6.9175",
    longitude: "107.6191",
    timezone: "7",
    elevation: "700",
    fajr_angle: "20.0",
    isha_angle: "18.0",
    ihtiyat_imsak: "0",
    ihtiyat_subuh: "2",
    ihtiyat_terbit: "-2",
    ihtiyat_dhuha: "0",
    ihtiyat_dzuhur: "2",
    ihtiyat_ashar: "2",
    ihtiyat_maghrib: "2",
    ihtiyat_isya: "2",
    iqomah_subuh: "10",
    iqomah_dzuhur: "10",
    iqomah_ashar: "10",
    iqomah_maghrib: "7",
    iqomah_isya: "7",
    azan_duration: "3",
    salat_duration: "15",
    hijri_offset: "0",
    beep_enabled: "1",
    theme: "argon",
    tv_bg_image: "/img/backgrounds/default.jpg",
    tv_bg_overlay: "0.25",
    admin_password: INITIAL_ADMIN_PASSWORD,
    jumat_khatib: "Ust. Ahmad Fauzi, M.Ag",
    jumat_imam: "Ust. Muhammad Ridwan",
    jumat_muadzin: "Ust. Bilal",
    jumat_tanggal: "Jum'at Pekan Ini"
  };

  const getStmt = db.prepare('SELECT key FROM settings WHERE key = ?');
  const insertStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const [key, value] of Object.entries(defaultSettings)) {
    const existing = getStmt.get(key);
    if (!existing) {
      insertStmt.run(key, String(value));
      if (key === 'admin_password' && !ENV_ADMIN_PASSWORD) {
        console.log(`[AUTH] ADMIN_PASSWORD tidak diset. Password awal panel takmir: ${value}`);
        console.log('[AUTH] Catat sekarang dan segera ganti lewat panel. Password ini tidak ditampilkan lagi.');
      }
    }
  }

  // Older installs were seeded with a hardcoded default password.
  const storedPw = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  if (storedPw && storedPw.value === LEGACY_DEFAULT_PASSWORD) {
    if (ENV_ADMIN_PASSWORD && ENV_ADMIN_PASSWORD !== LEGACY_DEFAULT_PASSWORD) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password'").run(ENV_ADMIN_PASSWORD);
      console.log('[AUTH] Password default lama diganti dengan nilai ADMIN_PASSWORD.');
    } else {
      console.warn('[AUTH] Panel takmir masih memakai password default. Segera ganti lewat panel atau set ADMIN_PASSWORD.');
    }
  }

  // Lost-password recovery: set ADMIN_PASSWORD_RESET=true together with
  // ADMIN_PASSWORD, redeploy once, then remove ADMIN_PASSWORD_RESET.
  if (/^(1|true|yes)$/i.test((process.env.ADMIN_PASSWORD_RESET || '').trim())) {
    if (ENV_ADMIN_PASSWORD) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password'").run(ENV_ADMIN_PASSWORD);
      console.warn('[AUTH] Password panel takmir di-reset ke nilai ADMIN_PASSWORD. Hapus ADMIN_PASSWORD_RESET setelah berhasil login.');
    } else {
      console.warn('[AUTH] ADMIN_PASSWORD_RESET aktif tapi ADMIN_PASSWORD kosong. Reset dibatalkan.');
    }
  }

  // Insert default running texts if empty
  const countTexts = db.prepare('SELECT COUNT(*) as count FROM running_texts').get();
  if (countTexts.count === 0) {
    const insertText = db.prepare('INSERT INTO running_texts (text, is_active, sort_order) VALUES (?, 1, ?)');
    insertText.run("Selamat Datang di Masjid Raya Al-Muhajirin. Mohon menonaktifkan nada dering handphone selama berada di dalam masjid.", 1);
    insertText.run("Luruskan dan rapatkan shaf saat sholat berjamaah untuk kesempurnaan sholat.", 2);
    insertText.run("Infaq dan Shadaqah dapat disalurkan melalui kotak infaq atau transfer BSI: 7123456789 a.n DKM Masjid Raya Al-Muhajirin.", 3);
  }

  // Insert default slides if empty
  const countSlides = db.prepare('SELECT COUNT(*) as count FROM slides').get();
  if (countSlides.count === 0) {
    const insertSlide = db.prepare('INSERT INTO slides (title, subtitle, type, image_url, content, duration, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
    
    insertSlide.run(
      "Kajian Rutin Ahad Subuh",
      "Kitab Riyadhus Shalihin",
      "announcement",
      "",
      "Bersama: Buya H. Yahya Zainul Ma'arif\nWaktu: Ba'da Sholat Subuh Berjamaah\nTempat: Ruang Utama Masjid Raya Al-Muhajirin",
      12,
      1
    );

    insertSlide.run(
      "Pengingat Hadits",
      "Keutamaan Sholat Berjamaah",
      "hadith",
      "",
      "«صَلاَةُ الْجَمَاعَةِ تَفْضُلُ صَلاَةَ الْفَذِّ بِسَبْعٍ وَعِشْرِينَ دَرَجَةً»\n\n\"Sholat berjamaah lebih utama dua puluh tujuh derajat dibandingkan sholat sendirian.\"\n(HR. Al-Bukhari & Muslim)",
      10,
      2
    );

    insertSlide.run(
      "Laporan Kas Infaq Masjid",
      "Transparansi Keuangan DKM",
      "kas",
      "",
      "Jazaakumullahu Khairan atas infaq dan shadaqah para jamaah. Semoga menjadi amal jariyah yang berlipat ganda.",
      10,
      3
    );

    insertSlide.run(
      "Petugas Sholat Jum'at",
      "Jadwal Pelaksanaan Sholat Jum'at",
      "jumat",
      "",
      "Mohon hadir lebih awal sebelum adzan dikumandangkan untuk mendengarkan khutbah dengan khusyuk.",
      10,
      4
    );
  }

  // Migrate legacy background paths that pointed at images never shipped
  // in /uploads (that folder is a runtime volume, so they always 404'd).
  const legacyBg = {
    '/uploads/default_bg.jpg': '/img/backgrounds/default.jpg',
    '/uploads/kaaba_1.jpg': '/img/backgrounds/kaaba-dekat.jpg',
    '/uploads/kaaba_2.jpg': '/img/backgrounds/kaaba-pelataran.jpg',
    '/uploads/nabawi.jpg': '/img/backgrounds/nabawi.jpg'
  };
  const currentBg = db.prepare("SELECT value FROM settings WHERE key = 'tv_bg_image'").get();
  if (currentBg && legacyBg[currentBg.value]) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'tv_bg_image'").run(legacyBg[currentBg.value]);
  }
}

initDb();

// Settings Helper
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function updateSettings(newSettings) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const [key, value] of Object.entries(newSettings)) {
    if (value !== undefined && value !== null) {
      upsert.run(key, String(value));
    }
  }
  return getSettings();
}

// Running Text Helper
function getRunningTexts(onlyActive = false) {
  let sql = 'SELECT * FROM running_texts';
  if (onlyActive) {
    sql += ' WHERE is_active = 1';
  }
  sql += ' ORDER BY sort_order ASC, id ASC';
  return db.prepare(sql).all();
}

function addRunningText(text, sortOrder = 0) {
  const stmt = db.prepare('INSERT INTO running_texts (text, is_active, sort_order) VALUES (?, 1, ?)');
  const res = stmt.run(text, sortOrder);
  return res.lastInsertRowid;
}

function updateRunningText(id, text, isActive, sortOrder) {
  const stmt = db.prepare('UPDATE running_texts SET text = ?, is_active = ?, sort_order = ? WHERE id = ?');
  stmt.run(text, isActive ? 1 : 0, sortOrder || 0, id);
}

function deleteRunningText(id) {
  db.prepare('DELETE FROM running_texts WHERE id = ?').run(id);
}

// Slides Helper
function getSlides(onlyActive = false) {
  let sql = 'SELECT * FROM slides';
  if (onlyActive) {
    sql += ' WHERE is_active = 1';
  }
  sql += ' ORDER BY sort_order ASC, id ASC';
  return db.prepare(sql).all();
}

function addSlide(slide) {
  const stmt = db.prepare(`
    INSERT INTO slides (title, subtitle, type, image_url, content, duration, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    slide.title || 'Slide Baru',
    slide.subtitle || '',
    slide.type || 'announcement',
    slide.image_url || '',
    slide.content || '',
    parseInt(slide.duration, 10) || 10,
    slide.is_active !== undefined ? (slide.is_active ? 1 : 0) : 1,
    parseInt(slide.sort_order, 10) || 0
  );
  return res.lastInsertRowid;
}

function updateSlide(id, slide) {
  const stmt = db.prepare(`
    UPDATE slides 
    SET title = ?, subtitle = ?, type = ?, image_url = ?, content = ?, duration = ?, is_active = ?, sort_order = ?
    WHERE id = ?
  `);
  stmt.run(
    slide.title,
    slide.subtitle || '',
    slide.type,
    slide.image_url || '',
    slide.content || '',
    parseInt(slide.duration, 10) || 10,
    slide.is_active ? 1 : 0,
    parseInt(slide.sort_order, 10) || 0,
    id
  );
}

function deleteSlide(id) {
  db.prepare('DELETE FROM slides WHERE id = ?').run(id);
}

// TV Clients Heartbeat & Management
function registerOrUpdateClient({ id, name, ip, userAgent, screenRes }) {
  const existing = db.prepare('SELECT id FROM tv_clients WHERE id = ?').get(id);
  const now = Date.now();
  if (existing) {
    db.prepare(`
      UPDATE tv_clients 
      SET last_seen = ?, status = 'online', ip = COALESCE(?, ip), user_agent = COALESCE(?, user_agent), screen_res = COALESCE(?, screen_res)
      WHERE id = ?
    `).run(now, ip, userAgent, screenRes, id);
  } else {
    db.prepare(`
      INSERT INTO tv_clients (id, name, ip, user_agent, screen_res, last_seen, status)
      VALUES (?, ?, ?, ?, ?, ?, 'online')
    `).run(id, name || `Google TV (${id.slice(0, 6)})`, ip || '', userAgent || '', screenRes || '', now);
  }
}

function getTvClients() {
  const now = Date.now();
  // Mark offline if not seen for > 30 seconds
  db.prepare(`UPDATE tv_clients SET status = 'offline' WHERE (? - last_seen) > 35000`).run(now);
  return db.prepare('SELECT * FROM tv_clients ORDER BY last_seen DESC').all();
}

function deleteTvClient(id) {
  db.prepare('DELETE FROM tv_clients WHERE id = ?').run(id);
}

module.exports = {
  db,
  getSettings,
  updateSettings,
  getRunningTexts,
  addRunningText,
  updateRunningText,
  deleteRunningText,
  getSlides,
  addSlide,
  updateSlide,
  deleteSlide,
  registerOrUpdateClient,
  getTvClients,
  deleteTvClient
};
