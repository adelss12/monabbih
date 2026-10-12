import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  GREG_MONTHS, HIJRI_MONTHS, TYPES, typeLabel, CYCLE_LABELS,
  todayMs, hijriParts, hijriToMs, gregToMs, fmtG, fmtH,
  isoToMs, msToIso, dayWord, addCycle, statusOf, remainText
} from './dates.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { items: [], filter: 'all', q: '', cal: 'g', user: null };
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
  const el = $('alert');
  const was = el.hidden;
  $('alert-title').textContent = text;
  $('alert-names').textContent = '';
  el.hidden = false;
  setTimeout(() => { if (was) el.hidden = true; render(); }, 4000);
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
    expires_on: msToIso(r.ms)
  };
  const { data, error } = await sb.from('items').insert(row).select().single();
  $('add-btn').disabled = false;
  if (error) return formError('تعذّر الحفظ: ' + error.message);
  state.items.push(data);
  $('f-name').value = '';
  $('f-d').value = '';
  $('f-y').value = '';
  $('f-m').value = '1';
  updatePreview();
  render();
}

async function renewItem(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const t = todayMs();
  const exp = isoToMs(it.expires_on);
  const next = msToIso(addCycle(exp < t ? t : exp, it.cycle, it.cal));
  const { error } = await sb.from('items').update({ expires_on: next }).eq('id', id);
  if (error) return alert('تعذّر التجديد: ' + error.message);
  it.expires_on = next;
  render();
}

async function removeItem(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it || !confirm(`حذف «${it.name}»؟`)) return;
  const { error } = await sb.from('items').delete().eq('id', id);
  if (error) return alert('تعذّر الحذف: ' + error.message);
  state.items = state.items.filter((x) => x.id !== id);
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
    if (q && !x.name.toLowerCase().includes(q) && !typeLabel(x.type).includes(q)) return false;
    return true;
  });

  $('empty').hidden = shown.length > 0 || !$('loading').hidden;
  $('empty').textContent = all.length === 0 ? 'لا توجد عناصر بعد. أضف أول اشتراك أو وثيقة من النموذج.' : 'لا توجد عناصر مطابقة';

  $('list').innerHTML = shown.map((x) => {
    const initial = esc((x.name.trim().charAt(0) || '؟').toUpperCase());
    const name = esc(x.name);
    return `
<article class="item">
  <div class="mono${x.type === 'sub' ? ' sub' : ''}" aria-hidden="true">${initial}</div>
  <div class="info">
    <h3 dir="auto">${name}</h3>
    <span class="muted">${typeLabel(x.type)} · ${CYCLE_LABELS[x.cycle] || ''} · تنبيه قبل ${dayWord(x.lead_days, true)}</span>
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
    <button type="button" class="del" data-del="${x.id}" aria-label="حذف ${name}">حذف</button>
  </div>
</article>`;
  }).join('');
}

/* ---------- النموذج والتاريخ ---------- */
function fillMonths() {
  const names = state.cal === 'h' ? HIJRI_MONTHS : GREG_MONTHS;
  const cur = $('f-m').value || '1';
  $('f-m').innerHTML = names.map((n, i) => `<option value="${i + 1}">${n} (${i + 1})</option>`).join('');
  $('f-m').value = cur;
  const t = todayMs();
  $('f-y').placeholder = state.cal === 'h' ? String(hijriParts(t).y) : String(new Date(t).getUTCFullYear());
  $('cal-g').setAttribute('aria-pressed', String(state.cal === 'g'));
  $('cal-h').setAttribute('aria-pressed', String(state.cal === 'h'));
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
  if (cur.ms !== null) {
    if (cal === 'h') {
      const h = hijriParts(cur.ms);
      $('f-d').value = h.d; $('f-m').value = String(h.m); $('f-y').value = h.y;
    } else {
      const dt = new Date(cur.ms);
      $('f-d').value = dt.getUTCDate(); $('f-m').value = String(dt.getUTCMonth() + 1); $('f-y').value = dt.getUTCFullYear();
    }
  } else {
    $('f-y').value = '';
  }
  fillMonths();
  updatePreview();
}

function formError(text) {
  $('form-error').textContent = text;
  $('form-error').hidden = !text;
}

/* ---------- التشغيل ---------- */
function wire() {
  $('f-type').innerHTML = TYPES.map((x) => `<option value="${x.v}">${x.t}</option>`).join('');
  fillMonths();
  $('cal-g').addEventListener('click', () => switchCal('g'));
  $('cal-h').addEventListener('click', () => switchCal('h'));
  ['f-d', 'f-m', 'f-y'].forEach((id) => $(id).addEventListener('input', () => { updatePreview(); formError(''); }));
  $('f-type').addEventListener('change', () => { if ($('f-type').value !== 'sub' && $('f-cycle').value === 'monthly') $('f-cycle').value = 'none'; });
  $('add-form').addEventListener('submit', addItem);
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
