/**
 * Google TV Display Engine
 * Jam Sholat Digital TV with custom background and clutter-free display
 */

let TV_CLIENT_ID = localStorage.getItem('azan_tv_client_id');
if (!TV_CLIENT_ID) {
  TV_CLIENT_ID = 'gtv_' + Math.random().toString(36).substring(2, 10);
  localStorage.setItem('azan_tv_client_id', TV_CLIENT_ID);
}

// Escape any admin-supplied text before it reaches innerHTML
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow same-origin upload paths or http(s) URLs as image sources
function safeImageUrl(url) {
  if (!url) return '';
  const u = String(url).trim();
  if (u.startsWith('/uploads/') || u.startsWith('/img/') || /^https?:\/\//i.test(u)) return u.replace(/"/g, '%22');
  return '';
}

const DEFAULT_BG = '/img/backgrounds/default.jpg';

// Preload the photo first; if it fails (deleted upload, dead external URL,
// offline), fall back to the bundled default instead of a blank screen.
function applyBackground(layer, url) {
  if (layer.dataset.bgUrl === url) return;
  layer.dataset.bgUrl = url;
  const img = new Image();
  img.onload = () => {
    if (layer.dataset.bgUrl === url) layer.style.backgroundImage = `url("${url}")`;
  };
  img.onerror = () => {
    if (layer.dataset.bgUrl !== url) return;
    console.warn('Foto latar gagal dimuat, pakai default:', url);
    layer.style.backgroundImage = `url("${DEFAULT_BG}")`;
  };
  img.src = url;
}

// Global State
let appData = null;
let serverSkew = 0;
let currentSlideStep = 0;
let slideInterval = null;
let currentState = 'NORMAL';
let activePrayer = null;
let stateEndTime = 0;
let clientEngine = null;

// Native Web Audio Synthesizer
class TvAudioSynth {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playAzanChime() {
    this.init();
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = this.ctx.currentTime + idx * 0.26;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 1.3);
    });
  }

  playBeep(count = 1, freq = 880) {
    this.init();
    if (!this.ctx) return;
    for (let i = 0; i < count; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = this.ctx.currentTime + i * 0.2;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.18);
    }
  }
}

const audioSynth = new TvAudioSynth();
window.addEventListener('click', () => audioSynth.init(), { once: true });
window.addEventListener('keydown', () => audioSynth.init(), { once: true });

async function loadData() {
  try {
    const res = await fetch('/api/data?t=' + Date.now());
    if (!res.ok) throw new Error('Network error');
    const data = await res.json();
    if (data.success) {
      appData = data;
      serverSkew = data.serverTime - Date.now();
      localStorage.setItem('azan_tv_cache', JSON.stringify(data));
      applyDataToUI();
    }
  } catch (err) {
    console.warn('Gagal fetch data, load cache:', err);
    const cached = localStorage.getItem('azan_tv_cache');
    if (cached) {
      try {
        appData = JSON.parse(cached);
        applyDataToUI();
      } catch (e) {}
    }
  }
}

function applyDataToUI() {
  if (!appData) return;
  const s = appData.settings;

  // 1. Custom background image & overlay
  const bgLayer = document.getElementById('tv-bg-layer');
  if (bgLayer) {
    const bgUrl = safeImageUrl(s.tv_bg_image) || DEFAULT_BG;
    applyBackground(bgLayer, bgUrl);
  }
  const bgOverlay = document.getElementById('tv-bg-overlay');
  if (bgOverlay) {
    const overlayVal = s.tv_bg_overlay !== undefined ? s.tv_bg_overlay : '0.22';
    bgOverlay.style.backgroundColor = `rgba(0, 0, 0, ${parseFloat(overlayVal) || 0})`;
  }

  // 2. Mosque / Yayasan name & address
  document.getElementById('mosque-name').innerText = s.mosque_name || 'MASJID LUQMANUL HAKIM';
  document.getElementById('mosque-address').innerText = s.mosque_address || 'Jl. Gandasoli Kidul No. 42 Ds. Gandasari Kec. Katapang Kab. Bandung, 40921';

  // 3. Hijri date
  if (appData.hijri) {
    document.getElementById('hijri-date').innerText = appData.hijri.formatted;
  }

  // 4. Client calculation engine
  clientEngine = new ClientPrayerEngine({
    lat: parseFloat(s.latitude),
    lng: parseFloat(s.longitude),
    timezone: parseFloat(s.timezone),
    elevation: parseFloat(s.elevation || 700),
    fajrAngle: parseFloat(s.fajr_angle || 20),
    ishaAngle: parseFloat(s.isha_angle || 18),
    ihtiyat: {
      imsak: parseInt(s.ihtiyat_imsak || 0),
      subuh: parseInt(s.ihtiyat_subuh !== undefined ? s.ihtiyat_subuh : 2),
      terbit: parseInt(s.ihtiyat_terbit !== undefined ? s.ihtiyat_terbit : -2),
      dhuha: parseInt(s.ihtiyat_dhuha || 0),
      dzuhur: parseInt(s.ihtiyat_dzuhur !== undefined ? s.ihtiyat_dzuhur : 2),
      ashar: parseInt(s.ihtiyat_ashar !== undefined ? s.ihtiyat_ashar : 2),
      maghrib: parseInt(s.ihtiyat_maghrib !== undefined ? s.ihtiyat_maghrib : 2),
      isya: parseInt(s.ihtiyat_isya !== undefined ? s.ihtiyat_isya : 2)
    }
  });

  renderPrayerBar();
  renderRunningText();
  renderSlides();
  tick();
}

// On Fridays the Dzuhur slot is Jumat prayer.
function isJumat(prayerKey, date) {
  return prayerKey === 'dzuhur' && date.getDay() === 5;
}

function prayerName(prayer, date) {
  return isJumat(prayer.key, date) ? 'Jumat' : prayer.name;
}

// Seven-card prayer deck. Imsak and Syuruq are markers, rendered quieter.
function renderPrayerBar() {
  if (!appData || !appData.prayerTimes) return;
  const pt = appData.prayerTimes;

  const prayers = [
    { key: 'imsak', name: 'Imsak' },
    { key: 'subuh', name: 'Subuh' },
    { key: 'terbit', name: 'Syuruq' },
    { key: 'dzuhur', name: 'Dzuhur' },
    { key: 'ashar', name: 'Ashar' },
    { key: 'maghrib', name: 'Maghrib' },
    { key: 'isya', name: 'Isya' }
  ];
  const markers = ['imsak', 'terbit'];

  const grid = document.getElementById('prayer-cards-deck');
  grid.innerHTML = '';

  prayers.forEach(p => {
    const slot = document.createElement('li');
    slot.className = 'prayer-slot-box' + (markers.includes(p.key) ? ' is-marker' : '');
    slot.id = `slot-${p.key}`;
    slot.innerHTML = `
      <span class="slot-next-label">Berikutnya</span>
      <span class="slot-title" id="title-${p.key}">${prayerName(p, new Date(Date.now() + serverSkew))}</span>
      <span class="slot-hour">${escapeHtml(pt[p.key] || '--:--')}</span>
      <span class="slot-countdown" id="cd-${p.key}"></span>
    `;
    grid.appendChild(slot);
  });
}

// Two-tier ticker: tier 1 scrolls admin announcements, tier 2 rotates static reminders
const DEFAULT_INFO = 'Selamat Datang di Masjid Luqmanul Hakim - Yayasan Pendidikan Islam (TKIT - SDIT - SMPIT)';
const REMINDERS = [
  '"Kerjakanlah sholat tepat pada waktunya" (HR. Muslim)',
  'Luruskan dan rapatkan shaf sholat berjamaah untuk kesempurnaan sholat.'
];
let reminderIndex = 0;
let reminderTimer = null;

function renderRunningText() {
  if (!appData) return;
  const texts = (appData.runningTexts || []).map(t => t.text).filter(Boolean);
  const infoTicker = document.getElementById('ticker-dark-content');

  const items = texts.length ? texts : [DEFAULT_INFO];
  infoTicker.innerHTML = items.map(escapeHtml).join('<span class="ticker-sep" aria-hidden="true"></span>');
  // Constant reading speed regardless of text length (about 9 characters per second)
  const chars = items.join(' ').length;
  infoTicker.style.setProperty('--ticker-duration', Math.max(20, Math.round(chars / 9 + 12)) + 's');

  showReminder();
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = setInterval(rotateReminder, 15000);
}

function showReminder() {
  document.getElementById('ticker-red-content').textContent = REMINDERS[reminderIndex % REMINDERS.length];
}

function rotateReminder() {
  const el = document.getElementById('ticker-red-content');
  el.classList.add('is-swapping');
  setTimeout(() => {
    reminderIndex++;
    showReminder();
    el.classList.remove('is-swapping');
  }, 160);
}

// Center stage: alternates between an announcement slide and the clean background
function renderSlides() {
  if (!appData) return;
  // Financial (kas) slides are never shown on this display
  const slides = (appData.slides || []).filter(s => s.type !== 'kas');
  const stage = document.getElementById('tv-center-stage');

  if (slideInterval) clearTimeout(slideInterval);

  if (slides.length === 0) {
    stage.innerHTML = '';
    return;
  }

  const s = appData.settings;
  const kickers = { announcement: 'Agenda Yayasan', hadith: 'Hadits & Pengingat', image: 'Poster Kegiatan', jumat: "Petugas Jum'at" };

  const cycleStage = () => {
    // Even step = clean background (16s), odd step = slide
    const isShowingSlide = (currentSlideStep % 2 === 1);
    const slideIndex = Math.floor(currentSlideStep / 2) % slides.length;

    if (!isShowingSlide) {
      stage.innerHTML = '';
      slideInterval = setTimeout(() => {
        currentSlideStep++;
        cycleStage();
      }, 16000);
      return;
    }

    const slide = slides[slideIndex];
    const kicker = kickers[slide.type] || 'Informasi';

    if (slide.type === 'jumat') {
      stage.innerHTML = `
        <div class="slide-backdrop-box">
          <div class="slide-kicker">${kicker}</div>
          <div class="slide-title">${escapeHtml(slide.title || "Sholat Jum'at")}</div>
          ${s.jumat_tanggal ? `<div class="slide-subtitle">${escapeHtml(s.jumat_tanggal)}</div>` : ''}
          <dl class="jumat-roster">
            <div><dt>Khatib</dt><dd>${escapeHtml(s.jumat_khatib || '-')}</dd></div>
            <div><dt>Imam</dt><dd>${escapeHtml(s.jumat_imam || '-')}</dd></div>
            <div><dt>Muadzin</dt><dd>${escapeHtml(s.jumat_muadzin || '-')}</dd></div>
          </dl>
        </div>
      `;
    } else {
      const img = slide.type === 'image' ? safeImageUrl(slide.image_url) : '';
      stage.innerHTML = `
        <div class="slide-backdrop-box${img ? ' has-image' : ''}">
          ${img ? `<img class="slide-poster" src="${img}" alt="${escapeHtml(slide.title || 'Poster kegiatan')}">` : ''}
          <div class="slide-kicker">${kicker}</div>
          <div class="slide-title">${escapeHtml(slide.title)}</div>
          ${slide.subtitle ? `<div class="slide-subtitle">${escapeHtml(slide.subtitle)}</div>` : ''}
          ${slide.content ? `<div class="slide-text">${escapeHtml(slide.content)}</div>` : ''}
        </div>
      `;
    }

    const duration = parseInt(slide.duration || 10, 10);
    slideInterval = setTimeout(() => {
      currentSlideStep++;
      cycleStage();
    }, duration * 1000);
  };

  cycleStage();
}

function tick() {
  const now = new Date(Date.now() + serverSkew);
  const pad = (n) => String(n).padStart(2, '0');

  const clockEl = document.getElementById('clock-main');
  if (clockEl) clockEl.innerText = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const secEl = document.getElementById('clock-sec');
  if (secEl) secEl.innerText = pad(now.getSeconds());

  const days = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const gregEl = document.getElementById('gregorian-date');
  if (gregEl) gregEl.innerText = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  if (!appData || !appData.prayerTimes) return;
  const currentSecondsOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  handlePrayerScheduleAndCountdowns(now, currentSecondsOfDay);
}

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60;
}

function handlePrayerScheduleAndCountdowns(now, currentSec) {
  const pt = appData.prayerTimes;

  const mainPrayers = [
    { key: 'subuh', name: 'Subuh' },
    { key: 'dzuhur', name: 'Dzuhur' },
    { key: 'ashar', name: 'Ashar' },
    { key: 'maghrib', name: 'Maghrib' },
    { key: 'isya', name: 'Isya' }
  ];

  const allPoints = [
    { key: 'imsak', name: 'Imsak' },
    { key: 'subuh', name: 'Subuh' },
    { key: 'terbit', name: 'Syuruq' },
    { key: 'dzuhur', name: 'Dzuhur' },
    { key: 'ashar', name: 'Ashar' },
    { key: 'maghrib', name: 'Maghrib' },
    { key: 'isya', name: 'Isya' }
  ];

  // Azan trigger
  if (currentState === 'NORMAL') {
    for (const p of mainPrayers) {
      if (currentSec === timeToSeconds(pt[p.key])) {
        startAzan({ ...p, name: prayerName(p, now), jumat: isJumat(p.key, now) });
        return;
      }
    }
  }

  if (currentState === 'AZAN') { handleAzanState(now); return; }
  if (currentState === 'IQOMAH') { handleIqomahState(now); return; }
  if (currentState === 'SALAT') { handleSalatState(now); return; }

  // Find next prayer point
  let nextPoint = null;
  let minDiff = Infinity;

  for (const point of allPoints) {
    const diff = timeToSeconds(pt[point.key]) - currentSec;
    if (diff > 0 && diff < minDiff) {
      minDiff = diff;
      nextPoint = point;
    }
  }

  if (!nextPoint) {
    const tomorrowImsakSec = timeToSeconds(appData.tomorrowPrayerTimes?.imsak || pt.imsak) + 86400;
    minDiff = tomorrowImsakSec - currentSec;
    nextPoint = { key: 'imsak', name: 'Imsak' };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const cdFormatted = `${pad(Math.floor(minDiff / 3600))}:${pad(Math.floor((minDiff % 3600) / 60))}:${pad(minDiff % 60)}`;

  const badgeLabel = document.getElementById('badge-countdown-label');
  const badgeText = document.getElementById('badge-countdown-text');
  if (badgeLabel) badgeLabel.innerText = `Menuju ${prayerName(nextPoint, now)}`;
  if (badgeText) badgeText.innerText = cdFormatted;

  allPoints.forEach(p => {
    const slot = document.getElementById(`slot-${p.key}`);
    const cdSlot = document.getElementById(`cd-${p.key}`);
    if (!slot) return;
    // Keeps the Dzuhur/Jumat card right when the day changes without a reload
    const titleEl = document.getElementById(`title-${p.key}`);
    const title = prayerName(p, now);
    if (titleEl && titleEl.innerText !== title) titleEl.innerText = title;
    const isNext = p.key === nextPoint.key;
    slot.classList.toggle('is-active-slot', isNext);
    if (cdSlot) cdSlot.innerText = isNext ? `-${cdFormatted}` : '';
  });
}

function startAzan(prayer) {
  currentState = 'AZAN';
  activePrayer = prayer;
  const azanDurationMin = parseInt(appData.settings.azan_duration || 3, 10);
  stateEndTime = Date.now() + azanDurationMin * 60 * 1000;

  document.getElementById('azan-lead').innerText = prayer.jumat ? 'Waktunya azan Jumat' : 'Waktu sholat telah tiba';
  document.getElementById('azan-prayer-hero').innerText = `Adzan ${prayer.name}`;
  document.getElementById('overlay-azan').classList.add('active');

  if (appData.settings.beep_enabled !== '0') {
    audioSynth.playAzanChime();
  }
}

function handleAzanState(now) {
  if (stateEndTime - Date.now() <= 0) {
    document.getElementById('overlay-azan').classList.remove('active');
    startIqomah(activePrayer);
  }
}

function startIqomah(prayer) {
  currentState = 'IQOMAH';
  const iqomahKey = `iqomah_${prayer.key.toLowerCase()}`;
  const iqomahDurationMin = parseInt(appData.settings[iqomahKey] || 10, 10);
  stateEndTime = Date.now() + iqomahDurationMin * 60 * 1000;

  document.getElementById('iqomah-prayer-lead').innerText = `Iqomah ${prayer.name}`;
  document.getElementById('overlay-iqomah').classList.add('active');

  if (appData.settings.beep_enabled !== '0') {
    audioSynth.playBeep(2, 660);
  }
}

function handleIqomahState(now) {
  const remainingSec = Math.max(0, Math.floor((stateEndTime - Date.now()) / 1000));
  const pad = (n) => String(n).padStart(2, '0');

  document.getElementById('iqomah-timer').innerText = `${pad(Math.floor(remainingSec / 60))}:${pad(remainingSec % 60)}`;

  if (remainingSec <= 10 && remainingSec > 0 && appData.settings.beep_enabled !== '0') {
    audioSynth.playBeep(1, 880);
  }

  if (remainingSec <= 0) {
    if (appData.settings.beep_enabled !== '0') {
      audioSynth.playBeep(3, 1046);
    }
    document.getElementById('overlay-iqomah').classList.remove('active');
    startSalat(activePrayer);
  }
}

function startSalat(prayer) {
  currentState = 'SALAT';
  const salatDurationMin = parseInt(appData.settings.salat_duration || 15, 10);
  stateEndTime = Date.now() + salatDurationMin * 60 * 1000;
  document.getElementById('overlay-salat').classList.add('active');
}

function handleSalatState(now) {
  if (stateEndTime - Date.now() <= 0) {
    document.getElementById('overlay-salat').classList.remove('active');
    currentState = 'NORMAL';
    activePrayer = null;
  }
}

function sendHeartbeat() {
  fetch('/api/client/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: TV_CLIENT_ID,
      name: 'Google TV',
      screenRes: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: navigator.userAgent
    })
  }).catch(() => {});
}

// Network chip reflects the real connection state (browser + live event stream)
function setNetworkState(isOnline) {
  const chip = document.getElementById('chip-network');
  const text = document.getElementById('chip-network-text');
  if (!chip || !text) return;
  chip.dataset.state = isOnline ? 'online' : 'offline';
  text.innerText = isOnline ? 'Terhubung' : 'Offline';
  const icon = chip.querySelector('iconify-icon');
  if (icon) icon.setAttribute('icon', isOnline ? 'lucide:wifi' : 'lucide:wifi-off');
}
window.addEventListener('online', () => setNetworkState(true));
window.addEventListener('offline', () => setNetworkState(false));

function setupSSE() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/events?clientId=' + TV_CLIENT_ID);

  es.onopen = () => setNetworkState(true);
  es.addEventListener('data-update', () => loadData());
  es.addEventListener('test-beep', () => audioSynth.playAzanChime());
  es.addEventListener('reload', () => window.location.reload());

  es.onerror = () => {
    setNetworkState(false);
    es.close();
    setTimeout(setupSSE, 10000);
  };
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  if (e.key === 'r' || e.key === 'R') loadData();
});

window.addEventListener('dblclick', toggleFullscreen);

document.addEventListener('DOMContentLoaded', () => {
  const audioBtn = document.getElementById('btn-audio-toggle');
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      audioSynth.init();
      audioSynth.playAzanChime();
    });
  }

  setNetworkState(navigator.onLine !== false);
  loadData();
  setupSSE();
  setInterval(tick, 1000);
  tick();
  setInterval(loadData, 30 * 60 * 1000);
  sendHeartbeat();
  setInterval(sendHeartbeat, 20000);
});
