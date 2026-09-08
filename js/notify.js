/**
 * notify.js — Push notifications + WhatsApp daily report
 * Handles: forgotten clock-out alerts, daily attendance summary via WhatsApp
 */

const Notify = (() => {

  let forgotTimer = null;
  const FORGOT_CHECK_INTERVAL = 60 * 1000; // check every 1 min
  const MAX_SHIFT_HOURS       = 10;         // alert if clocked in > 10h

  // ── PUSH NOTIFICATIONS ────────────────────────────────────

  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  function isSupported() {
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  function sendLocalNotification(title, body, icon) {
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, {
        body,
        icon: icon || './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag:   'signout-alert',
      });
    } catch (e) {
      console.warn('Notification failed:', e);
    }
  }

  /** Start polling for workers who forgot to clock out */
  function startForgotClockOutWatcher() {
    if (forgotTimer) clearInterval(forgotTimer);
    forgotTimer = setInterval(_checkForgotClockOut, FORGOT_CHECK_INTERVAL);
    _checkForgotClockOut(); // run immediately
  }

  function stopForgotClockOutWatcher() {
    if (forgotTimer) clearInterval(forgotTimer);
    forgotTimer = null;
  }

  function _checkForgotClockOut() {
    const settings = DB.getSettings();
    if (!settings.pushEnabled) return;
    if (Notification.permission !== 'granted') return;

    const workers = DB.getWorkers().filter(w => w.clockedIn && w.lastActionTime);
    workers.forEach(w => {
      const elapsed = (Date.now() - new Date(w.lastActionTime)) / 3600000;
      if (elapsed >= MAX_SHIFT_HOURS) {
        sendLocalNotification(
          '⏰ Forgot to clock out?',
          `${w.name} has been clocked in for ${Math.floor(elapsed)}h. Please clock out.`,
        );
      }
    });
  }

  // ── WHATSAPP DAILY REPORT ─────────────────────────────────

  let waReportTimer = null;

  function scheduleWhatsAppReport() {
    if (waReportTimer) clearInterval(waReportTimer);
    waReportTimer = setInterval(_checkWhatsAppReportTime, 60 * 1000);
    _checkWhatsAppReportTime();
  }

  function _checkWhatsAppReportTime() {
    const settings = DB.getSettings();
    if (!settings.whatsappEnabled || !settings.whatsappNumber) return;

    const now      = new Date();
    const [rh, rm] = (settings.dailyReportTime || '18:00').split(':').map(Number);
    const lastSent = parseInt(localStorage.getItem('signout_wa_last_sent') || '0');
    const todayKey = DB.localDateStr();

    // Send once per day at the configured time
    if (now.getHours() === rh && now.getMinutes() === rm && lastSent !== todayKey) {
      localStorage.setItem('signout_wa_last_sent', todayKey);
      _sendWhatsAppReport(settings);
    }
  }

  function _sendWhatsAppReport(settings) {
    const workers = DB.getWorkers();
    const today   = DB.localDateStr();
    const lines   = [`📊 *Attendance Report — ${today}*\n`];

    workers.forEach(w => {
      const logs   = DB.getLogsForWorkerToday(w.id);
      const hours  = DB.calcHoursToday(w.id);
      const h      = Math.floor(hours);
      const m      = Math.round((hours - h) * 60);
      const status = w.onLeave ? '🏖 Leave' : w.clockedIn ? '🟢 IN' : logs.length ? `🔴 OUT (${h}h${m}m)` : '⚪ Absent';
      lines.push(`*${w.name}*: ${status}`);
    });

    const msg = encodeURIComponent(lines.join('\n'));
    // Use WhatsApp Business API (wa.me link) — opens WhatsApp with pre-filled message
    // For automation, user can set up a WhatsApp Business webhook URL instead
    const waUrl = `https://wa.me/${settings.whatsappNumber.replace(/\D/g,'')}?text=${msg}`;

    // If a custom webhook URL is set, POST to it instead
    if (settings.whatsappWebhookUrl) {
      fetch(settings.whatsappWebhookUrl, {
        method: 'POST',
        mode:   'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: lines.join('\n'), date: today }),
      }).catch(() => {});
    } else {
      // Fallback: open WhatsApp link
      window.open(waUrl, '_blank');
    }
  }

  /** Send report manually (called from admin) */
  function sendReportNow() {
    const settings = DB.getSettings();
    if (!settings.whatsappNumber) {
      App.showToast('Set a WhatsApp number in Settings first.');
      return;
    }
    _sendWhatsAppReport(settings);
    App.showToast('WhatsApp report sent!');
  }

  return {
    requestPermission, isSupported, sendLocalNotification,
    startForgotClockOutWatcher, stopForgotClockOutWatcher,
    scheduleWhatsAppReport, sendReportNow,
  };

})();
