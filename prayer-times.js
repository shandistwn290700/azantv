/**
 * Prayer Times & Hijri Calendar Engine (Standar Kemenag RI / Bimas Islam)
 */

class PrayerTimes {
  constructor(options = {}) {
    this.lat = options.lat || -6.2088; // Default Jakarta
    this.lng = options.lng || 106.8456;
    this.timezone = options.timezone !== undefined ? options.timezone : 7; // WIB = 7
    this.elevation = options.elevation || 10; // meters above sea level
    this.fajrAngle = options.fajrAngle || 20.0; // Standar Kemenag RI: 20 deg
    this.ishaAngle = options.ishaAngle || 18.0; // Standar Kemenag RI: 18 deg
    this.dhuhaAngle = options.dhuhaAngle || 4.5; // Dhuha: ~4.5 deg (atau ~20-25 menit pasca terbit)
    this.ihtiyat = {
      imsak: options.ihtiyat?.imsak || 0,
      subuh: options.ihtiyat?.subuh !== undefined ? options.ihtiyat.subuh : 2,
      terbit: options.ihtiyat?.terbit !== undefined ? options.ihtiyat.terbit : -2,
      dhuha: options.ihtiyat?.dhuha || 0,
      dzuhur: options.ihtiyat?.dzuhur !== undefined ? options.ihtiyat.dzuhur : 2,
      ashar: options.ihtiyat?.ashar !== undefined ? options.ihtiyat.ashar : 2,
      maghrib: options.ihtiyat?.maghrib !== undefined ? options.ihtiyat.maghrib : 2,
      isya: options.ihtiyat?.isya !== undefined ? options.ihtiyat.isya : 2
    };
  }

  // Trigonometric helpers in degrees
  degToRad(d) { return (d * Math.PI) / 180.0; }
  radToDeg(r) { return (r * 180.0) / Math.PI; }
  sinDeg(d) { return Math.sin(this.degToRad(d)); }
  cosDeg(d) { return Math.cos(this.degToRad(d)); }
  tanDeg(d) { return Math.tan(this.degToRad(d)); }
  asinDeg(x) { return this.radToDeg(Math.asin(x)); }
  acosDeg(x) { return this.radToDeg(Math.acos(x)); }
  atanDeg(x) { return this.radToDeg(Math.atan(x)); }
  atan2Deg(y, x) { return this.radToDeg(Math.atan2(y, x)); }

  fixAngle(a) {
    let b = a - 360.0 * Math.floor(a / 360.0);
    return b < 0 ? b + 360.0 : b;
  }

  fixHour(h) {
    let b = h - 24.0 * Math.floor(h / 24.0);
    return b < 0 ? b + 24.0 : b;
  }

  julianDate(year, month, day) {
    if (month <= 2) {
      year -= 1;
      month += 12;
    }
    const A = Math.floor(year / 100);
    const B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;
  }

  // Sun coordinates
  sunPosition(jd) {
    const D = jd - 2451545.0;
    const g = this.fixAngle(357.529 + 0.98560028 * D);
    const q = this.fixAngle(280.459 + 0.98564736 * D);
    const L = this.fixAngle(q + 1.915 * this.sinDeg(g) + 0.020 * this.sinDeg(2 * g));
    const e = 23.439 - 0.00000036 * D;
    const d = this.asinDeg(this.sinDeg(e) * this.sinDeg(L));
    let RA = this.atan2Deg(this.cosDeg(e) * this.sinDeg(L), this.cosDeg(L)) / 15.0;
    RA = this.fixHour(RA);
    const EqT = q / 15.0 - RA;
    return { declination: d, equationOfTime: EqT };
  }

  // Calculate prayer times for a specific Date
  getTimes(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    const jd = this.julianDate(year, month, day);
    const sun = this.sunPosition(jd);
    const dec = sun.declination;
    const eqt = sun.equationOfTime;

    // Midday (Dzuhur) in local time
    // Dhuhr = 12 + Timezone - Lng/15 - EqT
    const transit = 12 + this.timezone - (this.lng / 15.0) - eqt;
    const dhuhrTime = transit;

    // Hour angle helper for sun altitude 'alpha'
    // cos(H) = (sin(alpha) - sin(lat)*sin(dec)) / (cos(lat)*cos(dec))
    const hourAngle = (alpha) => {
      const top = this.sinDeg(alpha) - this.sinDeg(this.lat) * this.sinDeg(dec);
      const bottom = this.cosDeg(this.lat) * this.cosDeg(dec);
      const val = top / bottom;
      if (val > 1 || val < -1) return 0; // extreme latitude exception
      return this.acosDeg(val) / 15.0; // convert degrees to hours
    };

    // Sunrise & Sunset: alpha = -0.8333 - 0.0347 * sqrt(elevation)
    const sunsetAlpha = -0.8333 - 0.0347 * Math.sqrt(Math.max(0, this.elevation));
    const sunriseHA = hourAngle(sunsetAlpha);

    const sunriseTime = transit - sunriseHA;
    const sunsetTime = transit + sunriseHA;

    // Fajr (Subuh): alpha = -fajrAngle
    const fajrHA = hourAngle(-this.fajrAngle);
    const fajrTime = transit - fajrHA;

    // Isha (Isya): alpha = -ishaAngle
    const ishaHA = hourAngle(-this.ishaAngle);
    const ishaTime = transit + ishaHA;

    // Asr (Ashar): standard shadow ratio = 1 (Shafi'i, Maliki, Hanbali)
    // Sun altitude alpha: tan(alpha) = 1 / (1 + tan(|lat - dec|))
    const asrAltitude = this.atanDeg(1.0 / (1.0 + this.tanDeg(Math.abs(this.lat - dec))));
    const asrHA = hourAngle(asrAltitude);
    const asrTime = transit + asrHA;

    // Dhuha: alpha = dhuhaAngle
    const dhuhaHA = hourAngle(this.dhuhaAngle);
    const dhuhaTime = transit - dhuhaHA;

    // Helper to format float hour into { hh, mm, timeStr, totalMinutes }
    const formatTime = (floatHours, ihtiyatMinutes = 0) => {
      let totalMinutes = Math.round(floatHours * 60) + ihtiyatMinutes;
      let h = Math.floor(totalMinutes / 60) % 24;
      let m = totalMinutes % 60;
      if (m < 0) {
        m += 60;
        h = (h - 1 + 24) % 24;
      }
      const pad = (n) => String(n).padStart(2, '0');
      return {
        hour: h,
        minute: m,
        time: `${pad(h)}:${pad(m)}`,
        totalMinutes: h * 60 + m
      };
    };

    const subuhRes = formatTime(fajrTime, this.ihtiyat.subuh);
    // Imsak: 10 minutes before Subuh
    const imsakTotalMin = subuhRes.totalMinutes - 10 + this.ihtiyat.imsak;
    const imsakH = Math.floor(imsakTotalMin / 60) % 24;
    const imsakM = ((imsakTotalMin % 60) + 60) % 60;
    const pad = (n) => String(n).padStart(2, '0');
    const imsakRes = {
      hour: imsakH,
      minute: imsakM,
      time: `${pad(imsakH)}:${pad(imsakM)}`,
      totalMinutes: imsakH * 60 + imsakM
    };

    const terbitRes = formatTime(sunriseTime, this.ihtiyat.terbit);
    const dhuhaRes = formatTime(dhuhaTime, this.ihtiyat.dhuha);
    const dzuhurRes = formatTime(dhuhrTime, this.ihtiyat.dzuhur);
    const asharRes = formatTime(asrTime, this.ihtiyat.ashar);
    const maghribRes = formatTime(sunsetTime, this.ihtiyat.maghrib);
    const isyaRes = formatTime(ishaTime, this.ihtiyat.isya);

    return {
      imsak: imsakRes.time,
      subuh: subuhRes.time,
      terbit: terbitRes.time,
      dhuha: dhuhaRes.time,
      dzuhur: dzuhurRes.time,
      ashar: asharRes.time,
      maghrib: maghribRes.time,
      isya: isyaRes.time,
      details: {
        imsak: imsakRes,
        subuh: subuhRes,
        terbit: terbitRes,
        dhuha: dhuhaRes,
        dzuhur: dzuhurRes,
        ashar: asharRes,
        maghrib: maghribRes,
        isya: isyaRes
      }
    };
  }

  // Hijri calendar conversion with offset adjustment
  getHijriDate(date = new Date(), offsetDays = 0) {
    const targetDate = new Date(date.getTime() + offsetDays * 86400000);
    const day = targetDate.getDate();
    const month = targetDate.getMonth();
    const year = targetDate.getFullYear();

    const m = month + 1;
    let y = year;
    if (m < 3) {
      y -= 1;
      m += 12;
    }

    let a = Math.floor(y / 100);
    let b = 2 - a + Math.floor(a / 4);
    if (y < 1583) b = 0;
    if (y === 1582) {
      if (m > 10) b = -10;
      if (m === 10) {
        b = 0;
        if (day > 4) b = -10;
      }
    }

    let jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;
    b = 0;
    if (jd > 2299160) {
      a = Math.floor((jd - 1867216.25) / 36524.25);
      b = 1 + a - Math.floor(a / 4);
    }
    let bb = jd + b + 1524;
    let cc = Math.floor((bb - 122.1) / 365.25);
    let dd = Math.floor(365.25 * cc);
    let ee = Math.floor((bb - dd) / 30.6001);
    day;

    let z = jd - 1948440 + 10632;
    let n = Math.floor((z - 1) / 10631);
    z = z - 10631 * n + 354;
    let j = (Math.floor((10985 - z) / 5316)) * (Math.floor((50 * z) / 17719)) + (Math.floor(z / 5670)) * (Math.floor((43 * z) / 15238));
    z = z - (Math.floor((30 - j) / 15)) * (Math.floor((17719 * j) / 50)) - (Math.floor(j / 16)) * (Math.floor((15238 * j) / 43)) + 29;
    let hijriMonth = Math.floor((24 * z) / 709);
    let hijriDay = z - Math.floor((709 * hijriMonth) / 24);
    let hijriYear = 30 * n + j - 30;

    const hijriMonths = [
      "Muharram", "Safar", "Rabi'ul Awwal", "Rabi'ul Akhir",
      "Jumadil Awwal", "Jumadil Akhir", "Rajab", "Sya'ban",
      "Ramadhan", "Syawwal", "Dzulqa'dah", "Dzulhijjah"
    ];

    const monthIndex = Math.max(0, Math.min(11, hijriMonth - 1));

    return {
      day: hijriDay,
      month: hijriMonth,
      monthName: hijriMonths[monthIndex],
      year: hijriYear,
      formatted: `${hijriDay} ${hijriMonths[monthIndex]} ${hijriYear} H`
    };
  }
}

// Preset Kota Populer di Indonesia
const INDONESIA_CITIES = [
  { name: "Banda Aceh", lat: 5.5483, lng: 95.3238, timezone: 7 },
  { name: "Medan", lat: 3.5952, lng: 98.6722, timezone: 7 },
  { name: "Padang", lat: -0.9471, lng: 100.4172, timezone: 7 },
  { name: "Pekanbaru", lat: 0.5071, lng: 101.4478, timezone: 7 },
  { name: "Palembang", lat: -2.9761, lng: 104.7754, timezone: 7 },
  { name: "Bandar Lampung", lat: -5.4500, lng: 105.2667, timezone: 7 },
  { name: "DKI Jakarta", lat: -6.2088, lng: 106.8456, timezone: 7 },
  { name: "Bogor", lat: -6.5971, lng: 106.8060, timezone: 7 },
  { name: "Depok", lat: -6.4025, lng: 106.7942, timezone: 7 },
  { name: "Tangerang", lat: -6.1783, lng: 106.6319, timezone: 7 },
  { name: "Bekasi", lat: -6.2383, lng: 106.9756, timezone: 7 },
  { name: "Bandung", lat: -6.9175, lng: 107.6191, timezone: 7 },
  { name: "Cirebon", lat: -6.7320, lng: 108.5523, timezone: 7 },
  { name: "Semarang", lat: -6.9667, lng: 110.4167, timezone: 7 },
  { name: "Surakarta / Solo", lat: -7.5755, lng: 110.8243, timezone: 7 },
  { name: "Yogyakarta", lat: -7.7956, lng: 110.3695, timezone: 7 },
  { name: "Surabaya", lat: -7.2575, lng: 112.7521, timezone: 7 },
  { name: "Malang", lat: -7.9666, lng: 112.6326, timezone: 7 },
  { name: "Denpasar (Bali)", lat: -8.6705, lng: 115.2126, timezone: 8 },
  { name: "Mataram (Lombok)", lat: -8.5833, lng: 116.1167, timezone: 8 },
  { name: "Pontianak", lat: -0.0263, lng: 109.3425, timezone: 7 },
  { name: "Banjarmasin", lat: -3.3194, lng: 114.5908, timezone: 8 },
  { name: "Balikpapan", lat: -1.2379, lng: 116.8529, timezone: 8 },
  { name: "Samarinda", lat: -0.5022, lng: 117.1536, timezone: 8 },
  { name: "Makassar", lat: -5.1477, lng: 119.4327, timezone: 8 },
  { name: "Manado", lat: 1.4748, lng: 124.8421, timezone: 8 },
  { name: "Ambon", lat: -3.6554, lng: 128.1906, timezone: 9 },
  { name: "Jayapura", lat: -2.5489, lng: 140.7181, timezone: 9 }
];

module.exports = { PrayerTimes, INDONESIA_CITIES };
