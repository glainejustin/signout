/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  WorkTap — Google Apps Script                               ║
 * ║  Paste this entire file into your Google Apps Script editor ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * SETUP STEPS:
 *  1. Open Google Sheets → Extensions → Apps Script
 *  2. Delete the default code, paste this entire file
 *  3. Click Deploy → New deployment → Web app
 *  4. Execute as: Me  |  Who has access: Anyone
 *  5. Copy the Web App URL and paste it into WorkTap Admin → Sheets Sync
 */

// ── CONFIG ────────────────────────────────────────────────────
// Sheet names — change these if you want different tab names
var SHEET_LOGS    = 'Attendance Logs';
var SHEET_SUMMARY = 'Daily Summary';
var SHEET_WORKERS = 'Workers';

// ── ENTRY POINT ───────────────────────────────────────────────

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var logs = data.logs || [];

    if (logs.length === 0) {
      return _jsonResponse({ status: 'ok', message: 'No logs to write.' });
    }

    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = _getOrCreateSheet(ss, SHEET_LOGS);

    // Write headers if sheet is new / empty
    if (logSheet.getLastRow() === 0) {
      logSheet.appendRow([
        'Log ID', 'Worker Name', 'Worker ID', 'Action',
        'Date', 'Time', 'Timestamp', 'Hours (session)'
      ]);
      logSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
    }

    // Build a map of existing log IDs to avoid duplicates
    var existingIds = {};
    var lastRow = logSheet.getLastRow();
    if (lastRow > 1) {
      var existingData = logSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      existingData.forEach(function(row) { existingIds[row[0]] = true; });
    }

    // Sort logs by timestamp ascending before writing
    logs.sort(function(a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    var newRows = [];
    logs.forEach(function(log) {
      if (existingIds[log.id]) return; // skip duplicate
      newRows.push([
        log.id,
        log.workerName,
        log.workerId,
        log.action,
        log.date,
        log.time,
        log.timestamp,
        '' // hours calculated below
      ]);
    });

    if (newRows.length > 0) {
      logSheet.getRange(logSheet.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);

      // Colour IN rows green, OUT rows red
      var dataStart = logSheet.getLastRow() - newRows.length + 1;
      newRows.forEach(function(row, i) {
        var color = row[3] === 'IN' ? '#e6f4ea' : '#fce8e6';
        logSheet.getRange(dataStart + i, 1, 1, 8).setBackground(color);
      });
    }

    // Rebuild daily summary
    _rebuildDailySummary(ss, logSheet);

    return _jsonResponse({ status: 'ok', written: newRows.length });

  } catch (err) {
    return _jsonResponse({ status: 'error', message: err.toString() });
  }
}

// Allow GET for health check
function doGet(e) {
  return _jsonResponse({ status: 'ok', message: 'WorkTap Sheets webhook is running.' });
}

// ── DAILY SUMMARY ─────────────────────────────────────────────

function _rebuildDailySummary(ss, logSheet) {
  var summarySheet = _getOrCreateSheet(ss, SHEET_SUMMARY);
  summarySheet.clearContents();

  summarySheet.appendRow(['Worker Name', 'Date', 'Total Hours', 'Sessions']);
  summarySheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');

  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return;

  var data = logSheet.getRange(2, 1, lastRow - 1, 8).getValues();

  // Group by worker + date
  var groups = {};
  data.forEach(function(row) {
    var workerId  = row[2];
    var workerName = row[1];
    var action    = row[3];
    var timestamp = row[6];
    var dateKey   = row[4];
    var key       = workerName + '|' + dateKey;

    if (!groups[key]) groups[key] = { workerName: workerName, date: dateKey, events: [] };
    groups[key].events.push({ action: action, ts: new Date(timestamp) });
  });

  var summaryRows = [];
  Object.keys(groups).forEach(function(key) {
    var g = groups[key];
    g.events.sort(function(a, b) { return a.ts - b.ts; });

    var totalMs = 0;
    var sessions = 0;
    var inTime = null;

    g.events.forEach(function(ev) {
      if (ev.action === 'IN') {
        inTime = ev.ts;
      } else if (ev.action === 'OUT' && inTime) {
        totalMs += ev.ts - inTime;
        sessions++;
        inTime = null;
      }
    });

    var totalHours = (totalMs / 3600000).toFixed(2);
    summaryRows.push([g.workerName, g.date, parseFloat(totalHours), sessions]);
  });

  if (summaryRows.length > 0) {
    summarySheet.getRange(2, 1, summaryRows.length, 4).setValues(summaryRows);
  }
}

// ── HELPERS ───────────────────────────────────────────────────

function _getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
