// === Configure these two URLs after you deploy your Apps Script ===
// 1) FILES_ENDPOINT: returns JSON list of public image URLs for a Drive folder
// 2) SUBMIT_ENDPOINT: receives POSTed JSON payload and writes to Google Sheets

const FILES_ENDPOINT = "PASTE_YOUR_FILES_ENDPOINT_URL_HERE";
const SUBMIT_ENDPOINT = "PASTE_YOUR_SUBMIT_ENDPOINT_URL_HERE";

// Optional: limit number of images for pilot runs (set to null for all)
const LIMIT_IMAGES = null;

// Keyboard shortcuts
const KEY_REAL = "r";
const KEY_SYNTH = "f";
