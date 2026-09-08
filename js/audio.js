/**
 * audio.js — Web Audio API Synthesizer
 * Zero external audio files required. Uses Web Audio API for tactile feedback.
 */

const AudioFX = (() => {
  let ctx = null;
  let enabled = true;

  function _getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function setEnabled(val) {
    enabled = !!val;
  }

  function isEnabled() {
    return enabled;
  }

  /**
   * Rising 2-note chime for successful actions (clock in, clock out, pin ok)
   */
  function playSuccess() {
    if (!enabled) return;
    const c = _getCtx();
    if (!c) return;

    try {
      const now = c.currentTime;
      // Note 1: E5 (659.25Hz)
      const osc1 = c.createOscillator();
      const gain1 = c.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(c.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Note 2: B5 (987.77Hz)
      const osc2 = c.createOscillator();
      const gain2 = c.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, now + 0.1);
      gain2.gain.setValueAtTime(0.2, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(c.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.35);
    } catch (e) {
      console.warn('Audio FX error:', e);
    }
  }

  /**
   * Low double buzz sound for failed PIN or geofence blocked
   */
  function playError() {
    if (!enabled) return;
    const c = _getCtx();
    if (!c) return;

    try {
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.setValueAtTime(110, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {
      console.warn('Audio FX error:', e);
    }
  }

  /**
   * Soft tactile click for keypads and buttons
   */
  function playClick() {
    if (!enabled) return;
    const c = _getCtx();
    if (!c) return;

    try {
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch (e) {
      console.warn('Audio FX error:', e);
    }
  }

  /**
   * Alert tone for break start / finish
   */
  function playAlert() {
    if (!enabled) return;
    const c = _getCtx();
    if (!c) return;

    try {
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(783.99, now + 0.12); // G5
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) {
      console.warn('Audio FX error:', e);
    }
  }

  return {
    setEnabled,
    isEnabled,
    playSuccess,
    playError,
    playClick,
    playAlert
  };
})();
