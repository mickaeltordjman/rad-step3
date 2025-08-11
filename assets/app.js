// Utility: shuffle array (Fisher-Yates)
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Global state
let images = [];           // [{url, name}...]
let order = [];            // shuffled indices
let current = 0;           // index within order[]
let perImage = {};         // key: name/url, value: {isReal, confidence, comment, tStart, tEnd, ms}
let participant = null;
let tStudyStart = null;
let totalMs = 0;
let tickInterval = null;

// Elements
const scrConsent = document.getElementById("screen-consent");
const scrTask = document.getElementById("screen-task");
const scrFinish = document.getElementById("screen-finish");
const scrLoading = document.getElementById("screen-loading");

const startBtn = document.getElementById("start-btn");
const consentCheckbox = document.getElementById("consent-checkbox");
const participantInput = document.getElementById("participant-id");

const imgEl = document.getElementById("rad-img");
const progressEl = document.getElementById("progress");
const timerEl = document.getElementById("timer");

const btnReal = document.getElementById("btn-real");
const btnSynth = document.getElementById("btn-synth");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");

const confidenceEl = document.getElementById("confidence");
const confValEl = document.getElementById("conf-val");
const commentEl = document.getElementById("comment");

const payloadPreview = document.getElementById("payload-preview");
const summaryEl = document.getElementById("summary");

consentCheckbox.addEventListener("change", () => {
  startBtn.disabled = !(consentCheckbox.checked && participantInput.value.trim().length > 0);
});
participantInput.addEventListener("input", () => {
  startBtn.disabled = !(consentCheckbox.checked && participantInput.value.trim().length > 0);
});

startBtn.addEventListener("click", async () => {
  participant = participantInput.value.trim();
  scrConsent.classList.add("hidden");
  scrLoading.classList.remove("hidden");

  try {
    const res = await fetch(FILES_ENDPOINT);
    const list = await res.json(); // expects [{url, name}] or ["https://...","..."]
    images = list.map((item, idx) => {
      if (typeof item === "string") return { url: item, name: `img_${idx+1}` };
      return { url: item.url, name: item.name || `img_${idx+1}` };
    });
    if (LIMIT_IMAGES) images = images.slice(0, LIMIT_IMAGES);
    order = shuffle([...images.keys()]);
  } catch (e) {
    alert("Failed to load image list. Please check FILES_ENDPOINT in config.js");
    console.error(e);
    return;
  }

  // Initialize per-image store
  for (const it of images) {
    perImage[it.name] = { choice: null, confidence: 3, comment: "", tStart: null, tEnd: null, ms: 0 };
  }

  // Ready
  tStudyStart = performance.now();
  scrLoading.classList.add("hidden");
  scrTask.classList.remove("hidden");
  bindKeys();
  showCurrent();
  startTick();
});

function startTick() {
  tickInterval = setInterval(() => {
    const elapsedMs = performance.now() - tStudyStart;
    timerEl.textContent = msToClock(elapsedMs);
  }, 200);
}
function stopTick() { if (tickInterval) clearInterval(tickInterval); }

function msToClock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
}

function bindKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === KEY_REAL) choose("Real");
    if (e.key.toLowerCase() === KEY_SYNTH) choose("Synthetic");
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
  });
}

function showCurrent() {
  const idx = order[current];
  const item = images[idx];
  imgEl.src = item.url + (item.url.includes("?") ? "&" : "?") + "_ts=" + Date.now(); // bust cache
  progressEl.textContent = `Image ${current+1} / ${order.length}`;

  // restore UI
  const rec = perImage[item.name];
  confidenceEl.value = rec.confidence;
  confValEl.textContent = rec.confidence;
  commentEl.value = rec.comment;

  // start timer for this image
  rec.tStart = performance.now();
}

confidenceEl.addEventListener("input", () => {
  confValEl.textContent = confidenceEl.value;
});

btnReal.addEventListener("click", () => choose("Real"));
btnSynth.addEventListener("click", () => choose("Synthetic"));
btnNext.addEventListener("click", next);
btnPrev.addEventListener("click", prev);

function choose(label) {
  const idx = order[current];
  const item = images[idx];
  const rec = perImage[item.name];
  rec.choice = label;
  rec.confidence = Number(confidenceEl.value);
  rec.comment = commentEl.value;
}

function next() {
  endTimingForCurrent();
  if (current < order.length - 1) {
    current += 1;
    showCurrent();
  } else {
    finish();
  }
}
function prev() {
  endTimingForCurrent();
  if (current > 0) {
    current -= 1;
    showCurrent();
  }
}
function endTimingForCurrent() {
  const idx = order[current];
  const item = images[idx];
  const rec = perImage[item.name];
  if (rec.tStart != null) {
    rec.tEnd = performance.now();
    rec.ms += (rec.tEnd - rec.tStart);
    rec.tStart = null;
  }
}

async function finish() {
  stopTick();
  const tEnd = performance.now();
  totalMs = tEnd - tStudyStart;

  // Build payload
  const rows = order.map((ordIdx, rank) => {
    const item = images[ordIdx];
    const rec = perImage[item.name];
    return {
      participant,
      display_rank: rank+1,
      image_name: item.name,
      image_url: item.url,
      choice: rec.choice,
      confidence: rec.confidence,
      comment: rec.comment,
      time_ms: Math.round(rec.ms),
      total_ms: Math.round(totalMs),
      timestamp: new Date().toISOString()
    };
  });

  try {
    const res = await fetch(SUBMIT_ENDPOINT, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ participant, total_ms: Math.round(totalMs), n: order.length, rows })
    });
    if (!res.ok) throw new Error("Submit failed");
  } catch (e) {
    alert("Submission failed. Please check SUBMIT_ENDPOINT in config.js");
    console.error(e);
    return;
  }

  // Show finish screen
  scrTask.classList.add("hidden");
  scrFinish.classList.remove("hidden");
  summaryEl.textContent = `Total time: ${msToClock(totalMs)} across ${order.length} images.`;
  payloadPreview.textContent = JSON.stringify({ participant, total_ms: Math.round(totalMs), n: order.length, rows }, null, 2);
}
