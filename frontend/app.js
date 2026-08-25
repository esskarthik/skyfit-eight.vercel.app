const API = ['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:4000' : location.origin;
let PLANS = null;
let TRAINERS = [];
let selectedPlanId = 'gym-monthly';
let selectedTrainerId = localStorage.getItem('skyfit_trainer') || '';
let currentPay = 'card';
let activeMembership = null;
let trainerFilter = 'all';

// utils
const fmtINR = n => '₹' + Number(n).toLocaleString('en-IN');
const fmtDate = s => new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), 2600);
}
function daysRemaining(expiresStr){
  const a=new Date(); a.setHours(0,0,0,0);
  const b=new Date(expiresStr); b.setHours(0,0,0,0);
  return Math.ceil((b-a)/86400000);
}

// fetch plans
async function loadPlans(){
  try{
    const r=await fetch(API+'/api/plans');
    if(!r.ok) throw 0;
    PLANS = await r.json();
  }catch(e){
    PLANS = {
      gym:{id:'gym',label:'Normal Gym Membership',plans:[
        {id:'gym-monthly',name:'1 Month',durationLabel:'1 Month',price:1299,durationDays:30},
        {id:'gym-quarterly',name:'3 Months',durationLabel:'3 Months',price:3499,durationDays:90,tag:'POPULAR',save:'Save ₹398'},
        {id:'gym-halfyearly',name:'6 Months',durationLabel:'6 Months',price:5499,durationDays:180,tag:'VALUE',save:'Save ₹2295'},
        {id:'gym-yearly',name:'Annual',durationLabel:'12 Months',price:9999,durationDays:365,tag:'BEST VALUE',save:'Save ₹5589'}
      ]},
      personal:{id:'personal',label:'Personal Training',plans:[
        {id:'pt-onetime',name:'One-to-One',durationLabel:'Per Session',price:5000,durationDays:30},
        {id:'pt-quarterly',name:'3 Months',durationLabel:'3 Months',price:13000,durationDays:90,tag:'POPULAR'},
        {id:'pt-halfyearly',name:'6 Months',durationLabel:'6 Months',price:24000,durationDays:180,tag:'VALUE'},
        {id:'pt-yearly',name:'Annual',durationLabel:'12 Months',price:45000,durationDays:365,tag:'BEST VALUE'}
      ]},
      transformation:{id:'transformation',label:'Transformation Program',plans:[
        {id:'transform-monthly',name:'1 Month',durationLabel:'1 Month',price:1499,durationDays:30},
        {id:'transform-quarterly',name:'3 Months',durationLabel:'3 Months',price:3999,durationDays:90,tag:'POPULAR',save:'Save ₹498'},
        {id:'transform-halfyearly',name:'6 Months',durationLabel:'6 Months',price:6999,durationDays:180,tag:'VALUE',save:'Save ₹1995'},
        {id:'transform-yearly',name:'Annual',durationLabel:'12 Months',price:11999,durationDays:365,tag:'BEST VALUE',save:'Save ₹5989'}
      ]},
      elite:{id:'elite',label:'SKYFIT ELITE',plans:[
        {id:'elite-yearly',name:'SKYFIT ELITE',durationLabel:'Per Year',price:60000,durationDays:365,tag:'ELITE',featured:true,includes:['Unlimited gym access','Personal training sessions','Diet consultation','Body composition tracking','Priority trainer support','Transformation challenges','Exclusive member benefits']}
      ]}
    };
  }
  renderPlans('gym');
  populatePlanSelect();
}

async function loadTrainers(){
  try{
    const r=await fetch(API+'/api/trainers');
    if(!r.ok) throw 0;
    TRAINERS = await r.json();
  }catch(e){
    TRAINERS = [
      { id:'t-naveen', name:'NAVEEN', role:'Strength & Conditioning', exp:'8 yrs', rating:4.9, clients:320, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'National powerlifting medalist.', available:['Mon','Wed','Fri'], initials:'NA', color:'#1A1D2E' },
      { id:'t-aravind', name:'ARAVIND', role:'Yoga & Wellness', exp:'6 yrs', rating:4.8, clients:240, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'RYT-500 mobility expert.', available:['Tue','Thu','Sat'], initials:'AR', color:'#7A1C20' },
      { id:'t-uday', name:'UDAY KUMAR', role:'CrossFit L2 Coach', exp:'7 yrs', rating:4.9, clients:280, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'CrossFit Games regional athlete.', available:['Mon-Fri 7AM'], initials:'UK', color:'#0F2A3A' },
      { id:'t-shinu', name:'SHINU', role:'Transformation Specialist', exp:'6 yrs', rating:5.0, clients:310, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'300+ transformations.', available:['All week'], initials:'SH', color:'#9A2A12' },
      { id:'t-vamsi', name:'VAMSI', role:'Elite Performance', exp:'9 yrs', rating:4.9, clients:350, speciality:['Fat Loss','Weight Gain','Strength','Cardio'], bio:'Elite performance lead.', available:['Mon-Sat'], initials:'VA', color:'#2A1E5A' }
    ];
  }
  renderTrainers();
  populateTrainerSelect();
  updateTrainerBanner();
}

function findPlan(id){
  for(const cat of Object.values(PLANS)){
    const p=cat.plans.find(x=>x.id===id);
    if(p) return {cat, plan:p};
  }
  return null;
}
function findTrainer(id){ return TRAINERS.find(t=>t.id===id) || null; }

function renderPlans(tab){
  const mount=document.getElementById('plansMount');
  const cat = PLANS[tab];
  if(!cat){ mount.innerHTML=''; return; }
  const isSingle = cat.plans.length===1;
  const gridClass = isSingle? 'plans-grid cols-1' : (cat.plans.length===3? 'plans-grid cols-3':'plans-grid');
  let featuresMap={
    gym:['Strength training','Bodybuilding','Weight Gain','Muscle Toning','Fitness assessment'],
    personal:['Dedicated personal trainer','Personalized workout','Form correction','Progress tracking','Weekly assessment'],
    transformation:['Strength training','Cardio & endurance','Weight Loss','Weight Gain','Body transformation','Flexibility'],
    elite:['Unlimited gym access','Personal training sessions','Diet consultation','Body composition tracking','Priority trainer support','Transformation challenges','Exclusive member benefits']
  };
  mount.innerHTML = `
    <div class="${gridClass}">
      ${cat.plans.map(p=>{
        const feats = p.includes || featuresMap[tab] || [];
        const badge = p.tag? `<div class="p-badge ${p.tag==='POPULAR'||p.tag==='BEST VALUE'?'cyan':''}">${p.tag}</div>` : '';
        const cls = p.featured? 'p-card featured' : (p.tag? 'p-card popular':'p-card');
        const pricePer = tab==='gym' && p.id==='gym-monthly' ? '<small>/ MONTH</small>' : `<small>/ ${p.durationLabel.toUpperCase()}</small>`;
        const ctaLabel = tab==='transformation' ? 'START NOW 🔥' : (tab==='elite'?'JOIN ELITE ⭐':'JOIN NOW');
        return `<div class="${cls}">
          ${badge}
          <div class="p-head"><p>${cat.label}</p><h3>${p.name}</h3></div>
          <div class="p-price">${fmtINR(p.price)} ${pricePer}</div>
          ${p.save? `<div class="p-save">${p.save}</div>`:''}
          <ul class="p-features">${feats.map(f=> `<li><i class="fa-solid fa-check"></i> ${f}</li>`).join('')}</ul>
          <button class="btn btn-primary btn-block" onclick="openCheckout('${p.id}')">${ctaLabel} <i class="fa-solid fa-arrow-right"></i></button>
        </div>`;
      }).join('')}
    </div>
    ${tab==='gym'? `<p style="text-align:center;color:var(--muted);font-size:13px;margin-top:12px">All gym plans include: Cardio & weight training • Locker • Fitness assessment</p>`:''}
  `;
}

function populatePlanSelect(){
  const sel=document.getElementById('mPlanSelect');
  let opts='';
  for(const cat of Object.values(PLANS)){
    for(const p of cat.plans){
      opts+=`<option value="${p.id}">${cat.label} — ${p.name} (${p.durationLabel}) — ${fmtINR(p.price)}</option>`;
    }
  }
  sel.innerHTML=opts;
  sel.value=selectedPlanId;
  sel.onchange=e=> { selectedPlanId=e.target.value; updateSelectedPlanBox(); updateExpiryPreview(); updatePaySummary(); };
}

function populateTrainerSelect(){
  const sel=document.getElementById('mTrainerSelect');
  if(!sel) return;
  let opts='<option value="">-- No trainer / Decide later --</option>';
  TRAINERS.forEach(t=> opts+=`<option value="${t.id}">${t.name} — ${t.role} (${t.exp}) ★${t.rating}</option>`);
  sel.innerHTML=opts;
  sel.value=selectedTrainerId;
  sel.onchange=e=> { selectedTrainerId=e.target.value; if(selectedTrainerId) localStorage.setItem('skyfit_trainer', selectedTrainerId); else localStorage.removeItem('skyfit_trainer'); updateTrainerBanner(); renderTrainers(trainerFilter); };
}

function renderTrainers(filter='all'){
  trainerFilter=filter;
  const grid=document.getElementById('trainerGrid');
  if(!grid) return;
  let list=TRAINERS;
  if(filter!=='all') list=TRAINERS.filter(t=> t.speciality.some(s=> s.toLowerCase().includes(filter.toLowerCase())));
  grid.innerHTML = list.map(t=>{
    const isSel = t.id===selectedTrainerId;
    return `<div class="t-card ${isSel?'selected':''}" data-id="${t.id}">
      <div class="t-avatar" style="background:${t.color}">${t.initials}</div>
      <h3>${t.name}</h3>
      <span class="t-role">${t.role} • ${t.exp} • ★${t.rating}</span>
      <p>${t.bio}</p>
      <div class="t-tags">${t.speciality.map(s=>`<span>${s}</span>`).join('')}</div>
      <div class="t-meta"><span><i class="fa-solid fa-users"></i> ${t.clients} clients</span><span><i class="fa-regular fa-calendar"></i> ${t.available.join(', ')}</span></div>
      <button class="btn ${isSel?'btn-primary':'btn-outline'} btn-select" onclick="selectTrainer('${t.id}')">${isSel?'<i class=\"fa-solid fa-check\"></i> Selected':'Select Trainer'}</button>
      <button class="btn btn-ghost" style="margin-top:8px;width:100%;font-size:12px" onclick="viewTrainer('${t.id}')"><i class="fa-regular fa-eye"></i> View Profile</button>
    </div>`;
  }).join('');
  // update filter buttons active
  document.querySelectorAll('.trainer-filters .btn').forEach(b=> b.classList.toggle('active', b.dataset.filter===filter));
}

function filterTrainers(tag){ renderTrainers(tag); }

function selectTrainer(id){
  if(selectedTrainerId===id){
    selectedTrainerId='';
    localStorage.removeItem('skyfit_trainer');
    toast('Trainer deselected');
  } else {
    selectedTrainerId=id;
    localStorage.setItem('skyfit_trainer', id);
    const t=findTrainer(id);
    toast(`Selected ${t.name} — will be linked on checkout`);
  }
  updateTrainerBanner();
  populateTrainerSelect();
  renderTrainers(trainerFilter);
}

function updateTrainerBanner(){
  const b=document.getElementById('selectedTrainerBanner');
  if(!b) return;
  if(selectedTrainerId){
    const t=findTrainer(selectedTrainerId);
    if(t){
      b.style.display='flex';
      b.innerHTML=`<span style="width:32px;height:32px;border-radius:50%;background:${t.color};color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px">${t.initials}</span> Selected: <b>${t.name}</b> • ${t.role} <button class="btn btn-ghost" style="margin-left:auto;padding:6px 10px;font-size:12px" onclick="selectTrainer('${t.id}')"><i class="fa-solid fa-xmark"></i> Clear</button> <button class="btn btn-primary" style="padding:6px 12px;font-size:12px" onclick="openCheckout()">Join with ${t.name.split(' ')[0]}</button>`;
      return;
    }
  }
  b.style.display='none';
  b.innerHTML='';
}

function viewTrainer(id){
  const t=findTrainer(id);
  if(!t) return;
  const body=document.getElementById('trainerModalBody');
  body.innerHTML=`
    <div style="text-align:center">
      <div class="t-avatar" style="width:80px;height:80px;font-size:22px;background:${t.color};margin:0 auto 12px">${t.initials}</div>
      <h3 style="font-family:'Bebas Neue',sans-serif;font-size:28px">${t.name}</h3>
      <p style="color:var(--accent);font-weight:700">${t.role} • ${t.exp} • ★${t.rating} • ${t.clients} clients</p>
    </div>
    <p style="color:var(--muted);margin:12px 0">${t.bio}</p>
    <div class="t-tags" style="justify-content:center;margin-bottom:10px">${t.speciality.map(s=>`<span>${s}</span>`).join('')}</div>
    <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;font-size:13px;display:grid;gap:6px">
      <div style="display:flex;justify-content:space-between"><span>Available</span><b>${t.available.join(', ')}</b></div>
      <div style="display:flex;justify-content:space-between"><span>Rating</span><b>★ ${t.rating} / 5.0</b></div>
      <div style="display:flex;justify-content:space-between"><span>Experience</span><b>${t.exp}</b></div>
    </div>
    <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="selectTrainer('${t.id}'); closeTrainerModal();">Select ${t.name.split(' ')[0]} <i class="fa-solid fa-check"></i></button>
  `;
  document.getElementById('trainerModal').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeTrainerModal(){ document.getElementById('trainerModal').classList.remove('open'); document.body.style.overflow=''; }

// Tabs
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderPlans(btn.dataset.tab);
  });
});

// NAV hamburger & scroll spy
document.getElementById('hamburger').onclick=()=> document.getElementById('navLinks').classList.toggle('open');
document.querySelectorAll('#navLinks a').forEach(a=> a.onclick=()=> document.getElementById('navLinks').classList.remove('open'));
window.addEventListener('scroll',()=>{
  const y=scrollY+120;
  document.querySelectorAll('section[id]').forEach(s=>{
    const a=document.querySelector(`#navLinks a[href="#${s.id}"]`);
    if(!a) return;
    const top=s.offsetTop, bot=top+s.offsetHeight;
    if(y>=top && y<bot) {document.querySelectorAll('#navLinks a').forEach(x=>x.classList.remove('active')); a.classList.add('active');}
  });
});

// Dashboard
function loadLocalMembership(){
  try{ const raw=localStorage.getItem('skyfit_active'); if(raw) return JSON.parse(raw);}catch(e){}
  return null;
}
function saveLocalMembership(m){ localStorage.setItem('skyfit_active', JSON.stringify(m)); if(m.member?.email) localStorage.setItem('skyfit_email', m.member.email); if(m.trainer?.id) { selectedTrainerId=m.trainer.id; localStorage.setItem('skyfit_trainer', m.trainer.id); } }

async function renderDashboard(){
  const mount=document.getElementById('dashboardMount');
  let membership = loadLocalMembership();
  const email = localStorage.getItem('skyfit_email');
  if(email){
    try{
      const r=await fetch(API+`/api/memberships/by-email/${encodeURIComponent(email)}`);
      if(r.ok){ const list=await r.json(); if(list.length) membership=list[0]; }
    }catch(e){}
  }
  activeMembership = membership;
  if(!membership){
    mount.innerHTML = `<div class="dash-empty"><h3>No active membership yet</h3><p>Choose a plan and activate — your membership card with start date, expiry & days remaining will appear here.</p><button class="btn btn-primary" onclick="document.getElementById('memberships').scrollIntoView({behavior:'smooth'})">View Plans</button></div>`;
    return;
  }
  const dr = membership.daysRemaining ?? daysRemaining(membership.expires);
  const isActive = dr >=0;
  const progress = (()=> {
    const total=membership.durationDays||30;
    const left=Math.max(0,dr);
    const used= total - left;
    return Math.max(0, Math.min(100, Math.round(used/total*100)));
  })();
  const statusBadge = isActive? `<span class="badge-active">● ACTIVE MEMBERSHIP</span>` : `<span class="badge-expired">● EXPIRED</span>`;
  const trainer = membership.trainer || (selectedTrainerId ? findTrainer(selectedTrainerId) : null);
  const trainerBlock = trainer ? `<div style="display:flex;gap:10px;align-items:center;background:linear-gradient(135deg, rgba(255,74,30,.12), rgba(122,28,32,.12));border:1px solid rgba(255,74,30,.25);border-radius:14px;padding:12px"><div style="width:40px;height:40px;border-radius:50%;background:${trainer.color||'#1A1D2E'};color:#fff;display:grid;place-items:center;font-weight:800">${trainer.initials||trainer.name.split(' ').map(s=>s[0]).join('')}</div><div><b style="font-size:14px">${trainer.name}</b><br><span style="font-size:12px;color:var(--muted)">${trainer.role||''} ${trainer.exp? '• '+trainer.exp:''}</span></div><button class="btn btn-ghost" style="margin-left:auto;font-size:12px" onclick="document.getElementById('trainers').scrollIntoView({behavior:'smooth'})">Change</button></div>` : `<div style="background:rgba(255,255,255,.05);border:1px dashed rgba(255,255,255,.15);border-radius:12px;padding:12px;font-size:13px;display:flex;align-items:center;gap:10px"><i class="fa-solid fa-user-plus" style="color:var(--muted)"></i> No trainer assigned <button class="btn btn-outline" style="margin-left:auto;padding:6px 10px;font-size:12px" onclick="document.getElementById('trainers').scrollIntoView({behavior:'smooth'})">Select Trainer</button></div>`;
  mount.innerHTML = `
    <div class="dash-card">
      <div class="dash-top">
        <div>
          <div class="dash-title">${membership.categoryLabel || membership.planName} — ${membership.planName}</div>
          <div style="color:var(--muted);font-size:13px">Member: <b style="color:#fff">${membership.member?.name||'-'}</b> • ${membership.member?.email||''} ${membership.member?.phone? '• '+membership.member.phone:''}</div>
        </div>
        ${statusBadge}
      </div>
      ${trainerBlock}
      <div class="dash-grid">
        <div class="dash-stat"><span>Started</span><b>${fmtDate(membership.startDate)}</b></div>
        <div class="dash-stat"><span>Expires</span><b>${fmtDate(membership.expires)}</b></div>
        <div class="dash-stat"><span>Days Remaining</span><b style="color:${isActive?'#22c55e':'#ef4444'}">${Math.max(0,dr)} days</b></div>
        <div class="dash-stat"><span>Plan price</span><b>${fmtINR(membership.price)}</b></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px"><span>Progress</span><span>${progress}% elapsed</span></div>
        <div class="dash-progress"><i style="width:${progress}%"></i></div>
      </div>
      ${membership.sessions? `<div style="display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px"><i class="fa-solid fa-dumbbell" style="color:var(--accent)"></i><span style="font-size:13px">Sessions: <b>${membership.sessionsUsed||0} / ${membership.sessions}</b> used</span><button class="btn btn-ghost" style="margin-left:auto;padding:6px 10px;font-size:12px" onclick="logSession()">+ Log session</button></div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="downloadReceipt()"><i class="fa-solid fa-download"></i> Receipt</button>
        <button class="btn btn-ghost" onclick="cancelMembership()"><i class="fa-regular fa-trash-can"></i> Cancel membership</button>
        <span style="margin-left:auto;color:var(--muted);font-size:12px">ID: ${membership.id}</span>
      </div>
    </div>
  `;
}
function scrollToDashboard(){ document.getElementById('progress').scrollIntoView({behavior:'smooth'}); }
function promptLookup(){
  const email=prompt('Enter your email to lookup membership:');
  if(!email) return;
  localStorage.setItem('skyfit_email', email.trim().toLowerCase());
  renderDashboard();
  toast('Looking up membership for '+email);
}
function logSession(){
  if(!activeMembership || !activeMembership.sessions) return;
  activeMembership.sessionsUsed = Math.min(activeMembership.sessions, (activeMembership.sessionsUsed||0)+1);
  saveLocalMembership(activeMembership);
  renderDashboard();
  toast('Session logged — '+(activeMembership.sessionsUsed)+'/'+activeMembership.sessions);
}
function cancelMembership(){
  if(!confirm('Cancel your active membership? This cannot be undone.')) return;
  localStorage.removeItem('skyfit_active');
  if(activeMembership?.id){
    fetch(API+'/api/memberships/'+activeMembership.id,{method:'DELETE'}).catch(()=>{});
  }
  activeMembership=null;
  renderDashboard();
  toast('Membership cancelled');
}
function downloadReceipt(){
  if(!activeMembership) return;
  const trainerLine = activeMembership.trainer ? `Trainer: ${activeMembership.trainer.name} (${activeMembership.trainer.role})` : `Trainer: Not assigned`;
  const txt = `SKYFIT ZONE - RECEIPT
--------------------------
ID: ${activeMembership.id}
Member: ${activeMembership.member.name} (${activeMembership.member.email})
Plan: ${activeMembership.planName} - ${activeMembership.durationLabel}
Price: ${fmtINR(activeMembership.price)}
Start: ${fmtDate(activeMembership.startDate)}
Expires: ${fmtDate(activeMembership.expires)}
Days remaining: ${activeMembership.daysRemaining ?? daysRemaining(activeMembership.expires)}
${trainerLine}
--------------------------
Thank you for choosing SKYFIT ZONE!
`;
  const blob=new Blob([txt],{type:'text/plain'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`SKYFIT-${activeMembership.id}.txt`; a.click(); URL.revokeObjectURL(url);
}

// Checkout modal logic
function openCheckout(planId){
  if(planId) selectedPlanId=planId;
  document.getElementById('mPlanSelect').value=selectedPlanId;
  // sync trainer select with global selected
  const ts=document.getElementById('mTrainerSelect');
  if(ts) ts.value=selectedTrainerId;
  updateSelectedPlanBox();
  updateExpiryPreview();
  updatePaySummary();
  const prev = loadLocalMembership();
  if(prev?.member){
    document.getElementById('mName').value=prev.member.name||'';
    document.getElementById('mEmail').value=prev.member.email||'';
    document.getElementById('mPhone').value=prev.member.phone||'';
  }
  const today=new Date().toISOString().split('T')[0];
  document.getElementById('mStartDate').value=today;
  document.getElementById('checkoutOverlay').classList.add('open');
  goStep(1);
  document.body.style.overflow='hidden';
}
function closeCheckout(){
  document.getElementById('checkoutOverlay').classList.remove('open');
  document.body.style.overflow='';
}
function updateSelectedPlanBox(){
  const f=findPlan(selectedPlanId);
  if(!f) return;
  const tr = findTrainer(document.getElementById('mTrainerSelect')?.value) || findTrainer(selectedTrainerId);
  const trainerNote = tr ? `<div style="margin-top:6px;font-size:12px;color:var(--accent)"><i class="fa-solid fa-user-check"></i> Trainer: <b>${tr.name}</b> • ${tr.role}</div>` : `<div style="margin-top:6px;font-size:11px;color:var(--muted)">No trainer selected — you can add later</div>`;
  document.getElementById('selectedPlanBox').innerHTML=`
    <div><b>${f.cat.label} — ${f.plan.name}</b><br><small>${f.plan.durationLabel} • ${f.plan.durationDays} days</small>${trainerNote}</div>
    <div style="text-align:right"><b style="font-size:18px">${fmtINR(f.plan.price)}</b><br><small>${f.plan.sessions? f.plan.sessions+' sessions':''}</small></div>
  `;
}
function goStep(n){
  if(n===2){
    const name=document.getElementById('mName').value.trim();
    const email=document.getElementById('mEmail').value.trim();
    const phone=document.getElementById('mPhone').value.trim();
    if(!name || !email || !phone){ toast('Please fill name, email and phone'); return; }
    if(!/^\S+@\S+\.\S+$/.test(email)){ toast('Invalid email'); return; }
    if(!/^\d{10}$/.test(phone)){ toast('Phone must be 10 digits'); return; }
    selectedPlanId=document.getElementById('mPlanSelect').value;
    selectedTrainerId=document.getElementById('mTrainerSelect').value;
    if(selectedTrainerId) localStorage.setItem('skyfit_trainer', selectedTrainerId); else localStorage.removeItem('skyfit_trainer');
    updateTrainerBanner(); renderTrainers(trainerFilter);
    updateSelectedPlanBox();
  }
  if(n===3){
    const sd=document.getElementById('mStartDate').value;
    if(!sd){ toast('Choose a start date'); return; }
  }
  document.querySelectorAll('.m-step').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.stepper .step').forEach(s=> s.classList.remove('active'));
  if(n===1){ document.getElementById('mStep1').classList.add('active'); setStepper(1); }
  else if(n===2){ document.getElementById('mStep2').classList.add('active'); setStepper(2); updateExpiryPreview(); }
  else if(n===3){ document.getElementById('mStep3').classList.add('active'); setStepper(3); updatePaySummary(); }
}
function setStepper(n){
  document.querySelectorAll('.stepper .step').forEach(s=>{
    const v=Number(s.dataset.s);
    s.classList.toggle('active', v===n);
  });
}
function setStartOffset(days){
  const d=new Date(); d.setDate(d.getDate()+days);
  document.getElementById('mStartDate').value=d.toISOString().split('T')[0];
  updateExpiryPreview();
}
function updateExpiryPreview(){
  const f=findPlan(selectedPlanId);
  const sd=document.getElementById('mStartDate').value;
  const box=document.getElementById('expiryPreview');
  if(!f || !sd){ box.textContent=''; return;}
  const start=new Date(sd);
  const exp=new Date(start); exp.setDate(exp.getDate()+f.plan.durationDays);
  const dr=daysRemaining(exp.toISOString().split('T')[0]);
  box.innerHTML=`<b>Starts:</b> ${fmtDate(sd)} &nbsp; <b>Expires:</b> ${fmtDate(exp.toISOString().split('T')[0])} &nbsp; <span style="color:var(--accent)">• ${f.plan.durationDays} days • ${Math.max(0,dr)} days remaining from today</span>`;
}
document.getElementById('mStartDate')?.addEventListener('change', updateExpiryPreview);
function switchPay(m){
  currentPay=m;
  document.querySelectorAll('.pay-tab').forEach(b=> b.classList.toggle('active', b.dataset.pay===m));
  document.getElementById('payCard').style.display= m==='card'?'block':'none';
  document.getElementById('payUpi').style.display= m==='upi'?'block':'none';
  document.getElementById('payCash').style.display= m==='cash'?'block':'none';
  updatePaySummary();
}
function updatePaySummary(){
  const f=findPlan(selectedPlanId);
  if(!f) return;
  const sd=document.getElementById('mStartDate').value;
  let exp='-';
  if(sd){ const d=new Date(sd); d.setDate(d.getDate()+f.plan.durationDays); exp=fmtDate(d.toISOString().split('T')[0]); }
  const tr=findTrainer(document.getElementById('mTrainerSelect')?.value);
  const trainerLine = tr ? `<div style="display:flex;justify-content:space-between;color:var(--accent)"><span><i class="fa-solid fa-user"></i> Trainer</span><span>${tr.name}</span></div>` : '';
  document.getElementById('paySummary').innerHTML=`
    <div style="display:flex;justify-content:space-between"><span>${f.cat.label} — ${f.plan.name}</span><b>${fmtINR(f.plan.price)}</b></div>
    <div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Duration</span><span>${f.plan.durationLabel} (${f.plan.durationDays} days)</span></div>
    <div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Start → Expires</span><span>${sd?fmtDate(sd):'-'} → ${exp}</span></div>
    ${trainerLine}
    <div style="height:1px;background:rgba(255,255,255,.08);margin:4px 0"></div>
    <div style="display:flex;justify-content:space-between"><span>Total payable</span><b style="font-size:18px">${fmtINR(f.plan.price)}</b></div>
  `;
}
document.getElementById('pCard')?.addEventListener('input', e=>{
  let v=e.target.value.replace(/\D/g,'').slice(0,16);
  e.target.value=v.replace(/(.{4})/g,'$1 ').trim();
});
document.getElementById('pExp')?.addEventListener('input', e=>{
  let v=e.target.value.replace(/\D/g,'').slice(0,4);
  if(v.length>2) v=v.slice(0,2)+'/'+v.slice(2);
  e.target.value=v;
});

async function doPayment(){
  const name=document.getElementById('mName').value.trim();
  const email=document.getElementById('mEmail').value.trim().toLowerCase();
  const phone=document.getElementById('mPhone').value.trim();
  const startDate=document.getElementById('mStartDate').value;
  const trainerId=document.getElementById('mTrainerSelect')?.value || '';
  const f=findPlan(selectedPlanId);
  if(!f){ toast('Select a plan'); return; }
  let payPayload={ method: currentPay };
  if(currentPay==='card'){
    const cn=document.getElementById('pCard').value.replace(/\s/g,'');
    const ex=document.getElementById('pExp').value;
    const cv=document.getElementById('pCvv').value;
    if(cn.length<16){ toast('Enter 16-digit card number'); return; }
    if(!/^\d{2}\/\d{2}$/.test(ex)){ toast('Expiry as MM/YY'); return; }
    if(!/^\d{3}$/.test(cv)){ toast('CVV must be 3 digits'); return; }
    payPayload.cardNumber=cn; payPayload.expiry=ex; payPayload.cvv=cv;
  } else if(currentPay==='upi'){
    const upi=document.getElementById('pUpi').value.trim();
    if(!upi.includes('@')){ toast('Enter valid UPI ID'); return; }
    payPayload.upi=upi;
  }
  const btn=document.getElementById('payBtn');
  btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
  try{
    const pr=await fetch(API+'/api/payment/mock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payPayload)});
    if(!pr.ok){ const er=await pr.json(); throw new Error(er.error||'Payment failed'); }
    const pRes=await pr.json();
    const cr=await fetch(API+'/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      planId: selectedPlanId,
      member:{name,email,phone},
      startDate,
      trainerId: trainerId || undefined,
      payment:{ method: currentPay, transactionId: pRes.transactionId || 'CASH-RESERVED'}
    })});
    if(!cr.ok){ const er=await cr.json(); throw new Error(er.error||'Checkout failed'); }
    const cRes=await cr.json();
    const m=cRes.membership;
    saveLocalMembership(m);
    if(trainerId) { selectedTrainerId=trainerId; localStorage.setItem('skyfit_trainer', trainerId); }
    showSuccess(m);
    renderDashboard();
    updateTrainerBanner(); renderTrainers(trainerFilter);
  }catch(err){
    if(err.message.includes('Failed to fetch') || err.message.includes('NetworkError')){
      const expD=new Date(startDate); expD.setDate(expD.getDate()+f.plan.durationDays);
      const tr=findTrainer(trainerId);
      const m={
        id:'SFZ-'+Date.now().toString(36).toUpperCase(),
        planId:selectedPlanId, category:f.cat.id, categoryLabel:f.cat.label, planName:f.plan.name,
        durationLabel:f.plan.durationLabel, price:f.plan.price, durationDays:f.plan.durationDays,
        sessions:f.plan.sessions||null, sessionsUsed:0,
        trainer: tr ? { id: tr.id, name: tr.name, role: tr.role, initials: tr.initials, color: tr.color } : null,
        member:{name,email,phone}, startDate, expires: expD.toISOString().split('T')[0],
        daysRemaining: daysRemaining(expD.toISOString().split('T')[0]),
        payment:{method:currentPay, transactionId:'LOCAL-'+Math.random().toString(36).slice(2,8).toUpperCase()},
        createdAt:new Date().toISOString()
      };
      saveLocalMembership(m);
      if(trainerId) localStorage.setItem('skyfit_trainer', trainerId);
      showSuccess(m);
      renderDashboard();
      updateTrainerBanner(); renderTrainers(trainerFilter);
      toast('Backend offline — saved locally');
    } else {
      toast(err.message);
    }
  } finally {
    btn.disabled=false; btn.innerHTML='Pay & Activate <i class="fa-solid fa-bolt"></i>';
  }
}

function showSuccess(m){
  document.querySelectorAll('.m-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('mStepSuccess').classList.add('active');
  document.querySelectorAll('.stepper .step').forEach(s=>s.classList.remove('active'));
  const dr=m.daysRemaining ?? daysRemaining(m.expires);
  const trainerLine = m.trainer ? `<div style="display:flex;justify-content:space-between;color:var(--accent)"><span>Trainer</span><b>${m.trainer.name} • ${m.trainer.role}</b></div>` : `<div style="display:flex;justify-content:space-between;color:var(--muted)"><span>Trainer</span><span>Not assigned</span></div>`;
  document.getElementById('successText').textContent=`Welcome ${m.member.name}! Your ${m.planName} is now active.`;
  document.getElementById('successCard').innerHTML=`
    <div style="display:flex;justify-content:space-between"><span>Plan</span><b>${m.categoryLabel} — ${m.planName}</b></div>
    ${trainerLine}
    <div style="display:flex;justify-content:space-between"><span>Amount paid</span><b>${fmtINR(m.price)} • ${m.payment?.method||'card'}</b></div>
    <div style="display:flex;justify-content:space-between"><span>Start</span><b>${fmtDate(m.startDate)}</b></div>
    <div style="display:flex;justify-content:space-between"><span>Expires</span><b>${fmtDate(m.expires)}</b></div>
    <div style="display:flex;justify-content:space-between;color:var(--accent)"><span>Days remaining</span><b>${Math.max(0,dr)} days</b></div>
    <div style="font-size:11px;color:var(--muted);border-top:1px dashed rgba(255,255,255,.1);padding-top:6px">ID: ${m.id} • TXN: ${m.payment?.transactionId||m.id}</div>
  `;
}

function handleContact(e){
  e.preventDefault();
  const n=document.getElementById('cName').value;
  toast('Thanks '+n+'! We will contact you shortly. Demo — no email sent.');
  e.target.reset();
  return false;
}

// init
document.getElementById('mStartDate')?.addEventListener('change', updateExpiryPreview);
document.getElementById('mTrainerSelect')?.addEventListener('change', ()=>{ selectedTrainerId=document.getElementById('mTrainerSelect').value; if(selectedTrainerId) localStorage.setItem('skyfit_trainer', selectedTrainerId); else localStorage.removeItem('skyfit_trainer'); updateTrainerBanner(); renderTrainers(trainerFilter); updateSelectedPlanBox(); updatePaySummary(); });
loadPlans().then(()=>{ renderDashboard(); });
loadTrainers();
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeCheckout(); closeTrainerModal(); }});
