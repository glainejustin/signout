/**
 * workers.js — Worker management (admin only)
 * Includes: add/edit/delete, device reset, shift schedule, leave toggle, QR print
 */

const Workers = (() => {

  let editingId = null;

  let _delegated = false;
  function init() {
    document.getElementById('openAddWorker').addEventListener('click', openAddModal);
    document.getElementById('modalCancel').addEventListener('click',  closeModal);
    document.getElementById('modalSave').addEventListener('click',    saveWorker);
    document.getElementById('scanNfcBtn').addEventListener('click',   scanTagForWorker);
    // Delegated worker-card actions (prevents inline onclick XSS)
    const _list = document.getElementById('workerList');
    if (_list && !_delegated) {
      _delegated = true;
      _list.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn || !_list.contains(btn)) return;
        const id = btn.dataset.id;
        const act = btn.dataset.action;
        if (act === 'edit') openEditModal(id);
        else if (act === 'pdf') PDFReport.printWorkerTimesheet(id, DB.getWeekRange().from, DB.getWeekRange().to);
        else if (act === 'leave') toggleLeave(id);
        else if (act === 'reset-device') confirmResetDevice(id);
        else if (act === 'qr') showQR(id);
        else if (act === 'delete') confirmDelete(id);
      });
    }
  }

  function render() {
    const workers = DB.getWorkers();

    // Admin log filter
    const fs = document.getElementById('filterWorker');
    if (fs) {
      fs.innerHTML = '<option value="">All Workers</option>';
      workers.forEach(w => {
        const o = document.createElement('option');
        o.value = w.id; o.textContent = w.name; fs.appendChild(o);
      });
    }

    const list = document.getElementById('workerList');
    if (!list) return;

    if (workers.length === 0) {
      list.innerHTML = '<p class="empty-msg">No workers yet.</p>';
      return;
    }

    list.innerHTML = '';
    workers.forEach(w => {
      const card = document.createElement('div');
      card.className = 'worker-card' + (w.clockedIn ? ' clocked-in' : '') + (w.onLeave ? ' on-leave' : '');

      const deviceBadge = w.deviceRegistered
        ? `<span class="device-badge device-ok">🔒 ${_esc(w.deviceShortId)}</span>`
        : `<span class="device-badge device-none">📵 No device</span>`;

      const shiftBadge = w.shiftStart
        ? `<span class="shift-badge">⏰ ${_fmt12(w.shiftStart)}–${_fmt12(w.shiftEnd)}</span>` : '';

      const leaveBadge = w.onLeave
        ? `<span class="leave-badge">🏖 On Leave${w.leaveNote ? ': '+_esc(w.leaveNote) : ''}</span>` : '';

      const weekH = DB.calcHoursWeek(w.id);
      const wh = Math.floor(weekH), wm = Math.round((weekH-wh)*60);

      card.innerHTML = `
        <div class="worker-avatar">${_initials(w.name)}</div>
        <div class="worker-info">
          <div class="worker-name">${_esc(w.name)}</div>
          <div class="worker-role">${_esc(w.role)} · @${_esc(w.username)}</div>
          <div class="worker-badges">
            ${deviceBadge}${shiftBadge}${leaveBadge}
          </div>
          <div class="worker-week-hours">This week: <strong>${wh}h ${wm}m</strong></div>
        </div>
        <span class="worker-status ${w.clockedIn ? 'in' : ''}">${w.clockedIn ? '● IN' : '○ OUT'}</span>
        <div class="worker-actions">
          <button class="icon-btn" data-action="edit" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(w.id):_esc(w.id))}" title="Edit">✏️</button>
          <button class="icon-btn" data-action="pdf" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(w.id):_esc(w.id))}" title="Print Timesheet PDF">📄</button>
          <button class="icon-btn" data-action="leave" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(w.id):_esc(w.id))}" title="Toggle Leave">${w.onLeave ? '✈️' : '🏖'}</button>
          ${w.deviceRegistered ? `<button class="icon-btn" data-action="reset-device" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(w.id):_esc(w.id))}" title="Reset Device">📱</button>` : ''}
          <button class="icon-btn" data-action="qr" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(w.id):_esc(w.id))}" title="Print QR">📷</button>
          <button class="icon-btn delete" data-action="delete" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(w.id):_esc(w.id))}" title="Delete">🗑️</button>
        </div>
      `;
      list.appendChild(card);
    });
  }

  function openAddModal() {
    editingId = null;
    _fillModal(null);
    document.getElementById('workerModal').classList.remove('hidden');
  }

  function openEditModal(id) {
    editingId = id;
    _fillModal(DB.getWorkerById(id));
    document.getElementById('workerModal').classList.remove('hidden');
  }

  function _fillModal(w) {
    document.getElementById('modalTitle').textContent   = w ? 'Edit Worker' : 'Add Worker';
    document.getElementById('workerName').value         = w ? w.name     : '';
    document.getElementById('workerRole').value         = w ? w.role     : '';
    document.getElementById('workerUsername').value     = w ? w.username : '';
    document.getElementById('workerPin').value          = w ? w.pin      : '';
    document.getElementById('workerNfcId').value        = w ? (w.nfcId||'') : '';
    document.getElementById('workerShiftStart').value   = w ? (w.shiftStart||'') : '';
    document.getElementById('workerShiftEnd').value     = w ? (w.shiftEnd||'')   : '';
    document.getElementById('editWorkerId').value       = w ? w.id : '';

    // Allowed days checkboxes
    const days = w ? (w.allowedDays || [1,2,3,4,5]) : [1,2,3,4,5];
    document.querySelectorAll('.day-check').forEach(cb => {
      cb.checked = days.includes(parseInt(cb.value));
    });
  }

  function closeModal() {
    document.getElementById('workerModal').classList.add('hidden');
    editingId = null;
  }

  function saveWorker() {
    const name     = document.getElementById('workerName').value.trim();
    const role     = document.getElementById('workerRole').value.trim();
    const username = document.getElementById('workerUsername').value.trim();
    const pin      = document.getElementById('workerPin').value.trim();
    const nfcId    = document.getElementById('workerNfcId').value.trim();
    const shiftS   = document.getElementById('workerShiftStart').value;
    const shiftE   = document.getElementById('workerShiftEnd').value;
    const days     = Array.from(document.querySelectorAll('.day-check:checked')).map(cb => parseInt(cb.value));

    if (!name)                  { App.showToast('Name is required.');              return; }
    if (!username)              { App.showToast('Username is required.');           return; }
    if (!pin || pin.length < 4) { App.showToast('PIN must be at least 4 digits.'); return; }
    if (!/^\d+$/.test(pin))     { App.showToast('PIN must be numbers only.');      return; }

    const existing = DB.getWorkerByUsername(username);
    if (existing && existing.id !== editingId) { App.showToast('Username taken.'); return; }

    const updates = { name, role, username: username.toLowerCase(), pin, nfcId,
                      shiftStart: shiftS, shiftEnd: shiftE, allowedDays: days };

    if (editingId) {
      DB.updateWorker(editingId, updates);
      App.showToast(`${name} updated.`);
    } else {
      DB.addWorker(name, role, username, pin, nfcId);
      const w = DB.getWorkerByUsername(username);
      if (w) DB.updateWorker(w.id, { shiftStart: shiftS, shiftEnd: shiftE, allowedDays: days });
      App.showToast(`${name} added.`);
    }
    closeModal();
    render();
    Admin.refreshStats();
  }

  async function scanTagForWorker() {
    if (!NFC.isSupported()) { App.showToast('NFC not supported on this device.'); return; }
    const btn = document.getElementById('scanNfcBtn');
    btn.textContent = '📡 Hold tag near phone...';
    btn.disabled    = true;
    const ok = await NFC.scanOneTag((tagId) => {
      document.getElementById('workerNfcId').value = tagId;
      btn.textContent = '✅ Tag scanned!';
      btn.disabled    = false;
      App.showToast('NFC tag captured!');
    });
    if (!ok) { btn.textContent = '📡 Scan NFC Tag'; btn.disabled = false; App.showToast('NFC scan failed.'); }
  }

  function toggleLeave(id) {
    const w = DB.getWorkerById(id);
    if (!w) return;
    const going = !w.onLeave;
    const note  = going ? (prompt(`Leave note for ${w.name} (optional):`) || '') : '';
    DB.setLeave(id, going, note);
    render();
    App.showToast(`${w.name} marked ${going ? 'On Leave' : 'Active'}.`);
  }

  function confirmResetDevice(id) {
    const w = DB.getWorkerById(id);
    if (!w) return;
    if (confirm(`Reset device for "${w.name}"?\nNext login will register new device.`)) {
      DB.resetWorkerDevice(id);
      render();
      App.showToast(`${w.name}'s device reset.`);
    }
  }

  function showQR(id) {
    const w = DB.getWorkerById(id);
    if (!w) return;
    const modal  = document.getElementById('qrPrintModal');
    const img    = document.getElementById('qrPrintImg');
    const label  = document.getElementById('qrPrintLabel');
    img.src      = QR.getQRDataUrl('worktap:worker:' + w.id, 200);
    label.textContent = w.name + ' · ' + w.role;
    document.getElementById('qrPrintName').textContent = w.name;
    modal.classList.remove('hidden');
  }

  function confirmDelete(id) {
    const w = DB.getWorkerById(id);
    if (!w) return;
    if (confirm(`Delete "${w.name}"? Logs kept.`)) {
      DB.deleteWorker(id);
      render();
      Admin.refreshStats();
      App.showToast(`${w.name} removed.`);
    }
  }

  function _initials(name) { return name.split(' ').map(p=>p[0]).join('').toUpperCase().slice(0,2); }
  function _esc(str) { const d=document.createElement('div'); d.textContent=str||''; return d.innerHTML; }
  function _fmt12(hhmm) {
    if (!hhmm) return '';
    const [h,m] = hhmm.split(':').map(Number);
    return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
  }

  return { init, render, openEditModal, toggleLeave, confirmResetDevice, showQR, confirmDelete };

})();
