/**
 * gps.js — GPS geofence check
 * Verifies worker is physically at the workplace before allowing clock-in/out.
 */

const GPS = (() => {

  /**
   * Get current position as a Promise.
   * Resolves { lat, lng } or rejects with an error message string.
   */
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject('GPS not supported on this device.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => {
          switch (err.code) {
            case err.PERMISSION_DENIED:
              reject('Location permission denied. Please allow location access and try again.');
              break;
            case err.POSITION_UNAVAILABLE:
              reject('Location unavailable. Make sure GPS is turned on.');
              break;
            case err.TIMEOUT:
              reject('Location timed out. Please try again.');
              break;
            default:
              reject('Could not get location. Try again.');
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  /**
   * Calculate distance between two coordinates using the Haversine formula.
   * Returns distance in meters.
   */
  function distanceMeters(lat1, lng1, lat2, lng2) {
    const R    = 6371000; // Earth radius in meters
    const dLat = _toRad(lat2 - lat1);
    const dLng = _toRad(lng2 - lng1);
    const a    =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function _toRad(deg) { return deg * (Math.PI / 180); }

  /**
   * Main check: get current location and compare against workplace.
   *
   * Returns:
   *   { allowed: true,  distance }
   *   { allowed: false, distance, reason }
   *   { allowed: false, reason: 'gps_error', message }
   */
  async function checkGeofence() {
    const settings = DB.getSettings();

    // If GPS lock not configured, allow through
    if (!settings.gpsEnabled) return { allowed: true };

    const workLat    = parseFloat(settings.workplaceLat);
    const workLng    = parseFloat(settings.workplaceLng);
    const radiusM    = parseFloat(settings.workplaceRadius) || 100;

    if (isNaN(workLat) || isNaN(workLng)) {
      // Not configured — allow through but warn
      console.warn('GPS lock enabled but coordinates not set.');
      return { allowed: true };
    }

    try {
      const pos      = await getCurrentPosition();
      const distance = Math.round(distanceMeters(pos.lat, pos.lng, workLat, workLng));

      if (distance <= radiusM) {
        return { allowed: true, distance };
      } else {
        return {
          allowed:  false,
          distance,
          reason:   'outside',
          message:  `You are ${distance}m away from the workplace. You must be within ${radiusM}m to clock in/out.`,
        };
      }
    } catch (errMsg) {
      return { allowed: false, reason: 'gps_error', message: errMsg };
    }
  }

  /**
   * Capture current location and return it — used for setting workplace coords.
   */
  async function captureWorkplaceLocation() {
    return await getCurrentPosition();
  }

  return { checkGeofence, captureWorkplaceLocation, distanceMeters };

})();
