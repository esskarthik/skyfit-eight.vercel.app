// backend/lib/rbac.js
// Role-based access control for the SKYFIT ZONE admin platform.
// Authorization is ENFORCED SERVER-SIDE here (RLS is defense-in-depth only,
// because the server connects with the service_role key which bypasses RLS).
const { createClient } = require('@supabase/supabase-js');

const ROLE_RANK = { TRAINER: 1, STAFF: 2, MANAGER: 3, ADMIN: 4 };

// Minimum role required for each permission.
// NOTE: fine-grained data scoping (e.g. a TRAINER only sees assigned members)
// is enforced inside each route handler in addition to this gate.
const PERMS = {
  'dashboard.view': 'STAFF',
  'members.view': 'STAFF',
  'members.manage': 'STAFF',
  'memberships.view': 'STAFF',
  'memberships.manage': 'MANAGER',
  'plans.view': 'STAFF',
  'plans.manage': 'ADMIN',
  'payments.view': 'STAFF',
  'payments.manage': 'ADMIN',
  'services.view': 'STAFF',
  'services.manage': 'MANAGER',
  'supplements.view': 'STAFF',
  'supplements.manage': 'MANAGER',
  'trainers.view': 'STAFF',
  'trainers.manage': 'MANAGER',
  'staff.view': 'MANAGER',
  'staff.manage': 'ADMIN',
  'attendance.view': 'STAFF',
  'attendance.manage': 'STAFF',
  'access.view': 'STAFF',
  'access.manage': 'MANAGER',
  'biometric.manage': 'MANAGER',
  'workouts.view': 'STAFF',
  'workouts.manage': 'TRAINER',
  'progress.view': 'STAFF',
  'progress.manage': 'TRAINER',
  'gallery.view': 'STAFF',
  'gallery.manage': 'MANAGER',
  'transformations.view': 'STAFF',
  'transformations.manage': 'MANAGER',
  'enquiries.view': 'STAFF',
  'enquiries.manage': 'STAFF',
  'reports.view': 'STAFF',
  'announcements.view': 'STAFF',
  'announcements.manage': 'MANAGER',
  'notifications.view': 'STAFF',
  'notifications.manage': 'MANAGER',
  'settings.view': 'STAFF',
  'settings.manage': 'ADMIN',
  'audit.view': 'MANAGER',
  'audit.manage': 'ADMIN'
};

let _sb = null;
function sb() {
  if (!_sb) _sb = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '');
  return _sb;
}

function rank(role) { return ROLE_RANK[role] || 0; }
function roleSatisfies(role, minRole) { return rank(role) >= rank(minRole); }

// Normalize role values stored in the DB to the uppercase roles the app uses.
// The live staff_profiles table stores lowercase roles (admin/owner/manager/
// staff/trainer), while ROLE_RANK/PERMS/UI expect ADMIN/STAFF/MANAGER/TRAINER.
const NORMALIZE_ROLE = {
  'admin': 'ADMIN', 'owner': 'ADMIN', 'manager': 'MANAGER',
  'staff': 'STAFF', 'trainer': 'TRAINER'
};
function normalizeRole(r) { return NORMALIZE_ROLE[String(r || '').toLowerCase()] || String(r || '').toUpperCase(); }
// Convert an app role (uppercase) to the lowercase value stored in the DB.
const STORE_ROLE = { 'ADMIN': 'admin', 'MANAGER': 'manager', 'STAFF': 'staff', 'TRAINER': 'trainer' };
function storeRole(r) { return STORE_ROLE[String(r || '').toUpperCase()] || String(r || '').toLowerCase(); }

// Resolve the acting user from the request (Bearer JWT or admin key).
async function resolveActor(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.substring(7);
    if (!token) return null;
    try {
      const { data: { user }, error } = await sb().auth.getUser(token);
      if (error || !user || !user.email) return null;
      const { data } = await sb().from('staff_profiles').select('*').eq('email', user.email.toLowerCase()).maybeSingle();
      if (!data) return null;
      if (data.is_active === false) return null;
      return { id: data.id, email: data.email, name: data.full_name, role: normalizeRole(data.role), trainer_id: data.trainer_id, isKey: false };
    } catch (e) { return null; }
  }
  const key = req.headers['x-admin-key'] || req.query.key;
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (ADMIN_KEY && key === ADMIN_KEY) {
    return { id: 'key-admin', email: 'key-admin@local', name: 'Key Admin', role: 'ADMIN', trainer_id: null, isKey: true };
  }
  return null;
}

// Middleware: ensure authenticated actor with at least the required role for `perm`.
function requirePerm(perm) {
  const minRole = PERMS[perm];
  if (!minRole) throw new Error('Unknown permission: ' + perm);
  return async (req, res, next) => {
    try {
      const actor = await resolveActor(req);
      if (!actor) return res.status(401).json({ error: 'Unauthorized' });
      if (!roleSatisfies(actor.role, minRole)) {
        return res.status(403).json({ error: 'Forbidden — insufficient role for ' + perm });
      }
      req.actor = actor;
      next();
    } catch (e) {
      res.status(500).json({ error: 'Auth error' });
    }
  };
}

// Convenience: any authenticated staff member (used by trainer-scoped routes).
const requireAuth = (req, res, next) => {
  resolveActor(req).then(actor => {
    if (!actor) return res.status(401).json({ error: 'Unauthorized' });
    req.actor = actor;
    next();
  }).catch(() => res.status(500).json({ error: 'Auth error' }));
};

module.exports = { ROLE_RANK, PERMS, resolveActor, requirePerm, requireAuth, roleSatisfies, normalizeRole, storeRole, sb };
