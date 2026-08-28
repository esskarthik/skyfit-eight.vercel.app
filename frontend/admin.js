/* =============================================================================
   SKYFIT ZONE — Admin Panel SPA controller
   Vanilla JS · hash router · role-aware navigation · all views
   ============================================================================= */
(function () {
  const API = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:4000' : location.origin;

  // ---------------- state ----------------
  let SESSION = null; // { email, name, role }
  const ROLE_RANK = { TRAINER: 1, STAFF: 2, MANAGER: 3, ADMIN: 4 };

  // ---------------- utils ----------------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtINR = n => '₹' + Number(n || 0).toLocaleString('en-IN');
  const fmtMoney = n => Number(n || 0).toLocaleString('en-IN');
  const todayISO = () => new Date().toISOString().split('T')[0];
  const daysRemaining = exp => { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(exp + 'T00:00:00'); return Math.ceil((b - a) / 86400000); };
  function fmtDT(s) { if (!s) return '—'; try { return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s; } }
  function fmtD(s) { if (!s) return '—'; try { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { return s; } }
  function initials(name) { return String(name || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase(); }

  // Inline SVG placeholder for products/image-less entities so cards never show
  // a broken/blank image. Uses the entity's label and an accent background.
  function phImg(label, seed, size) {
    const text = encodeURIComponent((label || '?').slice(0, 2).toUpperCase());
    const bg = seed ? ['#1A1D2E', '#24314a', '#2b2140', '#14323a'][Math.abs(seed) % 4] : '#24314a';
    const s = size || 160;
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="54%" font-family="Inter,Arial" font-size="${Math.round(s / 3)}" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`)}`;
  }
  // Supplement/product image: real URL if present, else a branded placeholder.
  function supImg(s) {
    return (s && s.image_url) ? esc(s.image_url) : phImg(s ? (s.name || s.brand) : 'SUP', s && s.sort_order);
  }
  // Short human-friendly reference for an entity id (e.g. "PAY-4F3A21C5").
  function refShort(prefix, id) {
    if (!id) return '—';
    return prefix + '-' + String(id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  }

  function toast(msg, isErr) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('error', !!isErr); t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); }

  // Persistent storage helpers (localStorage survives browser restarts; the
  // refresh token lets the session auto-renew so admins aren't logged out).
  const storedGet = k => localStorage.getItem(k) || sessionStorage.getItem(k);
  const storedSet = (k, v) => { localStorage.setItem(k, v); sessionStorage.removeItem(k); };
  const storedRemove = k => { localStorage.removeItem(k); sessionStorage.removeItem(k); };

  // ---------------- HTTP ----------------
  function headers() {
    const h = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('skyfit_token') || sessionStorage.getItem('skyfit_token');
    if (token) h['authorization'] = 'Bearer ' + token;
    return h;
  }
  async function refreshToken() {
    try {
      const rt = localStorage.getItem('skyfit_refresh') || sessionStorage.getItem('skyfit_refresh');
      if (!rt) return false;
      const r = await fetch(API + '/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.id_token) {
        localStorage.setItem('skyfit_token', j.id_token);
        localStorage.setItem('skyfit_refresh', j.refresh_token || rt);
        sessionStorage.removeItem('skyfit_token');
        sessionStorage.removeItem('skyfit_refresh');
        return true;
      }
      return false;
    } catch (e) { return false; }
  }
  async function api(path, opts = {}) {
    const r = await fetch(API + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
    let j = {};
    try { j = await r.json(); } catch (e) { j = {}; }
    if (r.status === 401) {
      const ok = await refreshToken();
      if (ok) {
        const r2 = await fetch(API + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
        try { j = await r2.json(); } catch (e) { j = {}; }
        if (r2.ok) return j;
      }
      doLogout(); throw new Error('Session expired');
    }
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  // ---------------- auth ----------------
  async function doLogin() {
    const email = $('#loginEmail').value.trim();
    const pwd = $('#loginPwd').value;
    const err = $('#loginErr'); err.style.display = 'none';
    const btn = $('#loginBtn'); btn.disabled = true; btn.innerHTML = 'Signing in…';
    try {
      if (!email || !pwd) throw new Error('Enter your email and password');
      const r = await fetch(API + '/api/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pwd }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.id_token) {
        storedSet('skyfit_token', j.id_token);
        if (j.refresh_token) storedSet('skyfit_refresh', j.refresh_token);
        initApp();
      } else {
        throw new Error(j.error || 'Invalid email or password');
      }
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block';
    } finally { btn.disabled = false; btn.innerHTML = 'Unlock admin <i class="fa-solid fa-arrow-right"></i>'; }
  }
  function doLogout() {
    storedRemove('skyfit_token');
    storedRemove('skyfit_refresh');
    SESSION = null;
    $('#appView').style.display = 'none';
    $('#loginView').style.display = 'grid';
  }

  async function initApp() {
    let actor = null;
    if (storedGet('skyfit_token')) {
      const j = await api('/api/admin/check');
      if (j.actor) actor = j.actor;
    }
    if (!actor) { doLogout(); return; }
    SESSION = actor;
    $('#loginView').style.display = 'none';
    $('#appView').style.display = 'flex';
    $('#sideName').textContent = actor.name;
    $('#sideRole').textContent = actor.role;
    $('#topbarUser').textContent = actor.name.split(' ')[0];
    $('#sideAvatar').textContent = initials(actor.name);
    buildNav();
    route();
    await loadNotificationDot();
  }

  // ---------------- notifications dot ----------------
  async function loadNotificationDot() {
    try { const n = await api('/api/admin/notifications'); const unread = (n || []).filter(x => !x.read).length; $('#notifDot').style.display = unread ? 'block' : 'none'; } catch (e) { }
  }

  // ---------------- nav ----------------
  function can(role) { return ROLE_RANK[SESSION.role] >= ROLE_RANK[role]; }
  function buildNav() {
    const R = SESSION.role;
    const groups = [
      { title: '', links: [{ h: '#/dashboard', i: 'fa-solid fa-gauge-high', t: 'Dashboard' }] },
      { title: 'Members', show: !(R === 'TRAINER'), links: [
        { h: '#/members', i: 'fa-solid fa-users', t: 'All Members' },
        { h: '#/members?status=active', i: 'fa-solid fa-user-check', t: 'Active' },
        { h: '#/members?status=expiring', i: 'fa-regular fa-clock', t: 'Expiring' },
        { h: '#/members?status=expired', i: 'fa-regular fa-calendar-xmark', t: 'Expired' }
      ] },
      { title: 'Memberships', show: !(R === 'TRAINER'), links: [
        { h: '#/memberships', i: 'fa-solid fa-id-card', t: 'All Memberships' },
        { h: '#/memberships?status=active', i: 'fa-solid fa-circle-check', t: 'Active' },
        { h: '#/memberships?status=pending', i: 'fa-regular fa-hourglass-half', t: 'Pending' },
        { h: '#/memberships?status=expired', i: 'fa-regular fa-calendar-xmark', t: 'Expired' }
      ] },
      { title: 'Payments', show: !(R === 'TRAINER'), links: [
        { h: '#/payments', i: 'fa-solid fa-credit-card', t: 'Transactions' },
        { h: '#/payments?status=paid', i: 'fa-solid fa-circle-check', t: 'Paid' },
        { h: '#/payments?status=failed', i: 'fa-solid fa-triangle-exclamation', t: 'Failed' },
        { h: '#/payments?status=refunded', i: 'fa-solid fa-rotate-left', t: 'Refunds' }
      ] },
      { title: 'Operations', show: !(R === 'TRAINER'), links: [
        { h: '#/attendance', i: 'fa-solid fa-clipboard-user', t: 'Attendance' },
        { h: '#/access-control', i: 'fa-solid fa-fingerprint', t: 'Access Control' },
        { h: '#/access-log', i: 'fa-solid fa-list-check', t: 'Access Logs' },
        { h: '#/devices', i: 'fa-solid fa-microchip', t: 'Devices' },
        { h: '#/biometric', i: 'fa-solid fa-hand', t: 'Biometric' },
        { h: '#/enquiries', i: 'fa-solid fa-envelope-open-text', t: 'Enquiries' }
      ] },
      { title: 'Catalog', show: !(R === 'TRAINER'), links: [
        { h: '#/plans', i: 'fa-solid fa-rectangle-list', t: 'Plans' },
        { h: '#/services', i: 'fa-solid fa-icons', t: 'Services' },
        { h: '#/supplements', i: 'fa-solid fa-cart-shopping', t: 'Marketplace' },
        { h: '#/trainers', i: 'fa-solid fa-user-tie', t: 'Trainers' }
      ] },
      { title: 'Staff', show: !(R === 'TRAINER' || R === 'STAFF'), links: [
        { h: '#/staff', i: 'fa-solid fa-user-shield', t: 'Staff & Roles' }
      ] },
      { title: 'Fitness', show: true, links: [
        { h: '#/workouts', i: 'fa-solid fa-dumbbell', t: 'Workouts' },
        { h: '#/progress', i: 'fa-solid fa-chart-line', t: 'Progress' }
      ] },
      { title: 'Content', show: !(R === 'TRAINER'), links: [
        { h: '#/gallery', i: 'fa-regular fa-images', t: 'Gallery' },
        { h: '#/transformations', i: 'fa-solid fa-fire', t: 'Transformations' }
      ] },
      { title: 'Insights', show: !(R === 'TRAINER'), links: [
        { h: '#/reports', i: 'fa-solid fa-chart-pie', t: 'Reports' },
        { h: '#/audit', i: 'fa-solid fa-scroll', t: 'Audit Logs' }
      ] },
      { title: 'System', show: !(R === 'TRAINER'), links: [
        { h: '#/notifications', i: 'fa-regular fa-bell', t: 'Notifications' },
        { h: '#/settings', i: 'fa-solid fa-gear', t: 'Settings' }
      ] }
    ];
    const html = groups.filter(g => g.show !== false).map(g => {
      const links = g.links.filter(l => l.show !== false);
      const title = g.title ? `<div class="nav-group-title">${g.title}</div>` : '';
      return `<div class="nav-group">${title}${links.map(l => `<button class="nav-link" data-h="${l.h}" onclick="location.hash='${l.h}'"><i class="${l.i}"></i>${l.t}</button>`).join('')}</div>`;
    }).join('');
    $('#sideNav').innerHTML = html;
  }
  function highlightNav() {
    const [path] = (location.hash || '').replace(/^#/, '').split('?');
    $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.h === ('#' + path) || a.dataset.h.split('?')[0] === ('#' + path)));
  }

  // ---------------- modal helpers ----------------
  function openModal(html) { $('#modal').innerHTML = html; $('#modalOverlay').classList.add('open'); }
  function closeModal() { $('#modalOverlay').classList.remove('open'); $('#modal').innerHTML = ''; }
  let confirmCb = null;
  function confirmBox(title, msg, cb, dangerLabel) {
    $('#confirmTitle').textContent = title; $('#confirmMsg').textContent = msg;
    $('#confirmOk').textContent = dangerLabel || 'Confirm';
    confirmCb = cb; $('#confirmOverlay').classList.add('open');
  }
  function closeConfirm() { $('#confirmOverlay').classList.remove('open'); confirmCb = null; }
  window.confirmOk = () => { const c = confirmCb; closeConfirm(); c && c(); };
  window.closeConfirm = closeConfirm;

  // ---------------- form helpers ----------------
  function field(id, label, value, placeholder, type, req) { return `<label${type === 'textarea' ? '' : ''}>${label}${req ? ' <span class="em">*</span>' : ''}${type === 'textarea' ? `<textarea id="${id}" class="input" placeholder="${placeholder||''}">${esc(value === undefined ? '' : value)}</textarea>` : `<input id="${id}" class="input" type="${type || 'text'}" value="${esc(value === undefined ? '' : value)}" placeholder="${placeholder || ''}">`}</label>`; }
  function select(id, label, options, value, req, groupBy) {
    const opts = (groupBy ? optionsGroup(options, groupBy) : options).map(o => `<option value="${o.v}" ${String(o.v) === String(value) ? 'selected' : ''}>${o.t}</option>`).join('');
    return `<label>${label}${req ? ' <span class="em">*</span>' : ''}<select id="${id}" class="input">${opts}</select></label>`;
  }
  function optionsGroup(options, groupBy) {
    const groups = {};
    options.forEach(o => { (groups[o[groupBy]] = groups[o[groupBy]] || []).push(o); });
    return Object.keys(groups).map(g => `<optgroup label="${esc(g)}">${groups[g].map(o => `<option value="${o.v}">${o.t}</option>`).join('')}</optgroup>`).join('');
  }

  // ---------------- badge helper ----------------
  function statusBadge(s, dr) {
    const map = {
      ACTIVE: '<span class="badge badge-active">Active</span>',
      EXPIRED: '<span class="badge badge-expired">Expired</span>',
      PENDING: '<span class="badge badge-pending">Pending</span>',
      SUSPENDED: '<span class="badge badge-suspended">Suspended</span>',
      CANCELLED: '<span class="badge badge-cancelled">Cancelled</span>',
      ARCHIVED: '<span class="badge badge-cancelled">Archived</span>',
      PAID: '<span class="badge badge-active">Paid</span>',
      FAILED: '<span class="badge badge-expired">Failed</span>',
      REFUNDED: '<span class="badge badge-info">Refunded</span>',
      PENDING2: '<span class="badge badge-pending">Pending</span>',
      GRANTED: '<span class="badge badge-granted">Granted</span>',
      DENIED: '<span class="badge badge-denied">Denied</span>'
    };
    if (s === 'ACTIVE' && dr !== undefined && dr !== null) {
      if (dr < 0) return map.EXPIRED;
      if (dr <= 7) return `<span class="badge badge-soon">${dr}d left</span>`;
      return map.ACTIVE;
    }
    return map[s] || `<span class="badge badge-pending">${esc(s)}</span>`;
  }
  function paymentBadge(s) { if (s === 'PENDING') return statusBadge('PENDING2'); if (s === 'PAID') return statusBadge('PAID'); if (s === 'FAILED') return statusBadge('FAILED'); if (s === 'REFUNDED') return statusBadge('REFUNDED'); if (s === 'CANCELLED') return statusBadge('CANCELLED'); return `<span class="badge badge-pending">${esc(s)}</span>`; }

  // ---------------- pagination ----------------
  function pagination(view, page, total, pageSize) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `<div class="pagination"><span>Page ${page} of ${pages} • ${total} total</span>
      <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="location.hash='#/${view}?page=${page - 1}${location.hash.split('?')[1] ? '&' + location.hash.split('?')[1].split('&').filter(x => !x.startsWith('page=')).join('&') : ''}'">Prev</button>
      <button class="btn btn-sm" ${page >= pages ? 'disabled' : ''} onclick="location.hash='#/${view}?page=${page + 1}${location.hash.split('?')[1] ? '&' + location.hash.split('?')[1].split('&').filter(x => !x.startsWith('page=')).join('&') : ''}'">Next</button></div>`;
  }
  function qparams() {
    const o = {};
    (location.hash.split('?')[1] || '').split('&').forEach(p => { const [k, v] = p.split('='); if (k) o[k] = decodeURIComponent(v || ''); });
    return o;
  }

  // ---------------- CSV export ----------------
  window.exportCSV = function (rows, filename) {
    if (!rows || !rows.length) { toast('No data to export'); return; }
    const cols = Object.keys(rows[0]);
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => '"' + String(r[c] == null ? '' : r[c]).replace(/"/g, '""') + '"').join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'export.csv'; a.click(); URL.revokeObjectURL(blob);
    toast('Exported CSV ✓');
  };

  // =========================================================================
  // ROUTER
  // =========================================================================
  // Each navigation gets an incrementing token. Views render concurrently so a
  // slow/failed one never blocks the sidebar. If a stale view (one from an older
  // navigation token) finishes and would otherwise clobber the screen with the
  // wrong content, we detect it in the finally block and re-route so the display
  // always matches the current hash.
  let _navToken = 0;
  async function route() {
    if (!SESSION) return;
    const myToken = ++_navToken;
    const raw = (location.hash || '#/dashboard').replace(/^#/, '');
    const [pathPart, query] = raw.split('?');
    const seg = pathPart.split('/').filter(Boolean); // e.g. ['members','john@x.com']
    const view = seg[0] || 'dashboard';
    highlightNav();
    const p = $('#pageTitle'); p.textContent = view.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    $('#sidebar').classList.remove('open');
    try {
      switch (view) {
        case 'dashboard': await viewDashboard(); break;
        case 'members': await viewMembers(qparams()); break;
        case 'member': await viewMemberDetail(seg[1]); break;
        case 'memberships': await viewMemberships(qparams()); break;
        case 'membership': await viewMembershipDetail(seg[1]); break;
        case 'plans': await viewPlans(); break;
        case 'payments': await viewPayments(qparams()); break;
        case 'payment': await viewPaymentDetail(seg[1]); break;
        case 'services': await viewServices(); break;
        case 'supplements': await viewSupplements(qparams()); break;
        case 'trainers': await viewTrainers(); break;
        case 'trainer': await viewTrainerDetail(seg[1]); break;
        case 'staff': await viewStaff(); break;
        case 'attendance': await viewAttendance(qparams()); break;
        case 'access-control': await viewAccessControl(); break;
        case 'access-log': await viewAccessLog(qparams()); break;
        case 'devices': await viewDevices(); break;
        case 'biometric': await viewBiometric(); break;
        case 'workouts': await viewWorkouts(); break;
        case 'progress': await viewProgress(); break;
        case 'gallery': await viewGallery(); break;
        case 'transformations': await viewTransformations(); break;
        case 'enquiries': await viewEnquiries(qparams()); break;
        case 'reports': await viewReports(qparams()); break;
        case 'notifications': await viewNotifications(); break;
        case 'settings': await viewSettings(); break;
        case 'audit': await viewAudit(qparams()); break;
        default: $('#content').innerHTML = '<div class="empty"><i class="fa-regular fa-face-frown"></i>Page not found</div>';
      }
    } catch (e) {
      // Only surface the error if we are still the active navigation.
      if (myToken === _navToken) $('#content').innerHTML = `<div class="card"><h3><i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i> Error</h3><p class="muted">${esc(e.message)}</p></div>`;
    } finally {
      // A stale view finished after a newer navigation started: re-render so the
      // content matches the current hash (prevents wrong/stale page showing).
      if (myToken !== _navToken) route();
    }
  }
  window.addEventListener('hashchange', route);

  // =========================================================================
  // VIEWS
  // =========================================================================

  // ---------------- DASHBOARD ----------------
  async function viewDashboard() {
    const d = await api('/api/admin/dashboard');
    const k = d.kpis;
    const statCard = (label, val, sub, cls, icon) => `<div class="stat ${cls || ''}"><small>${label}</small><b>${esc(val)}</b><span><i class="${icon || 'fa-solid fa-circle-info'}"></i> ${esc(sub || '')}</span></div>`;
    $('#content').innerHTML = `
      <div class="stats">
        ${statCard('Total Members', k.totalMembers, 'all registered', '', 'fa-solid fa-users')}
        ${statCard('Active Members', k.activeMembers, 'paid + active', 'green', 'fa-solid fa-user-check')}
        ${statCard('New Members', k.newMembers, 'this month', '', 'fa-solid fa-user-plus')}
        ${statCard('Expired Members', k.expiredMembers, 'memberships lapsed', 'red', 'fa-regular fa-calendar-xmark')}
        ${statCard('Expiring Soon', k.expiringSoon, '≤ 7 days', 'amber', 'fa-regular fa-clock')}
        ${statCard('Today’s Attendance', k.todaysAttendance, 'entries today', 'green', 'fa-solid fa-clipboard-user')}
        ${statCard('Monthly Revenue', fmtINR(k.monthlyRevenue), 'paid this month', '', 'fa-solid fa-indian-rupee-sign')}
        ${statCard('Pending Payments', k.pendingPayments, 'awaiting payment', 'amber', 'fa-regular fa-hourglass-half')}
      </div>

      <div class="grid2">
        <div class="card"><h3><i class="fa-solid fa-clipboard-user" style="color:var(--primary)"></i> Today’s Attendance</h3>
          <ul class="plain">
            <li><span>Present</span><b style="color:var(--success)">${d.attendance.present}</b></li>
            <li><span>Denied Access</span><b style="color:var(--danger)">${d.attendance.denied}</b></li>
            <li><span>Currently Inside</span><b style="color:var(--primary)">${d.attendance.currentlyInside}</b></li>
          </ul>
        </div>
        <div class="card"><h3><i class="fa-solid fa-indian-rupee-sign" style="color:var(--primary)"></i> Revenue Overview</h3>
          <ul class="plain">
            <li><span>Today</span><b>${fmtINR(d.revenue.today)}</b></li>
            <li><span>This Week</span><b>${fmtINR(d.revenue.week)}</b></li>
            <li><span>This Month</span><b>${fmtINR(d.revenue.month)}</b></li>
            <li><span>This Year</span><b>${fmtINR(d.revenue.year)}</b></li>
          </ul>
        </div>
      </div>

      <div class="grid2">
        <div class="card"><h3><i class="fa-solid fa-id-card" style="color:var(--primary)"></i> Membership Overview</h3>
          <ul class="plain">
            <li><span>Active</span><b style="color:var(--success)">${d.membership.ACTIVE || 0}</b></li>
            <li><span>Pending</span><b>${d.membership.PENDING || 0}</b></li>
            <li><span>Expired</span><b style="color:var(--danger)">${d.membership.EXPIRED || 0}</b></li>
            <li><span>Cancelled</span><b style="color:var(--danger)">${d.membership.CANCELLED || 0}</b></li>
            <li><span>Suspended</span><b style="color:#a855f7">${d.membership.SUSPENDED || 0}</b></li>
            <li><span>Expiring Soon</span><b style="color:var(--warn)">${d.membership.expiringSoon || 0}</b></li>
          </ul>
        </div>
        <div class="card"><h3><i class="fa-solid fa-clock-rotate-left" style="color:var(--primary)"></i> Recent Activity</h3>
          <div class="recent-list">${(d.recentActivity || []).map(a => `<div class="recent-item"><span class="ic" style="background:${a.type === 'access-denied' ? 'rgba(239,68,68,.2)' : 'rgba(255,74,30,.2)'};color:${a.type === 'access-denied' ? 'var(--danger)' : 'var(--primary)'}"><i class="fa-${a.type === 'access' ? 'solid fa-door-open' : a.type === 'access-denied' ? 'solid fa-ban' : a.type === 'enquiry' ? 'regular fa-envelope' : 'solid fa-user-plus'}"></i></span><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.title)}</div><div class="muted" style="font-size:11px">${fmtDT(a.at)}</div></div></div>`).join('') || '<div class="empty">No activity yet</div>'}</div>
        </div>
      </div>

      <div class="card"><h3><i class="fa-regular fa-clock" style="color:var(--warn)"></i> Expiring Memberships</h3>
        ${(d.expiringMemberships || []).length ? `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Plan</th><th>Expiry</th><th>Days</th><th>Status</th><th></th></tr></thead><tbody>${d.expiringMemberships.map(m => `<tr><td><b>${esc(m.member.name)}</b><br><small class="muted">${esc(m.member.email)}</small></td><td>${esc(m.plan)}</td><td>${fmtD(m.expires)}</td><td><b style="color:${m.days <= 3 ? 'var(--danger)' : 'var(--warn)'}">${m.days}d</b></td><td>${statusBadge(m.status)}</td><td><button class="btn btn-sm btn-outline" onclick="location.hash='#/membership/${m.id}'">View</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No memberships expiring soon</div>'}
      </div>`;
  }

  // ---------------- MEMBERS ----------------
  async function viewMembers(q) {
    const page = parseInt(q.page || '1', 10);
    const status = q.status || '';
    const res = await api(`/api/admin/members?q=${encodeURIComponent(q.q || '')}&status=${status}&page=${page}&pageSize=15`);
    const chips = [['', 'All'], ['active', 'Active'], ['expiring', 'Expiring Soon'], ['expired', 'Expired'], ['pending', 'Pending'], ['no_membership', 'No Membership'], ['archived', 'Archived']];
    $('#content').innerHTML = `
      <div class="toolbar">
        <div class="search"><i class="fa-solid fa-magnifying-glass" style="color:var(--muted)"></i><input id="mSearch" placeholder="Search name, phone, email…" value="${esc(q.q || '')}" onkeydown="if(event.key==='Enter'){location.hash='#/members?q='+encodeURIComponent(this.value)+'&status=${status}'}"></div>
        ${can('STAFF') ? `<button class="btn btn-primary" onclick="memberForm()"><i class="fa-solid fa-user-plus"></i> Add member</button>` : ''}
      </div>
      <div class="filter-row">${chips.map(c => `<button class="chip ${status === c[0] ? 'active' : ''}" onclick="location.hash='#/members${c[0] ? '?status=' + c[0] : ''}'">${c[1]}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Phone</th><th>Membership</th><th>Status</th><th>Trainer</th><th>Expiry</th><th>Last Visit</th><th>Joined</th><th></th></tr></thead>
      <tbody>${res.data.map(m => `
        <tr>
          <td><div class="member-cell"><span class="avatar">${initials(m.name)}</span><div><b>${esc(m.name)}</b><br><small class="muted">${esc(m.email)}</small></div></div></td>
          <td class="muted">${esc(m.phone || '—')}</td>
          <td>${m.plan ? esc(m.plan) : '<span class="muted">No plan</span>'}</td>
          <td>${statusBadge(m.status, m.daysRemaining)}</td>
          <td>${m.trainer_name ? esc(m.trainer_name) : '<span class="muted">—</span>'}</td>
          <td>${m.expires ? fmtD(m.expires) : '<span class="muted">—</span>'}</td>
          <td class="muted">${m.lastVisit ? fmtD(m.lastVisit) : '—'}</td>
          <td class="muted">${fmtD(m.created_at)}</td>
          <td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="location.hash='#/member/${encodeURIComponent(m.email)}'"><i class="fa-solid fa-eye"></i></button>${can('STAFF') ? `<button class="btn btn-ghost btn-sm" onclick="memberForm('${encodeURIComponent(m.email)}')"><i class="fa-solid fa-pen"></i></button>${can('MANAGER') ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="location.hash='#/member/${encodeURIComponent(m.email)}'"><i class="fa-solid fa-archive"></i></button>` : ''}` : ''}</div></td>
        </tr>`).join('') || '<tr><td colspan="9" class="empty">No members found</td></tr>'}</tbody></table></div>
      ${pagination('members', page, res.total, 15)}`;
  }

  window.memberForm = async function (email) {
    let m = null;
    if (email && email !== 'null') { const d = await api('/api/admin/members/' + encodeURIComponent(decodeURIComponent(email))); m = d.member; }
    const plans = await api('/api/admin/plans');
    const trainers = await api('/api/admin/trainers');
    const activePlans = plans.filter(p => p.is_active !== false);
    const keepCurrentPlan = m && m.planId && !activePlans.find(p => p.id === m.planId) ? [plans.find(p => p.id === m.planId)] : [];
    const planOpts = activePlans.concat(keepCurrentPlan).map(p => ({ v: p.id, t: `${p.categoryLabel || p.category} — ${p.name} • ${fmtINR(p.price)}` + (p.is_active === false ? ' (archived)' : '') }));
    const activeTrainers = trainers.filter(t => t.status === 'active');
    const keepCurrent = m && m.trainer_id && !activeTrainers.find(t => t.id === m.trainer_id) ? [trainers.find(t => t.id === m.trainer_id)] : [];
    const trOpts = [{ v: '', t: '-- No trainer --' }, ...activeTrainers.concat(keepCurrent).map(t => ({ v: t.id, t: t.name + (t.status !== 'active' ? ' (disabled)' : '') }))];
    openModal(`<h3>${m ? 'Edit member' : 'Add member'}</h3>
      <div class="form-grid">
        ${field('fName', 'Full name', m ? m.name : '', 'e.g. Karthik', 'text', true)}
        ${field('fEmail', 'Email', m ? m.email : '', 'you@example.com', 'email', true)}
        ${field('fPhone', 'Phone', m ? m.phone : '', '10-digit mobile', 'tel', true)}
        ${select('fPlan', 'Plan', planOpts, m ? m.planId : plans[0] && plans[0].id, true)}
        ${select('fTrainer', 'Trainer', trOpts, m ? m.trainer_id : '', false)}
        ${field('fStart', 'Start date', m ? m.startDate : todayISO(), '', 'date', true)}
        ${field('fNotes', 'Notes', m ? m.notes : '', 'Goal, weight, note…', 'textarea')}
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="saveMemberBtn" onclick="saveMember('${m ? encodeURIComponent(m.email) : ''}')">${m ? 'Save changes' : 'Add member'}</button></div>`);
  };
  window.saveMember = async function (email) {
    const name = $('#fName').value.trim(), emailV = $('#fEmail').value.trim(), phone = $('#fPhone').value.trim(), planId = $('#fPlan').value, trainerId = $('#fTrainer').value, startDate = $('#fStart').value, notes = $('#fNotes').value.trim();
    if (!name || !emailV || !phone || !planId || !startDate) { toast('Fill required fields', true); return; }
    const btn = $('#saveMemberBtn'); btn.disabled = true;
    try {
      if (email) { await api('/api/admin/members/' + email, { method: 'PUT', body: JSON.stringify({ name, phone, trainerId: trainerId || null, notes }) }); toast('Member updated ✓'); }
      else { await api('/api/admin/members', { method: 'POST', body: JSON.stringify({ name, email: emailV, phone, planId, trainerId: trainerId || null, startDate, notes }) }); toast('Member added ✓'); }
      closeModal(); route();
    } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
  };

  // ---------------- MEMBER DETAIL ----------------
  async function viewMemberDetail(email) {
    const d = await api('/api/admin/members/' + encodeURIComponent(decodeURIComponent(email)));
    const m = d.member;
    const active = d.memberships.find(x => x.status === 'ACTIVE');
    const tabs = [
      ['overview', 'Overview'], ['membership', 'Membership'], ['payments', 'Payments'],
      ['attendance', 'Attendance'], ['trainer', 'Trainer'], ['workouts', 'Workouts'], ['progress', 'Progress'], ['access', 'Access']
    ];
    $('#content').innerHTML = `
      <div class="card">
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <span class="avatar" style="width:54px;height:54px;font-size:20px">${initials(m.name)}</span>
          <div style="flex:1;min-width:200px"><div style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:.5px">${esc(m.name)}</div>
            <div class="muted" style="font-size:13px">${esc(m.email)} • ${esc(m.phone || '')}</div>
            <div style="margin-top:6px">${statusBadge(m.status, m.daysRemaining)}</div></div>
          <div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="location.hash='#/members'"><i class="fa-solid fa-arrow-left"></i> Back</button>${can('STAFF') ? `<button class="btn btn-primary btn-sm" onclick="memberForm('${encodeURIComponent(m.email)}')"><i class="fa-solid fa-pen"></i> Edit</button>` : ''}</div>
        </div>
      </div>
      <div class="tabs">${tabs.map(([k, t]) => `<button class="tab" data-tab="${k}" onclick="switchTab(this,'${k}')">${t}</button>`).join('')}</div>
      <div id="memberPanels">${tabOverview(d)}${tabMembership(d)}${tabPayments(d)}${tabAttendance(d)}${tabTrainer(d)}${tabWorkouts(d)}${tabProgress(d)}${tabAccess(d, m.email)}</div>`;
    function switchTab(el, k) { $$('.tab').forEach(t => t.classList.remove('active')); el.classList.add('active'); $$('.tab-panel').forEach(p => p.id = p.id); $$('#memberPanels .tab-panel').forEach(p => p.classList.remove('active')); const target = $(`[data-panel="${k}"]`); target && target.classList.add('active'); }
    window.switchTab = switchTab;
    const first = $('#memberPanels .tab-panel'); first && first.classList.add('active');
    const firstTab = $('.tabs .tab'); firstTab && firstTab.classList.add('active');
  }
  function kv(label, val) { return `<div class="kv"><small>${esc(label)}</small><b>${val}</b></div>`; }
  function tabOverview(d) { const m = d.member; return `<div class="tab-panel" data-panel="overview"><div class="grid3">${kv('Name', esc(m.name))}${kv('Email', esc(m.email))}${kv('Phone', esc(m.phone || '—'))}${kv('Joined', fmtD(m.created_at))}${kv('Memberships', m.memberships)}${kv('Status', statusBadge(m.status, m.daysRemaining))}${kv('Current Plan', m.plan ? esc(m.plan) : '—')}${kv('Expiry', m.expires ? fmtD(m.expires) : '—')}</div></div>`; }
  function tabMembership(d) {
    const rows = d.memberships.map(x => `<tr><td>${esc(x.planName)}</td><td>${fmtD(x.startDate)}</td><td>${fmtD(x.expires)}</td><td>${fmtINR(x.price)}</td><td>${statusBadge(x.status, x.daysRemaining)}</td><td><button class="btn btn-sm btn-ghost" onclick="location.hash='#/membership/${x.id}'">View</button></td></tr>`).join('');
    return `<div class="tab-panel" data-panel="membership"><div class="card"><h3>Current & Renewal History</h3>${d.memberships.length ? `<div class="table-wrap"><table><thead><tr><th>Plan</th><th>Start</th><th>Expiry</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No memberships</div>'}</div></div>`;
  }
  function tabPayments(d) {
    const rows = d.payments.map(p => `<tr><td class="muted">${refShort('PAY', p.id)}</td><td>${esc(p.plan_name || '—')}</td><td>${fmtINR(p.amount)}</td><td>${esc(p.payment_method || '—')}</td><td>${paymentBadge(p.status)}</td><td>${fmtDT(p.created_at)}</td></tr>`).join('');
    return `<div class="tab-panel" data-panel="payments"><div class="card"><h3>Payment History</h3>${d.payments.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Plan</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No payments yet</div>'}</div></div>`;
  }
  function tabAttendance(d) {
    const granted = d.attendance.filter(a => a.status === 'GRANTED').length;
    const denied = d.attendance.filter(a => a.status === 'DENIED').length;
    const rows = d.attendance.slice(0, 50).map(a => `<tr><td>${fmtDT(a.entry_time)}</td><td>${esc(a.access_method || '—')}</td><td>${a.status === 'GRANTED' ? statusBadge('GRANTED') : statusBadge('DENIED')}</td><td class="muted">${esc(a.reason || '')}</td></tr>`).join('');
    return `<div class="tab-panel" data-panel="attendance"><div class="grid3" style="margin-bottom:14px">${kv('Total Visits', granted)}${kv('Last Visit', d.stats.lastVisit ? fmtDT(d.stats.lastVisit) : '—')}${kv('Denied Attempts', denied)}</div><div class="card"><h3>Attendance History</h3>${d.attendance.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Method</th><th>Status</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No attendance recorded</div>'}</div></div>`;
  }
  function tabTrainer(d) { const t = d.member.trainer_name; return `<div class="tab-panel" data-panel="trainer"><div class="card">${kv('Assigned Trainer', t ? esc(t) : 'Not assigned')}<div style="margin-top:12px" class="muted">Trainer notes are managed via the trainer’s Workout & Progress records.</div></div></div>`; }
  function tabWorkouts(d) {
    const rows = d.workouts.map(w => `<tr><td>${fmtD(w.date)}</td><td>${esc(w.session_type || 'Gym')}</td><td class="muted">${esc((w.notes || '').slice(0, 40))}</td><td>${esc(w.trainer_name || '—')}</td></tr>`).join('');
    return `<div class="tab-panel" data-panel="workouts"><div class="card"><h3>Workout History</h3>${d.workouts.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Session</th><th>Notes</th><th>Trainer</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No workouts recorded</div>'}</div></div>`;
  }
  function tabProgress(d) {
    const rows = d.progress.map(p => `<tr><td>${fmtD(p.recorded_date)}</td><td>${esc(p.weight ?? '—')}</td><td>${esc(p.body_fat ?? '—')}</td><td>${esc(p.muscle_mass ?? '—')}</td><td class="muted">${esc(p.notes || '')}</td></tr>`).join('');
    // weight trend
    const trend = d.progress.slice().reverse().filter(p => p.weight != null).map(p => p.weight);
    return `<div class="tab-panel" data-panel="progress"><div class="card"><h3>Weight Progress</h3>${trend.length ? `<div style="font-size:15px;font-weight:700;margin-bottom:8px">${trend.join(' kg → ')} kg</div><div class="grid3">${kv('Latest Weight', trend[trend.length - 1] + ' kg')}${kv('Start Weight', trend[0] + ' kg')}${kv('Change', ((trend[trend.length - 1] - trend[0]).toFixed(1)) + ' kg')}</div>` : '<div class="empty">No weight records</div>'}</div><div class="card"><h3>Body Composition</h3>${d.progress.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Weight</th><th>Body Fat %</th><th>Muscle Mass</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No progress records</div>'}</div></div>`;
  }
  function tabAccess(d, email) {
    // Show only device_user_id + status; never raw biometric
    const b = d.biometric || [];
    const rows = b.map(x => `<tr><td class="muted">${esc(x.device_id ? x.device_id.slice(0, 8) : '—')}</td><td class="muted">${esc(x.device_user_id)}</td><td>${statusBadge(x.status === 'REGISTERED' ? 'ACTIVE' : (x.status === 'DISABLED' ? 'CANCELLED' : 'PENDING'))}</td><td>${fmtD(x.registered_at)}</td></tr>`).join('');
    return `<div class="tab-panel" data-panel="access"><div class="card"><h3>Biometric Access</h3><div class="muted" style="font-size:12px;margin-bottom:10px">Only a safe device identifier is stored — raw biometric data is never kept.</div>${b.length ? `<div class="table-wrap"><table><thead><tr><th>Device</th><th>Device User ID</th><th>Status</th><th>Registered</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><i class="fa-solid fa-hand"></i>${escapeHTML('Not registered')}<div class="muted" style="margin-top:6px">No biometric linked to this member.</div></div>`}</div></div>`;
  }
  function escapeHTML(s) { return esc(s); }

  // ---------------- MEMBERSHIPS ----------------
  async function viewMemberships(q) {
    const page = parseInt(q.page || '1', 10);
    const status = q.status || '';
    const res = await api(`/api/admin/memberships?q=${encodeURIComponent(q.q || '')}&status=${status}&page=${page}&pageSize=15`);
    const chips = [['', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['expired', 'Expired'], ['suspended', 'Suspended'], ['cancelled', 'Cancelled']];
    $('#content').innerHTML = `
      <div class="toolbar"><div class="search"><i class="fa-solid fa-magnifying-glass" style="color:var(--muted)"></i><input placeholder="Search member, plan, ID…" value="${esc(q.q || '')}" onkeydown="if(event.key==='Enter'){location.hash='#/memberships?q='+encodeURIComponent(this.value)+'&status=${status}'}"></div></div>
      <div class="filter-row">${chips.map(c => `<button class="chip ${status === c[0] ? 'active' : ''}" onclick="location.hash='#/memberships${c[0] ? '?status=' + c[0] : ''}'">${c[1]}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Plan</th><th>Start</th><th>Expiry</th><th>Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${res.data.map(m => `<tr><td><div class="member-cell"><span class="avatar">${initials(m.member.name)}</span><div><b>${esc(m.member.name)}</b><br><small class="muted">${esc(m.member.email)}</small></div></div></td><td>${esc(m.planName)}</td><td>${fmtD(m.startDate)}</td><td>${fmtD(m.expires)}</td><td>${fmtINR(m.price)}</td><td>${statusBadge(m.status, m.daysRemaining)}</td><td><div class="row-actions"><button class="btn btn-sm btn-ghost" onclick="location.hash='#/membership/${m.id}'">View</button>${can('MANAGER') ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="deleteMembership('${m.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No memberships found</td></tr>'}</tbody></table></div>
      ${pagination('memberships', page, res.total, 15)}`;
  }

  async function viewMembershipDetail(id) {
    const d = await api('/api/admin/memberships/' + id);
    const m = d.membership;
    const actions = can('MANAGER') ? `<button class="btn btn-sm" onclick="memAction('${id}','activate')"><i class="fa-solid fa-play"></i> Activate</button>
      <button class="btn btn-sm" onclick="memAction('${id}','suspend')"><i class="fa-solid fa-pause"></i> Suspend</button>
      <button class="btn btn-sm" onclick="memAction('${id}','cancel')"><i class="fa-solid fa-ban"></i> Cancel</button>
      <button class="btn btn-sm btn-primary" onclick="renewForm('${id}')"><i class="fa-solid fa-rotate-right"></i> Renew</button>
      <button class="btn btn-sm" style="color:#ef4444" onclick="deleteMembership('${id}')"><i class="fa-solid fa-trash"></i> Delete</button>` : '';
    $('#content').innerHTML = `
      <div class="card"><h3>Membership · ${esc(m.member.name)} — ${esc(m.planName)}</h3><div class="row-actions" style="margin-bottom:12px">${actions}</div>
        <div class="grid3">${kv('Member', esc(m.member.name) + ' <span class="muted">(' + esc(m.member.email) + ')</span>')}${kv('Plan', esc(m.planName))}${kv('Price', fmtINR(m.price))}${kv('Start Date', fmtD(m.startDate))}${kv('Expiry Date', fmtD(m.expires))}${kv('Status', statusBadge(m.status, m.daysRemaining))}${kv('Days Remaining', m.daysRemaining >= 0 ? m.daysRemaining + 'd' : 'Expired')}${kv('Created', fmtDT(m.createdAt))}${kv('Updated', fmtDT(m.updatedAt))}</div>
      </div>
      <div class="card"><h3>Payments</h3>${d.payments.length ? `<div class="table-wrap"><table><thead><tr><th>Amount</th><th>Method</th><th>Razorpay Order</th><th>Status</th><th>Date</th></tr></thead><tbody>${d.payments.map(p => `<tr><td>${fmtINR(p.amount)}</td><td>${esc(p.payment_method || '—')}</td><td class="muted">${esc(p.razorpay_order_id || '—')}</td><td>${paymentBadge(p.status)}</td><td>${fmtDT(p.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No payments</div>'}</div>
      <div class="card"><h3>Timeline</h3>${d.timeline.length ? `<ul class="plain">${d.timeline.map(t => `<li><span>${esc(t.action)}</span><span class="muted">${esc(t.actor_role || '')} • ${fmtDT(t.created_at)}</span></li>`).join('')}</ul>` : '<div class="empty">No timeline events yet</div>'}</div>`;
  }
  window.memAction = async (id, action) => {
    const doIt = async () => { try { await api(`/api/admin/memberships/${id}/${action}`, { method: 'POST' }); toast('Done ✓'); route(); } catch (e) { toast(e.message, true); } };
    if (action === 'cancel') confirmBox('Cancel membership?', 'This will end the membership and remove gym access.', doIt, 'Cancel membership');
    else doIt();
  };
  window.deleteMembership = (id) => confirmBox('Delete membership?', 'The membership will be cancelled and removed from active access. Historical records are preserved.', async () => { try { await api('/api/admin/memberships/' + id, { method: 'DELETE' }); toast('Membership deleted'); route(); } catch (e) { toast(e.message, true); } }, 'Delete membership');
  window.renewForm = async (id) => {
    const plans = (await api('/api/admin/plans')).filter(p => p.is_active !== false);
    openModal(`<h3>Renew membership</h3><div class="form-grid">${select('rPlan', 'Plan', [{ v: '', t: '-- Same plan --' }, ...plans.map(p => ({ v: p.id, t: p.name + ' • ' + fmtINR(p.price) }))], '', false)}${field('rStart', 'Start date', todayISO(), '', 'date', true)}</div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="doRenew('${id}')">Renew</button></div>`);
  };
  window.doRenew = async (id) => {
    const planId = $('#rPlan').value || null, startDate = $('#rStart').value;
    try { await api(`/api/admin/memberships/${id}/renew`, { method: 'POST', body: JSON.stringify({ planId, startDate }) }); toast('Membership renewed ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };

  // ---------------- PLANS ----------------
  async function viewPlans() {
    const plans = await api('/api/admin/plans');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Plans Catalog</h3>${can('ADMIN') ? `<button class="btn btn-primary" onclick="planForm()"><i class="fa-solid fa-plus"></i> New plan</button>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Duration</th><th>Label</th><th>Tag</th><th>Status</th><th></th></tr></thead>
      <tbody>${plans.map(p => `<tr><td class="muted">${esc(p.id)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.category)}</td><td>${fmtINR(p.price)}</td><td>${p.duration_days}d</td><td>${esc(p.duration_label || p.duration_days + ' days')}</td><td>${esc(p.tag || '—')}</td><td>${p.is_active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-cancelled">Archived</span>'}</td>
      <td><div class="row-actions">${can('ADMIN') ? `<button class="btn btn-ghost btn-sm" onclick="planForm('${p.id}')"><i class="fa-solid fa-pen"></i></button>${p.is_active ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="archivePlan('${p.id}')"><i class="fa-solid fa-box-archive"></i></button>` : ''}` : ''}</div></td></tr>`).join('') || '<tr><td colspan="9" class="empty">No plans</td></tr>'}</tbody></table></div>`;
  }
  window.planForm = async (id) => {
    let p = null;
    if (id) p = (await api('/api/admin/plans')).find(x => x.id === id);
    openModal(`<h3>${p ? 'Edit plan' : 'New plan'}</h3><div class="form-grid">
      ${field('pId', 'ID (unique key)', p ? p.id : '', 'e.g. gym-monthly', 'text', true)}
      ${field('pName', 'Name', p ? p.name : '', 'e.g. 3 Months', 'text', true)}
      ${select('pCat', 'Category', [['gym', 'Gym'], ['personal', 'Personal'], ['transformation', 'Transformation'], ['elite', 'Elite']].map(c => ({ v: c[0], t: c[1] })), p ? p.category : 'gym')}
      ${field('pPrice', 'Price (₹)', p ? p.price : '', '', 'number', true)}
      ${field('pDays', 'Duration (days)', p ? p.duration_days : 30, '', 'number', true)}
      ${field('pLabel', 'Duration label', p ? p.duration_label : '', 'e.g. 3 Months / 90 days')}
      ${field('pTag', 'Tag (optional)', p ? p.tag : '', 'e.g. Most Popular')}
      ${field('pSave', 'Save text (optional)', p ? p.save_text : '', 'e.g. Save 10%')}
      ${field('pFeatures', 'Features (comma-separated)', p && Array.isArray(p.features) ? p.features.join(', ') : '', '', 'textarea')}
      <div class="span2" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="pActive" ${!p || p.is_active ? 'checked' : ''}><label for="pActive">Active</label></div>
    </div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePlan('${p ? p.id : ''}')">Save</button></div>`);
  };
  window.savePlan = async (id) => {
    const payload = { name: $('#pName').value.trim(), category: $('#pCat').value, price: Number($('#pPrice').value), duration_days: Number($('#pDays').value), duration_label: $('#pLabel').value.trim() || null, tag: $('#pTag').value.trim() || null, save_text: $('#pSave').value.trim() || null, features: $('#pFeatures').value.split(',').map(x => x.trim()).filter(Boolean), active: $('#pActive').checked };
    try {
      if (id) await api('/api/admin/plans/' + id, { method: 'PUT', body: JSON.stringify(payload) });
      else { payload.id = $('#pId').value.trim(); if (!payload.id) throw new Error('ID required'); await api('/api/admin/plans', { method: 'POST', body: JSON.stringify(payload) }); }
      toast('Plan saved ✓'); closeModal(); route();
    } catch (e) { toast(e.message, true); }
  };
  window.archivePlan = (id) => confirmBox('Archive plan?', 'The plan will be deactivated. Historical memberships are not affected.', async () => { try { await api('/api/admin/plans/' + id, { method: 'DELETE' }); toast('Plan archived'); route(); } catch (e) { toast(e.message, true); } }, 'Archive');

  // ---------------- PAYMENTS ----------------
  async function viewPayments(q) {
    const page = parseInt(q.page || '1', 10);
    const status = q.status || '';
    const res = await api(`/api/admin/payments?q=${encodeURIComponent(q.q || '')}&status=${status}&page=${page}&pageSize=15`);
    const chips = [['', 'All'], ['paid', 'Paid'], ['pending', 'Pending'], ['failed', 'Failed'], ['refunded', 'Refunded'], ['cancelled', 'Cancelled']];
    $('#content').innerHTML = `
      <div class="toolbar"><div class="search"><i class="fa-solid fa-magnifying-glass" style="color:var(--muted)"></i><input placeholder="Search member, Razorpay order/payment, ID…" value="${esc(q.q || '')}" onkeydown="if(event.key==='Enter'){location.hash='#/payments?q='+encodeURIComponent(this.value)+'&status=${status}'}"></div></div>
      <div class="filter-row">${chips.map(c => `<button class="chip ${status === c[0] ? 'active' : ''}" onclick="location.hash='#/payments${c[0] ? '?status=' + c[0] : ''}'">${c[1]}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Member</th><th>Plan</th><th>Amount</th><th>Method</th><th>Razorpay</th><th>Status</th><th>Date</th><th></th></tr></thead>
      <tbody>${res.data.map(p => `<tr><td class="muted">${refShort('PAY', p.id)}</td><td><b>${esc(p.member_name || '—')}</b><br><small class="muted">${esc(p.member_email || '')}</small></td><td>${esc(p.plan_name || '—')}</td><td><b>${fmtINR(p.amount)}</b></td><td>${esc(p.payment_method || '—')}</td><td class="muted">${esc((p.razorpay_order_id || '').slice(0, 12) || '—')}</td><td>${paymentBadge(p.status)}</td><td class="muted">${fmtD(p.created_at)}</td><td><div class="row-actions"><button class="btn btn-sm btn-ghost" onclick="location.hash='#/payment/${p.id}'">View</button>${can('ADMIN') ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="deletePayment('${p.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="9" class="empty">No payments found</td></tr>'}</tbody></table></div>
      ${pagination('payments', page, res.total, 15)}`;
  }

  async function viewPaymentDetail(id) {
    const p = await api('/api/admin/payments/' + id);
    $('#content').innerHTML = `<div class="card"><h3>Payment</h3><a href="#/payments" style="font-size:13px"><i class="fa-solid fa-arrow-left"></i> Back</a>
      <div class="grid3" style="margin-top:14px">
        ${kv('Member', esc(p.member_name || '—'))}${kv('Email', esc(p.member_email || '—'))}${kv('Plan', esc(p.plan_name || '—'))}
        ${kv('Amount', fmtINR(p.amount))}${kv('Currency', esc(p.currency || 'INR'))}${kv('Status', paymentBadge(p.status))}
        ${kv('Razorpay Order ID', esc(p.razorpay_order_id || '—'))}${kv('Razorpay Payment ID', esc(p.razorpay_payment_id || '—'))}${kv('Payment Method', esc(p.payment_method || '—'))}
        ${kv('Created', fmtDT(p.created_at))}${kv('Updated', fmtDT(p.updated_at))}${kv('Membership', p.membership_id ? `<a href="#/membership/${p.membership_id}" style="color:var(--primary)">View linked membership <i class="fa-solid fa-arrow-right"></i></a>` : '—')}
      </div>
      ${p.status === 'PAID' && can('ADMIN') ? `<div class="modal-actions" style="justify-content:flex-start"><button class="btn btn-danger" onclick="refundPayment('${id}')"><i class="fa-solid fa-rotate-left"></i> Refund</button></div>` : ''}
      <p class="muted" style="font-size:11px;margin-top:12px">Razorpay secrets are never exposed. Server-side verification is authoritative for membership activation.</p>
    </div>`;
  }
  window.refundPayment = (id) => confirmBox('Refund this payment?', 'The payment status will be set to REFUNDED.', async () => { try { await api('/api/admin/payments/' + id + '/refund', { method: 'POST' }); toast('Payment refunded'); route(); } catch (e) { toast(e.message, true); } }, 'Refund payment');
  window.deletePayment = (id) => confirmBox('Delete this payment?', 'The payment will be marked as cancelled. The financial record is preserved for history.', async () => { try { await api('/api/admin/payments/' + id, { method: 'DELETE' }); toast('Payment deleted'); route(); } catch (e) { toast(e.message, true); } }, 'Delete payment');

  // ---------------- SERVICES ----------------
  async function viewServices() {
    const services = await api('/api/admin/services');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Services</h3>${can('MANAGER') ? `<button class="btn btn-primary" onclick="serviceForm()"><i class="fa-solid fa-plus"></i> New service</button>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Description</th><th>Price</th><th>Order</th><th>Status</th><th></th></tr></thead>
      <tbody>${services.map(s => `<tr><td><b>${esc(s.name)}</b></td><td class="muted">${esc((s.description || '').slice(0, 60))}</td><td>${s.price != null ? fmtINR(s.price) : '—'}</td><td class="muted">${s.sort_order}</td><td>${s.status === 'active' ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-cancelled">Archived</span>'}</td>
      <td><div class="row-actions">${can('MANAGER') ? `<button class="btn btn-ghost btn-sm" onclick="serviceForm('${s.id}')"><i class="fa-solid fa-pen"></i></button>${s.status === 'active' ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="archiveService('${s.id}')"><i class="fa-solid fa-box-archive"></i></button>` : ''}` : ''}</div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No services</td></tr>'}</tbody></table></div>`;
  }
  window.serviceForm = async (id) => {
    let s = null;
    if (id) s = (await api('/api/admin/services')).find(x => x.id === id);
    openModal(`<h3>${s ? 'Edit service' : 'New service'}</h3><div class="form-grid">${field('sName', 'Name', s ? s.name : '', '', 'text', true)}
      ${field('sPrice', 'Price (₹)', s ? s.price : '', '', 'number')}
      ${field('sDesc', 'Description', s ? s.description : '', '', 'textarea')}
      ${field('sCat', 'Category', s ? s.category : 'Fitness')}
      ${field('sImage', 'Image URL', s ? s.image_url : '')}
      ${field('sOrder', 'Sort order', s ? s.sort_order : 0, '', 'number')}
      <span class="span2"></span></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveService('${s ? s.id : ''}')">Save</button></div>`);
  };
  window.saveService = async (id) => {
    const payload = { name: $('#sName').value.trim(), price: $('#sPrice').value ? Number($('#sPrice').value) : null, description: $('#sDesc').value, category: $('#sCat').value.trim(), image_url: $('#sImage').value.trim() || null, sort_order: Number($('#sOrder').value || 0) };
    try { if (id) await api('/api/admin/services/' + id, { method: 'PUT', body: JSON.stringify(payload) }); else await api('/api/admin/services', { method: 'POST', body: JSON.stringify(payload) }); toast('Saved ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.archiveService = (id) => confirmBox('Archive service?', 'It will be hidden from the public services page.', async () => { await api('/api/admin/services/' + id, { method: 'DELETE' }); toast('Archived'); route(); }, 'Archive');

  // ---------------- MARKETPLACE (SUPPLEMENTS) ----------------
  const SUP_CATEGORIES = [
    ['pre_workout', 'Pre-Workouts'], ['whey', 'Whey Protein'], ['creatine', 'Creatine'],
    ['mass_gainer', 'Mass Gainer'], ['vitamins', 'Vitamins'], ['other', 'Other']
  ];
  const supCatLabel = c => { const f = SUP_CATEGORIES.find(x => x[0] === c); return f ? f[1] : c; };
  async function viewSupplements(q) {
    const cat = q.cat || '';
    const items = await api('/api/admin/supplements');
    const filtered = cat ? items.filter(s => s.category === cat) : items;
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Supplement Marketplace</h3>${can('MANAGER') ? `<button class="btn btn-primary" onclick="supForm()"><i class="fa-solid fa-plus"></i> Add product</button>` : ''}</div>
      <div class="filter-row">${[['', 'All'], ...SUP_CATEGORIES].map(c => `<button class="chip ${cat === c[0] ? 'active' : ''}" onclick="location.hash='#/supplements${c[0] ? '?cat=' + c[0] : ''}'">${c[1]}</button>`).join('')}</div>
      <div class="grid4">${filtered.map(s => `<div class="card" style="padding:10px;display:flex;flex-direction:column;gap:8px"><img src="${supImg(s)}" class="thumb" style="width:100%;height:120px;border-radius:10px;object-fit:cover;background:#f1f1f1" onerror="this.onerror=null;this.src='${phImg((s.name||s.brand)||'SUP', s.sort_order)}'"><div style="font-size:12px" class="muted">${esc(s.brand || '')}</div><div><b>${esc(s.name)}</b>${s.flavor ? '<div class="muted" style="font-size:12px">' + esc(s.flavor) + '</div>' : ''}<div class="muted" style="font-size:12px">${esc(s.size || '')}</div></div><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:700">${fmtINR(s.price)}</span>${s.mrp && Number(s.mrp) > Number(s.price) ? `<span class="muted" style="text-decoration:line-through;font-size:13px">${fmtINR(s.mrp)}</span><span class="badge badge-active" style="font-size:11px">Save ${Math.round((1 - s.price / s.mrp) * 100)}%</span>` : ''}</div><div style="display:flex;align-items:center;gap:8px;font-size:12px"><span class="muted">★ ${s.rating ?? '—'}</span><span class="muted">Stock: ${s.stock ?? 0}</span>${s.stock > 0 ? '<span class="badge badge-active">In stock</span>' : '<span class="badge badge-pending">Out of stock</span>'}</div>${s.is_featured ? '<span class="badge badge-active">Featured</span>' : ''}${s.is_active === false ? '<span class="badge badge-cancelled">Archived</span>' : ''}<div class="row-actions">${can('MANAGER') ? `<button class="btn btn-ghost btn-sm" onclick="supForm('${s.id}')"><i class="fa-solid fa-pen"></i></button><button class="btn btn-ghost btn-sm" onclick="toggleSup('${s.id}','${s.is_active}')"><i class="fa-solid fa-${s.is_active ? 'eye-slash' : 'eye'}"></i></button>${s.is_active !== false ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="archiveSup('${s.id}')"><i class="fa-solid fa-box-archive"></i></button>` : ''}</div>` : ''}</div>`).join('') || `<div class="empty">${items.length ? 'No products in this category' : 'No supplements yet — '}${can('MANAGER') ? `<a href="#" onclick="supForm();return false">Add the first product</a>` : ''}</div>`}</div>`;
  }
  window.supForm = async (id) => {
    let s = null;
    if (id) s = (await api('/api/admin/supplements')).find(x => x.id === id);
    openModal(`<h3>${s ? 'Edit product' : 'Add product'}</h3><div class="form-grid">
      ${field('suName', 'Name', s ? s.name : '', 'e.g. Gold Whey Isolate', 'text', true)}
      ${field('suBrand', 'Brand', s ? s.brand : '')}
      ${select('suCat', 'Category', SUP_CATEGORIES.map(c => ({ v: c[0], t: c[1] })), s ? s.category : 'whey')}
      ${field('suPrice', 'Price (₹)', s ? s.price : '', '', 'number', true)}
      ${field('suMrp', 'MRP (₹)', s ? s.mrp : '', '', 'number')}
      ${field('suSize', 'Size', s ? s.size : '', 'e.g. 1kg / 30 servings')}
      ${field('suFlavor', 'Flavor', s ? s.flavor : '')}
      ${field('suImg', 'Image URL', s ? s.image_url : '')}
      <div class="span2" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('suImgFile').click()"><i class="fa-solid fa-upload"></i> Upload photo</button>
        <input type="file" id="suImgFile" accept="image/*" style="display:none" onchange="uploadSupImg(this)">
        <img id="suImgPrev" src="${supImg(s)}" alt="" style="width:64px;height:64px;border-radius:8px;object-fit:cover;background:#f1f1f1;${s && s.image_url ? '' : 'display:none'}" onerror="this.style.display='none'">
        ${s && s.image_url ? `<button type="button" class="btn btn-ghost btn-sm" onclick="clearSupImg()"><i class="fa-solid fa-xmark"></i></button>` : ''}
      </div>
      ${field('suStock', 'Stock', s ? s.stock : 0, '', 'number')}
      ${field('suRating', 'Rating (0-5)', s ? s.rating : 5, '', 'number')}
      ${select('suFeat', 'Featured', [[true, 'Yes'], [false, 'No']].map(x => ({ v: String(x[0]), t: x[1] })), s ? String(s.is_featured) : 'false')}
      ${field('suOrder', 'Sort order', s ? s.sort_order : 0, '', 'number')}
      ${field('suDesc', 'Description', s ? s.description : '', '', 'textarea')}
      <span class="span2"></span></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveSup('${s ? s.id : ''}')">Save</button></div>`);
  };
  window.uploadSupImg = async (fileInput) => {
    const f = fileInput && fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Photo must be under 5MB', true); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const j = await api('/api/admin/supplements/upload', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) });
        $('#suImg').value = j.url;
        const pv = $('#suImgPrev'); pv.src = j.url; pv.style.display = 'block';
        toast('Photo uploaded ✓');
      } catch (e) { toast(e.message, true); }
    };
    reader.readAsDataURL(f);
  };
  window.clearSupImg = () => { $('#suImg').value = ''; const pv = $('#suImgPrev'); pv.style.display = 'none'; };
  window.saveSup = async (id) => {
    const payload = {
      name: $('#suName').value.trim(), brand: $('#suBrand').value.trim(), category: $('#suCat').value,
      price: $('#suPrice').value ? Number($('#suPrice').value) : 0, mrp: $('#suMrp').value ? Number($('#suMrp').value) : null,
      size: $('#suSize').value.trim(), flavor: $('#suFlavor').value.trim(), image_url: $('#suImg').value.trim() || null,
      stock: $('#suStock').value ? Number($('#suStock').value) : 0, rating: $('#suRating').value ? Number($('#suRating').value) : 5,
      is_featured: $('#suFeat').value === 'true', sort_order: $('#suOrder').value ? Number($('#suOrder').value) : 0,
      description: $('#suDesc').value
    };
    if (!payload.name) { toast('Name required', true); return; }
    try { if (id) await api('/api/admin/supplements/' + id, { method: 'PUT', body: JSON.stringify(payload) }); else await api('/api/admin/supplements', { method: 'POST', body: JSON.stringify(payload) }); toast('Saved ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.toggleSup = async (id, active) => { try { await api('/api/admin/supplements/' + id, { method: 'PUT', body: JSON.stringify({ is_active: !(active === true || active === 'true' || active === 1) }) }); route(); } catch (e) { toast(e.message, true); } };
  window.archiveSup = (id) => confirmBox('Archive product?', 'It will be hidden from the public shop.', async () => { try { await api('/api/admin/supplements/' + id, { method: 'DELETE' }); toast('Archived'); route(); } catch (e) { toast(e.message, true); } }, 'Archive');

  // ---------------- TRAINERS ----------------
  async function viewTrainers() {
    const trainers = await api('/api/admin/trainers');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Trainers</h3>${can('MANAGER') ? `<button class="btn btn-primary" onclick="trainerForm()"><i class="fa-solid fa-plus"></i> New trainer</button>` : ''}</div>
      <div class="grid4">${trainers.map(t => `<div class="card" style="display:flex;flex-direction:column;gap:8px"><div class="member-cell"><span class="avatar">${t.photo ? `<img src="${esc(t.photo)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : initials(t.name)}</span><div><b>${esc(t.name)}</b>${t.role ? '<div class="muted" style="font-size:12px">' + esc(t.role) + '</div>' : ''}</div></div><div class="muted" style="font-size:12px">${esc(t.exp || '')}${Array.isArray(t.speciality) && t.speciality.length ? ' • ' + esc(t.speciality.join(', ')) : ''}</div><div>${t.status === 'active' ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-cancelled">Disabled</span>'}</div><div class="row-actions">${can('MANAGER') ? `<button class="btn btn-ghost btn-sm" onclick="trainerForm('${t.id}')"><i class="fa-solid fa-pen"></i></button>${t.status === 'active' ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="toggleTrainer('${t.id}','disable')"><i class="fa-solid fa-trash"></i></button>` : `<button class="btn btn-ghost btn-sm" style="color:#22c55e" onclick="toggleTrainer('${t.id}','enable')"><i class="fa-solid fa-check"></i></button>`}` : ''}</div></div>`).join('') || '<div class="empty">No trainers</div>'}</div>`;
  }
  window.trainerForm = async (id) => {
    let t = null;
    const list = await api('/api/admin/trainers');
    if (id) t = list.find(x => x.id === id);
    openModal(`<h3>${t ? 'Edit trainer' : 'New trainer'}</h3><div class="form-grid">
      ${field('tId', 'ID (unique key)', t ? t.id : '', 'e.g. t-john', 'text', true)}
      ${field('tName', 'Name', t ? t.name : '', '', 'text', true)}
      ${field('tPhoto', 'Photo URL', t ? (t.photo || '') : '', '')}
      <div class="span2" style="display:flex;align-items:center;gap:12px"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('tPhotoFile').click()"><i class="fa-solid fa-upload"></i> Upload photo</button><input type="file" id="tPhotoFile" accept="image/*" style="display:none" onchange="uploadTrainerPhoto(this)"><img id="tPhotoPrev" src="${t && t.photo ? esc(t.photo) : ''}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.08);${t && t.photo ? '' : 'display:none'}"></div>
      ${field('tSpec', 'Specialization / Role', t ? (t.role || (t.speciality && t.speciality.join(', '))) : '', 'e.g. Strength & Conditioning')}
      ${field('tExp', 'Experience', t ? t.exp : '', 'e.g. 8 yrs')}
      ${field('tBio', 'Bio', t ? t.bio : '', '', 'textarea')}
      <span class="span2"></span></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveTrainer('${t ? t.id : ''}')">Save</button></div>`);
  };
  window.uploadTrainerPhoto = async (fileInput) => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Max 5MB', true); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try { const j = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result, bucket: 'trainers' }) }); $('#tPhoto').value = j.url; const pv = $('#tPhotoPrev'); pv.src = j.url; pv.style.display = ''; toast('Photo uploaded ✓'); } catch (e) { toast(e.message, true); }
    };
    reader.readAsDataURL(file);
  };
  window.saveTrainer = async (id) => {
    const payload = { id: id || $('#tId').value.trim(), name: $('#tName').value.trim(), photo: $('#tPhoto').value.trim() || null, specialization: $('#tSpec').value, speciality: $('#tSpec').value ? [$('#tSpec').value] : [], exp: $('#tExp').value, experience: $('#tExp').value, bio: $('#tBio').value, status: 'active' };
    if (!payload.id || !payload.name) { toast('ID and name required', true); return; }
    try { if (id) await api('/api/admin/trainers/' + id, { method: 'PUT', body: JSON.stringify(payload) }); else await api('/api/admin/trainers', { method: 'POST', body: JSON.stringify(payload) }); toast('Saved ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.toggleTrainer = (id, act) => {
    const enable = act === 'enable';
    confirmBox(enable ? 'Enable trainer?' : 'Disable/delete trainer?', enable ? 'The trainer will become visible and available again.' : 'The trainer will be disabled and hidden from the public page.', async () => {
      try { if (enable) await api('/api/admin/trainers/' + id, { method: 'PUT', body: JSON.stringify({ status: 'active' }) }); else await api('/api/admin/trainers/' + id, { method: 'DELETE' }); toast(enable ? 'Trainer enabled' : 'Trainer disabled'); route(); } catch (e) { toast(e.message, true); }
    }, enable ? 'Enable' : 'Disable');
  };
  window.trainerDetail_ = () => { };

  // ---------------- STAFF ----------------
  async function viewStaff() {
    const staff = await api('/api/admin/staff');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Staff & Roles</h3>${can('ADMIN') ? `<button class="btn btn-primary" onclick="staffForm()"><i class="fa-solid fa-user-plus"></i> New staff</button>` : ''}</div>
      <p class="muted" style="font-size:12px;margin-bottom:12px">Roles: ADMIN (full), MANAGER (operations), STAFF (front desk), TRAINER (assigned members & fitness). Authorization is enforced server-side.</p>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>${can('ADMIN') ? '<th></th>' : ''}</tr></thead>
      <tbody>${staff.map(s => `<tr><td><b>${esc(s.full_name)}</b></td><td class="muted">${esc(s.email)}</td><td>${roleBadge(s.role)}</td><td>${s.is_active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-cancelled">Disabled</span>'}</td>${can('ADMIN') ? `<td><div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="staffForm('${s.id}')"><i class="fa-solid fa-pen"></i></button>${s.is_active ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="disableStaff('${s.id}')"><i class="fa-solid fa-ban"></i></button>` : `<button class="btn btn-ghost btn-sm" style="color:#22c55e" onclick="enableStaff('${s.id}')"><i class="fa-solid fa-check"></i></button>`}</div></td>` : ''}</tr>`).join('') || '<tr><td colspan="5" class="empty">No staff</td></tr>'}</tbody></table></div>`;
  }
  function roleBadge(r) { const c = { ADMIN: 'badge-cancelled', MANAGER: 'badge-active', STAFF: 'badge-soon', TRAINER: 'badge-suspended' }; return `<span class="badge ${c[r] || 'badge-pending'}">${esc(r)}</span>`; }
  window.staffForm = async (id) => {
    let s = null;
    const list = await api('/api/admin/staff');
    if (id) s = list.find(x => x.id === id);
    const trainers = await api('/api/admin/trainers');
    const activeTrainers = trainers.filter(t => t.status === 'active');
    const keepCur = s && s.trainer_id && !activeTrainers.find(t => t.id === s.trainer_id) ? [trainers.find(t => t.id === s.trainer_id)] : [];
    openModal(`<h3>${s ? 'Edit staff' : 'New staff'}</h3><div class="form-grid">
      ${field('stName', 'Full name', s ? s.full_name : '', '', 'text', true)}
      ${field('stEmail', 'Email', s ? s.email : '', 'user@skyfit.com', 'email', !s)}
      ${select('stRole', 'Role', [['ADMIN', 'ADMIN'], ['MANAGER', 'MANAGER'], ['STAFF', 'STAFF'], ['TRAINER', 'TRAINER']].map(r => ({ v: r[0], t: r[1] })), s ? s.role : 'STAFF', true)}
      ${select('stTrainer', 'Linked trainer (for TRAINER)', [{ v: '', t: '-- None --' }, ...activeTrainers.concat(keepCur).map(t => ({ v: t.id, t: t.name + (t.status !== 'active' ? ' (disabled)' : '') }))], s ? s.trainer_id : '')}
      <span class="span2"></span></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveStaff('${s ? s.id : ''}')">Save</button></div>`);
  };
  window.saveStaff = async (id) => {
    const full_name = $('#stName').value.trim(), email = $('#stEmail').value.trim(), role = $('#stRole').value, trainer_id = $('#stTrainer').value || null;
    if (!full_name || !role || (!id && !email)) { toast('Fill required fields', true); return; }
    try { if (id) await api('/api/admin/staff/' + id, { method: 'PUT', body: JSON.stringify({ full_name, role, trainer_id })}); else await api('/api/admin/staff', { method: 'POST', body: JSON.stringify({ full_name, email, role, trainer_id })}); toast('Saved ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.disableStaff = (id) => confirmBox('Disable staff?', 'This user will lose admin access.', async () => { await api('/api/admin/staff/' + id, { method: 'DELETE' }); toast('Staff disabled'); route(); }, 'Disable');
  window.enableStaff = (id) => confirmBox('Enable staff?', 'This user will regain admin access.', async () => { await api('/api/admin/staff/' + id, { method: 'PUT', body: JSON.stringify({ active: true }) }); toast('Staff enabled'); route(); }, 'Enable');

  // ---------------- ATTENDANCE ----------------
  async function viewAttendance(q) {
    const page = parseInt(q.page || '1', 10);
    const date = q.date || todayISO();
    const res = await api(`/api/admin/attendance?q=${encodeURIComponent(q.q || '')}&date=${date}&page=${page}&pageSize=20`);
    $('#content').innerHTML = `
      <div class="toolbar"><div class="search"><i class="fa-solid fa-magnifying-glass" style="color:var(--muted)"></i><input placeholder="Search member…" value="${esc(q.q || '')}" onkeydown="if(event.key==='Enter'){location.hash='#/attendance?q='+encodeURIComponent(this.value)+'&date=${date}'}"></div>
        <input type="date" class="input" style="max-width:180px" value="${date}" onchange="location.hash='#/attendance?date='+this.value"></div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Entry</th><th>Method</th><th>Device</th><th>Status</th><th>Reason</th></tr></thead>
      <tbody>${res.data.map(a => `<tr><td><b>${esc(a.member_name || '—')}</b><br><small class="muted">${esc(a.member_email || '')}</small></td><td>${fmtDT(a.entry_time)}</td><td>${esc(a.access_method || '—')}</td><td class="muted">${esc(a.device_id ? a.device_id.slice(0, 8) : '—')}</td><td>${a.status === 'GRANTED' ? statusBadge('GRANTED') : statusBadge('DENIED')}</td><td class="muted">${esc(a.reason || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No attendance for this date</td></tr>'}</tbody></table></div>
      ${pagination('attendance', page, res.total, 20)}`;
  }

  // ---------------- ACCESS CONTROL ----------------
  async function viewAccessControl() {
    const ov = await api('/api/admin/access/overview');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Access Control</h3><div class="row-actions"><button class="btn btn-sm" onclick="location.hash='#/devices'"><i class="fa-solid fa-microchip"></i> Devices</button><button class="btn btn-sm" onclick="location.hash='#/biometric'"><i class="fa-solid fa-hand"></i> Biometric</button><button class="btn btn-sm" onclick="location.hash='#/access-log'"><i class="fa-solid fa-list-check"></i> Logs</button></div></div>
      <div class="grid4">
        <div class="stat green"><small>Devices Online</small><b>${(ov.devices || []).filter(d => d.status === 'ONLINE').length}/${(ov.devices || []).length}</b><span>online / total</span></div>
        <div class="stat"><small>Today’s Entries</small><b>${ov.todayEntries}</b><span>granted</span></div>
        <div class="stat red"><small>Denied Attempts</small><b>${ov.todayDenied}</b><span>today</span></div>
        <div class="stat"><small>Currently Inside</small><b>${ov.currentlyInside}</b><span>est. entries</span></div>
      </div>
      <div class="grid2">
        <div class="card"><h3><i class="fa-solid fa-microchip" style="color:var(--primary)"></i> Devices</h3>${(ov.devices || []).map(d => `<div class="recent-item"><span class="ic" style="background:${d.status === 'ONLINE' ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'};color:${d.status === 'ONLINE' ? 'var(--success)' : 'var(--danger)'}"><i class="fa-solid fa-${d.status === 'ONLINE' ? 'wifi' : 'wifi'}" style="color:${d.status === 'ONLINE' ? 'var(--success)' : 'var(--danger)'}"></i></span><div style="flex:1"><b>${esc(d.name)}</b> <span class="muted">${esc(d.location || '')}</span><br>${deviceBadge(d.status)}</div><small class="muted">${d.last_heartbeat ? fmtDT(d.last_heartbeat) : '—'}</small></div>`).join('') || '<div class="empty">No devices configured</div>'}</div>
        <div class="card"><h3><i class="fa-solid fa-clock-rotate-left" style="color:var(--primary)"></i> Recent Access Attempts</h3>${(ov.recent || []).map(a => `<div class="recent-item"><span class="ic" style="background:${a.status === 'GRANTED' ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'};color:${a.status === 'GRANTED' ? 'var(--success)' : 'var(--danger)'}"><i class="fa-solid ${a.status === 'GRANTED' ? 'fa-door-open' : 'fa-ban'}"></i></span><div style="flex:1"><b>${esc(a.member_name || 'Unknown')}</b><br><small class="muted">${esc(a.reason || '')}</small></div><div style="text-align:right"><small class="muted">${fmtDT(a.created_at)}</small><br>${a.status === 'GRANTED' ? statusBadge('GRANTED') : statusBadge('DENIED')}</div></div>`).join('') || '<div class="empty">No attempts today</div>'}</div>
      </div>
      ${can('MANAGER') ? `<div class="card"><h3><i class="fa-solid fa-hand" style="color:var(--primary)"></i> Manual Access Grant</h3><div class="grid2"><label>Member email<input id="mEmailManual" class="input" placeholder="member@example.com"></label><label>Reason<input id="mReasonManual" class="input" placeholder="Device unavailable etc."></label></div><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="manualGrant()"><i class="fa-solid fa-door-open"></i> Grant manual access</button></div>` : ''}`;
  }
  function deviceBadge(s) { return { ONLINE: '<span class="badge badge-active">ONLINE</span>', OFFLINE: '<span class="badge badge-offline">OFFLINE</span>', ERROR: '<span class="badge badge-expired">ERROR</span>', DISABLED: '<span class="badge badge-cancelled">DISABLED</span>' }[s] || esc(s); }
  window.manualGrant = async () => {
    const member_email = $('#mEmailManual').value.trim(), reason = $('#mReasonManual').value.trim();
    if (!member_email || !reason) { toast('Email and reason required', true); return; }
    try { const j = await api('/api/admin/access/manual', { method: 'POST', body: JSON.stringify({ member_email, reason }) }); toast('Manual access: ' + (j.result === 'GRANTED' ? 'Granted' : j.reason) + ' (audited)'); route(); } catch (e) { toast(e.message, true); }
  };

  // ---------------- ACCESS LOGS ----------------
  async function viewAccessLog(q) {
    const page = parseInt(q.page || '1', 10);
    const date = q.date || '';
    const status = q.status || '';
    const res = await api(`/api/admin/access/logs?page=${page}&date=${date}&status=${status}`);
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Access Logs</h3><div" style="display:flex;gap:8px"><input type="date" class="input" style="max-width:170px" value="${date}" onchange="location.hash='#/access-log?date='+this.value"><button class="chip ${status === 'GRANTED' ? 'active' : ''}" onclick="location.hash='#/access-log?date=${date}&status=GRANTED'">Granted</button><button class="chip ${status === 'DENIED' ? 'active' : ''}" onclick="location.hash='#/access-log?date=${date}&status=DENIED'">Denied</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Device</th><th>Time</th><th>Method</th><th>Status</th><th>Reason</th></tr></thead>
      <tbody>${res.data.map(a => `<tr><td><b>${esc(a.member_name || 'Unknown')}</b>${a.member_email ? '<br><small class="muted">' + esc(a.member_email) + '</small>' : ''}</td><td class="muted">${esc(a.device_name || '—')}</td><td>${fmtDT(a.created_at)}</td><td>${esc(a.access_method || '—')}</td><td>${a.status === 'GRANTED' ? statusBadge('GRANTED') : statusBadge('DENIED')}</td><td class="muted">${esc(a.reason || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No access logs</td></tr>'}</tbody></table></div>
      ${pagination('access-log', page, res.total, 20)}`;
  }

  // ---------------- DEVICES ----------------
  async function viewDevices() {
    const devices = await api('/api/admin/access/devices');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Access Devices</h3>${can('MANAGER') ? `<button class="btn btn-primary" onclick="deviceForm()"><i class="fa-solid fa-plus"></i> New device</button>` : ''}</div>
      <div class="grid4">${devices.map(d => `<div class="card" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;align-items:center;gap:8px"><i class="fa-solid fa-microchip" style="color:var(--primary)"></i><b>${esc(d.name)}</b></div><span class="muted" style="font-size:12px">${esc(d.location || '')}</span>${deviceBadge(d.status)}<small class="muted">Last heartbeat: ${fmtDT(d.last_heartbeat)}</small><div class="row-actions">${can('MANAGER') ? `<button class="btn btn-ghost btn-sm" onclick="deviceForm('${d.id}')"><i class="fa-solid fa-pen"></i></button>${d.status === 'DISABLED' ? '' : `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="disableDevice('${d.id}')"><i class="fa-solid fa-ban"></i></button>`}` : ''}</div></div>`).join('') || '<div class="empty">No devices</div>'}</div>`;
  }
  window.deviceForm = async (id) => {
    let d = null;
    const list = await api('/api/admin/access/devices');
    if (id) d = list.find(x => x.id === id);
    openModal(`<h3>${d ? 'Edit device' : 'New device'}</h3><div class="form-grid">
      ${field('dvName', 'Device name', d ? d.name : '', 'e.g. Entry Device 01', 'text', true)}
      ${field('dvLoc', 'Location', d ? d.location : '', 'e.g. Main entrance')}
      ${field('dvId', 'Identifier', d ? d.identifier : '', '', 'text')}
      ${select('dvStatus', 'Status', [['ONLINE', 'ONLINE'], ['OFFLINE', 'OFFLINE'], ['ERROR', 'ERROR'], ['DISABLED', 'DISABLED']].map(x => ({ v: x[0], t: x[1] })), d ? d.status : 'ONLINE')}
      <span class="span2"></span></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveDevice('${d ? d.id : ''}')">Save</button></div>`);
  };
  window.saveDevice = async (id) => {
    const payload = { name: $('#dvName').value.trim(), location: $('#dvLoc').value, identifier: $('#dvId').value, status: $('#dvStatus').value };
    if (!payload.name) { toast('Name required', true); return; }
    try { if (id) await api('/api/admin/access/devices/' + id, { method: 'PUT', body: JSON.stringify(payload) }); else await api('/api/admin/access/devices', { method: 'POST', body: JSON.stringify(payload) }); toast('Saved ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.disableDevice = (id) => confirmBox('Disable device?', 'This device will no longer permit entry.', async () => { await api('/api/admin/access/devices/' + id, { method: 'DELETE' }); toast('Device disabled'); route(); }, 'Disable');

  // ---------------- BIOMETRIC ----------------
  async function viewBiometric() {
    const bio = await api('/api/admin/biometric');
    const membersStr = '';
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Biometric Members</h3>${can('MANAGER') ? `<button class="btn btn-primary" onclick="bioForm()"><i class="fa-solid fa-hand"></i> Register</button>` : ''}</div>
      <p class="muted" style="font-size:12px;margin-bottom:12px">Only safe device identifiers are stored — raw fingerprint data is never kept on the website.</p>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Device</th><th>Device</th><th>Status</th><th>Registered</th>${can('MANAGER') ? '<th></th>' : ''}</tr></thead>
      <tbody>${bio.map(b => `<tr><td><a href="#/member/${encodeURIComponent(b.member_email || '')}" style="color:inherit;text-decoration:none"><b>${esc(b.member_name || b.member_email)}</b></a>${b.member_email ? '<br><small class="muted">' + esc(b.member_email) + '</small>' : ''}</td><td class="muted">${esc(b.device_name || (b.device_id ? b.device_id.slice(0, 8) : '—'))}</td><td class="muted">${esc(b.device_user_id || '—')}</td><td>${statusBadge(b.status === 'REGISTERED' ? 'ACTIVE' : (b.status === 'DISABLED' ? 'CANCELLED' : 'PENDING'))}</td><td class="muted">${fmtD(b.registered_at)}</td>${can('MANAGER') ? `<td><div class="row-actions">${b.status !== 'DISABLED' ? `<button class="btn btn-ghost btn-sm" onclick="disableBio('${b.id}')"><i class="fa-solid fa-ban"></i></button>` : ''}<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="removeBio('${b.id}')"><i class="fa-solid fa-trash"></i></button></div></td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="empty">No biometric registrations</td></tr>'}</tbody></table></div>`;
  }
  window.bioForm = () => {
    openModal(`<h3>Register biometric</h3><div class="form-grid">
      ${field('bioEmail', 'Member email', '', '', 'email', true)}
      ${field('bioUserId', 'Device User ID', '', 'ID from the biometric device', 'text', true)}
      ${field('bioDevice', 'Device ID', '', 'UUID of device', 'text')}
      <span class="span2"></span></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveBio()">Register</button></div>`);
  };
  window.saveBio = async () => {
    const member_email = $('#bioEmail').value.trim(), device_user_id = $('#bioUserId').value.trim(), device_id = $('#bioDevice').value.trim() || null;
    if (!member_email || !device_user_id) { toast('Email and device user id required', true); return; }
    try { await api('/api/admin/biometric', { method: 'POST', body: JSON.stringify({ member_email, device_user_id, device_id }) }); toast('Registered ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.disableBio = (id) => confirmBox('Disable biometric?', 'The member will not be able to enter via biometric.', async () => { await api('/api/admin/biometric/' + id + '/disable', { method: 'POST' }); toast('Disabled'); route(); }, 'Disable');
  window.removeBio = (id) => confirmBox('Remove biometric?', 'The registration will be permanently removed.', async () => { await api('/api/admin/biometric/' + id, { method: 'DELETE' }); toast('Removed'); route(); }, 'Remove');

  // ---------------- WORKOUTS ----------------
  async function viewWorkouts() {
    const list = SESSION.role === 'TRAINER' ? await api('/api/trainer/workouts') : await api('/api/admin/workouts');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Workouts</h3>${can('TRAINER') ? `<button class="btn btn-primary" onclick="workoutForm()"><i class="fa-solid fa-plus"></i> Add workout</button>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Trainer</th><th>Date</th><th>Session</th><th>Notes</th>${can('TRAINER') ? '<th></th>' : ''}</tr></thead>
      <tbody>${list.map(w => `<tr><td><a href="#/member/${encodeURIComponent(w.member_email || '')}" style="color:inherit;text-decoration:none"><b>${esc(w.member_name || w.member_email)}</b></a></td><td class="muted">${esc(w.trainer_name || '—')}</td><td>${fmtD(w.date)}</td><td>${esc(w.session_type || 'Gym')}</td><td class="muted">${esc((w.notes || '').slice(0, 50))}</td>${can('TRAINER') ? `<td><button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="deleteWorkout('${w.id}')"><i class="fa-solid fa-trash"></i></button></td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="empty">No workouts</td></tr>'}</tbody></table></div>`;
  }
  window.workoutForm = async () => {
    const trainers = (await api('/api/admin/trainers')).filter(t => t.status === 'active');
    openModal(`<h3>Add workout</h3><div class="form-grid">
      ${field('wEmail', 'Member email', '', '', 'email', true)}
      ${select('wTrainer', 'Trainer', [{ v: '', t: '-- None --' }, ...trainers.map(t => ({ v: t.id, t: t.name }))], SESSION.role === 'TRAINER' ? '' : '')}
      ${field('wDate', 'Date', todayISO(), '', 'date', true)}
      ${select('wType', 'Session type', ['Gym', 'Personal Training', 'Cardio', 'Boxing', 'Yoga', 'Mobility', 'Other'].map(t => ({ v: t, t })), 'Gym')}
      ${field('wNotes', 'Notes', '', 'e.g. Full-body strength block', '', 'textarea')}
      </div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveWorkout()">Add</button></div>`);
  };
  window.saveWorkout = async () => {
    const trainers = await api('/api/admin/trainers');
    const tr = trainers.find(t => t.id === $('#wTrainer').value);
    const payload = { member_email: $('#wEmail').value.trim(), trainer_id: tr ? tr.id : null, trainer_name: tr ? tr.name : null, date: $('#wDate').value, session_type: $('#wType').value.trim(), notes: $('#wNotes').value };
    if (!payload.member_email || !payload.session_type) { toast('Email and session type required', true); return; }
    try { await api('/api/admin/workouts', { method: 'POST', body: JSON.stringify(payload) }); toast('Workout added ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.deleteWorkout = (id) => confirmBox('Delete workout?', 'This workout record will be permanently removed.', async () => { await api('/api/admin/workouts/' + id, { method: 'DELETE' }); toast('Deleted'); route(); }, 'Delete');

  // ---------------- PROGRESS ----------------
  async function viewProgress() {
    const list = SESSION.role === 'TRAINER' ? await api('/api/trainer/progress') : await api('/api/admin/progress');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Progress Records</h3>${can('TRAINER') ? `<button class="btn btn-primary" onclick="progressForm()"><i class="fa-solid fa-plus"></i> Add record</button>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Date</th><th>Weight</th><th>Body Fat %</th><th>Muscle Mass</th><th>Notes</th>${can('TRAINER') ? '<th></th>' : ''}</tr></thead>
      <tbody>${list.map(p => `<tr><td><a href="#/member/${encodeURIComponent(p.member_email || '')}" style="color:inherit;text-decoration:none"><b>${esc(p.member_name || p.member_email)}</b></a></td><td>${fmtD(p.recorded_date)}</td><td>${esc(p.weight ?? '—')}</td><td>${esc(p.body_fat ?? '—')}</td><td>${esc(p.muscle_mass ?? '—')}</td><td class="muted">${esc((p.notes || '').slice(0, 40))}</td>${can('TRAINER') ? `<td><button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="deleteProgress('${p.id}')"><i class="fa-solid fa-trash"></i></button></td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="empty">No progress records</td></tr>'}</tbody></table></div>`;
  }
  window.progressForm = () => {
    openModal(`<h3>Add progress record</h3><div class="form-grid">
      ${field('gEmail', 'Member email', '', '', 'email', true)}
      ${field('gName', 'Member name', '', '', 'text')}
      ${field('gDate', 'Date', todayISO(), '', 'date', true)}
      ${field('gWeight', 'Weight (kg)', '', '', 'number')}
      ${field('gBodyFat', 'Body fat (%)', '', '', 'number')}
      ${field('gMuscle', 'Muscle mass (kg)', '', '', 'number')}
      ${field('gNotes', 'Notes', '', '', 'textarea')}
      </div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveProgress()">Add</button></div>`);
  };
  window.saveProgress = async () => {
    const payload = { member_email: $('#gEmail').value.trim(), member_name: $('#gName').value.trim() || null, recorded_date: $('#gDate').value, weight: $('#gWeight').value ? Number($('#gWeight').value) : null, body_fat: $('#gBodyFat').value ? Number($('#gBodyFat').value) : null, muscle_mass: $('#gMuscle').value ? Number($('#gMuscle').value) : null, notes: $('#gNotes').value };
    if (!payload.member_email) { toast('Email required', true); return; }
    try { await api('/api/admin/progress', { method: 'POST', body: JSON.stringify(payload) }); toast('Record added ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.deleteProgress = (id) => confirmBox('Delete progress record?', 'This record will be permanently removed.', async () => { await api('/api/admin/progress/' + id, { method: 'DELETE' }); toast('Deleted'); route(); }, 'Delete');

  // ---------------- GALLERY ----------------
  async function viewGallery() {
    const items = await api('/api/admin/gallery');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Gallery</h3>${can('MANAGER') ? `<button class="btn btn-primary" onclick="galleryUpload()"><i class="fa-solid fa-upload"></i> Upload</button>` : ''}</div>
      <div class="grid4">${items.map(g => `<div class="card" style="padding:10px"><img src="${esc(g.public_url)}" class="thumb" style="width:100%;height:110px;border-radius:10px"><div style="margin-top:8px;font-size:12px"><b>${esc(g.title || g.category)}</b><span class="muted" style="display:block">${esc(g.category)}</span>${g.is_public ? '<span class="badge badge-active">Published</span>' : '<span class="badge badge-pending">Unpublished</span>'}</div>${can('MANAGER') ? `<div class="row-actions" style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="toggleGallery('${g.id}','${g.is_public}')"><i class="fa-solid fa-${g.is_public ? 'eye-slash' : 'eye'}"></i></button><button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="deleteGallery('${g.id}')"><i class="fa-solid fa-trash"></i></button></div>` : ''}</div>`).join('') || '<div class="empty">No gallery images</div>'}</div>`;
  }
  window.galleryUpload = () => {
    openModal(`<h3>Upload image</h3><div class="form-grid">
      ${field('gName', 'Title', '', '', 'text')}
      ${select('gCat', 'Category', [['Gym'], ['Equipment'], ['Training'], ['Events'], ['Trainers'], ['Other']].flat().map(c => ({ v: c, t: c })), 'Gym')}
      <label class="span2">Image<input type="file" id="gFile" class="input" accept="image/*"></label>
      <span class="span2"></span></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="doUpload()">Upload</button></div>`);
  };
  window.doUpload = async () => {
    const file = $('#gFile').files[0];
    if (!file) { toast('Choose an image', true); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Max 5MB', true); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try { const j = await api('/api/admin/gallery/upload', { method: 'POST', body: JSON.stringify({ category: $('#gCat').value, name: $('#gName').value || file.name, dataUrl: reader.result }) }); toast('Uploaded ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
    };
    reader.readAsDataURL(file);
  };
  window.toggleGallery = async (id, isPublic) => { await api('/api/admin/gallery/' + id, { method: 'PUT', body: JSON.stringify({ is_public: !(isPublic === true || isPublic === 'true' || isPublic === 1) }) }); route(); };
  window.deleteGallery = (id) => confirmBox('Delete image?', 'This image will be removed from the gallery.', async () => { await api('/api/admin/gallery/' + id, { method: 'DELETE' }); toast('Deleted'); route(); }, 'Delete');

  // ---------------- TRANSFORMATIONS ----------------
  async function viewTransformations() {
    const items = await api('/api/admin/transformations');
    $('#content').innerHTML = `
      <div class="toolbar"><h3 style="margin:0">Transformations</h3>${can('MANAGER') ? `<button class="btn btn-primary" onclick="transForm()"><i class="fa-solid fa-plus"></i> New</button>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Member</th><th>Photos</th><th>Goal</th><th>Duration</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>${items.map(t => `<tr><td><b>${esc(t.member_name)}</b></td><td><div style="display:flex;gap:4px">${(t.before_image_url || t.before_image ? `<img src="${esc(t.before_image_url || t.before_image)}" style="width:44px;height:34px;object-fit:cover;border-radius:6px">` : '')}${(t.after_image_url || t.after_image ? `<img src="${esc(t.after_image_url || t.after_image)}" style="width:44px;height:34px;object-fit:cover;border-radius:6px">` : '')}${(t.before_image_url || t.before_image || t.after_image || t.after_image) ? '' : '<span class="muted">—</span>'}</div></td><td class="muted">${esc(t.goal || '—')}</td><td>${esc(t.duration || '—')}</td><td>${transBadge(t.status)}</td><td class="muted">${fmtD(t.created_at)}</td><td>${can('MANAGER') ? `<div class="row-actions"><button class="btn btn-ghost btn-sm" onclick="transForm('${t.id}')"><i class="fa-solid fa-pen"></i></button>${t.status !== 'ARCHIVED' ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="archiveTrans('${t.id}')"><i class="fa-solid fa-box-archive"></i></button>` : ''}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No transformations</td></tr>'}</tbody></table></div>`;
  }
  function transBadge(s) { return { DRAFT: '<span class="badge badge-pending">DRAFT</span>', PUBLISHED: '<span class="badge badge-active">PUBLISHED</span>', ARCHIVED: '<span class="badge badge-cancelled">ARCHIVED</span>' }[s] || esc(s); }
  window.transForm = async (id) => {
    let t = null;
    const list = await api('/api/admin/transformations');
    if (id) t = list.find(x => x.id === id);
    openModal(`<h3>${t ? 'Edit transformation' : 'New transformation'}</h3><div class="form-grid">
      ${field('trName', 'Member name', t ? t.member_name : '', '', 'text', true)}
      ${field('trGoal', 'Goal', t ? t.goal : '')}
      ${field('trDuration', 'Duration', t ? t.duration : '', 'e.g. 12 weeks')}
      ${field('trBefore', 'Before image URL', t ? (t.before_image_url || t.before_image) : '')}
      <div class="span2" style="display:flex;align-items:center;gap:12px"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('trBeforeFile').click()"><i class="fa-solid fa-upload"></i> Upload before photo</button><input type="file" id="trBeforeFile" accept="image/*" style="display:none" onchange="uploadTransImg(this,'trBefore','trBeforePrev')"><img id="trBeforePrev" src="${t && (t.before_image_url || t.before_image) ? esc(t.before_image_url || t.before_image) : ''}" alt="" style="width:80px;height:60px;border-radius:8px;object-fit:cover;background:rgba(255,255,255,.08);${t && (t.before_image_url || t.before_image) ? '' : 'display:none'}"></div>
      ${field('trAfter', 'After image URL', t ? (t.after_image_url || t.after_image) : '')}
      <div class="span2" style="display:flex;align-items:center;gap:12px"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('trAfterFile').click()"><i class="fa-solid fa-upload"></i> Upload after photo</button><input type="file" id="trAfterFile" accept="image/*" style="display:none" onchange="uploadTransImg(this,'trAfter','trAfterPrev')"><img id="trAfterPrev" src="${t && (t.after_image_url || t.after_image) ? esc(t.after_image_url || t.after_image) : ''}" alt="" style="width:80px;height:60px;border-radius:8px;object-fit:cover;background:rgba(255,255,255,.08);${t && (t.after_image_url || t.after_image) ? '' : 'display:none'}"></div>
      ${select('trStatus', 'Status', [['DRAFT'], ['PUBLISHED'], ['ARCHIVED']].map(s => ({ v: s[0], t: s[0] })), t ? t.status : 'DRAFT')}
      ${field('trDesc', 'Achievement', t ? (t.achievement || t.description) : '', '', 'textarea')}
      ${field('trTestimonial', 'Testimonial', t ? t.testimonial : '', '', 'textarea')}
      </div><div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveTrans('${t ? t.id : ''}')">Save</button></div>`);
  };
  window.saveTrans = async (id) => {
    const payload = { member_name: $('#trName').value.trim(), goal: $('#trGoal').value, duration: $('#trDuration').value, before_image_url: $('#trBefore').value, after_image_url: $('#trAfter').value, status: $('#trStatus').value, achievement: $('#trDesc').value, testimonial: $('#trTestimonial').value };
    if (!payload.member_name) { toast('Member name required', true); return; }
    try { if (id) await api('/api/admin/transformations/' + id, { method: 'PUT', body: JSON.stringify(payload) }); else await api('/api/admin/transformations', { method: 'POST', body: JSON.stringify(payload) }); toast('Saved ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.uploadTransImg = async (fileInput, urlId, prevId) => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Max 5MB', true); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try { const j = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result, bucket: 'transformations' }) }); $('#' + urlId).value = j.url; const pv = $('#' + prevId); pv.src = j.url; pv.style.display = ''; toast('Photo uploaded ✓'); } catch (e) { toast(e.message, true); }
    };
    reader.readAsDataURL(file);
  };
  window.archiveTrans = (id) => confirmBox('Archive transformation?', 'It will be hidden from the public site.', async () => { await api('/api/admin/transformations/' + id, { method: 'DELETE' }); toast('Archived'); route(); }, 'Archive');

  // ---------------- ENQUIRIES ----------------
  async function viewEnquiries(q) {
    const page = parseInt(q.page || '1', 10);
    const status = q.status || '';
    const res = await api(`/api/admin/enquiries?q=${encodeURIComponent(q.q || '')}&status=${status}&page=${page}&pageSize=15`);
    const chips = [['', 'All'], ['new', 'New'], ['contacted', 'Contacted'], ['follow_up', 'Follow Up'], ['converted', 'Converted'], ['closed', 'Closed']];
    $('#content').innerHTML = `
      <div class="toolbar"><div class="search"><i class="fa-solid fa-magnifying-glass" style="color:var(--muted)"></i><input placeholder="Search name, phone, email…" value="${esc(q.q || '')}" onkeydown="if(event.key==='Enter'){location.hash='#/enquiries?q='+encodeURIComponent(this.value)+'&status=${status}'}"></div></div>
      <div class="filter-row">${chips.map(c => `<button class="chip ${status === c[0] ? 'active' : ''}" onclick="location.hash='#/enquiries${c[0] ? '?status=' + c[0].toUpperCase() : ''}'">${c[1]}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact</th><th>Message</th><th>Status</th><th>Date</th><th></th></tr></thead>
      <tbody>${res.data.map(e => `<tr><td><b>${esc(e.name)}</b></td><td class="muted">${esc(e.phone || '')}<br>${esc(e.email || '')}</td><td class="muted"><span style="max-width:260px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.message || '')}</span></td><td>${enqBadge(e.status)}</td><td class="muted">${fmtDT(e.created_at)}</td><td><div class="row-actions">${can('STAFF') ? `<button class="btn btn-sm btn-ghost" onclick="enquiryForm('${e.id}')"><i class="fa-solid fa-pen"></i></button>` : ''}${can('STAFF') ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="deleteEnquiry('${e.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No enquiries</td></tr>'}</tbody></table></div>
      ${pagination('enquiries', page, res.total, 15)}`;
  }
  function enqBadge(s) { return { NEW: '<span class="badge badge-active">NEW</span>', CONTACTED: '<span class="badge badge-info">CONTACTED</span>', FOLLOW_UP: '<span class="badge badge-soon">FOLLOW UP</span>', CONVERTED: '<span class="badge badge-active">CONVERTED</span>', CLOSED: '<span class="badge badge-pending">CLOSED</span>' }[s] || esc(s); }
  window.enquiryForm = async (id) => {
    const list = await api('/api/admin/enquiries?pageSize=100');
    const e = (list.data || []).find(x => x.id === id);
    if (!e) return;
    openModal(`<h3>Enquiry — ${esc(e.name)}</h3><p class="muted">${esc(e.phone || '')} • ${esc(e.email || '')} • ${fmtDT(e.created_at)}</p><div class="card" style="margin:10px 0"><p>${esc(e.message)}</p></div>
      ${select('eStatus', 'Status', [['NEW'], ['CONTACTED'], ['FOLLOW_UP'], ['CONVERTED'], ['CLOSED']].map(s => ({ v: s[0], t: s[0] })), e.status)}
      ${field('eNotes', 'Handled by / notes', e.handled_by || '', '', 'textarea')}
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveEnquiry('${id}')">Save</button></div>`);
  };
  window.saveEnquiry = async (id) => {
    try { await api('/api/admin/enquiries/' + id, { method: 'PUT', body: JSON.stringify({ status: $('#eStatus').value, handled_by: $('#eNotes').value }) }); toast('Enquiry updated ✓'); closeModal(); route(); } catch (e) { toast(e.message, true); }
  };
  window.deleteEnquiry = (id) => confirmBox('Delete enquiry?', 'This enquiry will be permanently removed.', async () => { try { await api('/api/admin/enquiries/' + id, { method: 'DELETE' }); toast('Enquiry deleted'); route(); } catch (e) { toast(e.message, true); } }, 'Delete enquiry');

  // ---------------- REPORTS ----------------
  async function viewReports(q) {
    const type = q.type || 'member';
    const types = [['member', 'Member'], ['membership', 'Membership'], ['revenue', 'Revenue'], ['attendance', 'Attendance'], ['access', 'Access'], ['trainer', 'Trainer']];
    $('#content').innerHTML = `
      <div class="toolbar"><div class="filter-row">${types.map(t => `<button class="chip ${type === t[0] ? 'active' : ''}" onclick="location.hash='#/reports?type=${t[0]}'">${t[1]}</button>`).join('')}</div>
        <div style="display:flex;gap:8px;align-items:center"><input type="date" class="input" style="max-width:160px" id="repFrom" value="${q.from || ''}"><input type="date" class="input" style="max-width:160px" id="repTo" value="${q.to || ''}"><button class="btn btn-sm" onclick="location.hash='#/reports?type=${type}&from='+$('#repFrom').value+'&to='+$('#repTo').value"><i class="fa-solid fa-filter"></i> Apply</button><button class="btn btn-sm" onclick="exportReport('${type}')"><i class="fa-solid fa-file-csv"></i> Export</button></div></div>
      <div id="reportBody" class="loading">Loading report…</div>`;
    const res = await api(`/api/admin/reports?type=${type}&from=${encodeURIComponent(q.from || '')}&to=${encodeURIComponent(q.to || '')}`);
    renderReport(type, res);
  }
  function barChart(daily) {
    const entries = Object.entries(daily || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
    const max = Math.max(1, ...entries.map(e => e[1]));
    return `<div class="bar-chart">${entries.map(([k, v]) => `<div class="bar-col"><div class="bar" style="height:${(v / max) * 100}%"></div><div class="lbl">${k.slice(5)}</div></div>`).join('') || '<div class="empty">No data</div>'}</div>`;
  }
  function renderReport(type, res) {
    const body = $('#reportBody');
    if (type === 'member') body.innerHTML = `<div class="grid4">${[['Total Members', res.totalMembers], ['New Members (range)', res.newMembers], ['Active Members', res.activeMembers], ['Expired Members', res.expiredMembers]].map(([l, v]) => `<div class="stat"><small>${l}</small><b>${v}</b></div>`).join('')}</div><div class="card" style="margin-top:14px"><h3>Member Breakdown</h3><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Status</th><th>Expiry</th><th>Joined</th></tr></thead><tbody>${(res.rows || []).map(r => `<tr><td>${esc(r.name)}</td><td class="muted">${esc(r.email)}</td><td>${esc(r.plan || '—')}</td><td>${statusBadge(r.status)}</td><td>${fmtD(r.expires)}</td><td class="muted">${fmtD(r.created)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No data</td></tr>'}</tbody></table></div></div>`;
    else if (type === 'membership') body.innerHTML = `<div class="grid4">${[['Total', res.total], ['Active', res.active], ['Pending', res.pending], ['Expired', res.expired]].map(([l, v]) => `<div class="stat"><small>${l}</small><b>${v}</b></div>`).join('')}</div><div class="card" style="margin-top:14px"><h3>Sales by Plan</h3><div class="table-wrap"><table><thead><tr><th>Plan</th><th>Count</th><th>Active</th><th>Revenue</th></tr></thead><tbody>${(res.byPlan || []).map(p => `<tr><td>${esc(p.plan)}</td><td>${p.count}</td><td>${p.active || 0}</td><td>${fmtINR(p.revenue)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No data</td></tr>'}</tbody></table></div></div>`;
    else if (type === 'revenue') body.innerHTML = `<div class="grid4">${[['Total Revenue', fmtINR(res.total)], ['Paid', res.count], ['Pending', res.pending], ['Refunded', res.refunded]].map(([l, v]) => `<div class="stat"><small>${l}</small><b>${v}</b></div>`).join('')}</div><div class="card" style="margin-top:14px"><h3>Daily Revenue</h3>${barChart(res.daily)}</div>`;
    else if (type === 'attendance') body.innerHTML = `<div class="grid4">${[['Total', res.total], ['Granted', res.granted], ['Denied', res.denied], ['Unique Members', res.uniqueMembers]].map(([l, v]) => `<div class="stat"><small>${l}</small><b>${v}</b></div>`).join('')}</div><div class="grid2"><div class="card"><h3>Daily Attendance</h3>${barChart(res.daily)}</div><div class="card"><h3>Peak Hours</h3>${barChart(res.hourly)}</div></div>`;
    else if (type === 'access') body.innerHTML = `<div class="grid3">${[['Total Attempts', res.total], ['Granted', res.granted], ['Denied', res.denied]].map(([l, v]) => `<div class="stat"><small>${l}</small><b>${v}</b></div>`).join('')}</div><div class="grid2"><div class="card"><h3>Denied Reasons</h3><ul class="plain">${Object.entries(res.deniedReasons || {}).map(([k, v]) => `<li><span>${esc(k)}</span><b>${v}</b></li>`).join('') || '<li><span class="muted">No denials</span></li>'}</ul></div><div class="card"><h3>Device Activity</h3><ul class="plain">${Object.entries(res.deviceActivity || {}).map(([k, v]) => `<li><span>${esc(k)}</span><b>${v}</b></li>`).join('') || '<li><span class="muted">No data</span></li>'}</ul></div></div>`;
    else if (type === 'trainer') body.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Trainer</th><th>Specialization</th><th>Status</th><th>Assigned Members</th><th>Workout Sessions</th><th>Progress Records</th></tr></thead><tbody>${res.map(t => `<tr><td><b>${esc(t.name)}</b></td><td class="muted">${esc(t.specialization || '—')}</td><td>${t.status === 'active' ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-cancelled">Disabled</span>'}</td><td>${t.assignedMembers}</td><td>${t.workoutSessions}</td><td>${t.progressRecords}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No trainers</td></tr>'}</tbody></table></div>`;
  }
  window.exportReport = async (type) => {
    try {
      const res = await api(`/api/admin/reports?type=${type}&from=${encodeURIComponent($('#repFrom').value || '')}&to=${encodeURIComponent($('#repTo').value || '')}`);
      if (type === 'member') exportCSV(res.rows, 'member-report.csv');
      else if (type === 'membership') exportCSV(res.byPlan, 'membership-report.csv');
      else if (type === 'revenue') exportCSV(Object.entries(res.daily).map(([d, v]) => ({ date: d, revenue: v })), 'revenue-report.csv');
      else if (type === 'attendance') exportCSV(Object.entries(res.daily).map(([d, v]) => ({ date: d, visits: v })), 'attendance-report.csv');
      else if (type === 'trainer') exportCSV(res, 'trainer-report.csv');
      else toast('No CSV for this report');
    } catch (e) { toast(e.message, true); }
  };

  // ---------------- NOTIFICATIONS ----------------
  async function viewNotifications() {
    const list = await api('/api/admin/notifications');
    try { await api('/api/admin/notifications/refresh', { method: 'POST' }); } catch (e) { }
    const fresh = await api('/api/admin/notifications');
    $('#content').innerHTML = `<div class="toolbar"><h3 style="margin:0">Notifications</h3><button class="btn btn-sm" onclick="route()"><i class="fa-solid fa-rotate"></i> Refresh</button></div>
      <div class="card">${(fresh || []).map(n => `<div class="recent-item" onclick="markRead('${n.id}')" style="cursor:pointer;opacity:${n.read ? '.6' : '1'}"><span class="ic" style="background:rgba(255,74,30,.15);color:var(--primary)"><i class="fa-solid fa-${n.type === 'MEMBERSHIP_EXPIRING' ? 'clock' : n.type === 'PAYMENT_RECEIVED' ? 'circle-check' : n.type === 'PAYMENT_FAILED' ? 'triangle-exclamation' : n.type === 'NEW_ENQUIRY' ? 'envelope' : n.type === 'ACCESS_DENIED' ? 'ban' : 'bell'}"></i></span><div style="flex:1"><b>${esc(n.title)}</b><br><span class="muted" style="font-size:12px">${esc(n.message || '')}</span></div><div style="text-align:right"><small class="muted">${fmtDT(n.created_at)}</small>${n.read ? '' : '<div><span class="badge badge-active">New</span></div>'}</div></div>`).join('') || '<div class="empty">No notifications</div>'}</div>`;
  }
  window.markRead = async (id) => { try { await api('/api/admin/notifications/' + id + '/read', { method: 'POST' }); loadNotificationDot(); route(); } catch (e) { } };

  // ---------------- SETTINGS ----------------
  async function viewSettings() {
    const s = await api('/api/admin/settings');
    const edit = can('ADMIN');
    $('#content').innerHTML = `<div class="toolbar"><h3 style="margin:0">Site Settings</h3>${edit ? '<button class="btn btn-primary btn-sm" onclick="saveSettings()"><i class="fa-solid fa-floppy-disk"></i> Save</button>' : ''}</div>
      <div class="card"><div class="form-grid" id="settingsGrid">
        ${field('sGym', 'Gym name', s.gym_name, '', 'text')}
        <div class="span2"><label class="label">Logo URL</label><div style="display:flex;gap:8px;align-items:center"><input id="sLogo" class="input" value="${esc(s.logo || '')}"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('sLogFile').click()"><i class="fa-solid fa-upload"></i> Upload</button><input type="file" id="sLogFile" accept="image/*" style="display:none" onchange="settingsUpload(this,'sLogo')"></div></div>
        ${field('sTag', 'Tagline', s.tagline, '')}
        ${field('sDesc', 'Description', s.description, '', 'textarea')}
        ${field('sPhone', 'Phone', s.phone, '')}
        ${field('sEmail', 'Email', s.email, '', 'email')}
        ${field('sAddr', 'Address', s.address, '', 'textarea')}
        ${field('sHours', 'Opening hours', s.opening_hours, '')}
        ${field('sWa', 'WhatsApp', s.whatsapp, '')}
        ${field('sIg', 'Instagram', s.instagram, '')}
        ${field('sFb', 'Facebook', s.facebook, '')}
        ${field('sYt', 'YouTube', s.youtube, '')}
        ${field('sMaps', 'Google Maps', s.google_maps, '')}
        ${field('sHero', 'Hero text', s.hero_text, '')}
        ${field('sCta', 'CTA text', s.cta_text, '')}
      </div></div>
      <p class="muted" style="font-size:11px">Secrets (API keys, webhook secrets) are never stored here.</p>`;
  }
  window.saveSettings = async () => {
    const f = id => { const el = $(id); return el ? el.value : undefined; };
    const payload = { gym_name: f('#sGym'), logo: f('#sLogo'), tagline: f('#sTag'), description: f('#sDesc'), phone: f('#sPhone'), email: f('#sEmail'), address: f('#sAddr'), opening_hours: f('#sHours'), whatsapp: f('#sWa'), instagram: f('#sIg'), facebook: f('#sFb'), youtube: f('#sYt'), google_maps: f('#sMaps'), hero_text: f('#sHero'), cta_text: f('#sCta') };
    for (const k in payload) if (payload[k] === undefined) delete payload[k];
    try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) }); toast('Settings saved ✓'); } catch (e) { toast(e.message, true); }
  };
  window.settingsUpload = async (fileInput, fieldId) => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Max 5MB', true); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try { const j = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result, bucket: 'gallery' }) }); $('#' + fieldId).value = j.url; toast('Image uploaded ✓'); } catch (e) { toast(e.message, true); }
    };
    reader.readAsDataURL(file);
  };

  // ---------------- AUDIT ----------------
  async function viewAudit(q) {
    const page = parseInt(q.page || '1', 10);
    const res = await api(`/api/admin/audit?q=${encodeURIComponent(q.q || '')}&page=${page}&pageSize=20`);
    $('#content').innerHTML = `
      <div class="toolbar"><div class="search"><i class="fa-solid fa-magnifying-glass" style="color:var(--muted)"></i><input placeholder="Search action, actor, entity…" value="${esc(q.q || '')}" onkeydown="if(event.key==='Enter'){location.hash='#/audit?q='+encodeURIComponent(this.value)}"></div></div>
      <div class="table-wrap"><table><thead><tr><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Timestamp</th></tr></thead>
      <tbody>${res.data.map(a => `<tr><td><b>${esc(a.actor_email || 'system')}</b></td><td>${esc(a.actor_role || '—')}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td><td class="muted">${esc(a.entity_id || '—')}</td><td class="muted">${fmtDT(a.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No audit logs</td></tr>'}</tbody></table></div>
      ${pagination('audit', page, res.total, 20)}`;
  }

  // ---------------- UI helpers wired globally ----------------
  window.closeModal = closeModal;
  window.closeConfirm = closeConfirm;
  window.toggleSidebar = () => $('#sidebar').classList.toggle('open');

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeConfirm(); } });

  // ---------------- boot ----------------
  window.addEventListener('load', async () => {
    if (storedGet('skyfit_token')) {
      try { await initApp(); } catch (e) { doLogout(); }
    }
  });

  // expose for inline onclick usage
  window.doLogin = doLogin;
  window.doLogout = doLogout;
})();
