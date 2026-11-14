# second·serve — Pre-evaluation build

**Good food. Better futures.**

SECOND-SERVE is a food-rescue coordination platform. It connects restaurants and food donors with verified NGOs, shelters and volunteer runners, and treats every donation as a **rescue that has to make it in time**, not as a listing on a noticeboard.

This folder is a separate, smaller pre-evaluation version of the full SECOND-SERVE project. It shares the full project's stack (React + TypeScript + Vite + localStorage), its matching engine, its terminology (Rescue board, NGO network, Runner dispatch, lifetime rescues) and its demo city. It doesn't touch the original repository.

> **All organisations, runners, donors and rescues are fictional demonstration data.** No real NGO partnerships, live GPS, verified deliveries or measured emissions are claimed.

---

## 1. Run it (Windows)

You need **Node.js 20.19+ or 22.12+** (check with `node -v`).

Open **PowerShell** or **Command Prompt** in the folder where you unzipped the project:

```powershell
cd second-serve-preeval
npm install
copy .env.example .env        # macOS/Linux: cp .env.example .env
# open .env and paste a key after GEMINI_API_KEY=  (free: https://aistudio.google.com/app/apikey)
npm run dev
```

`npm run dev` starts **two** things: the AI backend on port 8787 (holds the API key) and the app on **http://localhost:5173**. Vite forwards `/api` to the backend, so the key never reaches the browser.

Without a key everything still works except the photo scan: the scanner says it isn't configured, and a donor can continue without AI (the listing then needs a coordinator's approval before matching).

For a production build served by one process:

```powershell
npm run build
npm run start        # app + API on http://localhost:8787
```

Tests: `npm test` (44 tests: safety rules, matching pipeline, API server). Type-check only: `npm run typecheck`

macOS and Linux use the same commands.

**Reset:** use **Reset demo data** in the footer. It restores the sample city with fresh, live deadlines. Do this right before you present.

---

## 2. Folder structure

```
second-serve-preeval/
├── index.html                 # fonts, meta, mount point
├── package.json               # 3 runtime deps: react, react-dom, lucide-react
├── vite.config.ts
├── tsconfig*.json             # strict TypeScript
├── .env.example               # AI keys go in .env (git-ignored)
├── server/                    # AI backend, no dependencies
│   ├── index.mjs              # starts API (+ serves dist/ with --static)
│   ├── app.mjs                # /api/health, /api/food-scan: validation, rate limit, errors
│   ├── providers.mjs          # Gemini + Claude vision adapters (swappable)
│   ├── scanSchema.mjs         # prompt, JSON schema, reply normaliser
│   └── dev.mjs                # runs API + Vite together
├── tests/                     # vitest: rules, pipeline, server
├── public/favicon.svg
└── src/
    ├── main.tsx               # entry
    ├── App.tsx                # shell, hash routing, toasts, drawer/modal state
    ├── styles.css             # design system + every component style
    ├── types.ts               # Donation, Ngo, Runner, RescueRecord, AppState
    ├── data/
    │   └── demoData.ts        # Chandigarh demo areas, donations, NGOs, runners, seed history
    ├── lib/
    │   ├── engine.ts          # PURE logic: feasibility, matching, capacity, runner suggestion, impact
    │   ├── foodScan.ts        # Engine 1 client: resize photo, call /api/food-scan
    │   ├── verification.ts    # Engine 1 safety rules → pass / review / reject
    │   ├── pipeline.ts        # Engine 2: gates → rank (+TOPSIS, stability) → feasibility → recommendation
    │   └── useRescueStore.ts  # state + actions + localStorage persistence
    ├── components/
    │   ├── Art.tsx            # wordmark, drip underline, falling drops, grain, clock rings, stamps
    │   ├── Sidebar.tsx        # top navigation (TopNav) + route list
    │   ├── Receipt.tsx        # rescue receipt + download-as-PNG (canvas)
    │   ├── FoodScan.tsx       # Scan & donate: camera/upload, analysing, retry
    │   ├── PipelineTrack.tsx  # the dual-engine track
    │   ├── DonationForm.tsx   # listing form (manual or AI-prefilled) + live safety screening + feasibility
    │   ├── DonationCard.tsx   # Rescue board card
    │   ├── RescueFile.tsx     # the drawer: feasibility → matching → dispatch → tracking
    │   ├── FeasibilityMeter.tsx
    │   ├── MatchPanel.tsx     # ranked matches, score breakdown, exclusions
    │   ├── RescueTimeline.tsx # 5-step traceable journey
    │   ├── Toasts.tsx
    │   └── ui.tsx             # pills, score ring, count-up, small shared pieces
    └── views/
        ├── Home.tsx           # India food-waste counter, live "meanwhile, here" band, pipeline, attention, activity
        ├── Live.tsx           # Room wall: projector view, syncs live across tabs
        ├── RescueBoard.tsx    # filters (category, status, search) + cards
        ├── NgoNetwork.tsx     # partners, storage, hours, live capacity
        ├── Dispatch.tsx       # runners (shift toggle) + Pending/Assigned/Picked up/Delivered lanes
        └── Impact.tsx         # totals, 7-day chart, category breakdown, rescue log
```

---

## 3. Features

| Area | What you can do |
|---|---|
| **Home** | A ticking counter of food India has wasted since the page opened (estimated from UNEP's 2024 rate, sourced on screen), a scrolling ticker of recent rescues, a **"Meanwhile, here"** band with today's meals rescued, the 4-step story, a live **rescue pipeline**, **Needs attention** and recent activity. |
| **Room wall** | A full-screen projector view (`#live`) with a giant meals-rescued-today counter and the latest rescue. Open it in a second window: it updates the instant a delivery is marked in any other tab of the same browser (via the `storage` event). |
| **Delivery moment** | Marking a rescue delivered slams down a "RESCUED" stamp with a burst of pink drops, in every open tab. |
| **Rescue receipt** | Each delivered rescue prints a torn-paper receipt (food, route, runner, times, safe time left, estimated waste avoided) that **downloads as a PNG** to share. |
| **List surplus food** | A working form with name, donor, category, servings, quantity and unit, dietary info, storage, preparation time, travel estimate, safe-consumption window, pickup area and point, and a description. A **4-point safe-handling checklist** must be ticked before you can submit. A **live feasibility check** and a count of eligible NGOs update as you type. **Fill sample** loads a realistic listing for demos. |
| **Rescue board** | Cards sorted by urgency, each with a live safe-time countdown and a feasibility verdict. Filter by category and status, or search. |
| **Rescue file** (drawer) | Four numbered steps: **01 Feasibility** (visual meter and plain-language explanation), **02 Smart NGO matching** (ranked, scored, explained, with exclusions), **03 Runner dispatch** (nearest free runner suggested), **04 Rescue tracking** (timeline and status controls). |
| **NGO network** | Verification state, opening hours with an open-now flag, fridge and freezer, veg-only flag, stated needs, and today's capacity split into delivered and reserved. |
| **Runner dispatch** | Runner cards with an on-shift toggle and current run, plus Pending → Assigned → Picked up → Delivered lanes with one-click actions. |
| **Impact report** | Meals rescued, kg rescued (estimated waste avoided), deliveries, organisations served, estimated CO₂e, a 7-day bar chart with hover detail, a category breakdown, a rescue log and the stated assumptions. |
| **Rescue garden** | One flower blooms for every delivered rescue: the stem draws itself, leaves pop, the head opens with a chime. Species by food type: **dahlia** = cooked meals, **sunflower** = bakery, **tulip** = produce, **lotus** = dry rations. Bigger rescues grow bigger flowers. Hover a flower for its story. Food that expires falls as a **grey petal**. Milestones unlock with petal confetti: **lantern tree** (5), **fireflies** (10), **moon pond** (15), **aurora sky** (20). **Garden postcard** exports a shareable PNG. Lives on Home, Impact, the Live map and the Room wall. |
| **Live map** | An illustrated, offline SVG map of Chandigarh (`#map`): countdown-ring pins for open listings, partner houses with sprouts for today's rescues, runners, dashed routes for matched food and a glowing **firefly** for food in transit. |
| **Replay the day** | One click replays the last 24 hours in 15 seconds: pins pop, fireflies fly each route, partner houses burst, and the garden below grows in sync with a clock. |
| **Kitchen compatibility** | Every partner now has real storage units (fridge L, freezer L, dry store kg), meal times, reheating and a Jain-separated kitchen flag. Matching adds a 7th gate (enough free space in the right unit) and a 0–100 **compatibility score** from 6 factors (storage room, cold chain, diet fit, asked for it, meal timing, can reheat) shown as a **radar chart** plus a fridge/freezer gauge showing space before and after this donation. Compatibility is 30% of the match score. |
| **Wilting bud** | Every listing carries a bud that droops and fades as its safe window runs out, blooms when delivered, and turns grey when it expires. |
| **Rescue streaks** | Consecutive days each donor's food was actually delivered, with a 7-day strip on Home and a 🔥 chip on their listings. |
| **Hindi / Punjabi** | EN · हि · ਪੰ toggle in the top bar (and on the Room wall). Interface text switches; fonts are bundled so it works offline. |
| **Delight** | Cursor glow trail, petal confetti on deliveries and milestones, soft bloom chimes (mute toggle on the garden; tap the Room wall once to allow sound). |
| **Persistence** | Everything is saved to localStorage key `second-serve-preeval-v2`. A refresh keeps your data. A reset restores the demo. |

---

## 4. Architecture

- **A tiny backend, only for AI.** `server/` (zero npm dependencies) exists only to keep the vision API key off the browser. App data still lives in one `AppState` object (`donations`, `ngos`, `runners`, `history`). It's held by the `useRescueStore` hook and written to localStorage on every change.
- **Pure engine.** `lib/engine.ts` has no React, no storage and no `Date.now()`; the current time is passed in. Every number on screen comes from these functions, which makes them easy to explain and to unit test.
- **Derived, not stored.** NGO capacity, feasibility verdicts, pipeline counts and impact totals are recalculated on every render, so they can't drift out of sync. The only stored counter is the permanent `history`.
- **Delivered-only impact.** A `RescueRecord` is written only when a rescue reaches *Delivered*. It's keyed by donation id, so a repeated click or a refresh can never double count. This is the same "lifetime rescues" rule as the full build.
- **Time.** A 15-second ticker keeps countdowns and verdicts live. Seed deadlines are relative to the moment the demo loads.
- **Routing** uses the URL hash (`#overview`, `#board`, `#ngos`, `#dispatch`, `#impact`), so browser back and forward work with no router dependency.
- **Dependencies:** React 19, lucide-react (icons), and @fontsource packages so the fonts (Bricolage Grotesque, Figtree, JetBrains Mono) are **bundled locally**. The demo needs no internet. Dev: Vite, TypeScript and the React plugin. Charts, illustrations and the receipt are hand-written SVG and canvas.
- **Cross-tab sync:** every tab listens for localStorage `storage` events, so the Room wall on a projector mirrors the laptop in real time. This is same-browser only, not a server.

---

## 5. The algorithms (honest version)

Both algorithms are **deterministic, rule-based and explainable. Neither is machine learning.**

### 5.1 Food safety & rescue feasibility

```
preparation  = minutes until the donor has it packed (counts down)
travel       = donor's estimate (on the board) or the route estimate to the matched NGO (once reserved)
total rescue = preparation + travel
available    = minutes left in the donor-declared safe-consumption window
spare        = available − total − 15-minute safety buffer

spare ≥ 30 min      → Feasible
0 ≤ spare < 30 min  → At risk     (fits, but any delay breaks it; dispatch now)
spare < 0           → Not feasible (would arrive too late; don't redistribute)
window already over → Not feasible
```

The meter shows the safe window as a track, with preparation, travel and buffer laid inside it. Anything that spills past the "safe until" line is drawn as dashed overflow.

**This is an initial screening aid, not a food-safety certification.** The safe window is the donor's own judgement. Real handling must follow applicable food-safety requirements.

### 5.2 Smart NGO matching (same engine as the full build)

**Step 1: hard gates.** Failing any gate excludes the organisation, and the reason is shown.

1. Verified partner.
2. Accepting donations now.
3. Storage compatible (chilled food needs a fridge; frozen food needs a freezer).
4. Dietary compatible (non-veg food never goes to a veg-only kitchen).
5. Enough remaining capacity today for the donation's servings.
6. Open at the estimated arrival time.
7. Arrives at least 15 minutes before the safe-use deadline.

**Step 2: weighted score, 0–100.**

| Factor | Weight | Scores 1.0 when… |
|---|---:|---|
| Travel time | 35% | 0 min (falls to 0 at 45 min) |
| Unused capacity | 30% | none of today's capacity is used yet, which spreads food fairly |
| Safety margin | 20% | 120+ min of spare safe time on arrival |
| Opening hours | 15% | open 120+ min after arrival |

Ties go to the shorter travel time.

- **Travel estimate:** straight-line (haversine) km × 1.3 road factor at 18 km/h, plus 10 minutes for a runner to reach the donor. It isn't real routing.
- **Capacity:** daily capacity − servings reserved for that NGO − servings delivered to it today.
- **Runner suggestion:** the nearest on-shift runner who isn't already on a run.

### 5.3 Impact estimates

- Weight: listings measured in kg use their weight. Others assume **0.35 kg per serving**.
- Emissions: an **illustrative 2.5 kg CO₂e per kg** of food kept out of waste. Published factors vary widely by food type and disposal route.
- These are indicators, **not verified carbon reductions**. The UI labels them "est." and spells out the assumptions.
- The project supports **SDG 13 (Climate Action)**, which the Impact report notes in a small tag.

---

## 5b. Dual-engine AI (Scan & donate)

```
 ENGINE 1 · verify the food                         ENGINE 2 · find the recipient
 ┌───────┐  ┌──────────┐  ┌──────────────┐  ┌─────────┐   ┌──────────┐  ┌────────┐  ┌─────────────┐  ┌──────────┐
 │ Photo │→ │ Vision AI│→ │ Safety rules │→ │ Listing │ → │ 7 gates  │→ │  Rank  │→ │ Feasibility │→ │ Dispatch │
 └───────┘  └──────────┘  └──────────────┘  └─────────┘   └──────────┘  └────────┘  └─────────────┘  └──────────┘
  browser    server/        lib/               useRescue   engine.ts      engine.ts    pipeline.ts      existing
  shrinks,   providers.mjs  verification.ts    Store       (unchanged)    + TOPSIS     (real runner     runner flow
  strips GPS (Gemini|Claude) (pure rules)      (same data)                + stability   ETA)
```

**What is AI and what isn't.** Only the *Vision AI* step is machine learning (a hosted vision-language model). Everything after it — safety rules, gates, ranking, TOPSIS, feasibility — is deterministic code you can read and test.

**Engine 1.** The photo is resized in the browser (≤1024 px JPEG, EXIF/GPS stripped) and posted to `/api/food-scan`. The server checks type, real file signature and size, rate-limits, and calls the configured model with a strict JSON schema. The reply is normalised (`server/scanSchema.mjs`): unknown or malformed fields become "Unknown" / "uncertain" / confidence 0 — nothing is invented. Then `lib/verification.ts` combines the AI reading with the donor's declarations:

| Outcome | When | What happens |
|---|---|---|
| **Pass** | No rule fails, nothing needs a human | Published as *AI-screened*, matched and reserved automatically |
| **Review** | Low confidence, unclear photo, medium visual concern, diet/packaging contradiction, or the AI was unavailable | Listed as **In review**. Matching is locked until a coordinator approves |
| **Reject** | High-severity visual concern (mould, spoilage…), not food, cooked food over 2 h at room temperature, open packaging for meals, contradictory timing | Can't be published |
| **Incomplete** | Missing cooked time, packaging, checklist… | Can't be submitted yet |

Visual verdict shown separately: *Visually acceptable / Potentially unsuitable / Uncertain / Not scanned*. "Visually acceptable" never means safe; every screen says so.

**Engine 2** (`lib/pipeline.ts`) wraps the existing engine without changing it:
1. **Hard gates** — the existing seven (verified, accepting, storage type + free unit space, diet, capacity, open on arrival, arrives ≥15 min before the deadline). Exclusions are tagged with the gate that failed.
2. **Ranking** — the existing weighted score (compat 30, travel 25, need 20, safety 15, hours 10), shown as points per criterion. Cross-checked with **TOPSIS** and a **weight-sensitivity test** (each weight ±25 %, 10 trials).
3. **Feasibility** — every ranked NGO is re-timed with the *real* pickup: the nearest free runner's ETA to the donor (stage 1 assumes a flat 10 min). Uses the existing `assessFeasibility`. A high score never beats the clock.
4. **Recommendation** — first NGO in score order that survives step 3, with alternatives, exclusions, and plain-language reasons. If none survive, the listing stays on the board, unmatched.

**Why a weighted score and not TOPSIS as the primary method.** TOPSIS normalises each criterion *relative to the other candidates*, so (a) adding or removing an NGO can reorder the others (rank reversal), (b) with one candidate it's meaningless, and (c) its closeness value can't be split into "this many points came from travel time". The weighted score uses fixed anchors (0–45 min travel, 0–120 min margin…), so 80/100 means the same thing tomorrow and every point is explainable. TOPSIS still runs as a cross-check; on the bakery demo listing it disagrees (three NGOs within 4 points), which the panel shows honestly. An assignment optimiser (e.g. Hungarian / ILP) only pays off when many donations are matched at once; donations arrive one at a time here, so greedy per donation is optimal. Learned/hybrid recommenders need acceptance history that doesn't exist yet.

**Config** (`.env`, never committed): `GEMINI_API_KEY` *or* `ANTHROPIC_API_KEY`; optional `VISION_PROVIDER`, `GEMINI_MODEL` (default `gemini-2.5-flash`), `ANTHROPIC_MODEL` (default `claude-haiku-5-5`), `VISION_TIMEOUT_MS` (25000), `PORT` (8787), `GEMINI_BASE_URL` (proxy). To add a provider, add one function to `server/providers.mjs`.

## 6. Demo data

Chandigarh, with approximate sector coordinates.

| Listing | Status at load | Why it's there |
|---|---|---|
| Veg pulao & dal tadka (The Green Kitchen, Sec 35) | Available · **Feasible** | The main "happy path". Haven is excluded (no fridge) and Roti Bank is excluded (pending verification). |
| Paneer tikka sandwich boxes (Daily Grind Café, Sec 36) | Available · **At risk** | Tight window. |
| Chicken biryani handis (Rasoi Banquet Hall, Sec 8) | Available · **Not feasible** | Every NGO fails the time gate, and Saathi also fails the veg-only gate. |
| Pav, buns & atta cookies (Sunday Bakehouse, Sec 34) | Available · Feasible | Room temperature, so Haven becomes eligible. |
| Seasonal vegetables & fruit (Harvest Market, Sec 22) | In rescue · Assigned to Meera | Shows a run in progress. |
| Rajma chawal (Hearth & Tandoor, Sec 17) | **Delivered** to Haven by Aarav | A completed rescue. |

- **NGOs:** Annapurna Community Kitchen, Haven Night Shelter, Saathi Children's Home and Roti Bank Manimajra (pending review).
- **Runners:** Aarav Sharma, Meera Kapoor and Kabir Singh (off shift).
- **History:** six earlier rescues are pre-loaded so the 7-day chart has some shape. Every one is tagged **demo** in the rescue log.

**Note on opening hours:** matching respects real clock time. Haven is open 24 hours, but Annapurna is open 7 am–11 pm and Saathi 7 am–9 pm. Late at night, fewer organisations will match. That is correct behaviour, but rehearse at a similar time of day to your slot.

---

## 7. 2–3 minute pre-evaluation demo script

**Setup:** reset demo data. Open the app in two windows. Put **window B** on the projector at `#live` (Room wall) and drive **window A** on the laptop. Rehearse twice.

**0:00 · Hook (window A, Home).** Let the counter tick for a beat.
"Since you opened this page, India has thrown away *this much* food: about 2.5 tonnes every second. The food isn't the problem. The coordination is. Food has a deadline."

**0:20 · Feasibility.** Under *Needs attention*, click **Chicken biryani handis**.
"Before anyone moves, we check the clock: packing plus travel plus a 15-minute safety buffer. This one is short by about 18 minutes, so the system says don't send it. Every organisation is excluded, with a reason." Close the drawer.

**0:45 · List food.** Click **List surplus food**, then **Fill sample**. Drag the safe-window slider to show the verdict flipping between Feasible, At risk and Not feasible, then set it back to 3 hours. Point at the safe-handling checklist. Click **List & find matches**.

**1:10 · Matching.** "Seven safety gates first, then a kitchen-compatibility radar: is there fridge space, does their kitchen fit the diet, do they serve a meal before the food expires? Haven is out because it has no fridge. Roti Bank is out because it isn't verified yet. No black box." Point at the radar and the fridge gauge, then click **Reserve**.

**1:30 · Dispatch.** "Nearest free runner. Meera is busy, so it suggests Aarav." Click **Assign**, then **Mark picked up**, then **Mark delivered**.
Now point at the projector: the **RESCUED** stamp lands, the counter jumps, a dahlia draws itself into the garden, and the **moon pond** milestone unlocks with confetti (the demo data sits at 14 rescues, so your first live delivery is #15).

**2:00 · Receipt.** Scroll down in the drawer and click **Download receipt**. "Every meal saved gets a receipt you can share. It's counted once, only on delivery, and the waste and CO₂ figures are clearly labelled estimates."

**2:10 · Map replay.** Open **Live map**, press **Replay last 24 hours**. "This is today in 15 seconds: every firefly is a meal crossing the city, and every flower is one that got eaten instead of binned."

**2:30 · Close.** Flip the language toggle to हि or ਪੰ for a second. "Built for the dhaba owner and the shelter cook, not just us. Next: real-time phone listing and WhatsApp."

**Backup:** keep a screen recording of this exact run.

## 8. Limitations of this build

- Data lives in **one browser's localStorage**. It isn't shared between devices or users.
- **No authentication or roles.** One coordinator view drives every action.
- Travel uses straight-line distance × 1.3, **not real routing**. Locations are approximate demo coordinates.
- Runner statuses are **set by hand** (simulated). There's no live GPS and no notifications.
- NGO verification is shown but **can't be edited** in this build.
- Safe windows are the **donor's own judgement**. The platform doesn't certify food safety.
- Impact figures are **estimates** with stated assumptions.
- **AI scan:** a photo can't show temperature history, microbes or allergens; the scan is a screening aid. The 2-hour room-temperature and 24-hour chilled limits are platform policy, not a legal standard. Model accuracy on Indian dishes hasn't been measured here.
- **Manual review** has no login: anyone using the coordinator view can approve. The plain *List manually* form still bypasses the photo scan (as before); add a policy if every listing must be scanned.
- New interface text is English only (the EN/हि/ਪੰ toggle falls back to English for it).
- The Room wall syncs between tabs of one browser on one machine. Phones and other devices need a shared backend (planned for the full build).
- The India food-waste counter is an estimate from an annual rate (UNEP Food Waste Index Report 2024, 2022 data), not live data.

## 9. What's reserved for the full SECOND-SERVE build

**Already in the full project, left out here to keep the demo tight:**
- Street-tile map with routing (Leaflet). This build uses its own illustrated offline map instead.
- NGO network management: verify, reject or revoke organisations, edit daily capacity, pause intake, register new organisations.
- Rescue Intelligence tools: Rescue Cascade and Surplus Forecast.

**Planned for the full build (not in either version yet):**
- A real-time shared backend, so a donor can list from their phone via an on-screen QR code.
- ~~AI photo-to-form listing~~ (done: Scan & donate). Listing over WhatsApp.
- NGO accept/decline with automatic fallback to the next match.
- QR-verified handover at delivery.
- Multi-pickup route batching for one runner.
- Surplus forecasting per donor and day of week.
