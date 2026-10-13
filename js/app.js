import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  GREG_MONTHS, HIJRI_MONTHS, TYPES, typeLabel, CYCLE_LABELS,
  todayMs, hijriParts, hijriToMs, gregToMs, fmtG, fmtH,
  isoToMs, msToIso, dayWord, addCycle, statusOf, remainText
} from './dates.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { items: [], filter: 'all', q: '', cal: 'g', user: null, editingId: null };
let sb = null;

/* ---------- اليوم ---------- */
function paintToday() {
  const t = todayMs();
  $('today-g').textContent = fmtG(t);
  $('today-h').textContent = fmtH(t);
}

/* ---------- الشاشات ---------- */
function show(view) {
  $('setup').hidden = view !== 'setup';
  $('auth').hidden = view !== 'auth';
  $('app').hidden = view !== 'app';
  $('pwd').hidden = view !== 'pwd';
  $('logout').hidden = view !== 'app';
  $('change-pass').hidden = view !== 'app';
}

/* ---------- كلمة المرور ---------- */
const appUrl = () => location.origin + location.pathname;

async function forgotPassword() {
  const email = $('a-email').value.trim();
  if (!email) { $('a-email').focus(); return authMsg('اكتب بريدك الإلكتروني أولًا ثم اضغط «نسيت كلمة المرور؟».', true); }
  authMsg('جارٍ الإرسال…');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) return authMsg(translateAuthError(error), true);
  authMsg('أرسلنا رابط تعيين كلمة مرور جديدة إلى بريدك. افتحه من هذا الجهاز.');
}

function pwdMsg(text, isError) {
  const el = $('pwd-msg');
  el.textContent = text;
  el.className = 'msg' + (isError ? ' error' : '');
  el.hidden = !text;
}

function openPasswordForm() {
  $('p-new').value = '';
  $('p-confirm').value = '';
  pwdMsg('');
  show('pwd');
  $('p-new').focus();
}

async function savePassword(ev) {
  ev.preventDefault();
  const p1 = $('p-new').value;
  const p2 = $('p-confirm').value;
  if (p1.length < 6) return pwdMsg('كلمة المرور يجب أن تكون 6 أحرف على الأقل.', true);
  if (p1 !== p2) return pwdMsg('كلمتا المرور غير متطابقتين.', true);
  pwdMsg('جارٍ الحفظ…');
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) {
    if (/different from the old/i.test(error.message)) return pwdMsg('اختر كلمة مرور مختلفة عن السابقة.', true);
    return pwdMsg(translateAuthError(error), true);
  }
  state.recovery = false;
  if (location.hash) history.replaceState(null, '', appUrl());
  pwdMsg('');
  show('app');
  showToast('تم حفظ كلمة المرور الجديدة.');
}

function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ---------- تسجيل الدخول ---------- */
function authMsg(text, isError) {
  const el = $('auth-msg');
  el.textContent = text;
  el.className = 'msg' + (isError ? ' error' : '');
  el.hidden = !text;
}

function translateAuthError(e) {
  const m = (e && e.message) || '';
  if (/Invalid login credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة.';
  if (/Email not confirmed/i.test(m)) return 'لم يتم تأكيد البريد بعد. افتح رسالة التأكيد في بريدك.';
  if (/already registered/i.test(m)) return 'هذا البريد مسجّل مسبقًا، استخدم «دخول».';
  if (/Password should be/i.test(m)) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
  if (/rate limit/i.test(m)) return 'محاولات كثيرة، انتظر قليلًا ثم حاول مجددًا.';
  return 'حدث خطأ: ' + m;
}

async function signIn(ev) {
  ev.preventDefault();
  const email = $('a-email').value.trim();
  const password = $('a-pass').value;
  if (!email || !password) return authMsg('أدخل البريد وكلمة المرور.', true);
  authMsg('جارٍ الدخول…');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) authMsg(translateAuthError(error), true);
}

async function signUp() {
  const email = $('a-email').value.trim();
  const password = $('a-pass').value;
  if (!email || password.length < 6) return authMsg('أدخل بريدًا صحيحًا وكلمة مرور من 6 أحرف على الأقل.', true);
  authMsg('جارٍ إنشاء الحساب…');
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  if (error) return authMsg(translateAuthError(error), true);
  if (!data.session) authMsg('تم إنشاء الحساب. افتح رسالة التأكيد التي وصلتك على بريدك ثم عد وسجّل الدخول.');
}

/* ---------- البيانات ---------- */
async function loadItems() {
  $('loading').hidden = false;
  const { data, error } = await sb.from('items').select('*').order('expires_on', { ascending: true });
  $('loading').hidden = true;
  if (error) {
    $('loading').hidden = false;
    $('loading').textContent = 'تعذّر تحميل البيانات: ' + error.message;
    return;
  }
  state.items = data || [];
  render();
}

async function addItem(ev) {
  ev.preventDefault();
  const name = $('f-name').value.trim();
  if (!name) return formError('اكتب اسم الاشتراك أو الوثيقة.');
  const r = formDate();
  if (r.ms === null) return formError(r.incomplete ? 'أكمل تاريخ الانتهاء (اليوم والشهر والسنة).' : 'تاريخ الانتهاء غير صحيح، راجع اليوم والشهر والسنة.');
  formError('');
  $('add-btn').disabled = true;
  const row = {
    name,
    type: $('f-type').value,
    cycle: $('f-cycle').value,
    lead_days: parseInt($('f-lead').value, 10) || 7,
    cal: state.cal,
    expires_on: msToIso(r.ms),
    notes: $('f-notes').value.trim() || null,
    price: parsePrice($('f-price').value)
  };
  if (Number.isNaN(row.price)) { $('add-btn').disabled = false; return formError('القيمة غير صحيحة. اكتب رقمًا فقط، مثل 45 أو 19.99'); }
  const editingId = state.editingId;
  const q = editingId
    ? sb.from('items').update(row).eq('id', editingId).select().single()
    : sb.from('items').insert(row).select().single();
  const { data, error } = await q;
  $('add-btn').disabled = false;
  if (error) {
    if (/notes/i.test(error.message)) return formError('حقل الملاحظات غير مفعّل في قاعدة البيانات بعد. شغّل أمر SQL الخاص بالملاحظات في Supabase ثم أعد المحاولة.');
    if (/price/i.test(error.message)) return formError('حقل القيمة غير مفعّل في قاعدة البيانات بعد. شغّل أمر SQL الخاص بالقيمة في Supabase ثم أعد المحاولة.');
    return formError('تعذّر الحفظ: ' + error.message);
  }
  if (editingId) {
    state.items = state.items.map((x) => (x.id === editingId ? data : x));
    stopEditing();
    showToast(`تم حفظ التعديل على «${data.name}».`);
  } else {
    state.items.push(data);
    clearForm();
  }
  render();
}

function clearForm() {
  $('f-name').value = '';
  $('f-notes').value = '';
  $('f-price').value = '';
  ['f-d', 'f-m', 'f-y'].forEach((id) => { $(id).value = ''; });
  formError('');
  updatePreview();
}

/* ---------- نافذة التنبيه الخاصة بالتطبيق (بدل نوافذ المتصفح) ---------- */
function appDialog(message, { title = '', ok = 'حسنًا', cancel = null, tone = '' } = {}) {
  return new Promise((resolve) => {
    const dlg = $('app-dialog');
    $('dlg-title').textContent = title;
    $('dlg-title').hidden = !title;
    $('dlg-msg').textContent = message;
    const okBtn = $('dlg-ok');
    const cancelBtn = $('dlg-cancel');
    okBtn.textContent = ok;
    okBtn.className = tone === 'danger' && cancel ? 'btn-danger' : 'btn-primary';
    cancelBtn.hidden = !cancel;
    if (cancel) cancelBtn.textContent = cancel;
    dlg.classList.toggle('danger', tone === 'danger');
    const prevFocus = document.activeElement;
    const done = (v) => {
      okBtn.onclick = cancelBtn.onclick = dlg.oncancel = dlg.onclick = null;
      dlg.close();
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      resolve(v);
    };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); }; // زر Esc
    dlg.onclick = (e) => { if (e.target === dlg) done(false); }; // الضغط خارج النافذة
    dlg.showModal();
    (cancel ? cancelBtn : okBtn).focus();
  });
}
const appAlert = (message, opts = {}) => appDialog(message, { ...opts, cancel: null });
const appConfirm = (message, opts = {}) => appDialog(message, { cancel: 'إلغاء', ...opts });

/* ---------- النسخة الاحتياطية ---------- */
const BACKUP_FIELDS = ['name', 'type', 'cycle', 'lead_days', 'cal', 'expires_on', 'notes', 'price'];

/* ---------- القيمة ---------- */
/** يقبل الأرقام العربية والإنجليزية؛ يُرجع null إن كان فارغًا، و NaN إن كان غير صالح */
function parsePrice(v) {
  let t = String(v || '').trim()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٫,]/g, '.')
    .replace(/\s|ريال|ر\.س|sar/gi, '');
  if (!t) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100) / 100;
}

const money = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ريال`;
const CYCLE_PER = { monthly: 'شهريًا', yearly: 'سنويًا', none: '' };

function updatePriceLabel() {
  const c = $('f-cycle').value;
  const what = c === 'monthly' ? 'قيمة الاشتراك الشهري' : c === 'yearly' ? 'قيمة الاشتراك السنوي' : 'رسوم التجديد';
  $('f-price-label').innerHTML = `${what} <span class="muted small">(ريال، اختياري)</span>`;
}

function exportBackup() {
  const items = [...state.items]
    .sort((a, b) => String(a.expires_on).localeCompare(String(b.expires_on)))
    .map((x) => {
      const ms = isoToMs(x.expires_on);
      const o = {};
      BACKUP_FIELDS.forEach((k) => { o[k] = x[k] ?? null; });
      // للقراءة فقط — لا تُستخدم عند الاستيراد
      o.expires_gregorian = fmtG(ms);
      o.expires_hijri = fmtH(ms);
      o.type_label = typeLabel(x.type);
      o.created_at = x.created_at || null;
      return o;
    });
  const data = {
    app: 'monabbih',
    version: 1,
    exported_at: new Date().toISOString(),
    exported_at_local: new Date().toLocaleString('en-GB', { hour12: false }),
    account: state.user ? state.user.email : null,
    count: items.length,
    items
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // اسم الملف بالتاريخ والوقت المحلي حتى لا تتكرر الأسماء عند أكثر من نسخة في اليوم
  const n = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}_${pad(n.getHours())}-${pad(n.getMinutes())}-${pad(n.getSeconds())}`;
  a.download = `monabbih-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast(`تم تصدير ${items.length} عنصر.`);
}

function cleanImported(x) {
  if (!x || typeof x !== 'object') return null;
  const name = String(x.name || '').trim().slice(0, 120);
  const iso = String(x.expires_on || '').slice(0, 10);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const types = TYPES.map((t) => t.v);
  const lead = parseInt(x.lead_days, 10);
  const notes = x.notes ? String(x.notes).slice(0, 500) : null;
  const price = x.price == null || x.price === '' ? null : parsePrice(x.price);
  return {
    name,
    type: types.includes(x.type) ? x.type : 'other',
    cycle: ['monthly', 'yearly', 'none'].includes(x.cycle) ? x.cycle : 'none',
    lead_days: Number.isFinite(lead) && lead >= 0 && lead <= 365 ? lead : 7,
    cal: x.cal === 'h' ? 'h' : 'g',
    expires_on: iso,
    notes,
    price: Number.isNaN(price) ? null : price
  };
}

async function importBackup(file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    return appAlert('الملف غير صالح. اختر ملف النسخة الاحتياطية بصيغة JSON.', { title: 'تعذّر الاستيراد', tone: 'danger' });
  }
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.items;
  if (!Array.isArray(list)) return appAlert('لم أجد بيانات في هذا الملف.', { title: 'تعذّر الاستيراد', tone: 'danger' });
  const rows = list.map(cleanImported).filter(Boolean);
  const key = (x) => `${x.name.toLowerCase()}|${x.expires_on}`;
  const existing = new Set(state.items.map(key));
  const fresh = rows.filter((x) => !existing.has(key(x)));
  const skipped = rows.length - fresh.length;
  if (!fresh.length) return appAlert(`كل العناصر في الملف (${rows.length}) موجودة مسبقًا، فلا يوجد ما يُضاف.`, { title: 'لا جديد في الملف' });
  const msg = `سيُضاف ${fresh.length} عنصر من الملف.` + (skipped ? `\nوسيُتجاهل ${skipped} لأنها موجودة مسبقًا.` : '');
  if (!(await appConfirm(msg, { title: 'استيراد النسخة الاحتياطية', ok: 'استيراد' }))) return;
  const { data, error } = await sb.from('items').insert(fresh).select();
  if (error) return appAlert(error.message, { title: 'تعذّر الاستيراد', tone: 'danger' });
  state.items = state.items.concat(data || []);
  render();
  showToast(`تم استيراد ${(data || []).length} عنصر.`);
}

/* ---------- التعديل ---------- */
function startEditing(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  state.editingId = id;
  // التاريخ يُعرض بالتقويم الذي أُدخل به
  state.cal = it.cal === 'h' ? 'h' : 'g';
  ['f-d', 'f-m', 'f-y'].forEach((id) => { $(id).value = ''; });
  fillDateSelects();
  setDateFromMs(isoToMs(it.expires_on));
  $('f-name').value = it.name;
  $('f-notes').value = it.notes || '';
  $('f-price').value = it.price != null ? String(+it.price) : '';
  $('f-type').value = it.type;
  $('f-cycle').value = it.cycle;
  updatePriceLabel();
  const lead = String(it.lead_days);
  if (![...$('f-lead').options].some((o) => o.value === lead)) {
    $('f-lead').insertAdjacentHTML('beforeend', `<option value="${lead}">${dayWord(it.lead_days)}</option>`);
  }
  $('f-lead').value = lead;
  formError('');
  updatePreview();
  $('form-title').textContent = 'تعديل: ' + it.name;
  $('add-btn').textContent = 'حفظ التعديل';
  $('edit-cancel').hidden = false;
  $('form-card').classList.add('editing');
  render();
  $('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('f-name').focus({ preventScroll: true });
}

function stopEditing() {
  state.editingId = null;
  $('form-title').textContent = 'إضافة اشتراك أو وثيقة';
  $('add-btn').textContent = 'إضافة';
  $('edit-cancel').hidden = true;
  $('form-card').classList.remove('editing');
  clearForm();
  render();
}

async function renewItem(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const t = todayMs();
  const exp = isoToMs(it.expires_on);
  const next = msToIso(addCycle(exp < t ? t : exp, it.cycle, it.cal));
  const { error } = await sb.from('items').update({ expires_on: next }).eq('id', id);
  if (error) return appAlert(error.message, { title: 'تعذّر التجديد', tone: 'danger' });
  it.expires_on = next;
  render();
}

async function removeItem(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const ok = await appConfirm(`سيُحذف «${it.name}» نهائيًا، ولا يمكن التراجع عن ذلك.`, { title: 'حذف العنصر؟', ok: 'حذف', tone: 'danger' });
  if (!ok) return;
  const { error } = await sb.from('items').delete().eq('id', id);
  if (error) return appAlert(error.message, { title: 'تعذّر الحذف', tone: 'danger' });
  state.items = state.items.filter((x) => x.id !== id);
  if (state.editingId === id) stopEditing();
  render();
}

/* ---------- العرض ---------- */
const BADGE = { expired: 'منتهٍ', soon: 'قريب الانتهاء', ok: 'ساري' };

function render() {
  const t = todayMs();
  const all = state.items.map((x) => ({ ...x, ms: isoToMs(x.expires_on), ...statusOf(isoToMs(x.expires_on), x.lead_days, t) }))
    .sort((a, b) => a.r - b.r);

  $('c-exp').textContent = all.filter((x) => x.st === 'expired').length;
  $('c-soon').textContent = all.filter((x) => x.st === 'soon').length;
  $('c-ok').textContent = all.filter((x) => x.st === 'ok').length;
  $('c-all').textContent = all.length;

  // إجمالي تكلفة الاشتراكات المتجددة (الشهري + السنوي/12)
  const priced = all.filter((x) => x.price != null && x.cycle !== 'none');
  const perMonth = priced.reduce((sum, x) => sum + (x.cycle === 'monthly' ? +x.price : +x.price / 12), 0);
  $('totals').hidden = priced.length === 0;
  if (priced.length) {
    $('t-month').textContent = `${money(Math.round(perMonth * 100) / 100)} شهريًا`;
    $('t-year').textContent = `${money(Math.round(perMonth * 12 * 100) / 100)} سنويًا`;
    const missing = all.filter((x) => x.price == null && x.cycle !== 'none').length;
    $('t-note').textContent = missing ? `(${missing} بدون قيمة)` : '';
  }

  const alerting = all.filter((x) => x.st !== 'ok');
  $('alert').hidden = alerting.length === 0;
  if (alerting.length) {
    $('alert-title').textContent = alerting.length === 1 ? 'عنصر واحد يحتاج انتباهك:'
      : alerting.length === 2 ? 'عنصران يحتاجان انتباهك:' : `${alerting.length} عناصر تحتاج انتباهك:`;
    $('alert-names').textContent = alerting.map((x) => x.name + (x.r < 0 ? ' (منتهٍ)' : x.r === 0 ? ' (اليوم)' : ` (بعد ${dayWord(x.r, true)})`)).join('، ');
  }

  const q = state.q.trim().toLowerCase();
  const shown = all.filter((x) => {
    if (state.filter === 'subs' && x.type !== 'sub') return false;
    if (state.filter === 'docs' && x.type === 'sub') return false;
    if (state.filter === 'attention' && x.st === 'ok') return false;
    if (q && !x.name.toLowerCase().includes(q) && !typeLabel(x.type).includes(q) && !(x.notes || '').toLowerCase().includes(q)) return false;
    return true;
  });

  $('empty').hidden = shown.length > 0 || !$('loading').hidden;
  $('empty').textContent = all.length === 0 ? 'لا توجد عناصر بعد. أضف أول اشتراك أو وثيقة من النموذج.' : 'لا توجد عناصر مطابقة';

  $('list').innerHTML = shown.map((x) => {
    const initial = esc((x.name.trim().charAt(0) || '؟').toUpperCase());
    const name = esc(x.name);
    return `
<article class="item${x.id === state.editingId ? ' is-editing' : ''}">
  <div class="mono${x.type === 'sub' ? ' sub' : ''}" aria-hidden="true">${initial}</div>
  <div class="info">
    <h3 dir="auto">${name}</h3>
    <span class="muted">${typeLabel(x.type)} · ${CYCLE_LABELS[x.cycle] || ''} · تنبيه قبل ${dayWord(x.lead_days, true)}</span>
    ${x.price != null ? `<span class="price">${money(x.price)}${CYCLE_PER[x.cycle] ? ' ' + CYCLE_PER[x.cycle] : ''}</span>` : ''}
    ${x.notes ? `<p class="note" dir="auto">${esc(x.notes)}</p>` : ''}
  </div>
  <div class="dates">
    <div><span class="lbl">ميلادي</span><span class="v${x.cal === 'g' ? ' primary' : ''}">${fmtG(x.ms)}</span></div>
    <div><span class="lbl">هجري</span><span class="v${x.cal === 'h' ? ' primary' : ''}">${fmtH(x.ms)}</span></div>
  </div>
  <div class="state">
    <span class="badge ${x.st}">${BADGE[x.st]}</span>
    <span class="remain">${remainText(x.r)}</span>
  </div>
  <div class="actions">
    ${x.cycle !== 'none' ? `<button type="button" class="renew" data-renew="${x.id}" aria-label="تجديد ${name}">تجديد</button>` : ''}
    <button type="button" class="edit" data-edit="${x.id}" aria-label="تعديل ${name}">تعديل</button>
    <button type="button" class="del" data-del="${x.id}" aria-label="حذف ${name}">حذف</button>
  </div>
</article>`;
  }).join('');
}

/* ---------- النموذج والتاريخ ---------- */
/** يملأ قوائم اليوم والشهر والسنة حسب التقويم المختار، مع الإبقاء على الاختيار الحالي */
function fillDateSelects() {
  const isH = state.cal === 'h';
  const keep = { d: $('f-d').value, m: $('f-m').value, y: $('f-y').value };
  const opt = (v, t) => `<option value="${v}">${t}</option>`;
  const blank = opt('', 'اختر');

  const days = isH ? 30 : 31;
  $('f-d').innerHTML = blank + Array.from({ length: days }, (_, i) => opt(i + 1, i + 1)).join('');

  const names = isH ? HIJRI_MONTHS : GREG_MONTHS;
  $('f-m').innerHTML = blank + names.map((n, i) => opt(i + 1, `${n} (${i + 1})`)).join('');

  const t = todayMs();
  const cur = isH ? hijriParts(t).y : new Date(t).getUTCFullYear();
  const years = [];
  for (let y = cur - 2; y <= cur + 15; y++) years.push(y);
  $('f-y').innerHTML = blank + years.map((y) => opt(y, isH ? `${y}هـ` : y)).join('');

  setSel('f-d', keep.d); setSel('f-m', keep.m); setSel('f-y', keep.y);
  $('cal-g').setAttribute('aria-pressed', String(!isH));
  $('cal-h').setAttribute('aria-pressed', String(isH));
}

/** يختار قيمة في القائمة، ويضيفها إن لم تكن موجودة (مثل سنة قديمة عند التعديل) */
function setSel(id, v) {
  const el = $(id);
  v = v === undefined || v === null ? '' : String(v);
  if (v && ![...el.options].some((o) => o.value === v)) {
    const o = new Option(id === 'f-y' && state.cal === 'h' ? `${v}هـ` : v, v);
    if (id === 'f-y') {
      const after = [...el.options].find((x) => x.value && +x.value > +v);
      el.insertBefore(o, after || null);
    } else el.add(o);
  }
  el.value = v;
}

function setDateFromMs(ms) {
  if (state.cal === 'h') {
    const h = hijriParts(ms);
    setSel('f-d', h.d); setSel('f-m', h.m); setSel('f-y', h.y);
  } else {
    const dt = new Date(ms);
    setSel('f-d', dt.getUTCDate()); setSel('f-m', dt.getUTCMonth() + 1); setSel('f-y', dt.getUTCFullYear());
  }
}

function formDate() {
  const d = parseInt($('f-d').value, 10);
  const m = parseInt($('f-m').value, 10);
  const y = parseInt($('f-y').value, 10);
  if (!d || !m || !y) return { ms: null, incomplete: true };
  if (state.cal === 'h') {
    if (y < 1300 || y > 1600 || d > 30) return { ms: null };
    return { ms: hijriToMs(y, m, d) };
  }
  if (y < 1900 || y > 2200) return { ms: null };
  return { ms: gregToMs(y, m, d) };
}

function updatePreview() {
  const r = formDate();
  const box = $('preview');
  if (r.incomplete) { box.hidden = true; return; }
  box.hidden = false;
  if (r.ms === null) {
    box.classList.add('bad');
    $('preview-label').textContent = 'تنبيه:';
    $('preview-text').textContent = 'التاريخ غير صحيح';
    return;
  }
  box.classList.remove('bad');
  $('preview-label').textContent = state.cal === 'h' ? 'يوافق بالميلادي:' : 'يوافق بالهجري:';
  $('preview-text').textContent = state.cal === 'h' ? fmtG(r.ms) : fmtH(r.ms);
}

function switchCal(cal) {
  if (state.cal === cal) return;
  const cur = formDate();
  state.cal = cal;
  ['f-d', 'f-m', 'f-y'].forEach((id) => { $(id).value = ''; });
  fillDateSelects();
  if (cur.ms !== null) setDateFromMs(cur.ms);
  updatePreview();
}

function formError(text) {
  $('form-error').textContent = text;
  $('form-error').hidden = !text;
}

/* ---------- التشغيل ---------- */
function wire() {
  $('f-type').innerHTML = TYPES.map((x) => `<option value="${x.v}">${x.t}</option>`).join('');
  fillDateSelects();
  $('cal-g').addEventListener('click', () => switchCal('g'));
  $('cal-h').addEventListener('click', () => switchCal('h'));
  ['f-d', 'f-m', 'f-y'].forEach((id) => $(id).addEventListener('change', () => { updatePreview(); formError(''); }));
  $('f-type').addEventListener('change', () => { if ($('f-type').value !== 'sub' && $('f-cycle').value === 'monthly') $('f-cycle').value = 'none'; updatePriceLabel(); });
  $('f-cycle').addEventListener('change', updatePriceLabel);
  $('f-price').addEventListener('input', () => formError(''));
  $('add-form').addEventListener('submit', addItem);
  $('export-btn').addEventListener('click', exportBackup);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => { importBackup(e.target.files[0]); e.target.value = ''; });
  $('edit-cancel').addEventListener('click', stopEditing);
  $('auth-form').addEventListener('submit', signIn);
  $('signup').addEventListener('click', signUp);
  $('logout').addEventListener('click', () => sb.auth.signOut());
  $('forgot').addEventListener('click', forgotPassword);
  $('change-pass').addEventListener('click', openPasswordForm);
  $('pwd-form').addEventListener('submit', savePassword);
  $('pwd-cancel').addEventListener('click', () => {
    state.recovery = false;
    if (location.hash) history.replaceState(null, '', appUrl());
    show(state.user ? 'app' : 'auth');
  });
  document.querySelectorAll('.toggle-pass').forEach((b) => b.addEventListener('click', () => {
    const inp = $(b.dataset.for);
    const showIt = inp.type === 'password';
    inp.type = showIt ? 'text' : 'password';
    if (b.dataset.for === 'p-new') $('p-confirm').type = inp.type;
    b.textContent = showIt ? 'إخفاء' : 'إظهار';
    b.setAttribute('aria-label', showIt ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
  }));
  $('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    render();
  });
  $('list').addEventListener('click', (e) => {
    const r = e.target.closest('[data-renew]');
    if (r) return renewItem(r.dataset.renew);
    const ed = e.target.closest('[data-edit]');
    if (ed) return startEditing(ed.dataset.edit);
    const d = e.target.closest('[data-del]');
    if (d) return removeItem(d.dataset.del);
  });
}

function onSession(session) {
  state.user = session ? session.user : null;
  if (state.user) {
    if (state.recovery) openPasswordForm(); else show('app');
    $('who').textContent = 'مسجّل الدخول: ' + state.user.email;
    loadItems();
  } else {
    show('auth');
    $('who').textContent = '';
    state.items = [];
  }
}

paintToday();
wire();
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  show('setup');
} else {
  // رابط «نسيت كلمة المرور» يعود إلى التطبيق ومعه type=recovery
  state.recovery = /type=recovery/.test(location.hash);
  const hashErr = new URLSearchParams(location.hash.slice(1)).get('error_code');
  if (hashErr) {
    authMsg(hashErr === 'otp_expired' ? 'انتهت صلاحية الرابط أو استُخدم من قبل. اطلب رابطًا جديدًا.' : 'تعذّر فتح الرابط، اطلب رابطًا جديدًا.', true);
    history.replaceState(null, '', location.origin + location.pathname);
  }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  sb.auth.getSession().then(({ data }) => onSession(data.session));
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') {
      state.recovery = true;
      state.user = session ? session.user : state.user;
      openPasswordForm();
      return;
    }
    const was = state.user && state.user.id;
    const now = session && session.user && session.user.id;
    if (was !== now) onSession(session);
  });
}
