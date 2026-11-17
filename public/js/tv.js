/**
 * Google TV Display Engine (Gambar 2 Layout Reference)
 * Jam Sholat Digital TV with Custom Background & Clutter-Free Display
 */

let TV_CLIENT_ID = localStorage.getItem('azan_tv_client_id');
if (!TV_CLIENT_ID) {
  TV_CLIENT_ID = 'gtv_' + Math.random().toString(36).substring(2, 10);
  localStorage.setItem('azan_tv_client_id', TV_CLIENT_ID);
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

  // 1. Custom Background Image & Overlay (Gambar 2 Reference)
  const bgLayer = document.getElementById('tv-bg-layer');
  if (bgLayer) {
    const bgUrl = s.tv_bg_image || '/uploads/default_bg.jpg';
    bgLayer.style.backgroundImage = `url("${bgUrl}")`;
  }
  const bgOverlay = document.getElementById('tv-bg-overlay');
  if (bgOverlay) {
    const overlayVal = s.tv_bg_overlay !== undefined ? s.tv_bg_overlay : '0.22';
    bgOverlay.style.backgroundColor = `rgba(0, 0, 0, ${overlayVal})`;
  }

  // 2. Mosque / Yayasan Name & Address
  document.getElementById('mosque-name').innerText = s.mosque_name || 'MASJID LUQMANUL HAKIM';
  document.getElementById('mosque-address').innerText = s.mosque_address || 'Jl. Gandasoli Kidul No. 42 Ds. Gandasari Kec. Katapang Kab. Bandung, 40921';

  // 3. Hijri Date
  if (appData.hijri) {
    document.getElementById('hijri-date').innerText = appData.hijri.formatted;
  }

  // 4. Setup client calculation engine
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
  tick(); // immediate calculation
}

// 7 Prayer Cards Floating Deck (Gambar 2 Reference)
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

  const grid = document.getElementById('prayer-cards-deck');
  grid.innerHTML = '';

  prayers.forEach(p => {
    const slot = document.createElement('div');
    slot.className = `prayer-slot-box color-${p.key}`;
    slot.id = `slot-${p.key}`;
    slot.innerHTML = `
      <div class="slot-title">${p.name}</div>
      <div class="slot-hour">${pt[p.key] || '--:--'}</div>
      <div class="slot-countdown" id="cd-${p.key}"></div>
      <div class="slot-stripe"></div>
    `;
    grid.appendChild(slot);
  });
}

// Dual-Tier Ticker: Tier 1 (Dark Bar Agenda) & Tier 2 (Red Bar Hadits)
function renderRunningText() {
  if (!appData) return;
  const texts = appData.runningTexts || [];

  const darkTicker = document.getElementById('ticker-dark-content');
  const redTicker = document.getElementById('ticker-red-content');

  if (texts.length === 0) {
    darkTicker.innerHTML = "Selamat Datang di Masjid Luqmanul Hakim - Yayasan Pendidikan Islam (TKIT - SDIT - SMPIT)";
    redTicker.innerHTML = '"Kerjakanlah sholat tepat pada waktunya" (HR. Muslim)';
    return;
  }

  // Agenda & School information
  const textStrings = texts.map(t => t.text);
  darkTicker.innerHTML = textStrings.join('<span class="ticker-sep">•</span>');
  redTicker.innerHTML = '"Kerjakanlah sholat tepat pada waktunya" (HR. Muslim) <span class="ticker-sep">•</span> "Luruskan dan rapatkan shaf sholat berjamaah untuk kesempurnaan sholat."';
}

// Center Stage: Alternates between Announcement Slide and Clean Background View
function renderSlides() {
  if (!appData) return;
  // STRICTLY FILTER OUT KAS / FINANCIAL REPORTS FOR EDUCATION FOUNDATION!
  const slides = (appData.slides || []).filter(s => s.type !== 'kas');
  const stage = document.getElementById('tv-center-stage');

  if (slides.length === 0) {
    stage.innerHTML = '';
    return;
  }

  const s = appData.settings;

  const cycleStage = () => {
    if (slides.length === 0) {
      stage.innerHTML = '';
      return;
    }

    // Step pattern: Even = Show Clear Background (15s), Odd = Show Slide (10s)
    const isShowingSlide = (currentSlideStep % 2 === 1);
    const slideIndex = Math.floor(currentSlideStep / 2) % slides.length;

    if (!isShowingSlide) {
      // Clean clear background showcase
      stage.innerHTML = '';
      slideInterval = setTimeout(() => {
        currentSlideStep++;
        cycleStage();
      }, 16000); // 16 seconds clean scenic view
      return;
    }

    const slide = slides[slideIndex];

    if (slide.type === 'jumat') {
      stage.innerHTML = `
        <div class="slide-backdrop-box">
          <div class="slide-title">${slide.title || "Sholat Jum'at"}</div>
          ${s.jumat_tanggal ? `<div class="slide-subtitle">${s.jumat_tanggal}</div>` : ''}
          <div class="jumat-roster-grid">
            <div class="jumat-box">
              <span>Khatib</span>
              <h4>${s.jumat_khatib || '-'}</h4>
            </div>
            <div class="jumat-box">
              <span>Imam</span>
              <h4>${s.jumat_imam || '-'}</h4>
            </div>
            <div class="jumat-box">
              <span>Muadzin</span>
              <h4>${s.jumat_muadzin || '-'}</h4>
            </div>
          </div>
        </div>
      `;
    } else {
      stage.innerHTML = `
        <div class="slide-backdrop-box">
          <div class="slide-title">${slide.title}</div>
          ${slide.subtitle ? `<div class="slide-subtitle">${slide.subtitle}</div>` : ''}
          <div class="slide-text">${slide.content || ''}</div>
        </div>
      `;
    }

    const duration = parseInt(slide.duration || 10, 10);
    slideInterval = setTimeout(() => {
      currentSlideStep++;
      cycleStage();
    }, duration * 1000);
  };

  if (slideInterval) clearTimeout(slideInterval);
  cycleStage();
}

function tick() {
  const now = new Date(Date.now() + serverSkew);
  const pad = (n) => String(n).padStart(2, '0');
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());

  // Gambar 2 format: clean bold HH:MM
  const clockEl = document.getElementById('clock-main');
  if (clockEl) clockEl.innerText = `${hh}:${mm}`;

  const days = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const gregEl = document.getElementById('gregorian-date');
  if (gregEl) gregEl.innerText = dateStr;

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
      const pSec = timeToSeconds(pt[p.key]);
      if (currentSec === pSec) {
        startAzan(p);
        return;
      }
    }
  }

  if (currentState === 'AZAN') {
    handleAzanState(now);
    return;
  } else if (currentState === 'IQOMAH') {
    handleIqomahState(now);
    return;
  } else if (currentState === 'SALAT') {
    handleSalatState(now);
    return;
  }

  // Find next prayer point
  let nextPoint = null;
  let minDiff = Infinity;

  for (const point of allPoints) {
    const targetSec = timeToSeconds(pt[point.key]);
    const diff = targetSec - currentSec;
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
  const cdH = Math.floor(minDiff / 3600);
  const cdM = Math.floor((minDiff % 3600) / 60);
  const cdS = minDiff % 60;
  const cdFormatted = `${pad(cdH)}:${pad(cdM)}:${pad(cdS)}`;

  // Floating red badge on top right (Gambar 2 Reference)
  const badgeText = document.getElementById('badge-countdown-text');
  if (badgeText) {
    badgeText.innerText = `${nextPoint.name} -${cdFormatted}`;
  }

  // Update Prayer slots in the deck
  allPoints.forEach(p => {
    const slot = document.getElementById(`slot-${p.key}`);
    const cdSlot = document.getElementById(`cd-${p.key}`);
    if (slot) {
      if (p.key === nextPoint.key) {
        slot.classList.add('is-active-slot');
        if (cdSlot) {
          cdSlot.innerText = `-${cdFormatted}`;
        }
      } else {
        slot.classList.remove('is-active-slot');
        if (cdSlot) {
          cdSlot.innerText = '';
        }
      }
    }
  });
}

function startAzan(prayer) {
  currentState = 'AZAN';
  activePrayer = prayer;
  const azanDurationMin = parseInt(appData.settings.azan_duration || 3, 10);
  stateEndTime = Date.now() + azanDurationMin * 60 * 1000;

  document.getElementById('azan-prayer-hero').innerText = `ADZAN ${prayer.name.toUpperCase()}`;
  document.getElementById('overlay-azan').classList.add('active');

  if (appData.settings.beep_enabled !== '0') {
    audioSynth.playAzanChime();
  }
}

function handleAzanState(now) {
  const remainingMs = stateEndTime - Date.now();
  if (remainingMs <= 0) {
    document.getElementById('overlay-azan').classList.remove('active');
    startIqomah(activePrayer);
  }
}

function startIqomah(prayer) {
  currentState = 'IQOMAH';
  const iqomahKey = `iqomah_${prayer.key.toLowerCase()}`;
  const iqomahDurationMin = parseInt(appData.settings[iqomahKey] || 10, 10);
  stateEndTime = Date.now() + iqomahDurationMin * 60 * 1000;

  document.getElementById('iqomah-prayer-lead').innerText = `IQOMAH ${prayer.name.toUpperCase()}`;
  document.getElementById('overlay-iqomah').classList.add('active');

  if (appData.settings.beep_enabled !== '0') {
    audioSynth.playBeep(2, 660);
  }
}

function handleIqomahState(now) {
  const remainingSec = Math.max(0, Math.floor((stateEndTime - Date.now()) / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const mm = pad(Math.floor(remainingSec / 60));
  const ss = pad(remainingSec % 60);

  document.getElementById('iqomah-timer').innerText = `${mm}:${ss}`;

  if (remainingSec <= 10 && remainingSec > 0) {
    if (appData.settings.beep_enabled !== '0') {
      audioSynth.playBeep(1, 880);
    }
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
  const remainingMs = stateEndTime - Date.now();
  if (remainingMs <= 0) {
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

function setupSSE() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/events?clientId=' + TV_CLIENT_ID);

  es.addEventListener('data-update', () => loadData());
  es.addEventListener('test-beep', () => audioSynth.playAzanChime());
  es.addEventListener('reload', () => window.location.reload());

  es.onerror = () => {
    es.close();
    setTimeout(setupSSE, 10000);
  };
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
  if (e.key === 'r' || e.key === 'R') {
    loadData();
  }
});

window.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const audioBtn = document.getElementById('btn-audio-toggle');
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      audioSynth.init();
      audioSynth.playAzanChime();
    });
  }

  loadData();
  setupSSE();
  setInterval(tick, 1000);
  tick();
  setInterval(loadData, 30 * 60 * 1000);
  sendHeartbeat();
  setInterval(sendHeartbeat, 20000);
});