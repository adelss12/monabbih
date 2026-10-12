// أدوات التاريخ المشتركة بين التطبيق (المتصفح) وسكربت التنبيهات (Node)
// التقويم الهجري يعتمد تقويم أم القرى المدمج في المتصفح / Node

export const DAY = 864e5;

export const GREG_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const HIJRI_MONTHS = ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];

export const TYPES = [
  { v: 'sub', t: 'اشتراك' },
  { v: 'passport', t: 'جواز سفر' },
  { v: 'license', t: 'رخصة قيادة' },
  { v: 'id', t: 'هوية / إقامة' },
  { v: 'vehicle', t: 'استمارة مركبة' },
  { v: 'other', t: 'أخرى' }
];
export const typeLabel = (v) => (TYPES.find((x) => x.v === v) || TYPES[5]).t;

export const CYCLE_LABELS = { monthly: 'تجديد شهري', yearly: 'تجديد سنوي', none: 'بدون تجديد تلقائي' };

let hijriFmt;
function getHijriFmt() {
  if (hijriFmt) return hijriFmt;
  const opts = { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' };
  try {
    hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', opts);
  } catch (e) {
    hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-nu-latn', opts);
  }
  return hijriFmt;
}

/** تاريخ اليوم كـ ms (منتصف الليل UTC). إن مُرّرت منطقة زمنية تُحسب بها، وإلا بتوقيت الجهاز */
export function todayMs(timeZone) {
  if (timeZone) {
    const p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date())
      .forEach((x) => { if (x.type !== 'literal') p[x.type] = parseInt(x.value, 10); });
    return Date.UTC(p.year, p.month - 1, p.day);
  }
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
}

/** يحوّل تاريخاً ميلادياً (ms) إلى أجزاء هجرية {d, m, y} */
export function hijriParts(ms) {
  const r = {};
  getHijriFmt().formatToParts(new Date(ms)).forEach((p) => {
    if (p.type === 'day') r.d = parseInt(p.value, 10);
    if (p.type === 'month') r.m = parseInt(p.value, 10);
    if (p.type === 'year') r.y = parseInt(p.value, 10);
  });
  return r;
}

/** يحوّل تاريخاً هجرياً إلى ms، أو null إن كان التاريخ غير موجود */
export function hijriToMs(y, m, d) {
  const est = Date.UTC(622, 6, 19) + Math.round((y - 1) * 354.36667 + (m - 1) * 29.5306 + (d - 1)) * DAY;
  for (let k = -50; k <= 50; k++) {
    const ms = est + k * DAY;
    const h = hijriParts(ms);
    if (h.y === y && h.m === m && h.d === d) return ms;
  }
  return null;
}

export function gregToMs(y, m, d) {
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return ms;
}

/** 12/ أكتوبر (10)/2026 */
export function fmtG(ms) {
  const dt = new Date(ms);
  const m = dt.getUTCMonth() + 1;
  return `${dt.getUTCDate()}/ ${GREG_MONTHS[m - 1]} (${m})/${dt.getUTCFullYear()}`;
}

/** 1/ جمادى الأولى (5)/1448هـ */
export function fmtH(ms) {
  const h = hijriParts(ms);
  return `${h.d}/ ${HIJRI_MONTHS[h.m - 1]} (${h.m})/${h.y}هـ`;
}

export function isoToMs(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map((x) => parseInt(x, 10));
  return Date.UTC(y, m - 1, d);
}

export function msToIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** gen=true للمجرور: «منذ يومين»، «بعد يومين» */
export function dayWord(n, gen) {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return gen ? 'يومين' : 'يومان';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

/** يضيف دورة تجديد (شهر أو سنة) بالتقويم الذي أُدخل به التاريخ */
export function addCycle(ms, cycle, cal) {
  const n = cycle === 'monthly' ? 1 : 12;
  if (cal === 'h') {
    const h = hijriParts(ms);
    let m = h.m + n;
    let y = h.y;
    while (m > 12) { m -= 12; y += 1; }
    for (let d = h.d; d >= 28; d--) {
      const r = hijriToMs(y, m, d);
      if (r !== null) return r;
    }
    return ms + n * 30 * DAY;
  }
  const dt = new Date(ms);
  let y = dt.getUTCFullYear();
  let m = dt.getUTCMonth() + n;
  y += Math.floor(m / 12);
  m %= 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(dt.getUTCDate(), last));
}

/** الأيام المتبقية والحالة */
export function statusOf(expMs, leadDays, today) {
  const r = Math.round((expMs - today) / DAY);
  const st = r < 0 ? 'expired' : (r <= leadDays ? 'soon' : 'ok');
  return { r, st };
}

export function remainText(r) {
  if (r < 0) return `منتهٍ منذ ${dayWord(-r, true)}`;
  if (r === 0) return 'ينتهي اليوم';
  return `متبقٍ ${dayWord(r)}`;
}
