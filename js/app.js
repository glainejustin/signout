/**
 * app.js — Main controller
 * Features: login with lockout, auto-logout, selfie, history tab, offline sync,
 *           QR scan, NFC, GPS, device fingerprint
 */

const App = (() => {

  let currentWorker  = null;
  let selectedWorker = null;
  let pinEntry       = '';
  let pinSubmitting  = false;
  let nfcCooldown    = false;
  let inactivityTimer = null;
  let toastTimer      = null;
  let overlayTimer    = null;

  // ── INIT ─────────────────────────────────────────────────

  function init() {
    DB.seedIfEmpty();
    AudioFX.setEnabled(DB.getSettings().audioEnabled !== false);
    Workers.init();
    Logs.init();
    Admin.init();
    _initLogin();
    _initWorkerDash();
    _initKiosk();
    _initLeaveModal();
    _initQR();

    if (NFC.isSupported()) NFC.startClockScanning(_handleNfcTap);

    // Auto offline sync on reconnect
    window.addEventListener('online', _autoSync);

    // Notify watchers
    Notify.startForgotClockOutWatcher();
    Notify.scheduleWhatsAppReport();
  }

  // ── LOGIN ─────────────────────────────────────────────────

  function _initLogin() {
    const search = document.getElementById('workerSearch');
    search.addEventListener('input', () => _renderPickList(search.value));
    _renderPickList('');

    document.getElementById('changeWorkerBtn').addEventListener('click', _backToStep1);
    document.getElementById('goAdminLogin').addEventListener('click', () => showPage('admin'));
    document.getElementById('launchKioskBtn').addEventListener('click', () => showPage('kiosk'));

    // QR login button on login page
    document.getElementById('btnQrLogin').addEventListener('click', () => {
      QR.startScanner(_onQrScan);
    });
    document.getElementById('qrCancel').addEventListener('click', QR.stopScanner);
    document.getElementById('qrManualSubmit').addEventListener('click', () => {
      const val = document.getElementById('qrManualInput').value.trim();
      if (val) { QR.stopScanner(); _onQrScan(val); }
    });

    // Numpad — event delegation on stable parent
    document.querySelector('.numpad').addEventListener('click', e => {
      const btn = e.target.closest('.num-btn');
      if (!btn) return;
      AudioFX.playClick();
      _handleNumpad(btn.dataset.n);
    });
  }

  function _handleNumpad(n) {
    if (n === 'back') {
      pinEntry = pinEntry.slice(0, -1);
    } else if (n === 'ok') {
      _submitPin();
      return;
    } else {
      if (pinEntry.length >= 6) return;
      pinEntry += n;
      if (pinEntry.length === 4 && !pinSubmitting) setTimeout(_submitPin, 250);
    }
    _updatePinDots(pinEntry);
    const e = document.getElementById('loginPinError');
    if (e) e.classList.add('hidden');
  }

  function _renderPickList(query) {
    const list    = document.getElementById('workerPickList');
    const workers = DB.getWorkers();
    const q       = query.trim().toLowerCase();
    const filtered = q
      ? workers.filter(w => w.name.toLowerCase().includes(q) || w.username.toLowerCase().includes(q))
      : workers;

    list.innerHTML = '';
    if (!filtered.length) { list.innerHTML = '<p class="pick-empty">No workers found.</p>'; return; }

    filtered.forEach(w => {
      const btn = document.createElement('button');
      btn.className = 'worker-pick-btn';
      const statusTxt = w.onLeave ? '🏖 Leave' : w.clockedIn ? '● IN' : '○ OUT';
      const statusCls = w.onLeave ? 'leave' : w.clockedIn ? 'in' : '';
      btn.innerHTML = `
        <span class="pick-avatar">${_initials(w.name)}</span>
        <span class="pick-info">
          <span class="pick-name">${_esc(w.name)}</span>
          <span class="pick-role">${_esc(w.role)}</span>
        </span>
        <span class="pick-status ${statusCls}">${statusTxt}</span>
      `;
      btn.addEventListener('click', () => _selectWorker(w));
      list.appendChild(btn);
    });
  }

  function _selectWorker(worker) {
    selectedWorker = worker;
    pinEntry = ''; pinSubmitting = false;
    _updatePinDots('');
    document.getElementById('loginStep1').classList.add('hidden');
    document.getElementById('loginStep2').classList.remove('hidden');
    const e = document.getElementById('loginPinError');
    if (e) e.classList.add('hidden');
    document.getElementById('selectedWorkerBadge').innerHTML =
      `<span class="pick-avatar">${_initials(worker.name)}</span> ${_esc(worker.name)}`;
  }

  function _backToStep1() {
    selectedWorker = null; pinEntry = ''; pinSubmitting = false;
    _updatePinDots('');
    document.getElementById('loginStep2').classList.add('hidden');
    document.getElementById('loginStep1').classList.remove('hidden');
    const e = document.getElementById('loginPinError');
    if (e) e.classList.add('hidden');
    document.getElementById('workerSearch').value = '';
    _renderPickList('');
  }

  async function _submitPin() {
    if (pinSubmitting || !selectedWorker || pinEntry.length < 4) return;
    pinSubmitting = true;
    const pin = pinEntry; pinEntry = ''; _updatePinDots('');

    _showPinMsg('Checking... 🔒', false);
    const result = await DB.authenticateWorker(selectedWorker.id, pin);
    pinSubmitting = false;

    if (result.success) {
      const e = document.getElementById('loginPinError');
      if (e) e.classList.add('hidden');
      if (result.firstTime) showToast(`✅ Device registered for ${result.worker.name}!`);
      _loginAs(result.worker);

    } else if (result.reason === 'pin') {
      const msg = result.remaining > 0
        ? `❌ Wrong PIN. ${result.remaining} attempt${result.remaining>1?'s':''} left.`
        : '🔒 Account locked for 10 minutes.';
      _showPinMsg(msg);

    } else if (result.reason === 'locked') {
      _showPinMsg(`🔒 Locked. Try again in ${result.mins} min.`);

    } else if (result.reason === 'device') {
      _showDeviceBlocked(selectedWorker);

    } else if (result.reason === 'leave') {
      _showPinMsg(`🏖 ${selectedWorker.name} is on leave.${result.note ? ' Note: '+result.note : ''}`);

    } else if (result.reason === 'time') {
      _showPinMsg(`⏰ ${result.message}`);

    } else if (result.reason === 'day') {
      _showPinMsg(`📅 ${result.message}`);
    }
  }

  function _showPinMsg(msg, shake = true) {
    const el = document.getElementById('loginPinError');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    if (shake) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  }

  function _showDeviceBlocked(worker) {
    document.getElementById('loginStep2').innerHTML = `
      <div class="device-blocked">
        <div class="blocked-icon">🚫</div>
        <h3 class="blocked-title">Wrong Device</h3>
        <p class="blocked-msg"><strong>${_esc(worker.name)}'s</strong> account is locked to a different phone.<br><br>
        Use the phone registered for this account, or ask admin to reset your device.</p>
        <button class="btn btn-out" id="blockedBack">← Go Back</button>
      </div>`;
    document.getElementById('blockedBack').addEventListener('click', _backToStep1);
  }

  function _updatePinDots(pin) {
    document.querySelectorAll('#pinDots span').forEach((d,i) => { d.className = i < pin.length ? 'filled' : ''; });
  }

  // QR scan handler
  function _onQrScan(data) {
    // Expected format: "worktap:worker:<id>"
    if (data.startsWith('worktap:worker:')) {
      const id = data.replace('worktap:worker:', '');
      const w  = DB.getWorkerById(id);
      if (w) { _selectWorker(w); return; }
    }
    showToast('Unknown QR code.');
  }

  // ── WORKER DASHBOARD ──────────────────────────────────────

  function _initWorkerDash() {
    document.getElementById('btnClockIn').addEventListener('click',  () => _doClock('IN'));
    document.getElementById('btnClockOut').addEventListener('click', () => _doClock('OUT'));
    document.getElementById('btnBreakStart').addEventListener('click', () => _doClock('BREAK_START'));
    document.getElementById('btnBreakEnd').addEventListener('click',   () => _doClock('BREAK_END'));
    document.getElementById('workerLogout').addEventListener('click', _logout);

    document.getElementById('gpsBlockedClose').addEventListener('click', () =>
      document.getElementById('gpsBlockedOverlay').classList.add('hidden'));
    // Delegated photo view for myLog (hardened)
    const _myLog2 = document.getElementById('myLogList');
    if (_myLog2) _myLog2.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="photo"]');
      if (btn) Logs.viewPhoto(btn.dataset.id);
    });

    // History tab
    document.querySelectorAll('.worker-tab').forEach(t =>
      t.addEventListener('click', () => _switchWorkerTab(t.dataset.tab)));
  }

  function _loginAs(worker) {
    currentWorker = DB.getWorkerById(worker.id);
    showPage('worker');
    _refreshDash();
    _startInactivityTimer();
  }

  function _logout() {
    currentWorker = null; selectedWorker = null;
    pinEntry = ''; pinSubmitting = false;
    _stopInactivityTimer();
    document.getElementById('workerSearch').value = '';
    document.getElementById('loginStep1').classList.remove('hidden');
    document.getElementById('loginStep2').classList.add('hidden');
    _renderPickList('');
    showPage('login');
  }

  // Inactivity auto-logout
  function _startInactivityTimer() {
    _stopInactivityTimer();
    const mins = DB.getSettings().inactivityMins || 5;
    inactivityTimer = setTimeout(() => {
      if (currentWorker) {
        showToast('Auto-logged out due to inactivity.');
        _logout();
      }
    }, mins * 60 * 1000);

    // Reset on interaction
    ['click','touchstart','keydown'].forEach(ev =>
      document.addEventListener(ev, _resetInactivity, { passive: true }));
  }

  function _resetInactivity() {
    if (!currentWorker) return;
    _stopInactivityTimer();
    _startInactivityTimer();
  }

  function _stopInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    ['click','touchstart','keydown'].forEach(ev =>
      document.removeEventListener(ev, _resetInactivity));
  }

  function _refreshDash() {
    if (!currentWorker) return;
    const w = currentWorker = DB.getWorkerById(currentWorker.id);

    document.getElementById('wdhAvatar').textContent = _initials(w.name);
    document.getElementById('wdhName').textContent   = w.name;
    document.getElementById('wdhRole').textContent   = w.role;

    const icon  = document.getElementById('workerStatusIcon');
    const label = document.getElementById('workerStatusLabel');
    const since = document.getElementById('workerStatusSince');
    const card  = document.getElementById('workerStatusCard');

    if (w.onBreak) {
      icon.textContent  = '☕'; label.textContent = 'Currently ON BREAK';
      card.className    = 'status-card status-out';
      since.textContent = w.lastActionTime ? 'Since ' + new Date(w.lastActionTime).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '';
    } else if (w.clockedIn) {
      icon.textContent  = '🟢'; label.textContent = 'Currently CLOCKED IN';
      card.className    = 'status-card status-in';
      since.textContent = w.lastActionTime ? 'Since ' + new Date(w.lastActionTime).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '';
    } else {
      icon.textContent  = '🔴'; label.textContent = 'Currently CLOCKED OUT';
      card.className    = 'status-card status-out';
      since.textContent = w.lastActionTime ? 'Last out ' + new Date(w.lastActionTime).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '';
    }

    document.getElementById('btnClockIn').disabled     = w.clockedIn;
    document.getElementById('btnClockOut').disabled    = !w.clockedIn;
    document.getElementById('btnBreakStart').disabled = !w.clockedIn || w.onBreak;
    document.getElementById('btnBreakEnd').disabled   = !w.onBreak;

    _renderTodayLog();
  }

  function _switchWorkerTab(name) {
    document.querySelectorAll('.worker-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.getElementById('workerTabToday').classList.toggle('hidden',    name !== 'today');
    document.getElementById('workerTabSchedule').classList.toggle('hidden', name !== 'schedule');
    document.getElementById('workerTabHistory').classList.toggle('hidden',  name !== 'history');
    if (name === 'history') _renderHistory();
    if (name === 'schedule') Rota.renderWorkerSchedule(currentWorker.id);
  }

  function _renderTodayLog() {
    const logs  = DB.getLogsForWorkerToday(currentWorker.id);
    const list  = document.getElementById('myLogList');
    const hours = document.getElementById('myHoursToday');

    if (!logs.length) {
      list.innerHTML = '<p class="no-log">No activity yet today.</p>';
      hours.textContent = '0h 0m'; return;
    }
    list.innerHTML = '';
    logs.forEach(l => {
      const row = document.createElement('div');
      row.className = 'my-log-row';
      row.innerHTML = `
        <span class="my-log-badge ${l.action==='IN'?'badge-in':'badge-out'}">${l.action}</span>
        <span class="my-log-time">${l.time}</span>
        ${(() => { const escId = (typeof Sanitize!=='undefined'?Sanitize.attr(l.id):_esc(l.id)); return l.photo ? `<button class="photo-thumb-btn" data-action="photo" data-id="${escId}">📸</button>` : ''; })()}
      `;
      list.appendChild(row);
    });
    const totalH = DB.calcHoursToday(currentWorker.id);
    const h = Math.floor(totalH), m = Math.round((totalH-h)*60);
    hours.textContent = `${h}h ${m}m`;
  }

  function _renderHistory() {
    const { from, to } = DB.getWeekRange();
    const logs = DB.getLogsForWorkerRange(currentWorker.id, from, to);
    const list = document.getElementById('historyLogList');

    document.getElementById('historyDateRange').textContent = `${from} → ${to}`;

    if (!logs.length) { list.innerHTML = '<p class="no-log">No logs this week.</p>'; return; }

    // Group by date
    const byDate = {};
    logs.forEach(l => { (byDate[l.timestamp.slice(0,10)] = byDate[l.timestamp.slice(0,10)]||[]).push(l); });

    list.innerHTML = '';
    Object.keys(byDate).sort().reverse().forEach(date => {
      const dayLogs = byDate[date];
      const dayH    = DB.calcHours(dayLogs);
      const h = Math.floor(dayH), m = Math.round((dayH-h)*60);
      const section = document.createElement('div');
      section.className = 'history-day';
      section.innerHTML = `
        <div class="history-day-header">
          <span>${_fmtDateStr(date)}</span>
          <span class="history-day-hours">${h}h ${m}m</span>
        </div>
        ${dayLogs.map(l => `
          <div class="my-log-row">
            <span class="my-log-badge ${l.action==='IN'?'badge-in':'badge-out'}">${l.action}</span>
            <span class="my-log-time">${l.time}</span>
          </div>`).join('')}
      `;
      list.appendChild(section);
    });

    const weekH = DB.calcHours(logs);
    const wh = Math.floor(weekH), wm = Math.round((weekH-wh)*60);
    document.getElementById('historyWeekTotal').textContent = `Week total: ${wh}h ${wm}m`;
  }

  function _fmtDateStr(str) {
    return new Date(str + 'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  }

  // ── CLOCK IN / OUT ────────────────────────────────────────

  async function _doClock(action) {
    if (!currentWorker) return;
    const w = DB.getWorkerById(currentWorker.id);
    if (action === 'IN'  && w.clockedIn)  { showToast('Already clocked in!');  return; }
    if (action === 'OUT' && !w.clockedIn) { showToast('Not clocked in yet.'); return; }
    if (action === 'BREAK_START' && (!w.clockedIn || w.onBreak)) { showToast('Cannot start break.'); return; }
    if (action === 'BREAK_END'   && !w.onBreak) { showToast('Not currently on break.'); return; }

    // GPS check
    const btnMap = { IN: 'btnClockIn', OUT: 'btnClockOut', BREAK_START: 'btnBreakStart', BREAK_END: 'btnBreakEnd' };
    const clockBtn = document.getElementById(btnMap[action]);
    const origLabel = clockBtn.querySelector('.clock-btn-label').textContent;
    clockBtn.disabled = true;
    clockBtn.querySelector('.clock-btn-label').textContent = '📍 Checking...';
    const gpsResult = await GPS.checkGeofence();
    clockBtn.disabled = false;
    clockBtn.querySelector('.clock-btn-label').textContent = origLabel;

    if (!gpsResult.allowed) {
      AudioFX.playError();
      document.getElementById('gpsBlockedClose').textContent = gpsResult.reason === 'gps_error' ? 'Try Again' : 'Close';
      document.getElementById('gpsBlockedMsg').textContent = gpsResult.message;
      document.getElementById('gpsBlockedOverlay').classList.remove('hidden');
      return;
    }

    // Selfie if enabled and clocking IN
    let photoDataUrl = null;
    if (action === 'IN' && DB.getSettings().selfieEnabled && Selfie.isSupported()) {
      photoDataUrl = await Selfie.capture();
    }

    const log = DB.addLog(w.id, w.name, action, photoDataUrl);
    const workerUpdates = { lastAction: action, lastActionTime: log.timestamp };
    if (action === 'IN')  { workerUpdates.clockedIn = true;  workerUpdates.onBreak = false; AudioFX.playSuccess(); }
    if (action === 'OUT') { workerUpdates.clockedIn = false; workerUpdates.onBreak = false; AudioFX.playSuccess(); }
    if (action === 'BREAK_START') { workerUpdates.onBreak = true; AudioFX.playAlert(); }
    if (action === 'BREAK_END')   { workerUpdates.onBreak = false; AudioFX.playSuccess(); }

    DB.updateWorker(w.id, workerUpdates);

    let duration = '';
    if (action === 'OUT') {
      const totalH = DB.calcHoursToday(w.id);
      const h = Math.floor(totalH), m = Math.round((totalH-h)*60);
      duration = `Today total: ${h}h ${m}m`;

      // Check overtime alert
      const otLimit = DB.getSettings().dailyOvertimeHours || 8;
      if (totalH > otLimit) {
        Webhooks.sendAlert('Overtime Reached', `${w.name} worked ${h}h ${m}m today (threshold: ${otLimit}h)`, { type: 'overtime', Worker: w.name, Hours: `${h}h ${m}m` });
      }
    }
    const distNote = gpsResult.distance != null ? ` · 📍 ${gpsResult.distance}m` : '';
    showResultOverlay(w.name, action === 'BREAK_START' ? 'Start Break' : action === 'BREAK_END' ? 'Resume Work' : action, log.time, duration + distNote);
    _refreshDash();
    _resetInactivity();
  }

  // ── NFC ───────────────────────────────────────────────────

  async function _handleNfcTap(tagId) {
    if (nfcCooldown) return;
    nfcCooldown = true;
    setTimeout(() => { nfcCooldown = false; }, 3000);

    const worker = DB.getWorkerByNfcId(tagId);
    if (!worker) { showToast('Unknown tag. Assign in Admin.'); return; }

    const fp = await Device.getFingerprint();
    if (worker.deviceRegistered && worker.deviceFingerprint !== fp) {
      showToast(`🚫 Wrong device for ${worker.name}.`); return;
    }
    if (!worker.deviceRegistered) {
      const shortId = await Device.getShortId();
      DB.updateWorker(worker.id, { deviceFingerprint: fp, deviceShortId: shortId, deviceRegistered: true });
      showToast(`✅ Device registered for ${worker.name}`);
    }

    if (currentWorker && currentWorker.id === worker.id) {
      _doClock(DB.getWorkerById(worker.id).clockedIn ? 'OUT' : 'IN'); return;
    }
    _loginAs(worker);
    setTimeout(async () => {
      const fresh = DB.getWorkerById(worker.id);
      await _doClock(fresh.clockedIn ? 'OUT' : 'IN');
    }, 300);
  }

  // ── QR ────────────────────────────────────────────────────

  function _initQR() {
    // QR scan button on worker dash
    const qrDash = document.getElementById('btnQrDash');
    if (qrDash) qrDash.addEventListener('click', () => QR.startScanner(_onQrDashScan));
  }

  function _onQrDashScan(data) {
    if (data.startsWith('worktap:worker:')) {
      showToast('QR scan: use the login screen to switch workers.');
    } else {
      // Could be a location QR
      showToast('QR scanned: ' + data.slice(0, 40));
    }
  }

  // ── OFFLINE AUTO SYNC ─────────────────────────────────────

  async function _autoSync() {
    const settings  = DB.getSettings();
    const url       = settings.sheetsUrl;
    if (!url) return;
    const unsynced  = DB.getLogs().filter(l => !l.synced);
    if (!unsynced.length) return;
    try {
      await fetch(url, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: unsynced.map(l => ({ ...l, photo: undefined })) }),
      });
      DB.markLogsSynced(unsynced.map(l => l.id));
      showToast(`📶 Back online — ${unsynced.length} records synced!`);
    } catch { /* silent */ }
  }

  // ── RESULT OVERLAY ────────────────────────────────────────

  function showResultOverlay(name, action, time, duration) {
    document.getElementById('resultIcon').textContent     = action==='IN' ? '✅' : '👋';
    document.getElementById('resultName').textContent     = name;
    document.getElementById('resultAction').textContent   = action==='IN' ? 'Clocked IN' : 'Clocked OUT';
    document.getElementById('resultAction').className     = 'result-action '+(action==='IN'?'in-action':'out-action');
    document.getElementById('resultTime').textContent     = time;
    document.getElementById('resultDuration').textContent = duration || '';
    const ov = document.getElementById('resultOverlay');
    ov.classList.remove('hidden');
    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => ov.classList.add('hidden'), 3000);
    ov.onclick = () => { ov.classList.add('hidden'); clearTimeout(overlayTimer); };
  }

  // ── KIOSK MODE ────────────────────────────────────────────
  let kioskPinEntry = '';
  let kioskTimer = null;

  function _initKiosk() {
    document.getElementById('btnExitKiosk').addEventListener('click', () => showPage('login'));

    // Live Clock on Kiosk
    setInterval(_updateKioskClock, 1000);
    _updateKioskClock();

    // Numpad listener for Kiosk
    document.querySelectorAll('[data-kn]').forEach(btn => {
      btn.addEventListener('click', () => {
        AudioFX.playClick();
        _handleKioskNumpad(btn.dataset.kn);
      });
    });
  }

  function _updateKioskClock() {
    const clock = document.getElementById('kioskClockDisplay');
    const dateEl = document.getElementById('kioskDateDisplay');
    if (!clock) return;
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function _populateKioskSelect() {
    const sel = document.getElementById('kioskWorkerSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select Worker --</option>';
    DB.getWorkers().forEach(w => {
      sel.innerHTML += `<option value="${(typeof Sanitize!=='undefined'?Sanitize.attr(w.id):_esc(w.id))}">${(typeof Sanitize!=='undefined'?Sanitize.text(w.name):_esc(w.name))} (${(typeof Sanitize!=='undefined'?Sanitize.text(w.role):_esc(w.role))})</option>`;
    });
  }

  function _handleKioskNumpad(n) {
    if (n === 'back') {
      kioskPinEntry = kioskPinEntry.slice(0, -1);
    } else if (n === 'ok') {
      _submitKioskPin();
      return;
    } else {
      if (kioskPinEntry.length >= 6) return;
      kioskPinEntry += n;
      if (kioskPinEntry.length === 4) setTimeout(_submitKioskPin, 250);
    }
    _updateKioskPinDots(kioskPinEntry);
    _resetKioskTimeout();
  }

  function _updateKioskPinDots(pin) {
    document.querySelectorAll('#kioskPinDots span').forEach((d, i) => { d.className = i < pin.length ? 'filled' : ''; });
  }

  async function _submitKioskPin() {
    const workerId = document.getElementById('kioskWorkerSelect').value;
    const errEl = document.getElementById('kioskPinError');
    if (!workerId) {
      AudioFX.playError();
      errEl.textContent = 'Please select your name first.';
      errEl.classList.remove('hidden');
      return;
    }
    const result = await DB.authenticateWorker(workerId, kioskPinEntry);
    kioskPinEntry = '';
    _updateKioskPinDots('');

    if (result.success) {
      errEl.classList.add('hidden');
      _loginAs(result.worker);
      // Automatically toggle clock state
      const fresh = DB.getWorkerById(result.worker.id);
      await _doClock(fresh.clockedIn ? 'OUT' : 'IN');
    } else {
      AudioFX.playError();
      errEl.textContent = '❌ Invalid PIN.';
      errEl.classList.remove('hidden');
    }
  }

  function _resetKioskTimeout() {
    if (kioskTimer) clearTimeout(kioskTimer);
    kioskTimer = setTimeout(() => {
      kioskPinEntry = '';
      _updateKioskPinDots('');
      const errEl = document.getElementById('kioskPinError');
      if (errEl) errEl.classList.add('hidden');
    }, 15000);
  }

  // ── LEAVE MODAL ───────────────────────────────────────────

  function _initLeaveModal() {
    const modal = document.getElementById('leaveModal');
    const openBtn = document.getElementById('btnOpenLeaveModal');
    const cancelBtn = document.getElementById('btnCancelLeave');
    const submitBtn = document.getElementById('btnSubmitLeave');

    if (openBtn) openBtn.addEventListener('click', () => {
      if (!currentWorker) return;
      document.getElementById('leaveStartDate').value = DB.localDateStr();
      document.getElementById('leaveEndDate').value   = DB.localDateStr();
      document.getElementById('leaveReasonInput').value = '';
      modal.classList.remove('hidden');
    });

    if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

    if (submitBtn) submitBtn.addEventListener('click', () => {
      if (!currentWorker) return;
      const type = document.getElementById('leaveTypeSelect').value;
      const start = document.getElementById('leaveStartDate').value;
      const end = document.getElementById('leaveEndDate').value;
      const _rawReason = document.getElementById('leaveReasonInput').value;
      const reason = (typeof Sanitize!=='undefined'?Sanitize.strip(_rawReason,200):_rawReason.trim().slice(0,200));

      if (!start || !end) { showToast('Please select start and end dates.'); return; }
      DB.requestLeave(currentWorker.id, currentWorker.name, type, start, end, reason);
      modal.classList.add('hidden');
      AudioFX.playSuccess();
      showToast('Time-Off Request submitted for approval!');
    });
  }

  // ── PAGE ROUTING ──────────────────────────────────────────

  function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + name);
    if (page) page.classList.add('active');
    if (name === 'kiosk') {
      _populateKioskSelect();
      kioskPinEntry = '';
      _updateKioskPinDots('');
      document.getElementById('kioskPinError').classList.add('hidden');
    }
    if (name === 'admin') {
      document.getElementById('adminPinGate').classList.remove('hidden');
      document.getElementById('adminContent').classList.add('hidden');
      document.getElementById('adminPinInput').value = '';
      document.getElementById('pinError').textContent = '';
      document.getElementById('btnExportCSV').classList.add('hidden');
    }
  }

  // ── TOAST ─────────────────────────────────────────────────

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  function _initials(name) { return name.split(' ').map(p=>p[0]).join('').toUpperCase().slice(0,2); }
  function _esc(str) { const d=document.createElement('div'); d.textContent=str||''; return d.innerHTML; }

  return { init, showPage, showToast };

})();

document.addEventListener('DOMContentLoaded', App.init);
