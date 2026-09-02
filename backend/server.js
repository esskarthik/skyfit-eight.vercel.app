require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const { requirePerm, requireAuth, resolveActor, roleSatisfies, normalizeRole, storeRole } = require('./lib/rbac');
const { db, audit, paginate, wrap } = require('./lib/store');
const { evaluateAccess, recordAttempt, DENY_REASONS } = require('./lib/access');
const catalog = require('./lib/catalog');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '12mb' }));

// Serve frontend
const frontendPath = path.join(__dirname, '..', 'frontend');
const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(frontendPath)) app.use(express.static(frontendPath));
if (fs.existsSync(publicPath)) app.use(express.static(publicPath));

// Supabase (service role — used server-side only; NEVER sent to the browser)
// If the env vars are unset (e.g. a host that hasn't had them configured yet),
// createClient('') would throw at require time and take down the whole API.
// We use a placeholder so the module loads, then guard real requests on
// HAS_SUPABASE and return a clear "server not configured" error instead of a
// confusing 404 / "invalid credentials".
const HAS_SUPABASE = !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
const _SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const _SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
const supabase = createClient(_SUPABASE_URL, _SUPABASE_KEY);
// Dedicated auth client so user sessions from /api/auth/token never attach the
// signed-in user's JWT to the shared data client (which would trigger RLS on writes).
const authSupabase = createClient(_SUPABASE_URL, _SUPABASE_KEY);
// Sentinal so any endpoint that needs Supabase can short-circuit with a clear message.
function requireSupabaseConfigured(res) {
  if (HAS_SUPABASE) return true;
  res.status(503).json({ error: 'Server is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the host environment (Vercel: Project -> Settings -> Environment Variables), then redeploy.' });
  return false;
}

// Ensure a public Storage bucket exists before uploading. Uses the admin
// (service-role) client so bucket creation works even when RLS would otherwise
// block anonymous creation. Safe to call on every upload; no-ops if present.
async function ensureBucket(bucket) {
  try {
    const name = String(bucket || 'gallery').replace(/[^a-z0-9_-]/gi, '');
    const { data, error } = await supabase.storage.getBucket(name);
    if (data) return name;
    const msg = String((error && (error.message || error.statusCode || error.code)) || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('nosuchbucket') || msg.includes('404') || (error && String(error.statusCode) === '404')) {
      await supabase.storage.createBucket(name, { public: true });
      return name;
    }
    if (msg.includes('already exists')) return name;
    return name;
  } catch (e) {
    return String(bucket || 'gallery').replace(/[^a-z0-9_-]/gi, '');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function computeExpiry(startDateStr, durationDays) {
  const d = new Date(startDateStr); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + durationDays);
  return d.toISOString().split('T')[0];
}
function daysRemaining(expiresStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiresStr); exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
}
function genId() { return 'SFZ-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
const { randomUUID } = require('crypto');
function uuid() { return randomUUID(); }
// created_by/recorded_by columns are UUID (FK to staff). Return actor.id if it is
// a valid UUID, else null (the default-created KEY admin has a non-UUID id).
function actorId(actor) {
  const id = actor && actor.id;
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
function todayISO() { return new Date().toISOString().split('T')[0]; }

// Load the lookup maps used to denormalise memberships for display:
//   members by email/id, plans by id, trainers by id.
async function buildLookup() {
  let members = [], plans = [], trainers = [];
  await Promise.all([
    supabase.from('members').select('id, full_name, email, phone, notes, status, created_at').then(r => { members = r.data || []; }),
    supabase.from('plans').select('id, name, category, price, duration_days, duration_label').then(r => { plans = r.data || []; }),
    supabase.from('trainers').select('id, name, role, initials').then(r => { trainers = r.data || []; })
  ]);
  const byEmail = new Map(), byId = new Map();
  for (const r of members) { byEmail.set(String(r.email || '').toLowerCase(), r); byId.set(r.id, r); }
  const planById = new Map(); for (const r of plans) planById.set(r.id, r);
  const trainerById = new Map(); for (const r of trainers) trainerById.set(r.id, r);
  return { byEmail, byId, planById, trainerById };
}

function lookupMember(lk, email, memberId) {
  if (lk && email && lk.byEmail.has(String(email).toLowerCase())) return lk.byEmail.get(String(email).toLowerCase());
  if (lk && memberId && lk.byId.has(memberId)) return lk.byId.get(memberId);
  return null;
}

// Derive a membership record for display, including computed status.
// The real schema stores memberships with FK columns (member_id, plan_id,
// trainer_id) plus a denormalised member_email; name/phone/plan/trainer are
// resolved from their parent tables via the lookup maps.
function fmtMembership(m, lk) {
  const prevStatus = (m.status || 'ACTIVE').toUpperCase();
  const expired = !!(m.expires && daysRemaining(m.expires) < 0);
  let status;
  if (prevStatus === 'CANCELLED') status = 'CANCELLED';
  else if (prevStatus === 'SUSPENDED') status = 'SUSPENDED';
  else if (prevStatus === 'PENDING') status = 'PENDING';
  else if (expired || prevStatus === 'EXPIRED') status = 'EXPIRED';
  else status = 'ACTIVE';
  const isActive = status === 'ACTIVE';
  const member = lookupMember(lk, m.member_email, m.member_id) || {};
  const plan = (lk && m.plan_id && lk.planById.get(m.plan_id)) || {};
  const trainer = (lk && m.trainer_id && lk.trainerById.get(m.trainer_id)) || null;
  return {
    id: m.id, memberId: m.member_id, planId: m.plan_id, category: m.category || plan.category,
    categoryLabel: (plan.category || m.category || '').toUpperCase(),
    planName: plan.name || m.plan_name || m.plan_id,
    durationLabel: plan.duration_label || m.duration_label || '',
    price: m.payment_amount != null ? m.payment_amount : plan.price,
    durationDays: plan.duration_days || (m.expires && m.start_date ? Math.round((new Date(m.expires) - new Date(m.start_date)) / 86400000) : null),
    member: {
      name: member.full_name || String(m.member_email || 'Unknown').split('@')[0] || 'Unknown',
      email: m.member_email || (member.email || ''),
      phone: member.phone || ''
    },
    startDate: m.start_date, expires: m.expires, status, isActive,
    trainer: trainer ? { id: trainer.id, name: trainer.name, role: trainer.role } : null,
    payment: m.payment_method ? { method: m.payment_method, transactionId: m.transaction_id } : null,
    notes: m.notes || '', createdBy: m.created_by,
    createdAt: m.created_at, updatedAt: m.updated_at,
    daysRemaining: daysRemaining(m.expires)
  };
}

// Group memberships by email to produce a "member" view.
// Each member is keyed by their members table row (email is the stable key).
function aggregateMembers(rows, lk) {
  const map = new Map();
  for (const m of rows) {
    const email = String(m.member_email || m.member_id || '').toLowerCase();
    if (!email || email === 'null') continue;
    if (!map.has(email)) map.set(email, []);
    map.get(email).push(m);
  }
  const out = [];
  for (const [email, list] of map) {
    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const latest = list[0];
    const active = list.find(x => fmtMembership(x, lk).status === 'ACTIVE') || null;
    const memberRow = lookupMember(lk, email, latest.member_id) || {};
    const rawLatest = active || latest;
    const fmtLatest = fmtMembership(latest, lk);
    out.push({
      email, id: memberRow.id || null,
      name: memberRow.full_name || fmtLatest.member.name,
      phone: memberRow.phone || '',
      created_at: memberRow.created_at || list[list.length - 1].created_at,
      memberships: list.length,
      plan: (active ? fmtMembership(active, lk) : fmtLatest).planName || null,
      planId: (active || latest).plan_id || null,
      status: active ? 'ACTIVE' : fmtLatest.status,
      expires: rawLatest.expires || null,
      daysRemaining: rawLatest.expires ? daysRemaining(rawLatest.expires) : null,
      trainer_id: latest.trainer_id || null,
      trainer_name: (lk && latest.trainer_id && lk.trainerById.get(latest.trainer_id)) ? lk.trainerById.get(latest.trainer_id).name : null,
      latestMembershipId: latest.id,
      archived: false
    });
  }
  return out;
}

// Denormalize a payment row for display with member/plan names resolved from
// the parent tables (payments itself only stores member_id/plan_id FK columns).
function decoratePayment(p, lk) {
  const member = lookupMember(lk, p.member_email, p.member_id) || {};
  const plan = (lk && p.plan_id && lk.planById.get(p.plan_id)) || {};
  return {
    ...p,
    member_name: member.full_name || (p.member_email ? String(p.member_email).split('@')[0] : null),
    member_email: member.email || p.member_email || null,
    plan_name: plan.name || p.plan_name || p.plan_id || null,
    planCategory: plan.category || null,
    member_id: p.member_id || null,
    plan_id: p.plan_id || null
  };
}

// Denormalize a workout_sessions row with member + trainer names.
function decorateWorkout(w, lk) {
  const member = (w.member_id && lk && lk.byId.get(w.member_id)) || {};
  const trainer = (w.trainer_id && lk && lk.trainerById.get(w.trainer_id)) || null;
  return {
    id: w.id, member_id: w.member_id, member_name: member.full_name || null,
    member_email: member.email || null, trainer_id: w.trainer_id,
    trainer_name: trainer ? trainer.name : null, session_type: w.session_type || 'Gym',
    notes: w.notes || '', date: w.completed_at || null, completed_at: w.completed_at || null,
    created_by: w.created_by || null
  };
}

// Denormalize a progress_records row with member name.
function decorateProgress(p, lk) {
  const member = (p.member_id && lk && lk.byId.get(p.member_id)) || {};
  return {
    id: p.id, member_id: p.member_id, member_name: member.full_name || null,
    member_email: member.email || null, weight: p.weight, body_fat: p.body_fat,
    muscle_mass: p.muscle_mass, notes: p.notes || '', recorded_at: p.recorded_at || null,
    recorded_date: p.recorded_at || null, recorded_by: p.recorded_by || null
  };
}
// members row (source of truth for name/phone). Never throws on duplicate.
async function resolveMember(email, name, phone, notes) {
  const norm = String(email || '').trim().toLowerCase();
  const { data: existing } = await supabase.from('members').select('id, full_name, email, phone').ilike('email', norm).maybeSingle();
  if (existing) return existing;
  const res = await supabase.from('members').insert({
    full_name: String(name || '').trim(), email: norm,
    phone: String(phone || '').trim(), notes: notes || null,
    status: 'active', created_at: new Date().toISOString()
  }).select('id, full_name, email, phone').single();
  if (res.error) {
    // Race condition — another request just created it.
    const { data: again } = await supabase.from('members').select('id, full_name, email, phone').ilike('email', norm).maybeSingle();
    if (again) return again;
    throw res.error;
  }
  return res.data;
}

async function lastVisitFor(emails) {
  if (!emails.length) return {};
  const { data } = await supabase.from('attendance').select('member_email, entry_time').in('member_email', emails).order('entry_time', { ascending: false });
  const map = {};
  for (const r of (data || [])) { if (!map[r.member_email]) map[r.member_email] = r.entry_time; }
  return map;
}

// ---------------------------------------------------------------------------
// PUBLIC ROUTES (unchanged behaviour; plans/trainers now DB-backed w/ fallback)
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), service: 'SKYFIT ZONE API', hasSupabase: !!process.env.SUPABASE_URL }));

app.post('/api/ai/chat', async (req, res) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  const { messages, model } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages required' });
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'SKYFIT ZONE' },
      body: JSON.stringify({ model: model || 'openai/gpt-4o-mini', messages })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public catalog: plans & trainers (DB-backed, cache fallback static)
app.get('/api/plans', async (req, res) => res.json(await catalog.getPlans()));
app.get('/api/trainers', async (req, res) => res.json(await catalog.getTrainers()));
app.get('/api/trainers/:id', async (req, res) => {
  const t = catalog.findTrainerById(req.params.id) || (await catalog.getTrainers()).find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Trainer not found' });
  res.json(t);
});

// Safe supplements accessor: returns [] / {error} when the (new) supplements
// table doesn't exist yet (migration pending) instead of crashing the API.
async function supFrom(action) {
  try { return await action(); }
  catch (e) {
    const msg = String((e && (e.message || e.details)) || e);
    if (/relation "supplements" does not exist|PGRST205/.test(msg)) return { missing: true, data: [], error: null };
    throw e;
  }
}

// Public supplement marketplace (shop). Returns only active products, with a
// category filter, so the landing page can render the shop pre-migration (empty).
app.get('/api/supplements', async (req, res) => {
  let q = supabase.from('supplements').select('*').eq('is_active', true).order('sort_order');
  if (req.query.category) q = q.eq('category', String(req.query.category));
  const { data } = await supFrom(() => q);
  res.json(data || []);
});

// Public contact form
app.post('/api/enquiries', wrap(async (req, res) => {
  const { name, phone, email, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'name and message required' });
  const { error } = await supabase.from('enquiries').insert({ name: String(name).slice(0, 150), phone: String(phone || '').slice(0, 20), email: String(email || '').slice(0, 150), message: String(message).slice(0, 2000) });
  if (error) return res.status(500).json({ error: 'Could not submit enquiry' });
  res.json({ ok: true });
}));

// Public membership lookup & management
app.get('/api/memberships', async (req, res) => {
  try {
    const lk = await buildLookup();
    const { data, error } = await supabase.from('memberships').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(m => fmtMembership(m, lk)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/memberships/by-email/:email', async (req, res) => {
  try {
    const lk = await buildLookup();
    const { data, error } = await supabase.from('memberships').select('*').ilike('member_email', req.params.email).order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(m => fmtMembership(m, lk)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/memberships/:id', async (req, res) => {
  try {
    const lk = await buildLookup();
    const { data, error } = await supabase.from('memberships').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Membership not found' });
    res.json(fmtMembership(data, lk));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payment/mock', (req, res) => {
  const { method, cardNumber, expiry, cvv, upi } = req.body;
  if (method === 'card') {
    if (!cardNumber || cardNumber.replace(/\s/g, '').length < 16) return res.status(400).json({ error: 'Invalid card number' });
    if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) return res.status(400).json({ error: 'Invalid expiry MM/YY' });
    if (!cvv || cvv.length !== 3) return res.status(400).json({ error: 'Invalid CVV' });
  }
  if (method === 'upi' && (!upi || !upi.includes('@'))) return res.status(400).json({ error: 'Invalid UPI ID' });
  setTimeout(() => res.json({ ok: true, transactionId: 'TXN' + Math.random().toString(36).slice(2, 9).toUpperCase(), message: 'Payment successful' }), 700);
});

// Checkout — creates a membership AND a corresponding payment ledger row.
// Membership is only ever created in PENDING/PENDING state; activation is
// decided server-side (payment verification authority), never by the browser.
app.post('/api/checkout', wrap(async (req, res) => {
  const { planId, member, startDate, payment, trainerId } = req.body;
  if (!planId || !member || !startDate) return res.status(400).json({ error: 'Missing required fields' });
  if (!member.name || !member.email || !member.phone) return res.status(400).json({ error: 'Member name, email, phone required' });
  if (!/^\S+@\S+\.\S+$/.test(member.email)) return res.status(400).json({ error: 'Invalid email' });
  const found = await catalog.resolvePlan(planId);
  if (!found) return res.status(400).json({ error: 'Invalid planId' });
  let trainer = null;
  if (trainerId) { trainer = await catalog.resolveTrainer(trainerId); if (!trainer) return res.status(400).json({ error: 'Invalid trainerId' }); }

  const memberRow = await resolveMember(member.email, member.name, member.phone);
  const now = new Date().toISOString();
  const expires = computeExpiry(startDate, found.plan.durationDays);
  const row = {
    id: uuid(), member_id: memberRow.id, plan_id: planId, trainer_id: trainer ? trainer.id : null,
    start_date: startDate, expires, is_active: true, status: 'PENDING', payment_status: 'PENDING',
    payment_method: payment ? payment.method : null,
    payment_amount: found.plan.price,
    transaction_id: payment ? (payment.transactionId || 'TXN' + Math.random().toString(36).slice(2, 9).toUpperCase()) : null,
    member_email: memberRow.email, notes: '', created_by: 'checkout', created_at: now, updated_at: now
  };
  const { data, error } = await supabase.from('memberships').insert(row).select().single();
  if (error) throw error;
  // payment ledger (real schema: member_id/plan_id/membership_id FKs, no name/email denorm)
  await supabase.from('payments').insert({
    membership_id: row.id, member_id: memberRow.id, plan_id: planId,
    amount: found.plan.price, currency: 'INR', status: 'PENDING',
    payment_method: row.payment_method, reference: row.transaction_id
  });
  const lk = await buildLookup();
  res.status(201).json({ ok: true, membership: fmtMembership(data, lk) });
}));

// Public "cancel membership" from the member portal — soft-cancel (history/access
// preserved as CANCELLED). Deliberately NOT a hard delete so billing records stay.
app.delete('/api/memberships/:id', wrap(async (req, res) => {
  const { data, error } = await supabase.from('memberships').update({ is_active: false, status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Membership not found' });
  res.json({ ok: true });
}));

// Supabase email/password auth → JWT for staff login
app.post('/api/auth/token', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!requireSupabaseConfigured(res)) return;
  try {
    const { data, error } = await authSupabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });
    if (!data.user) return res.status(401).json({ error: 'No user returned' });
    // Only allow if this email has an active staff_profiles record
    const { data: sp } = await supabase.from('staff_profiles').select('id, role, is_active').eq('email', data.user.email.toLowerCase()).maybeSingle();
    if (!sp || sp.is_active === false) return res.status(403).json({ error: 'Account is not authorized for admin access' });
    const at = data.session.access_token || data.session.accessToken || '';
    const rt = data.session.refresh_token || data.session.refreshToken || '';
    res.json({ ok: true, id_token: at, refresh_token: rt, expires_at: data.session.expires_at || null, role: normalizeRole(sp.role) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Silent refresh for long-lived admin sessions (Supabase JWTs expire ~1h).
// The SPA calls this when /api/admin/check (or any call) returns 401.
app.post('/api/auth/refresh', wrap(async (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
  if (!requireSupabaseConfigured(res)) return;
  try {
    const { data, error } = await authSupabase.auth.refreshSession({ refresh_token });
    if (error || !data || !data.session) return res.status(401).json({ error: error ? error.message : 'Invalid refresh token' });
    const user = data.user;
    if (!user) return res.status(401).json({ error: 'No user returned' });
    const { data: sp } = await supabase.from('staff_profiles').select('id, role, is_active').eq('email', user.email.toLowerCase()).maybeSingle();
    if (!sp || sp.is_active === false) return res.status(403).json({ error: 'Account is not authorized for admin access' });
    const at = data.session.access_token || data.session.accessToken || '';
    const rt = data.session.refresh_token || data.session.refreshToken || refresh_token;
    res.json({ ok: true, id_token: at, refresh_token: rt, expires_at: data.session.expires_at || null, role: normalizeRole(sp.role) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ---------------------------------------------------------------------------
// ACCESS DECISION — called by the biometric/QR/RFID device integration.
// Returns GRANTED/DENIED and always records the attempt. No auth required
// (device endpoint), but it returns no sensitive data beyond status/reason.
// ---------------------------------------------------------------------------
app.post('/api/access/decide', wrap(async (req, res) => {
  const { deviceUserId, memberEmail, deviceId } = req.body || {};
  if (!deviceUserId && !memberEmail) return res.status(400).json({ error: 'deviceUserId or memberEmail required' });
  // Optional shared device key to prevent blatant abuse (not a secret credential in browser)
  const key = req.headers['x-device-key'];
  if (process.env.DEVICE_ACCESS_KEY && key !== process.env.DEVICE_ACCESS_KEY) {
    return res.status(401).json({ error: 'Invalid device key' });
  }
  const decision = await evaluateAccess({ memberEmail, deviceUserId, deviceId });
  await recordAttempt({
    memberEmail: decision.member ? decision.member.email : (memberEmail || null),
    memberName: decision.member ? decision.member.name : null,
    deviceId: deviceId || null,
    accessMethod: req.body.accessMethod || 'fingerprint',
    status: decision.status, reason: decision.reason
  });
  res.json(decision);
}));

// ---------------------------------------------------------------------------
// ADMIN AUTH CHECK
// ---------------------------------------------------------------------------
app.get('/api/admin/check', requireAuth, (req, res) => res.json({ ok: true, actor: { email: req.actor.email, name: req.actor.name, role: req.actor.role } }));

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
app.get('/api/admin/dashboard', requirePerm('dashboard.view'), wrap(async (req, res) => {
  const m0 = new Date(); m0.setHours(0, 0, 0, 0);
  const iso0 = m0.toISOString();
  const weekAgo = new Date(m0); weekAgo.setDate(weekAgo.getDate() - 6);
  const monthStart = new Date(m0.getFullYear(), m0.getMonth(), 1);
  const yearStart = new Date(m0.getFullYear(), 0, 1);

  const [ms, att, pays, enqu, staff] = await Promise.all([
    supabase.from('memberships').select('*'),
    supabase.from('attendance').select('*'),
    supabase.from('payments').select('*').gte('created_at', monthStart.toISOString()),
    supabase.from('enquiries').select('*').gte('created_at', iso0),
    supabase.from('staff_profiles').select('role')
  ]);
  const lk = await buildLookup();
  const memberships = (ms.data || []).map(m => fmtMembership(m, lk));
  const atts = att.data || [];
  const paysM = pays.data || [];
  const maleStaff = staff.data || [];

  const members = aggregateMembers(ms.data || [], lk);
  const activeMem = members.filter(m => m.status === 'ACTIVE');
  const newThisMonth = members.filter(m => m.created_at && new Date(m.created_at) >= monthStart);
  const expired = members.filter(m => m.status === 'EXPIRED' || (m.expires && daysRemaining(m.expires) < 0));
  const expiringSoon = activeMem.filter(m => m.expires && daysRemaining(m.expires) <= 7 && daysRemaining(m.expires) >= 0);
  const todayAtt = atts.filter(a => a.entry_time && new Date(a.entry_time) >= m0);
  const todayGranted = todayAtt.filter(a => a.status === 'GRANTED');
  const monthlyRevenue = paysM.filter(p => p.status === 'PAID').reduce((s, p) => s + (p.amount || 0), 0);
  const pendingPayments = paysM.filter(p => p.status === 'PENDING').length;

  // membership overview
  const memStatus = { ACTIVE: 0, PENDING: 0, EXPIRED: 0, CANCELLED: 0, expiringSoon: 0 };
  memberships.forEach(m => { memStatus[m.status] = (memStatus[m.status] || 0) + 1; });
  memStatus.expiringSoon = memberships.filter(m => m.status === 'ACTIVE' && m.daysRemaining <= 7 && m.daysRemaining >= 0).length;
  memStatus.SUSPENDED = (memberships.filter(m => m.status === 'SUSPENDED') || []).length;

  // revenue overview
  const rev = { today: 0, week: 0, month: monthlyRevenue, year: 0 };
  const allPaid = (await supabase.from('payments').select('amount, created_at, status')).data || [];
  allPaid.filter(p => p.status === 'PAID').forEach(p => {
    const t = new Date(p.created_at);
    if (t >= m0) rev.today += p.amount;
    if (t >= weekAgo) rev.week += p.amount;
    if (t >= yearStart) rev.year += p.amount;
  });

  // recent activity
  const recent = [];
  (memberships.slice(0, 5)).forEach(m => recent.push({ type: 'membership', title: (m.status === 'CANCELLED' ? 'Membership cancelled' : 'Membership updated') + ` — ${m.member.name}`, entity: 'membership', entity_id: m.id, at: m.createdAt }));
  (atts.slice(0, 5)).forEach(a => recent.push({ type: a.status === 'GRANTED' ? 'access' : 'access-denied', title: (a.status === 'GRANTED' ? 'Access entry' : 'Access denied') + ` — ${a.member_name || a.member_email}`, entity: 'attendance', entity_id: a.id, at: a.entry_time }));
  (enqu.data || []).forEach(e => recent.push({ type: 'enquiry', title: `New enquiry — ${e.name}`, entity: 'enquiry', entity_id: e.id, at: e.created_at }));
  recent.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 10);

  // expiring memberships
  const expiringList = memberships.filter(m => m.status === 'ACTIVE' && m.daysRemaining <= 15 && m.daysRemaining >= 0).sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 10);

  res.json({
    kpis: {
      totalMembers: members.length, activeMembers: activeMem.length, newMembers: newThisMonth.length,
      expiredMembers: expired.length, expiringSoon: expiringSoon.length,
      todaysAttendance: todayGranted.length, monthlyRevenue, pendingPayments, currentlyInside: todayGranted.length
    },
    attendance: {
      present: todayGranted.length,
      denied: todayAtt.filter(a => a.status === 'DENIED').length,
      currentlyInside: todayGranted.length
    },
    revenue: rev,
    membership: memStatus,
    recentActivity: recent,
    expiringMemberships: expiringList.map(m => ({ id: m.id, member: m.member, plan: m.planName, expires: m.expires, days: m.daysRemaining, status: m.status }))
  });
}));

// ---------------------------------------------------------------------------
// MEMBERS
// ---------------------------------------------------------------------------
app.get('/api/admin/members', requirePerm('members.view'), wrap(async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const status = String(req.query.status || '');
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '15', 10)));
  const lk = await buildLookup();
  const [mt, msh] = await Promise.all([
    supabase.from('members').select('*').order('created_at', { ascending: false }),
    supabase.from('memberships').select('*').order('created_at', { ascending: false })
  ]);
  const agg = aggregateMembers((msh && msh.data) || [], lk);
  const byEmail = new Map(agg.map(m => [String(m.email).toLowerCase(), m]));
  const members = (mt.data || []).map(r => {
    const email = String(r.email || '').toLowerCase();
    const existing = byEmail.get(email);
    if (existing) return { ...existing, id: r.id, name: existing.name || r.full_name, phone: existing.phone || r.phone, notes: r.notes };
    return { id: r.id, email: r.email, name: r.full_name || r.email, phone: r.phone || '', created_at: r.created_at, memberships: 0, plan: null, planId: null, status: 'NO_MEMBERSHIP', expires: null, daysRemaining: null, trainer_id: null, trainer_name: null, latestMembershipId: null, archived: false, notes: r.notes };
  });
  // last visit
  const visits = await lastVisitFor(members.map(m => m.email));
  let list = members.map(m => ({ ...m, lastVisit: visits[m.email] || null }));

  if (q) list = list.filter(m => [m.name, m.email, m.phone, m.plan, m.trainer_name].join(' ').toLowerCase().includes(q));
  if (status === 'active') list = list.filter(m => m.status === 'ACTIVE');
  else if (status === 'expired') list = list.filter(m => m.status === 'EXPIRED' || (m.expires && daysRemaining(m.expires) < 0));
  else if (status === 'no_membership') list = list.filter(m => m.status === 'NO_MEMBERSHIP' || !m.planId);
  else if (status === 'expiring') list = list.filter(m => m.status === 'ACTIVE' && m.expires && daysRemaining(m.expires) <= 7 && daysRemaining(m.expires) >= 0);
  else if (status === 'pending') list = list.filter(m => m.status === 'PENDING');
  else if (status === 'archived') list = list.filter(m => m.status === 'CANCELLED');

  const total = list.length;
  const paged = list.slice((page - 1) * pageSize, page * pageSize);
  res.json({ data: paged, total, page, pageSize });
}));

app.get('/api/admin/members/:id', requirePerm('members.view'), wrap(async (req, res) => {
  const email = String(req.params.id).toLowerCase();
  const lk = await buildLookup();
  const { data: memberRow } = await supabase.from('members').select('*').ilike('email', email).maybeSingle();
  const { data } = await supabase.from('memberships').select('*').ilike('member_email', email).order('created_at', { ascending: false });
  if (!memberRow && (!data || !data.length)) return res.status(404).json({ error: 'Member not found' });
  const memberships = (data || []).map(m => fmtMembership(m, lk));
  const member = aggregateMembers(data || [], lk)[0] || {
    id: memberRow.id, email: memberRow.email, name: memberRow.full_name || memberRow.email, phone: memberRow.phone || '', created_at: memberRow.created_at, memberships: 0, plan: null, planId: null, status: 'NO_MEMBERSHIP', expires: null, daysRemaining: null, trainer_id: null, trainer_name: null, latestMembershipId: null, archived: false, notes: memberRow.notes
  };
  const memberIds = [...new Set([...(data || []).map(m => m.member_id), memberRow ? memberRow.id : null].filter(Boolean))];
  const [attendance, biometric, progressRecs, workouts] = await Promise.all([
    supabase.from('attendance').select('*').ilike('member_email', email).order('entry_time', { ascending: false }).limit(200),
    supabase.from('biometric_members').select('*').ilike('member_email', email),
    (memberIds.length ? supabase.from('progress_records').select('*').in('member_id', memberIds).order('recorded_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] })),
    (memberIds.length ? supabase.from('workout_sessions').select('*').in('member_id', memberIds).order('completed_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] }))
  ]);
  // payments row uses member_id FK
  const payQuery = supabase.from('payments').select('*').order('created_at', { ascending: true });
  const payFetched = memberIds.length ? await payQuery.in('member_id', memberIds) : await payQuery.eq('member_id', '');
  res.json({
    member,
    memberships,
    payments: (payFetched.data || []).map(p => decoratePayment(p, lk)),
    attendance: attendance.data || [],
    biometric: biometric.data || [],
    progress: (progressRecs.data || []).map(p => decorateProgress(p, lk)),
    workouts: (workouts.data || []).map(w => decorateWorkout(w, lk)),
    stats: {
      totalVisits: (attendance.data || []).filter(a => a.status === 'GRANTED').length,
      lastVisit: (attendance.data || []).find(a => a.status === 'GRANTED')?.entry_time || null,
      denied: (attendance.data || []).filter(a => a.status === 'DENIED').length
    }
  });
}));

app.post('/api/admin/members', requirePerm('members.manage'), wrap(async (req, res) => {
  const { name, email, phone, planId, startDate, trainerId, paymentMethod, notes, status } = req.body;
  if (!name || !email || !phone || !planId || !startDate) return res.status(400).json({ error: 'name, email, phone, planId, startDate required' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  const found = await catalog.resolvePlan(planId);
  if (!found) return res.status(400).json({ error: 'Invalid planId' });
  let trainer = null;
  if (trainerId) { trainer = await catalog.resolveTrainer(trainerId); if (!trainer) return res.status(400).json({ error: 'Invalid trainerId' }); }
  const memberRow = await resolveMember(email, name, phone, notes);
  const now = new Date().toISOString();
  const expires = computeExpiry(startDate, found.plan.durationDays);
  const row = {
    id: uuid(), member_id: memberRow.id, plan_id: planId, trainer_id: trainer ? trainer.id : null,
    start_date: startDate, expires, is_active: true, status: status || 'ACTIVE', payment_status: status === 'PENDING' ? 'PENDING' : 'PAID',
    payment_method: paymentMethod || null,
    payment_amount: found.plan.price,
    transaction_id: paymentMethod ? ('ADMIN-' + Math.random().toString(36).slice(2, 7).toUpperCase()) : null,
    member_email: memberRow.email, notes: notes ? String(notes).slice(0, 500) : '',
    created_by: 'admin', created_at: now, updated_at: now
  };
  const { data, error } = await supabase.from('memberships').insert(row).select().single();
  if (error) throw error;
  if (paymentMethod) await supabase.from('payments').insert({ membership_id: row.id, member_id: memberRow.id, plan_id: planId, amount: found.plan.price, currency: 'INR', status: 'PAID', payment_method: paymentMethod, reference: row.transaction_id });
  const lk = await buildLookup();
  await audit(req.actor, 'Created member', 'membership', row.id, { email: row.member_email, plan: found.plan.name });
  res.status(201).json({ ok: true, membership: fmtMembership(data, lk) });
}));

app.put('/api/admin/members/:id', requirePerm('members.manage'), wrap(async (req, res) => {
  const { name, phone, notes, trainerId } = req.body;
  const email = String(req.params.id).toLowerCase();
  const { data: r } = await supabase.from('members').select('id').ilike('email', email).maybeSingle();
  if (!r) return res.status(404).json({ error: 'Member not found' });
  const update = {};
  if (name) update.full_name = String(name).trim();
  if (phone) update.phone = String(phone).trim();
  if (notes !== undefined) update.notes = String(notes).slice(0, 500);
  if (Object.keys(update).length) await supabase.from('members').update(update).eq('id', r.id);
  // trainer assignment applies to the latest membership
  if (trainerId !== undefined) {
    const { data: list } = await supabase.from('memberships').select('id').ilike('member_email', email).order('created_at', { ascending: false });
    if (list && list.length) {
      const tUpdate = { updated_at: new Date().toISOString() };
      if (!trainerId) tUpdate.trainer_id = null;
      else { const t = await catalog.resolveTrainer(trainerId); if (!t) return res.status(400).json({ error: 'Invalid trainerId' }); tUpdate.trainer_id = t.id; }
      await supabase.from('memberships').update(tUpdate).eq('id', list[0].id);
    }
  }
  await audit(req.actor, 'Edited member', 'member', r.id, { email });
  res.json({ ok: true });
}));

app.delete('/api/admin/members/:id', requirePerm('members.manage'), wrap(async (req, res) => {
  // Archive — mark all memberships cancelled + deactivated (soft delete on member registry)
  const email = String(req.params.id).toLowerCase();
  const { data: list } = await supabase.from('memberships').select('id').ilike('member_email', email);
  if (list && list.length) {
    await supabase.from('memberships').update({ status: 'CANCELLED', is_active: false, updated_at: new Date().toISOString() }).in('id', list.map(x => x.id));
  }
  const { data: r } = await supabase.from('members').select('id').ilike('email', email).maybeSingle();
  if (r) await supabase.from('members').update({ status: 'inactive' }).eq('id', r.id);
  if (!r && (!list || !list.length)) return res.status(404).json({ error: 'Member not found' });
  await audit(req.actor, 'Archived member', 'member', email, { email, count: (list || []).length });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// MEMBERSHIPS
// ---------------------------------------------------------------------------
app.get('/api/admin/memberships', requirePerm('memberships.view'), wrap(async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const status = String(req.query.status || '');
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '15', 10)));
  const lk = await buildLookup();
  let { data } = await supabase.from('memberships').select('*').order('created_at', { ascending: false });
  let list = (data || []).map(m => fmtMembership(m, lk));
  if (q) list = list.filter(m => [m.member.name, m.member.email, m.member.phone, m.planName, m.id].join(' ').toLowerCase().includes(q));
  if (status) list = list.filter(m => m.status === status.toUpperCase());
  const total = list.length;
  const paged = list.slice((page - 1) * pageSize, page * pageSize);
  res.json({ data: paged, total, page, pageSize });
}));

app.get('/api/admin/memberships/:id', requirePerm('memberships.view'), wrap(async (req, res) => {
  const lk = await buildLookup();
  const { data, error } = await supabase.from('memberships').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Membership not found' });
  const m = fmtMembership(data, lk);
  const { data: payments } = await supabase.from('payments').select('*').eq('membership_id', m.id).order('created_at', { ascending: true });
  const { data: logs } = await supabase.from('audit_logs').select('*').eq('entity', 'membership').eq('entity_id', m.id).order('created_at', { ascending: true });
  res.json({ membership: m, payments: payments || [], timeline: logs || [] });
}));

// activate / suspend / cancel / renew — state transitions
app.post('/api/admin/memberships/:id/activate', requirePerm('memberships.manage'), wrap(async (req, res) => {
  const lk = await buildLookup();
  const { data, error } = await supabase.from('memberships').update({ is_active: true, status: 'ACTIVE', payment_status: 'PAID', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Membership not found' });
  await audit(req.actor, 'Activated membership', 'membership', req.params.id);
  res.json({ ok: true, membership: fmtMembership(data, lk) });
}));
app.post('/api/admin/memberships/:id/suspend', requirePerm('memberships.manage'), wrap(async (req, res) => {
  const lk = await buildLookup();
  const { data, error } = await supabase.from('memberships').update({ is_active: false, status: 'SUSPENDED', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Membership not found' });
  await audit(req.actor, 'Suspended membership', 'membership', req.params.id);
  res.json({ ok: true, membership: fmtMembership(data, lk) });
}));
app.post('/api/admin/memberships/:id/cancel', requirePerm('memberships.manage'), wrap(async (req, res) => {
  const lk = await buildLookup();
  const { data, error } = await supabase.from('memberships').update({ is_active: false, status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Membership not found' });
  await audit(req.actor, 'Cancelled membership', 'membership', req.params.id);
  res.json({ ok: true, membership: fmtMembership(data, lk) });
}));
app.post('/api/admin/memberships/:id/renew', requirePerm('memberships.manage'), wrap(async (req, res) => {
  const { planId, startDate } = req.body;
  const lk = await buildLookup();
  const { data: existing, error: fe } = await supabase.from('memberships').select('*').eq('id', req.params.id).single();
  if (fe || !existing) return res.status(404).json({ error: 'Membership not found' });
  const found = planId ? await catalog.resolvePlan(planId) : null;
  const dur = found ? found.plan.durationDays : ((lk && lk.planById.get(existing.plan_id)) ? lk.planById.get(existing.plan_id).duration_days : 30);
  const now = new Date().toISOString();
  const row = {
    id: uuid(), member_id: existing.member_id, plan_id: (found && planId) || existing.plan_id,
    trainer_id: existing.trainer_id, start_date: startDate || todayISO(),
    expires: computeExpiry(startDate || todayISO(), dur), is_active: true, status: 'ACTIVE',
    payment_status: 'PAID', payment_method: existing.payment_method,
    payment_amount: found ? found.plan.price : existing.payment_amount,
    transaction_id: 'RENEW-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
    member_email: existing.member_email, notes: existing.notes || '', created_by: 'admin_renew',
    created_at: now, updated_at: now
  };
  const { data, error } = await supabase.from('memberships').insert(row).select().single();
  if (error) throw error;
  await audit(req.actor, 'Renewed membership', 'membership', row.id, { from: req.params.id, plan: row.plan_id });
  res.status(201).json({ ok: true, membership: fmtMembership(data, lk) });
}));
// Soft-delete a membership (financial/history is preserved; state becomes CANCELLED).
app.delete('/api/admin/memberships/:id', requirePerm('memberships.manage'), wrap(async (req, res) => {
  const { data, error } = await supabase.from('memberships').update({ is_active: false, status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Membership not found' });
  await audit(req.actor, 'Deleted membership', 'membership', req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// PLANS
// ---------------------------------------------------------------------------
// Load plan feature rows for one or many plan ids (separate table).
async function attachPlanFeatures(plans) {
  try {
    const ids = (plans || []).map(p => p.id);
    if (!ids.length) return plans || [];
    const { data: feats } = await supabase.from('plan_features').select('plan_id, feature').in('plan_id', ids).order('sort_order');
    const byPlan = {};
    for (const f of (feats || [])) { (byPlan[f.plan_id] = byPlan[f.plan_id] || []).push(f.feature); }
    return (plans || []).map(p => ({ ...p, features: byPlan[p.id] || [] }));
  } catch (e) { return (plans || []).map(p => ({ ...p, features: [] })); }
}

app.get('/api/admin/plans', requirePerm('plans.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('plans').select('*').order('name');
  res.json(await attachPlanFeatures(data || []));
}));
app.post('/api/admin/plans', requirePerm('plans.manage'), wrap(async (req, res) => {
  const { id, name, category, description, price, duration_days, duration_label, tag, save_text, features, active } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const row = { id: String(id).trim(), name: String(name).trim(), category: category || 'gym', description: description || '', price: Number(price) || 0, duration_days: Number(duration_days) || 30, duration_label: duration_label || (Number(duration_days) || 30) + ' days', tag: tag || null, save_text: save_text || null, is_active: active !== false, status: active === false ? 'archived' : 'active' };
  const { data: dupPlan } = await supabase.from('plans').select('id').ilike('name', row.name).limit(1);
  if (dupPlan && dupPlan.length) return res.status(409).json({ error: 'A plan named "' + row.name + '" already exists' });
  const { data, error } = await supabase.from('plans').insert(row).select().single();
  if (error) return res.status(400).json({ error: 'Plan could not be created (id may already exist)' });
  await writePlanFeatures(data.id, features);
  catalog._planCache = { at: 0, data: null };
  await audit(req.actor, 'Created plan', 'plan', row.id, { name: row.name, price: row.price });
  res.status(201).json((await attachPlanFeatures([data]))[0]);
}));
app.put('/api/admin/plans/:id', requirePerm('plans.manage'), wrap(async (req, res) => {
  const { name, description, price, duration_days, duration_label, tag, save_text, features, active } = req.body;
  const update = { updated_at: new Date().toISOString() };
  if (name !== undefined) update.name = String(name).trim();
  if (description !== undefined) update.description = description;
  if (price !== undefined) update.price = Number(price);
  if (duration_days !== undefined) update.duration_days = Number(duration_days);
  if (duration_label !== undefined) update.duration_label = duration_label;
  if (tag !== undefined) update.tag = tag || null;
  if (save_text !== undefined) update.save_text = save_text || null;
  if (active !== undefined) { update.is_active = !!active; update.status = active ? 'active' : 'archived'; }
  const { data, error } = await supabase.from('plans').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Plan not found' });
  if (features !== undefined) await writePlanFeatures(data.id, features);
  catalog._planCache = { at: 0, data: null };
  await audit(req.actor, 'Changed plan', 'plan', req.params.id, { name: data.name });
  res.json((await attachPlanFeatures([data]))[0]);
}));
app.delete('/api/admin/plans/:id', requirePerm('plans.manage'), wrap(async (req, res) => {
  // Archive (deactivate) — never destructively deletes so historical memberships stay intact.
  await supabase.from('plans').update({ is_active: false, status: 'archived', updated_at: new Date().toISOString() }).eq('id', req.params.id);
  catalog._planCache = { at: 0, data: null };
  await audit(req.actor, 'Archived plan', 'plan', req.params.id);
  res.json({ ok: true });
}));

async function writePlanFeatures(planId, features) {
  try {
    await supabase.from('plan_features').delete().eq('plan_id', planId);
    const list = (Array.isArray(features) ? features : []).filter(Boolean).map((f, i) => ({ plan_id: planId, feature: String(f), sort_order: i }));
    if (list.length) await supabase.from('plan_features').insert(list);
  } catch (e) { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// PAYMENTS
// ---------------------------------------------------------------------------
app.get('/api/admin/payments', requirePerm('payments.view'), wrap(async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const status = String(req.query.status || '');
  const from = req.query.from, to = req.query.to;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '15', 10)));
  let query = supabase.from('payments').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (q) query = query.or(`reference.ilike.%${q}%,razorpay_order_id.ilike.%${q}%,razorpay_payment_id.ilike.%${q}%,id.ilike.%${q}%`);
  if (status) query = query.eq('status', status.toUpperCase());
  if (from) query = query.gte('created_at', new Date(from).toISOString());
  if (to) { const t = new Date(to); t.setHours(23, 59, 59); query = query.lte('created_at', t.toISOString()); }
  const { data, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  const lk = await buildLookup();
  const rows = (data || []).map(p => decoratePayment(p, lk));
  res.json({ data: rows, total: count || 0, page, pageSize });
}));
app.get('/api/admin/payments/:id', requirePerm('payments.view'), wrap(async (req, res) => {
  const { data, error } = await supabase.from('payments').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Payment not found' });
  const lk = await buildLookup();
  return res.json(decoratePayment(data, lk));
}));
app.post('/api/admin/payments/:id/refund', requirePerm('payments.manage'), wrap(async (req, res) => {
  const { data, error } = await supabase.from('payments').update({ status: 'REFUNDED', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Payment not found' });
  await audit(req.actor, 'Refunded payment', 'payment', req.params.id, { amount: data.amount });
  res.json(data);
}));
// Soft-delete a payment (financial history is preserved; row is marked cancelled).
app.delete('/api/admin/payments/:id', requirePerm('payments.manage'), wrap(async (req, res) => {
  const { data, error } = await supabase.from('payments').update({ status: 'CANCELLED', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Payment not found' });
  await audit(req.actor, 'Deleted payment', 'payment', req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// SERVICES
// ---------------------------------------------------------------------------
app.get('/api/admin/services', requirePerm('services.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('services').select('*').order('sort_order');
  res.json(data || []);
}));
app.post('/api/admin/services', requirePerm('services.manage'), wrap(async (req, res) => {
  const { name, description, price, image_url, icon, category, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const slug = (req.body.slug) || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const { data: dupSvc } = await supabase.from('services').select('id').ilike('name', String(name).trim()).limit(1);
  if (dupSvc && dupSvc.length) return res.status(409).json({ error: 'A service named "' + String(name).trim() + '" already exists' });
  const { data, error } = await supabase.from('services').insert({
    name: String(name).trim(), slug, description: description || '',
    price: price != null ? Number(price) : null, image_url: image_url || null,
    icon: icon || null, category: category || 'Fitness', sort_order: Number(sort_order) || 0,
    is_active: true, status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }).select().single();
  if (error) throw error;
  await audit(req.actor, 'Created service', 'service', data.id, { name: data.name });
  res.status(201).json(data);
}));
app.put('/api/admin/services/:id', requirePerm('services.manage'), wrap(async (req, res) => {
  const update = { updated_at: new Date().toISOString() };
  ['name', 'description', 'image_url', 'icon', 'category', 'slug'].forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  if (req.body.price !== undefined) update.price = Number(req.body.price);
  if (req.body.sort_order !== undefined) update.sort_order = Number(req.body.sort_order);
  if (req.body.is_active !== undefined) { update.is_active = !!req.body.is_active; update.status = req.body.is_active ? 'active' : 'archived'; }
  const { data, error } = await supabase.from('services').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Service not found' });
  await audit(req.actor, 'Edited service', 'service', req.params.id, { name: data.name });
  res.json(data);
}));
app.delete('/api/admin/services/:id', requirePerm('services.manage'), wrap(async (req, res) => {
  await supabase.from('services').update({ status: 'archived', is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  await audit(req.actor, 'Archived service', 'service', req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// SUPPLEMENTS (marketplace)
// ---------------------------------------------------------------------------
app.get('/api/admin/supplements', requirePerm('supplements.view'), wrap(async (req, res) => {
  const { data } = await supFrom(() => supabase.from('supplements').select('*').order('sort_order'));
  res.json(data || []);
}));
app.post('/api/admin/supplements', requirePerm('supplements.manage'), wrap(async (req, res) => {
  const { name, brand, category, price, mrp, size, flavor, image_url, description, rating, stock, tags, is_featured, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const { data: dupSup } = await supFrom(() => supabase.from('supplements').select('id').ilike('name', String(name).trim()).limit(1)).catch(() => ({ data: null }));
  if (dupSup && dupSup.length) return res.status(409).json({ error: 'A product named "' + String(name).trim() + '" already exists' });
  const { data, error } = await supFrom(() => supabase.from('supplements').insert({
    slug, name: String(name).trim(), brand: brand || null, category: category || 'whey',
    price: price != null ? Number(price) : 0, mrp: mrp != null ? Number(mrp) : null,
    size: size || null, flavor: flavor || null, image_url: image_url || null,
    description: description || '', rating: rating != null ? Number(rating) : 5,
    stock: stock != null ? Number(stock) : 0, tags: Array.isArray(tags) ? tags : [],
    is_featured: !!is_featured, is_active: true, sort_order: Number(sort_order) || 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }).select().single());
  if (error) return res.status(500).json({ error: 'Supplement could not be created (run the supplements migration first)' });
  await audit(req.actor, 'Created supplement', 'supplement', data.id, { name: data.name });
  res.status(201).json(data);
}));
app.put('/api/admin/supplements/:id', requirePerm('supplements.manage'), wrap(async (req, res) => {
  const update = { updated_at: new Date().toISOString() };
  ['name', 'brand', 'slug', 'category', 'size', 'flavor', 'image_url', 'description'].forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  ['price', 'mrp', 'rating', 'stock', 'sort_order'].forEach(k => { if (req.body[k] !== undefined) update[k] = Number(req.body[k]); });
  if (req.body.is_active !== undefined) update.is_active = !!req.body.is_active;
  if (req.body.is_featured !== undefined) update.is_featured = !!req.body.is_featured;
  if (req.body.tags !== undefined) update.tags = Array.isArray(req.body.tags) ? req.body.tags : [];
  const { data, error } = await supFrom(() => supabase.from('supplements').update(update).eq('id', req.params.id).select().single());
  if (error || !data) return res.status(404).json({ error: 'Supplement not found (migration may be pending)' });
  await audit(req.actor, 'Edited supplement', 'supplement', req.params.id, { name: data.name });
  res.json(data);
}));
app.delete('/api/admin/supplements/:id', requirePerm('supplements.manage'), wrap(async (req, res) => {
  await supFrom(() => supabase.from('supplements').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id));
  await audit(req.actor, 'Archived supplement', 'supplement', req.params.id);
  res.json({ ok: true });
}));

// Supplement image upload (Supabase Storage -> public URL). Accepts a base64
// data URL so the admin can attach a product photo without wiring up another
// tool. The bucket is `supplements`; if it doesn't exist the upload is recorded
// in media_assets under the same path and falls back gracefully.
app.post('/api/admin/supplements/upload', requirePerm('supplements.manage'), wrap(async (req, res) => {
  const { dataUrl } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (m) {
    const mime = m[1].toLowerCase();
    if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Unsupported file type: ' + m[1] + '. Please upload an image (JPEG, PNG, WEBP, GIF, HEIC, AVIF, SVG).' });
  }
  let mimeType = m ? m[1].toLowerCase() : 'image/png';
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  const buf = Buffer.from(m ? m[2] : dataUrl.replace(/^data:.*;base64,/, ''), 'base64');
  if (!buf.length || buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5MB)' });
  const fileName = 'supplements/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.img';
  let url;
  try {
    await ensureBucket('supplements');
    const { error } = await supabase.storage.from('supplements').upload(fileName, buf, { contentType: mimeType, upsert: false });
    if (error) throw error;
    const { data: pub } = supabase.storage.from('supplements').getPublicUrl(fileName);
    url = pub.publicUrl;
  } catch (e) {
    return res.status(400).json({ error: 'Photo upload failed: ' + (e.message || 'unknown error') + '. Create a public Storage bucket named "supplements" or check storage permissions.' });
  }
  res.status(201).json({ url });
}));

// ---------------------------------------------------------------------------
// TRAINERS
// ---------------------------------------------------------------------------
app.get('/api/admin/trainers', requirePerm('trainers.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('trainers').select('*').order('id');
  res.json(data || []);
}));
app.post('/api/admin/trainers', requirePerm('trainers.manage'), wrap(async (req, res) => {
  const { id, name, photo, specialization, experience, certification, bio, contact, status, color, initials, role, exp, speciality, rating, clients, available } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const ini = initials || (String(name).split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase());
  const { data: dupTr } = await supabase.from('trainers').select('id').ilike('name', String(name).trim()).limit(1);
  if (dupTr && dupTr.length) return res.status(409).json({ error: 'A trainer named "' + String(name).trim() + '" already exists' });
  const { data, error } = await supabase.from('trainers').insert({
    id: String(id).trim(), name: String(name).trim(),
    role: role || specialization || 'Trainer', exp: exp || experience || '',
    rating: rating != null ? Number(rating) : 4.5, clients: clients != null ? Number(clients) : 0,
    speciality: Array.isArray(speciality) ? speciality : (specialization ? [specialization] : (certification ? [certification] : [])),
    bio: bio || '', available: Array.isArray(available) ? available : ['Mon', 'Wed', 'Fri'],
    color: color || '#1A1D2E', initials: ini, status: status || 'active'
  }).select().single();
  if (error) return res.status(400).json({ error: 'Trainer could not be created (id may exist)' });
  catalog._trainerCache = { at: 0, data: null };
  await audit(req.actor, 'Added trainer', 'trainer', data.id, { name: data.name });
  res.status(201).json(data);
}));
app.put('/api/admin/trainers/:id', requirePerm('trainers.manage'), wrap(async (req, res) => {
  const update = {};
  ['name', 'bio', 'role', 'exp', 'color', 'initials', 'status', 'photo'].forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  if (req.body.specialization !== undefined) update.role = req.body.specialization;
  if (req.body.experience !== undefined) update.exp = req.body.experience;
  if (req.body.speciality !== undefined) update.speciality = req.body.speciality;
  if (req.body.available !== undefined) update.available = req.body.available;
  if (req.body.rating !== undefined) update.rating = Number(req.body.rating);
  if (req.body.clients !== undefined) update.clients = Number(req.body.clients);
  const { data, error } = await supabase.from('trainers').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Trainer not found' });
  catalog._trainerCache = { at: 0, data: null };
  await audit(req.actor, 'Edited trainer', 'trainer', req.params.id, { name: data.name });
  res.json(data);
}));
app.delete('/api/admin/trainers/:id', requirePerm('trainers.manage'), wrap(async (req, res) => {
  await supabase.from('trainers').update({ status: 'disabled' }).eq('id', req.params.id);
  catalog._trainerCache = { at: 0, data: null };
  await audit(req.actor, 'Deactivated trainer', 'trainer', req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// STAFF (RBAC)
// ---------------------------------------------------------------------------
app.get('/api/admin/staff', requirePerm('staff.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('staff_profiles').select('*').order('email');
  const mapped = (data || []).map(s => ({ ...s, role: normalizeRole(s.role) }));
  res.json(mapped);
}));
app.post('/api/admin/staff', requirePerm('staff.manage'), wrap(async (req, res) => {
  const { full_name, email, role, trainer_id, password } = req.body;
  if (!full_name || !email || !role) return res.status(400).json({ error: 'full_name, email, role required' });
  if (!['ADMIN', 'MANAGER', 'STAFF', 'TRAINER'].includes(String(role).toUpperCase())) return res.status(400).json({ error: 'Invalid role' });
  const normEmail = String(email).trim().toLowerCase();
  // 1) create the Supabase Auth login (id is a FK on staff_profiles -> auth.users)
  const { data: au, error: auErr } = await authSupabase.auth.admin.createUser({
    email: normEmail, password: password || undefined, email_confirm: true
  });
  if (auErr) return res.status(400).json({ error: 'Could not create login: ' + auErr.message });
  // 2) create the staff profile linked to that auth user
  const { data, error } = await supabase.from('staff_profiles').insert({
    id: au.user.id, full_name: String(full_name).trim(), email: normEmail,
    role: storeRole(role), trainer_id: trainer_id || null, is_active: true
  }).select().single();
  if (error) return res.status(400).json({ error: 'Staff could not be created (email may exist)' });
  await audit(req.actor, 'Created staff', 'staff', data.id, { email: data.email, role: data.role });
  res.status(201).json({ ...data, role: normalizeRole(data.role) });
}));
app.put('/api/admin/staff/:id', requirePerm('staff.manage'), wrap(async (req, res) => {
  const { full_name, role, active, trainer_id } = req.body;
  const update = {};
  if (full_name !== undefined) update.full_name = String(full_name).trim();
  if (role !== undefined) { if (!['ADMIN', 'MANAGER', 'STAFF', 'TRAINER'].includes(String(role).toUpperCase())) return res.status(400).json({ error: 'Invalid role' }); update.role = storeRole(role); }
  if (active !== undefined) update.is_active = !!active;
  if (trainer_id !== undefined) update.trainer_id = trainer_id;
  const { data, error } = await supabase.from('staff_profiles').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Staff not found' });
  await audit(req.actor, 'Changed staff', 'staff', req.params.id, { email: data.email, role: data.role });
  res.json({ ...data, role: normalizeRole(data.role) });
}));
app.delete('/api/admin/staff/:id', requirePerm('staff.manage'), wrap(async (req, res) => {
  await supabase.from('staff_profiles').update({ is_active: false }).eq('id', req.params.id);
  await audit(req.actor, 'Disabled staff', 'staff', req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// ATTENDANCE
// ---------------------------------------------------------------------------
app.get('/api/admin/attendance', requirePerm('attendance.view'), wrap(async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const date = req.query.date; // YYYY-MM-DD
  const status = req.query.status;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  let query = supabase.from('attendance').select('*', { count: 'exact' }).order('entry_time', { ascending: false });
  if (q) query = query.or(`member_name.ilike.%${q}%,member_email.ilike.%${q}%`);
  if (status) query = query.eq('status', status.toUpperCase());
  if (date) { const d0 = new Date(date + 'T00:00:00'); const d1 = new Date(date + 'T23:59:59'); query = query.gte('entry_time', d0.toISOString()).lte('entry_time', d1.toISOString()); }
  const { data, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  res.json({ data: data || [], total: count || 0, page, pageSize });
}));

// ---------------------------------------------------------------------------
// ACCESS CONTROL: devices, logs, biometric, manual override
// ---------------------------------------------------------------------------
app.get('/api/admin/access/devices', requirePerm('access.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('access_devices').select('*').order('created_at');
  res.json(data || []);
}));
app.post('/api/admin/access/devices', requirePerm('access.manage'), wrap(async (req, res) => {
  const { name, location, identifier, status } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabase.from('access_devices').insert({ name: String(name).trim(), location: location || null, identifier: identifier || null, status: status || 'ONLINE', last_heartbeat: new Date().toISOString() }).select().single();
  if (error) throw error;
  await audit(req.actor, 'Added device', 'device', data.id, { name: data.name });
  res.status(201).json(data);
}));
app.put('/api/admin/access/devices/:id', requirePerm('access.manage'), wrap(async (req, res) => {
  const update = {};
  ['name', 'location', 'identifier', 'status'].forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const { data, error } = await supabase.from('access_devices').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Device not found' });
  await audit(req.actor, 'Edited device', 'device', req.params.id, { name: data.name });
  res.json(data);
}));
app.delete('/api/admin/access/devices/:id', requirePerm('access.manage'), wrap(async (req, res) => {
  await supabase.from('access_devices').update({ status: 'DISABLED' }).eq('id', req.params.id);
  await audit(req.actor, 'Disabled device', 'device', req.params.id);
  res.json({ ok: true });
}));

app.get('/api/admin/access/logs', requirePerm('access.view'), wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  let query = supabase.from('access_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (req.query.status) query = query.eq('status', req.query.status.toUpperCase());
  if (req.query.date) { const d0 = new Date(req.query.date + 'T00:00:00'); const d1 = new Date(req.query.date + 'T23:59:59'); query = query.gte('created_at', d0.toISOString()).lte('created_at', d1.toISOString()); }
  const { data, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  res.json({ data: data || [], total: count || 0, page, pageSize });
}));

app.get('/api/admin/access/overview', requirePerm('access.view'), wrap(async (req, res) => {
  const { data: devices } = await supabase.from('access_devices').select('*');
  const m0 = new Date(); m0.setHours(0, 0, 0, 0);
  const { data: today } = await supabase.from('access_logs').select('*').gte('created_at', m0.toISOString()).order('created_at', { ascending: false }).limit(200);
  const granted = (today || []).filter(l => l.status === 'GRANTED').length;
  const denied = (today || []).filter(l => l.status === 'DENIED').length;
  res.json({ devices: devices || [], todayEntries: granted, todayDenied: denied, currentlyInside: granted, recent: (today || []).slice(0, 10) });
}));

app.get('/api/admin/biometric', requirePerm('access.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('biometric_members').select('*').order('registered_at', { ascending: true });
  const lk = await buildLookup();
  res.json((data || []).map(b => {
    const member = lookupMember(lk, b.member_email, b.member_id) || {};
    return {
      ...b,
      member_name: member.full_name || (b.member_email ? String(b.member_email).split('@')[0] : null),
      member_email: member.email || b.member_email || null
    };
  }));
}));
app.post('/api/admin/biometric', requirePerm('biometric.manage'), wrap(async (req, res) => {
  const { member_email, device_id, device_user_id } = req.body;
  if (!member_email || !device_user_id) return res.status(400).json({ error: 'member_email and device_user_id required' });
  const existing = (await supabase.from('biometric_members').select('id').ilike('member_email', member_email)).data;
  if (existing && existing.length) {
    const { data, error } = await supabase.from('biometric_members').update({ status: 'REGISTERED', device_id: device_id || null, device_user_id: String(device_user_id), registered_at: new Date().toISOString() }).ilike('member_email', member_email).select().single();
    if (error) throw error;
    await audit(req.actor, 'Registered biometric', 'biometric', member_email, { member_email });
    return res.json(data);
  }
  const { data, error } = await supabase.from('biometric_members').insert({ member_email: String(member_email).toLowerCase(), device_id: device_id || null, device_user_id: String(device_user_id), status: 'REGISTERED', registered_at: new Date().toISOString() }).select().single();
  if (error) throw error;
  await audit(req.actor, 'Registered biometric', 'biometric', member_email, { member_email });
  res.status(201).json(data);
}));
app.post('/api/admin/biometric/:id/disable', requirePerm('biometric.manage'), wrap(async (req, res) => {
  await supabase.from('biometric_members').update({ status: 'DISABLED' }).eq('id', req.params.id);
  await audit(req.actor, 'Disabled biometric access', 'biometric', req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/admin/biometric/:id', requirePerm('biometric.manage'), wrap(async (req, res) => {
  await supabase.from('biometric_members').delete().eq('id', req.params.id);
  await audit(req.actor, 'Removed biometric access', 'biometric', req.params.id);
  res.json({ ok: true });
}));

// Manual access override — requires authorized staff, reason, member, timestamp.
app.post('/api/admin/access/manual', requirePerm('access.manage'), wrap(async (req, res) => {
  const { member_email, reason } = req.body;
  if (!member_email || !reason) return res.status(400).json({ error: 'member_email and reason required' });
  const decision = await evaluateAccess({ memberEmail: member_email });
  await recordAttempt({ memberEmail: member_email, memberName: decision.member ? decision.member.name : null, deviceId: null, accessMethod: 'manual', status: decision.granted ? 'GRANTED' : 'DENIED', reason: decision.granted ? ('Manual grant: ' + reason) : decision.reason });
  await audit(req.actor, 'Manual access override', 'attendance', member_email, { reason, result: decision.status });
  res.json({ ok: true, result: decision.status, reason: decision.reason });
}));

// ---------------------------------------------------------------------------
// WORKOUTS
// ---------------------------------------------------------------------------
app.get('/api/admin/workouts', requirePerm('workouts.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('workout_sessions').select('*').order('completed_at', { ascending: false }).limit(300);
  const lk = await buildLookup();
  res.json((data || []).map(w => decorateWorkout(w, lk)));
}));
app.post('/api/admin/workouts', requirePerm('workouts.manage'), wrap(async (req, res) => {
  const { member_email, member_id, trainer_id, date, exercise, session_type, notes } = req.body;
  if (!member_email && !member_id) return res.status(400).json({ error: 'member_email or member_id required' });
  let mid = member_id || null;
  if (!mid) { const { data: mb } = await supabase.from('members').select('id').ilike('email', String(member_email).toLowerCase()).maybeSingle(); mid = mb ? mb.id : null; }
  if (!mid) return res.status(400).json({ error: 'Member not found' });
  const { data, error } = await supabase.from('workout_sessions').insert({
    member_id: mid, trainer_id: trainer_id || null,
    session_type: String(session_type || exercise || 'Gym').slice(0, 200),
    notes: notes || '',     completed_at: date || new Date().toISOString(),
    created_by: actorId(req.actor)
  }).select().single();
  if (error) throw error;
  await audit(req.actor, 'Created workout', 'workout', data.id, { member_email: member_email || mid, session_type: data.session_type });
  res.status(201).json(data);
}));
app.delete('/api/admin/workouts/:id', requirePerm('workouts.manage'), wrap(async (req, res) => {
  await supabase.from('workout_sessions').delete().eq('id', req.params.id);
  await audit(req.actor, 'Deleted workout', 'workout', req.params.id);
  res.json({ ok: true });
}));

// Trainer-scoped workouts (only assigned members)
app.get('/api/trainer/workouts', requirePerm('workouts.manage'), wrap(async (req, res) => {
  if (req.actor.role === 'TRAINER' && !req.actor.trainer_id) return res.json([]);
  const { data } = await supabase.from('workout_sessions').select('*').eq('trainer_id', req.actor.trainer_id).order('completed_at', { ascending: false }).limit(300);
  const lk = await buildLookup();
  res.json((data || []).map(w => decorateWorkout(w, lk)));
}));

// ---------------------------------------------------------------------------
// PROGRESS
// ---------------------------------------------------------------------------
app.get('/api/admin/progress', requirePerm('progress.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('progress_records').select('*').order('recorded_at', { ascending: false }).limit(300);
  const lk = await buildLookup();
  res.json((data || []).map(p => decorateProgress(p, lk)));
}));
app.post('/api/admin/progress', requirePerm('progress.manage'), wrap(async (req, res) => {
  const { member_email, member_id, recorded_date, recorded_at, weight, body_fat, muscle_mass, notes } = req.body;
  if (!member_email && !member_id) return res.status(400).json({ error: 'member_email or member_id required' });
  let mid = member_id || null;
  if (!mid) { const { data: mb } = await supabase.from('members').select('id').ilike('email', String(member_email).toLowerCase()).maybeSingle(); mid = mb ? mb.id : null; }
  if (!mid) return res.status(400).json({ error: 'Member not found' });
  const { data, error } = await supabase.from('progress_records').insert({
    member_id: mid, weight: weight != null ? Number(weight) : null,
    body_fat: body_fat != null ? Number(body_fat) : null, muscle_mass: muscle_mass != null ? Number(muscle_mass) : null,
    notes: notes || '',     recorded_at: recorded_at || (recorded_date ? new Date(recorded_date).toISOString() : new Date().toISOString()),
    recorded_by: actorId(req.actor)
  }).select().single();
  if (error) throw error;
  await audit(req.actor, 'Created progress record', 'progress', data.id, { member_email: member_email || mid });
  res.status(201).json(data);
}));
app.delete('/api/admin/progress/:id', requirePerm('progress.manage'), wrap(async (req, res) => {
  await supabase.from('progress_records').delete().eq('id', req.params.id);
  await audit(req.actor, 'Deleted progress record', 'progress', req.params.id);
  res.json({ ok: true });
}));

app.get('/api/trainer/progress', requirePerm('progress.manage'), wrap(async (req, res) => {
  if (req.actor.role === 'TRAINER' && !req.actor.trainer_id) return res.json([]);
  const { data: mems } = await supabase.from('memberships').select('member_id').eq('trainer_id', req.actor.trainer_id);
  const ids = [...new Set((mems || []).map(m => m.member_id).filter(Boolean))];
  let out = [];
  if (ids.length) { const { data } = await supabase.from('progress_records').select('*').in('member_id', ids).order('recorded_at', { ascending: false }).limit(300); out = data || []; }
  const lk = await buildLookup();
  res.json(out.map(p => decorateProgress(p, lk)));
}));

// ---------------------------------------------------------------------------
// CONTENT: gallery, transformations, enquiries
// ---------------------------------------------------------------------------
app.get('/api/admin/gallery', requirePerm('gallery.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('media_assets').select('*').order('created_at', { ascending: false });
  res.json(data || []);
}));
app.post('/api/admin/gallery', requirePerm('gallery.manage'), wrap(async (req, res) => {
  const { category, bucket_path, url, public_url, title, alt_text, media_type } = req.body;
  const u = url || public_url;
  if (!u) return res.status(400).json({ error: 'url (or public_url) required' });
  const { data, error } = await supabase.from('media_assets').insert({
    bucket_path: bucket_path || 'external/' + uuid(), public_url: u, media_type: media_type || 'image',
    title: title || '', alt_text: alt_text || null, category: category || 'Gym',
    is_public: true, created_by: actorId(req.actor), created_at: new Date().toISOString()
  }).select().single();
  if (error) throw error;
  await audit(req.actor, 'Added media', 'media', data.id, { category });
  res.status(201).json(data);
}));
app.put('/api/admin/gallery/:id', requirePerm('gallery.manage'), wrap(async (req, res) => {
  const update = {};
  if (req.body.title !== undefined) update.title = req.body.title;
  if (req.body.alt_text !== undefined) update.alt_text = req.body.alt_text;
  if (req.body.category !== undefined) update.category = req.body.category;
  if (req.body.bucket_path !== undefined) update.bucket_path = req.body.bucket_path;
  if (req.body.public_url !== undefined) update.public_url = req.body.public_url;
  if (req.body.is_public !== undefined) update.is_public = !!req.body.is_public;
  const { data, error } = await supabase.from('media_assets').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Media not found' });
  res.json(data);
}));
app.delete('/api/admin/gallery/:id', requirePerm('gallery.manage'), wrap(async (req, res) => {
  await supabase.from('media_assets').delete().eq('id', req.params.id);
  await audit(req.actor, 'Deleted media', 'media', req.params.id);
  res.json({ ok: true });
}));

// Generic admin image upload → returns a public URL. Used for trainer photos,
// transformation before/after images and settings logo/hero. Bucket is chosen by
// the client (`bucket`), defaulting to `gallery`.
app.post('/api/admin/upload', requirePerm('gallery.manage'), wrap(async (req, res) => {
  const { dataUrl, bucket } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (m) {
    const mime = m[1].toLowerCase();
    if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Unsupported file type: ' + m[1] + '. Please upload an image (JPEG, PNG, WEBP, GIF, HEIC, AVIF, SVG).' });
  }
  let mimeType = m ? m[1].toLowerCase() : 'image/png';
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  const buf = Buffer.from(m ? m[2] : dataUrl.replace(/^data:.*;base64,/, ''), 'base64');
  if (!buf.length || buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5MB)' });
  const bkt = await ensureBucket(bucket || 'gallery');
  const fileName = bkt + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.img';
  let url;
  try {
    const { error } = await supabase.storage.from(bkt).upload(fileName, buf, { contentType: mimeType, upsert: false });
    if (error) throw error;
    const { data: pub } = supabase.storage.from(bkt).getPublicUrl(fileName);
    url = pub.publicUrl;
  } catch (e) {
    return res.status(400).json({ error: 'Image upload failed: ' + (e.message || 'unknown error') + '. Create a public Storage bucket named "' + bkt + '" or check storage permissions.' });
  }
  res.status(201).json({ url });
}));

// Gallery image upload (Supabase Storage)
app.post('/api/admin/gallery/upload', requirePerm('gallery.manage'), wrap(async (req, res) => {
  const { category, name, dataUrl } = req.body;
  if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (m) {
    const mime = m[1].toLowerCase();
    if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Unsupported file type: ' + m[1] + '. Please upload an image (JPEG, PNG, WEBP, GIF, HEIC, AVIF, SVG).' });
  }
  let mimeType = m ? m[1].toLowerCase() : 'image/png';
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  const buf = Buffer.from(m ? m[2] : dataUrl.replace(/^data:.*;base64,/, ''), 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5MB)' });
  const fileName = 'gallery/' + Date.now() + '-' + (name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  let upErr;
  try {
    await ensureBucket('gallery');
    const { error } = await supabase.storage.from('gallery').upload(fileName, buf, { contentType: mimeType, upsert: false });
    upErr = error;
  } catch (e) { upErr = e; }
  if (upErr) return res.status(500).json({ error: 'Upload failed: ' + (upErr.message || 'unknown error') + '. Create a public Storage bucket named "gallery" or check storage permissions.' });
  const { data: pub } = supabase.storage.from('gallery').getPublicUrl(fileName);
  const { data: asset, error: ie } = await supabase.from('media_assets').insert({
    bucket_path: fileName, public_url: pub.publicUrl, media_type: 'image', title: name || '',
    category: category || 'Gym', is_public: true, created_by: actorId(req.actor),
    created_at: new Date().toISOString()
  }).select().single();
  if (ie) throw ie;
  await audit(req.actor, 'Uploaded image', 'media', asset.id, { category });
  res.status(201).json(asset);
}));

app.get('/api/admin/transformations', requirePerm('transformations.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('transformations').select('*').order('created_at', { ascending: false });
  const lk = await buildLookup();
  res.json((data || []).map(t => {
    const member = (t.member_id && lk && lk.byId.get(t.member_id)) || {};
    return { ...t, member_name: member.full_name || String(t.member_email || 'Unknown').split('@')[0] || 'Unknown' };
  }));
}));
app.post('/api/admin/transformations', requirePerm('transformations.manage'), wrap(async (req, res) => {
  const { member_name, member_email, before_image, after_image, before_image_url, after_image_url, goal, duration, achievement, description, testimonial, title, status, consent_given } = req.body;
  const t = title || member_name || description;
  if (!t && !member_name) return res.status(400).json({ error: 'title (or member_name) required' });
  let member_id = null;
  if (member_name) {
    const { data: mb } = await supabase.from('members').select('id').ilike('full_name', '%' + member_name + '%').maybeSingle().catch(() => ({ data: null }));
    if (mb) member_id = mb.id;
  }
  if (member_email) { const { data: mb } = await supabase.from('members').select('id').ilike('email', String(member_email).toLowerCase()).maybeSingle(); if (mb) member_id = mb.id; }
  const { data, error } = await supabase.from('transformations').insert({
    member_id: member_id || null, title: String(t || '').trim(), goal: goal || '',
    duration: duration || '', achievement: achievement || description || '',
    testimonial: testimonial || '', before_image_url: before_image_url || before_image || null,
    after_image_url: after_image_url || after_image || null, consent_given: consent_given !== false,
    is_published: (status || 'DRAFT').toUpperCase() === 'PUBLISHED', status: (status || 'DRAFT').toUpperCase(),
    sort_order: 0, created_at: new Date().toISOString()
  }).select().single();
  if (error) throw error;
  await audit(req.actor, 'Created transformation', 'transformation', data.id, { title: data.title });
  res.status(201).json(data);
}));
app.put('/api/admin/transformations/:id', requirePerm('transformations.manage'), wrap(async (req, res) => {
  const update = {};
  ['title', 'goal', 'duration', 'achievement', 'description', 'testimonial', 'status', 'consent_given', 'sort_order'].forEach(k => { if (req.body[k] !== undefined) update[k] = k === 'consent_given' ? !!req.body[k] : (k === 'sort_order' ? Number(req.body[k]) : req.body[k]); });
  if (req.body.before_image_url !== undefined) update.before_image_url = req.body.before_image_url;
  if (req.body.after_image_url !== undefined) update.after_image_url = req.body.after_image_url;
  if (req.body.is_published !== undefined) update.is_published = !!req.body.is_published;
  if (req.body.status !== undefined) update.is_published = String(req.body.status).toUpperCase() === 'PUBLISHED';
  const { data, error } = await supabase.from('transformations').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Not found' });
  await audit(req.actor, 'Edited transformation', 'transformation', req.params.id);
  res.json(data);
}));
app.delete('/api/admin/transformations/:id', requirePerm('transformations.manage'), wrap(async (req, res) => {
  await supabase.from('transformations').update({ status: 'ARCHIVED', is_published: false }).eq('id', req.params.id);
  await audit(req.actor, 'Archived transformation', 'transformation', req.params.id);
  res.json({ ok: true });
}));

app.get('/api/admin/enquiries', requirePerm('enquiries.view'), wrap(async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const status = req.query.status;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '15', 10)));
  let query = supabase.from('enquiries').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  if (status) query = query.eq('status', status.toUpperCase());
  const { data, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  res.json({ data: data || [], total: count || 0, page, pageSize });
}));
app.put('/api/admin/enquiries/:id', requirePerm('enquiries.manage'), wrap(async (req, res) => {
  const update = {};
  if (req.body.status !== undefined) update.status = req.body.status;
  if (req.body.handled_by !== undefined) update.handled_by = String(req.body.handled_by).slice(0, 200);
  const { data, error } = await supabase.from('enquiries').update(update).eq('id', req.params.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Enquiry not found' });
  await audit(req.actor, 'Updated enquiry', 'enquiry', req.params.id, { status: data.status });
  res.json(data);
}));
app.delete('/api/admin/enquiries/:id', requirePerm('enquiries.manage'), wrap(async (req, res) => {
  const { error } = await supabase.from('enquiries').delete().eq('id', req.params.id);
  if (error) return res.status(404).json({ error: 'Enquiry not found' });
  await audit(req.actor, 'Deleted enquiry', 'enquiry', req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------
app.get('/api/admin/notifications', requirePerm('notifications.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
}));
app.post('/api/admin/notifications/:id/read', requirePerm('notifications.manage'), wrap(async (req, res) => {
  await supabase.from('notifications').update({ read: true }).eq('id', req.params.id);
  res.json({ ok: true });
}));
// auto-generate notifications on access (dashboard/notifications page can call)
app.post('/api/admin/notifications/refresh', requirePerm('notifications.manage'), wrap(async (req, res) => {
  await syncNotifications();
  res.json({ ok: true });
}));

async function syncNotifications() {
  try {
    const m0 = new Date(); m0.setHours(0, 0, 0, 0);
    const lk = await buildLookup();
    const { data: mems } = await supabase.from('memberships').select('*').order('created_at', { ascending: false });
    const memList = (mems || []).map(m => fmtMembership(m, lk));
    const { data: existing } = await supabase.from('notifications').select('title');
    const existingTitles = new Set((existing || []).map(n => n.title));
    const expiring = memList.filter(m => m.status === 'ACTIVE' && m.daysRemaining <= 7 && m.daysRemaining >= 0);
    for (const m of expiring) {
      const title = `Membership expiring — ${m.member.name}`;
      if (!existingTitles.has(title)) {
        await supabase.from('notifications').insert({ type: 'MEMBERSHIP_EXPIRING', title, message: `${m.planName} expires on ${m.expires} (${m.daysRemaining}d left).`, related_id: m.member.email });
      }
    }
    const { data: paysToday } = await supabase.from('payments').select('*').gte('created_at', m0.toISOString());
    const { data: enqs } = await supabase.from('enquiries').select('*').gte('created_at', m0.toISOString()).eq('status', 'NEW');
    const { data: att } = await supabase.from('access_logs').select('*').gte('created_at', m0.toISOString()).eq('status', 'DENIED');
    const memberNameFor = (pa) => {
      const mb = lk.byId.get(pa.member_id);
      return mb ? mb.full_name : ((lk.byEmail.get((pa.member_email || '').toLowerCase())) ? lk.byEmail.get((pa.member_email || '').toLowerCase()).full_name : 'Member');
    };
    for (const p of (paysToday || []).filter(x => x.status === 'PAID').slice(0, 10)) { const t = `Payment received — ${memberNameFor(p)}`; if (!existingTitles.has(t)) await supabase.from('notifications').insert({ type: 'PAYMENT_RECEIVED', title: t, message: `₹${p.amount} paid.`, related_id: p.member_id || p.reference }); }
    for (const p of (paysToday || []).filter(x => x.status === 'FAILED').slice(0, 10)) { const t = `Payment failed — ${memberNameFor(p)}`; if (!existingTitles.has(t)) await supabase.from('notifications').insert({ type: 'PAYMENT_FAILED', title: t, message: `₹${p.amount} payment failed.`, related_id: p.member_id || p.reference }); }
    for (const e of (enqs || []).slice(0, 10)) { const t = `New enquiry — ${e.name}`; if (!existingTitles.has(t)) await supabase.from('notifications').insert({ type: 'NEW_ENQUIRY', title: t, message: e.message, related_id: e.id }); }
    for (const a of (att || []).slice(0, 10)) { const t = `Access denied — ${a.member_name || 'Unknown'}`; if (!existingTitles.has(t)) await supabase.from('notifications').insert({ type: 'ACCESS_DENIED', title: t, message: a.reason || 'Access denied', related_id: a.member_email }); }
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
app.get('/api/admin/settings', requirePerm('settings.view'), wrap(async (req, res) => {
  const { data } = await supabase.from('gym_settings').select('*').eq('id', 1).maybeSingle();
  res.json(data || { id: 1 });
}));
app.put('/api/admin/settings', requirePerm('settings.manage'), wrap(async (req, res) => {
  const allowed = ['gym_name', 'logo', 'tagline', 'description', 'phone', 'email', 'address', 'opening_hours', 'whatsapp', 'instagram', 'facebook', 'youtube', 'google_maps', 'hero_text', 'cta_text'];
  const update = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = String(req.body[k]); });
  const { data, error } = await supabase.from('gym_settings').update(update).eq('id', 1).select().single();
  if (error) throw error;
  await audit(req.actor, 'Changed settings', 'settings', '1', {});
  res.json(data);
}));

// ---------------------------------------------------------------------------
// AUDIT LOGS
// ---------------------------------------------------------------------------
app.get('/api/admin/audit', requirePerm('audit.view'), wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  const q = String(req.query.q || '').toLowerCase();
  let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (q) query = query.or(`action.ilike.%${q}%,actor_email.ilike.%${q}%,entity.ilike.%${q}%`);
  const { data, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  res.json({ data: data || [], total: count || 0, page, pageSize });
}));

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------
app.get('/api/admin/reports', requirePerm('reports.view'), wrap(async (req, res) => {
  const type = String(req.query.type || 'member');
  const from = req.query.from, to = req.query.to;
  const mk = v => ({ data: v });
  if (type === 'member') {
    const lk = await buildLookup();
    const { data } = await supabase.from('memberships').select('*');
    const members = aggregateMembers(data || [], lk);
    const fromD = from ? new Date(from + 'T00:00:00') : new Date(0);
    const toD = to ? new Date(to + 'T23:59:59') : new Date(8640000000000000);
    const inRange = m => m.created_at && new Date(m.created_at) >= fromD && (m.created_at ? new Date(m.created_at) <= toD : true);
    const newMembers = members.filter(m => inRange(m));
    return res.json({ totalMembers: members.length, newMembers: newMembers.length, activeMembers: members.filter(m => m.status === 'ACTIVE').length, expiredMembers: members.filter(m => m.status === 'EXPIRED' || (m.expires && daysRemaining(m.expires) < 0)).length, rows: members.slice(0, 200).map(m => ({ name: m.name, email: m.email, phone: m.phone, plan: m.plan, status: m.status, expires: m.expires, created: m.created_at })) });
  }
  if (type === 'membership') {
    const lk = await buildLookup();
    const { data } = await supabase.from('memberships').select('*');
    const list = (data || []).map(m => fmtMembership(m, lk));
    const activePlans = {};
    list.forEach(m => {
      const k = m.planName || 'Other';
      const cur = activePlans[k] || { plan: k, count: 0, revenue: 0 };
      cur.count++;
      if (m.status === 'ACTIVE') cur.active = (cur.active || 0) + 1;
      cur.revenue += m.price || 0;
      activePlans[k] = cur;
    });
    return res.json({ total: list.length, active: list.filter(m => m.status === 'ACTIVE').length, pending: list.filter(m => m.status === 'PENDING').length, expired: list.filter(m => m.status === 'EXPIRED').length, cancelled: list.filter(m => m.status === 'CANCELLED').length, byPlan: Object.values(activePlans), renewals: list.filter(m => m.created_by === 'admin_renew').length, rows: list.slice(0, 200) });
  }
  if (type === 'revenue') {
    let q = supabase.from('payments').select('amount, status, created_at');
    if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
    if (to) q = q.lte('created_at', new Date(to + 'T23:59:59').toISOString());
    const { data } = await q;
    const paid = (data || []).filter(p => p.status === 'PAID');
    const daily = {};
    paid.forEach(p => { const k = (p.created_at || '').slice(0, 10); daily[k] = (daily[k] || 0) + (p.amount || 0); });
    const total = paid.reduce((s, p) => s + (p.amount || 0), 0);
    return res.json({ total, count: paid.length, pending: (data || []).filter(p => p.status === 'PENDING').length, failed: (data || []).filter(p => p.status === 'FAILED').length, refunded: (data || []).filter(p => p.status === 'REFUNDED').length, daily });
  }
  if (type === 'attendance') {
    let q = supabase.from('attendance').select('*');
    if (from) q = q.gte('entry_time', new Date(from + 'T00:00:00').toISOString());
    if (to) q = q.lte('entry_time', new Date(to + 'T23:59:59').toISOString());
    const { data } = await q;
    const list = data || [];
    const daily = {};
    const hourly = {};
    list.forEach(a => {
      const d = (a.entry_time || '').slice(0, 10);
      daily[d] = (daily[d] || 0) + 1;
      const h = new Date(a.entry_time).getHours();
      hourly[h] = (hourly[h] || 0) + 1;
    });
    const uniqueMembers = new Set(list.filter(a => a.status === 'GRANTED').map(a => a.member_email)).size;
    return res.json({ total: list.length, granted: list.filter(a => a.status === 'GRANTED').length, denied: list.filter(a => a.status === 'DENIED').length, uniqueMembers, daily, hourly });
  }
  if (type === 'access') {
    let q = supabase.from('access_logs').select('*');
    if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
    if (to) q = q.lte('created_at', new Date(to + 'T23:59:59').toISOString());
    const { data } = await q;
    const list = data || [];
    const granted = list.filter(l => l.status === 'GRANTED').length;
    const denied = list.filter(l => l.status === 'DENIED');
    const deniedReasons = {};
    denied.forEach(d => { const r = d.reason || 'Other'; deniedReasons[r] = (deniedReasons[r] || 0) + 1; });
    const deviceActivity = {};
    list.forEach(l => { const d = l.device_name || 'Unknown'; deviceActivity[d] = (deviceActivity[d] || 0) + 1; });
    return res.json({ total: list.length, granted, denied: denied.length, deniedReasons, deviceActivity });
  }
  if (type === 'trainer') {
    const { data: trainers } = await supabase.from('trainers').select('*');
    const { data: mems } = await supabase.from('memberships').select('trainer_id, member_id, member_email');
    const { data: workouts } = await supabase.from('workout_sessions').select('trainer_id');
    const { data: progress } = await supabase.from('progress_records').select('member_id');
    const assignedIdsByTrainer = new Map();
    (mems || []).forEach(m => { if (m.trainer_id) { if (!assignedIdsByTrainer.has(m.trainer_id)) assignedIdsByTrainer.set(m.trainer_id, new Set()); assignedIdsByTrainer.get(m.trainer_id).add(m.member_id); } });
    const progressByMember = new Map();
    (progress || []).forEach(p => { if (p.member_id) progressByMember.set(p.member_id, (progressByMember.get(p.member_id) || 0) + 1); });
    const rows = (trainers || []).map(t => {
      const ids = assignedIdsByTrainer.get(t.id) || new Set();
      let progressRecords = 0;
      ids.forEach(id => { progressRecords += (progressByMember.get(id) || 0); });
      return { id: t.id, name: t.name, specialization: t.role, status: t.status, assignedMembers: ids.size, workoutSessions: (workouts || []).filter(w => w.trainer_id === t.id).length, progressRecords };
    });
    return res.json(rows);
  }
  return res.status(400).json({ error: 'Unknown report type' });
}));

app.get('/api/admin/reports/export', requirePerm('reports.view'), (req, res) => {
  // Export is implemented client-side via the populated /api/admin/reports data
  // so role permissions are respected (reports.view required above).
  res.json({ error: 'Use report data + client CSV', hint: true });
});

// ---------------------------------------------------------------------------
// SPA fallback (also serves the admin app at /admin with clean URLs)
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  const isAdmin = /^\/admin(\/|$)/.test(req.path);
  const names = isAdmin ? ['admin.html'] : ['index.html'];
  for (const dir of [frontendPath, publicPath]) {
    for (const n of names) {
      const c = path.join(dir, n);
      if (fs.existsSync(c)) return res.sendFile(c);
    }
  }
  res.status(404).send('Frontend not found');
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`\n🏋️ SKYFIT ZONE API running on http://localhost:${PORT}\n`));
}

module.exports = app;
