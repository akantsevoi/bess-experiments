BESS Control center application structure/cases.


Screen is divided vertically into two sections:
1. small with tabs (1/6 maximum)
2. big with the tab info

Tabs:
- overview battery projects
	- top tab (150 pts on vertical maximum)
		- overall uptime (Monitor SLA compliance and performance across your BESS portfolio)
	- assetportfolio(table view, each row - one project)
		- name
		- SLA status {green|yellow|red}
			- green - uptime is 2+% higher than threshold. All maintenance operations are planned and aren't going to affect uptime dramatically 
			- yellow - at risk - less than 1% higher than SLA threshold
			- red - below treshold.
		- last maintenance time
		- location: (Hamburg, Munich, Stockholm, etc)
		- size in MWh
- "later there will be other tabs, but now there are no"


when click on "overview battery projects" -> "assetportfolio" -> "table item"
Open a page dedicated for this particular battery project. With the sections:
- revenue loss part
	- details are in `docs/revenue-loss-demo` but in short: compares potential revenue with actual revenue and makes breakdown for the revenue loss reason: {downtime|misprediction|etc.}
- SLA metrics
	- per-battery Time Availability (A_time), Dispatch Availability (A_dispatch), and Round-Trip Efficiency (RTE) computed from the same datasets used for revenue analysis
	- policy cards show targets and penalties for RTE and SoH retention (RTE target ≥88% quarterly; SoH target ≥70% at contract end-of-life, ≤2.5%/yr linear degradation)
- errors from BMS(battery management system). Only not solved once
	- date when error came
	- status: {maintenance scheduled|}
	- severity level: {critical|medium|low}
	- short text description about what should be done for this particular error
	- link to PDF manual from supplier + specific page where to look for the info


For the beginning I will need to have just html pages with minimum vanilla JS and data is hardcoded in a form of constants in js files. For revenue-loss part the example data can be taken from `docs/revenue-loss-demo`

## Proposed Data Models

Below are lightweight, UI‑oriented models for hardcoded JS constants now, with a clean path to APIs/DBs later. Names align with the revenue‑loss demo where relevant.

### Shared Enums
- `SLAStatus`: "green" | "yellow" | "red"
- `ErrorSeverity`: "critical" | "medium" | "low"
- `ErrorStatus`: "new" | "acknowledged" | "maintenance_scheduled" | "in_progress" | "resolved"
- `OpMode`: "CHARGE" | "DISCHARGE" | "IDLE" | "DOWNTIME"

### SLA Policy
- `SLAConfig`
  - `targetPct`: number (e.g., 95)
  - `greenBufferPct`: number (e.g., +2 above target)
  - `yellowBufferPct`: number (e.g., <+1 above target)
  - `window`: { `start`: ISO string, `end`: ISO string }

### Overview (Top Panel)
- `PortfolioSummary`
  - `overallUptimePct`: number
  - `slaConfig`: `SLAConfig`
  - `totalProjects`: number
  - `projectsByStatus`: { `green`: number, `yellow`: number, `red`: number }
  - `totalCapacityMWh`: number
  - `lastUpdatedAt`: ISO string

Example:
```js
const portfolioSummary = {
  overallUptimePct: 97.1,
  slaConfig: { targetPct: 95, greenBufferPct: 2, yellowBufferPct: 1, window: { start: '2025-09-01T00:00:00Z', end: '2025-09-30T23:55:00Z' } },
  totalProjects: 12,
  projectsByStatus: { green: 9, yellow: 2, red: 1 },
  totalCapacityMWh: 820,
  lastUpdatedAt: '2025-09-23T06:00:00Z'
};
```

### Asset Portfolio (Table)
- `ProjectListItem`
  - `projectId`: string
  - `name`: string
  - `slaStatus`: `SLAStatus`
  - `uptimePct`: number
  - `lastMaintenanceAt`: ISO string | null
  - `location`: { `city`: string, `country`: string, `lat`: number, `lon`: number }
  - `sizeMWh`: number
  - `batteryCount`: number

Example:
```js
const assetPortfolio = [
  {
    projectId: 'P-001',
    name: 'Hamburg BESS',
    slaStatus: 'green',
    uptimePct: 97.8,
    lastMaintenanceAt: '2025-09-20T09:00:00Z',
    location: { city: 'Hamburg', country: 'DE', lat: 53.55, lon: 10.0 },
    sizeMWh: 80,
    batteryCount: 4
  }
];
```

### Project (Detail Page)
- `Project`
  - `projectId`: string
  - `name`: string
  - `location`: as above
  - `sizeMWh`: number
  - `batteries`: `Battery[]`
  - `slaStatus`: `SLAStatus`
  - `uptimePct`: number
  - `revenueLoss`: `RevenueLossSummary`
  - `errorsOpen`: `BmsError[]`

- `Battery` (aligns with revenue-loss demo)
  - `battery_id`: string
  - `capacity_kwh`: number
  - `power_kw`: number
  - `supplier`: string
  - `model`: string
  - `commissionedAt`: ISO string

Example:
```js
const project = {
  projectId: 'P-001',
  name: 'Hamburg BESS',
  location: { city: 'Hamburg', country: 'DE', lat: 53.55, lon: 10.0 },
  sizeMWh: 80,
  batteries: [
    { battery_id: 'B1', capacity_kwh: 20000, power_kw: 5000, supplier: 'VendorX', model: 'VX-5000', commissionedAt: '2024-04-01T00:00:00Z' }
  ],
  slaStatus: 'green',
  uptimePct: 97.8,
  revenueLoss: {/* see below */},
  errorsOpen: [/* see BMS Errors */]
};
```

### Revenue Loss (Detail Section)
Use the structures computed in `docs/revenue-loss-demo` (per-slice diff rows) or the UI-focused summaries below.

- `RevenueLossSummary`
  - `window`: { `start`: ISO string, `end`: ISO string }
  - `kpi`:
    - `revPredEur`: number
    - `revActEur`: number
    - `lossEur`: number
    - `lossDowntimeEur`: number
    - `utilizationPct`: number
    - `timeAvailabilityPct`: number
    - `dispatchAvailabilityPct`: number
    - `priceWeightedAvailabilityPct`: number | null
    - `headroomCostEur`: number
    - `distanceToBreachMin`: number
  - `cumulative`: `RevenueSeriesPoint[]`
  - `dailyBreakdown`: `RevenueDailyBreakdown[]`
  - `lossBreakdown`: { `downtimeEur`: number, `deviationEur`: number }

- `RevenueSeriesPoint`
  - `ts`: ISO string
  - `cumPredEur`: number
  - `cumActEur`: number
  - `isDowntime`: boolean
  - `priceEurKwh`: number
  - `predPowerKw`: number
  - `actPowerKw`: number
  - `lossEur`: number

- `RevenueDailyBreakdown`
  - `date`: YYYY-MM-DD string
  - `revPredEur`: number
  - `revActEur`: number
  - `lossEur`: number
  - `lossDowntimeEur`: number
  - `utilizationPct`: number
  - `timeAvailabilityPct`: number
  - `dispatchAvailabilityPct`: number
  - `headroomCostEur`: number

### BMS Errors (Detail Section)
- `BmsError` (only open incidents shown)
  - `errorId`: string
  - `projectId`: string
  - `batteryId`: string | null
  - `firstSeenAt`: ISO string
  - `status`: `ErrorStatus`
  - `severity`: `ErrorSeverity`
  - `title`: string
  - `actionHint`: string
  - `manualUrl`: string
  - `manualPage`: number | string
  - `ticketId`: string | null
  - `maintenance`: { `scheduledAt`: ISO string, `durationMin`: number } | null

Example:
```js
const bmsErrors = [
  {
    errorId: 'E-123', projectId: 'P-001', batteryId: 'B1',
    firstSeenAt: '2025-09-21T14:20:00Z', status: 'maintenance_scheduled', severity: 'critical',
    title: 'DC bus overvoltage', actionHint: 'Check inverter DC link and precharge circuit.',
    manualUrl: 'https://vendorx.com/manuals/vx5000.pdf', manualPage: 132,
    ticketId: 'TCK-7789', maintenance: { scheduledAt: '2025-09-24T08:00:00Z', durationMin: 120 }
  }
];
```

## Utilities

- Energy totals from static datasets
  - Script: `docs/control-room/tools/calc_energy.js`
  - Usage:
    - `node docs/control-room/tools/calc_energy.js docs/control-room/data/static/revenue-P-001.json`
    - Optional: `--interval <minutes>` to force a sample interval when it cannot be inferred (default 5).
  - Output: total charge and total discharge (kWh) per battery and project totals, computed from actual 5‑minute series.

### Optional UI Meta
- `Tab`
  - `id`: string
  - `label`: string
  - `visible`: boolean
  - `order`: number

### Suggested File Layout for Constants
- `docs/control-room/data/portfolio.js` → `const portfolioSummary = {...}; const assetPortfolio = [...];`
- `docs/control-room/data/project-P-001.js` → `const project = {...};`

Revenue-loss example inputs/logic live in `docs/revenue-loss-demo` and can be reused to populate `RevenueLossSummary` for a project.

## Revenue-Loss Visualization (Static Data)

The project detail page (`project.html`) renders the same charts/tables as `docs/revenue-loss-demo`, but using hardcoded datasets instead of uploads.

- Hardcoded input datasets live in:
  - `docs/control-room/data/revenue-P-001.js`
  - `docs/control-room/data/revenue-P-002.js`
  Each file defines `window.revenueData[projectId] = { window, batteries, price, pred, actual, pMinPct, slaPct }`.
- Renderer: `docs/control-room/js/revenue_static.js` adapts the demo’s logic to compute 5‑minute slices, compare predicted vs actual, and render charts.
- Chart libs: Chart.js + Luxon + annotation plugin via CDN (same as the demo).

### Pre-generated vs. On-load Generation

- This repo includes pre-generated weekly datasets for all projects at `docs/control-room/data/static/revenue-<PROJECT_ID>.json`.
- When the page is opened over HTTP(S) (e.g., with a local server), the project page tries to load the matching JSON and uses it as-is (no generation at load time).
- When opened from `file://`, browsers typically block `fetch` of local JSON; in that case the page falls back to embedded JS datasets. The embedded scripts are guarded to avoid overwriting preloaded data and can be removed if you always serve over HTTP.
- To serve locally, from `docs/control-room` run: `python3 -m http.server 8000` and open `http://localhost:8000/project.html?projectId=P-001`.

Static JSON files were generated via `docs/control-room/scripts/pregenerate_revenue.py`. Re-run the script if you tweak generation logic and want to refresh the snapshots.

Displayed views (same as demo):
- KPI summary (predicted/actual revenue, loss, downtime loss, utilization, availability, headroom, distance to breach).
- Per‑battery daily summary table and per‑slice diff table.
- Cumulative revenue over time with downtime bands and high‑price markers.
- Loss breakdown (downtime vs deviation) per battery/day with utilization overlay.
- Heatmap (loss or dispatch error) and availability timeline per battery by hour.

To add another project’s static dataset, create `docs/control-room/data/revenue-P-XXX.js` with the same structure and ensure the project’s `projectId` matches the key in `window.revenueData`.
