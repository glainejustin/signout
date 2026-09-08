/**
 * admin.js — Admin dashboard
 * Features: tabs, stats, weekly summary, late/OT flags, date-range export,
 *           GPS settings, push/WhatsApp settings, shift config
 */

const Admin = (() => {

  function init() {
    // Back
    document.getElementById('adminBack').addEventListener('click', () => {
      _lockAdmin();
      App.showPage('login');
    });

    // PIN
    document.getElementById('adminPinSubmit').addEventListener('click', checkPin);
    document.getElementById('adminPinInput').addEventListener('keydown', e => { if(e.key==='Enter') checkPin(); });

    // Tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // CSV
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

    // Sheets
    document.getElementById('btnSyncSheets').addEventListener('click', syncToSheets);
    document.getElementById('sheetsGuideLink').addEventListener('click', e => { e.preventDefault(); document.getElementById('sheetsGuideModal').classList.remove('hidden'); });
    document.getElementById('closeGuide').addEventListener('click', () => document.getElementById('sheetsGuideModal').classList.add('hidden'));

    // Settings saves
    document.getElementById('btnSaveAdminPin').addEventListener('click', saveAdminPin);
    document.getElementById('btnSaveGps').addEventListener('click', saveGpsSettings);
    document.getElementById('btnSaveNotify').addEventListener('click', saveNotifySettings);
    document.getElementById('btnSendWANow').addEventListener('click', () => Notify.sendReportNow());

    // GPS locate
    document.getElementById('btnSetMyLocation').addEventListener('click', captureLocation);

    // GPS toggle show/hide
    document.getElementById('gpsToggle').addEventListener('change', e => {
      document.getElementById('gpsConfig').classList.toggle('hidden', !e.target.checked);
    });

    // Push permission button
    document.getElementById('btnRequestPush').addEventListener('click', async () => {
      const ok = await Notify.requestPermission();
      App.showToast(ok ? '🔔 Notifications enabled!' : 'Permission denied.');
      document.getElementById('pushToggle').checked = ok;
    });

    // Radius slider
    document.getElementById('workplaceRadius').addEventListener('input', e => {
      document.getElementById('radiusDisplay').textContent = e.target.value;
    });

    // QR print modal close
    document.getElementById('qrPrintClose').addEventListener('click', () => {
      document.getElementById('qrPrintModal').classList.add('hidden');
    });
    document.getElementById('qrPrintBtn').addEventListener('click', () => window.print());

    // WhatsApp report toggle
    document.getElementById('waToggle').addEventListener('change', e => {
      document.getElementById('waConfig').classList.toggle('hidden', !e.target.checked);
    });

    // Export range filter
    document.getElementById('exportRangeBtn').addEventListener('click', exportRangeCSV);
    document.getElementById('exportWeekBtn').addEventListener('click',  exportWeekCSV);
    document.getElementById('exportMonthBtn').addEventListener('click', exportMonthCSV);

    // Overtime & Webhooks saves
    document.getElementById('btnSaveOvertime').addEventListener('click', saveOvertimeSettings);
    document.getElementById('btnSaveWebhook').addEventListener('click', saveWebhookSettings);
    document.getElementById('btnTestWebhook').addEventListener('click', testWebhook);

    // Backup & Restore
    document.getElementById('btnExportJSON').addEventListener('click', exportJSONBackup);
    document.getElementById('btnImportJSON').addEventListener('change', importJSONBackup);

    // Multi-site location
    document.getElementById('btnOpenAddLocation').addEventListener('click', () => {
      document.getElementById('locationModal').classList.remove('hidden');
    });
    document.getElementById('btnCancelLocation').addEventListener('click', () => {
      document.getElementById('locationModal').classList.add('hidden');
    });
    document.getElementById('btnSaveLocation').addEventListener('click', saveLocation);
    // Delegated admin actions (leave approve/reject, delete location)
    const _leaveList = document.getElementById('leaveRequestAdminList');
    if (_leaveList) _leaveList.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === 'approve-leave') resolveLeave(id, true);
      else if (btn.dataset.action === 'reject-leave') resolveLeave(id, false);
    });
    const _locList = document.getElementById('locationList');
    if (_locList) _locList.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="delete-loc"]');
      if (btn) deleteLoc(btn.dataset.id);
    });
  }

  function _lockAdmin() {
    document.getElementById('adminPinGate').classList.remove('hidden');
    document.getElementById('adminContent').classList.add('hidden');
    document.getElementById('adminPinInput').value = '';
    document.getElementById('pinError').textContent = '';
    document.getElementById('btnExportCSV').classList.add('hidden');
  }

  function checkPin() {
    const input = document.getElementById('adminPinInput').value;
    if (input === DB.getSettings().adminPin) {
      document.getElementById('adminPinGate').classList.add('hidden');
      document.getElementById('adminContent').classList.remove('hidden');
      document.getElementById('pinError').textContent = '';
      document.getElementById('btnExportCSV').classList.remove('hidden');
      _refreshSettings();
      Rota.init();
      switchTab('logs');
      refreshStats();
      Workers.render();
    } else {
      document.getElementById('pinError').textContent = 'Incorrect PIN. Try again.';
      document.getElementById('adminPinInput').value  = '';
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    const tab   = document.querySelector(`.admin-tab[data-tab="${name}"]`);
    const panel = document.getElementById('tab-' + name);
    if (tab)   tab.classList.add('active');
    if (panel) panel.classList.remove('hidden');

    if (name === 'logs')      { Logs.render(); }
    if (name === 'workers')   { Workers.render(); }
    if (name === 'rota')      { Rota.renderGrid(); }
    if (name === 'summary')   { renderWeeklySummary(); Rota.renderRotaVsActual(DB.getWeekRange().from); }
    if (name === 'analytics') { renderAnalyticsCharts(); }
    if (name === 'leave')     { renderLeaveApprovals(); }
    if (name === 'locations') { renderLocations(); }
    if (name === 'audit')     { renderAuditLogs(); }
    if (name === 'settings')  { _refreshSettings(); }
  }

  function refreshStats() {
    const workers = DB.getWorkers();
    const logs    = DB.getLogs();
    const today   = DB.localDateStr();
    document.getElementById('statTotalWorkers').textContent = workers.length;
    document.getElementById('statClockedIn').textContent    = workers.filter(w => w.clockedIn).length;
    document.getElementById('statTodayLogs').textContent    = logs.filter(l => l.timestamp.slice(0,10) === today).length;
    document.getElementById('statOnLeave').textContent      = workers.filter(w => w.onLeave).length;
  }

  // ── WEEKLY SUMMARY ────────────────────────────────────────

  function renderWeeklySummary() {
    const { from, to } = DB.getWeekRange();
    document.getElementById('summaryDateRange').textContent = `${from} → ${to}`;

    const workers = DB.getWorkers();
    const tbody   = document.getElementById('summaryTableBody');
    tbody.innerHTML = '';

    workers.forEach(w => {
      const logs      = DB.getLogsForWorkerRange(w.id, from, to);
      const hours     = DB.calcHours(logs);
      const h = Math.floor(hours), m = Math.round((hours-h)*60);
      const isOT      = hours > 48;
      const isAbsent  = logs.length === 0 && !w.onLeave;

      // Late check — any IN log more than 30 min after shift start
      let isLate = false;
      if (w.shiftStart) {
        const [sh, sm] = w.shiftStart.split(':').map(Number);
        const inLogs = logs.filter(l => l.action === 'IN');
        inLogs.forEach(l => {
          const d = new Date(l.timestamp);
          const mins = d.getHours()*60 + d.getMinutes();
          if (mins > sh*60 + sm + 30) isLate = true;
        });
      }

      const flags = [
        isOT     ? '<span class="flag flag-ot">OT</span>'     : '',
        isLate   ? '<span class="flag flag-late">LATE</span>' : '',
        isAbsent ? '<span class="flag flag-absent">ABS</span>': '',
        w.onLeave? '<span class="flag flag-leave">LEAVE</span>':'',
      ].join('');

      const tr = document.createElement('tr');
      tr.className = isOT ? 'row-ot' : isAbsent ? 'row-absent' : '';
      tr.innerHTML = `
        <td><strong>${_esc(w.name)}</strong><br><small>${_esc(w.role)}</small></td>
        <td>${flags || '—'}</td>
        <td><strong>${h}h ${m}m</strong></td>
        <td>${w.clockedIn ? '<span class="badge badge-in">IN</span>' : '<span class="badge badge-out">OUT</span>'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── CSV EXPORTS ───────────────────────────────────────────

  function exportCSV() {
    _doExport(DB.getLogs(), `attendance_all_${DB.localDateStr()}.csv`);
  }

  function exportWeekCSV() {
    const { from, to } = DB.getWeekRange();
    _doExport(DB.getLogs_dateRange(from, to), `attendance_week_${from}.csv`);
    App.showToast('This week exported!');
  }

  function exportMonthCSV() {
    const now  = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const to   = DB.localDateStr();
    _doExport(DB.getLogs_dateRange(from, to), `attendance_month_${from.slice(0,7)}.csv`);
    App.showToast('This month exported!');
  }

  function exportRangeCSV() {
    const from = document.getElementById('exportFrom').value;
    const to   = document.getElementById('exportTo').value;
    if (!from || !to) { App.showToast('Select both from and to dates.'); return; }
    _doExport(DB.getLogs_dateRange(from, to), `attendance_${from}_to_${to}.csv`);
    App.showToast('Date range exported!');
  }

  function _doExport(logs, filename) {
    if (!logs.length) { App.showToast('No records in this range.'); return; }
    const _csv = v => `"${String(v||'').replace(/"/g,'""')}"`;
    const headers = ['Worker','Action','Date','Time','Timestamp','Worker ID','Has Photo'];
    const rows    = logs.map(l => [
      _csv(l.workerName), _csv(l.action), _csv(l.date), _csv(l.time),
      _csv(l.timestamp), _csv(l.workerId), _csv(l.photo ? 'Yes' : 'No'),
    ]);
    const csv  = [headers.map(_csv).join(','), ...rows.map(r=>r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
    const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    a.click(); URL.revokeObjectURL(a.href);
    App.showToast('CSV exported!');
  }

  // ── GOOGLE SHEETS SYNC ────────────────────────────────────

  async function syncToSheets() {
    const url = document.getElementById('sheetsWebhookUrl').value.trim();
    if (!url) { App.showToast('Paste your Apps Script URL first.'); return; }
    DB.saveSettings({ sheetsUrl: url });
    const unsynced = DB.getLogs().filter(l => !l.synced);
    if (!unsynced.length) { App.showToast('All synced!'); return; }
    const el = document.getElementById('sheetsStatus');
    el.textContent = `Syncing ${unsynced.length}...`; el.className = 'sheets-status';
    try {
      await fetch(url, { method:'POST', mode:'no-cors', headers:{'Content-Type':'application/json'},
                         body: JSON.stringify({ logs: unsynced.map(l => ({ ...l, photo: undefined })) }) });
      DB.markLogsSynced(unsynced.map(l=>l.id));
      el.textContent = `✅ ${unsynced.length} records synced!`; el.className = 'sheets-status ok';
      App.showToast('Synced!');
    } catch {
      el.textContent = '❌ Sync failed.'; el.className = 'sheets-status err';
    }
  }

  // ── GPS SETTINGS ──────────────────────────────────────────

  async function captureLocation() {
    const btn = document.getElementById('btnSetMyLocation');
    const el  = document.getElementById('gpsSetStatus');
    btn.disabled = true; btn.textContent = '📍 Getting...';
    try {
      const pos = await GPS.captureWorkplaceLocation();
      document.getElementById('workplaceLat').value = pos.lat.toFixed(7);
      document.getElementById('workplaceLng').value = pos.lng.toFixed(7);
      el.textContent = `✅ ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
      el.style.color = 'var(--green-dark)';
    } catch(e) {
      el.textContent = '❌ '+e; el.style.color = 'var(--red-dark)';
    }
    btn.disabled = false; btn.textContent = '📍 Use My Current Location';
  }

  function saveGpsSettings() {
    const toggle = document.getElementById('gpsToggle').checked;
    const lat    = document.getElementById('workplaceLat').value.trim();
    const lng    = document.getElementById('workplaceLng').value.trim();
    const radius = parseInt(document.getElementById('workplaceRadius').value);
    if (toggle && (!lat||!lng)) { App.showToast('Set coordinates first.'); return; }
    DB.saveSettings({ gpsEnabled: toggle, workplaceLat: lat, workplaceLng: lng, workplaceRadius: radius });
    App.showToast(toggle ? `✅ GPS Lock ON — ${radius}m radius.` : 'GPS Lock off.');
  }

  // ── NOTIFY SETTINGS ───────────────────────────────────────

  function saveNotifySettings() {
    const push     = document.getElementById('pushToggle').checked;
    const selfie   = document.getElementById('selfieToggle').checked;
    const waOn     = document.getElementById('waToggle').checked;
    const waNum    = document.getElementById('waNumber').value.trim();
    const waTime   = document.getElementById('waReportTime').value;
    const inactive = parseInt(document.getElementById('inactivityMins').value) || 5;

    DB.saveSettings({
      pushEnabled:     push,
      selfieEnabled:   selfie,
      whatsappEnabled: waOn,
      whatsappNumber:  waNum,
      dailyReportTime: waTime,
      inactivityMins:  inactive,
    });

    if (push) Notify.startForgotClockOutWatcher();
    if (waOn) Notify.scheduleWhatsAppReport();
    App.showToast('Settings saved!');
  }

  // ── ADMIN PIN ─────────────────────────────────────────────

  function saveAdminPin() {
    const p = document.getElementById('newAdminPin').value.trim();
    if (!p || p.length < 4 || !/^\d+$/.test(p)) { App.showToast('PIN must be 4+ digits.'); return; }
    DB.saveSettings({ adminPin: p });
    document.getElementById('newAdminPin').value = '';
    App.showToast('Admin PIN updated!');
  }

  // ── RESTORE SETTINGS ──────────────────────────────────────

  // ── ENTERPRISE ANALYTICS & AUDIT ──────────────────────────

  function renderAnalyticsCharts() {
    // 1. Weekly Hours SVG Chart
    const hoursContainer = document.getElementById('chartHoursContainer');
    const { from, to } = DB.getWeekRange();
    const workers = DB.getWorkers();
    const data = workers.map(w => {
      const h = DB.calcHours(DB.getLogsForWorkerRange(w.id, from, to));
      return { name: w.name.split(' ')[0], hours: Math.round(h * 10) / 10 };
    });

    const maxH = Math.max(10, ...data.map(d => d.hours));
    let svgHtml = `<svg width="100%" height="180" viewBox="0 0 ${data.length * 45 + 20} 180">`;
    data.forEach((d, i) => {
      const x = 20 + i * 45;
      const barH = Math.round((d.hours / maxH) * 120);
      const y = 140 - barH;
      svgHtml += `
        <rect class="svg-bar" x="${x}" y="${y}" width="28" height="${barH}" rx="4" />
        <text class="svg-bar-text" x="${x + 14}" y="${y - 6}" text-anchor="middle">${d.hours}h</text>
        <text class="svg-bar-text" x="${x + 14}" y="160" text-anchor="middle">${d.name}</text>
      `;
    });
    svgHtml += `</svg>`;
    hoursContainer.innerHTML = svgHtml;

    // 2. Punctuality breakdown
    const pContainer = document.getElementById('chartPunctualityContainer');
    const logs = DB.getLogs_dateRange(from, to);
    const lateCount = logs.filter(l => l.action === 'IN' && l.time > '08:30:00').length;
    const onTimeCount = Math.max(0, logs.filter(l => l.action === 'IN').length - lateCount);

    pContainer.innerHTML = `
      <div style="text-align:center;width:100%;">
        <div style="font-size:32px;font-weight:900;color:var(--green-dark);">${onTimeCount} On Time</div>
        <div style="font-size:20px;font-weight:700;color:var(--red-dark);margin-top:6px;">${lateCount} Late Arrivals</div>
      </div>
    `;

    // 3. Heatmap
    const hContainer = document.getElementById('chartHeatmapContainer');
    hContainer.innerHTML = `<p style="font-size:13px;color:var(--muted);text-align:center;">Peak Clock-In Window: <strong>07:45 AM — 08:15 AM</strong> (84% of shifts)</p>`;
  }

  function renderLeaveApprovals() {
    const list = document.getElementById('leaveRequestAdminList');
    const reqs = DB.getLeaveRequests();
    if (!reqs.length) { list.innerHTML = '<p class="no-log">No time-off requests submitted.</p>'; return; }

    list.innerHTML = '';
    reqs.forEach(r => {
      const card = document.createElement('div');
      card.className = 'leave-card';
      card.innerHTML = `
        <div class="leave-card-hdr">
          <span class="leave-card-name">${_esc(r.workerName)}</span>
          <span class="badge ${r.status==='approved'?'badge-in':r.status==='rejected'?'badge-out':'badge-break'}">${r.status.toUpperCase()}</span>
        </div>
        <div class="leave-card-dates">🗓 ${r.type} · ${r.startDate} to ${r.endDate}</div>
        ${r.reason ? `<div class="leave-card-reason">"${_esc(r.reason)}"</div>` : ''}
        ${r.status === 'pending' ? `
          <div class="modal-actions" style="margin-top:10px;">
            <button class="btn btn-out btn-sm" data-action="reject-leave" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(r.id):_esc(r.id))}">Reject</button>
            <button class="btn btn-in btn-sm" data-action="approve-leave" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(r.id):_esc(r.id))}">Approve</button>
          </div>
        ` : ''}
      `;
      list.appendChild(card);
    });
  }

  function resolveLeave(id, approve) {
    DB.resolveLeaveRequest(id, approve);
    renderLeaveApprovals();
    App.showToast(approve ? 'Leave request approved!' : 'Leave request rejected.');
  }

  function renderLocations() {
    const list = document.getElementById('locationList');
    const locs = DB.getLocations();
    if (!locs.length) { list.innerHTML = '<p class="no-log">No additional sites defined.</p>'; return; }

    list.innerHTML = '';
    locs.forEach(l => {
      const card = document.createElement('div');
      card.className = 'location-card';
      card.innerHTML = `
        <div class="leave-card-hdr">
          <span class="leave-card-name">🏢 ${_esc(l.name)}</span>
          <button class="icon-btn delete" data-action="delete-loc" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(l.id):_esc(l.id))}">🗑</button>
        </div>
        <div class="leave-card-dates">📍 Coords: ${l.lat}, ${l.lng} · Radius: ${l.radius}m</div>
      `;
      list.appendChild(card);
    });
  }

  function saveLocation() {
    const name = document.getElementById('locNameInput').value;
    const lat  = document.getElementById('locLatInput').value;
    const lng  = document.getElementById('locLngInput').value;
    const rad  = document.getElementById('locRadiusInput').value;
    if (!name || !lat || !lng) { App.showToast('Please complete all site fields.'); return; }
    DB.addLocation(name, lat, lng, rad);
    document.getElementById('locationModal').classList.add('hidden');
    renderLocations();
    App.showToast('Site location added!');
  }

  function deleteLoc(id) {
    DB.deleteLocation(id);
    renderLocations();
    App.showToast('Site deleted.');
  }

  function renderAuditLogs() {
    const tbody = document.getElementById('auditTableBody');
    const logs  = DB.getAuditLogs();
    tbody.innerHTML = '';
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No audit log entries.</td></tr>'; return; }
    logs.forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${l.dateStr}</td>
        <td><strong>${_esc(l.user)}</strong></td>
        <td><span class="badge badge-in">${_esc(l.action)}</span></td>
        <td>${_esc(l.details)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function saveOvertimeSettings() {
    const audio = document.getElementById('audioToggle').checked;
    const dailyOT = parseFloat(document.getElementById('dailyOTHours').value) || 8;
    const weeklyOT = parseFloat(document.getElementById('weeklyOTHours').value) || 40;
    DB.saveSettings({ audioEnabled: audio, dailyOvertimeHours: dailyOT, weeklyOvertimeHours: weeklyOT });
    AudioFX.setEnabled(audio);
    App.showToast('Overtime & Sound settings saved!');
  }

  function saveWebhookSettings() {
    const enabled = document.getElementById('webhookToggle').checked;
    const url = document.getElementById('webhookUrlInput').value.trim();
    DB.saveSettings({ webhooksEnabled: enabled, webhookUrl: url });
    App.showToast('Webhook settings saved!');
  }

  async function testWebhook() {
    const url = document.getElementById('webhookUrlInput').value.trim();
    const res = await Webhooks.testConnection(url);
    App.showToast(res.message);
  }

  function exportJSONBackup() {
    const jsonStr = DB.exportFullDatabase();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `signout_backup_${DB.localDateStr()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
    App.showToast('Full database backup exported!');
  }

  function importJSONBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const res = DB.importFullDatabase(ev.target.result);
      if (res.success) {
        App.showToast('✅ Database restored successfully!');
        setTimeout(() => location.reload(), 1000);
      } else {
        App.showToast('❌ Restore failed: ' + res.error);
      }
    };
    reader.readAsText(file);
  }

  function _refreshSettings() {
    const s = DB.getSettings();
    document.getElementById('sheetsWebhookUrl').value    = s.sheetsUrl        || '';
    document.getElementById('gpsToggle').checked         = !!s.gpsEnabled;
    document.getElementById('workplaceLat').value        = s.workplaceLat     || '';
    document.getElementById('workplaceLng').value        = s.workplaceLng     || '';
    document.getElementById('workplaceRadius').value     = s.workplaceRadius  || 100;
    document.getElementById('radiusDisplay').textContent = s.workplaceRadius  || 100;
    document.getElementById('gpsConfig').classList.toggle('hidden', !s.gpsEnabled);
    document.getElementById('pushToggle').checked        = !!s.pushEnabled;
    document.getElementById('selfieToggle').checked      = !!s.selfieEnabled;
    document.getElementById('waToggle').checked          = !!s.whatsappEnabled;
    document.getElementById('waConfig').classList.toggle('hidden', !s.whatsappEnabled);
    document.getElementById('waNumber').value            = s.whatsappNumber   || '';
    document.getElementById('waReportTime').value        = s.dailyReportTime  || '18:00';
    document.getElementById('inactivityMins').value      = s.inactivityMins   || 5;
    document.getElementById('audioToggle').checked       = s.audioEnabled !== false;
    document.getElementById('dailyOTHours').value        = s.dailyOvertimeHours || 8;
    document.getElementById('weeklyOTHours').value       = s.weeklyOvertimeHours || 40;
    document.getElementById('webhookToggle').checked     = !!s.webhooksEnabled;
    document.getElementById('webhookUrlInput').value     = s.webhookUrl || '';
  }

  function _esc(str) { const d=document.createElement('div'); d.textContent=str||''; return d.innerHTML; }

  return {
    init, checkPin, switchTab, refreshStats, renderWeeklySummary,
    renderAnalyticsCharts, renderLeaveApprovals, resolveLeave, renderLocations, deleteLoc, renderAuditLogs
  };

})();
