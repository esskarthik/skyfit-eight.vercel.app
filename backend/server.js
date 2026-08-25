require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve frontend - support both ../frontend and ../public and ../../frontend layouts
const frontendPath = path.join(__dirname, '..', 'frontend');
const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(frontendPath)) app.use(express.static(frontendPath));
if (fs.existsSync(publicPath)) app.use(express.static(publicPath));

// On Vercel the filesystem is read-only except /tmp, so keep the JSON DB there.
const DB_FILE = process.env.VERCEL ? path.join('/tmp', 'skyfit-db.json') : path.join(__dirname, 'db.json');

// ---- TRAINERS DATA ---- 5 as requested
const TRAINERS = [
  { id:'t-naveen', name:'NAVEEN', role:'Strength & Conditioning', exp:'8 yrs', rating:4.9, clients:320, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'National powerlifting medalist. Progressive overload & muscle gain specialist.', available:['Mon','Wed','Fri'], color:'#1A1D2E', initials:'NA', priceNote:'Included in PT & Elite' },
  { id:'t-aravind', name:'ARAVIND', role:'Yoga & Wellness', exp:'6 yrs', rating:4.8, clients:240, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'RYT-500 certified. Mobility, breathwork & flexibility expert.', available:['Tue','Thu','Sat'], color:'#7A1C20', initials:'AR', priceNote:'Yoga + Recovery' },
  { id:'t-uday', name:'UDAY KUMAR', role:'CrossFit L2 Coach', exp:'7 yrs', rating:4.9, clients:280, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'CrossFit Games regional athlete. Engine, WODs & conditioning.', available:['Mon-Fri 7AM'], color:'#0F2A3A', initials:'UK', priceNote:'HIIT Specialist' },
  { id:'t-shinu', name:'SHINU', role:'Transformation Specialist', exp:'6 yrs', rating:5.0, clients:310, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'300+ transformations. Nutrition, mindset & accountability coach.', available:['All week'], color:'#9A2A12', initials:'SH', priceNote:'12-Week Lead' },
  { id:'t-vamsi', name:'VAMSI', role:'Elite Performance', exp:'9 yrs', rating:4.9, clients:350, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'Elite performance & endurance specialist. SKYFIT ELITE program lead.', available:['Mon-Sat'], color:'#2A1E5A', initials:'VA', priceNote:'Elite Lead' }
];
function findTrainerById(id){ return TRAINERS.find(t=>t.id===id) || null; }

// ---- PLANS DATA ---- (from real brochure)
const PLANS = {
  gym: {
    id: 'gym',
    label: 'Normal Gym Membership',
    icon: '🏷️',
    description: 'Strength-focused gym membership',
    features: ['Strength training','Bodybuilding','Weight Gain','Muscle Toning','Fitness assessment'],
    plans: [
      { id: 'gym-monthly', name: '1 Month', durationLabel: '1 Month', price: 1299, durationDays: 30, tag: '' },
      { id: 'gym-quarterly', name: '3 Months', durationLabel: '3 Months', price: 3499, durationDays: 90, tag: 'POPULAR', save: 'Save ₹398' },
      { id: 'gym-halfyearly', name: '6 Months', durationLabel: '6 Months', price: 5499, durationDays: 180, tag: 'VALUE', save: 'Save ₹2295' },
      { id: 'gym-yearly', name: 'Annual', durationLabel: '12 Months', price: 9999, durationDays: 365, tag: 'BEST VALUE', save: 'Save ₹5589' }
    ]
  },
  personal: {
    id: 'personal',
    label: 'Personal Training',
    icon: '🧑‍🏫',
    description: 'One-on-one dedicated trainer sessions',
    features: ['Dedicated personal trainer','Personalized workout','Form correction','Progress tracking','Weekly assessment'],
    plans: [
      { id: 'pt-onetime', name: 'One-to-One', durationLabel: 'Per Session', price: 5000, durationDays: 30, tag: '' },
      { id: 'pt-quarterly', name: '3 Months', durationLabel: '3 Months', price: 13000, durationDays: 90, tag: 'POPULAR' },
      { id: 'pt-halfyearly', name: '6 Months', durationLabel: '6 Months', price: 24000, durationDays: 180, tag: 'VALUE' },
      { id: 'pt-yearly', name: 'Annual', durationLabel: '12 Months', price: 45000, durationDays: 365, tag: 'BEST VALUE' }
    ]
  },
  transformation: {
    id: 'transformation',
    label: 'Transformation Program',
    icon: '🔥',
    description: 'Full gym with strength + cardio for body transformation',
    isPremium: true,
    features: ['Strength training','Cardio & endurance','Weight Loss','Weight Gain','Body transformation','Flexibility'],
    plans: [
      { id: 'transform-monthly', name: '1 Month', durationLabel: '1 Month', price: 1499, durationDays: 30, tag: '' },
      { id: 'transform-quarterly', name: '3 Months', durationLabel: '3 Months', price: 3999, durationDays: 90, tag: 'POPULAR', save: 'Save ₹498' },
      { id: 'transform-halfyearly', name: '6 Months', durationLabel: '6 Months', price: 6999, durationDays: 180, tag: 'VALUE', save: 'Save ₹1995' },
      { id: 'transform-yearly', name: 'Annual', durationLabel: '12 Months', price: 11999, durationDays: 365, tag: 'BEST VALUE', save: 'Save ₹5989' }
    ]
  },
  elite: {
    id: 'elite',
    label: 'SKYFIT ELITE',
    icon: '⭐',
    description: 'Premium unlimited access — the ultimate membership',
    isPremium: true,
    plans: [
      { id: 'elite-yearly', name: 'SKYFIT ELITE', durationLabel: 'Per Year', price: 60000, durationDays: 365, tag: 'ELITE', featured: true,
        includes: ['Unlimited gym access','Personal training sessions','Diet consultation','Body composition tracking','Priority trainer support','Transformation challenges','Exclusive member benefits'] }
    ]
  }
};

function ensureDB(){
  if(!fs.existsSync(DB_FILE)){
    fs.writeFileSync(DB_FILE, JSON.stringify({ memberships: [] }, null, 2));
  }
}
function loadDB(){
  ensureDB();
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch(e){ return { memberships: [] }; }
}
function saveDB(data){
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function findPlanById(planId){
  for(const cat of Object.values(PLANS)){
    const p = cat.plans.find(x=>x.id===planId);
    if(p) return { category: cat.id, categoryLabel: cat.label, plan: p };
  }
  return null;
}
function computeExpiry(startDateStr, durationDays){
  const d = new Date(startDateStr);
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() + durationDays);
  return d.toISOString().split('T')[0];
}
function daysRemaining(expiresStr){
  const today = new Date(); today.setHours(0,0,0,0);
  const exp = new Date(expiresStr); exp.setHours(0,0,0,0);
  const diff = Math.ceil((exp - today)/ (1000*60*60*24));
  return diff;
}
function genId(){ return 'SFZ-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase(); }

// ---- ADMIN AUTH ----
const ADMIN_KEY = process.env.ADMIN_KEY || 'skyfit-admin-2026';
function requireAdmin(req,res,next){
  const key = req.headers['x-admin-key'] || req.query.key;
  if(key !== ADMIN_KEY) return res.status(401).json({ error:'Unauthorized — invalid admin key' });
  next();
}

// ---- API ROUTES ----

app.get('/api/health', (req,res)=> res.json({ ok:true, time: new Date().toISOString(), service:'SKYFIT ZONE API', hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY }));

// OpenRouter AI helper (uses OPENROUTER_API_KEY from .env)
app.post('/api/ai/chat', async (req,res)=>{
  const key = process.env.OPENROUTER_API_KEY;
  if(!key) return res.status(500).json({ error:'OPENROUTER_API_KEY not configured. Add it to backend/.env' });
  const { messages, model } = req.body;
  if(!messages) return res.status(400).json({ error:'messages required' });
  try{
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${key}`, 'Content-Type':'application/json', 'HTTP-Referer': 'http://localhost:4000', 'X-Title': 'SKYFIT ZONE' },
      body: JSON.stringify({ model: model || 'openai/gpt-4o-mini', messages })
    });
    const data = await r.json();
    if(!r.ok) return res.status(r.status).json(data);
    res.json(data);
  }catch(e){ res.status(500).json({ error: e.message }); }
});

app.get('/api/plans', (req,res)=>{
  res.json(PLANS);
});

app.get('/api/trainers', (req,res)=>{
  res.json(TRAINERS);
});
app.get('/api/trainers/:id', (req,res)=>{
  const t = findTrainerById(req.params.id);
  if(!t) return res.status(404).json({ error:'Trainer not found'});
  res.json(t);
});

app.get('/api/memberships', (req,res)=>{
  const db = loadDB();
  // enrich with computed days
  const enriched = db.memberships.map(m=> ({ ...m, daysRemaining: daysRemaining(m.expires), isActive: daysRemaining(m.expires) >=0 }));
  res.json(enriched);
});

app.get('/api/memberships/by-email/:email', (req,res)=>{
  const db = loadDB();
  const list = db.memberships.filter(m=> m.member.email.toLowerCase() === req.params.email.toLowerCase());
  const enriched = list.map(m=> ({ ...m, daysRemaining: daysRemaining(m.expires), isActive: daysRemaining(m.expires) >=0 }));
  enriched.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  res.json(enriched);
});

app.get('/api/memberships/:id', (req,res)=>{
  const db = loadDB();
  const m = db.memberships.find(x=> x.id===req.params.id);
  if(!m) return res.status(404).json({ error:'Membership not found'});
  res.json({ ...m, daysRemaining: daysRemaining(m.expires), isActive: daysRemaining(m.expires)>=0 });
});

// Mock payment validation
app.post('/api/payment/mock', (req,res)=>{
  const { method, cardNumber, expiry, cvv, upi } = req.body;
  if(method==='card'){
    if(!cardNumber || cardNumber.replace(/\s/g,'').length < 16) return res.status(400).json({ error:'Invalid card number'});
    if(!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) return res.status(400).json({ error:'Invalid expiry MM/YY'});
    if(!cvv || cvv.length!==3) return res.status(400).json({ error:'Invalid CVV'});
  }
  if(method==='upi'){
    if(!upi || !upi.includes('@')) return res.status(400).json({ error:'Invalid UPI ID'});
  }
  // simulate 800ms delay then success
  setTimeout(()=> res.json({ ok:true, transactionId: 'TXN'+Math.random().toString(36).slice(2,9).toUpperCase(), message:'Payment successful' }), 700);
});

// Create membership (checkout) - now supports trainerId
app.post('/api/checkout', (req,res)=>{
  const { planId, member, startDate, payment, trainerId } = req.body;
  if(!planId || !member || !startDate) return res.status(400).json({ error:'Missing required fields: planId, member, startDate'});
  if(!member.name || !member.email || !member.phone) return res.status(400).json({ error:'Member name, email, phone required'});
  if(!/^\S+@\S+\.\S+$/.test(member.email)) return res.status(400).json({ error:'Invalid email'});
  const found = findPlanById(planId);
  if(!found) return res.status(400).json({ error:'Invalid planId'});
  let trainer = null;
  if(trainerId){
    trainer = findTrainerById(trainerId);
    if(!trainer) return res.status(400).json({ error:'Invalid trainerId'});
  }
  
  const expires = computeExpiry(startDate, found.plan.durationDays);
  const membership = {
    id: genId(),
    planId,
    category: found.category,
    categoryLabel: found.categoryLabel,
    planName: found.plan.name,
    durationLabel: found.plan.durationLabel,
    price: found.plan.price,
    durationDays: found.plan.durationDays,
    sessions: found.plan.sessions || null,
    member: { name: member.name.trim(), email: member.email.trim().toLowerCase(), phone: String(member.phone).trim() },
    startDate,
    expires,
    daysRemaining: daysRemaining(expires),
    isActive: true,
    trainer: trainer ? { id: trainer.id, name: trainer.name, role: trainer.role, initials: trainer.initials } : null,
    payment: payment ? { method: payment.method, transactionId: payment.transactionId || ('TXN'+Math.random().toString(36).slice(2,9).toUpperCase()), paidAt: new Date().toISOString(), amount: found.plan.price } : null,
    createdAt: new Date().toISOString()
  };
  const db = loadDB();
  db.memberships.unshift(membership);
  saveDB(db);
  res.status(201).json({ ok:true, membership: { ...membership, daysRemaining: daysRemaining(expires) } });
});

app.delete('/api/memberships/:id', (req,res)=>{
  const db = loadDB();
  const idx = db.memberships.findIndex(x=> x.id===req.params.id);
  if(idx===-1) return res.status(404).json({ error:'Not found'});
  db.memberships.splice(idx,1);
  saveDB(db);
  res.json({ ok:true });
});

// ---- ADMIN ROUTES ----
app.get('/api/admin/check', requireAdmin, (req,res)=> res.json({ ok:true, admin:true }));
app.get('/api/admin/stats', requireAdmin, (req,res)=>{
  const db = loadDB();
  const all = db.memberships;
  const enriched = all.map(m=> ({ ...m, daysRemaining: daysRemaining(m.expires), isActive: daysRemaining(m.expires) >=0 }));
  const active = enriched.filter(m=> m.isActive).length;
  const expiringSoon = enriched.filter(m=> m.isActive && m.daysRemaining <=7).length;
  const expired = enriched.length - active;
  const revenue = enriched.reduce((s,m)=> s + (m.price||0), 0);
  const byPlan = {};
  enriched.forEach(m=>{ byPlan[m.planName] = (byPlan[m.planName]||0)+1; });
  const byTrainer = {};
  enriched.forEach(m=>{ const k = m.trainer ? m.trainer.name : 'No trainer'; byTrainer[k] = (byTrainer[k]||0)+1; });
  res.json({ total: enriched.length, active, expired, expiringSoon, revenue, byPlan, byTrainer });
});
app.get('/api/admin/clients', requireAdmin, (req,res)=>{
  const db = loadDB();
  const enriched = db.memberships.map(m=> ({ ...m, daysRemaining: daysRemaining(m.expires), isActive: daysRemaining(m.expires) >=0 }));
  enriched.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  res.json(enriched);
});
app.post('/api/admin/clients', requireAdmin, (req,res)=>{
  const { name, email, phone, planId, startDate, trainerId, paymentMethod, notes } = req.body;
  if(!name || !email || !phone || !planId || !startDate) return res.status(400).json({ error:'name, email, phone, planId, startDate required'});
  if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error:'Invalid email'});
  const found = findPlanById(planId);
  if(!found) return res.status(400).json({ error:'Invalid planId'});
  let trainer = null;
  if(trainerId){ trainer = findTrainerById(trainerId); if(!trainer) return res.status(400).json({ error:'Invalid trainerId'}); }
  const expires = computeExpiry(startDate, found.plan.durationDays);
  const membership = {
    id: genId(),
    planId, category: found.category, categoryLabel: found.categoryLabel,
    planName: found.plan.name, durationLabel: found.plan.durationLabel,
    price: found.plan.price, durationDays: found.plan.durationDays, sessions: found.plan.sessions || null,
    member: { name: name.trim(), email: email.trim().toLowerCase(), phone: String(phone).trim() },
    startDate, expires, daysRemaining: daysRemaining(expires), isActive: true,
    trainer: trainer ? { id: trainer.id, name: trainer.name, role: trainer.role, initials: trainer.initials } : null,
    payment: paymentMethod ? { method: paymentMethod, transactionId: 'ADMIN-'+Math.random().toString(36).slice(2,7).toUpperCase(), paidAt: new Date().toISOString(), amount: found.plan.price } : null,
    notes: notes ? String(notes).slice(0,500) : '',
    createdAt: new Date().toISOString(), createdBy: 'admin'
  };
  const db = loadDB(); db.memberships.unshift(membership); saveDB(db);
  res.status(201).json({ ok:true, membership });
});
app.put('/api/admin/clients/:id', requireAdmin, (req,res)=>{
  const db = loadDB();
  const idx = db.memberships.findIndex(x=> x.id===req.params.id);
  if(idx===-1) return res.status(404).json({ error:'Client not found'});
  const cur = db.memberships[idx];
  const { name, email, phone, planId, startDate, trainerId, notes } = req.body;
  if(name) cur.member.name = String(name).trim();
  if(email){ if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error:'Invalid email'}); cur.member.email = String(email).trim().toLowerCase(); }
  if(phone) cur.member.phone = String(phone).trim();
  if(notes !== undefined) cur.notes = String(notes).slice(0,500);
  if(planId && planId !== cur.planId){
    const found = findPlanById(planId);
    if(!found) return res.status(400).json({ error:'Invalid planId'});
    cur.planId = planId; cur.category = found.category; cur.categoryLabel = found.categoryLabel;
    cur.planName = found.plan.name; cur.durationLabel = found.plan.durationLabel;
    cur.price = found.plan.price; cur.durationDays = found.plan.durationDays; cur.sessions = found.plan.sessions || null;
  }
  if(startDate) cur.startDate = startDate;
  // recompute expiry if plan or start changed
  if(planId || startDate) cur.expires = computeExpiry(cur.startDate, cur.durationDays);
  if(trainerId !== undefined){
    if(!trainerId){ cur.trainer = null; }
    else { const t=findTrainerById(trainerId); if(!t) return res.status(400).json({ error:'Invalid trainerId'}); cur.trainer={ id:t.id, name:t.name, role:t.role, initials:t.initials }; }
  }
  cur.daysRemaining = daysRemaining(cur.expires);
  cur.isActive = cur.daysRemaining >=0;
  cur.updatedAt = new Date().toISOString();
  db.memberships[idx]=cur; saveDB(db);
  res.json({ ok:true, membership: cur });
});
app.delete('/api/admin/clients/:id', requireAdmin, (req,res)=>{
  const db = loadDB();
  const idx = db.memberships.findIndex(x=> x.id===req.params.id);
  if(idx===-1) return res.status(404).json({ error:'Not found'});
  db.memberships.splice(idx,1); saveDB(db);
  res.json({ ok:true });
});

// Fallback: serve index.html for SPA routes
app.get('*', (req,res)=>{
  const candidates = [frontendPath, publicPath].map(p=> path.join(p,'index.html'));
  for(const c of candidates){
    if(fs.existsSync(c)) return res.sendFile(c);
  }
  res.status(404).send('Frontend not found. Build frontend first.');
});

// Export the app for Vercel serverless; listen only when run directly (node server.js)
if (!process.env.VERCEL) {
  app.listen(PORT, ()=> {
    console.log(`\n🏋️ SKYFIT ZONE API running on http://localhost:${PORT}`);
    console.log(`   GET  /api/plans`);
    console.log(`   POST /api/checkout`);
    console.log(`   GET  /api/memberships`);
    console.log(`   Frontend served from ${frontendPath}\n`);
  });
}

module.exports = app;
