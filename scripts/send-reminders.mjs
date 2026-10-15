// يُشغَّل يوميًا عبر GitHub Actions: يفحص تواريخ الانتهاء ويرسل تنبيهًا بالبريد لكل مستخدم
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import {
  todayMs, isoToMs, statusOf, fmtG, fmtH, typeLabel, remainText
} from '../js/dates.js';

const env = (k) => (process.env[k] || '').trim();
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const GMAIL_USER = env('GMAIL_USER');
const GMAIL_APP_PASSWORD = env('GMAIL_APP_PASSWORD').replace(/[^a-zA-Z]/g, ''); // كلمة مرور التطبيقات حروف فقط؛ نحذف المسافات والشرطات وعلامات التنصيص
const TEST_MODE = env('TEST_MODE');
const TIME_ZONE = env('TIME_ZONE') || 'Asia/Riyadh';
const APP_URL = env('APP_URL');
const RESEND_API_KEY = env('RESEND_API_KEY');
const MAIL_FROM = env('MAIL_FROM') || 'منبّه <onboarding@resend.dev>';
const useResend = !!RESEND_API_KEY;

/** يُظهر الخطأ بوضوح في صفحة Actions (Annotations) ثم يوقف التشغيل */
function fail(title, detail) {
  const clean = (x) => String(x || '').replace(/[\r\n]+/g, ' ');
  console.log(`::error title=${clean(title)}::${clean(detail)}`);
  process.exit(1);
}

const required = useResend
  ? { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY }
  : { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
for (const [k, v] of Object.entries(required)) {
  if (!v) fail('سر ناقص', `ينقص ${k} في Settings > Secrets and variables > Actions (تأكد من كتابة الاسم حرفيًا)`);
}
if (!useResend && !(GMAIL_USER && GMAIL_APP_PASSWORD)) fail('لا توجد طريقة إرسال', 'أضف السر RESEND_API_KEY (الأسهل)، أو GMAIL_USER و GMAIL_APP_PASSWORD');
if (useResend && !RESEND_API_KEY.startsWith('re_')) fail('RESEND_API_KEY غير صحيح', 'مفتاح Resend يبدأ بـ re_');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) fail('SUPABASE_URL غير صحيح', 'يجب أن يكون بالشكل https://xxxx.supabase.co');
if (SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_publishable_')) fail('مفتاح خاطئ', 'وضعت المفتاح العام publishable في SUPABASE_SERVICE_ROLE_KEY؛ المطلوب المفتاح السري sb_secret_');
if (!useResend && GMAIL_APP_PASSWORD.length !== 16) fail('كلمة مرور Gmail', `كلمة مرور التطبيقات يجب أن تكون 16 حرفًا (الموجودة ${GMAIL_APP_PASSWORD.length}). لا تستخدم كلمة مرور حسابك العادية.`);

const test = String(TEST_MODE) === 'true';
const today = todayMs(TIME_ZONE);

/**
 * متى نرسل؟ في أيام محددة حتى لا يتكرر البريد يوميًا:
 * يوم بدء فترة التنبيه، ثم قبل 30 و14 و7 و3 أيام، ثم قبل يوم، ثم يوم الانتهاء، ثم اليوم التالي للانتهاء.
 * في وضع الاختبار يُرسل كل ما هو داخل فترة التنبيه أو منتهٍ.
 */
function shouldNotify(r, lead) {
  if (test) return r <= lead;
  if (r === -1) return true;
  if (r < 0 || r > lead) return false;
  return r === lead || [30, 14, 7, 3, 1, 0].includes(r);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: items, error } = await sb.from('items').select('*');
if (error) fail('تعذّر قراءة البيانات من Supabase', `${error.message} — تأكد أن SUPABASE_SERVICE_ROLE_KEY هو المفتاح السري sb_secret_ وأنك شغّلت schema.sql`);

const byUser = new Map();
for (const it of items) {
  const ms = isoToMs(it.expires_on);
  const { r, st } = statusOf(ms, it.lead_days, today);
  if (!shouldNotify(r, it.lead_days)) continue;
  if (!byUser.has(it.user_id)) byUser.set(it.user_id, []);
  byUser.get(it.user_id).push({ ...it, ms, r, st });
}

if (byUser.size === 0) {
  console.log('لا توجد تنبيهات اليوم.');
  process.exit(0);
}

const mailer = useResend ? null : nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });

async function sendViaResend(msg) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text })
  });
  if (res.ok) return;
  const body = await res.text();
  if (res.status === 401 || res.status === 403 && /api key/i.test(body)) fail('Resend رفض المفتاح', 'تأكد من نسخ RESEND_API_KEY كاملًا (يبدأ بـ re_)');
  if (res.status === 403) fail('Resend: بريد المستلم غير مسموح', 'بدون نطاق خاص يرسل Resend فقط إلى البريد الذي سجّلت به في Resend. سجّل في منبّه بنفس البريد. ' + body);
  fail('تعذّر الإرسال عبر Resend', `${res.status} ${body}`);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { expired: ['#FCE8E6', '#9F1D12', 'منتهٍ'], soon: ['#FDF0DC', '#8A4B00', 'قريب الانتهاء'], ok: ['#E3F2EA', '#0B5E3A', 'ساري'] };

let sent = 0;
for (const [userId, list] of byUser) {
  const { data: u, error: uErr } = await sb.auth.admin.getUserById(userId);
  const to = u && u.user && u.user.email;
  if (uErr || !to) { console.log(`::warning title=بريد المستخدم::${uErr ? uErr.message : 'لا يوجد بريد'}`); continue; }

  list.sort((a, b) => a.r - b.r);
  const subject = list.length === 1
    ? `منبّه: ${list[0].name} — ${remainText(list[0].r, list[0].ms, today)}`
    : `منبّه: ${list.length} عناصر تحتاج انتباهك`;

  const rows = list.map((x) => {
    const [bg, fg, label] = COLORS[x.st];
    return `<tr>
  <td style="padding:14px 12px;border-bottom:1px solid #E3DED3">
    <div style="font-weight:700;font-size:16px" dir="auto">${esc(x.name)}</div>
    <div style="color:#55606B;font-size:13px">${typeLabel(x.type)}</div>
  </td>
  <td style="padding:14px 12px;border-bottom:1px solid #E3DED3;font-size:14px">
    <div><span style="color:#55606B">ميلادي: </span><b>${fmtG(x.ms)}</b></div>
    <div><span style="color:#55606B">هجري: </span><b>${fmtH(x.ms)}</b></div>
  </td>
  <td style="padding:14px 12px;border-bottom:1px solid #E3DED3;font-size:14px">
    <span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:2px 10px;font-weight:700;font-size:13px">${label}</span>
    <div style="font-weight:600;margin-top:4px">${remainText(x.r, x.ms, today)}</div>
  </td>
</tr>`;
  }).join('');

  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#F4F1EA;font-family:Tahoma,Arial,sans-serif;color:#17212B">
<div style="max-width:640px;margin:0 auto;padding:24px 16px" dir="rtl">
  <h1 style="margin:0 0 4px;font-size:24px">منبّه</h1>
  <p style="margin:0 0 18px;color:#55606B">اليوم: ${fmtG(today)} — ${fmtH(today)}</p>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff;border:1px solid #E3DED3;border-radius:14px;border-collapse:separate;text-align:right">
    ${rows}
  </table>
  ${APP_URL ? `<p style="margin:20px 0 0"><a href="${esc(APP_URL)}" style="display:inline-block;background:#0E5A52;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">فتح منبّه</a></p>` : ''}
  <p style="margin:20px 0 0;color:#55606B;font-size:12px">وصلك هذا البريد لأنك أضفت هذه العناصر في منبّه مع تنبيه قبل الانتهاء.</p>
</div></body></html>`;

  const text = list.map((x) => `- ${x.name}: ${remainText(x.r, x.ms, today)} | ميلادي ${fmtG(x.ms)} | هجري ${fmtH(x.ms)}`).join('\n');

  if (useResend) {
    await sendViaResend({ to, subject, html, text });
    sent += 1;
    console.log(`أُرسل تنبيه (${list.length}) عبر Resend.`);
    continue;
  }
  try {
    await mailer.sendMail({ from: `منبّه <${GMAIL_USER}>`, to, subject, html, text });
  } catch (e) {
    if (e && (e.code === 'EAUTH' || /Username and Password not accepted|Application-specific password/i.test(e.message))) {
      fail('Gmail رفض الدخول', 'تأكد أن GMAIL_USER هو بريدك كاملًا وأن GMAIL_APP_PASSWORD هي كلمة مرور التطبيقات (16 حرفًا) من myaccount.google.com/apppasswords');
    }
    fail('تعذّر إرسال البريد', e && e.message);
  }
  sent += 1;
  console.log(`أُرسل تنبيه (${list.length} ${list.length > 10 ? 'عنصرًا' : 'عناصر'}) إلى مستخدم.`);
}
console.log(`تم. عدد الرسائل المرسلة: ${sent}`);
