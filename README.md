# Checkout Challenge

A phone-first web app for the UNSW E-Commerce Society (EcomSoc) stall at Arc Clubs Takeover. Volunteers run a trivia activity framed as an online store: the visitor follows EcomSoc on Instagram (payment), answers one trivia question (checkout) and, if right, gets a free cup of Thai food (the product).

It is a plain static site: `index.html` (inline CSS and JavaScript), `qr.js`, `sw.js`, `manifest.webmanifest`, `logo.jpg` and `icons/`. No framework and no build step. **All volunteer phones share one live food count and one set of tallies** through a small free Firebase Realtime Database (see "Sharing between phones"). No personal data about visitors is ever collected. Each phone also keeps its own copy on the phone, so the app keeps working with no signal and catches up when the signal returns. The whole app is about 130 KB.

## How a customer runs (5 taps plus the answer)

1. **Next customer**
2. **Follow confirmed** (or **Already following**, counted separately). The screen shows the Instagram QR code.
3. **Membership done** (or **Already a member**, counted separately). The screen shows a QR code for free UNSW E-Commerce Society membership on Rubric (`CONFIG.membershipUrl`). Leave `membershipUrl` empty in `index.html` to switch this step off (the flow goes back to 4 taps and 4 steps).
4. **Reveal deal**: a random question is drawn. Easy = **HOT DEAL**, hard = **FULL PRICE**.
5. The visitor points or taps an answer and the volunteer taps it. Correct gives **Order confirmed**, then **Serve food**.

The app cannot see whether the visitor really followed or signed up: the volunteer checks the visitor's screen, then taps the button.

A wrong answer gives one more random question. A second wrong answer means no food (the follow still counts). The volunteer can **Cancel** before an answer (nothing is counted) or **Skip** a question the visitor has overheard (counted as a skip). The in-app **How to run it** screen has the volunteer steps.

## Sharing between phones

Every phone that joins the same **team code** sees the same food count and the same tallies, updated every 2 seconds. Look at the bar under the pills on Home:

| Bar | Meaning |
| --- | --- |
| Green, "Shared: 3 phones online" | Connected. The numbers are live. |
| Red, "Offline: food count may be out of date" | No signal. Keep going. Your changes are saved and send by themselves when the signal returns. |
| Red, "Sharing problem: ..." | The database refused or cannot be found. Tell the organiser. The phone still works on its own. |
| Amber, "Not shared" | This phone has not joined a team, so its food count is for this phone only. Tap the bar to join. |

**How it stays correct.** Each phone only ever writes its *own* tallies (customers, serves, skips and so on) and a food adjustment, as one complete record that is safe to send again. The food left is `total food at start + all adjustments - all serves from all phones`. So phones never overwrite each other, a repeated or delayed message can never count a serve twice, and a phone that was offline simply catches up. Each phone's record has a revision number and the database refuses any older revision, so a delayed message cannot undo newer data.

**Honest limits**
- The count is live to within about 2 seconds, not instant. When 15 or fewer remain, tapping **Serve food** first fetches the latest team count, and if the food has just run out the screen turns into the Sold out version instead of serving. Two phones tapping Serve on the very last cup in the same instant could still both serve it, so the count could briefly read one over. The Summary and Copy summary then say "over-served by 1".
- A phone that is offline cannot see other phones' serves. If several phones are offline near the end of the stock, food can be over-served. The red bar tells you when a phone is in that state.
- Reset affects **every** phone. It asks first, and only works with a connection. Reset does not delete anything: it starts a new "epoch" and the old numbers stay in the database. Do not reset during the event.
- The Spark (free) plan allows 100 simultaneous connections and 10 GB of downloads a month. This app uses well under 1% of that for 5 phones.

### One-time setup (about 5 minutes, free, no credit card)

1. Go to <https://console.firebase.google.com> and sign in with a Google account. **Create a project** (any name, for example `checkout-challenge`). You can turn Google Analytics off.
2. In the left menu choose **Build > Realtime Database > Create Database**. Pick **Singapore (asia-southeast1)**, the closest to Sydney. Choose **Start in locked mode**.
3. Open the **Rules** tab, delete what is there, paste the whole of `database.rules.json` from this repository, and press **Publish**. These rules only let phones read and write under a secret team code, and refuse any malformed data.
4. On the **Data** tab copy the database URL shown at the top. It looks like `https://checkout-challenge-default-rtdb.asia-southeast1.firebasedatabase.app`.
5. In `index.html`, set `syncUrl` in the `CONFIG` block to that URL. Bump `CACHE` in `sw.js` (for example to `v3`), then commit and push to deploy.
6. Check it: `cd tests && npm install && SYNC_URL=<that URL> npm run test:live`. This probes the real rules and runs the multi-phone tests against your database, then deletes its own test data.

Command-line alternative to steps 1 to 3 (needs Node.js): `npx firebase-tools login`, then `npx firebase-tools projects:create checkout-challenge-<something>`, `npx firebase-tools database:instances:create <name> --location asia-southeast1 --project <id>`, and `npx firebase-tools deploy --only database --project <id>` (the `firebase.json` in this repository points to the rules file).

### Joining phones

1. Make a team code: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0 or 1), for example `K7MQ-X2PA`. Anyone with the code can read and change your numbers, so share it only with volunteers. **Do not commit it to the repository.**
2. Volunteers open the link `https://ecomsoc-checkout.web.app/#t=K7MQX2PA` (or scan a QR code of it). The phone joins, removes the code from the address bar and remembers it.
   If a chat app strips everything after the `#`, the same code also works as `https://ecomsoc-checkout.web.app/?t=K7MQX2PA`. The app uses it and then removes it from the address. (This version of the link does pass the code to the web host in the request, so prefer the `#` link.)
3. Another way: open the app, choose **Join team** and type the code. On a phone already on the team, **Summary > Show join QR** shows a QR code for new volunteers to scan.
4. **iPhone note:** an app added to the Home Screen has its own storage, separate from Safari. After adding it, open the app and type the team code once (Summary shows the code on phones already joined).
5. Name each phone in **Summary > This phone's name**, so the Phones list and Copy summary say who served what.
6. A phone that joins a team starts from zero. If it had practice tallies, it asks before clearing them.

## The organiser (admin) phone

One phone is the organiser's. It has everything a volunteer phone has, plus an **Organiser console**. Volunteer phones keep all their existing controls (food total, food remaining, reset, naming the phone).

**Becoming the admin, and staying the admin.** Open the private admin link once on that phone: `https://<your site>/#t=TEAMCODE&a=ADMINKEY`. The phone joins the team, is named `Joseph's Phone (Admin)` (the name is fixed, see `adminLabel` in `index.html`) and shows an ADMIN badge. The key leaves the address bar immediately. There is no sign-out: a phone that has been made the admin stays the admin through closing the page, a fresh session and a restart. The app keeps extra copies of the admin mark (a second stored item and a 400-day cookie) so damaged or partly cleared data cannot drop it, and asks the browser to keep this site's data. If the browser itself wipes everything (Safari deletes website data after 7 days without use in a normal tab, or you clear website data), scan the QR again: Home Screen apps are not subject to the 7 day rule. If the app is installed on the Home Screen (separate storage on iPhone), use **Summary > Organiser sign-in** and paste the key or the whole link instead. Changing the key (`adminHash`) ends admin status on every old phone.

**The key.** `CONFIG.adminHash` holds only the SHA-256 of the key, so the key is not in the code or the database. To make a new key: generate 24 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, put the SHA-256 (hex) of that text in `adminHash`, and share only the link with the key. Keep the key and the admin QR private (they are in git-ignored files).

**Live numbers on every phone.** Home and Summary show, for all volunteers and the organiser: food left, phones online (of all phones), serves per hour, win rate, new follows and new members. Serves per hour is worked out on each phone from its own readings of the team total over the last 15 minutes (or since the first customer when it has less than a few minutes of readings), so two phones can differ slightly; Summary says which basis is used.

**What the console does** (all of it only on the admin phone):
- **Alerts:** low food, sold out, a phone that went offline, over-served, this phone offline, changes waiting to send.
- **Live numbers:** food left, phones online, serves per hour (from this phone's own readings, or since the first customer), win rate, serves, follows, members, a sell-out time estimate, and every phone with its own numbers and online state.
- **Message to every phone:** type or pick a quick message (140 characters), Normal or Important. It shows as a banner on every volunteer phone until they tap Got it, even mid-customer. Clear it any time.
- **Pause the stall:** volunteers cannot start new customers (customers already in progress can finish). The admin phone is not blocked.
- **Lock volunteer settings:** hides food totals, food remaining and reset on volunteer phones until unlocked.
- **Event settings for every phone:** membership step on or off, HOT DEAL chance (0 to 100 in steps of 10) and extra questions after a wrong answer (0 to 2).
- **Organiser first in Phones:** on every phone, Summary > Phones lists `Joseph's Phone (Admin)` first, always, even right after a reset. Volunteer phones are not told whether it is online or offline or when it was last seen, and they do not count it in "phones online" (Home tiles and the Shared bar). The admin phone itself sees every phone's online state. The organiser phone keeps its own small record (`events/<team>/admin`: id, name, heartbeat) that a reset does not clear; this hiding is done in the app, the heartbeat is still stored in the database.
- **Copy admin report:** the normal summary plus pace, win rate, current settings and every phone.

**How it works and what it does not do.** The admin phone writes one shared record, `events/<team>/ctl`; every phone reads it on its normal 2 second check and keeps a copy so it still applies while offline. Changes that cannot send (no signal) are kept and retried. Admin-only is enforced inside the app: the key is needed to unlock the controls and a volunteer phone never writes the record. The database itself has no logins, so someone who knows the team code and edits the app's own code could still write to it; keep the team code to volunteers. Phones that have not updated to this version yet (or are offline) do not see messages, pauses or locks until they do.

## Where the app is hosted

The live address is **https://ecomsoc-checkout.web.app** (Firebase Hosting, same free Firebase project as the shared food count). It is HTTPS, which the wake lock and offline support need, and the address contains no personal name.

To publish a change: edit the files, bump `CACHE` in `sw.js` (for example `v11`), then run

```bash
./scripts/deploy-hosting.sh
```

It copies **only** the app files (`index.html`, `qr.js`, `sw.js`, `manifest.webmanifest`, `logo.jpg`, `icons/`) into `.deploy/` and publishes them. The tests, documents and the QR images that contain the team code are never uploaded. It needs Node.js and a Firebase login (`npx firebase-tools login`). The Hosting settings (site name, cache headers) are in `firebase.json`.

**Making your own site name:** `npx firebase-tools hosting:sites:create <name> --project <project>` gives `https://<name>.web.app`. Put the name in `firebase.json` under `hosting.site`.

**GitHub Pages (optional, older):** the same files also work on GitHub Pages (Settings, Pages, deploy from the `main` branch root), but the address then contains the GitHub account name, for example `https://<owner>.github.io/<repo>/`. Any static host works the same way.

Viewers need no account.

## On event day

- Every phone: open the join link once **while on Wi-Fi or 4G**, wait for the green "Works offline" badge on Home, then **Add to Home Screen** (iPhone: Share > Add to Home Screen. Android: menu > Install app). On iPhone type the team code in the installed app (see above).
- Check **Summary > App version** reads the same on every phone. New versions install themselves in the background and the phone reloads once it is idle on Home.
- Before the doors open, check that Home shows green "Shared: N phones online" with N equal to the number of volunteer phones, and that the food number is the same on all of them.
- Set the real amount of food in **Summary > Total food at start** (changes it for every phone), or change `defaultStock` in `index.html` before deploying. **Reset** (hold for 2 seconds, then confirm) after practice runs, before the event starts.
- At the end, open **Summary > Copy summary** on any phone and paste it into the exec chat. It already contains the totals for all phones plus a line per phone.
- iPhones older than iOS 18.4 cannot keep the screen on from a web page. Set Settings > Display & Brightness > Auto-Lock to Never for the day.

## Edit things

All settings are at the top of the `<script>` in `index.html`, inside the block marked `SETTINGS`.

| What | Where |
| --- | --- |
| Instagram handle (also changes the QR code) | `CONFIG.handle` |
| Starting food stock (default 80) | `CONFIG.defaultStock`, or live on any phone: **Summary > Total food at start** (shared by everyone) |
| Database URL that shares data | `CONFIG.syncUrl` |
| How often phones check the team numbers | `CONFIG.pollMs` (default 2000) |
| Low-stock warning level (default 15) | `CONFIG.lowStock` |
| HOT DEAL (easy) share of draws (default 70) | `CONFIG.hotDealPercent` (50 = even split) |
| Retries after a wrong answer (default 1, use 0 for one shot) | `CONFIG.retries` |
| Price tag decoration ($15, 90% OFF) | `CONFIG.rrp`, `CONFIG.discountLabel` (decoration only, the food is always free) |
| Colours | CSS variables in `:root` at the top of the `<style>` block |
| Questions | the `QUESTIONS` array, marked `QUESTION POOL` |

Each question has `id`, `difficulty` (`easy` = HOT DEAL, `hard` = FULL PRICE), `question`, `options` (A to D), `answer` (the correct letter) and `fact` (the "Say this" line). Keep ids unique. Each difficulty needs at least one question, and more than one so a question never repeats back to back.

To correct the shared food count mid-day (for example a dropped cup), use **Summary > Food remaining** (+1 / -1) on any phone.

**After editing any file, open `sw.js` and change `CACHE = 'checkout-challenge-v1'` to `v2`, `v3` and so on.** Phones with the old copy then update on their next online visit (open the app twice: the first visit fetches the update, the second shows it).

## How the draw works

- Randomness comes from `crypto.getRandomValues` (unbiased), falling back to `Math.random` only if it is missing.
- Each device keeps **two shuffle bags**, one for easy and one for hard questions (Fisher-Yates). A draw first picks the difficulty (70% easy by default), then takes the next question from that bag. A question is not repeated until its whole bag of 10 is used, then the bag reshuffles. The same question never appears twice in a row, including across a reshuffle.
- The bag position is saved in `localStorage`, so a refresh does not reset it.
- The correct answer is never put in the page while the question is showing: the answer buttons are identical in markup and style until one is tapped. (It does exist in the page's JavaScript source, which is fine for a stall.)

## Counting rules

Per-customer tallies are committed when the customer's first answer is tapped, so a customer cancelled earlier is not counted. Skips are counted straight away. Everything below is totalled across all phones on the team.

- **Customers**, **follows confirmed**, **already following**, **memberships confirmed**, **already members**
- **Answers correct / wrong** (each answer, including retries), **retries given**
- **Customers won** (answered correctly, even if food had sold out) and **customers lost** (no food)
- **HOT DEAL / FULL PRICE draws** (answered draws), **skips**
- **Food served** and **food remaining**, plus first and last customer times

## Phone and outdoor behaviour

When sharing is set up, the only outside network calls are to your Firebase database URL.

Light, high-contrast theme. Question text 26 to 32 px, answers 20 px, body 18 px. Every button is at least 48 x 48 CSS px with 8 px gaps. No sound at all (no audio code). Vibration on results where supported (Android Chrome; iOS ignores it). The screen stays on using the Screen Wake Lock API where supported (Chrome for Android 84+, Safari on iOS 18.4+), with a small indicator on Home. Android's Back button and iOS edge-swipe step back inside the app instead of leaving it. `prefers-reduced-motion` removes the animations and confetti.

## Test

See `RELIABILITY.md` for the full list of scenarios, how each is handled, and the known limits.

The tests use Playwright with Chromium and mobile emulation. They start their own local web server and a local stand-in for the database that can inject faults.

```bash
cd tests
npm install
npx playwright install chromium     # skip if you already have a Chromium: set CHROME_EXE=/path/to/chrome
npm test                            # solo, multi-phone, rules and update suites
```

- `npm run test:solo` (`run.mjs`, 86 checks): one phone at iPhone SE (375 x 667 and the old 320 x 568), iPhone 15 and Pixel 7 sizes. Full flow, correct, wrong, retry, skip, cancel, serve, sold out, Summary, copy and reset. No-repeat shuffle over 2,000 draws. Every question and result screen fits without scrolling or horizontal overflow (including "Bulk Nationwide Parcel Logistics"). 48 px tap targets with 8 px gaps. Answers hidden and identical before a tap. WCAG AA contrast. QR decodes (also dimmed). Offline reload. Blocked storage. No sound. Wake lock and vibrate with and without browser support. Screenshots go to `tests/screenshots/`.
- `npm run test:sync` (`sync.mjs`, 85 checks): up to 6 phones sharing one team. Serves on one phone appear on the others, exact totals after interleaved serves, offline phones catching up with nothing lost or doubled, answers lost in transit, server 500s, a server that never answers, dropped connections, slow servers, out-of-order writes, shared total and manual adjust, reset (including a phone that was offline during it), the last portions, joining by link and by code, rules rejections, junk records, migration of saves from the earlier version, gentle network traffic, hidden phones not polling, and layout and contrast of the new screens.
- `npm run test:scenarios` (`scenarios.mjs`, 99 checks): edge cases. Back button and edge swipe, rotation to landscape, corrupted or odd saved data, a reset from another phone mid-customer, storage wiped mid-event, phones with the wrong clock, a Wi-Fi login page answering instead of the database, odd server data, Serve while the network hangs, unusual phone names, and a 60 second random "monkey" test.
- The same file also covers **links opened inside Instagram and other in-app browsers** (recognition by browser identifier, the guidance screen, the tap-to-open handoff (Instagram on iPhone uses instagram://extbrowser/?url=, because x-safari-https:// is blocked there), the "did not open" warning, Share link, Copy link, Continue anyway, and normal browsers being unaffected).
- `npm run test:safari`: runs the solo, multi-phone, scenario and update suites on **WebKit**, the engine inside every iPhone browser (`npx playwright install webkit` first). Any suite can be pointed at it with `BROWSER=webkit`.
- `npm run test:update` (`sw-update.mjs`, 8 checks): a new version installs from fresh files even when the host allows 10 minute caching, never reloads in the middle of a customer, reloads itself once idle on Home, and opens offline.
- `npm run test:live-e2e`-style run: `BASE_URL=https://<site>/ ADMIN_KEY_FILE=../ADMIN-KEY.private node tests/live-e2e.mjs` (`BROWSER=webkit` for Safari's engine): 71 checks against the DEPLOYED site and the REAL database with a throwaway team: files and manifest, three phones joining by both link styles, a full customer, every other path, offline then back online, offline reload from the cache, reset, all 20 questions on a 320 px phone, screens at seven phone sizes, Instagram browsers, and every organiser feature. Removes everything it wrote.
- `npm run test:soak` (`soak.mjs`): the long one. `ADMIN_KEY_FILE=...` adds an organiser phone that also sends messages, pauses, locks and changes settings at random. Several phones run random customers for minutes against a deployed site and a real database, with random offline spells, refreshes, app-switching and settings taps. At the end every phone and the database must agree exactly. Example: `BASE_URL=https://ecomsoc-checkout.web.app/ SYNC_URL=<db url> DURATION_S=240 PHONES=5 npm run test:soak`. It uses a throwaway team code and deletes its data.
- `npm run test:rules` (`rules-check.mjs`, 36 checks): probes the security rules directly.
- `npm run test:live`: runs the rules probe and the multi-phone tests against **your real database**: `SYNC_URL=https://<db>.firebasedatabase.app npm run test:live`. It uses a random team code and deletes its own data.

Playwright cannot run iOS Safari (WebKit) in this setup, so test on real phones before the event: join the team, add the app to the Home Screen, switch on aeroplane mode, serve a customer, switch it off, and watch the other phone's count change.

## Licences and credits

- The shared count uses the free Firebase Realtime Database through its public REST interface with plain `fetch` (no Firebase code is bundled). Firebase is a trademark of Google LLC.
- QR codes are generated in the browser by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, **MIT licence**, minified and bundled as `qr.js`. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
- `logo.jpg` is the EcomSoc profile picture from the society's public Instagram account, used here as the society's own logo. Replace it with a higher-resolution file if you have one (keep the name `logo.jpg`, or update `index.html`).
- The app icons are original artwork. The app does not use the Instagram logo or the UNSW crest.
