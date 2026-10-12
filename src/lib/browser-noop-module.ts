/**
 * Empty browser replacement for optional Node-only imports in the OpenCV
 * dependency used by the Paddle-based OCR package. Browser inference uses
 * canvas/ImageData and never reads the local filesystem.
 */
export const unavailable = true;
export default {};
