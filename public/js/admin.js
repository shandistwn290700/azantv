/**
 * Admin panel script for AdhanCast (Azan TV management)
 */

const token = localStorage.getItem('azan_admin_token');
if (!token) {
  window.location.href = '/login';
}

// Any admin API call that comes back 401 means the session ended
// (logged out elsewhere, account disabled, password changed): go to login.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await nativeFetch(input, init);
  const url = typeof input === 'string' ? input : input.url;
  if (res.status === 401 && url.startsWith('/api/admin/') && !url.startsWith('/api/admin/login')) {
    localStorage.removeItem('azan_admin_token');
    window.location.href = '/login';
  }
  return res;
};

let currentUser = null;

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  };
}

// Escape any stored text before it reaches innerHTML
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
}

/* ───────── Tabs ───────── */
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(i => {
      i.classList.remove('active');
      i.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-content').forEach(t => {
      t.classList.remove('active');
      t.hidden = true;
    });

    item.classList.add('active');
    item.setAttribute('aria-current', 'page');
    const target = document.getElementById(item.dataset.tab);
    if (target) {
      target.hidden = false;
      target.classList.add('active');
    }
  });
});

/* ───────── Logout ───────── */
document.getElementById('btn-logout').addEventListener('click', async () => {
  try {
    await nativeFetch('/api/admin/logout', { method: 'POST', headers: authHeaders() });
  } catch (e) {}
  localStorage.removeItem('azan_admin_token');
  window.location.href = '/login';
});

/* ───────── Signed-in user ───────── */
async function loadCurrentUser() {
  try {
    const res = await fetch('/api/admin/me', { headers: authHeaders() });
    if (!res.ok) return;
    currentUser = (await res.json()).user;
    document.getElementById('signed-in-name').textContent = currentUser.display_name;
    document.getElementById('signed-in').hidden = false;
    const isAdmin = currentUser.role === 'admin';
    document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !isAdmin; });
    if (isAdmin) {
      loadUsers();
      loadAuditLog();
    }
  } catch (err) {
    console.error('Error load user:', err);
  }
}

/* ───────── Validation states ───────── */
function setFieldError(input, message) {
  const field = input.closest('.field');
  if (!field) return;
  let err = field.querySelector('.field-error');
  const errId = (input.id || input.name) + '-error';
  if (message) {
    if (!err) {
      err = document.createElement('p');
      err.className = 'field-error';
      err.id = errId;
      field.appendChild(err);
    }
    err.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    const describedBy = (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    if (!describedBy.includes(errId)) describedBy.push(errId);
    input.setAttribute('aria-describedby', describedBy.join(' '));
  } else {
    if (err) err.remove();
    input.removeAttribute('aria-invalid');
    const describedBy = (input.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== errId);
    if (describedBy.length) input.setAttribute('aria-describedby', describedBy.join(' '));
    else input.removeAttribute('aria-describedby');
  }
}

function messageFor(input) {
  const v = input.validity;
  if (v.valueMissing) return input.type === 'file' ? 'Pilih berkas terlebih dahulu.' : 'Wajib diisi.';
  if (v.patternMismatch) {
    return input.id === 'new-user-username'
      ? 'Gunakan 3–32 huruf kecil, angka, titik, minus atau garis bawah.'
      : 'Format angka tidak sesuai. Gunakan titik untuk desimal.';
  }
  if (v.rangeUnderflow) return `Minimal ${input.min}.`;
  if (v.rangeOverflow) return `Maksimal ${input.max}.`;
  if (v.tooShort) return `Minimal ${input.minLength} karakter.`;
  if (v.stepMismatch || v.badInput) return 'Nilai tidak valid.';
  return input.validationMessage;
}

// Returns true when the form is valid; otherwise marks fields and focuses the first error
function validateForm(form) {
  let firstInvalid = null;
  form.querySelectorAll('.input').forEach(input => {
    if (input.checkValidity()) {
      setFieldError(input, null);
    } else {
      setFieldError(input, messageFor(input));
      if (!firstInvalid) firstInvalid = input;
    }
  });
  if (firstInvalid) firstInvalid.focus();
  return !firstInvalid;
}

document.addEventListener('input', (e) => {
  const input = e.target;
  if (input.classList && input.classList.contains('input') && input.getAttribute('aria-invalid') === 'true' && input.checkValidity()) {
    setFieldError(input, null);
  }
});

/* ───────── Preset cities ───────── */
async function loadCities() {
  try {
    const res = await fetch('/api/admin/cities', { headers: authHeaders() });
    if (!res.ok) throw new Error('Auth failed');
    const cities = await res.json();
    const select = document.getElementById('city_preset');
    select.innerHTML = '<option value="">Pilih kota…</option>';
    cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(c);
      opt.textContent = `${c.name} (GMT+${c.timezone})`;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      if (!select.value) return;
      const c = JSON.parse(select.value);
      document.getElementById('city_name').value = c.name;
      document.getElementById('latitude').value = c.lat;
      document.getElementById('longitude').value = c.lng;
      document.getElementById('timezone').value = c.timezone;
    });
  } catch (err) {
    console.error('Error load cities:', err);
  }
}

/* ───────── Overview: next prayer + today's schedule ───────── */
let overviewData = null;

const SCHEDULE = [
  { key: 'subuh', name: 'Subuh' },
  { key: 'terbit', name: 'Syuruq' },
  { key: 'dzuhur', name: 'Dzuhur' },
  { key: 'ashar', name: 'Ashar' },
  { key: 'maghrib', name: 'Maghrib' },
  { key: 'isya', name: 'Isya' },
  { key: 'imsak', name: 'Imsak' },
  { key: 'dhuha', name: 'Dhuha' }
];

function toSec(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 3600 + m * 60;
}

function renderTodaySchedule(pt) {
  const list = document.getElementById('today-schedule');
  const order = ['imsak', 'subuh', 'terbit', 'dhuha', 'dzuhur', 'ashar', 'maghrib', 'isya'];
  list.innerHTML = order
    .filter(k => pt[k])
    .map(k => {
      const name = SCHEDULE.find(s => s.key === k).name;
      return `<li data-key="${k}"><span class="ts-name">${name}</span><span class="ts-time">${escapeHtml(pt[k])}</span></li>`;
    })
    .join('');
}

function updateNextPrayer() {
  if (!overviewData) return;
  const pt = overviewData.prayerTimes;
  const now = new Date(Date.now() + (overviewData.skew || 0));
  const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  const points = ['imsak', 'subuh', 'terbit', 'dhuha', 'dzuhur', 'ashar', 'maghrib', 'isya']
    .filter(k => pt[k])
    .map(k => ({ key: k, name: SCHEDULE.find(s => s.key === k).name, time: pt[k], sec: toSec(pt[k]) }));

  let next = points.find(p => p.sec > currentSec);
  let diff;
  if (next) {
    diff = next.sec - currentSec;
  } else {
    const t = overviewData.tomorrowPrayerTimes?.imsak || pt.imsak;
    next = { key: 'imsak', name: 'Imsak besok', time: t, sec: toSec(t) };
    diff = next.sec + 86400 - currentSec;
  }

  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const pad = n => String(n).padStart(2, '0');

  document.getElementById('kpi-next-prayer').textContent = `${next.name} ${next.time}`;
  document.getElementById('kpi-next-cd').textContent = `${h ? h + ' jam ' : ''}${pad(m)} menit ${pad(s)} detik lagi`;

  document.querySelectorAll('#today-schedule li').forEach(li => {
    li.classList.toggle('is-next', li.dataset.key === next.key && next.name !== 'Imsak besok');
  });
}

async function updateKpiCards() {
  try {
    const res = await fetch('/api/data?t=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    const s = data.settings;

    overviewData = {
      prayerTimes: data.prayerTimes,
      tomorrowPrayerTimes: data.tomorrowPrayerTimes,
      skew: data.serverTime ? data.serverTime - Date.now() : 0
    };
    renderTodaySchedule(data.prayerTimes);
    updateNextPrayer();

    document.getElementById('kpi-jumat-khatib').textContent = s.jumat_khatib || 'Belum diisi';
    document.getElementById('kpi-jumat-tgl').textContent = s.jumat_tanggal || "Jum'at pekan ini";

    const textCount = (data.runningTexts || []).length;
    const slideCount = (data.slides || []).filter(x => x.type !== 'kas').length;
    document.getElementById('kpi-content-count').textContent = `${slideCount} slide · ${textCount} teks`;
  } catch (e) {}
}

setInterval(updateNextPrayer, 1000);

/* ───────── Settings ───────── */
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings', { headers: authHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    const s = data.settings;
    const set = (id, v) => { document.getElementById(id).value = v; };
    const def = (v, d) => (v !== undefined && v !== null ? v : d);

    // Mosque & location
    set('mosque_name', s.mosque_name || 'MASJID LUQMANUL HAKIM');
    set('mosque_address', s.mosque_address || 'Jl. Gandasoli Kidul No. 42 Ds. Gandasari Kec. Katapang Kab. Bandung, 40921');
    set('city_name', s.city_name || 'Bandung');
    set('latitude', s.latitude || '-6.9175');
    set('longitude', s.longitude || '107.6191');
    set('timezone', s.timezone || '7');
    set('elevation', s.elevation || '700');
    set('hijri_offset', s.hijri_offset || '0');

    // Ihtiyat
    set('ihtiyat_imsak', s.ihtiyat_imsak || '0');
    set('ihtiyat_subuh', def(s.ihtiyat_subuh, '2'));
    set('ihtiyat_terbit', def(s.ihtiyat_terbit, '-2'));
    set('ihtiyat_dhuha', s.ihtiyat_dhuha || '0');
    set('ihtiyat_dzuhur', def(s.ihtiyat_dzuhur, '2'));
    set('ihtiyat_ashar', def(s.ihtiyat_ashar, '2'));
    set('ihtiyat_maghrib', def(s.ihtiyat_maghrib, '2'));
    set('ihtiyat_isya', def(s.ihtiyat_isya, '2'));

    // Timers & audio
    set('azan_duration', s.azan_duration || '3');
    set('salat_duration', s.salat_duration || '15');
    set('iqomah_subuh', s.iqomah_subuh || '10');
    set('iqomah_dzuhur', s.iqomah_dzuhur || '10');
    set('iqomah_ashar', s.iqomah_ashar || '10');
    set('iqomah_maghrib', s.iqomah_maghrib || '7');
    set('iqomah_isya', s.iqomah_isya || '7');
    set('beep_enabled', def(s.beep_enabled, '1'));

    // Jumat
    set('jumat_khatib', s.jumat_khatib || '');
    set('jumat_imam', s.jumat_imam || '');
    set('jumat_muadzin', s.jumat_muadzin || '');
    set('jumat_tanggal', s.jumat_tanggal || '');

    // Background
    const bgUrl = s.tv_bg_image || DEFAULT_BG;
    set('tv_bg_image', bgUrl);
    set('tv_bg_overlay', def(s.tv_bg_overlay, '0.25'));
    setBackgroundPreview(bgUrl);

    document.getElementById('topbar-mosque-name').textContent = s.mosque_name || 'Masjid Kita';
    updateKpiCards();
  } catch (err) {
    console.error('Error load settings:', err);
    showToast('Gagal memuat data', true);
  }
}

const DEFAULT_BG = '/img/backgrounds/default.jpg';

function setBackgroundPreview(url) {
  const img = document.getElementById('bg-preview-img');
  img.onerror = () => {
    img.onerror = null;
    img.src = DEFAULT_BG;
    showToast('Foto latar tidak ditemukan. TV memakai latar default.', true);
  };
  img.src = url;
  document.querySelectorAll('.btn-preset-bg').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.url === url ? 'true' : 'false');
  });
}

async function saveSettings(formDataObj, successMessage) {
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(formDataObj)
    });
    const data = await res.json();
    if (res.ok) {
      showToast(successMessage || 'Tersimpan. TV akan memperbarui tampilan otomatis.');
      loadSettings();
      return true;
    }
    showToast(data.error || 'Gagal menyimpan data', true);
  } catch (err) {
    showToast('Kesalahan jaringan saat menyimpan', true);
  }
  return false;
}

async function withBusy(form, fn) {
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try { await fn(); } finally { if (btn) btn.disabled = false; }
}

['form-masjid', 'form-ihtiyat', 'form-timers', 'form-jumat', 'form-bg-settings'].forEach(formId => {
  const f = document.getElementById(formId);
  if (!f) return;
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateForm(f)) return;
    const obj = Object.fromEntries(new FormData(f).entries());
    withBusy(f, () => saveSettings(obj));
  });
});

/* ───────── Own password ───────── */
document.getElementById('form-password').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if (!validateForm(form)) return;
  const current = document.getElementById('current_password');
  const next = document.getElementById('new_password');
  const confirmInput = document.getElementById('confirm_password');
  if (next.value !== confirmInput.value) {
    setFieldError(confirmInput, 'Kata sandi baru tidak sama.');
    confirmInput.focus();
    return;
  }
  withBusy(form, async () => {
    try {
      const res = await fetch('/api/admin/me/password', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ current_password: current.value, new_password: next.value })
      });
      const data = await res.json();
      if (!res.ok) {
        const target = /saat ini/i.test(data.error || '') ? current : next;
        setFieldError(target, data.error || 'Gagal mengganti kata sandi.');
        target.focus();
        return;
      }
      form.reset();
      showToast('Kata sandi diganti. Perangkat lain sudah dikeluarkan.');
    } catch (err) {
      showToast('Kesalahan jaringan saat mengganti kata sandi', true);
    }
  });
});

/* ───────── Background upload & presets ───────── */
async function uploadFile(file) {
  const uploadData = new FormData();
  uploadData.append('file', file);
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: uploadData
  });
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || 'Upload gagal');
  return data.url;
}

document.getElementById('form-upload-bg').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if (!validateForm(form)) return;
  const fileInput = document.getElementById('bg_file');

  withBusy(form, async () => {
    try {
      const url = await uploadFile(fileInput.files[0]);
      document.getElementById('tv_bg_image').value = url;
      setBackgroundPreview(url);
      await saveSettings({ tv_bg_image: url }, 'Foto latar diunggah dan tampil di TV.');
      form.reset();
    } catch (err) {
      showToast('Gagal mengunggah: ' + err.message, true);
    }
  });
});

document.querySelectorAll('.btn-preset-bg').forEach(btn => {
  btn.addEventListener('click', async () => {
    const url = btn.dataset.url;
    if (!url) return;
    document.getElementById('tv_bg_image').value = url;
    setBackgroundPreview(url);
    await saveSettings({ tv_bg_image: url }, `Latar "${btn.textContent.trim()}" diterapkan ke TV.`);
  });
});

/* ───────── Running texts ───────── */
let runningTextCache = [];

async function loadRunningTexts() {
  try {
    const res = await fetch('/api/admin/running-texts', { headers: authHeaders() });
    const texts = await res.json();
    runningTextCache = texts;
    const tbody = document.getElementById('table-running-texts');

    if (texts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="cell-empty">Belum ada running text. Tambahkan dari formulir di samping.</td></tr>';
      return;
    }

    tbody.innerHTML = texts.map(item => `
      <tr>
        <td class="col-num cell-mono">${Number(item.sort_order) || 0}</td>
        <td class="cell-strong">${escapeHtml(item.text)}</td>
        <td><span class="badge-status ${item.is_active ? 'is-on' : ''}">${item.is_active ? 'Tayang' : 'Disembunyikan'}</span></td>
        <td class="col-actions">
          <div class="cell-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-text" data-id="${Number(item.id)}">
              ${item.is_active ? 'Sembunyikan' : 'Tayangkan'}
            </button>
            <button type="button" class="btn btn-danger btn-sm btn-icon" data-action="delete-text" data-id="${Number(item.id)}" aria-label="Hapus running text">
              <iconify-icon icon="lucide:trash-2" aria-hidden="true"></iconify-icon>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error load running texts:', err);
  }
}

document.getElementById('form-add-ticker').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if (!validateForm(form)) return;
  const input = document.getElementById('new-ticker-text');
  const sort = document.getElementById('new-ticker-sort').value;
  const text = input.value.trim();

  withBusy(form, async () => {
    try {
      const res = await fetch('/api/admin/running-texts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text, sort_order: parseInt(sort, 10) || 0 })
      });
      if (!res.ok) throw new Error();
      input.value = '';
      showToast('Running text ditambahkan');
      loadRunningTexts();
      updateKpiCards();
    } catch (err) {
      showToast('Gagal menambahkan running text', true);
    }
  });
});

async function toggleRunningText(id) {
  const item = runningTextCache.find(t => Number(t.id) === id);
  if (!item) return;
  try {
    await fetch(`/api/admin/running-texts/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ text: item.text, is_active: item.is_active ? 0 : 1, sort_order: item.sort_order || 0 })
    });
    showToast(item.is_active ? 'Running text disembunyikan dari TV' : 'Running text tayang di TV');
    loadRunningTexts();
  } catch (err) {
    showToast('Gagal mengubah status', true);
  }
}

async function deleteRunningText(id) {
  if (!confirm('Hapus running text ini dari TV?')) return;
  try {
    await fetch(`/api/admin/running-texts/${id}`, { method: 'DELETE', headers: authHeaders() });
    showToast('Running text dihapus');
    loadRunningTexts();
    updateKpiCards();
  } catch (err) {
    showToast('Gagal menghapus', true);
  }
}

/* ───────── Slides ───────── */
const SLIDE_TYPE_LABEL = { announcement: 'Informasi', hadith: 'Hadits', image: 'Poster', jumat: "Jum'at" };

async function loadSlides() {
  try {
    const res = await fetch('/api/admin/slides', { headers: authHeaders() });
    const rawSlides = await res.json();
    const slides = rawSlides.filter(s => s.type !== 'kas');
    const tbody = document.getElementById('table-slides');

    if (slides.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="cell-empty">Belum ada agenda. Slide yang ditambahkan akan tampil di tengah layar TV.</td></tr>';
      return;
    }

    tbody.innerHTML = slides.map(item => `
      <tr>
        <td class="col-num cell-mono">${Number(item.sort_order) || 0}</td>
        <td>
          <div class="cell-strong">${escapeHtml(item.title)}</div>
          ${item.subtitle ? `<div class="cell-sub">${escapeHtml(item.subtitle)}</div>` : ''}
        </td>
        <td><span class="type-tag">${escapeHtml(SLIDE_TYPE_LABEL[item.type] || item.type)}</span></td>
        <td class="col-num cell-mono">${Number(item.duration) || 0} dtk</td>
        <td class="col-actions">
          <div class="cell-actions">
            <button type="button" class="btn btn-danger btn-sm btn-icon" data-action="delete-slide" data-id="${Number(item.id)}" aria-label="Hapus slide ${escapeHtml(item.title)}">
              <iconify-icon icon="lucide:trash-2" aria-hidden="true"></iconify-icon>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error load slides:', err);
  }
}

// Poster file is required only for the image slide type
const slideType = document.getElementById('slide_type');
const slideFile = document.getElementById('slide_file');
function syncSlideFileRequirement() {
  slideFile.required = slideType.value === 'image';
  if (!slideFile.required) setFieldError(slideFile, null);
}
slideType.addEventListener('change', syncSlideFileRequirement);
syncSlideFileRequirement();

document.getElementById('form-add-slide').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!validateForm(f)) return;

  const payload = {
    title: f.slide_title.value.trim(),
    subtitle: f.slide_subtitle.value.trim(),
    type: f.slide_type.value,
    content: f.slide_content.value.trim(),
    image_url: '',
    duration: parseInt(f.slide_duration.value, 10) || 10,
    sort_order: parseInt(f.slide_sort.value, 10) || 0,
    is_active: 1
  };

  withBusy(f, async () => {
    if (payload.type === 'image' && slideFile.files.length > 0) {
      try {
        payload.image_url = await uploadFile(slideFile.files[0]);
      } catch (err) {
        showToast('Gagal upload gambar: ' + err.message, true);
        return;
      }
    }

    try {
      const res = await fetch('/api/admin/slides', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      f.reset();
      syncSlideFileRequirement();
      showToast('Agenda ditambahkan ke rotasi TV');
      loadSlides();
      updateKpiCards();
    } catch (err) {
      showToast('Gagal menambahkan slide', true);
    }
  });
});

async function deleteSlide(id) {
  if (!confirm('Hapus slide ini dari rotasi TV?')) return;
  try {
    await fetch(`/api/admin/slides/${id}`, { method: 'DELETE', headers: authHeaders() });
    showToast('Slide dihapus');
    loadSlides();
    updateKpiCards();
  } catch (err) {
    showToast('Gagal menghapus slide', true);
  }
}

/* ───────── TV monitoring ───────── */
async function loadTvClients() {
  try {
    const res = await fetch('/api/admin/tv-clients', { headers: authHeaders() });
    const clients = await res.json();
    const tbody = document.getElementById('table-tv-clients');

    const onlineCount = clients.filter(c => c.status === 'online').length;
    document.getElementById('topbar-tv-count').textContent = `${onlineCount} TV online`;
    document.getElementById('topbar-tv-status').dataset.state = onlineCount > 0 ? 'online' : 'offline';
    document.getElementById('kpi-tv-status').textContent = `${onlineCount} dari ${clients.length} online`;

    if (clients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="cell-empty">Belum ada TV tersambung. Buka alamat /tv di browser Google TV.</td></tr>';
      return;
    }

    tbody.innerHTML = clients.map(c => {
      const lastSeenSec = Math.floor((Date.now() - c.last_seen) / 1000);
      const isOnline = c.status === 'online';
      const id = escapeHtml(c.id);
      return `
        <tr>
          <td>
            <div class="cell-strong">${escapeHtml(c.name)}</div>
            <div class="cell-sub">ID ${id}</div>
          </td>
          <td class="cell-mono">${escapeHtml(c.ip || '-')}</td>
          <td class="cell-mono">${escapeHtml(c.screen_res || '-')}</td>
          <td><span class="badge-status ${isOnline ? 'is-on' : ''}">${isOnline ? 'Online' : `Offline · ${lastSeenSec} dtk lalu`}</span></td>
          <td class="col-actions">
            <div class="cell-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-tv-action="test-beep" data-client="${id}">
                <iconify-icon icon="lucide:volume-2" aria-hidden="true"></iconify-icon> Bip
              </button>
              <button type="button" class="btn btn-secondary btn-sm" data-tv-action="reload" data-client="${id}">
                <iconify-icon icon="lucide:refresh-cw" aria-hidden="true"></iconify-icon> Muat ulang
              </button>
              <button type="button" class="btn btn-danger btn-sm" data-tv-delete="${id}" data-online="${isOnline ? '1' : '0'}" data-name="${escapeHtml(c.name)}">
                <iconify-icon icon="lucide:trash-2" aria-hidden="true"></iconify-icon> Hapus
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error load tv clients:', err);
  }
}

async function triggerTvAction(action, targetClientId = null) {
  const label = action === 'reload' ? 'Muat ulang' : 'Tes bip';
  try {
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action, targetClientId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`${label} dikirim ke ${targetClientId ? 'TV ' + targetClientId : 'semua TV'}`);
    } else {
      showToast(data.error || 'Gagal mengirim perintah', true);
    }
  } catch (err) {
    showToast('Gagal menghubungi TV', true);
  }
}

async function deleteTvClient(btn) {
  const name = btn.dataset.name || 'TV ini';
  const msg = btn.dataset.online === '1'
    ? `Hapus "${name}" dari daftar?\n\nTV ini masih menyala, jadi akan muncul lagi dalam ±30 detik. Matikan TV atau tutup aplikasinya dulu supaya tidak muncul lagi.`
    : `Hapus "${name}" dari daftar?`;
  if (!confirm(msg)) return;
  try {
    const res = await fetch(`/api/admin/tv-clients/${encodeURIComponent(btn.dataset.tvDelete)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal menghapus TV');
    showToast(`"${name}" dihapus dari daftar`);
    loadTvClients();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ───────── Accounts (admin only) ───────── */
let usersCache = [];
const ROLE_LABEL = { admin: 'Admin', pengurus: 'Pengurus' };

function formatDateTime(ms) {
  if (!ms) return 'Belum pernah';
  return new Date(ms).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

async function loadUsers() {
  const tbody = document.getElementById('table-users');
  try {
    const res = await fetch('/api/admin/users', { headers: authHeaders() });
    if (!res.ok) return;
    usersCache = await res.json();
    tbody.innerHTML = usersCache.map(u => {
      const isSelf = currentUser && u.id === currentUser.id;
      const otherRole = u.role === 'admin' ? 'pengurus' : 'admin';
      return `
        <tr class="${u.is_active ? '' : 'is-inactive'}">
          <td>
            <div class="cell-strong">${escapeHtml(u.display_name)}${isSelf ? ' <span class="cell-sub">(Anda)</span>' : ''}</div>
            <div class="cell-sub">@${escapeHtml(u.username)}${u.is_active ? '' : ' · nonaktif'}</div>
          </td>
          <td><span class="role-tag ${u.role === 'admin' ? 'is-admin' : ''}">${ROLE_LABEL[u.role] || escapeHtml(u.role)}</span></td>
          <td class="cell-time">${escapeHtml(formatDateTime(u.last_login))}</td>
          <td class="col-actions">
            <div class="cell-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-user-action="reset-password" data-id="${u.id}">
                <iconify-icon icon="lucide:key-round" aria-hidden="true"></iconify-icon> Reset sandi
              </button>
              ${isSelf ? '' : `
              <button type="button" class="btn btn-secondary btn-sm" data-user-action="set-role" data-role="${otherRole}" data-id="${u.id}">
                Jadikan ${ROLE_LABEL[otherRole]}
              </button>
              <button type="button" class="btn btn-secondary btn-sm" data-user-action="toggle-active" data-id="${u.id}">
                ${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
              <button type="button" class="btn btn-danger btn-sm" data-user-action="delete" data-id="${u.id}">
                <iconify-icon icon="lucide:trash-2" aria-hidden="true"></iconify-icon> Hapus
              </button>`}
            </div>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" class="cell-empty">Belum ada akun.</td></tr>';
  } catch (err) {
    console.error('Error load users:', err);
  }
}

async function loadAuditLog() {
  const tbody = document.getElementById('table-audit');
  try {
    const res = await fetch('/api/admin/audit?limit=100', { headers: authHeaders() });
    if (!res.ok) return;
    const rows = await res.json();
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="cell-time">${escapeHtml(formatDateTime(r.created_at))}</td>
        <td>${escapeHtml(r.username || 'Sistem')}</td>
        <td>
          <div class="cell-strong">${escapeHtml(r.action)}</div>
          ${r.detail ? `<div class="cell-sub">${escapeHtml(r.detail)}</div>` : ''}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="3" class="cell-empty">Belum ada aktivitas tercatat.</td></tr>';
  } catch (err) {
    console.error('Error load audit log:', err);
  }
}

document.getElementById('btn-refresh-audit').addEventListener('click', loadAuditLog);

document.getElementById('form-add-user').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const usernameInput = document.getElementById('new-user-username');
  usernameInput.value = usernameInput.value.trim().toLowerCase();
  if (!validateForm(form)) return;
  const body = {
    display_name: document.getElementById('new-user-name').value.trim(),
    username: usernameInput.value,
    password: document.getElementById('new-user-password').value,
    role: document.getElementById('new-user-role').value
  };
  withBusy(form, async () => {
    try {
      const res = await fetch('/api/admin/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        const target = /pengguna/i.test(data.error || '') ? usernameInput
          : /sandi/i.test(data.error || '') ? document.getElementById('new-user-password')
          : document.getElementById('new-user-name');
        setFieldError(target, data.error || 'Gagal menambah akun.');
        target.focus();
        return;
      }
      form.reset();
      showToast(`Akun @${data.user.username} dibuat`);
      loadUsers();
      loadAuditLog();
    } catch (err) {
      showToast('Kesalahan jaringan saat menambah akun', true);
    }
  });
});

async function userAction(btn) {
  const id = Number(btn.dataset.id);
  const user = usersCache.find(u => u.id === id);
  if (!user) return;
  let url = `/api/admin/users/${id}`;
  let method = 'PUT';
  let body = null;
  let done = '';

  switch (btn.dataset.userAction) {
    case 'reset-password': {
      const pw = prompt(`Kata sandi baru untuk @${user.username} (minimal 8 karakter):`);
      if (pw === null) return;
      if (pw.length < 8) { showToast('Kata sandi minimal 8 karakter', true); return; }
      url += '/password'; method = 'POST'; body = { new_password: pw };
      done = `Kata sandi @${user.username} direset. Sampaikan ke yang bersangkutan.`;
      break;
    }
    case 'set-role':
      if (!confirm(`Jadikan ${user.display_name} sebagai ${ROLE_LABEL[btn.dataset.role]}?`)) return;
      body = { role: btn.dataset.role };
      done = `${user.display_name} sekarang ${ROLE_LABEL[btn.dataset.role]}`;
      break;
    case 'toggle-active':
      if (user.is_active && !confirm(`Nonaktifkan ${user.display_name}? Akun ini langsung keluar dari semua perangkat.`)) return;
      body = { is_active: !user.is_active };
      done = user.is_active ? `${user.display_name} dinonaktifkan` : `${user.display_name} diaktifkan`;
      break;
    case 'delete':
      if (!confirm(`Hapus akun ${user.display_name} (@${user.username})? Tindakan ini tidak bisa dibatalkan.`)) return;
      method = 'DELETE';
      done = `Akun @${user.username} dihapus`;
      break;
    default:
      return;
  }

  try {
    const res = await fetch(url, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Gagal memproses akun');
    showToast(done);
    loadUsers();
    loadAuditLog();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ───────── Delegated table / action clicks ───────── */
document.addEventListener('click', (e) => {
  const tvBtn = e.target.closest('[data-tv-action]');
  if (tvBtn) {
    triggerTvAction(tvBtn.dataset.tvAction, tvBtn.dataset.client || null);
    return;
  }
  const tvDelete = e.target.closest('[data-tv-delete]');
  if (tvDelete) {
    deleteTvClient(tvDelete);
    return;
  }
  const userBtn = e.target.closest('[data-user-action]');
  if (userBtn) {
    userAction(userBtn);
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'toggle-text') toggleRunningText(id);
  if (btn.dataset.action === 'delete-text') deleteRunningText(id);
  if (btn.dataset.action === 'delete-slide') deleteSlide(id);
});

setInterval(loadTvClients, 10000);

window.addEventListener('DOMContentLoaded', () => {
  // Parallel, independent loads
  loadCurrentUser();
  loadCities();
  loadSettings();
  loadRunningTexts();
  loadSlides();
  loadTvClients();
});
