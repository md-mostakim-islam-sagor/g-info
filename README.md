# GAMES • INFO — POWERED BY MOSTAKIM LAB'S

Game ID lookup site + metered public API. Node 20+, zero web-framework deps (only `firebase-admin`).

## Pages
`/home` (lookup) · `/games` · `/login` · `/registration` · `/service` (signed-in users; `/dashboard` redirects here) · `/myadmin` (unlisted admin panel, noindex; admin rights enforced server-side on every `/api/admin/*` call). `/` redirects to `/home`.

## Run
```
npm install
cp mostakim.example.json mostakim.json   # edit placeholders
npm test                                 # MOCKED tests (no network/keys needed)
node index.js                            # http://localhost:3000
```
Local-only dev login (no Firebase): `ALLOW_DEV_AUTH=1 node index.js`, then log in with token `dev:myuid:me@x.com`. Ignored when `NODE_ENV=production`.

## Config (`mostakim.json` + env)
One config file; **secrets only in env vars** (referenced by `*Env` names). The file is never served (static whitelist = `src/`, `resources/`). `proxy` section is ignored. Startup validates: in production a missing `FIREBASE_SERVICE_ACCOUNT_JSON` aborts; an enabled provider with a missing key stays inactive with a warning.

## Providers (two systems)
1. **`idgamechecker`** – RapidAPI ID Game Checker. Returns **username only**. Only doc-confirmed path: `/brawl-stars/{id}`. Headers `X-RapidAPI-Host` / `X-RapidAPI-Key`. Verify other paths in the RapidAPI playground, then add to `games`.
2. **`generic`** – any JSON GET API for full profiles. Set `baseUrl`, `authHeader`, and per game `path` + `fieldMap` (normalized name → JSON path). Names like `rank.tier`, `pet.name`, `guild.name`, `account.createdAt` fill the matching UI sections; every returned field also appears under "All fields".
Fallback: providers tried by `order`; next one only on retryable errors (5xx, timeout, quota, empty). A secondary key is used only if `allowSecondaryKey` is true — check provider terms; two keys do not mean double quota. Games with no verified path show **COMING SOON**; **LIVE** only after a real success since boot.
Provider keys live in env secrets; admin panel shows them masked and can enable/disable providers. To rotate a key: change the secret and restart.

## Public API
`GET {BASE}/api/v1/lookup/:game/:playerId?region=BD` with header `X-API-Key: gi_…` (or a signed-in Bearer token).
Success `{"success":true,"requestId":"…","data":{nickname,level,…,fields:{…},fetchedAt}}` · Error `{"success":false,"requestId":"…","error":{"code":"…","message":"…"}}`.
Codes: 400 INVALID_ID/INVALID_REGION · 401 UNAUTHENTICATED · 402 INSUFFICIENT_CREDITS · 404 NOT_FOUND · 429 RATE_LIMITED · 501 COMING_SOON · 502/503/504 provider errors.
Credits: 1 per request, deducted atomically (Firestore transaction, ledger doc per requestId). **Refunded once** on confirmed provider failure (5xx, timeout, quota, empty); not refunded for NOT_FOUND/INVALID_ID; refunds capped per user per day (`refundCapPerDay`). Keys are SHA-256 hashed, shown once, rotatable/revocable. BASE = your deployed URL (`publicBaseUrl`).

## Firebase setup (manual)
1. Create project → Authentication → enable **Email/Password** and **Google**. Authorized domains: add `localhost` and your deployed domain.
2. Firestore → create database (production mode) → publish `firestore.rules` and `firestore.indexes.json`.
3. Project settings → Web app → copy `apiKey`, `authDomain`, `projectId` into `FIREBASE_WEB_API_KEY` / `mostakim.json`.
4. Service accounts → generate key → paste whole JSON into secret `FIREBASE_SERVICE_ACCOUNT_JSON`.
## Admin panel login (`/myadmin`)
Set in `mostakim.json`:
```
"adminLogin": { "username": "myname", "password": "a-long-passphrase" }
```
Leading/trailing spaces are trimmed; `" your username"` / `" your password"` placeholders are rejected (login stays disabled until you change them). Safer: `npm run hash-password "my passphrase"` and paste the `scrypt$…` result as the password, or use the `ADMIN_USERNAME` / `ADMIN_PASSWORD` secrets instead of the file. Login issues an 8-hour signed HttpOnly, SameSite=Strict cookie scoped to `/api/admin`; 5 wrong attempts lock that IP for 15 minutes (set `app.trustProxy: true` behind Replit's proxy so IPs are real). Set `ADMIN_SESSION_SECRET` so sessions survive restarts. `mostakim.json` is gitignored and never served; keep it private. The optional Firebase `admin.emails` allowlist still works as a second way in; leave it empty to disable.
## Payments
**Gateways (bKash Merchant + Nagad Merchant)** – configured under `payment.gateways` in `mostakim.json`; credentials only in env secrets (`.env.example`). Credits are added **only after the server verifies the payment with the gateway** (never from the browser or callback query), amount + order must match, each gateway transaction can credit once, callbacks are idempotent. Register these callback URLs with the gateway: `{PUBLIC_BASE_URL}/api/pay/bkash/callback` and `{PUBLIC_BASE_URL}/api/pay/nagad/callback`. Flow: user taps *Pay with bKash/Nagad* on **Service** → order `INITIATED` → gateway page → callback → server verify → `PAID` (credits) / `FAILED` / `CANCELLED` / `REVIEW` (amount mismatch, admin must investigate). Users can tap *Check status* if the callback was missed. Admin enables/disables each gateway in `/myadmin` (only possible once its credentials are complete).
 - bKash: Tokenized Checkout v1.2.0-beta (`token/grant → create → execute → payment/status`). Sandbox URL built in; `sandbox:false` uses `tokenized.pay.bka.sh`.
 - Nagad: API v-0.2.0 (`check-out/initialize → complete`, then `verify/payment`), RSA-encrypted `sensitiveData` + SHA256withRSA signature. Sandbox URL built in; for live set `sandbox:false` **and** `baseUrl` to the production URL Nagad gives you. Set `verifyResponseSignature:false` only if Nagad's sandbox signs differently.
 - Go live: both start in `sandbox:true`; run Nagad/bKash sandbox payments end-to-end first.
**Manual bKash/Nagad** – still available: user submits txn ID → `PENDING` → admin Approve/Reject (credits once). No PIN/OTP is ever requested.
Prices/credits are server-side; defaults 50/৳20, 100/৳45, 200/৳90, 500/৳240, 1000/৳450 (editable in Admin).
## Welcome popup
New visitors see a popup (image, title, text, up to 3 buttons: Telegram / YouTube / any https link). Close it (X, Close, outside tap, Esc) or tap a button, and it stays hidden **in that browser for 60 minutes** (`popup.cooldownMinutes`, 1-1440), then appears again. Stored in the browser's localStorage (no account/tracking; clearing site data or a private window shows it again). Not shown on `/myadmin`. Defaults live in `mostakim.json` → `popup`; the admin can edit everything live in `/myadmin` → *Welcome popup* (title, text, image, buttons, cooldown, enable/disable, *Preview*), and tick *Show again to everyone* to re-show an updated popup to people who already closed it. Buttons whose URL is empty, not https, or still contains `YOUR_` are not shown. Image: `https://…` or a file in `resources/` (`/resources/popup.png` is a placeholder - replace it).
## Deploy (Replit)
Add the secrets from `.env.example`, Deploy → Autoscale/Cloud Run, run `node index.js`, port 3000. Check `/health`. Set `PUBLIC_BASE_URL` after the URL exists.
## PDF
"Download PDF" opens the browser print dialog (print stylesheet) → Save as PDF. Includes UID, nickname, region, available fields, lookup time; nothing private.
## Status
Tested (mocked, `npm test`, 44 checks incl. bKash/Nagad flows against local fake gateways and admin login). NOT live-tested: RapidAPI, bKash/Nagad sandbox or live, Firebase Auth/Firestore, Google sign-in, deployment. The Nagad request/response fields follow Nagad's public integration guide and community SDKs; confirm in the Nagad sandbox before going live. Replace the placeholder PNGs in `resources/` with your branding.

## API keys & credits
Managed by the admin in `/myadmin` → Users → Manage (issue/rotate/revoke keys, ± credits with audit log, per-user request stats). Users only see their balance, key prefix and history on **Service**. Admin can switch on user self-service keys (Overview toggle, or `app.selfServiceKeys`). A new key is shown once — the admin copies it to the user.
