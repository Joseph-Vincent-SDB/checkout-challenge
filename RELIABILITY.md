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

## D. Long runs

Soaks against the real database, all passing: 5 phones for 4 minutes (144 customers, all 80 portions served exactly once), 8 phones for 200 seconds (206 customers), and a **6 phone, 20 minute run mixing Chromium and WebKit phones** (876 customers, 709 serves, 71 offline spells, 41 refreshes, 38 app-switches). After each, every phone and the database agree on every counter, with no JavaScript errors, gentle network use (about 1.3 requests per second per phone), no memory growth (JS heap 1.00x after 20 minutes) and small saved data (under 2 KB per phone).

## E. Known limits (not bugs, but be aware)

1. **Live to within about 2 seconds, not instant.**
2. **Last-cup race.** Two phones tapping Serve for the last cup within about a second of each other can both serve it. The count then reads one over, and the Summary says so. Keep a physical eye on the food at the very end.
3. **An offline phone cannot see other phones' serves.** If several phones are offline near the end, food can be over-served. The red bar tells you.
4. **Reset needs a connection** and affects every phone. It cannot be undone from the app (the old numbers stay in the database).
5. **iPhone Home Screen app has separate storage** from Safari. Type the team code once in the installed app.
6. **Safari deletes website storage after 7 days without use** (browser tabs only, not the installed app). Open the app within a week of the event.
7. **Links tapped inside Instagram, Facebook, Messenger, TikTok or Snapchat open in that app's own built-in browser**, which has separate storage and no offline support. No web page can force that browser to leave, so the app does the best it can: in Instagram and Facebook it **tries once, by itself, to hand the link to the phone's default browser** (iPhone: `x-safari-https://`, Android: an `intent://` link without forcing Chrome, so the default browser is used), and the screen it shows has a big **Open in Safari / Open in browser** button, a **Copy link** button and the menu steps. These handoff links are unofficial and the real Instagram app could not be tested here, so treat it as likely but not guaranteed. The app never joins the team from inside the built-in browser. If the handoff does not work, the guide screen is the fallback. Tested with browser identifiers for Instagram, Facebook, Messenger, TikTok and Snapchat on both engines, including that it tries only once, never loops, and leaves the page intact if the link is not understood.
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
