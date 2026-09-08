/**
 * logs.js — Log table rendering with late/OT flags and photo viewer
 */

const Logs = (() => {

  let filterWorker = '';
  let filterDate   = '';

  function init() {
    document.getElementById('filterWorker').addEventListener('change', e => { filterWorker = e.target.value; render(); });
    document.getElementById('filterDate').addEventListener('change',   e => { filterDate   = e.target.value; render(); });
    document.getElementById('clearFilter').addEventListener('click', () => {
      filterWorker = ''; filterDate = '';
      document.getElementById('filterWorker').value = '';
      document.getElementById('filterDate').value   = '';
      render();
    });
    // Photo viewer close
    document.getElementById('photoViewClose').addEventListener('click', () => {
      document.getElementById('photoViewModal').classList.add('hidden');
    });
  }

  function render() {
    let logs = DB.getLogs().slice().reverse();
    if (filterWorker) logs = logs.filter(l => l.workerId === filterWorker);
    if (filterDate)   logs = logs.filter(l => l.timestamp.startsWith(filterDate));

    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    const workers = DB.getWorkers();

    logs.forEach(l => {
      const w     = workers.find(x => x.id === l.workerId);
      const hours = l.action === 'OUT' ? _sessionHours(l) : null;
      const isLate = _isLate(l, w);
      const otLimit = DB.getSettings().dailyOvertimeHours || 8;
      const isOT   = hours && parseFloat(hours) > otLimit;

      const flags = [
        isLate ? '<span class="flag flag-late">LATE</span>' : '',
        isOT   ? '<span class="flag flag-ot">OT</span>'     : '',
      ].join('');

      const badgeCls = l.action === 'IN' ? 'badge-in' : l.action === 'OUT' ? 'badge-out' : 'badge-break';
      const actionLabel = l.action === 'BREAK_START' ? 'BREAK START' : l.action === 'BREAK_END' ? 'RESUME' : l.action;

      const photoBtn = l.photo
        ? `<button class="photo-btn" onclick="Logs.viewPhoto('${l.id}')">📸</button>` : '—';

      const tr = document.createElement('tr');
      tr.className = isLate ? 'row-late' : isOT ? 'row-ot' : '';
      tr.innerHTML = `
        <td><strong>${_esc(l.workerName)}</strong></td>
        <td><span class="badge ${badgeCls}">${actionLabel}</span>${flags}</td>
        <td>${_fmtDate(l.timestamp)}</td>
        <td>${_fmtTime(l.timestamp)}</td>
        <td>${hours ? `<strong>${hours}h</strong>` : '—'}</td>
        <td>${photoBtn}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function viewPhoto(logId) {
    const log = DB.getLogs().find(l => l.id === logId);
    if (!log || !log.photo) return;
    document.getElementById('photoViewImg').src = log.photo;
    document.getElementById('photoViewName').textContent = `${log.workerName} — ${log.action} @ ${log.time}`;
    document.getElementById('photoViewModal').classList.remove('hidden');
  }

  function _sessionHours(outLog) {
    const all = DB.getLogs()
      .filter(l => l.workerId === outLog.workerId)
      .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    const idx = all.findIndex(l => l.id === outLog.id);
    for (let i = idx-1; i >= 0; i--) {
      if (all[i].action === 'IN') {
        return ((new Date(outLog.timestamp) - new Date(all[i].timestamp)) / 3600000).toFixed(2);
      }
    }
    return null;
  }

  function _isLate(log, worker) {
    if (!worker || !worker.shiftStart || log.action !== 'IN') return false;
    const [sh, sm] = worker.shiftStart.split(':').map(Number);
    const d = new Date(log.timestamp);
    return d.getHours()*60 + d.getMinutes() > sh*60 + sm + 30;
  }

  function _fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }
  function _fmtTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  function _esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

  return { init, render, viewPhoto };

})();
