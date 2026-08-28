// backend/lib/access.js
// Gym access decision engine. The critical business rule:
//   PAID + ACTIVE + NOT EXPIRED + NOT DISABLED membership  =>  GRANTED
//   otherwise => DENIED  (and the attempt is always logged).
const { db } = require('./store');

const DENY_REASONS = {
  NO_MEMBER: 'No membership found',
  EXPIRED: 'Membership expired',
  NOT_ACTIVE: 'Membership not active',
  DISABLED: 'Account disabled',
  UNKNOWN_BIOMETRIC: 'Unknown biometric ID',
  DEVICE_ERROR: 'Device error',
  UNAUTHORIZED: 'Unauthorized access'
};

// Evaluate access for a member identified by email (or biometric device user id).
// Returns { granted, status, reason, member, membership }.
async function evaluateAccess({ memberEmail, deviceUserId, deviceId }) {
  let memberEmailResolved = memberEmail;

  // Resolve biometric device user id -> member email
  let biometric = null;
  if (!memberEmailResolved && deviceUserId) {
    const { data } = await db().from('biometric_members')
      .select('member_email, status')
      .eq('device_user_id', deviceUserId)
      .maybeSingle();
    biometric = data;
    if (!data) return denied(DENY_REASONS.UNKNOWN_BIOMETRIC, { deviceUserId });
    if (data.status === 'DISABLED') return denied(DENY_REASONS.DISABLED, { deviceUserId });
    if (data.status !== 'REGISTERED') return denied(DENY_REASONS.UNKNOWN_BIOMETRIC, { deviceUserId });
    memberEmailResolved = data.member_email;
  }

  if (!memberEmailResolved) return denied(DENY_REASONS.NO_MEMBER, {});

  // Find latest membership for this member email
  const { data: memberships } = await db().from('memberships')
    .select('*')
    .ilike('member_email', memberEmailResolved)
    .order('created_at', { ascending: false })
    .limit(1);

  const m = memberships && memberships[0];
  if (!m) return denied(DENY_REASONS.NO_MEMBER, { memberEmail: memberEmailResolved });

  const today = new Date();
  const expiry = new Date(m.expires + 'T23:59:59');
  const isActive = m.is_active !== false && today <= expiry;
  const expired = today > expiry;

  if (!m.is_active) return denied(DENY_REASONS.NOT_ACTIVE, { memberEmail: memberEmailResolved, membershipId: m.id });
  if (expired) return denied(DENY_REASONS.EXPIRED, { memberEmail: memberEmailResolved, membershipId: m.id });
  if (biometric && biometric.status === 'DISABLED') return denied(DENY_REASONS.DISABLED, {});

  // Resolve display name (members table) and plan (plans table) — memberships
  // only stores member_email + plan_id.
  let member = { name: String(memberEmailResolved || '').split('@')[0], email: memberEmailResolved };
  try {
    const { data: mb } = await db().from('members').select('full_name, email').ilike('email', memberEmailResolved).maybeSingle();
    if (mb) member = { name: mb.full_name || member.email, email: mb.email };
  } catch (e) {}
  let planName = m.plan_id || null;
  try {
    if (m.plan_id) { const { data: pl } = await db().from('plans').select('name').eq('id', m.plan_id).maybeSingle(); if (pl) planName = pl.name; }
  } catch (e) {}

  // GRANTED
  return {
    granted: true,
    status: 'GRANTED',
    reason: null,
    member,
    membership: { id: m.id, plan: planName, expires: m.expires }
  };
}

function denied(reason, extra) {
  return { granted: false, status: 'DENIED', reason, member: null, membership: null, ...extra };
}

// Record an access attempt into access_logs and (if granted) attendance.
async function recordAttempt({ memberEmail, memberName, deviceId, deviceName, accessMethod, status, reason }) {
  try {
    const { data: dev } = deviceId ? await db().from('access_devices').select('name').eq('id', deviceId).maybeSingle() : { data: null };
    const dName = deviceName || (dev && dev.name) || null;
    await db().from('access_logs').insert({
      member_email: memberEmail || null,
      member_name: memberName || null,
      device_id: deviceId || null,
      device_name: dName,
      access_method: accessMethod || 'fingerprint',
      status, reason: reason || null,
      created_at: new Date().toISOString()
    });
    if (status === 'GRANTED') {
      await db().from('attendance').insert({
        member_email: memberEmail || null,
        member_name: memberName || null,
        entry_time: new Date().toISOString(),
        access_method: accessMethod || 'fingerprint',
        device_id: deviceId || null,
        status: 'GRANTED'
      });
    }
  } catch (e) { /* logging must not break access decision */ }
}

module.exports = { evaluateAccess, recordAttempt, DENY_REASONS };
