require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve frontend
const frontendPath = path.join(__dirname, '..', 'frontend');
const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(frontendPath)) app.use(express.static(frontendPath));
if (fs.existsSync(publicPath)) app.use(express.static(publicPath));

// ---- SUPABASE ----
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// ---- TRAINERS DATA ---- (static)
const TRAINERS = [
  { id:'t-naveen', name:'NAVEEN', role:'Strength & Conditioning', exp:'8 yrs', rating:4.9, clients:320, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'National powerlifting medalist. Progressive overload & muscle gain specialist.', available:['Mon','Wed','Fri'], color:'#1A1D2E', initials:'NA', priceNote:'Included in PT & Elite' },
  { id:'t-aravind', name:'ARAVIND', role:'Yoga & Wellness', exp:'6 yrs', rating:4.8, clients:240, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'RYT-500 certified. Mobility, breathwork & flexibility expert.', available:['Tue','Thu','Sat'], color:'#7A1C20', initials:'AR', priceNote:'Yoga + Recovery' },
  { id:'t-uday', name:'UDAY KUMAR', role:'CrossFit L2 Coach', exp:'7 yrs', rating:4.9, clients:280, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'CrossFit Games regional athlete. Engine, WODs & conditioning.', available:['Mon-Fri 7AM'], color:'#0F2A3A', initials:'UK', priceNote:'HIIT Specialist' },
  { id:'t-shinu', name:'SHINU', role:'Transformation Specialist', exp:'6 yrs', rating:5.0, clients:310, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'300+ transformations. Nutrition, mindset & accountability coach.', available:['All week'], color:'#9A2A12', initials:'SH', priceNote:'12-Week Lead' },
  { id:'t-vamsi', name:'VAMSI', role:'Elite Performance', exp:'9 yrs', rating:4.9, clients:350, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'Elite performance & endurance specialist. SKYFIT ELITE program lead.', available:['Mon-Sat'], color:'#2A1E5A', initials:'VA', priceNote:'Elite Lead' }
];
function findTrainerById(id){ return TRAINERS.find(t=>t.id===id) || null; }

// ---- PLANS DATA ---- (static)
const PLANS = {
  gym: {
    id:'gym', label:'Normal Gym Membership', icon:'🏷️',
    description:'Strength-focused gym membership',
    features:['Strength training','Bodybuilding','Weight Gain','Muscle Toning','Fitness assessment'],
    plans:[
      { id:'gym-monthly', name:'1 Month', durationLabel:'1 Month', price:1299, durationDays:30, tag:'' },
      { id:'gym-quarterly', name:'3 Months', durationLabel:'3 Months', price:3499, durationDays:90, tag:'POPULAR', save:'Save ₹398' },
      { id:'gym-halfyearly', name:'6 Months', durationLabel:'6 Months', price:5499, durationDays:180, tag:'VALUE', save:'Save ₹2295' },
      { id:'gym-yearly', name:'Annual', durationLabel:'12 Months', price:9999, durationDays:365, tag:'BEST VALUE', save:'Save ₹5589' }
    ]
  },
  personal: {
    id:'personal', label:'Personal Training', icon:'🧑‍🏫',
    description:'One-on-one dedicated trainer sessions',
    features:['Dedicated personal trainer','Personalized workout','Form correction','Progress tracking','Weekly assessment'],
    plans:[
      { id:'pt-onetime', name:'One-to-One', durationLabel:'Per Session', price:5000, durationDays:30, tag:'' },
      { id:'pt-quarterly', name:'3 Months', durationLabel:'3 Months', price:13000, durationDays:90, tag:'POPULAR' },
      { id:'pt-halfyearly', name:'6 Months', durationLabel:'6 Months', price:24000, durationDays:180, tag:'VALUE' },
      { id:'pt-yearly', name:'Annual', durationLabel:'12 Months', price:45000, durationDays:365, tag:'BEST VALUE' }
    ]
  },
  transformation: {
    id:'transformation', label:'Transformation Program', icon:'🔥',
    description:'Full gym with strength + cardio for body transformation', isPremium:true,
    features:['Strength training','Cardio & endurance','Weight Loss','Weight Gain','Body transformation','Flexibility'],
    plans:[
      { id:'transform-monthly', name:'1 Month', durationLabel:'1 Month', price:1499, durationDays:30, tag:'' },
      { id:'transform-quarterly', name:'3 Months', durationLabel:'3 Months', price:3999, durationDays:90, tag:'POPULAR', save:'Save ₹498' },
      { id:'transform-halfyearly', name:'6 Months', durationLabel:'6 Months', price:6999, durationDays:180, tag:'VALUE', save:'Save ₹1995' },
      { id:'transform-yearly', name:'Annual', durationLabel:'12 Months', price:11999, durationDays:365, tag:'BEST VALUE', save:'Save ₹5989' }
    ]
  },
  elite: {
    id:'elite', label:'SKYFIT ELITE', icon:'⭐',
    description:'Premium unlimited access — the ultimate membership', isPremium:true,
    plans:[
      { id:'elite-yearly', name:'SKYFIT ELITE', durationLabel:'Per Year', price:60000, durationDays:365, tag:'ELITE', featured:true,
        includes:['Unlimited gym access','Personal training sessions','Diet consultation','Body composition tracking','Priority trainer support','Transformation challenges','Exclusive member benefits'] }
    ]
  }
};

function findPlanById(planId){
  for(const cat of Object.values(PLANS)){
    const p = cat.plans.find(x=>x.id===planId);
    if(p) return { category:cat.id, categoryLabel:cat.label, plan:p };
  }
  return null;
}
function computeExpiry(startDateStr, durationDays){
  const d = new Date(startDateStr); d.setHours(12,0,0,0);
  d.setDate(d.getDate() + durationDays);
  return d.toISOString().split('T')[0];
}
function daysRemaining(expiresStr){
  const today = new Date(); today.setHours(0,0,0,0);
  const exp = new Date(expiresStr); exp.setHours(0,0,0,0);
  return Math.ceil((exp - today) / (1000*60*60*24));
}
function genId(){ return 'SFZ-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase(); }
// ---- ADMIN AUTH ----

// Supabase Admin client for JWT verification (service_role key for server-side verification)
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

async function verifyAdminToken(token){
  try{
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if(error) return null;
    // Check user metadata for admin role
    if(user && user.user_metadata && user.user_metadata.role === 'admin'){
      return user;
    }
    // Also check if email matches known admin emails (fallback)
    const adminEmails = ['admin@skyfit.example.com']; // add your admin emails here
    if(user && adminEmails.includes(user.email)){
      // Set metadata for future checks
      await supabaseAdmin.auth.updateUser({ data: { role: 'admin' } });
      return user;
    }
    return null;
  }catch(e){ return null; }
}

function requireAdmin(req,res,next){
  const auth = req.headers.authorization || '';
  // Bearer <jwt> format
  if(!auth.startsWith('Bearer ')) return res.status(401).json({ error:'Unauthorized — no token' });
  const token = auth.substring('Bearer '.length);
  verifyAdminToken(token).then(user=>{
    if(!user) return res.status(401).json({ error:'Unauthorized — invalid or non-admin token' });
    req.adminUser = user;
    next();
  }).catch(()=> res.status(401).json({ error:'Unauthorized — token verification failed' }));
}

// ---- AUTH ROUTES ----

// Exchange email+password for Supabase JWT (id_token)
app.post('/api/auth/token', async (req,res)=>{
  const { email, password } = req.body;
  if(!email||!password) return res.status(400).json({ error:'email and password required' });
  try{
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) return res.status(401).json({ error:error.message });
    if(!data.user) return res.status(401).json({ error:'No user returned' });
    res.json({ ok:true, id_token:data.session.access_token || data.session.accessToken || '' });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

// ---- API ROUTES ----

app.get('/api/health', (req,res)=> res.json({ ok:true, time:new Date().toISOString(), service:'SKYFIT ZONE API', hasSupabase:!!process.env.SUPABASE_URL }));

// OpenRouter AI
app.post('/api/ai/chat', async (req,res)=>{
  const key = process.env.OPENROUTER_API_KEY;
  if(!key) return res.status(500).json({ error:'OPENROUTER_API_KEY not configured' });
  const { messages, model } = req.body;
  if(!messages) return res.status(400).json({ error:'messages required' });
  try{
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json', 'HTTP-Referer':'http://localhost:4000', 'X-Title':'SKYFIT ZONE' },
      body: JSON.stringify({ model:model||'openai/gpt-4o-mini', messages })
    });
    const data = await r.json();
    if(!r.ok) return res.status(r.status).json(data);
    res.json(data);
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/plans', (req,res)=> res.json(PLANS));
app.get('/api/trainers', (req,res)=> res.json(TRAINERS));
app.get('/api/trainers/:id', (req,res)=>{
  const t = findTrainerById(req.params.id);
  if(!t) return res.status(404).json({ error:'Trainer not found' });
  res.json(t);
});

// ---- MEMBERSHIPS (Supabase) ----

// Transform flat DB row → nested format frontend expects
function fmtMembership(m){
  return {
    id:m.id, planId:m.plan_id, category:m.category, categoryLabel:m.category_label,
    planName:m.plan_name, durationLabel:m.duration_label, price:m.price,
    durationDays:m.duration_days, sessions:m.sessions,
    member:{ name:m.member_name, email:m.member_email, phone:m.member_phone },
    startDate:m.start_date, expires:m.expires,
    trainer: m.trainer_id ? { id:m.trainer_id, name:m.trainer_name, role:m.trainer_role, initials:m.trainer_initials } : null,
    payment: m.payment_method ? { method:m.payment_method, transactionId:m.payment_transaction } : null,
    notes:m.notes||'', createdBy:m.created_by,
    createdAt:m.created_at, updatedAt:m.updated_at,
    daysRemaining:daysRemaining(m.expires), isActive:daysRemaining(m.expires)>=0
  };
}

app.get('/api/memberships', async (req,res)=>{
  try{
    const { data, error } = await supabase.from('memberships').select('*').order('created_at', { ascending:false });
    if(error) throw error;
    res.json((data||[]).map(fmtMembership));
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/memberships/by-email/:email', async (req,res)=>{
  try{
    const { data, error } = await supabase.from('memberships').select('*').ilike('member_email', req.params.email).order('created_at', { ascending:false });
    if(error) throw error;
    res.json((data||[]).map(fmtMembership));
    res.json((data||[]).map(fmtMembership));
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/memberships/:id', async (req,res)=>{
  try{
    const { data, error } = await supabase.from('memberships').select('*').eq('id', req.params.id).single();
    if(error || !data) return res.status(404).json({ error:'Membership not found' });
    res.json(fmtMembership(data));
  }catch(e){ res.status(500).json({ error:e.message }); }
});

// Mock payment
app.post('/api/payment/mock', (req,res)=>{
  const { method, cardNumber, expiry, cvv, upi } = req.body;
  if(method==='card'){
    if(!cardNumber || cardNumber.replace(/\s/g,'').length < 16) return res.status(400).json({ error:'Invalid card number' });
    if(!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) return res.status(400).json({ error:'Invalid expiry MM/YY' });
    if(!cvv || cvv.length!==3) return res.status(400).json({ error:'Invalid CVV' });
  }
  if(method==='upi'){
    if(!upi || !upi.includes('@')) return res.status(400).json({ error:'Invalid UPI ID' });
  }
  setTimeout(()=> res.json({ ok:true, transactionId:'TXN'+Math.random().toString(36).slice(2,9).toUpperCase(), message:'Payment successful' }), 700);
});

// Checkout → insert into Supabase
app.post('/api/checkout', async (req,res)=>{
  const { planId, member, startDate, payment, trainerId } = req.body;
  if(!planId || !member || !startDate) return res.status(400).json({ error:'Missing required fields: planId, member, startDate' });
  if(!member.name || !member.email || !member.phone) return res.status(400).json({ error:'Member name, email, phone required' });
  if(!/^\S+@\S+\.\S+$/.test(member.email)) return res.status(400).json({ error:'Invalid email' });
  const found = findPlanById(planId);
  if(!found) return res.status(400).json({ error:'Invalid planId' });
  let trainer = null;
  if(trainerId){ trainer = findTrainerById(trainerId); if(!trainer) return res.status(400).json({ error:'Invalid trainerId' }); }
  const expires = computeExpiry(startDate, found.plan.durationDays);
  const row = {
    id: genId(), plan_id: planId, category: found.category, category_label: found.categoryLabel,
    plan_name: found.plan.name, duration_label: found.plan.durationLabel,
    price: found.plan.price, duration_days: found.plan.durationDays, sessions: found.plan.sessions || null,
    member_name: member.name.trim(), member_email: member.email.trim().toLowerCase(), member_phone: String(member.phone).trim(),
    start_date: startDate, expires, is_active: true,
    trainer_id: trainer?trainer.id:null, trainer_name: trainer?trainer.name:null, trainer_role: trainer?trainer.role:null, trainer_initials: trainer?trainer.initials:null,
    payment_method: payment?payment.method:null, payment_transaction: payment?(payment.transactionId||'TXN'+Math.random().toString(36).slice(2,9).toUpperCase()):null,
    notes:'', created_by:'checkout', created_at: new Date().toISOString()
  };
  try{
    const { data, error } = await supabase.from('memberships').insert(row).select().single();
    if(error) throw error;
    res.status(201).json({ ok:true, membership:fmtMembership(data) });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.delete('/api/memberships/:id', async (req,res)=>{
  try{
    const { error } = await supabase.from('memberships').delete().eq('id', req.params.id);
    if(error) throw error;
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

// ---- ADMIN ROUTES ----
app.get('/api/admin/check', requireAdmin, (req,res)=> res.json({ ok:true, admin:!!req.adminUser }));

app.get('/api/admin/stats', requireAdmin, async (req,res)=>{
  try{
    const { data, error } = await supabase.from('memberships').select('*');
    if(error) throw error;
    const all = (data||[]).map(fmtMembership);
    const active = all.filter(m=>m.isActive).length;
    const expiringSoon = all.filter(m=>m.isActive && m.daysRemaining<=7).length;
    const revenue = all.reduce((s,m)=> s+(m.price||0), 0);
    const byPlan = {}; all.forEach(m=>{ byPlan[m.planName]=(byPlan[m.planName]||0)+1; });
    const byTrainer = {}; all.forEach(m=>{ const k=m.trainer?m.trainer.name:'No trainer'; byTrainer[k]=(byTrainer[k]||0)+1; });
    res.json({ total:all.length, active, expired:all.length-active, expiringSoon, revenue, byPlan, byTrainer });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/admin/clients', requireAdmin, async (req,res)=>{
  try{
    const { data, error } = await supabase.from('memberships').select('*').order('created_at', { ascending:false });
    if(error) throw error;
    res.json((data||[]).map(fmtMembership));
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.post('/api/admin/clients', requireAdmin, async (req,res)=>{
  const { name, email, phone, planId, startDate, trainerId, paymentMethod, notes } = req.body;
  if(!name || !email || !phone || !planId || !startDate) return res.status(400).json({ error:'name, email, phone, planId, startDate required' });
  if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error:'Invalid email' });
  const found = findPlanById(planId);
  if(!found) return res.status(400).json({ error:'Invalid planId' });
  let trainer = null;
  if(trainerId){ trainer = findTrainerById(trainerId); if(!trainer) return res.status(400).json({ error:'Invalid trainerId' }); }
  const expires = computeExpiry(startDate, found.plan.durationDays);
  const row = {
    id:genId(), plan_id:planId, category:found.category, category_label:found.categoryLabel,
    plan_name:found.plan.name, duration_label:found.plan.durationLabel,
    price:found.plan.price, duration_days:found.plan.durationDays, sessions:found.plan.sessions||null,
    member_name:name.trim(), member_email:email.trim().toLowerCase(), member_phone:String(phone).trim(),
    start_date:startDate, expires, is_active:true,
    trainer_id:trainer?trainer.id:null, trainer_name:trainer?trainer.name:null, trainer_role:trainer?trainer.role:null, trainer_initials:trainer?trainer.initials:null,
    payment_method:paymentMethod||null, payment_transaction:paymentMethod?('ADMIN-'+Math.random().toString(36).slice(2,7).toUpperCase()):null,
    notes:notes?String(notes).slice(0,500):'', created_by:'admin', created_at:new Date().toISOString()
  };
  try{
    const { data, error } = await supabase.from('memberships').insert(row).select().single();
    if(error) throw error;
    res.status(201).json({ ok:true, membership:data });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.put('/api/admin/clients/:id', requireAdmin, async (req,res)=>{
  const { name, email, phone, planId, startDate, trainerId, notes } = req.body;
  try{
    const { data:existing, error:fetchErr } = await supabase.from('memberships').select('*').eq('id', req.params.id).single();
    if(fetchErr || !existing) return res.status(404).json({ error:'Client not found' });
    const update = {};
    if(name) update.member_name = String(name).trim();
    if(email){ if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error:'Invalid email' }); update.member_email = String(email).trim().toLowerCase(); }
    if(phone) update.member_phone = String(phone).trim();
    if(notes !== undefined) update.notes = String(notes).slice(0,500);
    if(planId && planId !== existing.plan_id){
      const found = findPlanById(planId);
      if(!found) return res.status(400).json({ error:'Invalid planId' });
      update.plan_id = planId; update.category = found.category; update.category_label = found.categoryLabel;
      update.plan_name = found.plan.name; update.duration_label = found.plan.durationLabel;
      update.price = found.plan.price; update.duration_days = found.plan.durationDays; update.sessions = found.plan.sessions||null;
    }
    if(startDate) update.start_date = startDate;
    const newStartDate = update.start_date || existing.start_date;
    const newDuration = update.duration_days || existing.duration_days;
    update.expires = computeExpiry(newStartDate, newDuration);
    update.is_active = daysRemaining(update.expires) >= 0;
    if(trainerId !== undefined){
      if(!trainerId){ update.trainer_id=null; update.trainer_name=null; update.trainer_role=null; update.trainer_initials=null; }
      else { const t=findTrainerById(trainerId); if(!t) return res.status(400).json({ error:'Invalid trainerId' }); update.trainer_id=t.id; update.trainer_name=t.name; update.trainer_role=t.role; update.trainer_initials=t.initials; }
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('memberships').update(update).eq('id', req.params.id).select().single();
    if(error) throw error;
    res.json({ ok:true, membership:data });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

app.delete('/api/admin/clients/:id', requireAdmin, async (req,res)=>{
  try{
    const { error } = await supabase.from('memberships').delete().eq('id', req.params.id);
    if(error) throw error;
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ error:e.message }); }
});

// SPA fallback
app.get('*', (req,res)=>{
  const candidates = [frontendPath, publicPath].map(p=> path.join(p,'index.html'));
  for(const c of candidates){ if(fs.existsSync(c)) return res.sendFile(c); }
  res.status(404).send('Frontend not found');
});

if(!process.env.VERCEL){
  app.listen(PORT, ()=> console.log(`\n🏋️ SKYFIT ZONE API running on http://localhost:${PORT}\n`));
}

module.exports = app;
