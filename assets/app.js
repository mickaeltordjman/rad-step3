// assets/app.js
// Fast manifest load, Drive→lh3 rendering, sticky selection, choice gating,
// per-image + total timing, Apps Script submission with no-CORS, optional extra survey row.

// ───────── Utils ─────────
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function msToClock(ms) { const s = Math.floor(ms / 1000), m = Math.floor(s / 60), r = s % 60; return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`; }

// ───────── State ─────────
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
const scrLoad     = document.getElementById("screen-loading");

const startBtn    = document.getElementById("start-btn");
const consentCB   = document.getElementById("consent-checkbox");
const pidInput    = document.getElementById("participant-id");

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

if (imgEl) imgEl.referrerPolicy = "no-referrer";

// Expect these from assets/config.js:
//   FILES_ENDPOINT, SUBMIT_ENDPOINT, LIMIT_IMAGES, KEY_REAL, KEY_SYNTH

// ───────── Start gating ─────────
function updateStartEnabled() {
  startBtn.disabled = !(consentCB.checked && pidInput.value.trim().length > 0);
}
consentCB.addEventListener("change", updateStartEnabled);
pidInput.addEventListener("input", updateStartEnabled);

// ───────── Keyboard ─────────
function bindKeys() {
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const realKey  = (typeof KEY_REAL  === "string" && KEY_REAL)  ? KEY_REAL.toLowerCase()  : "r";
    const synthKey = (typeof KEY_SYNTH === "string" && KEY_SYNTH) ? KEY_SYNTH.toLowerCase() : "f";
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

// ───────── Manifest normalization + Drive → lh3 ─────────
function normalizeList(list) {
  function driveIdFrom(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("drive.google.com")) {
        const id = u.searchParams.get("id");
        if (id) return id;
      }
    } catch(_) {}
    return null;
  }

  return list.map((item, i) => {
    // Allow string entries
    if (typeof item === "string") {
      const id = driveIdFrom(item);
      const url = id ? `https://lh3.googleusercontent.com/d/${id}=w768` : item;
      return { url, name: `img_${i+1}` };
    }
    if (item && typeof item === "object") {
      // {url, name}
      if (item.url) {
        const id = driveIdFrom(item.url);
        const url = id ? `https://lh3.googleusercontent.com/d/${id}=w768` : item.url;
        return { url, name: item.name || item.fileName || `img_${i+1}` };
      }
      // {fileName, embedUrl} (your images.json format)
      if (item.embedUrl) {
        const id = driveIdFrom(item.embedUrl);
        const url = id ? `https://lh3.googleusercontent.com/d/${id}=w768`
                       : String(item.embedUrl).replace("export=view","export=download");
        return { url, name: item.fileName || `img_${i+1}` };
      }
    }
    return { url: "", name: `img_${i+1}` };
  }).filter(it => !!it.url);
}

// ───────── Choice visuals ─────────
function updateChoiceButtons(rec) {
  btnReal.classList.toggle("selected", rec.choice === "Real");
  btnSynth.classList.toggle("selected", rec.choice === "Synthetic");
  btnNext.disabled = !rec.choice; // require a choice to proceed
}

// ───────── Rendering ─────────
function showCurrent() {
  if (!order.length) {
    alert("No images returned. Check your images.json / endpoint.");
    return;
  }
  const idx = order[current];
  const item = images[idx];

  imgEl.src = item.url;
  progressEl.textContent = `Image ${current + 1} / ${order.length}`;

  const rec = perImage[item.name];
  confidenceEl.value = rec.confidence;
  confValEl.textContent = rec.confidence;
  commentEl.value = rec.comment;
  updateChoiceButtons(rec);

  rec.tStart = performance.now();

  // Preload next 2
  for (let k = 1; k <= 2; k++) {
    const j = current + k;
    if (j < order.length) {
      const pre = new Image();
      pre.referrerPolicy = "no-referrer";
      pre.src = images[order[j]].url;
    }
  }
}

// ───────── Interactions ─────────
function choose(label) {
  const idx = order[current], item = images[idx], rec = perImage[item.name];
  rec.choice = label;
  rec.confidence = Number(confidenceEl.value);
  rec.comment = commentEl.value;
  updateChoiceButtons(rec);
}
function next() {
  const idx = order[current], item = images[idx], rec = perImage[item.name];
  if (!rec.choice) { alert("Please choose Real or Synthetic before continuing."); return; }
  endTimingForCurrent();
  if (current < order.length - 1) { current += 1; showCurrent(); } else { finish(); }
}
function prev() {
  endTimingForCurrent();
  if (current > 0) { current -= 1; showCurrent(); }
}

btnReal.addEventListener("click", () => choose("Real"));
btnSynth.addEventListener("click", () => choose("Synthetic"));
btnNext.addEventListener("click", next);
btnPrev.addEventListener("click", prev);
confidenceEl.addEventListener("input", () => { confValEl.textContent = confidenceEl.value; });

// ───────── Start flow ─────────
const CACHE_KEY = "rad_images_v6"; // bump to force-refresh manifest

startBtn.addEventListener("click", async () => {
  participant = pidInput.value.trim();
  scrConsent.classList.add("hidden");
  scrLoad.classList.remove("hidden");

  try {
    let list;
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      list = JSON.parse(cached);
    } else {
      const url = FILES_ENDPOINT + (FILES_ENDPOINT.includes("?") ? "&" : "?") + "ts=" + Date.now();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Manifest HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      list = JSON.parse(text);
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(list));
    }

    images = normalizeList(list);
    if (typeof LIMIT_IMAGES === "number" && LIMIT_IMAGES > 0) {
      images = images.slice(0, LIMIT_IMAGES);
    }

    perImage = {};
    for (const it of images) {
      perImage[it.name] = { choice: null, confidence: 3, comment: "", tStart: null, ms: 0 };
    }

    order = shuffle([...images.keys()]);
  } catch (e) {
    alert("Failed to load image list.\n" + e);
    console.error("List load error:", e);
    return;
  }

  tStudyStart = performance.now();
  scrLoad.classList.add("hidden");
  scrTask.classList.remove("hidden");
  bindKeys();
  showCurrent();
  startTick();
});

// ───────── Submit to Apps Script (Drive CSV appender) ─────────
async function finish() {
  stopTick();
  totalMs = performance.now() - tStudyStart;

  // Build responses array in the order seen by the participant
  const responses = order.map((ordIdx) => {
    const item = images[ordIdx];
    const rec  = perImage[item.name] || {};
    return {
      imageID: item.name,
      response: rec.choice || "",
      confidence: rec.confidence ?? "",
      comment: rec.comment || "",
      timing: Math.round(rec.ms)
    };
  });


  const payload = { userID: participant, responses };

  // Send in a way that avoids CORS preflight (Apps Script-friendly)
  try {
    await fetch(SUBMIT_ENDPOINT, {
      method: "POST",
      mode: "no-cors",                         // opaque response; server still receives it
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.warn("Drive save failed", e);
    alert("We couldn't save to Drive. Please try again or contact the study admin.");
  }

  // Done screen
  const rowsCount = responses.length - 1; // exclude the Extra row in the visible count
  scrTask.classList.add("hidden");
  scrFinish.classList.remove("hidden");
  summaryEl.textContent = `Total time: ${msToClock(totalMs)} across ${rowsCount} images.`;
  payloadPreview.textContent = JSON.stringify(payload, null, 2);
}
