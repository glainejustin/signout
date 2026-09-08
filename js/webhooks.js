/**
 * webhooks.js — Real-Time Webhook Alert Dispatcher
 * Dispatches to Slack / Teams / Discord / Telegram. Guarded by Sanitize allow-list.
 */

const Webhooks = (() => {

  async function sendAlert(title, message, details = {}) {
    const settings = DB.getSettings();
    const webhookUrl = settings.webhookUrl;
    if (!webhookUrl || !settings.webhooksEnabled) return;
    if (typeof Sanitize !== 'undefined' && Sanitize.isWebhookUrl && !Sanitize.isWebhookUrl(webhookUrl)) {
      console.warn('[SignOut] Blocked webhook to non-allow-listed host:', webhookUrl);
      return;
    }

    const payload = {
      text: `⏱ *SignOut Alert*: ${title}\n> ${message}`,
      attachments: [
        {
          color: details.type === 'overtime' ? '#e65100' : details.type === 'late' ? '#d32f2f' : '#1a73e8',
          fields: Object.keys(details).map(k => ({ title: k, value: String(details[k]), short: true })),
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Webhook dispatch failed:', e);
    }
  }

  async function testConnection(url) {
    if (!url) return { success: false, message: 'Please enter a webhook URL.' };
    if (typeof Sanitize !== 'undefined' && Sanitize.isWebhookUrl && !Sanitize.isWebhookUrl(url)) {
      return { success: false, message: 'URL not allow-listed. Use hooks.slack.com, hooks.office.com, discord.com/api/webhooks, or api.telegram.org' };
    }
    try {
      const payload = { text: '⏱ *SignOut*: Webhook connection test successful! ✅' };
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return { success: true, message: 'Test message sent successfully!' };
    } catch (e) {
      return { success: false, message: 'Failed to send webhook: ' + e.message };
    }
  }

  return { sendAlert, testConnection };

})();
