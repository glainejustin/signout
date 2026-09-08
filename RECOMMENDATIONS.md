# 💡 Recommendations & Roadmap — WorkTap

> How to take WorkTap from a polished PWA to a production-grade workforce platform.

---

## 0. Prioritisation Key

* **P0** — Do before handling real payroll / sensitive data
* **P1** — Biggest user-value wins for the next 1–2 sprints
* **P2** — Nice to have / when you have a backend

---

## 1. Security — Finish the Audit

| # | Title | Effort | Why it matters |
|---|---|---|---|
| P0 | **Hash all PINs** — `SHA-256(pin + per-worker salt)` via `crypto.subtle` | 1 day | Plain PINs in `localStorage` = instant impersonation via DevTools |
| P0 | **Admin PIN lockout** — 5 fails → 2 min cooldown, exponential | 2 h | 4-digit PIN brute-forces in seconds |
| P0 | **URL allow-list** for Sheets (`script.google.com`) & webhooks + require Admin PIN to change | 2 h | Prevents data exfiltration by pasted URL |
| P0 | **Sanitize at write time** — strip `< > " ' \`` and cap lengths for names/roles/notes | 2 h | Defense-in-depth beyond `_esc()` at render |
| P1 | **Move selfie blobs to IndexedDB** + quota guard | 1 day | `localStorage` is 5 MB — selfies can silently wipe your DB |
| P1 | **Encrypt export** — password-protect JSON backup (`AES-GCM`) | 1 day | Backups contain every PIN + photo |

See `SECURITY.md` for full findings (C1…L4).

---

## 2. Product — Features Users Will Love

### P0 — Close the loop on what's already half-built

* **Rota notifications** — push when your shift changes or a swap is approved/denied.
* **Open-shift bidding UX** — workers see & bid from `My Schedule` (table exists but not wired); admin sees bid list and assigns.
* **Overtime guard** — hard block "clock in" when weekly cap reached, not just a webhook alert.
* **Finish replacing `prompt`/`confirm`/`alert`** — custom modals for leave notes, device reset, delete. (Helper already sketched in `security.js`.)

### P1 — High-Value Additions

* **Roles & permissions** — `Admin`, `Manager`, `Worker`. Managers can edit rota but not delete workers or change admin PIN.
* **Payroll export** — one CSV with `regular / overtime / break / total` per worker, ready for Xero/QuickBooks.
* **Bulk import** — CSV upload of workers (validates duplicates, hashes PINs on import).
* **Smart "forgot clock-out"** — auto close an open shift at end-of-day + flag for manager approval instead of silently inflating hours.
* **Kiosk hardening** — fullscreen lock, screensaver after 30 s, auto-return to worker picker, disable browser back.
* **Search & sort everywhere** — logs, rota, audit — with debounced input and date presets (Today / This week / Last 7 days).
* **Offline queue indicator** — badge "3 records pending sync" so admins trust offline mode.

### P2 — Delight

* **Native biometrics** — WebAuthn / Face ID as alternative to PIN on supported devices.
* **Live presence wall** — big-screen view "who's in right now" for the break room.
* **Shift marketplace** — workers can publish "I can't do Tue PM" and others claim it.
* **Multi-language** — `en / tl / es` toggle; all strings in `js/i18n.js`.

---

## 3. Architecture — When You're Ready for a Backend

WorkTap's offline-first PWA is the right start. When you outgrow `localStorage`:

```
Browser (PWA)  ⇄  Apps Script / Cloud Function  ⇄  DB (Firestore / Supabase / Postgres)
     ↕ localStorage/IndexedDB cache
```

* **Keep the PWA offline** — use Background Sync + `IndexedDB` as source of truth, sync deltas (`lastSyncedAt`) to server.
* **Auth** — Firebase Auth / Supabase Auth / custom JWT; WebAuthn for shared tablets.
* **Realtime** — Firestore/Supabase realtime for live rota & presence instead of polling.
* **Why Apps Script today is fine** — it's free, auditable, and already syncs to Sheets which managers love.

**Migration path without a rewrite:**

1. Ship PIN hashing + IndexedDB photos (still local).
2. Add an optional `SYNC_URL` — if set, the app `fetch(POST) → {changes}` on `online` and on interval.
3. Add a tiny Cloud Function that validates GPS server-side and writes to Firestore — Sheets becomes a view, not the DB.

---

## 4. UX / Accessibility

* **A11y pass** — `aria-label` on every icon button (`✏️`, `🗑️`, `📷`), focus trap in modals, `Esc` closes modal, keyboard-navigable rota.
* **Empty states** — every list needs a helpful empty state with a CTA (already partly done; extend to Rota, Analytics, Audit).
* **Loading & error states** — GPS `📍 Checking…` is good; replicate for Sheets sync, webhook test, photo capture.
* **Mobile first** — the CSS is responsive, but test the rota table on a 320 px phone — consider a card view under 600 px.
* **Dark mode** — respect `prefers-color-scheme`; a one-variable swap in `css/styles.css`.

---

## 5. Engineering Quality

* **Add Prettier + ESLint** — `npx eslint js/*.js` in CI; fix `innerHTML` without escaping as an error.
* **Unit tests** — `db.calcHours`, `GPS.distanceMeters`, `Device.getFingerprint` are pure enough to test in Vitest (no DOM).
* **E2E** — Playwright: login → clock IN → break → clock OUT → assert hours, even in offline mode (`context.setOffline(true)`).
* **TypeScript (incremental)** — `jsconfig.json` + `// @ts-check` + `JSDoc` types gives 80 % of the benefit with zero build step.
* **Versioning** — tag releases (`v1.0.0`, `v1.1.0`) and keep a `CHANGELOG.md`.

---

## 6. Analytics & Observability (Privacy-Preserving)

* **Client-side only** — no tracking by default (good for trust).
* **Optional, opt-in** — Plausible / Umami for page views; never send worker names. Or a simple "heartbeat" to Apps Script: `{event, anonId, ts}` for adoption metrics.
* **Audit retention** — cap Audit at 500 but rotate to `IndexedDB` or Sheets so compliance teams keep history beyond the browser.

---

## 7. Deployment & DevOps

* Already have CI + Pages (`ci.yml`, `pages.yml`) — green ✅
* **Next:** branch protection (`main` requires CI pass), auto-preview deploys for PRs, and a `release.yml` that builds the Capacitor APK on tag push.
* **Capacitor CD:** `npm run android` opens Android Studio; add a GitHub Action that builds an `.apk` artifact on `v*` tags for testers.

---

## 8. Suggested Next Sprint (2 weeks)

| Day | Deliverable |
|---|---|
| 1–2 | P0 security: PIN hashing, admin lockout, URL allow-list, input sanitization |
| 3–4 | Wire open-shift bidding + rota notifications + finish confirm modals |
| 5–6 | IndexedDB for photos + quota guard + encrypted backup |
| 7–8 | Payroll CSV + bulk import + smart forgot-clock-out |
| 9–10 | A11y, mobile rota cards, empty/loading states, Prettier/ESLint, Vitest |

After that you have a **credible v1.1** you can sell to teams handling real payroll.

---

*Have a feature you need first? Open an issue or ping `glaine100justin@gmail.com`.*
