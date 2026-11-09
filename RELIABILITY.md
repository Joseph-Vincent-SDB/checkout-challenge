# Reliability: every scenario considered, how it is handled, how it is tested

No software can honestly promise "every scenario". This list is the set of situations that were deliberately designed for and tested, followed by what is **not** covered. Test names refer to the files in `tests/`.

Test engines: Chromium (Chrome and Android) and WebKit (the engine inside every iPhone browser). Both run the same suites. A real database (Firebase, Singapore) was used for the live runs.

## A. Network problems

| Situation | What the app does | Tested by |
| --- | --- | --- |
| No signal at all | Keeps working. Customers, serves and settings are saved on the phone and queued. Bar turns red: "Offline: food count may be out of date". Sends everything when the signal returns. | `sync.mjs` (3), `scenarios.mjs` (10), soak |
| Weak or slow signal (2 to 3 s per request) | Still converges. Never blocks a customer: Serve waits at most 1.5 s for the latest count. | `sync.mjs` (5), `scenarios.mjs` (8) |
| Server never answers (hangs) | Requests time out after 6 to 7 s, phone shows offline, retries with back-off, recovers by itself. | `sync.mjs` (5) |
| Server returns errors (500) or drops connections | Same as above. | `sync.mjs` (5) |
| Answer sent but the reply is lost | Each phone writes its complete record, so a repeat never double counts. | `sync.mjs` (4) |
| Requests arrive out of order | The database refuses an older revision of a phone's record. | `sync.mjs` (6), `rules-check.mjs` |
| A Wi-Fi login page answers instead of the database | Treated as offline, not as data. | `scenarios.mjs` (7) |
| The server sends odd or wrong-shaped data | Ignored safely. | `scenarios.mjs` (7) |
| Network comes back after a failure | Unsent changes are retried immediately, not after the back-off. | `sync.mjs` (4), soak |
| The database refuses writes (rules or setup problem) | Bar says "Sharing problem". Phone keeps working on its own. Recovers if fixed. | `sync.mjs` (11) |
| Campus Wi-Fi or a content filter blocks `firebasedatabase.app` | **Cannot be tested here.** Phones would work alone (red bar). Test on the campus Wi-Fi before the event, and use mobile data if blocked. | pre-event check |
| Firebase outage | As "no signal". Phones keep working and catch up later. | as above |

## B. The phone itself

| Situation | What the app does | Tested by |
| --- | --- | --- |
| Screen locks or the app is switched away | Customer in progress is kept. On return the phone refreshes immediately. Hidden phones do not poll (battery). | `sync.mjs` (13) |
| Page reloads or the phone kills the tab mid-customer | Resumes on the same screen and the same question. | `run.mjs`, soak |
| Storage cleared mid-event | Asks to join again. The team's count does not change. Serves from before stay counted. Re-join with the link. | `scenarios.mjs` (5) |
| Corrupt or odd saved data (garbage, wrong types, huge numbers) | App starts, values are made safe and within what the database accepts. | `scenarios.mjs` (3) |
| Storage blocked (private browsing) | Works from memory with a warning on Home. | `run.mjs` |
| The app open twice on one phone (tab plus installed app) | The two copies mirror each other and send one record. | `sync.mjs` (10b) |
| Back button (Android) or edge swipe (iPhone) | Steps back inside the app. Never leaves by accident. On a customer it asks first. | `scenarios.mjs` (1) |
| Rotated to landscape | No sideways scroll. Every button can be scrolled into reach. | `scenarios.mjs` (2) |
| Phone clock wrong by hours | Totals unaffected. Online list correct. | `scenarios.mjs` (6) |
| Old phones without vibration or wake lock | Fail silently. Red or amber hints only. | `run.mjs` |
| A link tapped inside Instagram or another chat app (built-in browser) | Detected. It tries once to hand over to the default browser, and a full-screen guide says "Open this in Safari/Chrome", with steps, the team code and a Copy link button. Does not join from inside it. A warning bar stays on Home if the volunteer continues anyway. | `scenarios.mjs` (9b) |
| Safari engine | All suites pass on WebKit. | `BROWSER=webkit` runs |
| New app version released | Installs from fresh files, reloads itself only when idle on Home or Join. Never mid-customer. | `sw-update.mjs` |
| Random chaos (clicks, reloads, rotation, offline blips, errors) | No errors. Numbers stay valid. Phones agree afterwards. | `scenarios.mjs` (10, monkey) |

## C. Sharing and the food count

| Situation | What the app does | Tested by |
| --- | --- | --- |
| New counters (memberships) on a mix of old and new app versions | Database rules accept both record shapes: phones on the older version keep sharing, and unknown counters are still refused. | `rules-check.mjs` (live), `sync.mjs` |
| Several phones serve at once | Exact total. Each phone only writes its own record. | `sync.mjs` (2), soak |
| Phone offline while others serve | Catches up exactly when back. Nothing lost or doubled. | `sync.mjs` (3), soak |
| Last cups | Below 15 left, Serve first fetches the latest count and turns into "Sold out" if the food just went. Screens update by themselves. | `sync.mjs` (9) |
| **Two phones tap Serve on the very last cup in the same instant** | Both can succeed. Count can read one over. **Known limit** (see below). | `sync.mjs` (9) |
| Reset | New "epoch" for everyone, asks first, needs a connection, deletes nothing. | `sync.mjs` (7, 8), `scenarios.mjs` (4) |
| Reset while a phone is offline or mid-customer | The phone adopts the new count when it connects. Its customer carries on. | `sync.mjs` (8), `scenarios.mjs` (4) |
| Change total food or adjust by hand | Shared with everyone. Rapid taps over a slow network are not lost. | `sync.mjs` (7, 15) |
| Join by link, by code, link arriving while the app is open | Works in all three. Asks before clearing a phone's own practice tallies. | `sync.mjs` (10) |
| Phone names with Chinese, emoji, quotes, HTML | Accepted, shared, shown as plain text. | `scenarios.mjs` (9) |
| Someone without the team code | Cannot read or write the team's data. Malformed or out-of-range data is refused by the rules. | `rules-check.mjs` (live) |

## C2. The organiser phone

| Situation | What happens | Tested |
|---|---|---|
| Wrong, short or missing admin key | The phone joins the team as a normal volunteer phone, nothing is unlocked, the app says the key is not valid | yes |
| Admin name edited in stored data | Restored from the app on every load; the name box is locked | yes |
| Admin link opened inside Instagram | The open-in-Safari guide shows, nothing is joined or unlocked there; Copy link keeps the key; Continue anyway applies it | yes |
| Admin change while offline or the database is failing | Kept and retried with back-off; the console says it is waiting to send; lands by itself when the network is back | yes |
| Stored settings are older than this phone's copy ("older revision" refused) | The phone reads the stored copy, continues from its revision and writes again | yes |
| Several quick changes (toggle, toggle, toggle) | One write at a time; the last value of each setting wins | yes |
| Text or wrong types in the settings record, or the record deleted | Wrong shapes are ignored, wrong values are cleaned to safe limits, deleting it returns everyone to the normal defaults | yes |
| Message with HTML in it | Shown as plain text; 140 character limit in the app and the database rules | yes |
| Volunteer phone offline when a message is sent | Shows it as soon as it reconnects | yes |
| Pause while a customer is in progress | That customer can finish; new customers are blocked until resumed; the admin phone is never blocked | yes |
| A volunteer reset of the tallies | The organiser's settings are kept | yes |
| Membership step switched off with a customer on that step | The customer moves on to Reveal deal | yes |
| Smallest phone (320 x 568) | Console and banner fit, buttons 48 px or more, console scrolls | yes |
| Admin phone: closed page, fresh session, damaged saved data, only the cookie or only the second stored copy left | Still the admin with the fixed name (no sign-out exists) | yes |
| Admin key changed in the code (`adminHash`) | Old admin phones stop being admin; a brand-new phone is never admin | yes |
| Organiser phone offline, or no record of it in a new round after a reset | Still listed first on every phone as `Joseph's Phone (Admin)`; volunteer phones show no online, offline or last-seen information for it and do not count it in "phones online" (the screens look the same whether it is online or not); a phone that reloads with no connection shows the same from memory; a phone that joins later sees it too | yes |
| Odd or spoofed organiser record | The name shown is always the fixed organiser name; wrong shapes are ignored | yes |
| Live numbers (food left, phones online, serves per hour, win rate, new follows, new members) | Same numbers on every phone and the organiser phone, update within seconds, fit 320 px wide | yes |

Limits: admin-only is enforced inside the app, not by the database (there are no logins); phones that are offline or running an older copy of the app do not see messages, pauses or locks until they reconnect or update; "serves per hour" comes from the admin phone's own readings, so it needs the admin phone to be open for a few minutes.

## C3. The newer organiser controls (modes, reserve, question pool, speed, phone controls, delivery, undo)

| Situation | What happens | Tested by |
|---|---|---|
| One tap on a stall mode (Rush hour, Quiet time, Clear the stock, Normal) | Membership step, easy-question share and retries change in ONE write (one revision), so every phone switches together. A customer already in progress is not disturbed. Changing any single setting afterwards shows "Custom settings". | `admin.mjs` L |
| A question switched off while a customer is looking at it | That customer keeps it; it is never drawn again on any phone. At least one HOT DEAL and one FULL PRICE question always stay on (the app refuses to switch off the last one, and ignores a database record that would switch off all of a kind). Tampered or junk lists are cleaned. | `admin.mjs` M |
| Hold a phone (for a break) | Only that phone gets "This phone is on hold" and a disabled Next customer button. A customer in progress there can finish and be served. Resume enables it again, in place, without redrawing the screen. At most 14 phones can be held. | `admin.mjs` N |
| A message to one phone | Only that phone shows it (important or normal), before any message for everyone; Got it shows the shared one next. The organiser sees whether it was read. It does not come back after a reload. At most 12 are stored. | `admin.mjs` N |
| Hide a phone (left, or a practice phone) | It leaves the lists, the "phones online" figures, the Shared bar and the alerts on every phone. Its numbers still count in the totals and the CSV. It can be shown again. A hidden phone that goes offline raises no alert. | `admin.mjs` N |
| Update speed (Auto, 2, 4, 8, 15 s) | Every phone checks the team numbers at that speed, with a small random spread (when more than 12 phones are online) so phones never all ask in the same instant. Auto is 2 s up to 12 phones online, then 3, 5, 8 and 12 s as the team grows (checked with 32 phones). The organiser's settings are still checked every few seconds on their own timer, so a slow speed never delays the order to speed up again. An idle heartbeat no longer triggers an extra check, which cuts the load with many phones. | `admin.mjs` O, `traffic.mjs` |
| Network load | The console shows what this phone downloads a minute, and an estimate per hour for the team against the free plan. | `admin.mjs` O |
| Did it arrive? | Phones report the settings version applied, the message read and the app level. The console says "Version N is on X of Y phones" and names the phones still waiting; after 25 seconds without it the alerts name them. Phones on an older copy are listed separately. | `admin.mjs` P, `traffic.mjs` |
| Low battery | Where the browser reports it (Chrome on Android): an alert for a phone at 20% or less that is not charging. iPhones do not report battery, so nothing is shown for them. | `admin.mjs` P |
| Refresh all phones | Idle phones reload within a few seconds; a phone in the middle of a customer waits and reloads when it is idle again; the organiser phone does not reload; a reloaded phone does not reload again; a phone that joins later does not reload for an old request. | `admin.mjs` P |
| The app is published against older database rules | The newer fields are refused, the phones notice, fall back to the basic record and keep sharing (no "Sharing problem"); the basic organiser settings still land; the console shows a red alert to publish the rules; the newer controls start working again a few minutes after the rules are published. (Publish the rules first: `./scripts/deploy-hosting.sh` does.) | `admin.mjs` P |
| Keep the last N portions back | When the food left reaches N, volunteer phones stop starting customers (banner and button say why); a customer already at the Serve screen can still be served; the admin phone is never stopped; lowering or switching it off opens the stall again in place. | `admin.mjs` Q |
| Undo and the change list | Undo reverses the last change (a quick run of taps is one step), also after a reload; the list shows the last 8 changes from every organiser phone with the time and who. | `admin.mjs` R |
| Two organiser phones change different settings at once | Each write first reads the stored record and puts only its own changes on top, so neither wipes the other's. If both change the same setting the later one wins. | `admin.mjs` R |
| An organiser change cannot be sent (database unreachable) and the page is closed and opened again | The change is remembered and sent by itself once the database is reachable. | `admin.mjs` R |
| Settings from the first organiser version, wrong types in any newer field, out-of-range numbers, junk lists, damaged messages or change list | Read with safe defaults; values limited (speed 30 s, reserve 200, 140 characters); bad entries dropped. The largest possible record (14 held, 14 hidden, 12 messages, 8 change lines, a message) is under 8 KB and accepted by the rules. | `admin.mjs` S, `rules-file.mjs` |
| The settings record is deleted | Every newer control returns to normal on every phone. | `admin.mjs` S |
| Smallest phone (320 x 568) | The long console (question list open), the phone dialog, the hold banner and a 140-character message all fit; every button is 48 px or more; the dialog scrolls inside the screen. | `admin.mjs` T |
| Many phones online at once | See `traffic.mjs`: 24 volunteer phones and 2 organiser phones, real customers, offline spells and refreshes, while the organiser changes something every few seconds. Every change reaches every phone; the totals agree exactly at the end. | `traffic.mjs` |
| Rules file | `database.rules.json` itself is evaluated for 62 cases (every newer field at and beyond its limits), and the stand-in database used by the tests is compared case by case. A hole this found (a plain text value accepted where per-phone messages go) was fixed. | `rules-file.mjs` |

## D0. High-traffic runs (many phones online at once)

`node traffic.mjs`: 24 volunteer phones and 2 organiser phones for 90 seconds against a stand-in database with 25 to 115 ms of delay on every request. Volunteers run real customers (one or two a minute per phone is normal; the test pushes about three), go offline for a few seconds and refresh, while the organiser phones change a mode, pause, lock, update speed, reserve, a question, a hold, a hide, a message or Undo every few seconds. Results (the latest runs, Chromium, and Chromium mixed with WebKit):

| What | Result |
|---|---|
| Changes made | 12 and 13 (each waited for every phone before the next) |
| Arrival on a phone that was online and not reloading | median 1.7 to 2.0 s, 95th percentile 3.9 to 4.2 s, worst 5.2 to 5.4 s |
| Until EVERY phone held a change (including phones that were offline for a few seconds) | median 3.5 s, worst 6.4 to 10 s |
| Tap-to-screen on the organiser phone | under 25 ms |
| Customers run / served | 187 to 340 / 173 to 267 |
| Final state | every phone and the database agree on every counter; every phone on the organiser's last settings; the "Did it arrive?" panel all green; nobody over-served |
| Database requests | about 1.5 to 1.9 per second per phone while every phone is busy (Auto slows the team numbers down as phones join) |
| Errors | none: no JavaScript errors, no unhandled promise rejections on any of the 26 phones |

What made the arrival time short: phones check the organiser's settings on their own 3 second timer (independent of the chosen update speed), write only their own record, and a burst of taps on a big team shares one follow-up check.

## D. Long runs

Soaks against the real database, all passing: 5 phones for 4 minutes (144 customers, all 80 portions served exactly once), 8 phones for 200 seconds (206 customers), and a **6 phone, 20 minute run mixing Chromium and WebKit phones** (876 customers, 709 serves, 71 offline spells, 41 refreshes, 38 app-switches). After each, every phone and the database agree on every counter, with no JavaScript errors, gentle network use (about 1.3 requests per second per phone), no memory growth (JS heap 1.00x after 20 minutes) and small saved data (under 2 KB per phone).

**Newer organiser controls, live on the real database** (a preview build of this version against the real Firebase database, throwaway team codes, everything removed afterwards): the live end-to-end test 88 of 88 on Chromium and 88 of 88 on WebKit (it now also drives modes, question pool, hold, a message to one phone, reserve, update speed, delivery tracking, undo, refresh all phones and the change list); a 300 second soak with 8 phones (4 Chromium, 4 WebKit) plus an organiser phone that also used every newer control at random: 205 customers, 86 served, every phone and the database agree exactly on every counter and on the organiser's settings, no JavaScript errors, no memory growth, 16 of 16 checks; and the rules probe 96 of 96 against the real database.

## E. Known limits (not bugs, but be aware)

1. **Live to within about 2 seconds, not instant.**
2. **Last-cup race.** Two phones tapping Serve for the last cup within about a second of each other can both serve it. The count then reads one over, and the Summary says so. Keep a physical eye on the food at the very end. **The organiser's reserve removes the race for volunteers:** set "Keep the last portions back" to at least the number of volunteer phones (for example 6 phones: keep 6). Volunteer phones then stop starting customers while food is still left, at most one customer per phone is still in progress, and the organiser phone alone hands out the kept-back food. (In the 24-phone traffic test the stock is large on purpose; running the stock to zero with 24 phones tapping at once over-served by 1, as this limit says.)
3. **An offline phone cannot see other phones' serves.** If several phones are offline near the end, food can be over-served. The red bar tells you.
4. **Reset needs a connection** and affects every phone. It cannot be undone from the app (the old numbers stay in the database).
5. **iPhone Home Screen app has separate storage** from Safari. Type the team code once in the installed app.
6. **Safari deletes website storage after 7 days without use** (browser tabs only, not the installed app). Open the app within a week of the event.
7. **Links tapped inside Instagram, Facebook, Messenger, TikTok or Snapchat open in that app's own built-in browser**, which has separate storage and no offline support. No web page can force that browser to leave, so the app does the best it can. On **Android** it tries once by itself (an `intent://` link in a hidden frame, default browser, never forced to Chrome). On **iPhone** nothing is tried automatically, because Instagram only accepts a tap (and `x-safari-https://`, the old trick, has been blocked in Instagram since 2026): the big **Open in Safari** button uses Instagram's own `instagram://extbrowser/?url=` link. If the page is still on screen about 2 seconds after the tap, the app shows a red **"Instagram did not open Safari"** notice. The always-working routes are on the same screen: the **⋯ menu > Open in external browser**, **Copy link** (then paste in Safari) and, where the phone supports it, **Share link**. These handoff links are unofficial and the real Instagram app could not be tested here, so treat it as likely but not guaranteed. The app never joins the team from inside the built-in browser. If the handoff does not work, the guide screen is the fallback. Tested with browser identifiers for Instagram, Facebook, Messenger, TikTok and Snapchat on both engines, including that it tries only once, never loops, and leaves the page intact if the link is not understood.
8. **Anyone with the team code can see and change the food count.** Share it with volunteers only.
9. The free Firebase plan allows 100 connections and 10 GB of downloads a month. Five phones use well under 1% of that.

## F. Not tested here

- Real iPhones and Android phones (only the Chrome and Safari engines with phone sizes).
- Campus Wi-Fi and its filtering.
- Real sunlight and one-handed use at a busy stall.
- Battery life over a full two hours.

## G. Before the event

1. Every phone: open the link on the campus Wi-Fi **and** on mobile data once. Wait for the green "Works offline" badge. Add to Home Screen. On iPhone type the team code in the installed app.
2. Home on every phone shows the green bar and the same food number. The "Shared: N phones online" number equals the number of volunteer phones.
3. Set the real food total (Summary, Total food at start) and **Reset** once after practice.
4. Run 3 practice customers across 2 phones. Put one phone in aeroplane mode, serve a customer on it, switch it back on, and watch the other phone catch up.
5. Name each phone in Summary.
6. Keep spare mobile data (a hotspot) in case the Wi-Fi blocks Firebase.
