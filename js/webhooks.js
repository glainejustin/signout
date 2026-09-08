/**
 * webhooks.js — Real-Time Webhook Alert Dispatcher
 * Dispatches automated JSON notifications to Slack, Microsoft Teams, or Discord webhooks.
 */

const Webhooks = (() => {

  /**
   * Sends a payload to the configured webhook URL.
   */
  async function sendAlert(title, message, details = {}) {
    const settings = DB.getSettings();
    const webhookUrl = settings.webhookUrl;
    if (!webhookUrl || !settings.webhooksEnabled) return;

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

  /**
   * Test current webhook connection from settings UI.
   */
  async function testConnection(url) {
    if (!url) return { success: false, message: 'Please enter a webhook URL.' };
    try {
      const payload = {
        text: '⏱ *SignOut*: Webhook connection test successful! ✅'
      };
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { success: true, message: 'Test message sent successfully!' };
    } catch (e) {
      return { success: false, message: 'Failed to send webhook: ' + e.message };
    }
  }

  return {
    sendAlert,
    testConnection
  };

})();
