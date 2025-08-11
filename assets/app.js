// assets/app.js
// Complete drop-in script with: fast local manifest load, sticky selection,
// Next gated until a choice, per-image timing, keyboard shortcuts, and submission.

// ───────── Utils ─────────
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
function msToClock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

// ───────── Global state ─────────
let images = [];           // [{url, name}]
let order = [];            // shuffled indices
let current = 0;           // index within order[]
let perImage = {};         // name -> {choice, confidence, comment, tStart, ms}
let participant = null;
let tStudyStart = null;
let totalMs = 0;
let tickInterval = null;

// ───────── DOM ─────────
const scrConsent  = document.getElementById("screen-consent");
const scrTask     = document.getElementById("screen-task");
const scrFinish   = document.getElementById("screen-finish");
const scrLoading  = document.getElementById("screen-loading");

const startBtn    = document.getElementById("start-btn");
const consentCB   = document.getElementById("consent-checkbox");
const participantInput = document.getElementById("participant-id");

const imgEl       = document.getElementById("rad-img");
const progressEl  = document.getElementById("progress");
const timerEl     = document.getElementById("timer");

const btnReal     = document.getElementById("btn-real");
const btnSynth    = document.getElementById("btn-synth");
const btnPrev     = document.getElementById("btn-prev");
const btnNext     = document.getElementById("btn-next");

const confidenceEl= document.getElementById("confidence");
const confValEl   = document.getElementById("conf-val");
const commentEl   = document.getElementById("comment");

const payloadPreview = document.getElementById("payload-preview");
const summaryEl      = document.getElementById("summary");

// Helpful default to reduce odd referrer issues with some CDNs
if (imgEl) imgEl.referrerPolicy = "no-referrer";

// ───────── Config from assets/config.js ─────────
// Expected globals: FILES_ENDPOINT, SUBMIT_ENDPOINT, LIMIT_IMAGES, KEY_REAL, KEY_SYNTH

// ───────── Enable Start only with consent + participant id ─────────
function updateStartEnabled() {
  startBtn.disabled = !(consentCB.checked && participantInput.value.trim().length > 0);
}
consentCB.addEventListener("change", updateStartEnabled);
participantInput.addEventListener("input", updateStartEnabled);

// ───────── Visual state for choice & gating Next ─────────
function updateChoiceButtons(rec) {
  btnReal.classList.toggle("selected", rec.choice === "Real");
  btnSynth.classList.toggle("selected", rec.choice === "Synthetic");
  btnNext.disabled = !rec.choice; // block Next until a choice exists
}

// ───────── Keyboard shortcuts ─────────
function bindKeys() {
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const realKey  = (typeof KEY_REAL  === "string" && KEY_REAL.length)  ? KEY_REAL.toLowerCase()  : "r";
    const synthKey = (typeof KEY_SYNTH === "string" && KEY_SYNTH.length) ? KEY_SYNTH.toLowerCase() : "f";
    if (k === realKey)  choose("Real");
    if (k === synthKey) choose("Synthetic");
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft")  prev();
  });
}

// ───────── Timers ─────────
function startTick() {
  tickInterval = setInterval(() => {
    const ms = performance.now() - tStudyStart;
    timerEl.textContent = msToClock(ms);
  }, 200);
}
function stopTick() { if (tickInterval) clearInterval(tickInterval); }

function endTimingForCurrent() {
  const idx = order[current];
  const item = images[idx];
  const rec = perImage[item.name];
  if (rec && rec.tStart != null) {
    rec.ms += (performance.now() - rec.tStart);
    rec.tStart = null;
  }
}

// ───────── Manifest normalization ─────────
// Supports multiple schemas: 
// 1) {url, name} 
// 2) {fileName, embedUrl} (your old project style)
// 3) "https://…/image.png" (string)
function normalizeList(list) {
  function driveIdFrom(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("drive.google.com")) {
        // handles .../uc?export=...&id=FILE_ID
        const id = u.searchParams.get("id");
        if (id) return id;
      }
    } catch (_) {}
    return null;
  }

  return list.map((item, i) => {
    if (typeof item === "string") {
      const id = driveIdFrom(item);
      const url = id ? `https://lh3.googleusercontent.com/d/${id}=w768` : item;
      return { url, name: `img_${i+1}` };
    }
    if (item && typeof item === "object") {
      // support {url,name}
      if (item.url) {
        const id = driveIdFrom(item.url);
        const url = id ? `https://lh3.googleusercontent.com/d/${id}=w768` : item.url;
        return { url, name: item.name || item.fileName || `img_${i+1}` };
      }
      // support {fileName, embedUrl} (your images.json format)
      if (item.embedUrl) {
        const id = driveIdFrom(item.embedUrl);
        const url = id ? `https://lh3.googleusercontent.com/d/${id}=w768`
                       : item.embedUrl.replace("export=view", "export=download");
        return { url, name: item.fileName || `img_${i+1}` };
      }
    }
    return { url: "", name: `img_${i+1}` };
  }).filter(it => it.url);
}

// ───────── Show current image ─────────
function showCurrent() {
  if (!order.length) {
    alert("No images returned. Check your images.json / endpoint.");
    return;
  }
  const idx = order[current];
  const item = images[idx];

  // Show current image (allow caching for speed)
  imgEl.src = item.url;
  progressEl.textContent = `Image ${current + 1} / ${order.length}`;

  // Restore UI state
  const rec = perImage[item.name];
  confidenceEl.value = rec.confidence;
  confValEl.textContent = rec.confidence;
  commentEl.value = rec.comment;
  updateChoiceButtons(rec);

  // Start timing when this image is displayed
  rec.tStart = performance.now();

  // Preload next 2 images to speed up navigation
  for (let k = 1; k <= 2; k++) {
    const j = current + k;
    if (j < order.length) {
      const pre = new Image();
      pre.referrerPolicy = "no-referrer";
      pre.src = images[order[j]].url;
    }
  }
}

// ───────── Choice & navigation ─────────
function choose(label) {
  const idx = order[current];
  const item = images[idx];
  const rec = perImage[item.name];
  rec.choice = label;
  rec.confidence = Number(confidenceEl.value);
  rec.comment = commentEl.value;
  updateChoiceButtons(rec); // make selection sticky + enable Next
}

function next() {
  const idx = order[current];
  const item = images[idx];
  const rec = perImage[item.name];
  if (!rec.choice) {
    alert("Please choose Real or Synthetic before continuing.");
    return;
  }
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

// ───────── Submit ─────────
async function finish() {
  stopTick();
  totalMs = performance.now() - tStudyStart;

  const rows = order.map((ordIdx, rank) => {
    const item = images[ordIdx];
    const rec = perImage[item.name];
    return {
      participant,
      display_rank: rank + 1,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant, total_ms: Math.round(totalMs), n: order.length, rows })
    });
    if (!res.ok) throw new Error("Submit failed: " + res.status);
  } catch (e) {
    alert("Submission failed. Please check the SUBMIT endpoint.\n" + e);
    console.error("Submit error:", e);
    return;
  }

  // Done screen
  scrTask.classList.add("hidden");
  scrFinish.classList.remove("hidden");
  summaryEl.textContent = `Total time: ${msToClock(totalMs)} across ${order.length} images.`;
  payloadPreview.textContent = JSON.stringify({ participant, total_ms: Math.round(totalMs), n: order.length, rows }, null, 2);
}

// ───────── Events ─────────
btnReal.addEventListener("click", () => choose("Real"));
btnSynth.addEventListener("click", () => choose("Synthetic"));
btnNext.addEventListener("click", next);
btnPrev.addEventListener("click", prev);

confidenceEl.addEventListener("input", () => {
  confValEl.textContent = confidenceEl.value;
  // Do NOT clear choice when moving the slider
});

// ───────── Start flow ─────────
const CACHE_KEY = "rad_images_v3"; // bump to force-refresh manifest if needed

startBtn.addEventListener("click", async () => {
  participant = participantInput.value.trim();
  scrConsent.classList.add("hidden");
  scrLoading.classList.remove("hidden");

  try {
    // Session cache for the manifest (fast reloads; avoids cold starts if FILES_ENDPOINT is a web app)
    let list;
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      list = JSON.parse(cached);
    } else {
      // Add ts param to avoid stale caching of the manifest only
      const url = FILES_ENDPOINT + (FILES_ENDPOINT.includes("?") ? "&" : "?") + "ts=" + Date.now();
      const res  = await fetch(url, { cache: "no-store" });
      const text = await res.text();     // robust to wrong MIME
      list = JSON.parse(text);           // throws if malformed -> caught below
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(list));
    }

    // Normalize to {url, name}
    images = normalizeList(list);

    // Optional cap from config.js
    if (typeof LIMIT_IMAGES === "number" && LIMIT_IMAGES > 0) {
      images = images.slice(0, LIMIT_IMAGES);
    }

    // Build per-image store
    perImage = {};
    for (const it of images) {
      perImage[it.name] = { choice: null, confidence: 3, comment: "", tStart: null, ms: 0 };
    }

    // Shuffle order
    order = shuffle([...images.keys()]);
  } catch (e) {
    alert("Failed to load image list.\n" + e);
    console.error("List load error:", e);
    return;
  }

  // Ready -> show task
  tStudyStart = performance.now();
  scrLoading.classList.add("hidden");
  scrTask.classList.remove("hidden");
  bindKeys();
  showCurrent();
  startTick();
});
