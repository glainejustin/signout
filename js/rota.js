/**
 * rota.js — Full rota management module
 * - Weekly grid (fully editable cells)
 * - Shift templates (editable name/time/color)
 * - Off day toggling
 * - Worker add/remove from rota
 * - Template save/load/copy
 * - Swap requests
 * - Export to CSV
 * - Worker schedule view
 */

const Rota = (() => {

  const DAY_NAMES  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DAY_FULL   = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

  let currentWeek  = null;  // 'YYYY-MM-DD' Monday of displayed week
  let editingShift = null;  // shift being edited in the shift modal

  // ─────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────

  function init() {
    currentWeek = DB.getMondayOf(DB.localDateStr());

    // Week navigation
    document.getElementById('rotaPrevWeek').addEventListener('click', () => {
      currentWeek = _addDays(currentWeek, -7);
      renderGrid();
    });
    document.getElementById('rotaNextWeek').addEventListener('click', () => {
      currentWeek = _addDays(currentWeek, 7);
      renderGrid();
    });
    document.getElementById('rotaThisWeek').addEventListener('click', () => {
      currentWeek = DB.getMondayOf(DB.localDateStr());
      renderGrid();
    });

    // Template controls
    document.getElementById('rotaSaveTpl').addEventListener('click', saveTemplate);
    document.getElementById('rotaLoadTpl').addEventListener('click', loadTemplate);
    document.getElementById('rotaCopyWeek').addEventListener('click', copyToNextWeek);
    document.getElementById('rotaExport').addEventListener('click', exportCSV);

    // Shift template editor
    document.getElementById('addShiftBtn').addEventListener('click', () => openShiftModal(null));
    document.getElementById('shiftModalSave').addEventListener('click', saveShiftModal);
    document.getElementById('shiftModalCancel').addEventListener('click', () => {
      document.getElementById('shiftEditModal').classList.add('hidden');
    });
    document.getElementById('shiftModalDelete').addEventListener('click', deleteShiftFromModal);

    // Cell editor modal
    document.getElementById('cellModalClose').addEventListener('click', () => {
      document.getElementById('rotaCellModal').classList.add('hidden');
    });

    // Swap modal
    document.getElementById('swapModalCancel').addEventListener('click', () => {
      document.getElementById('rotaSwapModal').classList.add('hidden');
    });
    document.getElementById('swapModalSubmit').addEventListener('click', submitSwapRequest);

    // Pending swaps button
    document.getElementById('rotaSwapsPending').addEventListener('click', renderPendingSwaps);
    document.getElementById('swapListClose').addEventListener('click', () => {
      document.getElementById('rotaSwapListModal').classList.add('hidden');
    });

    renderShiftLegend();
    // Delegated shift edit (hardened)
    const _legend = document.getElementById('shiftLegend');
    if (_legend) _legend.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="edit-shift"]');
      if (btn) openShiftModal(btn.dataset.id);
    });
    renderGrid();
    _refreshTemplateDropdown();
  }

  // ─────────────────────────────────────────
  // WEEKLY GRID
  // ─────────────────────────────────────────

  function renderGrid() {
    const weekDays   = DB.getWeekDays(currentWeek);
    const rota       = DB.getWeekRota(currentWeek);
    const workers    = DB.getWorkers();
    const shifts     = DB.getShiftTemplates();
    const today      = DB.localDateStr();
    const pendingCt  = DB.getPendingSwaps().length;

    // Header
    document.getElementById('rotaWeekLabel').textContent =
      `Week of ${_fmtDate(currentWeek)} – ${_fmtDate(weekDays[6])}`;
    document.getElementById('rotaSwapsPending').textContent =
      `🔄 Swaps${pendingCt ? ' ('+pendingCt+')' : ''}`;

    const container = document.getElementById('rotaGridContainer');
    container.innerHTML = '';

    // Build table
    const table = document.createElement('table');
    table.className = 'rota-table';

    // Header row
    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    hRow.innerHTML = `<th class="rota-worker-col">Worker</th>`;
    weekDays.forEach((d, i) => {
      const isToday = d === today;
      hRow.innerHTML += `
        <th class="rota-day-col ${isToday ? 'rota-today' : ''}">
          ${DAY_NAMES[i]}<br>
          <span class="rota-day-date">${_fmtShortDate(d)}</span>
        </th>`;
    });
    hRow.innerHTML += `<th class="rota-hours-col">Hrs</th>`;
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Body rows
    const tbody = document.createElement('tbody');
    workers.forEach(w => {
      const workerRow = rota[w.id] || [null,null,null,null,null,null,null];
      const tr = document.createElement('tr');

      // Worker name cell
      const nameTd = document.createElement('td');
      nameTd.className = 'rota-worker-name';
      nameTd.innerHTML = `
        <span class="rota-avatar">${_initials(w.name)}</span>
        <span class="rota-name-text">
          <strong>${_esc(w.name)}</strong>
          <small>${_esc(w.role)}</small>
        </span>`;
      tr.appendChild(nameTd);

      let totalHours = 0;

      // Day cells
      weekDays.forEach((d, i) => {
        const shiftId = workerRow[i];
        const shift   = shiftId ? DB.getShiftById(shiftId) : null;
        const isOff   = !shift || shift.id === 'off';
        const isToday = d === today;

        if (shift && shift.start && shift.end) {
          totalHours += _shiftHours(shift.start, shift.end);
        }

        const td = document.createElement('td');
        td.className = `rota-cell ${isOff ? 'rota-off' : ''} ${isToday ? 'rota-today-cell' : ''}`;
        td.style.borderTop = shift ? `3px solid ${shift.color}` : '';

        if (shift && !isOff) {
          td.innerHTML = `
            <span class="rota-shift-name" style="color:${shift.color}">${_esc(shift.name)}</span>
            <span class="rota-shift-time">${_fmt12(shift.start)}–${_fmt12(shift.end)}</span>`;
        } else {
          td.innerHTML = `<span class="rota-off-label">OFF</span>`;
        }

        td.addEventListener('click', () => openCellEditor(w, i, d, shiftId));
        tr.appendChild(td);
      });

      // Hours total
      const hoursTd = document.createElement('td');
      hoursTd.className = 'rota-hours-cell';
      hoursTd.innerHTML = `<strong>${totalHours.toFixed(1)}h</strong>`;
      tr.appendChild(hoursTd);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ─────────────────────────────────────────
  // CELL EDITOR — click a cell to change shift
  // ─────────────────────────────────────────

  function openCellEditor(worker, dayIndex, dateStr, currentShiftId) {
    const modal   = document.getElementById('rotaCellModal');
    const title   = document.getElementById('cellModalTitle');
    const body    = document.getElementById('cellModalBody');
    const shifts  = DB.getShiftTemplates();

    title.textContent = `${worker.name} — ${DAY_FULL[dayIndex]} ${_fmtDate(dateStr)}`;
    body.innerHTML = '';

    // Shift options
    shifts.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'cell-shift-btn' + (s.id === currentShiftId ? ' selected' : '');
      btn.style.borderColor = s.color;
      if (s.id === currentShiftId) btn.style.background = s.color + '22';

      if (s.id === 'off' || !s.start) {
        btn.innerHTML = `<span class="csb-name" style="color:${s.color}">🚫 ${_esc(s.name)}</span>`;
      } else {
        btn.innerHTML = `
          <span class="csb-name" style="color:${s.color}">${_esc(s.name)}</span>
          <span class="csb-time">${_fmt12(s.start)} – ${_fmt12(s.end)}</span>`;
      }

      btn.addEventListener('click', () => {
        DB.setRotaCell(currentWeek, worker.id, dayIndex, s.id);
        modal.classList.add('hidden');
        renderGrid();
      });
      body.appendChild(btn);
    });

    // Clear cell button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'cell-shift-btn cell-clear-btn';
    clearBtn.textContent = '✕ Clear (unassigned)';
    clearBtn.addEventListener('click', () => {
      DB.setRotaCell(currentWeek, worker.id, dayIndex, null);
      modal.classList.add('hidden');
      renderGrid();
    });
    body.appendChild(clearBtn);

    // Swap request button (only if shift assigned)
    if (currentShiftId && currentShiftId !== 'off') {
      const swapBtn = document.createElement('button');
      swapBtn.className = 'cell-shift-btn cell-swap-btn';
      swapBtn.innerHTML = '🔄 Request Shift Swap';
      swapBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        openSwapModal(worker, dayIndex);
      });
      body.appendChild(swapBtn);
    }

    modal.classList.remove('hidden');
  }

  // ─────────────────────────────────────────
  // SHIFT TEMPLATE EDITOR
  // ─────────────────────────────────────────

  function renderShiftLegend() {
    const container = document.getElementById('shiftLegend');
    container.innerHTML = '';
    DB.getShiftTemplates().forEach(s => {
      const chip = document.createElement('div');
      chip.className = 'shift-chip';
      chip.style.borderColor = s.color;
      chip.innerHTML = `
        <span class="shift-chip-dot" style="background:${s.color}"></span>
        <span class="shift-chip-name">${_esc(s.name)}</span>
        ${s.start ? `<span class="shift-chip-time">${_fmt12(s.start)}–${_fmt12(s.end)}</span>` : ''}
        <button class="shift-chip-edit" data-action="edit-shift" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(s.id):_esc(s.id))}">✏️</button>
      `;
      container.appendChild(chip);
    });
  }

  function openShiftModal(shiftId) {
    editingShift = shiftId;
    const shift  = shiftId ? DB.getShiftById(shiftId) : null;
    const modal  = document.getElementById('shiftEditModal');
    const isDefault = shiftId && ['morning','afternoon','night','full','off'].includes(shiftId);

    document.getElementById('shiftModalTitle').textContent = shift ? 'Edit Shift' : 'New Shift';
    document.getElementById('shiftModalName').value  = shift ? shift.name  : '';
    document.getElementById('shiftModalStart').value = shift ? shift.start : '';
    document.getElementById('shiftModalEnd').value   = shift ? shift.end   : '';
    document.getElementById('shiftModalColor').value = shift ? shift.color : '#1a73e8';
    document.getElementById('shiftModalDelete').classList.toggle('hidden', !shift || isDefault);
    modal.classList.remove('hidden');
  }

  function saveShiftModal() {
    const name  = document.getElementById('shiftModalName').value.trim();
    const start = document.getElementById('shiftModalStart').value;
    const end   = document.getElementById('shiftModalEnd').value;
    const color = document.getElementById('shiftModalColor').value;

    if (!name) { App.showToast('Shift name required.'); return; }

    if (editingShift) {
      const shifts = DB.getShiftTemplates();
      const idx    = shifts.findIndex(s => s.id === editingShift);
      if (idx !== -1) { shifts[idx] = { ...shifts[idx], name, start, end, color }; DB.saveShiftTemplates(shifts); }
    } else {
      DB.addShiftTemplate(name, start, end, color);
    }

    document.getElementById('shiftEditModal').classList.add('hidden');
    renderShiftLegend();
    renderGrid();
    App.showToast(editingShift ? 'Shift updated.' : 'Shift added.');
    editingShift = null;
  }

  function deleteShiftFromModal() {
    if (!editingShift) return;
    if (!confirm('Delete this shift template? Existing rota cells using it will be cleared.')) return;
    // Clear all rota cells using this shift
    const rotas = DB.getRotas ? null : null; // access via DB internals via setRotaCell
    DB.deleteShiftTemplate(editingShift);
    document.getElementById('shiftEditModal').classList.add('hidden');
    renderShiftLegend();
    renderGrid();
    App.showToast('Shift deleted.');
    editingShift = null;
  }

  // ─────────────────────────────────────────
  // TEMPLATE SAVE / LOAD / COPY
  // ─────────────────────────────────────────

  function saveTemplate() {
    const name = prompt('Save this week as template name:');
    if (!name || !name.trim()) return;
    DB.saveRotaTemplate(currentWeek, name.trim());
    _refreshTemplateDropdown();
    App.showToast(`Template "${name.trim()}" saved!`);
  }

  function loadTemplate() {
    const sel  = document.getElementById('rotaTplSelect').value;
    if (!sel) { App.showToast('Select a template first.'); return; }
    if (!confirm(`Load template "${sel}" into this week? Current rota will be overwritten.`)) return;
    DB.loadRotaTemplate(sel, currentWeek);
    renderGrid();
    App.showToast(`Template "${sel}" loaded.`);
  }

  function copyToNextWeek() {
    const nextWeek = _addDays(currentWeek, 7);
    if (!confirm(`Copy this week's rota to ${_fmtDate(nextWeek)}?`)) return;
    DB.copyWeekRota(currentWeek, nextWeek);
    App.showToast('Rota copied to next week!');
  }

  function _refreshTemplateDropdown() {
    const sel   = document.getElementById('rotaTplSelect');
    const names = DB.getRotaTemplateNames();
    sel.innerHTML = '<option value="">Load template...</option>';
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    });
  }

  // ─────────────────────────────────────────
  // SWAP REQUESTS
  // ─────────────────────────────────────────

  function openSwapModal(worker, dayIndex) {
    const modal   = document.getElementById('rotaSwapModal');
    const title   = document.getElementById('swapModalTitle');
    const sel     = document.getElementById('swapWorkerSelect');
    const workers = DB.getWorkers().filter(w => w.id !== worker.id);

    title.textContent = `Swap ${DAY_FULL[dayIndex]} shift for ${worker.name}`;
    sel.innerHTML = '<option value="">Select worker to swap with...</option>';
    workers.forEach(w => {
      const rota      = DB.getWeekRota(currentWeek);
      const shiftId   = (rota[w.id] || [])[dayIndex];
      const shift     = shiftId ? DB.getShiftById(shiftId) : null;
      const shiftTxt  = shift ? ` (${shift.name})` : ' (unassigned)';
      const o = document.createElement('option');
      o.value = w.id; o.textContent = w.name + shiftTxt;
      sel.appendChild(o);
    });

    modal.dataset.fromId   = worker.id;
    modal.dataset.dayIndex = dayIndex;
    modal.classList.remove('hidden');
  }

  function submitSwapRequest() {
    const modal   = document.getElementById('rotaSwapModal');
    const toId    = document.getElementById('swapWorkerSelect').value;
    const fromId  = modal.dataset.fromId;
    const dayIdx  = parseInt(modal.dataset.dayIndex);

    if (!toId) { App.showToast('Select a worker to swap with.'); return; }

    DB.requestSwap(fromId, toId, currentWeek, dayIdx);
    modal.classList.add('hidden');

    const fromW = DB.getWorkerById(fromId);
    const toW   = DB.getWorkerById(toId);
    App.showToast(`Swap request sent: ${fromW.name} ↔ ${toW.name}`);
  }

  function renderPendingSwaps() {
    const modal   = document.getElementById('rotaSwapListModal');
    const list    = document.getElementById('swapList');
    const swaps   = DB.getPendingSwaps();

    list.innerHTML = '';

    if (!swaps.length) {
      list.innerHTML = '<p class="empty-msg">No pending swap requests.</p>';
    } else {
      swaps.forEach(s => {
        const from     = DB.getWorkerById(s.fromWorkerId);
        const to       = DB.getWorkerById(s.toWorkerId);
        const days     = DB.getWeekDays(s.weekKey);
        const dateStr  = days[s.dayIndex] || '';
        const fromShift = DB.getShiftById((DB.getWeekRota(s.weekKey)[s.fromWorkerId] || [])[s.dayIndex]);
        const toShift   = DB.getShiftById((DB.getWeekRota(s.weekKey)[s.toWorkerId]   || [])[s.dayIndex]);

        const card = document.createElement('div');
        card.className = 'swap-card';
        card.innerHTML = `
          <div class="swap-workers">
            <span class="swap-name">${_esc(from?.name||'?')}</span>
            <span class="swap-shift-tag" style="background:${fromShift?.color||'#ccc'}22;color:${fromShift?.color||'#555'}">${fromShift?.name||'—'}</span>
            <span class="swap-arrow">⇄</span>
            <span class="swap-name">${_esc(to?.name||'?')}</span>
            <span class="swap-shift-tag" style="background:${toShift?.color||'#ccc'}22;color:${toShift?.color||'#555'}">${toShift?.name||'—'}</span>
          </div>
          <div class="swap-date">📅 ${DAY_FULL[s.dayIndex]}, ${_fmtDate(dateStr)}</div>
          <div class="swap-actions">
            <button class="btn btn-in swap-approve" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(s.id):_esc(s.id))}">✅ Approve</button>
            <button class="btn btn-out swap-deny" data-id="${(typeof Sanitize!=='undefined'?Sanitize.attr(s.id):_esc(s.id))}">❌ Deny</button>
          </div>`;
        list.appendChild(card);
      });

      list.querySelectorAll('.swap-approve').forEach(btn =>
        btn.addEventListener('click', () => { DB.resolveSwap(btn.dataset.id, true);  renderPendingSwaps(); renderGrid(); App.showToast('Swap approved!'); }));
      list.querySelectorAll('.swap-deny').forEach(btn =>
        btn.addEventListener('click', () => { DB.resolveSwap(btn.dataset.id, false); renderPendingSwaps(); App.showToast('Swap denied.'); }));
    }

    modal.classList.remove('hidden');
  }

  // ─────────────────────────────────────────
  // WORKER SCHEDULE VIEW (called from worker dash)
  // ─────────────────────────────────────────

  function renderWorkerSchedule(workerId) {
    const weekKey  = DB.getMondayOf(DB.localDateStr());
    const weekDays = DB.getWeekDays(weekKey);
    const rota     = DB.getWeekRota(weekKey);
    const row      = rota[workerId] || [null,null,null,null,null,null,null];
    const today    = DB.localDateStr();
    const container = document.getElementById('workerScheduleList');
    const weekLabel = document.getElementById('workerScheduleWeek');

    weekLabel.textContent = `${_fmtDate(weekKey)} – ${_fmtDate(weekDays[6])}`;
    container.innerHTML = '';

    let weekHours = 0;

    weekDays.forEach((d, i) => {
      const shiftId = row[i];
      const shift   = shiftId ? DB.getShiftById(shiftId) : null;
      const isOff   = !shift || shift.id === 'off' || !shift.start;
      const isToday = d === today;
      if (shift && shift.start && shift.end) weekHours += _shiftHours(shift.start, shift.end);

      const card = document.createElement('div');
      card.className = `schedule-day-card ${isOff ? 'schedule-off' : ''} ${isToday ? 'schedule-today' : ''}`;
      card.style.borderLeftColor = shift ? shift.color : '#e2e8f0';

      card.innerHTML = isOff
        ? `<span class="sdc-day">${DAY_FULL[i]}</span><span class="sdc-date">${_fmtDate(d)}</span><span class="sdc-off">🚫 Day Off</span>`
        : `<span class="sdc-day">${DAY_FULL[i]}</span>
           <span class="sdc-date">${_fmtDate(d)}</span>
           <span class="sdc-name" style="color:${shift.color}">${_esc(shift.name)}</span>
           <span class="sdc-time">${_fmt12(shift.start)} – ${_fmt12(shift.end)}</span>`;

      container.appendChild(card);
    });

    // Week total
    document.getElementById('workerScheduleHours').textContent = `Scheduled this week: ${weekHours.toFixed(1)}h`;
  }

  // ─────────────────────────────────────────
  // ROTA VS ACTUAL REPORT (for summary tab)
  // ─────────────────────────────────────────

  function renderRotaVsActual(weekKey) {
    const weekDays = DB.getWeekDays(weekKey);
    const rota     = DB.getWeekRota(weekKey);
    const workers  = DB.getWorkers();
    const tbody    = document.getElementById('rotaVsActualBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    workers.forEach(w => {
      const row      = rota[w.id] || [];
      let sched = 0, actual = 0, noShows = 0, lates = 0;

      weekDays.forEach((d, i) => {
        const shiftId = row[i];
        const shift   = shiftId ? DB.getShiftById(shiftId) : null;
        const isOff   = !shift || shift.id === 'off' || !shift.start;
        if (!isOff) {
          sched += _shiftHours(shift.start, shift.end);
          const logs = DB.getLogsForWorkerRange(w.id, d, d);
          if (!logs.length) {
            noShows++;
          } else {
            actual += DB.calcHours(logs);
            // Late check
            const [sh, sm] = shift.start.split(':').map(Number);
            const firstIn  = logs.find(l => l.action === 'IN');
            if (firstIn) {
              const t = new Date(firstIn.timestamp);
              if (t.getHours()*60 + t.getMinutes() > sh*60 + sm + 30) lates++;
            }
          }
        }
      });

      const diff = actual - sched;
      const tr   = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${_esc(w.name)}</strong><br><small>${_esc(w.role)}</small></td>
        <td>${sched.toFixed(1)}h</td>
        <td>${actual.toFixed(1)}h</td>
        <td class="${diff >= 0 ? 'pos-diff' : 'neg-diff'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}h</td>
        <td>${noShows > 0 ? `<span class="flag flag-absent">${noShows} absent</span>` : '✅'}</td>
        <td>${lates > 0 ? `<span class="flag flag-late">${lates} late</span>` : '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ─────────────────────────────────────────
  // CSV EXPORT
  // ─────────────────────────────────────────

  function exportCSV() {
    const weekDays = DB.getWeekDays(currentWeek);
    const rota     = DB.getWeekRota(currentWeek);
    const workers  = DB.getWorkers();
    const _c       = v => `"${String(v||'').replace(/"/g,'""')}"`;

    const headers  = ['Worker','Role', ...weekDays.map((d,i) => DAY_NAMES[i]+' '+d), 'Total Hrs'];
    const rows     = workers.map(w => {
      const row = rota[w.id] || [];
      let total = 0;
      const cells = weekDays.map((d, i) => {
        const shift = row[i] ? DB.getShiftById(row[i]) : null;
        if (shift && shift.start) total += _shiftHours(shift.start, shift.end);
        return shift ? (shift.id === 'off' ? 'OFF' : `${shift.name} ${shift.start}-${shift.end}`) : '—';
      });
      return [_c(w.name), _c(w.role), ...cells.map(_c), _c(total.toFixed(1)+'h')];
    });

    const csv  = [headers.map(_c).join(','), ...rows.map(r=>r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `rota_${currentWeek}.csv`
    });
    a.click(); URL.revokeObjectURL(a.href);
    App.showToast('Rota exported!');
  }

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  function _addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return DB.localDateStr(d);
  }

  function _shiftHours(start, end) {
    if (!start || !end) return 0;
    const [sh,sm] = start.split(':').map(Number);
    const [eh,em] = end.split(':').map(Number);
    let h = (eh*60+em) - (sh*60+sm);
    if (h < 0) h += 24*60; // overnight shift
    return h / 60;
  }

  function _fmt12(hhmm) {
    if (!hhmm) return '';
    const [h,m] = hhmm.split(':').map(Number);
    return `${h%12||12}:${String(m).padStart(2,'0')}${h>=12?'pm':'am'}`;
  }

  function _fmtDate(str) {
    if (!str) return '';
    return new Date(str + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }

  function _fmtShortDate(str) {
    if (!str) return '';
    return new Date(str + 'T12:00:00').toLocaleDateString('en-US',{day:'numeric'});
  }

  function _initials(name) { return name.split(' ').map(p=>p[0]).join('').toUpperCase().slice(0,2); }
  function _esc(str)       { const d=document.createElement('div'); d.textContent=str||''; return d.innerHTML; }

  return {
    init, renderGrid, renderShiftLegend,
    openShiftModal,
    renderWorkerSchedule,
    renderRotaVsActual,
    getCurrentWeek: () => currentWeek,
  };

})();
