/**
 * tests/db.test.mjs — hours maths, overtime guard and payroll export.
 * Run with: npm test   (node --test, no dependencies)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, stamp } from './harness.mjs';

const WORKERS_KEY  = 'signout_workers';
const LOGS_KEY     = 'signout_logs';
const SETTINGS_KEY = 'signout_settings';

function makeWorker(id, name, role) {
  return {
    id, name, role: role || 'Cashier', username: id, pin: 'a'.repeat(64),
    nfcId: '', clockedIn: false, lastAction: null, lastActionTime: null,
    deviceFingerprint: null, deviceShortId: null, deviceRegistered: false,
    shiftStart: '', shiftEnd: '', allowedDays: [], onLeave: false, leaveNote: '',
  };
}

function logs(entries) {
  return entries.map(([workerId, action, dateStr, hhmm], i) => ({
    id: 'l_' + i, workerId, workerName: workerId, action,
    timestamp: stamp(dateStr, hhmm), date: dateStr, time: hhmm,
    photo: null, synced: false,
  }));
}

/** Fresh app with the given workers / logs / settings written straight to storage. */
function setup({ workers = [], logEntries = [], settings = {} } = {}) {
  const app = loadApp();
  app.localStorage.setItem(WORKERS_KEY, JSON.stringify(workers));
  app.localStorage.setItem(LOGS_KEY, JSON.stringify(logs(logEntries)));
  app.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    adminPin: 'a'.repeat(64), dailyOvertimeHours: 8, weeklyOvertimeHours: 40, ...settings,
  }));
  return app;
}

// ── calcHours ────────────────────────────────────────────────

test('calcHours nets out break time', () => {
  const { DB } = setup();
  const day = [
    ['w1', 'IN',          '2026-09-21', '09:00'],
    ['w1', 'BREAK_START', '2026-09-21', '12:00'],
    ['w1', 'BREAK_END',   '2026-09-21', '12:30'],
    ['w1', 'OUT',         '2026-09-21', '17:00'],
  ].map(([workerId, action, dateStr, hhmm], i) => ({
    id: 'x' + i, workerId, action, timestamp: stamp(dateStr, hhmm),
  }));

  assert.equal(DB.calcHours(day), 7.5, '8h gross − 30m break');
});

test('calcHours ignores a shift that never clocked out', () => {
  const { DB } = setup();
  const day = [
    { action: 'IN',  timestamp: stamp('2026-09-21', '09:00') },
    { action: 'IN',  timestamp: stamp('2026-09-22', '09:00') },
    { action: 'OUT', timestamp: stamp('2026-09-22', '13:00') },
  ];
  assert.equal(DB.calcHours(day), 4, 'only the closed shift counts');
});

// ── dayStats ─────────────────────────────────────────────────

test('dayStats splits gross / break / net and flags a missing clock-out', () => {
  const { DB } = setup();
  const closed = [
    { action: 'IN',          timestamp: stamp('2026-09-21', '09:00') },
    { action: 'BREAK_START', timestamp: stamp('2026-09-21', '12:00') },
    { action: 'BREAK_END',   timestamp: stamp('2026-09-21', '13:00') },
    { action: 'OUT',         timestamp: stamp('2026-09-21', '18:00') },
  ];
  const st = DB.dayStats(closed);
  assert.equal(st.grossH, 9);
  assert.equal(st.breakH, 1);
  assert.equal(st.netH, 8);
  assert.equal(st.missingOut, false);
  assert.equal(st.firstIn.toISOString(), stamp('2026-09-21', '09:00'));

  const open = DB.dayStats([{ action: 'IN', timestamp: stamp('2026-09-21', '09:00') }]);
  assert.equal(open.netH, 0);
  assert.equal(open.missingOut, true, 'still clocked in → flagged for the manager');
});

test('dayStats.netH always matches calcHours (no drift between the two code paths)', () => {
  const { DB } = setup();
  const fixtures = [
    [['IN', '09:00'], ['OUT', '17:00']],
    [['IN', '08:00'], ['BREAK_START', '11:00'], ['BREAK_END', '11:45'], ['OUT', '16:00']],
    [['IN', '22:00'], ['OUT', '23:30'], ['IN', '23:45'], ['OUT', '23:59']],
  ];
  for (const fixture of fixtures) {
    const day = fixture.map(([action, hhmm]) => ({ action, timestamp: stamp('2026-09-21', hhmm) }));
    assert.equal(DB.dayStats(day).netH, DB.calcHours(day), JSON.stringify(fixture));
  }
});

test('a break left open is charged only up to clock-out, never past it', () => {
  const { DB } = setup();
  const day = [
    { action: 'IN',          timestamp: stamp('2026-09-21', '09:00') },
    { action: 'BREAK_START', timestamp: stamp('2026-09-21', '09:10') },
    { action: 'OUT',         timestamp: stamp('2026-09-21', '10:00') },  // left while on break
  ];
  const st = DB.dayStats(day);
  assert.ok(Math.abs(st.breakH - 50 / 60) < 1e-9, `break clamped to the 50m until clock-out, got ${st.breakH}`);
  assert.ok(Math.abs(st.netH - 10 / 60) < 1e-9, `net 10m, got ${st.netH}`);
  assert.ok(st.netH >= 0, 'never negative');
});

// ── overtime guard ───────────────────────────────────────────

test('overtime guard is off unless the admin turns it on', () => {
  const { DB } = setup({ settings: { overtimeGuardEnabled: false } });
  const guard = DB.checkOvertimeGuard('w1');
  assert.equal(guard.allowed, true);
  assert.equal(guard.enabled, false);
});

test('overtime guard blocks clock-in once the daily threshold is reached', () => {
  const app = setup({
    workers: [makeWorker('w1', 'Maria Santos')],
    settings: { overtimeGuardEnabled: true, dailyOvertimeHours: 8, weeklyOvertimeHours: 40 },
  });
  const { DB } = app;
  const today = DB.localDateStr();
  app.localStorage.setItem(LOGS_KEY, JSON.stringify(logs([
    ['w1', 'IN',  today, '08:00'],
    ['w1', 'OUT', today, '17:00'],   // 9h → over the 8h cap
  ])));

  const guard = DB.checkOvertimeGuard('w1');
  assert.equal(guard.allowed, false);
  assert.equal(guard.scope, 'day');
  assert.match(guard.message, /Daily limit reached/);
});

test('overtime guard blocks clock-in once the weekly threshold is reached', () => {
  const app = setup({
    workers: [makeWorker('w1', 'Juan dela Cruz')],
    settings: { overtimeGuardEnabled: true, dailyOvertimeHours: 24, weeklyOvertimeHours: 40 },
  });
  const { DB } = app;
  const { from } = DB.getWeekRange();
  const next = new Date(from + 'T12:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  const second = next.toISOString().slice(0, 10);

  app.localStorage.setItem(LOGS_KEY, JSON.stringify(logs([
    ['w1', 'IN',  from,   '00:00'],
    ['w1', 'OUT', from,   '20:00'],   // 20h
    ['w1', 'IN',  second, '00:00'],
    ['w1', 'OUT', second, '21:00'],   // 21h → 41h for the week
  ])));

  const guard = DB.checkOvertimeGuard('w1');
  assert.equal(guard.allowed, false);
  assert.equal(guard.scope, 'week');
  assert.equal(guard.cap, 40);
  assert.ok(guard.hours >= 40);
});

test('overtime guard allows clock-in below the thresholds', () => {
  const app = setup({
    workers: [makeWorker('w1', 'Ana Reyes')],
    settings: { overtimeGuardEnabled: true, dailyOvertimeHours: 8, weeklyOvertimeHours: 40 },
  });
  const { DB } = app;
  const today = DB.localDateStr();
  app.localStorage.setItem(LOGS_KEY, JSON.stringify(logs([
    ['w1', 'IN',  today, '08:00'],
    ['w1', 'OUT', today, '12:00'],   // 4h
  ])));
  assert.equal(DB.checkOvertimeGuard('w1').allowed, true);
});

// ── payroll CSV ──────────────────────────────────────────────

test('buildPayrollCsv splits regular vs overtime per day with totals', () => {
  const app = setup({
    workers: [
      makeWorker('w1', 'Maria Santos', 'Cashier'),
      makeWorker('w2', 'Ana Reyes', 'Stock Clerk'),
    ],
  });
  const { DB } = app;
  app.localStorage.setItem(LOGS_KEY, JSON.stringify(logs([
    ['w1', 'IN',          '2026-09-21', '09:00'],
    ['w1', 'BREAK_START', '2026-09-21', '12:00'],
    ['w1', 'BREAK_END',   '2026-09-21', '12:30'],
    ['w1', 'OUT',         '2026-09-21', '17:00'],   // 7.5h
    ['w1', 'IN',          '2026-09-22', '08:00'],
    ['w1', 'OUT',         '2026-09-22', '18:00'],   // 10h → 8 regular + 2 OT
    ['w2', 'IN',          '2026-09-21', '09:00'],   // never clocks out
  ])));

  const res = DB.buildPayrollCsv('2026-09-21', '2026-09-22');

  assert.equal(res.filename, 'payroll_2026-09-21_to_2026-09-22.csv');
  assert.equal(res.workerCount, 2);
  assert.equal(res.dayCount, 3);
  assert.equal(res.openShifts, 1);
  assert.equal(res.totalPaidHours, 17.5);

  assert.ok(res.csv.startsWith('\uFEFF'), 'BOM keeps Excel happy');
  const lines = res.csv.replace('\uFEFF', '').split('\n');
  assert.equal(lines[0], '"Worker","Role","Date","Shift Start","Shift End","Gross Hours","Break Hours","Regular Hours","Overtime Hours","Paid Hours","Notes"');

  // Clock columns render in the machine's local time (payroll reads local shifts).
  const clock = iso => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  const day1 = lines.find(l => l.includes('"Maria Santos"') && l.includes('2026-09-21'));
  assert.equal(day1,
    `"Maria Santos","Cashier","2026-09-21","${clock(stamp('2026-09-21', '09:00'))}","${clock(stamp('2026-09-21', '17:00'))}","8","0.5","7.5","0","7.5",""`
  );

  const day2 = lines.find(l => l.includes('2026-09-22'));
  assert.equal(day2,
    `"Maria Santos","Cashier","2026-09-22","${clock(stamp('2026-09-22', '08:00'))}","${clock(stamp('2026-09-22', '18:00'))}","10","0","8","2","10","Overtime"`
  );

  const total1 = lines.find(l => l.includes('"Maria Santos"') && l.includes('"TOTAL"'));
  assert.equal(total1, '"Maria Santos","Cashier","TOTAL","","","","0.5","15.5","2","17.5",""');

  const open = lines.find(l => l.includes('"Ana Reyes"'));
  assert.ok(open.endsWith('"Missing clock-out"'), 'half-finished shifts are flagged: ' + open);
});

test('buildPayrollCsv ignores workers with no logs and falls back to the current week', () => {
  const { DB } = setup({ workers: [makeWorker('w9', 'Nobody Here')] });
  const res = DB.buildPayrollCsv('not-a-date', '');
  const { from, to } = DB.getWeekRange();
  assert.equal(res.workerCount, 0);
  assert.equal(res.filename, `payroll_${from}_to_${to}.csv`);
  assert.equal(res.rows.length, 1, 'header only');
});

test('csvCell escapes quotes so payroll imports never shift columns', () => {
  const { DB } = setup();
  assert.equal(DB.csvCell('plain'), '"plain"');
  assert.equal(DB.csvCell('Ana "Cash" Reyes'), '"Ana ""Cash"" Reyes"');
  assert.equal(DB.csvCell(null), '""');
});
