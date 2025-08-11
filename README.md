# Radiograph Authenticity Study (Static Site)

This folder contains a **static HTML/JS** study app you can deploy on **GitHub Pages**.  
It loads an image list from a **Google Apps Script** endpoint, randomizes them per participant, records **per-image time** and **total time**, and submits results to **Google Sheets** via another Apps Script endpoint.

---

## 1) Deploy the Apps Script (file lister + sheet logger)

Open **script.google.com** → New project → paste the code below into `Code.gs`.  
Set the constants at the top:

```js
// ======== EDIT THESE ========
const DRIVE_FOLDER_ID = "1qbu59Axl6Q-PczHM__UIj3Hp_AbjLHM8"; // your Drive folder ID
const SHEET_ID = "PUT_YOUR_GOOGLE_SHEET_ID_HERE";             // create a Google Sheet and paste its ID
// ============================
```

### Code.gs (single file handles both endpoints)
```javascript
// ======== EDIT THESE ========
const DRIVE_FOLDER_ID = "1qbu59Axl6Q-PczHM__UIj3Hp_AbjLHM8"; // your Drive folder ID
const SHEET_ID = "PUT_YOUR_GOOGLE_SHEET_ID_HERE";             // Google Sheet ID for logging
// ============================

/**
 * Publish two endpoints with doGet/doPost:
 * - GET:  ?fn=list   => returns JSON array of public image URLs
 * - POST: body rows  => appends to Google Sheet
 *
 * Deploy: "Deploy" -> "New Deployment" -> Type: Web app
 * Who has access: Anyone with the link
 */

function doGet(e) { 
  const fn = (e.parameter.fn || "").toLowerCase();
  if (fn === "list") return listImages_();
  return ContentService.createTextOutput(JSON.stringify({error:"unknown fn"}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const rows = data.rows || [];
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sh = ss.getSheetByName("Responses") || ss.insertSheet("Responses");
    if (sh.getLastRow() === 0) {
      sh.appendRow([
        "timestamp", "participant", "total_ms", "n",
        "display_rank", "image_name", "image_url", "choice", "confidence", "comment", "time_ms"
      ]);
    }
    const ts = new Date();
    const batch = rows.map(r => [
      ts, r.participant, data.total_ms, data.n,
      r.display_rank, r.image_name, r.image_url, r.choice, r.confidence, r.comment, r.time_ms
    ]);
    if (batch.length) sh.getRange(sh.getLastRow()+1,1,batch.length,batch[0].length).setValues(batch);
    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

function listImages_() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  const urls = [];
  while (files.hasNext()) {
    const f = files.next();
    // Ensure the file is shared readable by anyone with the link
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
    const id = f.getId();
    // Direct-view URL works for <img>:
    const url = "https://drive.google.com/uc?export=view&id=" + id;
    urls.push({url, name: f.getName()});
  }
  return ContentService
    .createTextOutput(JSON.stringify(urls))
    .setMimeType(ContentService.MimeType.JSON);
}
```

After pasting the code:
1. Click **Deploy → New deployment → Web app**.
2. Set access: **Anyone with the link**.
3. Copy the **web app URL**, which will look like:
   `https://script.google.com/macros/s/AKfycbx.../exec`

- Your **FILES_ENDPOINT** is: `WEB_APP_URL?fn=list`
- Your **SUBMIT_ENDPOINT** is simply the **WEB_APP_URL** (POST).

---

## 2) Configure the static site

Edit `assets/config.js` and set:
```javascript
const FILES_ENDPOINT = "https://script.google.com/macros/s/AKfycbx.../exec?fn=list";
const SUBMIT_ENDPOINT = "https://script.google.com/macros/s/AKfycbx.../exec";
```

Optionally set `LIMIT_IMAGES` for a pilot run.

---

## 3) Deploy on GitHub Pages

1. Create a new GitHub repo and upload the contents of this folder.
2. Commit and push.
3. In repo **Settings → Pages**, set:
   - Source: `Deploy from a branch`
   - Branch: `main` (or `gh-pages`) / root
4. Your study page will be live at `https://<username>.github.io/<repo>/`.

Share that link with participants.

---

## 4) Results in Google Sheets

Open the Sheet whose ID you used. The script appends rows to a tab called **"Responses"** with:
- timestamp, participant, total_ms, n
- display_rank, image_name, image_url, choice, confidence, comment, time_ms

---

## Notes

- Keyboard shortcuts: **R** = Real, **F** = Synthetic, arrows to navigate.
- Images are shown one-by-one; timing is per-image (pause-safe between images).
- Caching is busted by query parameter to avoid stale loads.
- The Drive lister sets sharing to **Anyone with the link** automatically.
