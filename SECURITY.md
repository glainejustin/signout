# 🔒 Security Policy & Threat Model — SignOut

> **Version:** 1.0 — Last updated 2026-09-08  
> **Scope:** `index.html`, all `js/*`, `service-worker.js`, `manifest.json`, `google-apps-script.js`

---

## 1. Executive Summary

SignOut is a **100 % client-side PWA** — there is no server to breach.  
All data lives in `localStorage`. That makes the threat surface small, but also means **the browser is the trust boundary**. Every finding below assumes an attacker who can:

* open the app in a browser (physical access to the kiosk/shared tablet), *or*
* run JavaScript in the same origin (stored XSS), *or*
* tamper with `localStorage` via DevTools.

The audit is ordered **critical → low** so you can prioritise.

---

## 2. Severity Legend

| Label | Meaning | Example |
|---|---|---|
| 🔴 Critical | Direct data loss / impersonation with no user interaction | XSS → read all `localStorage` |
| 🟠 High | Bypasses an advertised security control | Spoof GPS, forge PIN |
| 🟡 Medium | Requires extra pre-condition but degrades guarantees | Kiosk auto-logout race |
| 🟢 Low / Hardening | Defense-in-depth — fix when convenient | Missing CSP, no SRI |

---

## 3. Findings

### 🔴 C1 — Persistent Stored XSS via worker / shift names

* **Where:** `workers.js:saveWorker` → `DB.addWorker` stores `name`, `role`, `username` raw.  
  `workers.js:56-73`, `logs.js:61`, `admin.js:187`, `rota.js:128`, `app.js:104-105` interpolate via `innerHTML` but rely on a per-call `_esc()` helper — easy to miss one call site.
* **Impact:** An Admin (or anyone who can call `DB.addWorker` from console) can store `<img onerror=…>` as a worker name. Every future render that forgets `_esc()` executes arbitrary JS and can exfiltrate `localStorage`.
* **Fix (shipped):**  
  1. Centralise escaping — `js/security.js` exports `Sanitize.text()`; all renderers must use it.  
  2. Add `_sanitizeInput()` at write time — strip `< > " ' \`` and cap length.  
  3. Add a CI check that greps for bare `innerHTML = ` without `Sanitize`/`_esc`.

### 🔴 C2 — Admin PIN & workflow injection in inline `onclick`

* **Where:** `workers.js:68-73`, `admin.js:388-389`, `rota.js:255` emit  
  ```js
  onclick="Workers.openEditModal('${w.id}')"
  ```  
  If `w.id` ever contains `'` it breaks out of the handler.
* **Impact:** Same as C1 — full JS execution.
* **Fix (shipped):** Replace every `onclick="…('…')"` with `addEventListener` + `dataset.id`. The new `security.js` linter flags inline handlers.

### 🟠 H1 — `localStorage` is plaintext — PINs, admin PIN, GPS secrets readable

* **Where:** `db.js:312-338` writes `adminPin`, worker `pin`, `sheetsUrl`, `webhookUrl` verbatim.
* **Impact:** Anyone with DevTools (or an XSS) reads every credential. The 20-seed workers use trivial PINs `1111`, `2222`… — an attacker can brute-force without lockout by reading storage directly.
* **Mitigations (recommended):**
  1. Hash worker PINs with `crypto.subtle.digest('SHA-256', pin + salt)` — store only the hash. Compare hashes in `authenticateWorker`.
  2. At least move `adminPin` to a salted hash + add exponential back-off on the admin gate (currently no lockout at all).
  3. Document that SignOut is **not** a substitute for server-side auth — add a `SECURITY.md` disclaimer.
  4. Future: offer an opt-in encrypted vault (`AES-GCM` with a passphrase) for teams that need it.

### 🟠 H2 — GPS geofence is client-side only — trivially spoofed

* **Where:** `gps.js:checkGeofence()` → `navigator.geolocation.getCurrentPosition`.
* **Impact:** Any worker can spoof location via DevTools Sensors or a mock-location app and clock in from home. The `distance` shown in the overlay is advisory only.
* **Mitigations:**
  1. Label the feature "GPS assist, not enforcement" in UI.
  2. Add server-side verification for teams that need strict enforcement — POST `{lat,lng,photo}` to Apps Script and re-check distance + reverse-geocode.
  3. Add anomaly detection: flag `distance > radius` previously overridden, impossible travel speed, etc. — surfaced in **Audit**.

### 🟠 H3 — Device fingerprint is spoofable

* **Where:** `device.js:_collectSignals()` — everything it reads (`userAgent`, `screen`, canvas, WebGL) can be overridden in DevTools.
* **Impact:** "Locked to one phone" is a soft deterrent, not a guarantee.
* **Mitigation:** Keep it as UX, but don't claim it as security. For stronger binding use WebAuthn / platform authenticator — listed in Recommendations.

### 🟡 M1 — `innerHTML` reset in `_showDeviceBlocked` destroys event bindings

* **Where:** `app.js:187` does `loginStep2.innerHTML = \`…<button id=blockedBack>\` ` — wipes the numpad `addEventListener('click')` delegation still works (it's on the parent) but any future per-button handler would be lost. More importantly the `worker.name` is correctly escaped but the pattern invites regressions.
* **Fix (shipped):** Render via `createElement` / `textContent` or through `Sanitize`.

### 🟡 M2 — `prompt()` / `confirm()` / `alert()` are spoofable & block the main thread

* **Where:** `workers.js:toggleLeave` (`prompt`), `workers.js:confirmResetDevice` (`confirm`), `rota.js:deleteShiftFromModal` (`confirm`), `pdf.js:printWorkerTimesheet` (`alert`).
* **Impact:** Phishing: an injected script can override `window.confirm = () => true` and auto-approve deletes. Also bad UX on mobile.
* **Fix (shipped in part):** Provide a custom modal helper (`UI.confirm()` / `UI.prompt()`) that doesn't rely on blocking dialogs. Keep `confirm` as fallback only.

### 🟡 M3 — No rate limit on Admin PIN gate

* **Where:** `admin.js:104` — `checkPin` compares `input === DB.getSettings().adminPin` with no counter.
* **Impact:** Brute-force 4-digit PIN in ≤ 10 000 attempts via script.
* **Fix (recommended):** Mirror worker lockout — 5 failures → 2 min cooldown + exponential back-off; optionally hash the PIN.

### 🟡 M4 — Sheets / Webhook SSRF-ish — any URL accepted

* **Where:** `admin.js:saveGpsSettings` / `saveWebhookSettings` / `syncToSheets` accept any `https://` URL and `fetch(..., {mode:'no-cors'})`.
* **Impact:** An admin who pastes a malicious URL can cause the browser to POST attendance data to an attacker-controlled origin (data exfiltration by social engineering).
* **Mitigation:** Validate URL allow-list prefix (`https://script.google.com/` for Sheets, `https://hooks.slave.com|…` for Slack) and show a strong warning; require re-entering Admin PIN to change either URL.

### 🟢 L1 — Missing Content-Security-Policy

* App ships with no CSP. An XSS would be more powerful than with a strict policy.
* **Fix (recommended):** Add a `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; connect-src 'self' https://script.google.com https://hooks.slack.com https://outlook.office.com https://discord.com">` and strip `'unsafe-inline'` from scripts by moving inline `onclick` to listeners (done).

### 🟢 L2 — Service worker caches without integrity check

* `service-worker.js` caches `js/*.js` via `c.addAll(ASSETS)` and then re-caches any `fetch` response blindly. A poisoned response could persist.
* **Fix (recommended):** Only cache `response.ok && response.type === 'basic' && response.url.startsWith(location.origin)` (already partly done); add a cache-busting version bump (`signout-v3` → `signout-v4` when shipping this patch).

### 🟢 L3 — `photo` Data URLs bloat `localStorage` (5 MB quota)

* Selfie `data:image/jpeg;base64,…` strings are stored per log. 50 selfies can evict the whole DB (silent data loss).
* **Fix (recommended):** Store photos in `IndexedDB` or `Cache API`, keep only a pointer in `localStorage`; add a quota guard that refuses to save when `localStorage` > 4 MB and prompts to export.

### 🟢 L4 — `localDateStr` / `new Date(str + 'T12:00:00')` is timezone-fragile

* `db.js:_localDateStr` and `rota.js:_addDays` use a noon hack to dodge DST. It works in PH but can mis-group logs in other zones.
* **Fix (low):** Use `Intl` / `Temporal` or store all dates as UTC ISO and render with `toLocaleDateString`.

---

## 4. Hardening Checklist (what shipped vs. what you should do next)

| # | Action | Status |
|---|---|---|
| C1 | Input sanitization + central `Sanitize.text()` | ✅ Shipped (`js/security.js`) |
| C2 | Remove inline `onclick='…'` string interpolation | ✅ Shipped |
| H1 | Hash worker & admin PINs | ⬜ TODO — see `RECOMMENDATIONS.md` |
| H2 | Document GPS as assist-only + add anomaly flags | ⬜ TODO |
| M2 | Replace `prompt/confirm/alert` with modal helpers | 🟡 Partial — wiring ready |
| M3 | Admin PIN rate limit | ⬜ TODO |
| M4 | URL allow-list for Sheets/Webhooks + re-auth | ⬜ TODO |
| L1 | Add CSP meta tag | ✅ Shipped (`index.html`) |
| L2 | Bump SW cache version | ✅ Shipped (`signout-v4`) |
| L3 | Photo → IndexedDB migration | ⬜ Planned |
| L4 | Date handling | ⬜ Backlog |

---

## 5. How to Report a Vulnerability

* **Email:** `glaine100justin@gmail.com`
* **GitHub:** Open a **private** Security Advisory on `glainejustin/signout` → *Security → Report a vulnerability*.
* We aim to acknowledge within **48 h** and ship a fix within **7 days** for critical issues.

Please **do not** open a public issue with exploit details — use the private channel above.

---

## 6. Disclaimer

SignOut is a **local-first PWA** with no backend. It is suitable for small teams where the device is trusted. For regulated environments (payroll, biometric data) add a server-side layer with proper authentication, encryption at rest, and audit retention — see `RECOMMENDATIONS.md § Backend`.

---

## 7. References

* OWASP Top 10:2021 — A03 Injection (XSS), A01 Broken Access Control, A02 Cryptographic Failures
* MDN: Content Security Policy, Web Crypto API, Service Worker security
* Google PWA checklist — HTTPS, CSP, offline

---

<p align="center">Made with ❤️ by <a href="https://github.com/glainejustin"><strong>glainejustin</strong></a> — with love 💖</p>
