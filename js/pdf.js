/**
 * pdf.js — Printable Timesheet & PDF Document Generator
 * Generates beautifully formatted HTML/CSS printable timesheets for workers & rosters.
 */

const PDFReport = (() => {

  /**
   * Generates a printable timesheet window for a specific worker and date range.
   */
  function printWorkerTimesheet(workerId, fromDate, toDate) {
    const worker = DB.getWorkerById(workerId);
    if (!worker) return;

    const settings = DB.getSettings();
    const logs = DB.getLogsForWorkerRange(workerId, fromDate, toDate);
    const totalHours = DB.calcHours(logs);
    const otThreshold = settings.dailyOvertimeHours || 8;

    // Calculate overtime & break breakdown
    let normalHours = 0;
    let overtimeHours = 0;
    let breakTimeTotal = 0;

    // Group logs by day
    const byDate = {};
    logs.forEach(l => { (byDate[l.timestamp.slice(0, 10)] = byDate[l.timestamp.slice(0, 10)] || []).push(l); });

    let rowsHtml = '';
    Object.keys(byDate).sort().forEach(d => {
      const dayLogs = byDate[d];
      const dayH = DB.calcHours(dayLogs);
      const dayOT = Math.max(0, dayH - otThreshold);
      const dayReg = dayH - dayOT;
      normalHours += dayReg;
      overtimeHours += dayOT;

      const firstIn = dayLogs.find(l => l.action === 'IN')?.time || '—';
      const lastOut = dayLogs.slice().reverse().find(l => l.action === 'OUT')?.time || '—';

      rowsHtml += `
        <tr>
          <td>${d}</td>
          <td>${firstIn}</td>
          <td>${lastOut}</td>
          <td>${dayReg.toFixed(2)} hrs</td>
          <td>${dayOT > 0 ? dayOT.toFixed(2) + ' hrs' : '0.00'}</td>
          <td><strong>${dayH.toFixed(2)} hrs</strong></td>
        </tr>
      `;
    });

    const printWindow = window.open('', '_blank', 'width=850,height=900');
    if (!printWindow) {
      alert('Please allow popups to generate the printable timesheet.');
      return;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Timesheet - ${worker.name}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #111; padding: 24px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1a73e8; padding-bottom: 12px; margin-bottom: 20px; }
          .company { font-size: 24px; font-weight: bold; color: #1a73e8; }
          .title { font-size: 18px; color: #555; }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: #f8f9fa; padding: 14px; border-radius: 8px; margin-bottom: 20px; }
          .meta-item { font-size: 14px; }
          .meta-item strong { color: #333; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          th, td { border: 1px solid #e0e0e0; padding: 10px; text-align: left; font-size: 13px; }
          th { background: #f1f3f4; font-weight: 600; }
          .summary-card { display: flex; justify-content: space-around; background: #e8f0fe; padding: 16px; border-radius: 8px; font-size: 15px; margin-bottom: 30px; }
          .summary-val { font-size: 20px; font-weight: bold; color: #1a73e8; }
          .signatures { display: flex; justify-content: space-between; margin-top: 50px; }
          .sig-box { width: 45%; border-top: 1px solid #000; text-align: center; padding-top: 6px; font-size: 13px; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <button class="no-print" onclick="window.print()" style="float:right;padding:8px 16px;background:#1a73e8;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:12px;">🖨 Print / Save as PDF</button>
        <div class="header">
          <div>
            <div class="company">${settings.businessName || 'WorkTap Attendance'}</div>
            <div class="title">Employee Timesheet</div>
          </div>
          <div style="text-align:right;">
            <div>Date Range: ${fromDate} to ${toDate}</div>
            <div>Generated: ${new Date().toLocaleDateString()}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-item"><strong>Employee Name:</strong> ${worker.name}</div>
          <div class="meta-item"><strong>Role:</strong> ${worker.role}</div>
          <div class="meta-item"><strong>Employee ID:</strong> ${worker.username}</div>
          <div class="meta-item"><strong>Status:</strong> ${worker.onLeave ? 'On Leave' : 'Active'}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Clock IN</th>
              <th>Clock OUT</th>
              <th>Regular Hrs</th>
              <th>Overtime Hrs</th>
              <th>Total Hours</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="6" style="text-align:center;">No log records found for this period.</td></tr>'}
          </tbody>
        </table>

        <div class="summary-card">
          <div>Regular Hours: <div class="summary-val">${normalHours.toFixed(2)}h</div></div>
          <div>Overtime Hours: <div class="summary-val">${overtimeHours.toFixed(2)}h</div></div>
          <div>Total Worked: <div class="summary-val">${totalHours.toFixed(2)}h</div></div>
        </div>

        <div class="signatures">
          <div class="sig-box">Employee Signature & Date</div>
          <div class="sig-box">Manager Signature & Date</div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }

  return { printWorkerTimesheet };

})();
