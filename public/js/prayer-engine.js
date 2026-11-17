/**
 * Client-Side Prayer Engine (Standar Kemenag RI) for Offline TV Resilience
 */
class ClientPrayerEngine {
  constructor(options = {}) {
    this.lat = options.lat || -6.2088;
    this.lng = options.lng || 106.8456;
    this.timezone = options.timezone !== undefined ? options.timezone : 7;
    this.elevation = options.elevation || 10;
    this.fajrAngle = options.fajrAngle || 20.0;
    this.ishaAngle = options.ishaAngle || 18.0;
    this.dhuhaAngle = options.dhuhaAngle || 4.5;
    this.ihtiyat = options.ihtiyat || {
      imsak: 0, subuh: 2, terbit: -2, dhuha: 0, dzuhur: 2, ashar: 2, maghrib: 2, isya: 2
    };
  }

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

  getTimes(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    const jd = this.julianDate(year, month, day);
    const sun = this.sunPosition(jd);
    const dec = sun.declination;
    const eqt = sun.equationOfTime;

    const transit = 12 + this.timezone - (this.lng / 15.0) - eqt;
    const hourAngle = (alpha) => {
      const top = this.sinDeg(alpha) - this.sinDeg(this.lat) * this.sinDeg(dec);
      const bottom = this.cosDeg(this.lat) * this.cosDeg(dec);
      const val = top / bottom;
      if (val > 1 || val < -1) return 0;
      return this.acosDeg(val) / 15.0;
    };

    const sunsetAlpha = -0.8333 - 0.0347 * Math.sqrt(Math.max(0, this.elevation));
    const sunriseHA = hourAngle(sunsetAlpha);
    const sunriseTime = transit - sunriseHA;
    const sunsetTime = transit + sunriseHA;

    const fajrHA = hourAngle(-this.fajrAngle);
    const fajrTime = transit - fajrHA;

    const ishaHA = hourAngle(-this.ishaAngle);
    const ishaTime = transit + ishaHA;

    const asrAltitude = this.atanDeg(1.0 / (1.0 + this.tanDeg(Math.abs(this.lat - dec))));
    const asrHA = hourAngle(asrAltitude);
    const asrTime = transit + asrHA;

    const dhuhaHA = hourAngle(this.dhuhaAngle);
    const dhuhaTime = transit - dhuhaHA;

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

    const subuhRes = formatTime(fajrTime, this.ihtiyat.subuh || 0);
    const imsakTotalMin = subuhRes.totalMinutes - 10 + (this.ihtiyat.imsak || 0);
    const imsakH = Math.floor(imsakTotalMin / 60) % 24;
    const imsakM = ((imsakTotalMin % 60) + 60) % 60;
    const pad = (n) => String(n).padStart(2, '0');
    const imsakRes = {
      hour: imsakH,
      minute: imsakM,
      time: `${pad(imsakH)}:${pad(imsakM)}`,
      totalMinutes: imsakH * 60 + imsakM
    };

    return {
      imsak: imsakRes.time,
      subuh: subuhRes.time,
      terbit: formatTime(sunriseTime, this.ihtiyat.terbit || 0).time,
      dhuha: formatTime(dhuhaTime, this.ihtiyat.dhuha || 0).time,
      dzuhur: formatTime(transit, this.ihtiyat.dzuhur || 0).time,
      ashar: formatTime(asrTime, this.ihtiyat.ashar || 0).time,
      maghrib: formatTime(sunsetTime, this.ihtiyat.maghrib || 0).time,
      isya: formatTime(ishaTime, this.ihtiyat.isya || 0).time,
      details: {
        imsak: imsakRes,
        subuh: subuhRes,
        terbit: formatTime(sunriseTime, this.ihtiyat.terbit || 0),
        dhuha: formatTime(dhuhaTime, this.ihtiyat.dhuha || 0),
        dzuhur: formatTime(transit, this.ihtiyat.dzuhur || 0),
        ashar: formatTime(asrTime, this.ihtiyat.ashar || 0),
        maghrib: formatTime(sunsetTime, this.ihtiyat.maghrib || 0),
        isya: formatTime(ishaTime, this.ihtiyat.isya || 0)
      }
    };
  }
}
window.ClientPrayerEngine = ClientPrayerEngine;
