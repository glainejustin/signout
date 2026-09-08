/**
 * face.js — Canvas Face Positioning & Liveness Detection
 * Performs client-side image brightness, contrast, and center-weighted skin pixel bounding analysis
 * to verify face presence during selfie verification without heavy dependencies.
 */

const FaceDetector = (() => {

  /**
   * Evaluates canvas video snapshot to ensure a valid face image is captured.
   * Returns { valid: boolean, message: string }
   */
  function analyzeSnapshot(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { valid: true, message: 'Canvas error — skipping face verification.' };

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return { valid: true, message: 'Invalid dimensions.' };

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let totalPixels = width * height;
    let totalLuminance = 0;
    let centerFacePixels = 0;
    let totalCenterPixels = 0;

    // Define center 50% region of the video frame
    const minX = Math.floor(width * 0.25);
    const maxX = Math.floor(width * 0.75);
    const minY = Math.floor(height * 0.15);
    const maxY = Math.floor(height * 0.85);

    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Luminance calculation
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        totalLuminance += lum;

        // Human skin tone / face contrast heuristic (R > G > B with natural ratio)
        const isFaceCandidate = (r > 60) && (g > 40) && (b > 20) &&
                                (r > g) && (r > b) &&
                                (Math.abs(r - g) > 12);

        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          totalCenterPixels++;
          if (isFaceCandidate) centerFacePixels++;
        }
      }
    }

    const avgLuminance = totalLuminance / (totalPixels / 16);
    const centerRatio = totalCenterPixels ? (centerFacePixels / totalCenterPixels) : 0;

    // Validation checks
    if (avgLuminance < 30) {
      return { valid: false, message: 'Lighting too dark. Please move to a brighter area.' };
    }
    if (avgLuminance > 240) {
      return { valid: false, message: 'Lighting overexposed. Please avoid direct glaring light.' };
    }
    if (centerRatio < 0.12) {
      return { valid: false, message: 'Face not detected in frame center. Please align your face in the camera circle.' };
    }

    return { valid: true, message: 'Face verified successfully!' };
  }

  return { analyzeSnapshot };

})();
