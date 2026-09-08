# WorkTap — NFC Worker Attendance System
## Complete Setup Guide

---

## What You Get

- **NFC tap-to-clock** — workers tap a tag to sign in or out
- **Auto timestamp** — exact date and time recorded every tap
- **20 workers pre-loaded** — edit names/roles in the Workers page
- **Admin dashboard** — PIN-protected, shows stats and full log table
- **CSV export** — download all records as a spreadsheet
- **Google Sheets sync** — push logs straight to a Google Sheet
- **Works offline** — installs on the phone as an app (PWA)

---

## Files in This Project

```
SignInOut/
├── index.html              ← Main app
├── manifest.json           ← PWA install config
├── service-worker.js       ← Offline caching
├── google-apps-script.js   ← Paste into Google Apps Script
├── css/
│   └── styles.css
├── js/
│   ├── db.js               ← Local storage database
│   ├── nfc.js              ← Web NFC API handler
│   ├── workers.js          ← Worker management UI
│   ├── logs.js             ← Log table rendering
│   ├── admin.js            ← Admin dashboard
│   └── app.js              ← Main controller
└── icons/
    ├── icon-192.png        ← Add your own logo (192×192 px)
    └── icon-512.png        ← Add your own logo (512×512 px)
```

---

## Step 1 — Host the App (Required for NFC)

Web NFC only works when served over **HTTPS**. Pick one free option:

### Option A — GitHub Pages (Free, Recommended)
1. Create a free account at [github.com](https://github.com)
2. Create a new repository (e.g. `worktap`)
3. Upload all files in this project to the repo
4. Go to **Settings → Pages → Source → main branch → / (root)**
5. Your URL will be: `https://yourusername.github.io/worktap/`

### Option B — Netlify (Drag & Drop, Free)
1. Go to [netlify.com](https://netlify.com) and sign up free
2. Drag the entire `SignInOut` folder onto the Netlify deploy area
3. You get a live HTTPS URL instantly

### Option C — Local Network (Android only, no internet needed)
1. Install **Node.js** on your computer
2. Run: `npx serve d:\SignInOut --ssl`
3. Open the HTTPS URL on any phone on the same WiFi

---

## Step 2 — Open on the Worker Phone

1. Open **Chrome** on an Android phone
2. Navigate to your hosted URL
3. Tap the **"Add to Home Screen"** prompt (or Menu → Add to Home Screen)
4. The app installs like a native app — works offline after first load

> ⚠️ **NFC requires Android + Chrome**. iPhone has limited Web NFC support.

---

## Step 3 — Assign NFC Tags to Workers

1. Buy **NTAG213 NFC stickers** (AliExpress ~$3 for 10 pcs)
2. Stick one tag per worker on their badge or ID card
3. In WorkTap, tap **👷 Workers → select a worker → ✏️ Edit**
4. Tap **"Scan NFC Tag"** and hold the tag near the phone
5. The tag ID is auto-filled — tap **Save Worker**

> Alternatively, you can assign a single shared tag to each **location** (e.g. IN door, OUT door) and workers use the manual selector — cheapest option.

---

## Step 4 — Daily Use

**With NFC tags assigned to each worker:**
- Worker holds their phone/badge near the NFC tag
- App shows ✅ Clocked IN or 👋 Clocked OUT with exact time
- Status automatically toggles (first tap = IN, next tap = OUT)

**Without NFC (manual fallback):**
- Select worker name from the dropdown
- Tap **Clock IN** or **Clock OUT**

---

## Step 5 — Admin Dashboard

1. Tap **⚙ Admin** on the home screen
2. Default PIN: **1234** (change this in `db.js` → `seedIfEmpty` or via localStorage)
3. View stats, filter by worker or date, export CSV

### Change the Admin PIN
Open the browser console on the app and run:
```javascript
DB.saveSettings({ adminPin: '9876' });
```
Replace `9876` with your desired PIN.

---

## Step 6 — Google Sheets Sync (Optional)

1. Open [Google Sheets](https://sheets.google.com) → create a new spreadsheet
2. Go to **Extensions → Apps Script**
3. Delete all default code
4. Open `google-apps-script.js` from this project and **copy the entire contents**
5. Paste into the Apps Script editor
6. Click **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy** → Copy the **Web App URL**
8. In WorkTap → Admin → Sheets Sync → paste the URL → tap **Sync Now**

Logs are pushed to 3 tabs automatically:
- **Attendance Logs** — every tap with timestamp
- **Daily Summary** — total hours per worker per day
- **Workers** — worker roster

---

## NFC Hardware Shopping List

| Item | Qty | Est. Cost | Where to Buy |
|------|-----|-----------|--------------|
| NTAG213 NFC stickers | 25 pack | ~$4 | AliExpress / Amazon |
| Badge holders (optional) | 20 | ~$3 | Any office store |
| **Total** | | **~$7** | |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| NFC doesn't scan | Make sure Chrome is open, NFC is on in Android settings |
| "Unknown tag" message | Go to Workers, edit the worker, scan their tag to assign it |
| App doesn't install | Must be served over HTTPS |
| Sheets sync fails | Check the Web App URL is correct and deployed as "Anyone" |
| Forgot admin PIN | Open browser console: `DB.saveSettings({ adminPin: '1234' })` |
| Need to clear all data | Open browser console: `localStorage.clear(); location.reload();` |

---

## Tips for 20 Workers

- Use **two NFC tags** per entrance — one green (IN), one red (OUT) — workers tap the matching tag so there's zero confusion
- If workers use their **own phones**, each person opens the app and taps the shared entrance tag
- If using **one shared phone** at the entrance, the manual dropdown is the easiest fallback
- Export CSV every Friday to keep a weekly backup

---

*WorkTap v1.0 — Built with Web NFC API + PWA*
