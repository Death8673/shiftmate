# ShiftMate UK (Web / PWA)

Offline-first personal **rota + estimated pay** for UK shift workers (care / NHS / security / hospitality).

This is a **local-only** static site — no accounts, no backend, no network APIs required to use the rota. All data stays in the browser (`localStorage`). It is built to be hosted on **GitHub Pages** (paths are relative; `.nojekyll` is included).

Android sibling app: `/workspace/shiftmate-uk`

## Open locally

```bash
cd /workspace/shiftmate-web
python3 -m http.server 8767 --bind 127.0.0.1
```

Then open [http://127.0.0.1:8767/](http://127.0.0.1:8767/) in a browser.

Serving over `http://` (not `file://`) is required for the service worker / installable PWA.

## What you can do

1. **Job setup** (onboarding): employer, basic rate, contracted hours, pay period, reference payday, week start.
2. **Shift types**: Day / Late / Night / Sleep-in templates are seeded; add or edit your own.
3. **Rota**: month calendar — tap a day, add a shift from a type, edit worked times, mark leave.
4. **Copy week forward**: copy the week containing the selected day into the next N weeks (optionally skipping dates that already have a shift).
5. **Repeating pattern**: fill a date range from 4-on-4-off, 4-on-3-off, 5-on-2-off, or a custom cycle of shift types and off days.
6. **Export / import**: download a JSON backup of all data, import a JSON backup (validated, with a confirm before overwrite), or export shifts as CSV with pay estimates.
7. **Home dashboard**: next shift, this pay-period hours / OT / sleep-ins, expected gross, estimated take-home, payday countdown.

**Disclaimer (always):** *Estimate only — not a payslip and not HMRC-accurate PAYE.*

## Tests

```bash
cd /workspace/shiftmate-web
node test.js
```

Includes the desk check: a Day shift 07:00–15:00 at £12.21 with a 30-minute unpaid break must gross **£91.58**.

## GitHub Pages

All asset URLs, the manifest `start_url` / `scope`, and the service worker registration are **relative**, so the app works at the domain root or under a subpath such as `/shiftmate-web/`. The empty `.nojekyll` file stops GitHub Pages from running Jekyll on the folder.

## Paid unlock (scaffold, off by default)

Payments are designed as a **Stripe Payment Link** plus a static-site unlock — no backend, so it can stay on GitHub Pages.

Config lives in `config.js`:

| Constant | Default | Role |
|----------|---------|------|
| `UNLOCK_ENABLED` | `false` | Master flag. While false, **nothing is gated** and the Unlock tab is hidden. |
| `UNLOCK_PRICE` | `£4.99` | One-off price shown on the Unlock screen. |
| `STRIPE_PAYMENT_LINK` | `''` | Your Payment Link, e.g. `https://buy.stripe.com/xxxx`. |
| `UNLOCK_CODE_SHA256` | `''` | Lowercase SHA-256 hex of the unlock code. |
| `FREE_ROTA_WEEKS_AHEAD` | `4` | Free-tier rota cap (from today) once the flag is on. |

When you are ready to charge:

1. Create a Stripe Payment Link for £4.99 one-off (no account is created by this app).
2. Choose an unlock code and hash it:

   ```bash
   node -e "crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_CODE')).then(b=>console.log(Buffer.from(b).toString('hex')))"
   ```

3. In the Stripe dashboard, set the after-payment success URL to this app with that code, for example:

   `https://<user>.github.io/shiftmate-web/?unlocked=YOUR_CODE`

4. Put the Payment Link in `STRIPE_PAYMENT_LINK`, the hash in `UNLOCK_CODE_SHA256`, then set `UNLOCK_ENABLED` to `true`.

After payment, Stripe redirects back with `?unlocked=`; the app hashes the code, compares it to `UNLOCK_CODE_SHA256`, stores a licence flag in `localStorage`, and strips the code from the address. The user can also paste the code on the Unlock screen. The licence stays on that browser only.

While the flag is on and the device is not unlocked, the rota cannot add shifts more than 4 weeks ahead, and the full pay breakdown (gross, take-home, deductions, shift £ totals) stays locked.

## Files

| File | Role |
|------|------|
| `index.html` | App shell + screens |
| `styles.css` | Mobile-first UI (brand colours) |
| `config.js` | Feature flags and Stripe / unlock placeholders |
| `app.js` | UI, localStorage, tabs |
| `pay.js` | Pay engine (port of Android Kotlin domain) |
| `rota.js` | Week copy, pattern generator, export / import |
| `unlock.js` | Serverless unlock helpers (Stripe redirect + code) |
| `sw.js` | Service worker (cache static assets; bump `CACHE` to ship updates) |
| `manifest.webmanifest` | PWA manifest (relative `start_url` / `scope`) |
| `icon-192.png` / `icon-512.png` | Icons |
| `.nojekyll` | GitHub Pages: do not process as Jekyll |
| `test.js` | Node tests for pay, patterns, export, unlock helpers |

No npm / build step. Vanilla JS.

## Notes vs Android

- Single job only (same as Android MVP intent); no multi-job.
- Take-home is the same simplified annualise → basic-rate tax / NI / pension model (not full PAYE).
- Bank holidays: fixed England & Wales sample list (2025–2027), same approach as Android.
- Night-overlap scan uses one night window per calendar day (avoids a midnight double-count that the Kotlin dual-window loop can hit); paid minutes / BH / OT / sleep-in match the Android rules.
- Unlock is a static-site scaffold (Stripe Payment Link + code). It is not Play Billing, and it is switched off until you set `UNLOCK_ENABLED`.

## Licence / product note

Personal tooling MVP. Estimates are indicative only.
