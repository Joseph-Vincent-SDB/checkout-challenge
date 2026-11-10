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
- The count is live to within about 2 seconds, not instant. When 15 or fewer remain, tapping **Serve food** first fetches the latest team count, and if the food has just run out the screen turns into the Sold out version instead of serving. **Every serve first claims its serve number in the database** ("serve number 67 of this round"): the database lets only the first phone create a number, so two phones can never both hand out the last cup, however many tap at the same instant (20 phones tapping Serve together on 1, 3, 8 and 15 portions served exactly that many each time). A phone with no connection (or one whose database rules do not yet know claims) serves as before, so only offline phones can still over-serve. If that ever happens the Summary and Copy summary say "over-served by N".
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

**If a phone does not show up in Phones (or you do not show up on theirs).** The Phones list is built from what each phone writes to the database, so a phone that is not on the team writes nothing and nobody sees it. Check on THAT phone, in this order:
1. **Home status bar.** Green "Shared: N phones online" = it is on the team and its updates are being sent. Amber "Not shared: tap to join" = it never joined: tap the bar and type the team code (or scan the join QR). Amber "Connected, but alone on this team" (after 20 seconds, on a volunteer phone that finds no organiser and no other phone) = it joined a team nobody else is on: the bar shows the team code, compare it with the organiser's (a mistyped code is exactly this). Red "Other phones cannot see this phone" = it can read the team but its own updates keep failing (poor signal, a blocking network, a content blocker): it keeps trying and turns green again by itself. Red "Offline" = no signal or the database cannot be reached.
2. **"Open this in Safari / Chrome" screen.** The link was opened inside Instagram's (or another app's) built-in browser. By design the app does **not** join from inside it. Either open the link in Safari or Chrome (the **Open in Safari** button, the **...** menu > Open in external browser, or **Copy link** and paste it into Safari), or tap **Continue here anyway** (it joins, but that browser has no offline mode and can lose tallies).
3. **Team code.** Summary > Team code must equal the organiser phone's. A code typed with a mistake silently creates a different team. Everyone who joins through the same link or QR is on the same team.
4. **App in the background.** A phone whose screen is off or whose browser is in the background stops talking to the database and shows as "not seen lately"; it is back within seconds of opening it again.
5. **A Reset** starts a new round: phones appear again as soon as they next report (a few seconds with the app open).
A phone that cannot be fixed this way can be checked from the organiser phone: `cd tests && BASE_URL=https://<site>/ LINK_FILE=../VOLUNTEER-MESSAGE.md node team-check.mjs` joins your REAL team with a fresh test phone through your volunteer link (also inside Instagram), confirms it appears for everyone and sees the organiser phone, and removes itself.

## The organiser (admin) phone

One phone is the organiser's. It has everything a volunteer phone has, plus an **Organiser console**. Volunteer phones keep all their existing controls (food total, food remaining, reset, naming the phone).

**Becoming the admin, and staying the admin.** Open the private admin link once on that phone: `https://<your site>/#t=TEAMCODE&a=ADMINKEY`. The phone joins the team, is named `Joseph's Phone (Admin)` (the name is fixed, see `adminLabel` in `index.html`) and shows an ADMIN badge. The key leaves the address bar immediately. There is no sign-out: a phone that has been made the admin stays the admin through closing the page, a fresh session and a restart. The app keeps extra copies of the admin mark (a second stored item and a 400-day cookie) so damaged or partly cleared data cannot drop it, and asks the browser to keep this site's data. If the browser itself wipes everything (Safari deletes website data after 7 days without use in a normal tab, or you clear website data), scan the QR again: Home Screen apps are not subject to the 7 day rule. If the app is installed on the Home Screen (separate storage on iPhone), use **Summary > Organiser sign-in** and paste the key or the whole link instead. Changing the key (`adminHash`) ends admin status on every old phone.

**A quiet admin (second admin phone).** To give another phone every admin power without it showing as an admin, send that person the same link with `c=` in place of `a=`: `https://<your site>/#t=TEAMCODE&c=ADMINKEY` (or let them paste that whole link into Summary > Organiser sign-in). That phone gets the ADMIN pill, the Organiser console, pause and lock, settings and messages, and it is not blocked by a pause. It is **not** the named organiser phone: it has its own fixed name, `Skyson's Phone` (see `quietLabel` in `index.html`; the name box is locked; a phone that already was a quiet admin takes the new name the next time the app loads), it does not write the organiser record (`events/<team>/admin`, so `Joseph's Phone (Admin)` stays first and unchanged in Phones), and on every other phone it is listed as a normal phone with a normal online status. It stays a quiet admin through restarts and partly cleared data (its stored marks are tagged `:q`). **A phone that is already signed in as the named organiser phone** (for example it used the normal admin link before the quiet link existed) cannot be renamed by the app, but the quiet link fixes it: open the `c=` link on that phone once and it becomes a quiet admin, takes the quiet name, keeps every admin power, stops writing the organiser record (and removes that record if it names this phone) and stays quiet through restarts. The other way round never happens: a quiet admin that opens the normal `a=` link stays quiet, and a wrong key changes nothing. A phone's name in everyone's Phones list is whatever that phone last wrote, so an old row from a phone that has not opened the app for a while keeps its old name until it does; you can tap that row on the organiser console and choose **Hide this phone**. Treat the `c=` link like the `a=` link: it carries the key, so send it privately. If two admin phones change settings at the same moment, the later change wins. Changing `adminHash` ends quiet admins too.

**The key.** `CONFIG.adminHash` holds only the SHA-256 of the key, so the key is not in the code or the database. To make a new key: generate 24 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, put the SHA-256 (hex) of that text in `adminHash`, and share only the link with the key. Keep the key and the admin QR private (they are in git-ignored files).

**Live numbers on every phone.** Home and Summary show, for all volunteers and the organiser: food left, phones online (of all phones), serves per hour, win rate, new follows and new members. Serves per hour is worked out on each phone from its own readings of the team total over the last 15 minutes (or since the first customer when it has less than a few minutes of readings), so two phones can differ slightly; Summary says which basis is used.

**What the console does** (all of it only on the admin phone; every change reaches every phone in a few seconds and is applied in place, without a reload and without disturbing a customer who is in progress):
- **Alerts:** low food, sold out, a phone that went offline, over-served, this phone offline, changes waiting to send, low phone battery, phones on an older copy of the app, phones that have not received your latest changes, phones on hold, the reserve reached, and database rules that are older than the app.
- **Live numbers:** food left, phones online, serves per hour (from this phone's own readings, or since the first customer), win rate, serves, follows, members, a sell-out time estimate, and every phone with its own numbers, online state and battery.
- **Stall modes (one tap):** **Normal**, **Rush hour** (no membership step, 90% easy questions, no retry: the fastest line), **Quiet time** (membership on, 50% easy, two retries) and **Clear the stock** (no membership step, easy questions only, two retries). A mode sets membership step, easy-question share and retries together in one write, so every phone switches at the same moment. Changing any single setting afterwards shows "Custom settings".
- **Pause the stall** and **Lock volunteer settings** (as before).
- **Keep the last portions back (reserve):** set a number (Off, 5, 10, 20 or any value with -1/+1). When the food left reaches it, volunteer phones stop taking new customers, with a banner saying why. A customer already in progress can finish and be served. The admin phone is never stopped, so you can hand out the kept-back food yourself. It works from the shared food count, so it needs no clock and no pause.
- **Question pool:** switch single questions on or off (for example one the crowd has overheard). A switched-off question is never drawn on any phone. A customer who already has it can finish. One question of each kind (HOT DEAL, FULL PRICE) always stays on. "Turn all questions on" undoes it.
- **Event settings for every phone:** membership step on or off, HOT DEAL chance (0 to 100 in steps of 10) and extra questions after a wrong answer (0 to 2).
- **Update speed (traffic control):** Auto, 2, 4, 8 or 15 seconds, for every phone. Every phone downloads every other phone's record each time it checks, so the load grows with the square of the team size. **Auto** (the default) keeps 2 seconds up to 12 phones online and slows down by itself as more phones join (3 s up to 24, 5 s up to 40, 8 s up to 70, 12 s beyond). The console shows what this phone downloads a minute and an estimate for the whole team per hour against the free plan. With more than 12 phones online each phone's check time is also spread by a small random amount, so they never all ask in the same instant.
- **Phone controls (tap a phone in the Phones list):** **Put on hold** (that phone cannot start new customers, for a break; a customer in progress can finish) and **Resume**; **send a message to that phone only** (a banner on that phone alone, Normal or Important, with quick messages); **Hide from the lists** (a phone that left, or a practice phone: it is left out of the lists, the online count and the alerts, while its numbers still count in the totals; "Hidden phones" on the console shows it so you can show it again).
- **Did it arrive?:** every phone tells the database which settings version it has applied, which messages it has read, its app level and (where the browser reports it, which is Chrome on Android; iPhones do not) its battery. The console shows "Version 42 is on 8 of 8 phones", names the phones that are still waiting, shows how many phones have tapped Got it on your message, lists phones running an older copy of the app, and raises an alert if a phone has not received your changes after 25 seconds.
- **Refresh all phones:** each phone reloads the app when it is idle on Home, Summary or Help (never in the middle of a customer) and asks for a newer copy first. Use it after publishing a new version. A phone that joins afterwards does not reload for an old request, and a request can never cause a reload loop.
- **Undo, and a change list:** the **Undo** button at the top of the console reverses your last change (a mode, a pause, a sent message ...). A quick run of taps on one setting counts as one step. The last 12 steps are kept on this phone, also after a reload. **Recent changes** shows the last 8 changes from every organiser phone, with the time and who made them.
- **Message to every phone:** type or pick a quick message (140 characters), Normal or Important. It shows as a banner on every volunteer phone until they tap Got it, even mid-customer. Clear it any time.
- **Organiser first in Phones:** on every phone, Summary > Phones lists `Joseph's Phone (Admin)` first, always, even right after a reset. Volunteer phones are not told whether it is online or offline or when it was last seen, and they do not count it in "phones online" (Home tiles and the Shared bar). The admin phone itself sees every phone's online state. The organiser phone keeps its own small record (`events/<team>/admin`: id, name, heartbeat) that a reset does not clear; this hiding is done in the app, the heartbeat is still stored in the database.
- **Reports:** **Copy admin report** (the normal summary plus pace, win rate, current settings including mode, reserve and update speed, every phone, hidden phones and the recent changes) and **Copy phone table (CSV)** (one line per phone and a TOTAL line, ready to paste into a spreadsheet).

**How it works and what it does not do.** The admin phone writes one shared record, `events/<team>/ctl`; every phone reads it about every 3 seconds, whatever update speed is chosen for the team numbers (the organiser phone itself about every 6) and keeps a copy so it still applies while offline. When the organiser phone writes, it first reads the stored record, puts only its own changes on top and writes the result, one request at a time. So a second organiser phone (a quiet admin) can change other settings at the same moment and neither wipes the other's changes; if both change the same setting, the later one wins. A change that cannot be sent (no signal, database down) is kept, also across a restart of the page, and goes out by itself. Admin-only is enforced inside the app: the key is needed to unlock the controls and a volunteer phone never writes the record. The database itself has no logins, so someone who knows the team code and edits the app's own code could still write to it; keep the team code to volunteers. Phones that have not updated to this version yet (or are offline) do not see the newer controls until they do, and the console lists them.

**Publishing order matters.** This version adds a few optional fields to the records (see `database.rules.json`). The new rules accept both old and new phones, so **publish the rules first, then the app** (`./scripts/deploy-hosting.sh` does it in that order). If the app is ever published against older rules, the phones notice that the database refuses the extra fields, fall back to the basic record and keep sharing, the basic organiser controls (pause, lock, message, mode settings for membership, easy share and retries) keep working, and the console shows a red alert to publish the rules. The newer controls start working by themselves a few minutes after the rules are published.

## Where the app is hosted

The live address is **https://ecomsoc-checkout.web.app** (Firebase Hosting, same free Firebase project as the shared food count). It is HTTPS, which the wake lock and offline support need, and the address contains no personal name.

To publish a change: edit the files, bump `CACHE` in `sw.js` (for example `v11`), then run

```bash
./scripts/deploy-hosting.sh
```

It publishes the **database rules first** (`database.rules.json`) and then the app, because the app of this version writes a few optional fields that older rules refuse (see "Publishing order matters" above). `SKIP_RULES=1 ./scripts/deploy-hosting.sh` publishes the app only when the rules have not changed. After publishing the rules, `cd tests && SYNC_URL=<db url> node rules-check.mjs --live` checks the real rules (it uses a throwaway team and removes its data).

It copies **only** the app files (`index.html`, `qr.js`, `sw.js`, `manifest.webmanifest`, `logo.jpg`, `icons/`) into `.deploy/` and publishes them. The tests, documents and the QR images that contain the team code are never uploaded. It needs Node.js and a Firebase login (`npx firebase-tools login`). The Hosting settings (site name, cache headers) are in `firebase.json`.

**Trying a new build without touching the live site:** `npx firebase-tools hosting:channel:deploy <name> --project <project> --expires 7d` publishes the app to a temporary address (it prints it) that uses the same database. Run `BASE_URL=<that address>/ ADMIN_KEY_FILE=../ADMIN-KEY.private node tests/live-e2e.mjs` and the soak against it, and publish to the live site only when they pass. (The database rules are shared by both, so publish the rules first.)

**Making your own site name:** `npx firebase-tools hosting:sites:create <name> --project <project>` gives `https://<name>.web.app`. Put the name in `firebase.json` under `hosting.site`.

**GitHub Pages (optional, older):** the same files also work on GitHub Pages (Settings, Pages, deploy from the `main` branch root), but the address then contains the GitHub account name, for example `https://<owner>.github.io/<repo>/`. Any static host works the same way.

Viewers need no account.

## On event day

- Every phone: open the join link once **while on Wi-Fi or 4G**, wait for the green "Works offline" badge on Home, then **Add to Home Screen** (iPhone: Share > Add to Home Screen. Android: menu > Install app). On iPhone type the team code in the installed app (see above).
- Check **Summary > App version** reads the same on every phone (it reads 2.2 now). **Every phone keeps itself up to date:** it looks for a newer copy of the app every 10 minutes while the app is open and has signal, and whenever the phone comes back to the app or gets its signal back. A new copy installs in the background and the phone reloads once it is idle on Home or the Join screen, never in the middle of a customer. The **organiser console lists every phone that is not on the newest copy** (alert "... run an older copy of the app", "older app copy" on its row, "App version" under "Did it arrive?"): tap **Refresh all phones** and each phone reloads when idle. A phone that has been switched off or has no signal updates the next time its app is opened with a connection (open it on Wi-Fi or 4G once). Phones still on a copy older than 2.2 only look for updates when the app is opened, so reopen the app on those once.
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
- `npm run test:sync` (`sync.mjs`, 86 checks): up to 6 phones sharing one team. Serves on one phone appear on the others, exact totals after interleaved serves, offline phones catching up with nothing lost or doubled, answers lost in transit, server 500s, a server that never answers, dropped connections, slow servers, out-of-order writes, shared total and manual adjust, reset (including a phone that was offline during it), the last portions, joining by link and by code, rules rejections, junk records, migration of saves from the earlier version, gentle network traffic, hidden phones not polling, and layout and contrast of the new screens.
- `npm run test:scenarios` (`scenarios.mjs`, 114 checks): edge cases. Back button and edge swipe, rotation to landscape, corrupted or odd saved data, a reset from another phone mid-customer, storage wiped mid-event, phones with the wrong clock, a Wi-Fi login page answering instead of the database, odd server data, Serve while the network hangs, unusual phone names, and a 60 second random "monkey" test.
- The same file also covers **links opened inside Instagram and other in-app browsers** (recognition by browser identifier, the guidance screen, the tap-to-open handoff (Instagram on iPhone uses instagram://extbrowser/?url=, because x-safari-https:// is blocked there), the "did not open" warning, Share link, Copy link, Continue anyway, and normal browsers being unaffected).
- `npm run test:safari`: runs the solo, multi-phone, scenario and update suites on **WebKit**, the engine inside every iPhone browser (`npx playwright install webkit` first). Any suite can be pointed at it with `BROWSER=webkit`.
- `npm run test:update` (`sw-update.mjs`, 8 checks): a new version installs from fresh files even when the host allows 10 minute caching, never reloads in the middle of a customer, reloads itself once idle on Home, and opens offline.
- `npm run test:live-e2e`-style run: `BASE_URL=https://<site>/ ADMIN_KEY_FILE=../ADMIN-KEY.private node tests/live-e2e.mjs` (`BROWSER=webkit` for Safari's engine): 88 checks against the DEPLOYED site and the REAL database with a throwaway team: files and manifest, three phones joining by both link styles, a full customer, every other path, offline then back online, offline reload from the cache, reset, all 20 questions on a 320 px phone, screens at seven phone sizes, Instagram browsers, and every organiser feature including the newer controls (modes, question pool, hold, message one phone, reserve, update speed, delivery tracking, undo, refresh all phones, the change list). Removes everything it wrote.
- `node admin.mjs` (organiser phone, 277 checks in 20 sections A to T): who is the admin and staying the admin, messages, pause and lock, event settings, delivery under failures and odd data, live numbers, small screens, the Instagram browser, the quiet admin, and the newer controls: stall modes, the question pool, hold / message one phone / hide, update speed and the load figures (including 32 phones online), delivery tracking, battery, refresh all phones, database rules older than the app, the reserve, undo and the change list, two organiser phones writing at once, a change that survives a restart, odd and old data, and the longer console and dialogs on the 320 x 568 phone.
- `node traffic.mjs` (**high traffic**): by default 24 volunteer phones plus 2 organiser phones online at once for 90 seconds (`PHONES=40 DURATION_S=180 node traffic.mjs` for more; `MIX=1` runs every second phone on WebKit) against a stand-in database with 25 to 115 ms of delay on every request. Volunteers run real customers, go offline, refresh, while the organiser phones change modes, pause, lock, update speed, reserve, questions, holds, hides, messages and undo every few seconds. It measures how long each change takes to reach EVERY phone (median, 95th percentile, worst case), that the console answers a tap immediately, that the delivery panel ends all green, that every phone and the database agree exactly at the end, that nobody was over-served, the database requests per second per phone, and that there are no JavaScript errors or unhandled rejections.
- `node buttons.mjs` (87 checks, 70 button actions): taps EVERY button of the app on real phones (customer flow, Summary, Help, sharing and joining, the Instagram screen, every organiser control, refresh all phones, and the hold-to-reset gesture), checks what each does, records every tap in the page itself and FAILS if any button action in the code was never tapped. `BASE_URL=https://<site>/ ADMIN_KEY_FILE=../ADMIN-KEY.private node buttons.mjs` runs it against the deployed site and the real database (the list of buttons is read from the deployed page; it removes everything it wrote).
- `node upgrade.mjs` (13 checks): phones that run the PREVIOUS build (with saved state: joined team, name, tallies, organiser status) stay open while the current build is released; they must switch by themselves, keep their team, identity, name and tallies, see each other in both directions, and sync a serve, the food count and an organiser setting with a brand new phone. `OLD_COMMIT=<commit>` chooses the old build.
- `node visibility.mjs` (23 checks): "do the phones see each other, and does the app say so when they cannot?" A joining phone is listed on the others within seconds and leaves no stray record in an old round; a phone whose updates are blocked (it can read, not send) shows a red "Other phones cannot see this phone" bar, keeps its changes and recovers by itself with nothing lost; a phone on a mistyped team code never mixes with the real team and, after 20 seconds alone, shows an amber bar with the code to compare. It also checks that volunteer phones list the organiser phone by name only (its own customers and served numbers are for the organiser; they still count in the team totals and the food count), in the Phones list and in the copied summary, while the organiser phone sees every number.
- `node team-check.mjs` (11 checks): joins your REAL team through your volunteer link with fresh test phones (in Safari or Chrome, and inside Instagram) and checks they appear in the database, see the organiser phone and each other; removes its own records.
- `node race.mjs` (23 checks): the last-cup race. 20 phones stand on the Serve screen with 1, 3, 8 and 15 portions left and ALL tap Serve at the same instant; exactly that many serves must succeed and the rest must be told it is sold out. Also: a phone with no connection still serves and sends later, and database rules that do not know claims do not break serving. (Run against the previous build it served 13 of 1 portion and 20 of 3, 8 and 15.)
- `node crowd.mjs` (12 checks): a very large team. 150 simulated phones kept online in the database plus 6 real phones running customers while the organiser changes things: Auto slows to 12 s, every organiser change still reaches every real phone in under 9 s, totals match exactly, download per phone, longest main-thread task, no errors.
- `node rules-file.mjs` (80 checks): tests `database.rules.json` ITSELF with a small evaluator of the rules language (`rules-engine.mjs`, no Java or emulator needed) and checks that the stand-in database used by the other tests answers every case the same way as the file. `node rules-check.mjs` (109 checks) probes the rules over REST, against the stand-in or, with `--live`, against the real database.
- `npm run test:soak` (`soak.mjs`): the long one. `ADMIN_KEY_FILE=...` adds an organiser phone that also sends messages, pauses, locks and changes settings at random. Several phones run random customers for minutes against a deployed site and a real database, with random offline spells, refreshes, app-switching and settings taps. At the end every phone and the database must agree exactly. Example: `BASE_URL=https://ecomsoc-checkout.web.app/ SYNC_URL=<db url> DURATION_S=240 PHONES=5 npm run test:soak`. It uses a throwaway team code and deletes its data.
- `npm run test:rules` (`rules-check.mjs`, 36 checks): probes the security rules directly.
- `npm run test:live`: runs the rules probe and the multi-phone tests against **your real database**: `SYNC_URL=https://<db>.firebasedatabase.app npm run test:live`. It uses a random team code and deletes its own data.

Playwright cannot run iOS Safari (WebKit) in this setup, so test on real phones before the event: join the team, add the app to the Home Screen, switch on aeroplane mode, serve a customer, switch it off, and watch the other phone's count change.

## Licences and credits

- The shared count uses the free Firebase Realtime Database through its public REST interface with plain `fetch` (no Firebase code is bundled). Firebase is a trademark of Google LLC.
- QR codes are generated in the browser by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 by Kazuhiko Arase, **MIT licence**, minified and bundled as `qr.js`. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
- `logo.jpg` is the EcomSoc profile picture from the society's public Instagram account, used here as the society's own logo. Replace it with a higher-resolution file if you have one (keep the name `logo.jpg`, or update `index.html`).
- The app icons are original artwork. The app does not use the Instagram logo or the UNSW crest.
