/**
 * Admin Panel Script for Azan TV Management
 * Creative Tim Argon Dashboard Engine
 */

const token = localStorage.getItem('azan_admin_token');
if (!token) {
  window.location.href = '/login';
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  };
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.className = 'toast-argon show' + (isError ? ' error' : '');
  setTimeout(() => {
    toast.className = 'toast-argon';
  }, 3500);
}

// Tab Switching
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    item.classList.add('active');
    const tabId = item.dataset.tab;
    const target = document.getElementById(tabId);
    if (target) {
      target.classList.add('active');
    }
  });
});

// Logout
document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('azan_admin_token');
  window.location.href = '/login';
});

// Load Preset Cities
async function loadCities() {
  try {
    const res = await fetch('/api/admin/cities', { headers: authHeaders() });
    if (!res.ok) throw new Error('Auth failed');
    const cities = await res.json();
    const select = document.getElementById('city_preset');
    select.innerHTML = '<option value="">-- Pilih Preset Kota Acuan --</option>';
    cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(c);
      opt.innerText = `${c.name} (GMT+${c.timezone})`;
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

// Update Top 4 Argon KPI Stat Cards
async function updateKpiCards() {
  try {
    const res = await fetch('/api/data?t=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    const s = data.settings;
    const pt = data.prayerTimes;

    // 1. Next Prayer
    const now = new Date();
    const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const prayers = [
      { name: 'Imsak', time: pt.imsak },
      { name: 'Subuh', time: pt.subuh },
      { name: 'Syuruq', time: pt.terbit },
      { name: 'Dhuha', time: pt.dhuha },
      { name: 'Dzuhur', time: pt.dzuhur },
      { name: 'Ashar', time: pt.ashar },
      { name: 'Maghrib', time: pt.maghrib },
      { name: 'Isya', time: pt.isya }
    ];

    let next = null;
    for (const p of prayers) {
      if (!p.time) continue;
      const [h, m] = p.time.split(':').map(Number);
      const pSec = h * 3600 + m * 60;
      if (pSec > currentSec) {
        next = p;
        break;
      }
    }
    if (!next) next = { name: 'Imsak Besok', time: data.tomorrowPrayerTimes?.imsak || pt.imsak };
    document.getElementById('kpi-next-prayer').innerText = `${next.name} ${next.time}`;
    document.getElementById('kpi-next-cd').innerText = `Terhitung Presisi`;

    // 2. Jumat Info
    document.getElementById('kpi-jumat-khatib').innerText = s.jumat_khatib || 'Khatib -';
    document.getElementById('kpi-jumat-tgl').innerText = s.jumat_tanggal || "Jum'at Pekan Ini";

    // 3. Konten Display Count
    const textCount = (data.runningTexts || []).length;
    const slideCount = (data.slides || []).length;
    document.getElementById('kpi-content-count').innerText = `${slideCount} Slide / ${textCount} Teks`;
  } catch (e) {}
}

// Load Settings
async function loadSettings() {
  try {
    const res = await fetch('/api/admin/settings', { headers: authHeaders() });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    const s = data.settings;

    // Mosque & Location
    document.getElementById('mosque_name').value = s.mosque_name || 'MASJID LUQMANUL HAKIM';
    document.getElementById('mosque_address').value = s.mosque_address || 'Jl. Gandasoli Kidul No. 42 Ds. Gandasari Kec. Katapang Kab. Bandung, 40921';
    document.getElementById('city_name').value = s.city_name || 'Bandung';
    document.getElementById('latitude').value = s.latitude || '-6.9175';
    document.getElementById('longitude').value = s.longitude || '107.6191';
    document.getElementById('timezone').value = s.timezone || '7';
    document.getElementById('elevation').value = s.elevation || '700';
    document.getElementById('hijri_offset').value = s.hijri_offset || '0';

    // Ihtiyat
    document.getElementById('ihtiyat_imsak').value = s.ihtiyat_imsak || '0';
    document.getElementById('ihtiyat_subuh').value = s.ihtiyat_subuh !== undefined ? s.ihtiyat_subuh : '2';
    document.getElementById('ihtiyat_terbit').value = s.ihtiyat_terbit !== undefined ? s.ihtiyat_terbit : '-2';
    document.getElementById('ihtiyat_dhuha').value = s.ihtiyat_dhuha || '0';
    document.getElementById('ihtiyat_dzuhur').value = s.ihtiyat_dzuhur !== undefined ? s.ihtiyat_dzuhur : '2';
    document.getElementById('ihtiyat_ashar').value = s.ihtiyat_ashar !== undefined ? s.ihtiyat_ashar : '2';
    document.getElementById('ihtiyat_maghrib').value = s.ihtiyat_maghrib !== undefined ? s.ihtiyat_maghrib : '2';
    document.getElementById('ihtiyat_isya').value = s.ihtiyat_isya !== undefined ? s.ihtiyat_isya : '2';

    // Timers & Audio
    document.getElementById('azan_duration').value = s.azan_duration || '3';
    document.getElementById('salat_duration').value = s.salat_duration || '15';
    document.getElementById('iqomah_subuh').value = s.iqomah_subuh || '10';
    document.getElementById('iqomah_dzuhur').value = s.iqomah_dzuhur || '10';
    document.getElementById('iqomah_ashar').value = s.iqomah_ashar || '10';
    document.getElementById('iqomah_maghrib').value = s.iqomah_maghrib || '7';
    document.getElementById('iqomah_isya').value = s.iqomah_isya || '7';
    document.getElementById('beep_enabled').value = s.beep_enabled !== undefined ? s.beep_enabled : '1';

    // Jumat
    document.getElementById('jumat_khatib').value = s.jumat_khatib || '';
    document.getElementById('jumat_imam').value = s.jumat_imam || '';
    document.getElementById('jumat_muadzin').value = s.jumat_muadzin || '';
    document.getElementById('jumat_tanggal').value = s.jumat_tanggal || '';

    // Background Image Settings
    const bgUrl = s.tv_bg_image || '/uploads/default_bg.jpg';
    document.getElementById('tv_bg_image').value = bgUrl;
    document.getElementById('tv_bg_overlay').value = s.tv_bg_overlay !== undefined ? s.tv_bg_overlay : '0.25';
    document.getElementById('bg-preview-img').src = bgUrl;

    document.getElementById('topbar-mosque-name').innerText = s.mosque_name || 'Masjid Kita';
    updateKpiCards();
  } catch (err) {
    console.error('Error load settings:', err);
    showToast('Gagal memuat data', true);
  }
}

// Save Settings Form
async function saveSettings(formDataObj) {
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(formDataObj)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Data berhasil diperbarui dan disinkronkan ke TV');
      loadSettings();
    } else {
      showToast(data.error || 'Gagal menyimpan data', true);
    }
  } catch (err) {
    showToast('Kesalahan jaringan saat menyimpan', true);
  }
}

// Bind Forms
['form-masjid', 'form-ihtiyat', 'form-timers', 'form-jumat', 'form-bg-settings'].forEach(formId => {
  const f = document.getElementById(formId);
  if (f) {
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(f);
      const obj = Object.fromEntries(formData.entries());
      saveSettings(obj);
    });
  }
});

// Upload Background Photo
document.getElementById('form-upload-bg').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('bg_file');
  if (fileInput.files.length === 0) return;

  const uploadData = new FormData();
  uploadData.append('file', fileInput.files[0]);

  try {
    const res = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: uploadData
    });
    const data = await res.json();
    if (res.ok && data.url) {
      document.getElementById('tv_bg_image').value = data.url;
      document.getElementById('bg-preview-img').src = data.url;
      // Auto save settings with new background
      await saveSettings({ tv_bg_image: data.url });
      showToast('Gambar background TV berhasil diunggah dan diterapkan!');
    } else {
      showToast(data.error || 'Gagal mengunggah background', true);
    }
  } catch (err) {
    showToast('Kesalahan koneksi saat upload', true);
  }
});

// Preset Background Buttons
document.querySelectorAll('.btn-preset-bg').forEach(btn => {
  btn.addEventListener('click', async () => {
    const url = btn.dataset.url;
    if (!url) return;
    document.getElementById('tv_bg_image').value = url;
    document.getElementById('bg-preview-img').src = url;
    await saveSettings({ tv_bg_image: url });
    showToast('Preset background berhasil diterapkan ke TV!');
  });
});

// Running Texts CRUD
async function loadRunningTexts() {
  try {
    const res = await fetch('/api/admin/running-texts', { headers: authHeaders() });
    const texts = await res.json();
    const tbody = document.getElementById('table-running-texts');
    tbody.innerHTML = '';

    if (texts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#8898aa; padding: 24px;">Belum ada pengumuman running text.</td></tr>';
      return;
    }

    texts.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700; color:#525f7f;">#${item.sort_order}</td>
        <td><strong>${item.text}</strong></td>
        <td>
          <span class="badge-dot ${item.is_active ? 'active' : 'inactive'}">
            <i></i> ${item.is_active ? 'Aktif' : 'Nonaktif'}
          </span>
        </td>
        <td style="display: flex; gap: 8px;">
          <button class="btn-argon btn-secondary-argon btn-sm-argon" onclick="toggleRunningText(${item.id}, ${item.is_active ? 0 : 1}, '${encodeURIComponent(item.text)}')">
            ${item.is_active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button class="btn-argon btn-danger-argon btn-sm-argon" onclick="deleteRunningText(${item.id})">
            <iconify-icon icon="lucide:trash-2"></iconify-icon>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error load running texts:', err);
  }
}

document.getElementById('form-add-ticker').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-ticker-text');
  const sort = document.getElementById('new-ticker-sort').value;
  const text = input.value.trim();
  if (!text) return;

  try {
    const res = await fetch('/api/admin/running-texts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text, sort_order: parseInt(sort, 10) || 0 })
    });
    if (res.ok) {
      input.value = '';
      showToast('Running text ditambahkan');
      loadRunningTexts();
      updateKpiCards();
    }
  } catch (err) {
    showToast('Gagal menambahkan running text', true);
  }
});

window.toggleRunningText = async (id, newActive, textEncoded) => {
  try {
    const text = decodeURIComponent(textEncoded);
    await fetch(`/api/admin/running-texts/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ text, is_active: newActive, sort_order: 0 })
    });
    showToast('Status running text diubah');
    loadRunningTexts();
  } catch (err) {
    showToast('Gagal mengubah status', true);
  }
};

window.deleteRunningText = async (id) => {
  if (!confirm('Hapus teks ini?')) return;
  try {
    await fetch(`/api/admin/running-texts/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    showToast('Running text dihapus');
    loadRunningTexts();
    updateKpiCards();
  } catch (err) {
    showToast('Gagal menghapus', true);
  }
};

// Slides Management
async function loadSlides() {
  try {
    const res = await fetch('/api/admin/slides', { headers: authHeaders() });
    const rawSlides = await res.json();
    // Exclude any legacy kas slides
    const slides = rawSlides.filter(s => s.type !== 'kas');
    const tbody = document.getElementById('table-slides');
    tbody.innerHTML = '';

    if (slides.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#8898aa; padding: 24px;">Belum ada slide agenda yayasan.</td></tr>';
      return;
    }

    slides.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700; color:#525f7f;">#${item.sort_order}</td>
        <td>
          <div style="font-weight:700; color:#32325d;">${item.title}</div>
          ${item.subtitle ? `<div style="font-size: 11.5px; color: #8898aa; margin-top:2px;">${item.subtitle}</div>` : ''}
        </td>
        <td><span style="font-size: 11px; text-transform:uppercase; font-weight:700; color: #5e72e4;">${item.type}</span></td>
        <td style="color:#525f7f; font-weight:600;">${item.duration}s</td>
        <td>
          <button class="btn-argon btn-danger-argon btn-sm-argon" onclick="deleteSlide(${item.id})">
            <iconify-icon icon="lucide:trash-2"></iconify-icon>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error load slides:', err);
  }
}

document.getElementById('form-add-slide').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const title = f.slide_title.value.trim();
  const subtitle = f.slide_subtitle.value.trim();
  const type = f.slide_type.value;
  const content = f.slide_content.value.trim();
  const duration = parseInt(f.slide_duration.value, 10) || 10;
  const sort_order = parseInt(f.slide_sort.value, 10) || 0;
  let image_url = '';

  const fileInput = document.getElementById('slide_file');
  if (type === 'image' && fileInput.files.length > 0) {
    const uploadData = new FormData();
    uploadData.append('file', fileInput.files[0]);
    try {
      const uploadRes = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: uploadData
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadJson.error || 'Upload gagal');
      image_url = uploadJson.url;
    } catch (err) {
      showToast('Gagal upload gambar: ' + err.message, true);
      return;
    }
  }

  try {
    const res = await fetch('/api/admin/slides', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, subtitle, type, content, image_url, duration, sort_order, is_active: 1 })
    });
    if (res.ok) {
      f.reset();
      showToast('Agenda berhasil ditambahkan');
      loadSlides();
      updateKpiCards();
    }
  } catch (err) {
    showToast('Gagal menambahkan slide', true);
  }
});

window.deleteSlide = async (id) => {
  if (!confirm('Hapus slide ini?')) return;
  try {
    await fetch(`/api/admin/slides/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    showToast('Slide dihapus');
    loadSlides();
    updateKpiCards();
  } catch (err) {
    showToast('Gagal menghapus slide', true);
  }
};

// Connected TV Devices Monitoring & Actions
async function loadTvClients() {
  try {
    const res = await fetch('/api/admin/tv-clients', { headers: authHeaders() });
    const clients = await res.json();
    const tbody = document.getElementById('table-tv-clients');
    const badgeCount = document.getElementById('topbar-tv-count');
    const kpiTvStatus = document.getElementById('kpi-tv-status');
    tbody.innerHTML = '';

    const onlineCount = clients.filter(c => c.status === 'online').length;
    badgeCount.innerText = `${onlineCount} TV Online`;
    if (kpiTvStatus) {
      kpiTvStatus.innerText = `${onlineCount} TV`;
    }

    if (clients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#8898aa; padding: 24px;">Belum ada Google TV yang tersambung. Buka URL /tv di browser TV Anda.</td></tr>';
      return;
    }

    clients.forEach(c => {
      const lastSeenSec = Math.floor((Date.now() - c.last_seen) / 1000);
      const isOnline = c.status === 'online';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="font-weight:700; color:#32325d;">${c.name}</div>
          <div style="font-size:11px; color:#8898aa;">ID: ${c.id}</div>
        </td>
        <td style="color:#525f7f; font-family:monospace;">${c.ip || '-'}</td>
        <td style="color:#525f7f; font-family:monospace;">${c.screen_res || '1920x1080'}</td>
        <td>
          <span class="badge-dot ${isOnline ? 'active' : 'inactive'}">
            <i></i> ${isOnline ? 'Online' : `Offline (${lastSeenSec}s lalu)`}
          </span>
        </td>
        <td style="display:flex; gap:6px;">
          <button class="btn-argon btn-secondary-argon btn-sm-argon" onclick="triggerTvAction('test-beep', '${c.id}')">
            <iconify-icon icon="lucide:volume-2"></iconify-icon> Bip
          </button>
          <button class="btn-argon btn-secondary-argon btn-sm-argon" onclick="triggerTvAction('reload', '${c.id}')">
            <iconify-icon icon="lucide:refresh-cw"></iconify-icon> Reload
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error load tv clients:', err);
  }
}

window.triggerTvAction = async (action, targetClientId = null) => {
  try {
    const res = await fetch('/api/admin/action', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action, targetClientId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Perintah ${action} dikirim ke TV`);
    } else {
      showToast(data.error || 'Gagal mengirim perintah', true);
    }
  } catch (err) {
    showToast('Gagal menghubungi TV', true);
  }
};

setInterval(loadTvClients, 10000);

window.addEventListener('DOMContentLoaded', () => {
  loadCities();
  loadSettings();
  loadRunningTexts();
  loadSlides();
  loadTvClients();
});
