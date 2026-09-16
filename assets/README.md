# Simply Connect — Agent Performance Dashboard

A live, animated performance dashboard for Simply Connect's call center and
sales operation. It reads two tabs from your Google Sheet ("Calls Data" and
"sales Data"), turns them into KPIs, leaderboards, and charts, and refreshes
itself automatically as new rows get added every day.

Brand colors are pulled straight from your logo: **amber `#FDAC00`** as the
primary accent, **black `#0B0B0B`** for all text, on a clean white/off-white
surface.

```
Google Sheet  →  Apps Script (Code.gs)  →  JSON API  →  this dashboard (GitHub → Vercel)
```

No database, no backend server to maintain — the Sheet itself *is* the
backend. Every day your team logs new calls/sales, the numbers here update.

---

## 1. What's in this project

```
index.html              the app shell (sidebar, top bar, filter bar, modal)
css/style.css            all styling, brand colors, layout, animations
js/config.js             optional: bake in your API URL for a shared deploy
js/data.js               fetches the API, filters data, computes every KPI
js/charts.js             Chart.js wrappers styled to match the brand
js/dashboard.js          renders each tab, wires up filters/sorting/export
apps-script/Code.gs       Google Apps Script — the JSON API backend
assets/logo.png           your full logo (wordmark)
assets/logo-mark.png      just the swirl icon, cropped for the sidebar
vercel.json               static-site config for Vercel
```

---

## 2. Set up the Apps Script API (do this first)

This is the piece that turns your spreadsheet into something the website
can read.

1. Open your Google Sheet (the one with the **Calls Data** and **sales
   Data** tabs).
2. `Extensions → Apps Script`.
3. Delete whatever's in the editor and paste in the entire contents of
   `apps-script/Code.gs` from this project.
4. At the top of the file, check the `CONFIG` block:
   - `CALLS_SHEET_NAME` / `SALES_SHEET_NAME` — must match your tab names
     exactly (they already do: `Calls Data` and `sales Data`).
   - `SHARED_SECRET` — optional. Leave blank, or set a password-like string
     if you want to stop random people who find the URL from pulling your
     data (see §6, Security).
5. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**, authorize the permissions it asks for (this is normal
   — it's asking to read your own spreadsheet), and copy the **Web app
   URL**. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`
7. Keep that URL — you'll paste it into the dashboard in a minute.

Any time you edit `Code.gs` later, you need to re-deploy: **Deploy → Manage
deployments → your deployment → Edit (pencil) → New version → Deploy**.
Simply saving the script is not enough; it only takes effect after a new
deployment version.

### What the API actually returns

`GET https://.../exec?days=90` returns:

```json
{
  "generatedAt": "2026-09-03T10:00:00.000Z",
  "rangeDays": 90,
  "meta": { "callsRows": 4200, "salesRows": 310, "lastCallDate": "2026-09-03", "lastSaleDate": "2026-09-03" },
  "calls": [ { "Date": "2026-09-03", "Campaign": "Group 48", "Agent Name": "...", "Call Result": "Answered", "Wait Time": 12, "Talk Time": 340, ... } ],
  "sales": [ { "Date": "2026-09-03", "Campaign": "Group 48", "Agent Name": "...", "Team": "Team Areeb", "State": "TX", "Provider": "At&t", ... } ]
}
```

It only sends **rows within the requested day range**, and only the
**columns the dashboard actually charts** — see §7 on privacy.

---

## 3. Connect the dashboard to your API

**Option A — quick, per-browser (good for testing):**
Open the dashboard → **API Setup** tab → paste your Web App URL → **Save &
Connect**. It's saved in that browser's local storage.

**Option B — baked in for everyone (good for a team deploy on Vercel):**
Open `js/config.js` and set:
```js
window.DASH_CONFIG = { API_URL: 'https://script.google.com/macros/s/AKfycb.../exec' };
```
Commit that change. Now anyone who opens your deployed site is connected
automatically — no setup step per person.

Until an API URL is set, the dashboard shows realistic **demo data** (30
days of randomly generated calls/sales) so it never looks broken — you'll
see a "Demo data" pill in the top bar instead of "Live data."

---

## 4. Put it on GitHub

```bash
cd simply-connect-dashboard
git init
git add .
git commit -m "Simply Connect agent performance dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

If you used **Option B** above and don't want your API URL public in a
public repo, either keep the repo private, or use **Option A** instead and
leave `js/config.js` blank.

---

## 5. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project**.
2. Import the GitHub repo you just pushed.
3. Framework preset: **Other** (it's a static site — no build step).
4. Root directory: leave as-is (the repo root, since `index.html` is there).
5. Click **Deploy**.

That's it — `vercel.json` in this project tells Vercel to serve it as a
static site with sensible caching. Every `git push` after this
auto-deploys the update.

---

## 6. Security notes

- The Apps Script Web App URL is **public** by design (that's what lets a
  static site fetch it with no login). Treat it like a slightly-secret
  link: don't post it somewhere public.
- For an extra layer, set `SHARED_SECRET` in `Code.gs` to a random string,
  then the dashboard must send `?key=that-string` — anyone without it gets
  a 401. This isn't bulletproof (the key lives in the browser), but it
  stops casual scraping.
- The script uses `CacheService` to cache responses for 5 minutes, so
  repeated dashboard loads don't hammer your Sheet.

---

## 7. Privacy — what does NOT leave your spreadsheet

Your Sales Data tab has customer names, emails, phone numbers, addresses,
account numbers and PINs. None of that should ever sit on a public
website. `Code.gs` uses an **allow-list** (`SALES_FIELDS_ALLOWED`) — only
columns explicitly listed there are sent to the browser. Everything else,
including all customer PII, is dropped on the server before the response
ever leaves Google's servers. If you add a new sensitive column to your
sheet later, it is **not** exposed unless you deliberately add it to that
allow-list.

---

## 8. The dashboard, tab by tab

### Overview
The daily/weekly/monthly snapshot. Eight KPI cards, then two trend lines
(calls vs. sales, and answer rate over time), then a call-result doughnut
and an hourly call-volume bar chart for shift planning.

| KPI | What it means |
|---|---|
| **Total Calls** | Every inbound call row in range, all campaigns. |
| **Answer Rate** | % of calls where `Call Result = Answered`. |
| **Total Sales** | Rows in the sales sheet — one row per processed order. |
| **Conversion Rate** | Sales ÷ Answered calls — how often a picked-up call becomes a sale. |
| **Total RGUs** | Sum of the `RGU's` column — billable services sold. |
| **Total Points** | Sum of `Total Points` — your incentive/commission scoreboard metric. |
| **Avg. Talk Time** | Average talk duration on *answered* calls. |
| **Active Agents** | Distinct agents with ≥1 sale in range. |

### Agent Rankings
A sortable leaderboard (click any column header) ranked by points by
default, plus a top-10 bar chart. Shows calls handled, calls answered,
sales, RGUs, conversion %, average talk time, and points per agent.

### Teams
Same idea at the team level, plus a radar chart that plots each team's
Sales / RGUs / Points as a percentage of the best team in each category —
so you can see whether a team is strong across the board or leaning on one
metric.

### State Analytics
Where your sales are landing geographically — a horizontal bar chart of
top states, plus the full table (sales, RGUs, points) for every state with
at least one sale.

### Campaigns
Groups calls and sales by campaign (`Group 44`, `Group 48`, etc. — the
script automatically merges `"Group 44 Sales"`/`"Group 44 CS"`/etc. from
the Calls tab into a single `Group 44` campaign name so it lines up with
the Sales tab). Shows where conversion is leaking: the gap between
"answered" and "sales" bars.

### Insights
Auto-generated, plain-English takeaways recomputed from whatever filters
are currently applied — top earner, leading team, strongest state, best-
converting campaign, peak call hour, and an abandon-rate warning if it's
running high (>8%). Below that: provider mix, service mix, and install-
type mix as doughnut charts.

### API Setup
Where you paste your Apps Script Web App URL, pick how many days of
history to load, and view/copy the Apps Script code directly from the
running dashboard (via the **View the Apps Script code** button — it
fetches `apps-script/Code.gs` live, so it's always in sync with what's in
this repo).

---

## 9. Knowing how fresh your data is

Top-right of every page is a pill like **"Aug 5, 2026 → Sep 3, 2026"** —
that's the full span of rows currently loaded from your Sheet (not the
date filter below it). Hover it for the exact last-sync time. The same
detail, spelled out, is repeated on the **API Setup** tab under
"Connection." If that range stops moving forward day to day, your Apps
Script deployment has likely gone stale — re-deploy it (§2).

## 10. Filters (top bar, all tabs except API Setup)

- **Daily / Weekly / Monthly** — sets the date range itself (today / this
  week / this month) and drives every KPI card, table and chart on every
  tab, not just the Overview trend line. Picking a period also changes
  the Overview trend line's granularity (day-by-day, week-by-week, or
  month-by-month buckets). You can still fine-tune the exact dates
  afterwards with the date-range inputs next to it.
- **Date range** — applies to every tab.
- **Team / Campaign / State / Agent / Call Result** — dropdowns, populated
  automatically from whatever values exist in your data. Call Result
  filters the Calls tab only (Answered, Abandoned, Overflow - Time,
  Stranded, Stranded - Unavailable, Transferred, Escaped) — the Sales tab
  has no call-result field of its own, so sales numbers are unaffected by
  this filter.
- **Search** — free-text, matches against every visible field.
- **Clear filters** — resets everything except the date range.
- **Export CSV** — exports whatever table is relevant to the tab you're
  currently on (agent leaderboard, team summary, state summary, campaign
  summary, or raw filtered sales rows on Overview/Insights).

### A note on Calls Data vs. sales Data

`Calls Data` has no Team, State or Campaign column of its own — only
`Call Center Name` (e.g. `Group 44 Sales`, `Group 50 CS`, `Fiber Opp`).
`Code.gs` normalizes that into a `Campaign` field (`Group 44`, `Group 50`,
`Fiber Opp`, …) so it lines up with `sales Data`'s `gRPCampaign Number`.
Team has no equivalent on the Calls side at all, so the dashboard joins
it in by matching `Agent Name` against `sales Data` (an agent who closed
a sale under "Team Areeb" is treated as Team Areeb for their calls too).
Because of this:
- The **Team** filter narrows both calls and sales.
- The **State** filter narrows sales only — calls have no location field
  — the same way **Call Result** narrows calls only.
- An agent who has taken calls but never closed a sale won't have a
  team yet, and won't show up when the Team filter is applied.

If your sheet grows a proper Team/Campaign column on the Calls tab
later, wire it in directly in `Code.gs` — the join is just a fallback.

---

## 11. Customizing

- **Colors:** everything is CSS variables at the top of `css/style.css`
  (`--amber`, `--ink`, etc.) — change those two and the whole theme
  updates.
- **Refresh interval:** `js/dashboard.js`, search for `5 * 60 * 1000` in
  `init()` (currently 5 minutes).
- **How much history loads by default:** `DEFAULT_DAYS` in `Code.gs`, or
  the "Days of history" dropdown in API Setup.
- **New KPI or chart:** add a computation to `js/data.js`, a render
  function in `js/dashboard.js`, and reuse the `kpiCard()` / `chartCard()`
  helpers already there so it matches the existing style automatically.

---

## 12. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Status pill says "Demo data" | No API URL saved/configured yet — see §3. |
| Status pill says "Connection failed" | Web app not deployed as "Anyone", or the URL is wrong/stale (re-deploy after any script edit). |
| Charts don't render at all | Chart.js loads from a CDN (`cdn.jsdelivr.net`) — make sure that's reachable (it will be on Vercel; a fully offline/air-gapped host would need to self-host `chart.js`). |
| A KPI looks wrong | Check the tiny help text under each KPI card — it states exactly which columns/logic it's computed from. |
