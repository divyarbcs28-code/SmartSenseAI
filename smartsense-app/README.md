# SmartSense — Predict. Rest. Recover.

An engineering-prototype driver-safety dashboard built from the SIH 2026 problem
statement (PS 26220 — *AI-based Multimodal Wearable for Predictive Driver
Drowsiness Detection and Intelligent Alert and Rest Management*), the project's
system-design document, the existing `smartsense-driver-ai` prototype, and the
visual/product-design language of `SOMNUS-AI`.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview   # serves the dist/ build
```

Requires Node 18+. Most of the app runs entirely client-side, including
real nearby-place lookup (Rest Management), which uses the free, keyless
OpenStreetMap Overpass API — see **Real GPS & safe zones** below. **A
connected Supabase project is required, though**: the app signs every
driver in with a real account (Register/Sign-in) before anything else is
reachable, and that needs a real backend to authenticate against. See
**Required: connecting a database (Supabase)** below — it only takes a few
minutes and the free tier is enough for this.

## Stack

React 18 + TypeScript + Vite + Tailwind CSS v4 + react-router-dom + recharts
+ lucide-react + Supabase (Auth + Postgres). The original driver-ai
prototype's account system was intentionally removed early in this
project so the app could run standalone with zero configuration; it's
since been reintroduced as a real Supabase-backed login, because a
driver-safety product genuinely needs to know who it's talking to before
anything past the front door.

## Project structure

```
src/
  lib/
    smartsense.tsx   – global state, rule-based Rest Decision Engine,
                       vigilance/trend/sleep-state logic, i18n (6 languages),
                       theme persistence, the auto-simulation tick loop,
                       dynamic wake-window/recovery calculation, the demo
                       5-stage drowsiness control
    routing.ts       – free OSRM driving-route lookup + route-corridor
                       sampling (used by Trip Planner & Rest Management)
    geocoding.ts     – free OpenStreetMap Nominatim destination search
    safeZones.ts     – rankSafeZones(): 5-stage weighted rest-stop ranking
    places.ts        – OpenStreetMap Overpass lookup (radius-around-driver
                       and along-route-corridor variants)
    supabaseClient.ts – Supabase client + isSupabaseConfigured
    auth.ts          – real Register/Sign-in/Sign-out + useAuthSession()
    dbSession.ts     – provisions users/devices rows for the signed-in
                       driver; starts/ends sleep_sessions rows around REST
    alarmSound.ts    – the audible Smart Alarm (Web Audio beeps + vibration)
    utils.ts         – cn(), duration formatting, clamp
  components/
    AppShell.tsx     – Sidebar, Topbar, AlarmBanner, Card, Pill, Button,
                       Gauge, Sparkline, Waveform, PageIntro, Metric,
                       SafetyStageStrip, EmptyState
  pages/
    Register.tsx        Create-account screen (real Supabase Auth)
    Login.tsx            Sign-in screen
    DatabaseRequired.tsx  Shown instead of the app if Supabase isn't
                           configured at all — setup instructions
    Overview.tsx        Dashboard 1 — at-a-glance driver state
    LiveMonitor.tsx      Dashboard 2 — EEG/EOG signal feed (no IMU)
    Drowsiness.tsx        Dashboard 3 — vigilance analytics
    TripPlanner.tsx        Dashboard 4 — source/destination + "arrive by"
                            trip planning (free geocoding + routing)
    RestManagement.tsx       Dashboard 5 — Rest Decision Engine + GPS stops,
                              route-corridor recommendations once a trip is set
    Alerts.tsx                  Dashboard 6 — alert center
    HistoryPage.tsx               Dashboard 7 — past drives & trends
    SleepRecovery.tsx               Dashboard 8 — EEG sleep monitoring, smart
                                     wake, recovery assessment
    Reports.tsx                        Dashboard 9 — daily/weekly reports + export
    Settings.tsx                          Profile / Device / Notifications /
                                           Language / Appearance / Privacy /
                                           About / demo drowsiness-stage control
```

## What was reused from the source material

- **State model & rule logic** (vigilance score 0–100, trend, Rest Decision
  Engine, N2/non-N2 sleep classification, wake-window + 3-epoch stability
  check, safety-loop stages DETECT→PREDICT→ALERT→REST→RECOVER→RESUME) is
  taken directly from `smartsense-driver-ai`'s `lib/smartsense.tsx` and the
  system-design PDF's rule tables (vigilance bands, Rest Decision Engine
  cases A–D, Rest Suitability Score formula).
- **Component patterns** (Sidebar/Topbar shell, gauge, waveform, safety-loop
  strip, card system) are adapted from `smartsense-driver-ai`'s
  `SmartSenseUI.tsx`, ported off TanStack Start/Supabase onto plain
  Vite + react-router so the app needs no backend or auth to run.
- **Visual/product design language** — a warm, wellness-app feel (soft
  shadow cards instead of hard borders, an original indigo/green/amber
  palette, rounded pill buttons, friendly human copy instead of
  uppercase/monospace technical labels) rather than a generic "engineering
  dashboard" look, while keeping the calm, premium, card-based layout with a
  persistent left sidebar that `SOMNUS-AI` set as the quality bar (adapted,
  not copied verbatim, to fit SmartSense's own brand and driver-safety
  tone).
- **Requirements & terminology** (vigilance stages, "Predict / Rest /
  Recover", EEG+EOG driving mode vs EEG-only rest mode, N2 vs non-N2,
  engineering-prototype disclaimers) come from `SIH_26_1.pptx` and
  `SmartSense_Driver_Safety_System.pdf`.

## Real GPS & safe zones (Rest Management)

Rest Management uses the browser's real Geolocation API (latitude, longitude,
speed, heading) and the free, keyless **OpenStreetMap Overpass API** to find
actual nearby fuel stations, highway rest/service areas, parking areas, and
hotels/motels around the driver's live GPS position — no API key, no billing
account, no Google Cloud project, nothing to configure. It queries several
public Overpass mirrors (falling back automatically if one is rate-limited
or down). SmartSense ranks those real places by live distance, an estimated
safety indicator (derived from how much real detail is mapped for that
location on OpenStreetMap — name, 24/7 opening hours, lighting — plus venue
type; there is no official "safety score" data source for these place
types, so this is always labeled "estimated"), facilities (also read
straight from OpenStreetMap's tags, not invented), and current drowsiness
severity. The locations card also shows an **embedded live map** (free
OpenStreetMap tiles via Leaflet — no key, no billing) with the driver's
position and every ranked real place plotted on it, plus a preview route
line to the top-ranked stop drawn using the free public OSRM routing
server (falls back to a dashed straight line if that free routing server
is briefly unreachable). This in-app map is a **preview only** — it is not
turn-by-turn navigation. "Navigate Now" hands the driver's real GPS
coordinates and the selected real place's coordinates to Google Maps for
actual turn-by-turn driving directions in a new tab; SmartSense's own map
never tries to replace that, it just shows where things are before you go.

Real place lookup and the embedded map both work out of the box — nothing
to enable, configure, or pay for.

**If the real lookup fails** (offline, no results within 15 km, or all
Overpass mirrors are temporarily unreachable), Rest Management falls back to
a small set of static example stops — every one of those is visibly marked
**"Demo"** (a pill on the card, plus a "Demo data" badge on the suitability panel), and
"Navigate Now" is disabled for them, since they are not real verified
locations. Tapping any location card (real or demo) selects it as the
embedded map's preview destination — the route line and "X km to …" caption
on the map update to follow whichever card you tapped. That same tap also
arms the always-available "Simulate arrival at rest location (Demo)"
button, a separate feature for exercising the Rest Mode / EEG
sleep-monitoring demo flow — it's clearly labeled "(Demo)" and doesn't
depend on GPS or Places at all.

## Trip Planner (source, destination, "arrive by" time)

A dedicated dashboard (`/trip-planner`) lets the driver set a real
destination and an optional arrival deadline, which the rest of the app then
plans around:

- **Destination search** uses the free, keyless **OpenStreetMap Nominatim**
  API (`nominatim.openstreetmap.org`) — no key, no billing. Per Nominatim's
  usage policy, it only geocodes when the driver explicitly submits a
  search, never on every keystroke.
- **Source** is the driver's live GPS position (same Geolocation API used
  by Rest Management); the driving distance and duration to the chosen
  destination are calculated with the free public **OSRM** routing server.
- **"Arrive by"** is a clock-time preference (e.g. `14:30`), not a countdown
  — chosen over a raw duration input since it's what a driver naturally
  thinks in ("I need to be there by 2:30"). SmartSense uses it only to
  *inform*, never to *shorten* rest: see **Dynamic wake window** below.
- Once a destination is set, Rest Management automatically switches from
  "nearby stops" to **route-corridor recommendations** (next section), and
  Sleep/Recovery shows a non-punitive warning if the current rest pace
  won't make the deadline.
- Clearing the trip (✕ on the banner shown in Rest Management, or Trip
  Planner itself) reverts everything to the original nearby-search
  behavior.

## Deadline-aware rest recommendation timing

Setting an "arrive by" time doesn't just produce a passive warning — it
actually feeds into the Rest Decision Engine's recommendation, but only
in one direction: **when** it suggests resting, never **how much**.

- Every tick, SmartSense estimates the remaining slack: minutes until the
  deadline, minus the driving time still left, minus a rough estimate of
  how long a rest stop would take to get vigilance back to a healthy
  level (`slackMinutesToDeadline` in `lib/smartsense.tsx`).
- If that slack drops below 30 minutes — i.e. there's little room left to
  fit a stop in and still make it — the Rest Decision Engine escalates
  its recommendation by one step (`CONTINUE → BREAK_RECOMMENDED →
  REST_NOW`), on top of whatever the vigilance score alone would already
  suggest. It never invents a `STOP_NOW` (critical) recommendation from
  schedule pressure alone — that state is reserved for genuinely
  dangerous drowsiness.
- Rest Management's reason text reflects this: when deadline pressure is
  the (or an added) factor, it names the destination and arrival time and
  explains that resting sooner improves the odds of still making it —
  while explicitly reaffirming that **the rest itself, once started, is
  never cut short** to help hit the deadline (see **Dynamic wake window**
  below, which is unchanged by this).
- Clearing the trip or the "arrive by" time removes the pressure
  immediately — the next tick's recommendation reflects vigilance alone
  again.

This keeps the app's one hard safety rule intact end-to-end: a schedule
can make SmartSense suggest resting *earlier*, but it can never make an
actual rest session *shorter*.

## Route-corridor rest recommendations

With no destination set, Rest Management searches Overpass in a radius
around the driver's current position, as before. Once a Trip Planner
destination exists, it instead searches **along the whole planned route**:
the OSRM route polyline from driver → destination is sampled at up to 8
evenly-spaced points, one combined Overpass query is built with a search
radius (3 km) around every sample point, and results are de-duplicated by
OpenStreetMap id. This means a great rest stop near the *destination* end
of a long trip shows up even though it's currently far from the driver —
recommendations follow the path you're actually going to drive, not just
what's nearby right now. The recommendation list, ranking, and "Navigate
Now" behavior are otherwise unchanged from the radius-search mode.

## 5-stage drowsiness ranking

Rest-stop ranking uses the same 5 drowsiness stages shown throughout the
app — **ALERT → FATIGUE → DROWSINESS → SEVERE → CRITICAL** — as its
urgency input, instead of a generic linear formula. Each stage has its own
distance/safety/facilities weighting (all three always sum to 1.0), so what
counts as "the best stop" changes with how urgent the situation is:

| Stage      | Distance | Safety | Facilities |
| ---------- | -------- | ------ | ---------- |
| ALERT      | 15%      | 35%    | 50%        |
| FATIGUE    | 25%      | 40%    | 35%        |
| DROWSINESS | 40%      | 40%    | 20%        |
| SEVERE     | 60%      | 30%    | 10%        |
| CRITICAL   | 100%     | —      | —          |

At ALERT, there's no urgency, so SmartSense optimizes for the best
*experience* (a well-equipped stop is worth a slightly longer drive). As
drowsiness worsens, distance is weighted more and more heavily, until
CRITICAL ignores everything except getting to the single closest safe
place as fast as possible. See `stageWeights` in `lib/safeZones.ts`.

## Dynamic wake window & recovery comparison

Wake window and recovery numbers are computed live from the driver's
actual vigilance score during rest, not fixed demo values:

- Every simulation tick during Rest Mode, vigilance score genuinely
  recovers — the rate depends on sleep depth that tick (deep/N2 sleep
  recovers fastest, light sleep slower, still-settling-in barely at all).
- The **wake window** (e.g. `06:42 — 07:12`) is recomputed every tick from
  how much more recovery is needed (target: vigilance score 80) divided by
  the current recovery rate — so it tightens or shifts in real time as
  actual rest quality changes, instead of showing a static alarm that
  might catch the driver mid-sleep.
- The **recovery comparison** ("before rest" vs "after rest") reflects the
  real vigilance score at the start of the rest session versus its current
  live value, not a fixed pair of demo numbers.
- If a Trip Planner "arrive by" deadline is set, Sleep/Recovery compares
  the *end* of the current wake window plus the last-known drive time to
  the destination against that deadline, and shows a warning banner if
  it's tight. This is **informational only — SmartSense never shortens the
  recommended wake window to help meet a deadline**; the banner suggests a
  later arrival time instead, on the principle that rest quality shouldn't
  be sacrificed for a schedule.

## Smart Alarm (real sound + vibration)

The moment the wake window's condition is actually met during a rest
session, SmartSense doesn't just update a number on screen — it **rings**:
a looping two-tone chime (generated with the Web Audio API, no audio file
needed) plus phone vibration where the browser supports it, and a sticky
"Smart Alarm — time to wake up" banner that follows you to whichever page
you're on until you tap **"Stop alarm — I'm awake."** A distinct, shorter
urgent beep also plays the moment a CRITICAL drowsiness alert fires while
driving. See `lib/alarmSound.ts`.

Two honest limitations, both by design (see the alarm-delivery discussion
in-repo if you revisit this decision): this only sounds while the browser
tab is open — most mobile browsers throttle or fully suspend page audio
once the screen locks or the tab is backgrounded, so it is not yet a true
"wakes you with the phone in your pocket" alarm. A real background alarm
would mean installing the app as a PWA with push notifications, which is a
larger build than this pass covered. Also, browsers block audio playback
until the page has seen at least one click/tap; `armAlarmAudio()` grabs
that on the very first interaction anywhere in the app, well before an
alarm would ever need to fire, so in practice this isn't noticeable.

## Settings → demo drowsiness stages

Settings has a "Drowsiness stage" control (in the same demo section as the
other simulate/reset controls) with one button per stage — **Stage 1 ALERT,
Stage 2 FATIGUE, Stage 3 DROWSINESS, Stage 4 SEVERE DROWSINESS, Stage 5
CRITICAL**. Selecting one drives real app state, not just a label: it sets
the vigilance score to that stage's representative value, recomputes trend
and Rest Decision, updates the safety-loop stage strip, and — on genuine
transitions — pushes the matching alert to the Alerts page (e.g. selecting
Stage 5 pushes "Critical drowsiness detected"). This is a fast way to
demo/verify the full detection → alert → rest-recommendation pipeline for
every stage without waiting for the random-walk simulation to drift there
on its own.

## Required: connecting a database (Supabase)

Unlike earlier in this project, this is no longer optional: the app signs
every driver in with a real **Supabase Auth** account (Register/Sign-in —
see `pages/Register.tsx` / `pages/Login.tsx`) before anything else is
reachable, and without a connected project it shows a setup screen
(`pages/DatabaseRequired.tsx`) instead of the dashboards.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project's **SQL Editor**, paste and run the contents of
   `supabase/migrations/0001_init_schema.sql`. This creates the six tables
   (`users`, `devices`, `sleep_sessions`, `sleep_epochs`, `alarm_events`,
   `model_versions`) with indexes and Row Level Security policies.
3. **Email sign-ups are on by default** in every Supabase project, so no
   provider setup is needed. One setting worth changing for a smooth demo:
   under **Authentication → Sign In / Providers → Email**, consider turning
   **"Confirm email" off**. With it on (the default), Register won't sign
   the driver straight in — Supabase emails a confirmation link first,
   which is realistic but adds friction/delay to a live demo.
4. Under **Project Settings → API Keys**, copy the **Project URL** and the
   **anon / public** key (Supabase also calls this the **publishable** key
   in newer projects) — never the `service_role` / **secret** key, which
   must never go in frontend code.
5. Copy `.env.example` to `.env.local` and paste those two values into
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
6. Restart `npm run dev` (or rebuild). Register an account, and you're in —
   Settings → Database will show **Connected**, and each time you
   enter/leave Rest Mode (via Rest Management → "Simulate arrival" →
   Sleep/Recovery → "Resume Driving"), a row is written to and then updated
   in `sleep_sessions` — watch it appear live in the Supabase Table Editor.

If your project still has **Anonymous sign-ins** enabled from an earlier
version of this app, it's safe to turn that back off under Authentication
→ Sign In / Providers — nothing in the app uses it anymore.

**Loading straight into the dashboard with no Login page, in a browser that
tried an earlier version of this app?** That earlier version signed drivers
in anonymously, and Supabase sessions are cached in the browser's local
storage independent of what the app's code currently does — so that old
anonymous session can still be sitting there and auto-restoring on load.
`useAuthSession()` (`lib/auth.ts`) now explicitly checks for this: a session
whose `user.is_anonymous` is `true` is treated as signed-out, not signed-in,
and gets cleared out (`supabase.auth.signOut()`) the moment it's detected —
so this should self-heal on the very next load. If you ever see the
dashboard appear with no login step, a hard refresh (or clearing this site's
storage) will force that cleanup immediately.

**Settings → Database stuck on "Connection error", with a console error
mentioning `PGRST116` / "multiple (or no) rows returned"?** This was a real
bug, now fixed: the first time an account signs in, the app looks for (or
creates) its one demo `devices` row. If that lookup ever ran twice at once
for a brand-new account — two tabs, or a reload mid-provisioning — both
could find "no device yet" and both insert one, leaving two matching rows.
The lookup used to require exactly one row and would error out permanently
once that happened; it now always resolves deterministically to the
oldest one instead, so this can't get an account stuck anymore. If an
account already has duplicate device rows from before this fix, they're
harmless clutter — nothing to do, unless you want to tidy them up with a
one-off SQL Editor query that keeps only the oldest row per account:
`delete from public.devices d using public.devices d2 where d.user_id = d2.user_id and d.device_name = d2.device_name and d.created_at > d2.created_at;`

This currently wires up account identity and session-level persistence
(proving the web app, real accounts, and database are genuinely
connected). Per-epoch predictions and Smart Alarm events will land in
`sleep_epochs` / `alarm_events` once the ESP32 + BioAmp + XGBoost pipeline
(or a dataset-replay stand-in for demos) is connected — that's the next
piece, not yet built.

## Demo / simulation mode

All physiological signals, GPS rest stops and history are simulated
client-side (a `setInterval` tick every ~3.5s random-walks the vigilance
score, derives trend/rest-decision/alerts from it, and advances EEG sleep
state during Rest Mode). Every screen that shows simulated data labels it as
such; nothing is presented as a real clinical or hardware measurement.

## IMU removal — verified

The entire codebase was searched for `IMU`, `accelerometer`, `gyroscope`, and
`motion sensor` (case-insensitive, including inside build output). None are
present. Only EEG and EOG feed the driving-mode model; only EEG feeds the
rest-mode sleep model, per the system-design document's explicit instruction
to use EEG (not ECG, not IMU) for this version of the project.

## Themes & languages

- Light / Dark / Automatic (follows OS `prefers-color-scheme` live), persisted
  in `localStorage`, toggled from the top bar or Settings → Appearance.
- English (default), Tamil, Hindi, Telugu, Malayalam, Kannada — navigation,
  dashboard titles, states, and key actions are translated via a small
  `t(key)` dictionary lookup in `lib/smartsense.tsx`; technical signal names
  (EEG/EOG/N2) are left untranslated by design.

## Known limitations

- Drowsiness/vigilance/sleep data is simulated in-browser; there is no real
  wearable or ML inference service (the system-design document explicitly
  allows a "clean interface layer" in place of unavailable hardware/API —
  the `SmartSenseState` type in `lib/smartsense.tsx` is that interface). GPS
  location and nearby safe-place lookup (Rest Management) are real — see
  **Real GPS & safe zones** above — with a clearly-labeled demo fallback
  when location isn't available or the OpenStreetMap lookup fails.
- The "estimated safety indicator" on real places is computed from how much
  detail is mapped for that location on OpenStreetMap (name, opening hours,
  lighting) plus venue type; it is not an official or verified safety rating
  (no such public data source exists for these place types).
- OpenStreetMap coverage varies by region/road — a well-mapped highway will
  show several real results, a sparsely-mapped area may show none (falls
  back to the labeled demo stops in that case).
- The embedded map's preview route (drawn via the free OSRM demo server)
  can occasionally be rate-limited under heavy public use; SmartSense falls
  back to a dashed straight line between driver and destination in that
  case, and "Navigate Now" (Google Maps) is unaffected either way.
- Translations cover navigation and major UI strings, not every
  auto-generated sentence in the app.
- Account identity and rest-session start/end times now persist for real in
  Supabase (see **Required: connecting a database** above); theme/language
  still persist locally via `localStorage`. Everything else — the
  simulated vigilance/sleep readings themselves — resets each time you
  sign back in, since there's no real hardware or ML pipeline writing to
  `sleep_epochs` yet.
- Trip Planner's destination search (Nominatim) and route calculation
  (OSRM) are both free public demo servers with fair-use rate limits; under
  heavy load a search or route lookup can occasionally fail or be slow —
  the UI surfaces this clearly rather than silently guessing.
- The dynamic wake window and recovery comparison are still simulated
  (there's no real EEG/wearable input driving them), but the arithmetic
  itself — recovery rate, minutes-to-ready, before/after — is now live and
  responsive to the simulated vigilance score, not hardcoded demo numbers.
