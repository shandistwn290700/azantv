/**
 * Admin accounts (one per DKM member), persistent login sessions and an
 * audit log of who changed what.
 *
 * Passwords are stored as scrypt hashes; session tokens are stored as
 * SHA-256 hashes so a leaked database does not expose live tokens.
 */
const crypto = require('crypto');
const { db } = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;      // 30 days
const SESSION_REFRESH_MS = 15 * 24 * 60 * 60 * 1000;  // extend when < 15 days left
const MIN_PASSWORD_LENGTH = 8;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const ROLES = ['admin', 'pengurus'];

const ENV_ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
const ENV_ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const LEGACY_DEFAULT_PASSWORD = 'admin123';

/* ───────── Password hashing ───────── */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Compared against when the username does not exist, so timing stays the same
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* ───────── Validation helpers ───────── */
function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateNewUser({ username, display_name, password, role }) {
  if (!USERNAME_RE.test(normalizeUsername(username))) {
    return 'Nama pengguna 3–32 karakter: huruf kecil, angka, titik, minus atau garis bawah.';
  }
  if (!String(display_name || '').trim()) return 'Nama lengkap wajib diisi.';
  const pwError = validatePassword(password);
  if (pwError) return pwError;
  if (!ROLES.includes(role)) return 'Peran tidak dikenal.';
  return null;
}

function validatePassword(password) {
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  }
  return null;
}

/* ───────── Public user shape (never includes the hash) ───────── */
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    is_active: !!row.is_active,
    created_at: row.created_at,
    last_login: row.last_login
  };
}

/* ───────── Schema & migration ───────── */
function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'pengurus',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_login INTEGER
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());

  // Older versions kept a single plaintext password in settings.
  const legacyRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
  const legacyPassword = legacyRow ? legacyRow.value : null;
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;

  if (userCount === 0) {
    let password = legacyPassword;
    if (!password || (password === LEGACY_DEFAULT_PASSWORD && ENV_ADMIN_PASSWORD)) {
      password = ENV_ADMIN_PASSWORD || null;
    }
    let generated = false;
    if (!password) {
      password = crypto.randomBytes(9).toString('base64url');
      generated = true;
    }
    db.prepare(`
      INSERT INTO admin_users (username, display_name, password_hash, role, is_active, created_at)
      VALUES (?, 'Administrator', ?, 'admin', 1, ?)
    `).run(ENV_ADMIN_USERNAME, hashPassword(password), Date.now());

    if (legacyPassword) {
      console.log(`[AUTH] Password lama dipindahkan ke akun "${ENV_ADMIN_USERNAME}". Login dengan nama pengguna "${ENV_ADMIN_USERNAME}" dan password yang sama.`);
    } else if (generated) {
      console.log(`[AUTH] Akun awal dibuat. Nama pengguna: ${ENV_ADMIN_USERNAME}  Password: ${password}`);
      console.log('[AUTH] Catat sekarang dan segera ganti lewat panel. Password ini tidak ditampilkan lagi.');
    } else {
      console.log(`[AUTH] Akun awal "${ENV_ADMIN_USERNAME}" dibuat dengan password dari ADMIN_PASSWORD.`);
    }
  }

  if (legacyRow) {
    db.prepare("DELETE FROM settings WHERE key = 'admin_password'").run();
  }

  // Lost-password recovery: set ADMIN_PASSWORD_RESET=true together with
  // ADMIN_PASSWORD, redeploy once, then set it back to false.
  if (/^(1|true|yes)$/i.test((process.env.ADMIN_PASSWORD_RESET || '').trim())) {
    if (ENV_ADMIN_PASSWORD) {
      const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(ENV_ADMIN_USERNAME);
      if (existing) {
        db.prepare("UPDATE admin_users SET password_hash = ?, role = 'admin', is_active = 1 WHERE id = ?")
          .run(hashPassword(ENV_ADMIN_PASSWORD), existing.id);
        db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(existing.id);
      } else {
        db.prepare(`
          INSERT INTO admin_users (username, display_name, password_hash, role, is_active, created_at)
          VALUES (?, 'Administrator', ?, 'admin', 1, ?)
        `).run(ENV_ADMIN_USERNAME, hashPassword(ENV_ADMIN_PASSWORD), Date.now());
      }
      console.warn(`[AUTH] Password akun "${ENV_ADMIN_USERNAME}" di-reset ke nilai ADMIN_PASSWORD. Kembalikan ADMIN_PASSWORD_RESET ke false setelah berhasil login.`);
    } else {
      console.warn('[AUTH] ADMIN_PASSWORD_RESET aktif tapi ADMIN_PASSWORD kosong. Reset dibatalkan.');
    }
  }

  const adminRow = db.prepare('SELECT password_hash FROM admin_users WHERE username = ?').get(ENV_ADMIN_USERNAME);
  if (adminRow && verifyPassword(LEGACY_DEFAULT_PASSWORD, adminRow.password_hash)) {
    console.warn(`[AUTH] Akun "${ENV_ADMIN_USERNAME}" masih memakai password default. Segera ganti lewat panel.`);
  }
}

/* ───────── Login & sessions ───────── */
function authenticate(username, password) {
  const row = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(normalizeUsername(username));
  // Run a hash even for unknown users so response time does not reveal which usernames exist.
  const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok || !row.is_active) return null;
  db.prepare('UPDATE admin_users SET last_login = ? WHERE id = ?').run(Date.now(), row.id);
  return toPublicUser(row);
}

function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare(`
    INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(hashToken(token), userId, now, now + SESSION_TTL_MS, String(userAgent || '').slice(0, 300));
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db.prepare(`
    SELECT u.*, s.expires_at AS session_expires
    FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  const now = Date.now();
  if (!row || !row.is_active || row.session_expires < now) return null;
  if (row.session_expires - now < SESSION_REFRESH_MS) {
    db.prepare('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?').run(now + SESSION_TTL_MS, tokenHash);
  }
  return toPublicUser(row);
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token));
}

function deleteUserSessions(userId, exceptToken = null) {
  if (exceptToken) {
    db.prepare('DELETE FROM admin_sessions WHERE user_id = ? AND token_hash != ?').run(userId, hashToken(exceptToken));
  } else {
    db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);
  }
}

/* ───────── User management ───────── */
function listUsers() {
  return db.prepare('SELECT * FROM admin_users ORDER BY role, display_name COLLATE NOCASE').all().map(toPublicUser);
}

function getUser(id) {
  return toPublicUser(db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id));
}

function createUser({ username, display_name, password, role }) {
  const uname = normalizeUsername(username);
  if (db.prepare('SELECT id FROM admin_users WHERE username = ?').get(uname)) {
    throw new Error('Nama pengguna sudah dipakai.');
  }
  const info = db.prepare(`
    INSERT INTO admin_users (username, display_name, password_hash, role, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(uname, String(display_name).trim(), hashPassword(password), role, Date.now());
  return getUser(Number(info.lastInsertRowid));
}

function countActiveAdmins(excludeId = null) {
  const row = excludeId == null
    ? db.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'admin' AND is_active = 1").get()
    : db.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'admin' AND is_active = 1 AND id != ?").get(excludeId);
  return row.n;
}

function updateUser(id, { display_name, role, is_active }) {
  const current = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
  if (!current) throw new Error('Akun tidak ditemukan.');
  const next = {
    display_name: display_name !== undefined ? String(display_name).trim() : current.display_name,
    role: role !== undefined ? role : current.role,
    is_active: is_active !== undefined ? (is_active ? 1 : 0) : current.is_active
  };
  if (!next.display_name) throw new Error('Nama lengkap wajib diisi.');
  if (!ROLES.includes(next.role)) throw new Error('Peran tidak dikenal.');
  const losesAdmin = current.role === 'admin' && current.is_active && (next.role !== 'admin' || !next.is_active);
  if (losesAdmin && countActiveAdmins(id) === 0) {
    throw new Error('Harus ada minimal satu admin aktif.');
  }
  db.prepare('UPDATE admin_users SET display_name = ?, role = ?, is_active = ? WHERE id = ?')
    .run(next.display_name, next.role, next.is_active, id);
  if (!next.is_active) deleteUserSessions(id);
  return getUser(id);
}

function setPassword(id, password) {
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
}

function checkPassword(id, password) {
  const row = db.prepare('SELECT password_hash FROM admin_users WHERE id = ?').get(id);
  return !!row && verifyPassword(password, row.password_hash);
}

function deleteUser(id) {
  const current = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
  if (!current) throw new Error('Akun tidak ditemukan.');
  if (current.role === 'admin' && current.is_active && countActiveAdmins(id) === 0) {
    throw new Error('Harus ada minimal satu admin aktif.');
  }
  deleteUserSessions(id);
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
}

/* ───────── Audit log ───────── */
function logAudit(user, action, detail = '') {
  try {
    db.prepare('INSERT INTO audit_log (user_id, username, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user ? user.id : null, user ? user.display_name : 'Sistem', action, String(detail || '').slice(0, 500), Date.now());
    // Keep the log bounded
    db.prepare('DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 2000)').run();
  } catch (err) {
    console.error('Gagal mencatat aktivitas:', err);
  }
}

function getAuditLog(limit = 100) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  return db.prepare('SELECT id, username, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT ?').all(n);
}

init();

module.exports = {
  ROLES,
  MIN_PASSWORD_LENGTH,
  validateNewUser,
  validatePassword,
  authenticate,
  createSession,
  getSessionUser,
  deleteSession,
  deleteUserSessions,
  listUsers,
  getUser,
  createUser,
  updateUser,
  setPassword,
  checkPassword,
  deleteUser,
  logAudit,
  getAuditLog
};
