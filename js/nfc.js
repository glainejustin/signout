/**
 * nfc.js — Web NFC API handler
 * Handles reading NFC tags and triggering sign in/out
 */

const NFC = (() => {

  let reader = null;
  let scanCallback = null;   // called with tagId (string)
  let scanning = false;
  let scanOnce = false;       // true = scan once then stop (for worker registration)

  const isSupported = () => 'NDEFReader' in window;

  /**
   * Start continuous NFC scanning for the main clock-in/out flow.
   * @param {Function} onTag - called with (tagId: string) when a tag is read
   */
  async function startClockScanning(onTag) {
    if (!isSupported()) return false;
    if (scanning) return true;

    try {
      reader = new NDEFReader();
      await reader.scan();
      scanning = true;
      scanOnce = false;
      scanCallback = onTag;

      reader.onreading = (event) => {
        const tagId = event.serialNumber || _extractTagId(event.message);
        if (scanCallback && tagId) {
          if (scanOnce) {
            stopScanning();
          }
          scanCallback(tagId);
        }
      };

      reader.onreadingerror = () => {
        console.warn('NFC read error — retrying...');
      };

      return true;
    } catch (err) {
      console.error('NFC scan failed:', err);
      return false;
    }
  }

  /**
   * Scan exactly ONE tag then stop. Used during worker registration.
   * @param {Function} onTag - called with (tagId: string)
   */
  async function scanOneTag(onTag) {
    if (!isSupported()) return false;

    try {
      if (!reader) reader = new NDEFReader();
      await reader.scan();
      scanning = true;
      scanOnce = true;
      scanCallback = onTag;

      reader.onreading = (event) => {
        const tagId = event.serialNumber || _extractTagId(event.message);
        if (tagId && scanCallback) {
          const cb = scanCallback;
          scanCallback = null;
          scanning = false;
          scanOnce = false;
          cb(tagId);
        }
      };

      return true;
    } catch (err) {
      console.error('NFC one-shot scan failed:', err);
      return false;
    }
  }

  function stopScanning() {
    scanning = false;
    scanCallback = null;
    // NDEFReader has no explicit stop in current spec — GC handles it
    reader = null;
  }

  /** Try to pull an ID from the NDEF message records as fallback */
  function _extractTagId(message) {
    if (!message || !message.records || !message.records.length) return null;
    const rec = message.records[0];
    if (rec.recordType === 'text') {
      const decoder = new TextDecoder();
      return decoder.decode(rec.data);
    }
    // Fallback: hex of first record's raw data
    if (rec.data) {
      return Array.from(new Uint8Array(rec.data))
        .map(b => b.toString(16).padStart(2,'0'))
        .join(':');
    }
    return null;
  }

  return { isSupported, startClockScanning, scanOneTag, stopScanning };

})();
