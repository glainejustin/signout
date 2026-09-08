/**
 * selfie.js — Camera capture for clock-in verification
 * Opens front camera, shows preview, captures photo on confirm.
 */

const Selfie = (() => {

  let stream = null;

  /** 
   * Show selfie modal, capture photo.
   * Returns Promise<string|null> — base64 dataURL or null if skipped/cancelled.
   */
  function capture() {
    return new Promise((resolve) => {
      const modal   = document.getElementById('selfieModal');
      const video   = document.getElementById('selfieVideo');
      const snapBtn = document.getElementById('selfieSnap');
      const skipBtn = document.getElementById('selfieSkip');
      const canvas  = document.getElementById('selfieCanvas');
      const preview = document.getElementById('selfiePreview');
      const confirmBtn = document.getElementById('selfieConfirm');
      const retakeBtn  = document.getElementById('selfieRetake');

      // Reset state
      video.classList.remove('hidden');
      canvas.classList.add('hidden');
      preview.classList.add('hidden');
      document.getElementById('selfieSnapRow').classList.remove('hidden');
      document.getElementById('selfieConfirmRow').classList.add('hidden');
      modal.classList.remove('hidden');

      // Start camera
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        .then(s => {
          stream = s;
          video.srcObject = s;
          video.play();
        })
        .catch(() => {
          _close(modal);
          resolve(null); // Camera unavailable — skip silently
        });

      // Snap photo
      snapBtn.onclick = () => {
        const ctx = canvas.getContext('2d');
        canvas.width  = video.videoWidth  || 320;
        canvas.height = video.videoHeight || 240;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        preview.src = dataUrl;
        video.classList.add('hidden');
        canvas.classList.add('hidden');
        preview.classList.remove('hidden');
        document.getElementById('selfieSnapRow').classList.add('hidden');
        document.getElementById('selfieConfirmRow').classList.remove('hidden');
      };

      // Confirm
      confirmBtn.onclick = () => {
        const dataUrl = preview.src;
        _close(modal);
        resolve(dataUrl);
      };

      // Retake
      retakeBtn.onclick = () => {
        preview.classList.add('hidden');
        video.classList.remove('hidden');
        document.getElementById('selfieSnapRow').classList.remove('hidden');
        document.getElementById('selfieConfirmRow').classList.add('hidden');
      };

      // Skip
      skipBtn.onclick = () => {
        _close(modal);
        resolve(null);
      };
    });
  }

  function _close(modal) {
    modal.classList.add('hidden');
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  return { capture, isSupported };

})();
