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

## Web checkout

All web features are available while checkout is disabled. `config.js` keeps `UNLOCK_ENABLED` set to `false` and leaves the payment link and prototype unlock hash empty. `node test.js` exercises the original unlock scaffold with test values.

The original test flow granted access using a shared code and saved it in the current browser. Live checkout needs verified Stripe payment events and a way for customers to restore their purchases. The static app can stay on GitHub Pages while a separate service verifies purchases.

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
- Paid minutes, night enhancement, bank holidays, overtime and sleep-ins follow the Android rules.
- Web checkout is disabled. Android uses Google Play Billing.

## Licence / product note

Personal tooling MVP. Estimates are indicative only.
