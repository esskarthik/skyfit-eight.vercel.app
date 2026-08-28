// backend/lib/catalog.js
// Unified access to plans & trainers. Reads from DB (admin-managed) with an
// in-memory cache and falls back to the static catalog if the table is empty.
const { db } = require('./store');

const TRAINER_META = {
  't-naveen': { rating: 4.9, clients: 320, speciality: ['Fat Loss', 'Weight Gain', 'Strength', 'Cardio'], available: ['Mon', 'Wed', 'Fri'], initials: 'NA', color: '#1A1D2E' },
  't-aravind': { rating: 4.8, clients: 240, speciality: ['Fat Loss', 'Weight Gain', 'Strength', 'Cardio'], available: ['Tue', 'Thu', 'Sat'], initials: 'AR', color: '#7A1C20' },
  't-uday': { rating: 4.9, clients: 280, speciality: ['Fat Loss', 'Weight Gain', 'Strength', 'Cardio'], available: ['Mon-Fri 7AM'], initials: 'UK', color: '#0F2A3A' },
  't-shinu': { rating: 5.0, clients: 310, speciality: ['Fat Loss', 'Weight Gain', 'Strength', 'Cardio'], available: ['All week'], initials: 'SH', color: '#9A2A12' },
  't-vamsi': { rating: 4.9, clients: 350, speciality: ['Fat Loss', 'Weight Gain', 'Strength', 'Cardio'], available: ['Mon-Sat'], initials: 'VA', color: '#2A1E5A' }
};

const STATIC_PLANS = {
  gym: { id: 'gym', label: 'Normal Gym Membership', icon: '🏷️', description: 'Strength-focused gym membership', features: ['Strength training', 'Bodybuilding', 'Weight Gain', 'Muscle Toning', 'Fitness assessment'], plans: [
    { id: 'gym-monthly', name: '1 Month', durationLabel: '1 Month', price: 1299, durationDays: 30 },
    { id: 'gym-quarterly', name: '3 Months', durationLabel: '3 Months', price: 3499, durationDays: 90, tag: 'POPULAR', save: 'Save ₹398' },
    { id: 'gym-halfyearly', name: '6 Months', durationLabel: '6 Months', price: 5499, durationDays: 180, tag: 'VALUE', save: 'Save ₹2295' },
    { id: 'gym-yearly', name: 'Annual', durationLabel: '12 Months', price: 9999, durationDays: 365, tag: 'BEST VALUE', save: 'Save ₹5589' }
  ] },
  personal: { id: 'personal', label: 'Personal Training', icon: '🧑‍🏫', description: 'One-on-one dedicated trainer sessions', features: ['Dedicated personal trainer', 'Personalized workout', 'Form correction', 'Progress tracking', 'Weekly assessment'], plans: [
    { id: 'pt-onetime', name: 'One-to-One', durationLabel: 'Per Session', price: 5000, durationDays: 30 },
    { id: 'pt-quarterly', name: '3 Months', durationLabel: '3 Months', price: 13000, durationDays: 90, tag: 'POPULAR' },
    { id: 'pt-halfyearly', name: '6 Months', durationLabel: '6 Months', price: 24000, durationDays: 180, tag: 'VALUE' },
    { id: 'pt-yearly', name: 'Annual', durationLabel: '12 Months', price: 45000, durationDays: 365, tag: 'BEST VALUE' }
  ] },
  transformation: { id: 'transformation', label: 'Transformation Program', icon: '🔥', description: 'Full gym with strength + cardio', isPremium: true, features: ['Strength training', 'Cardio & endurance', 'Weight Loss', 'Weight Gain', 'Body transformation', 'Flexibility'], plans: [
    { id: 'transform-monthly', name: '1 Month', durationLabel: '1 Month', price: 1499, durationDays: 30 },
    { id: 'transform-quarterly', name: '3 Months', durationLabel: '3 Months', price: 3999, durationDays: 90, tag: 'POPULAR', save: 'Save ₹498' },
    { id: 'transform-halfyearly', name: '6 Months', durationLabel: '6 Months', price: 6999, durationDays: 180, tag: 'VALUE', save: 'Save ₹1995' },
    { id: 'transform-yearly', name: 'Annual', durationLabel: '12 Months', price: 11999, durationDays: 365, tag: 'BEST VALUE', save: 'Save ₹5989' }
  ] },
  elite: { id: 'elite', label: 'SKYFIT ELITE', icon: '⭐', description: 'Premium unlimited access', isPremium: true, plans: [
    { id: 'elite-yearly', name: 'SKYFIT ELITE', durationLabel: 'Per Year', price: 60000, durationDays: 365, tag: 'ELITE', featured: true, includes: ['Unlimited gym access', 'Personal training sessions', 'Diet consultation', 'Body composition tracking', 'Priority trainer support', 'Transformation challenges', 'Exclusive member benefits'] }
  ] }
};

let _planCache = { at: 0, data: null };
let _trainerCache = { at: 0, data: null };
const TTL = 60 * 1000;

function groupedPlansFromRows(rows) {
  const cats = {};
  for (const r of rows) {
    const active = r.is_active !== false && r.status !== 'archived';
    if (!active) continue; // archived/deactivated plans are hidden from public
    const cat = cats[r.category] || (cats[r.category] = { id: r.category, label: r.category, icon: '🏷️', description: '', features: [], plans: [] });
    cat.description = cat.description || r.description || '';
    cat.plans.push({
      id: r.id, name: r.name, durationLabel: r.duration_label || (r.duration_days + ' days'),
      price: r.price, durationDays: r.duration_days, sessions: null,
      tag: r.tag || '', save: r.save_text || null,
      features: Array.isArray(r.features) ? r.features : []
    });
  }
  if (cats.gym) return cats; // has all
  return STATIC_PLANS;
}

async function getPlans() {
  if (_planCache.data && Date.now() - _planCache.at < TTL) return _planCache.data;
  try {
    const { data } = await db().from('plans').select('*').order('name');
    if (data && data.length) {
      // attach features
      try {
        const ids = data.map(p => p.id);
        const { data: feats } = await db().from('plan_features').select('plan_id, feature').in('plan_id', ids).order('sort_order');
        const byPlan = {};
        for (const f of (feats || [])) { (byPlan[f.plan_id] = byPlan[f.plan_id] || []).push(f.feature); }
        for (const p of data) p.features = byPlan[p.id] || [];
      } catch (e) { for (const p of data) p.features = []; }
      _planCache = { at: Date.now(), data: groupedPlansFromRows(data) };
      return _planCache.data;
    }
  } catch (e) {}
  _planCache = { at: Date.now(), data: STATIC_PLANS };
  return STATIC_PLANS;
}

function findPlanById(planId) {
  for (const cat of Object.values(_planCache.data || STATIC_PLANS)) {
    const p = (cat.plans || []).find(x => x.id === planId);
    if (p) return { category: cat.id, categoryLabel: cat.label, plan: p };
  }
  return null;
}
async function resolvePlan(planId) {
  if (_planCache.data) { const f = findPlanById(planId); if (f) return f; }
  await getPlans();
  return findPlanById(planId);
}

async function getTrainers() {
  if (_trainerCache.data && Date.now() - _trainerCache.at < TTL) return _trainerCache.data;
  try {
    const { data } = await db().from('trainers').select('*').order('id');
    if (data && data.length) {
      const list = data
        .filter(t => t.status === 'active')   // disabled/deleted trainers are hidden from public
        .map(t => ({
          id: t.id, name: t.name, role: t.role || 'Trainer', exp: t.exp || '',
          rating: t.rating != null ? t.rating : 4.5, clients: t.clients || 0,
          speciality: t.speciality || [], bio: t.bio || '', available: t.available || [],
          initials: t.initials || '', color: t.color || '#1A1D2E', status: t.status
        }));
      _trainerCache = { at: Date.now(), data: list };
      return list;
    }
  } catch (e) {}
  // fallback: build from static meta
  const list = Object.keys(TRAINER_META).map(id => ({ id, name: id.toUpperCase(), role: 'Trainer', exp: '', rating: 4.5, clients: 0, speciality: [], bio: '', available: [], initials: '?', color: '#1A1D2E', status: 'active' }));
  _trainerCache = { at: Date.now(), data: list };
  return list;
}
function findTrainerById(id) {
  return (_trainerCache.data || []).find(t => t.id === id) || null;
}
async function resolveTrainer(id) {
  if (!id) return null;
  if (_trainerCache.data) { const f = findTrainerById(id); if (f) return f; }
  await getTrainers();
  return findTrainerById(id);
}

module.exports = { getPlans, findPlanById, resolvePlan, getTrainers, findTrainerById, resolveTrainer, STATIC_PLANS };
