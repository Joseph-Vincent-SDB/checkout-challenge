# Checkout Challenge

A phone-first web app for the UNSW E-Commerce Society (EcomSoc) stall at Arc Clubs Takeover. Volunteers run a trivia activity framed as an online store: the visitor follows EcomSoc on Instagram (payment), answers one trivia question (checkout) and, if right, gets a free cup of Thai food (the product).

It is a plain static site: `index.html` (inline CSS and JavaScript), `qr.js`, `sw.js`, `manifest.webmanifest`, `logo.jpg` and `icons/`. No framework, no build step, no backend, no accounts and no personal data. Everything is stored in each phone's own `localStorage`. The whole app is about 106 KB.

## How a customer runs (4 taps plus the answer)

1. **Next customer**
2. **Follow confirmed** (or **Already following**, counted separately)
3. **Reveal deal**: a random question is drawn. Easy = **HOT DEAL**, hard = **FULL PRICE**.
4. The visitor points or taps an answer and the volunteer taps it. Correct gives **Order confirmed**, then **Serve food**.

A wrong answer gives one more random question. A second wrong answer means no food (the follow still counts). The volunteer can **Cancel** before an answer (nothing is counted) or **Skip** a question the visitor has overheard (counted as a skip). The in-app **How to run it** screen has the volunteer steps.

## Deploy to GitHub Pages

1. Put these files in a public GitHub repository (the site root is the repository root).
2. Repository **Settings > Pages > Build and deployment**: source **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. After a minute the site is live at `https://<owner>.github.io/<repo>/`. GitHub Pages is HTTPS, which the wake lock and offline support need.

Viewers need no account. Any static host works the same way (Netlify, Cloudflare Pages, and so on). Netlify Drop sites are deleted within an hour unless claimed with an account.

## On event day

- Open the link on every volunteer phone **once while on Wi-Fi or 4G**, wait for the green "Works offline" badge on Home, then **Add to Home Screen** (iPhone: Share > Add to Home Screen. Android: menu > Install app).
- After that the app opens with no signal at all.
- Each phone keeps its own tallies. At the end, open **Summary > Copy summary** on each phone and paste into the exec chat. Use **Phone label** (Summary screen) so you can tell phones apart. Add the numbers up by hand.
- Do the **Reset** (hold for 2 seconds) before the event starts, after any practice runs, so tallies start at zero.
- iPhones older than iOS 18.4 cannot keep the screen on from a web page. Set Settings > Display & Brightness > Auto-Lock to Never for the day.

## Edit things

All settings are at the top of the `<script>` in `index.html`, inside the block marked `SETTINGS`.

| What | Where |
| --- | --- |
| Instagram handle (also changes the QR code) | `CONFIG.handle` |
| Starting food stock (default 80) | `CONFIG.defaultStock`, or on the phone: **Summary > Starting stock**, then Reset |
| Low-stock warning level (default 15) | `CONFIG.lowStock` |
| HOT DEAL (easy) share of draws (default 70) | `CONFIG.hotDealPercent` (50 = even split) |
| Retries after a wrong answer (default 1, use 0 for one shot) | `CONFIG.retries` |
| Price tag decoration ($15, 90% OFF) | `CONFIG.rrp`, `CONFIG.discountLabel` (decoration only, the food is always free) |
| Colours | CSS variables in `:root` at the top of the `<style>` block |
| Questions | the `QUESTIONS` array, marked `QUESTION POOL` |

Each question has `id`, `difficulty` (`easy` = HOT DEAL, `hard` = FULL PRICE), `question`, `options` (A to D), `answer` (the correct letter) and `fact` (the "Say this" line). Keep ids unique. Each difficulty needs at least one question, and more than one so a question never repeats back to back.

To change food stock mid-day on a phone, use **Summary > Food remaining** (+1 / -1).

**After editing any file, open `sw.js` and change `CACHE = 'checkout-challenge-v1'` to `v2`, `v3` and so on.** Phones with the old copy then update on their next online visit (open the app twice: the first visit fetches the update, the second shows it).

## How the draw works

- Randomness comes from `crypto.getRandomValues` (unbiased), falling back to `Math.random` only if it is missing.
- Each device keeps **two shuffle bags**, one for easy and one for hard questions (Fisher-Yates). A draw first picks the difficulty (70% easy by default), then takes the next question from that bag. A question is not repeated until its whole bag of 10 is used, then the bag reshuffles. The same question never appears twice in a row, including across a reshuffle.
- The bag position is saved in `localStorage`, so a refresh does not reset it.
- The correct answer is never put in the page while the question is showing: the answer buttons are identical in markup and style until one is tapped. (It does exist in the page's JavaScript source, which is fine for a stall.)

## Counting rules

Per-customer tallies are committed when the customer's first answer is tapped, so a customer cancelled earlier is not counted. Skips are counted straight away.

- **Customers**, **follows confirmed**, **already following**
- **Answers correct / wrong** (each answer, including retries), **retries given**
- **Customers won** (answered correctly, even if food had sold out) and **customers lost** (no food)
- **HOT DEAL / FULL PRICE draws** (answered draws), **skips**
- **Food served** and **food remaining**, plus first and last customer times

## Phone and outdoor behaviour

Light, high-contrast theme. Question text 26 to 32 px, answers 20 px, body 18 px. Every button is at least 48 x 48 CSS px with 8 px gaps. No sound at all (no audio code). Vibration on results where supported (Android Chrome; iOS ignores it). The screen stays on using the Screen Wake Lock API where supported (Chrome for Android 84+, Safari on iOS 18.4+), with a small indicator on Home. Android's Back button and iOS edge-swipe step back inside the app instead of leaving it. `prefers-reduced-motion` removes the animations and confetti.

## Test

The tests use Playwright with Chromium and mobile emulation. They start their own local server.

```bash
cd tests
npm install
npx playwright install chromium     # skip if you already have a Chromium: set CHROME_EXE=/path/to/chrome
npm test
```

To run the same suite against the live site: `BASE_URL=https://<owner>.github.io/<repo>/ npm test`.

It checks, at iPhone SE (375 x 667, plus the old 320 x 568), iPhone 15 and Pixel 7 sizes: the full flow, correct, wrong, retry, skip, cancel, serve, sold out, summary, copy and reset; the no-repeat shuffle logic over 2,000 draws; that every question and result screen fits without scrolling and without horizontal overflow (including the longest question and "Bulk Nationwide Parcel Logistics"); 48 px tap targets and 8 px gaps; that answers are hidden and identical before a tap; WCAG AA contrast; that the QR code decodes to the Instagram URL (also dimmed); offline reload after the first visit; blocked storage; no sound; wake lock and vibrate with and without browser support. Screenshots go to `tests/screenshots/`.

Playwright cannot run iOS Safari (WebKit) in this setup, so test on a real iPhone before the event: open the link, add it to the Home Screen, switch on aeroplane mode, reopen it, and run one customer.

## Licences and credits

- QR codes are generated in the browser by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, **MIT licence**, minified and bundled as `qr.js`. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
- `logo.jpg` is the EcomSoc profile picture from the society's public Instagram account, used here as the society's own logo. Replace it with a higher-resolution file if you have one (keep the name `logo.jpg`, or update `index.html`).
- The app icons are original artwork. The app does not use the Instagram logo or the UNSW crest.
