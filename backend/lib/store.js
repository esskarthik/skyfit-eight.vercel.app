// backend/lib/store.js
// Shared DB helpers: pagination, audit logging, safe error handling.
const { sb } = require('./rbac');

function db() { return sb(); }

// Sanitize an object so we NEVER log secrets/tokens/biometrics/passwords.
function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  const BLOCK = ['password', 'token', 'secret', 'key', 'razorpay_secret', 'service_role', 'webhook_secret', 'access_token', 'refresh_token', 'biometric', 'template', 'cvv', 'card'];
  for (const k of Object.keys(obj)) {
    const lk = String(k).toLowerCase();
    if (BLOCK.some(b => lk.includes(b))) { out[k] = '[REDACTED]'; continue; }
    const v = obj[k];
    if (typeof v === 'object' && v !== null) out[k] = sanitize(v);
    else out[k] = v;
  }
  return out;
}

// Write an audit entry. Never throws.
async function audit(actor, action, entity, entityId, details) {
  try {
    await db().from('audit_logs').insert({
      actor_email: actor ? actor.email : 'system',
      actor_role: actor ? actor.role : 'system',
      action, entity, entity_id: String(entityId || ''),
      details: sanitize(details || {})
    });
  } catch (e) { /* audit failure must not break the request */ }
}

// Server-side pagination helper for Supabase selects.
// Returns { data, total, page, pageSize }.
async function paginate(table, selectStr, filters, { page = 1, pageSize = 20, orderBy = 'created_at', ascending = false } = {}) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let q = db().from(table).select(selectStr, { count: 'exact' });
  for (const [col, val] of Object.entries(filters || {})) {
    if (val === undefined || val === null || val === '') continue;
    if (Array.isArray(val)) q = q.in(col, val);
    else if (typeof val === 'object') q = q.filter(col, val.op, val.val);
    else q = q.eq(col, val);
  }
  const { data, error, count } = await q.order(orderBy, { ascending }).range(from, to);
  if (error) throw error;
  return { data: data || [], total: count || 0, page, pageSize };
}

// Wrap async route handlers and produce safe error responses.
function wrap(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch(err => {
    const msg = (err && err.message) ? err.message : 'Internal error';
    // Never leak SQL/internal detail to the client.
    res.status(500).json({ error: 'Request failed. Please retry or contact support.' });
    console.error('[admin]', msg);
  });
}

module.exports = { db, audit, paginate, wrap, sanitize };
