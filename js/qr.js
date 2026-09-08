/**
 * qr.js — QR code scanning as NFC backup
 * Uses the device camera to scan a QR code containing a worker/location ID.
 * Falls back gracefully when BarcodeDetector is unavailable.
 */

const QR = (() => {

  let scanStream   = null;
  let scanInterval = null;
  let onScan       = null;   // callback(tagId)

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function hasBarcodeDetector() {
    return 'BarcodeDetector' in window;
  }

  /** Start QR scanner. Calls onTagFound(id) when a QR is read. */
  async function startScanner(onTagFound) {
    onScan = onTagFound;
    const modal = document.getElementById('qrModal');
    const video = document.getElementById('qrVideo');
    modal.classList.remove('hidden');

    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      });
      video.srcObject = scanStream;
      await video.play();

      if (hasBarcodeDetector()) {
        _startBarcodeDetector(video);
      } else {
        // Fallback: show manual entry
        document.getElementById('qrManualEntry').classList.remove('hidden');
      }
    } catch (e) {
      stopScanner();
      App.showToast('Camera unavailable for QR scan.');
    }
  }

  function _startBarcodeDetector(video) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    scanInterval = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          const id = codes[0].rawValue;
          stopScanner();
          if (onScan) onScan(id);
        }
      } catch { /* ignore frame errors */ }
    }, 300);
  }

  function stopScanner() {
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    if (scanStream)   { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    document.getElementById('qrModal').classList.add('hidden');
    document.getElementById('qrManualEntry').classList.add('hidden');
  }

  /** Generate a QR code data URL for a given worker ID using a CDN library */
  function getQRDataUrl(text, size) {
    // Uses the free QR Server API — works offline if cached
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  }

  return { isSupported, hasBarcodeDetector, startScanner, stopScanner, getQRDataUrl };

})();
