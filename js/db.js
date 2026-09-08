/**
 * db.js — Local storage database layer
 * Full-featured: workers, logs, settings, lockouts, shifts, leave, photos
 */

const DB = (() => {

  const KEYS = {
    WORKERS:        'signout_workers',
    LOGS:           'signout_logs',
    SETTINGS:       'signout_settings',
    LOCKOUTS:       'signout_lockouts',
    LEAVE:          'signout_leave',
    ROTAS:          'signout_rotas',       // { [weekKey]: { [workerId]: [{ day, shiftId }] } }
    SHIFTS:         'signout_shifts',      // shift templates [{id,name,start,end,color}]
    SWAPS:          'signout_swaps',       // swap requests
    AUDIT_LOGS:     'signout_audit',       // admin audit trail
    LOCATIONS:      'signout_locations',   // multi-site geofences
    LEAVE_REQUESTS: 'signout_leave_reqs',  // worker time-off requests
    OPEN_SHIFTS:    'signout_open_shifts', // shift bidding
  };

  // ── LEGACY MIGRATION: copy worktap_* keys → signout_* on first load (backward compat)
  const LEGACY_KEYS = {
    signout_workers:    'worktap_workers',
    signout_logs:       'worktap_logs',
    signout_settings:   'worktap_settings',
    signout_lockouts:   'worktap_lockouts',
    signout_leave:      'worktap_leave',
    signout_rotas:      'worktap_rotas',
    signout_shifts:     'worktap_shifts',
    signout_swaps:      'worktap_swaps',
    signout_audit:      'worktap_audit',
    signout_locations:  'worktap_locations',
    signout_leave_reqs: 'worktap_leave_reqs',
    signout_open_shifts:'worktap_open_shifts',
  };
  (function _migrateLegacyKeys() {
    try {
      for (const [newKey, oldKey] of Object.entries(LEGACY_KEYS)) {
        if (!localStorage.getItem(newKey) && localStorage.getItem(oldKey)) {
          localStorage.setItem(newKey, localStorage.getItem(oldKey));
          console.info('[SignOut] Migrated ' + oldKey + ' → ' + newKey);
        }
      }
      // Also migrate notification flag
      if (!localStorage.getItem('signout_wa_last_sent') && localStorage.getItem('wt_wa_last_sent')) {
        localStorage.setItem('signout_wa_last_sent', localStorage.getItem('wt_wa_last_sent'));
      }
    } catch {}
  })();

  // ─────────────────────────────────────────
  // WORKERS
  // ─────────────────────────────────────────

  function getWorkers() {
    return JSON.parse(localStorage.getItem(KEYS.WORKERS) || '[]');
  }
  function saveWorkers(w) { localStorage.setItem(KEYS.WORKERS, JSON.stringify(w)); }

  function addWorker(name, role, username, pin, nfcId) {
    const _s = (typeof Sanitize !== 'undefined' ? Sanitize.strip : (v,n)=>String(v||'').trim().slice(0,n||120));
    const workers = getWorkers();
    const worker = {
      id:                'w_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      name:              _s(name, 80),
      role:              _s(role, 60) || 'Worker',
      username:          _s(username, 40).toLowerCase(),
      pin:               String(pin).trim().slice(0,6),
      nfcId:             nfcId || '',
      clockedIn:         false,
      lastAction:        null,
      lastActionTime:    null,
      // Device lock
      deviceFingerprint: null,
      deviceShortId:     null,
      deviceRegistered:  false,
      // Schedule / time window
      shiftStart:        '',    // 'HH:MM' 24h
      shiftEnd:          '',    // 'HH:MM' 24h
      allowedDays:       [1,2,3,4,5], // Mon-Fri (0=Sun)
      // Absence / leave
      onLeave:           false,
      leaveNote:         '',
    };
    workers.push(worker);
    saveWorkers(workers);
    return worker;
  }

  function updateWorker(id, updates) {
    const workers = getWorkers();
    const idx = workers.findIndex(w => w.id === id);
    if (idx === -1) return null;
    workers[idx] = { ...workers[idx], ...updates };
    saveWorkers(workers);
    return workers[idx];
  }

  function deleteWorker(id) { saveWorkers(getWorkers().filter(w => w.id !== id)); }
  function getWorkerById(id) { return getWorkers().find(w => w.id === id) || null; }
  function getWorkerByNfcId(nfcId) { return getWorkers().find(w => w.nfcId && w.nfcId === nfcId) || null; }
  function getWorkerByUsername(u) { return getWorkers().find(w => w.username === u.trim().toLowerCase()) || null; }

  // ─────────────────────────────────────────
  // AUTHENTICATION (PIN + device + lockout)
  // ─────────────────────────────────────────

  async function authenticateWorker(workerId, pin) {
    const w = getWorkerById(workerId);
    if (!w) return { success: false, reason: 'pin' };

    // Lockout check
    const lockout = getLockout(workerId);
    if (lockout.locked) {
      const mins = Math.ceil((lockout.until - Date.now()) / 60000);
      return { success: false, reason: 'locked', mins };
    }

    // Leave check
    if (w.onLeave) return { success: false, reason: 'leave', note: w.leaveNote };

    // PIN check
    if (w.pin !== String(pin).trim()) {
      recordFailedAttempt(workerId);
      const remaining = 3 - getFailedAttempts(workerId);
      return { success: false, reason: 'pin', remaining: Math.max(0, remaining) };
    }

    // Time window check
    const timeCheck = checkTimeWindow(w);
    if (!timeCheck.allowed) return { success: false, reason: 'time', message: timeCheck.message };

    // Day check
    const dayCheck = checkAllowedDay(w);
    if (!dayCheck.allowed) return { success: false, reason: 'day', message: dayCheck.message };

    // Device check
    const fp      = await Device.getFingerprint();
    const shortId = await Device.getShortId();

    if (!w.deviceRegistered) {
      updateWorker(workerId, { deviceFingerprint: fp, deviceShortId: shortId, deviceRegistered: true });
      clearFailedAttempts(workerId);
      return { success: true, worker: getWorkerById(workerId), firstTime: true };
    }

    if (w.deviceFingerprint !== fp) {
      return { success: false, reason: 'device' };
    }

    clearFailedAttempts(workerId);
    return { success: true, worker: getWorkerById(workerId), firstTime: false };
  }

  function resetWorkerDevice(workerId) {
    updateWorker(workerId, { deviceFingerprint: null, deviceShortId: null, deviceRegistered: false });
  }

  // ─────────────────────────────────────────
  // LOCKOUT MANAGEMENT
  // ─────────────────────────────────────────
  const LOCKOUT_ATTEMPTS = 3;
  const LOCKOUT_MS       = 10 * 60 * 1000; // 10 min

  function getLockouts() { return JSON.parse(localStorage.getItem(KEYS.LOCKOUTS) || '{}'); }
  function saveLockouts(l) { localStorage.setItem(KEYS.LOCKOUTS, JSON.stringify(l)); }

  function getLockout(workerId) {
    const all = getLockouts();
    const entry = all[workerId] || { attempts: 0, until: 0 };
    if (entry.until && Date.now() < entry.until) return { locked: true, until: entry.until };
    return { locked: false, attempts: entry.attempts || 0 };
  }

  function getFailedAttempts(workerId) {
    return (getLockouts()[workerId] || {}).attempts || 0;
  }

  function recordFailedAttempt(workerId) {
    const all  = getLockouts();
    const prev = all[workerId] || { attempts: 0, until: 0 };
    const next = prev.attempts + 1;
    if (next >= LOCKOUT_ATTEMPTS) {
      all[workerId] = { attempts: next, until: Date.now() + LOCKOUT_MS };
    } else {
      all[workerId] = { attempts: next, until: 0 };
    }
    saveLockouts(all);
  }

  function clearFailedAttempts(workerId) {
    const all = getLockouts();
    delete all[workerId];
    saveLockouts(all);
  }

  // ─────────────────────────────────────────
  // TIME WINDOW / DAY CHECKS
  // ─────────────────────────────────────────

  function checkTimeWindow(worker) {
    if (!worker.shiftStart || !worker.shiftEnd) return { allowed: true };
    const now    = new Date();
    const hhmm   = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = worker.shiftStart.split(':').map(Number);
    const [eh, em] = worker.shiftEnd.split(':').map(Number);
    // Allow 30 min early buffer for clock-in
    const startMin = sh * 60 + sm - 30;
    const endMin   = eh * 60 + em + 15; // 15 min grace after shift end
    if (hhmm < startMin || hhmm > endMin) {
      return {
        allowed: false,
        message: `You can only clock in between ${_fmt12(worker.shiftStart)} and ${_fmt12(worker.shiftEnd)} (±30 min).`
      };
    }
    return { allowed: true };
  }

  function checkAllowedDay(worker) {
    if (!worker.allowedDays || worker.allowedDays.length === 0) return { allowed: true };
    const day = new Date().getDay(); // 0=Sun
    if (!worker.allowedDays.includes(day)) {
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const allowed = worker.allowedDays.map(d => days[d]).join(', ');
      return { allowed: false, message: `You are not scheduled today. Allowed days: ${allowed}.` };
    }
    return { allowed: true };
  }

  function _fmt12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  }

  // ─────────────────────────────────────────
  // LOGS
  // ─────────────────────────────────────────

  function getLogs() { return JSON.parse(localStorage.getItem(KEYS.LOGS) || '[]'); }
  function saveLogs(l) { localStorage.setItem(KEYS.LOGS, JSON.stringify(l)); }

  function addLog(workerId, workerName, action, photoDataUrl) {
    const logs = getLogs();
    const now  = new Date();
    const log  = {
      id:        'l_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      workerId,
      workerName,
      action,
      timestamp: now.toISOString(),
      date:      now.toLocaleDateString('en-US', { year:'numeric', month:'2-digit', day:'2-digit' }),
      time:      now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
      photo:     photoDataUrl || null,
      synced:    false,
    };
    logs.push(log);
    saveLogs(logs);
    return log;
  }

  function getLogs_dateRange(from, to) {
    // from/to: 'YYYY-MM-DD'
    return getLogs().filter(l => {
      const d = l.timestamp.slice(0,10);
      return d >= from && d <= to;
    });
  }

  function getLogsForWorker(workerId) { return getLogs().filter(l => l.workerId === workerId); }

  function getLogsForWorkerToday(workerId) {
    const today = _localDateStr();
    return getLogs()
      .filter(l => l.workerId === workerId && l.timestamp.slice(0,10) === today)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function getLogsForWorkerRange(workerId, from, to) {
    return getLogs()
      .filter(l => l.workerId === workerId && l.timestamp.slice(0,10) >= from && l.timestamp.slice(0,10) <= to)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function markLogsSynced(ids) {
    saveLogs(getLogs().map(l => ids.includes(l.id) ? { ...l, synced: true } : l));
  }

  function calcHours(logs) {
    let totalMs = 0;
    let shiftStart = null;
    let breakStart = null;
    let breakMs = 0;

    const sorted = [...logs].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    for (const l of sorted) {
      if (l.action === 'IN') {
        shiftStart = new Date(l.timestamp);
        breakMs = 0;
      } else if (l.action === 'BREAK_START' && shiftStart) {
        breakStart = new Date(l.timestamp);
      } else if (l.action === 'BREAK_END' && breakStart) {
        breakMs += (new Date(l.timestamp) - breakStart);
        breakStart = null;
      } else if (l.action === 'OUT' && shiftStart) {
        let shiftEnd = new Date(l.timestamp);
        let grossMs = shiftEnd - shiftStart;
        if (breakStart) {
          breakMs += (shiftEnd - breakStart);
          breakStart = null;
        }
        let netMs = Math.max(0, grossMs - breakMs);
        totalMs += netMs;
        shiftStart = null;
        breakMs = 0;
      }
    }
    return totalMs / 3600000;
  }

  function calcHoursToday(workerId) { return calcHours(getLogsForWorkerToday(workerId)); }

  function calcHoursWeek(workerId) {
    const { from, to } = _weekRange();
    return calcHours(getLogsForWorkerRange(workerId, from, to));
  }

  // ─────────────────────────────────────────
  // LEAVE MANAGEMENT
  // ─────────────────────────────────────────

  function setLeave(workerId, onLeave, note) {
    updateWorker(workerId, { onLeave: !!onLeave, leaveNote: note || '' });
  }

  // ─────────────────────────────────────────
  // SETTINGS
  // ─────────────────────────────────────────

  function getSettings() {
    return JSON.parse(localStorage.getItem(KEYS.SETTINGS) || JSON.stringify({
      adminPin:             '1234',
      businessName:         'SignOut Attendance',
      sheetsUrl:            '',
      gpsEnabled:           false,
      workplaceLat:         '',
      workplaceLng:         '',
      workplaceRadius:      100,
      inactivityMins:       5,
      selfieEnabled:        false,
      pushEnabled:          false,
      whatsappNumber:       '',
      whatsappEnabled:      false,
      dailyReportTime:      '18:00',
      audioEnabled:         true,
      kioskModeEnabled:     false,
      kioskTimeoutSec:      15,
      dailyOvertimeHours:   8,
      weeklyOvertimeHours:  40,
      webhookUrl:           '',
      webhooksEnabled:      false,
      departments:          ['Sales', 'Kitchen', 'Service', 'Warehouse', 'Admin', 'Maintenance'],
    }));
  }
  function saveSettings(updates) {
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify({ ...getSettings(), ...updates }));
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  function _localDateStr(d = new Date()) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
  }

  function _weekRange() {
    const now  = new Date();
    const day  = now.getDay(); // 0=Sun
    const mon  = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1)); mon.setHours(0,0,0,0);
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: _localDateStr(mon), to: _localDateStr(sun) };
  }

  function getWeekRange() { return _weekRange(); }
  function localDateStr(d) { return _localDateStr(d); }

  // ─────────────────────────────────────────
  // SEED
  // ─────────────────────────────────────────

  function seedIfEmpty() {
    if (getWorkers().length > 0) return;
    const roster = [
      ['Maria Santos',    'Cashier',     'maria',   '1111'],
      ['Juan dela Cruz',  'Supervisor',  'juan',    '2222'],
      ['Ana Reyes',       'Stock Clerk', 'ana',     '3333'],
      ['Carlos Gomez',    'Security',    'carlos',  '4444'],
      ['Lena Torres',     'Cashier',     'lena',    '5555'],
      ['Mark Villanueva', 'Delivery',    'mark',    '6666'],
      ['Rosa Mendoza',    'Cashier',     'rosa',    '7777'],
      ['Ben Cruz',        'Maintenance', 'ben',     '8888'],
      ['Cynthia Lim',     'Admin',       'cynthia', '9999'],
      ['Danny Ramos',     'Stock Clerk', 'danny',   '1212'],
      ['Elena Bautista',  'Cashier',     'elena',   '2323'],
      ['Felix Navarro',   'Delivery',    'felix',   '3434'],
      ['Grace Castillo',  'Supervisor',  'grace',   '4545'],
      ['Hector Diaz',     'Security',    'hector',  '5656'],
      ['Iris Aguilar',    'Admin',       'iris',    '6767'],
      ['Joel Espinoza',   'Stock Clerk', 'joel',    '7878'],
      ['Karen Flores',    'Cashier',     'karen',   '8989'],
      ['Luis Morales',    'Delivery',    'luis',    '9090'],
      ['Mia Vargas',      'Cashier',     'mia',     '1357'],
      ['Noel Aquino',     'Maintenance', 'noel',    '2468'],
    ];
    roster.forEach(([name, role, username, pin]) => addWorker(name, role, username, pin, ''));
  }

  // ─────────────────────────────────────────
  // ROTA / SHIFT TEMPLATES
  // ─────────────────────────────────────────

  const DEFAULT_SHIFTS = [
    { id: 'morning',   name: 'Morning',   start: '08:00', end: '16:00', color: '#1a73e8' },
    { id: 'afternoon', name: 'Afternoon', start: '12:00', end: '20:00', color: '#e65100' },
    { id: 'night',     name: 'Night',     start: '20:00', end: '04:00', color: '#6c47ff' },
    { id: 'full',      name: 'Full Day',  start: '08:00', end: '20:00', color: '#009624' },
    { id: 'off',       name: 'Day Off',   start: '',      end: '',      color: '#9ca3af' },
  ];

  function getShiftTemplates() {
    const stored = localStorage.getItem(KEYS.SHIFTS);
    return stored ? JSON.parse(stored) : DEFAULT_SHIFTS;
  }

  function saveShiftTemplates(shifts) {
    localStorage.setItem(KEYS.SHIFTS, JSON.stringify(shifts));
  }

  function addShiftTemplate(name, start, end, color) {
    const shifts = getShiftTemplates();
    const t = { id: 'shift_' + Date.now(), name, start, end, color: color || '#1a73e8' };
    shifts.push(t);
    saveShiftTemplates(shifts);
    return t;
  }

  function deleteShiftTemplate(id) {
    const keep = ['morning','afternoon','night','full','off']; // protect defaults
    if (keep.includes(id)) return false;
    saveShiftTemplates(getShiftTemplates().filter(s => s.id !== id));
    return true;
  }

  function getShiftById(id) {
    return getShiftTemplates().find(s => s.id === id) || null;
  }

  // ─────────────────────────────────────────
  // ROTA WEEKS
  // weekKey = 'YYYY-MM-DD' of Monday
  // rota[weekKey][workerId] = array of 7 entries (index 0=Mon..6=Sun)
  // each entry: shiftId or null
  // ─────────────────────────────────────────

  function getRotas() {
    return JSON.parse(localStorage.getItem(KEYS.ROTAS) || '{}');
  }
  function saveRotas(r) { localStorage.setItem(KEYS.ROTAS, JSON.stringify(r)); }

  /** Get rota for a specific week. Returns { [workerId]: [7 shiftIds|null] } */
  function getWeekRota(weekKey) {
    return getRotas()[weekKey] || {};
  }

  /** Set a single cell in the rota */
  function setRotaCell(weekKey, workerId, dayIndex, shiftId) {
    const rotas = getRotas();
    if (!rotas[weekKey]) rotas[weekKey] = {};
    if (!rotas[weekKey][workerId]) rotas[weekKey][workerId] = [null,null,null,null,null,null,null];
    rotas[weekKey][workerId][dayIndex] = shiftId || null;
    saveRotas(rotas);
  }

  /** Copy a whole week rota to another week */
  function copyWeekRota(fromWeek, toWeek) {
    const rotas = getRotas();
    if (!rotas[fromWeek]) return;
    rotas[toWeek] = JSON.parse(JSON.stringify(rotas[fromWeek]));
    saveRotas(rotas);
  }

  /** Save current week as a named template */
  function saveRotaTemplate(weekKey, templateName) {
    const settings = getSettings();
    if (!settings.rotaTemplates) settings.rotaTemplates = {};
    settings.rotaTemplates[templateName] = getWeekRota(weekKey);
    saveSettings({ rotaTemplates: settings.rotaTemplates });
  }

  /** Load a named rota template into a week */
  function loadRotaTemplate(templateName, weekKey) {
    const settings = getSettings();
    const tpl = (settings.rotaTemplates || {})[templateName];
    if (!tpl) return false;
    const rotas = getRotas();
    rotas[weekKey] = JSON.parse(JSON.stringify(tpl));
    saveRotas(rotas);
    return true;
  }

  function getRotaTemplateNames() {
    const settings = getSettings();
    return Object.keys(settings.rotaTemplates || {});
  }

  /** Get a worker's scheduled shift for a specific date */
  function getWorkerShiftForDate(workerId, dateStr) {
    const monday = _getMondayOf(dateStr);
    const rota   = getWeekRota(monday);
    const workerRow = rota[workerId];
    if (!workerRow) return null;
    const dayIndex = _dayIndex(dateStr); // 0=Mon..6=Sun
    const shiftId  = workerRow[dayIndex];
    return shiftId ? getShiftById(shiftId) : null;
  }

  /** Check if a worker is scheduled right now */
  function isWorkerScheduledNow(workerId) {
    const today = localDateStr();
    const shift = getWorkerShiftForDate(workerId, today);
    if (!shift || shift.id === 'off' || !shift.start) return { scheduled: false, shift: null };
    return { scheduled: true, shift };
  }

  // ─────────────────────────────────────────
  // SWAP REQUESTS
  // ─────────────────────────────────────────

  function getSwaps() {
    return JSON.parse(localStorage.getItem(KEYS.SWAPS) || '[]');
  }
  function saveSwaps(s) { localStorage.setItem(KEYS.SWAPS, JSON.stringify(s)); }

  function requestSwap(fromWorkerId, toWorkerId, weekKey, dayIndex) {
    const swaps = getSwaps();
    const swap = {
      id:           'swap_' + Date.now(),
      fromWorkerId,
      toWorkerId,
      weekKey,
      dayIndex,
      status:       'pending',  // pending | approved | denied
      requestedAt:  new Date().toISOString(),
    };
    swaps.push(swap);
    saveSwaps(swaps);
    return swap;
  }

  function resolveSwap(swapId, approve) {
    const swaps = getSwaps();
    const idx   = swaps.findIndex(s => s.id === swapId);
    if (idx === -1) return false;
    swaps[idx].status = approve ? 'approved' : 'denied';
    if (approve) {
      // Execute the swap in the rota
      const { fromWorkerId, toWorkerId, weekKey, dayIndex } = swaps[idx];
      const rotas = getRotas();
      if (!rotas[weekKey]) return false;
      const fromShift = (rotas[weekKey][fromWorkerId] || [])[dayIndex] || null;
      const toShift   = (rotas[weekKey][toWorkerId]   || [])[dayIndex] || null;
      setRotaCell(weekKey, fromWorkerId, dayIndex, toShift);
      setRotaCell(weekKey, toWorkerId,   dayIndex, fromShift);
    }
    saveSwaps(swaps);
    return true;
  }

  function getPendingSwaps() {
    return getSwaps().filter(s => s.status === 'pending');
  }

  // ─────────────────────────────────────────
  // ROTA HELPERS
  // ─────────────────────────────────────────

  /** Get Monday's date string for any date string */
  function _getMondayOf(dateStr) {
    const d   = new Date(dateStr + 'T12:00:00');
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return _localDateStr(d);
  }

  /** Day index in rota: Mon=0, Tue=1 ... Sun=6 */
  function _dayIndex(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay(); // 0=Sun
    return day === 0 ? 6 : day - 1;
  }

  function getMondayOf(dateStr) { return _getMondayOf(dateStr); }
  function getDayIndex(dateStr)  { return _dayIndex(dateStr); }

  /** Get array of 7 date strings [Mon..Sun] for a given weekKey */
  function getWeekDays(weekKey) {
    const days = [];
    const mon  = new Date(weekKey + 'T12:00:00');
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      days.push(_localDateStr(d));
    }
    return days;
  }

  // ─────────────────────────────────────────
  // AUDIT TRAIL LOGGING
  // ─────────────────────────────────────────

  function getAuditLogs() {
    return JSON.parse(localStorage.getItem(KEYS.AUDIT_LOGS) || '[]');
  }
  function saveAuditLogs(logs) {
    localStorage.setItem(KEYS.AUDIT_LOGS, JSON.stringify(logs));
  }

  function addAuditLog(action, details, user = 'Admin') {
    // Sanitize to prevent stored XSS via audit trail
    if (typeof Sanitize !== 'undefined') { action = Sanitize.strip(action, 60); details = Sanitize.strip(details, 300); user = Sanitize.strip(user, 40) || 'Admin'; }
    const logs = getAuditLogs();
    const now = new Date();
    const entry = {
      id: 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: now.toISOString(),
      dateStr: now.toLocaleString(),
      user,
      action,
      details
    };
    logs.unshift(entry); // latest first
    if (logs.length > 500) logs.pop(); // keep last 500
    saveAuditLogs(logs);
    return entry;
  }

  // ─────────────────────────────────────────
  // MULTI-SITE LOCATION GEOFENCING
  // ─────────────────────────────────────────

  function getLocations() {
    const locs = JSON.parse(localStorage.getItem(KEYS.LOCATIONS) || '[]');
    if (locs.length === 0) {
      const s = getSettings();
      if (s.workplaceLat && s.workplaceLng) {
        locs.push({
          id: 'loc_main',
          name: 'Main HQ',
          lat: s.workplaceLat,
          lng: s.workplaceLng,
          radius: s.workplaceRadius || 100
        });
      }
    }
    return locs;
  }
  function saveLocations(locs) {
    localStorage.setItem(KEYS.LOCATIONS, JSON.stringify(locs));
  }

  function addLocation(name, lat, lng, radius) {
    const _s2 = (typeof Sanitize !== 'undefined' ? Sanitize.strip : (v,n)=>String(v||'').trim().slice(0,n||120));
    const locs = getLocations();
    const loc = {
      id: 'loc_' + Date.now(),
      name: _s2(name, 60) || 'Workplace',
      lat: String(lat).trim(),
      lng: String(lng).trim(),
      radius: Number(radius) || 100
    };
    locs.push(loc);
    saveLocations(locs);
    addAuditLog('ADD_LOCATION', `Added site: ${loc.name}`);
    return loc;
  }

  function deleteLocation(id) {
    saveLocations(getLocations().filter(l => l.id !== id));
    addAuditLog('DELETE_LOCATION', `Deleted site ID: ${id}`);
  }

  // ─────────────────────────────────────────
  // WORKER LEAVE REQUESTS
  // ─────────────────────────────────────────

  function getLeaveRequests() {
    return JSON.parse(localStorage.getItem(KEYS.LEAVE_REQUESTS) || '[]');
  }
  function saveLeaveRequests(reqs) {
    localStorage.setItem(KEYS.LEAVE_REQUESTS, JSON.stringify(reqs));
  }

  function requestLeave(workerId, workerName, type, startDate, endDate, reason) {
    const reqs = getLeaveRequests();
    const _s3 = (typeof Sanitize !== 'undefined' ? Sanitize.strip : (v,n)=>String(v||'').trim().slice(0,n||120));
    const req = {
      id: 'req_' + Date.now(),
      workerId,
      workerName: _s3(workerName, 80),
      type, // 'PTO' | 'Sick' | 'Personal'
      startDate,
      endDate,
      reason: _s3(reason, 200),
      status: 'pending', // 'pending' | 'approved' | 'rejected'
      createdAt: new Date().toISOString()
    };
    reqs.unshift(req);
    saveLeaveRequests(reqs);
    return req;
  }

  function resolveLeaveRequest(requestId, approve, adminNote = '') {
    const reqs = getLeaveRequests();
    const idx = reqs.findIndex(r => r.id === requestId);
    if (idx === -1) return false;
    reqs[idx].status = approve ? 'approved' : 'rejected';
    reqs[idx].adminNote = adminNote;

    if (approve) {
      // Set worker leave status if request spans today
      const req = reqs[idx];
      const today = _localDateStr();
      if (today >= req.startDate && today <= req.endDate) {
        setLeave(req.workerId, true, `${req.type}: ${req.reason}`);
      }
    }

    saveLeaveRequests(reqs);
    addAuditLog('RESOLVE_LEAVE', `${approve ? 'Approved' : 'Rejected'} leave for worker ${reqs[idx].workerName}`);
    return true;
  }

  // ─────────────────────────────────────────
  // OPEN SHIFTS & BIDDING
  // ─────────────────────────────────────────

  function getOpenShifts() {
    return JSON.parse(localStorage.getItem(KEYS.OPEN_SHIFTS) || '[]');
  }
  function saveOpenShifts(shifts) {
    localStorage.setItem(KEYS.OPEN_SHIFTS, JSON.stringify(shifts));
  }

  function addOpenShift(dateStr, shiftId, roleRequired = '') {
    const shifts = getOpenShifts();
    const shiftInfo = getShiftById(shiftId);
    const item = {
      id: 'open_' + Date.now(),
      dateStr,
      shiftId,
      shiftName: shiftInfo ? shiftInfo.name : 'Shift',
      roleRequired,
      bids: [], // [{ workerId, workerName, timestamp }]
      status: 'open' // 'open' | 'assigned'
    };
    shifts.push(item);
    saveOpenShifts(shifts);
    addAuditLog('ADD_OPEN_SHIFT', `Posted open shift on ${dateStr}`);
    return item;
  }

  function bidOpenShift(openShiftId, workerId, workerName) {
    const shifts = getOpenShifts();
    const item = shifts.find(s => s.id === openShiftId);
    if (!item || item.status !== 'open') return false;
    if (item.bids.some(b => b.workerId === workerId)) return true; // already bid
    item.bids.push({ workerId, workerName, timestamp: new Date().toISOString() });
    saveOpenShifts(shifts);
    return true;
  }

  function assignOpenShift(openShiftId, workerId) {
    const shifts = getOpenShifts();
    const item = shifts.find(s => s.id === openShiftId);
    if (!item) return false;
    item.status = 'assigned';
    item.assignedWorkerId = workerId;

    // Put into rota
    const monday = _getMondayOf(item.dateStr);
    const dayIdx = _dayIndex(item.dateStr);
    setRotaCell(monday, workerId, dayIdx, item.shiftId);

    saveOpenShifts(shifts);
    addAuditLog('ASSIGN_OPEN_SHIFT', `Assigned open shift on ${item.dateStr} to worker ID ${workerId}`);
    return true;
  }

  // ─────────────────────────────────────────
  // CLOUD DATABASE BACKUP & RESTORE
  // ─────────────────────────────────────────

  function exportFullDatabase() {
    const exportObj = {};
    Object.keys(KEYS).forEach(k => {
      exportObj[KEYS[k]] = localStorage.getItem(KEYS[k]);
    });
    exportObj._exportedAt = new Date().toISOString();
    return JSON.stringify(exportObj, null, 2);
  }

  function importFullDatabase(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      Object.keys(KEYS).forEach(k => {
        const keyName = KEYS[k];
        if (data[keyName] !== undefined) {
          localStorage.setItem(keyName, typeof data[keyName] === 'string' ? data[keyName] : JSON.stringify(data[keyName]));
        }
      });
      addAuditLog('RESTORE_DATABASE', 'Restored database backup.');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ─────────────────────────────────────────

  return {
    // Workers
    getWorkers, addWorker, updateWorker, deleteWorker,
    getWorkerById, getWorkerByNfcId, getWorkerByUsername,
    authenticateWorker, resetWorkerDevice,
    // Lockout
    getLockout, clearFailedAttempts,
    // Leave
    setLeave,
    // Logs
    getLogs, addLog, getLogs_dateRange,
    getLogsForWorker, getLogsForWorkerToday, getLogsForWorkerRange,
    markLogsSynced, calcHours, calcHoursToday, calcHoursWeek,
    // Settings
    getSettings, saveSettings,
    // Helpers
    getWeekRange, localDateStr, getMondayOf, getDayIndex,
    // Rota
    getShiftTemplates, saveShiftTemplates, addShiftTemplate, deleteShiftTemplate, getShiftById,
    getWeekRota, setRotaCell, copyWeekRota,
    saveRotaTemplate, loadRotaTemplate, getRotaTemplateNames,
    getWorkerShiftForDate, isWorkerScheduledNow,
    getWeekDays,
    // Swaps
    getSwaps, requestSwap, resolveSwap, getPendingSwaps,
    // Audit
    getAuditLogs, addAuditLog,
    // Multi-site
    getLocations, addLocation, deleteLocation,
    // Leave Requests
    getLeaveRequests, requestLeave, resolveLeaveRequest,
    // Open Shifts
    getOpenShifts, addOpenShift, bidOpenShift, assignOpenShift,
    // Backup & Restore
    exportFullDatabase, importFullDatabase,
    seedIfEmpty,
  };

})();

