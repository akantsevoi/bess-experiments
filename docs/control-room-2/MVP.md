# Control room 2

BESS control room MVP application for [Product definition](./Readme.md)
Quite a big of effort is on working with data sources and making it explicitly.

# MVP structure

## Appearance
- It's a single page html+js application. Because we'll do simulations, not real data consumption.
- Pages tree (I'm doing it inside on html page in order to share the data between "pages" in real world that would be done through DB or smth else. In my case I'll imitate storage as an in-memory variable)
    - /index.html - main page
        - ?project=projectID - page of a specific BESS project with the details
    

- Main Page structure:
    - left column (1/6 of the whole page) - collapsable panel with tabs
    - right column - 5/6 of the whole page - currently selected tab
    - Tabs:
        - Financial performance
            - purpose: is to show: 
                - high level aggregated info across all assets: perofrmance, efficiency, etc. 
                - list of bess assets with:
                    - name
                    - revenue(total, predicted, actual, loss)
                    - location
                    - size
            - actions transitions:
                - click on item in assets list -> go to -> individual asset page
        - data sources
            - purpose: here users can add new data sources and connect it with some external API and/or integrations
- ?project=projectID page structure
    - total revenue loss
    - SLA metrics
    - chart of predicted revenue and actual revenue

## Storage layer(in memory)

- Purpose: in-memory, backend-like store to model data without a DB.
- Scope: actual and predicted series; hourly or sub-hourly intervals; UTC ISO 8601 timestamps.

### Electricity price(real and predicted)
Schema (TS-like):

```
type ISO8601 = string;          // e.g., "2024-09-01T00:00:00Z" (UTC)
type Market = 'DA' | 'INTRADAY' | 'RT';
type SeriesType = 'actual' | 'predicted';
type PricePoint = [interval_start_iso: ISO8601, price_per_mwh: number];

interface BasePriceSeries {
  series_id: string;             // unique
  zone_code: string;             // e.g., "DE-LU", "GB", or EIC
  market: Market;                // DA, INTRADAY, RT
  currency: string;              // ISO 4217 (e.g., EUR, GBP)
  interval_duration_min: number; // e.g., 60, 30, 15
  source: string;                // e.g., ENTSOE_DA, N2EX_RT
  data: PricePoint[];            // sorted ascending by time, non-overlapping
}

// Realized/settled prices
interface ActualPriceSeries extends BasePriceSeries {
  series_type: 'actual';
  revision?: number;             // increment on corrections
  publication_time?: ISO8601;    // optional: when feed was published/loaded
}

// Forecast/expected prices
interface PredictedPriceSeries extends BasePriceSeries {
  series_type: 'predicted';
  issued_at: ISO8601;            // forecast issuance time (required)
  quantile?: number;             // [0..1], default 0.5
  model_id?: string;             // optional model/config id
  scenario_id?: string;          // optional scenario tag (e.g., conservative/base)
  revision?: number;             // increment if forecast is corrected
}

type PriceSeries = ActualPriceSeries | PredictedPriceSeries;

interface PriceStoreV1 {
  version: '1.0';
  pricesById: Record<string, PriceSeries>;
  indexByZoneMarketType: Record<string, string[]>; // key: `${zone}|${market}|${series_type}`
  indexByZone: Record<string, string[]>;           // key: zone_code
  // For predicted series, track by issuance time to pick the latest available as-of
  indexPredByIssuedAt: Record<string, string[]>;   // key: `${zone}|${market}|predicted|${issued_at}`
}
```

Conventions:
- `series_id` recommended format: `<zone>_<market>_<type>[_q<quantile>][_i<ISO-issued>][_r<rev>]`.
- Keep each series homogeneous in `interval_duration_min` and currency.
- `data` must be strictly ascending by timestamp with no duplicates.
- Actual vs predicted:
  - Actual = realized/settled price series per zone+market (typically one canonical series, possibly with `revision`).
  - Predicted = forecast runs identified by `issued_at` (and optionally `quantile`, `model_id`, `scenario_id`). Multiple forecasts can exist for the same horizon.

Basic operations (conceptual):
- upsert(series): validate; set `pricesById[series_id] = series`; update secondary indexes with deduplication. For predicted, also update `indexPredByIssuedAt`.
- getActual(zone, market): use `indexByZoneMarketType[`${zone}|${market}|actual`]` → resolve the canonical actual series (if multiple, choose highest `revision`).
- getForecast(zone, market, opts): choose forecast series by rules:
  - If `opts.issued_at` provided, use that issuance exactly.
  - Else if `opts.as_of` provided, pick the latest `issued_at <= as_of`.
  - Filter by `opts.quantile` if provided; else default 0.5 when available.
- listZones(): `Object.keys(indexByZone)`.

Example series:

```
const deLuActual: PriceSeries = {
  series_id: 'DE-LU_DA_actual_r1',
  zone_code: 'DE-LU',
  market: 'DA',
  series_type: 'actual',
  currency: 'EUR',
  interval_duration_min: 60,
  source: 'ENTSOE_DA',
  revision: 1,
  data: [
    ['2024-09-01T00:00:00Z', 45.67],
    ['2024-09-01T01:00:00Z', 42.10]
  ]
};

const deLuPred: PriceSeries = {
  series_id: 'DE-LU_DA_predicted_q50_i2024-08-31T12:00:00Z_r1',
  zone_code: 'DE-LU',
  market: 'DA',
  series_type: 'predicted',
  currency: 'EUR',
  interval_duration_min: 60,
  source: 'ENTSOE_DA_V1',
  issued_at: '2024-08-31T12:00:00Z',
  quantile: 0.5,
  revision: 1,
  data: [
    ['2024-09-01T00:00:00Z', 47.12],
    ['2024-09-01T01:00:00Z', 43.05]
  ]
};
```

Note: later, BESS assets will reference a `zone_code` so the UI can resolve the correct price series using `indexByZoneMarketType`.

### Predicted consumption (per asset)

Goal: represent optimizer schedules for each BESS asset as forecast series, comparable across optimizer versions and price assumptions. Aligns with Readme.md

Schema (TS-like):

```
type AssetId = string;
type OpState = 'CHARGING' | 'DISCHARGING' | 'IDLE';
type ConsumptionPoint = {
  interval_start: ISO8601;          // UTC start time
  predicted_state: OpState;         // expected operating state
  predicted_power_mw: number;       // avg power over interval (signless; state carries sign)
  predicted_energy_mwh: number;     // energy for interval (>=0)
  predicted_soe_pct_end: number;    // SoE at end of interval [0..100]
};

interface BaseConsumptionForecastSeries {
  series_id: string;                // unique
  asset_id: AssetId;                // BESS identifier
  interval_duration_min: number;    // homogeneous within series
  optimizer_version: string;        // optimizer/model version tag
  price_assumption_source: string;  // e.g., price series id or provider
  data: ConsumptionPoint[];         // sorted asc by interval_start
}

interface ConsumptionForecastSeries extends BaseConsumptionForecastSeries {
  issued_at: ISO8601;               // forecast issuance (required)
  scenario_id?: string;             // optional tag (e.g., base, conservative)
  revision?: number;                // increment if corrected
}

interface ConsumptionStoreV1 {
  version: '1.0';
  forecastsById: Record<string, ConsumptionForecastSeries>;
  indexByAsset: Record<string, string[]>;                 // key: asset_id -> series_id[]
  indexByAssetIssuedAt: Record<string, string[]>;         // key: `${asset_id}|${issued_at}` -> series_id[]
  indexByAssetOpt: Record<string, string[]>;              // key: `${asset_id}|${optimizer_version}` -> series_id[]
}
```

Conventions:
- `series_id` format: `<asset>_cons_pred_i<ISO-issued>_opt<optimizer_version>[_s<scenario>][_r<rev>]`.
- `data` timestamps must be strictly ascending and cover contiguous intervals at `interval_duration_min`.
- `predicted_power_mw` is magnitude; sign is implied by `predicted_state`.
- The `price_assumption_source` should reference the price series used (e.g., `DE-LU_DA_predicted_q50_i...`).

Selection rules:
- getForecast(asset_id, opts):
  - If `opts.issued_at` provided, use the exact issuance.
  - Else if `opts.as_of` provided, pick the latest `issued_at <= as_of`.
  - Filter by `optimizer_version` and/or `scenario_id` when provided; if multiple remain, choose highest `revision`.

Example forecast series:

```
const bessA_Q50_Base: ConsumptionForecastSeries = {
  series_id: 'BESS-A_cons_pred_i2024-09-01T00:00:00Z_optv1_base_r1',
  asset_id: 'BESS-A',
  interval_duration_min: 60,
  optimizer_version: 'v1',
  price_assumption_source: 'DE-LU_DA_predicted_q50_i2024-08-31T12:00:00Z',
  issued_at: '2024-09-01T00:00:00Z',
  scenario_id: 'base',
  revision: 1,
  data: [
    { interval_start: '2024-09-01T00:00:00Z', predicted_state: 'CHARGING',   predicted_power_mw: 10, predicted_energy_mwh: 10, predicted_soe_pct_end: 45 },
    { interval_start: '2024-09-01T01:00:00Z', predicted_state: 'DISCHARGING', predicted_power_mw:  8, predicted_energy_mwh:  8, predicted_soe_pct_end: 37 }
  ]
};
```

Note: When computing revenue or SLA-weighted metrics, the UI should pair a consumption forecast series with the corresponding price series via `price_assumption_source` to ensure consistent assumptions.

## Data Sources UI (MVP behavior)

- Assets section: Create and list assets (BESS). Cards show basic specs and a Data sources area.
- Predicted electricity prices: Per asset, a dropdown lists all predicted price series available for the asset's `zone_code`.
  - Selection persists in-memory at `assetsStore.assetsById[asset_id].datasources.predicted_price`.
  - The “Add price stream” button opens the price modal prefilled with the asset's zone.
- Date formatting: Timestamps display as `dd/mm/yyyy HH:MM:SS UTC` to be locale-agnostic for the MVP.

### Actual data sources (simulated)

- Actual electricity prices:
  - Creation: Data Sources → “Actual electricity prices → +”. Fields: `zone_code`, `market`, `currency`, `interval_min`, `horizon_h`, `source`.
  - Series shape: Stored in `priceStore` with `series_type: 'actual'`, `data: [ISO8601, price]`.
  - Emission: One interval every 5 seconds, random walk similar to predicted.
  - Asset usage: Asset cards include a dropdown to select the active actual price series for the asset’s zone; saved to `asset.datasources.actual_price`.

- Actual consumption (telemetry):
  - Creation: Data Sources → “Actual consumption → +” (per asset). Fields: `asset`, `interval_min`, `horizon_h`, `source`.
  - Store: `telemetryStore` with series keyed by `series_id`; indexed by `asset_id`.
  - Datapoints: `{ interval_start, state, energy_charged_mwh, energy_discharged_mwh, soe_pct_end, availability_flag }`.
  - Emission: One interval every 5 seconds; respects asset SoC and power/efficiency parameters.
  - Asset usage: Asset cards include a dropdown to select the active actual consumption series; saved to `asset.datasources.actual_consumption`.

## Financial Performance & Project View

- Financial tab:
  - Lists all assets in a 3‑column layout with a header: Asset (name + id), Zone (location), Size (MW/MWh).
  - Adds a 4th column “Revenue (pred vs actual)” showing totals for predicted vs actual.
    - Predicted revenue is limited to the time coverage of actual data (e.g., if actual covers up to 15:00, predicted points after 15:00 are ignored in this total).
    - Refreshes periodically to reflect streaming updates.
    - Coloring: shows a delta (actual − predicted) in green when non‑negative and red when negative.
  - Each row is clickable and navigates to the project view `#project/<asset_id>`.
  - Adds a 5th column “SLA (time)”, computed from the selected (or latest) actual telemetry series for each asset.

- Project view (per-asset):
  - Header shows basic asset info, the selected predicted price datasource label, and the latest predicted consumption label.
  - Predicted Revenue chart:
    - Metric: Cumulative predicted revenue over time, with optional actual cumulative revenue overlay when actual sources are selected.
    - Per-interval revenue: `rev_t = price_t * (E_dis_t - E_chg_t)` where sign is taken from predicted_state (DISCHARGING positive, CHARGING negative, IDLE zero).
    - Cumulative series: `cum_t = sum_{k<=t} rev_k`.
    - Join rule: Intervals are included only when both price and consumption datapoints exist for the same `interval_start` ISO timestamp (applied separately for predicted and actual overlays).
    - Rendering: Simple canvas line chart with labeled axes (Y: currency; X: timeline) and legend (Predicted vs Actual). Updates ~every 2 seconds to reflect streaming sources.
  - Time-based SLA (MVP): Computed from the selected (or latest) actual telemetry as `SLA_time = sum(A_t · Δt) / sum(Δt)`, where `A_t = availability_flag ∈ {0,1}` and `Δt = interval_duration_min`. Displayed as a percentage on the project view.

Notes:
- The selected predicted price per asset is stored in `asset.datasources.predicted_price` and is used for revenue calculations.
- The project view uses the latest predicted consumption series returned by `consumptionStore.getForecast(asset_id)`.

## Demo bootstrap (optional)

- A guard flag `predefinedSimulatedAssetsEnabled` (boolean) initializes a demo scenario on page load when true.
  - Assets created:
    - `BESS-DE` in `DE-LU` (50MW/100MWh), SoC bounds 10–90%.
    - `BESS-GB` in `GB` (30MW/60MWh), SoC bounds 15–85%.
- Predicted price streams started (q0.5, 60-min intervals, 24h horizon, 5-second emission): one per zone; each asset selects its zone’s stream in `datasources.predicted_price`.
- Predicted consumption series started (60-min intervals, 24h horizon, 5-second emission): one per asset, tied to the selected price.
- Actual price streams started (60-min intervals, 24h horizon, 5-second emission): one per zone; each asset selects its zone’s stream in `datasources.actual_price`.
- Actual consumption series started (60-min intervals, 24h horizon, 5-second emission): one per asset; each asset selects its series in `datasources.actual_consumption`.
 - Timing: Predicted streams are preloaded for 2 simulated hours ahead starting at the current time; actual streams start at the current time. This makes the predicted revenue line initially extend ahead of the actual line, and both continue advancing together.
- Set the flag to `false` to start with a clean slate and create everything manually via the UI.

### Predicted price streams (simulated)
- Creation: Modal under Data Sources → “Predicted electricity prices → +”.
  - Fields: `zone_code`, `market`, `currency`, `interval_min`, `issued_at` (UTC), `quantile`, `horizon_h`, `source`.
  - Series ID format: `<zone>_<market>_predicted_q<quantile>_i<issued>_r1`.
- Emission: Simulation appends one interval every 5 seconds until `horizon_h` is reached.
  - Logical interval = `interval_min`; timestamps are ISO UTC.
  - Price values follow a bounded random walk for demo purposes.
- Listing: Active simulated streams appear with an “emitted x/y pts” counter and a Stop button.

### Predicted consumption (per asset, simulated)
- Creation: Modal under Data Sources → “Predicted consumption → +” (or from an Asset card).
  - Requires selecting an existing `asset`.
  - Fields: `asset`, `issued_at` (UTC), `interval_min`, `horizon_h`, `optimizer_version`, `scenario_id`, and `price_assumption_source` (predicted price series for the asset's zone).
  - Series ID format: `<asset>_cons_pred_i<issued>_opt<optimizer_version>[_s<scenario>]_r1`.
- Emission: Simulation appends one interval every 5 seconds until `horizon_h` is reached.
  - Respects asset parameters: `min_soc_pct`, `max_soc_pct`, `energy_capacity_mwh`, `power_rating_mw`, optional `max_charge_mw`, `max_discharge_mw`, `charge_efficiency_pct`, `discharge_efficiency_pct`.
  - Generates per-interval: `predicted_state`, `predicted_power_mw`, `predicted_energy_mwh`, `predicted_soe_pct_end`.
- Listing:
  - Asset cards show a bulleted list of predicted consumption series (`issued_at`, optimizer version, scenario).
  - A dedicated list of active simulated consumption series shows progress and a Stop button.

Notes:
- Asset cards currently support choosing the active predicted price source via a dropdown; consumption selection can be added similarly later.
- All simulations are in-memory and reset on reload.

### Assets (BESS)

Goal: represent battery assets with enough detail for planning, optimization assumptions, and UI listing/selection. Keep minimal but expressive for MVP.

Schema (TS-like):

```
type AssetId = string;
type AssetType = 'BESS';

interface BaseAsset {
  asset_id: AssetId;               // unique, stable identifier
  name: string;                    // human-readable label
  asset_type: AssetType;           // 'BESS' for now
  zone_code: string;               // e.g., 'DE-LU' — used to resolve prices
  project_id?: string;             // optional grouping
  commissioned_at?: ISO8601;       // optional metadata
}

// Battery-specific technical parameters
interface BessSpec {
  power_rating_mw: number;         // nameplate bidirectional power (<= grid constraint)
  energy_capacity_mwh: number;     // usable energy capacity
  max_charge_mw?: number;          // override of power limit for charge
  max_discharge_mw?: number;       // override of power limit for discharge
  min_soc_pct: number;             // [0..100]
  max_soc_pct: number;             // [0..100], >= min_soc_pct
  charge_efficiency_pct?: number;  // 0..100, default 95
  discharge_efficiency_pct?: number; // 0..100, default 95
  roundtrip_efficiency_pct?: number; // alternative to separate effs
  ramp_mw_per_min?: number;        // optional operational constraint
  parasitic_load_mw?: number;      // optional auxiliary consumption
}

type Asset = BaseAsset & {
  bess: BessSpec;                  // required for 'BESS' assets
  datasources?: {                  // selected data sources for this asset (by key)
    predicted_price?: string;      // series_id of chosen predicted price series for the asset's zone
    actual_price?: string;         // series_id of chosen actual price series for the asset's zone
    actual_consumption?: string;   // series_id of chosen actual consumption (telemetry) for this asset
    // future keys: consumption_forecast, weather, etc.
  };
};

interface AssetStoreV1 {
  version: '1.0';
  assetsById: Record<string, Asset>;
  indexByZone: Record<string, string[]>;  // `${zone_code}` -> asset_id[]
  indexByType: Record<string, string[]>;  // `${asset_type}` -> asset_id[]
}
```

Conventions:
- Keep units explicit in field names (`_mw`, `_mwh`, `_pct`).
- Prefer `charge_efficiency_pct` and `discharge_efficiency_pct`. If both omitted, use `roundtrip_efficiency_pct` or default 95% per-leg.
- `min_soc_pct` and `max_soc_pct` capture usable SoC window. Schedulers can derive SoC bounds in MWh from these and `energy_capacity_mwh`.
- `zone_code` ties the asset to price series from the PriceStore.
- `datasources.predicted_price` stores the selected predicted price `series_id` for calculations. If unset, UI may prompt to select or use a default.

Basic operations (conceptual):
- upsert(asset): set `assetsById[asset_id] = asset`, update `indexByZone` and `indexByType`.
- get(asset_id): return the asset record.
- list({ zone_code?, asset_type? }): filter via indexes, return matching assets.
- clear(): reset store.

Example asset:

```
const bessA: Asset = {
  asset_id: 'BESS-A',
  name: 'Battery A (50MW/100MWh)',
  asset_type: 'BESS',
  zone_code: 'DE-LU',
  commissioned_at: '2024-06-01T00:00:00Z',
  datasources: {
    predicted_price: 'DE-LU_DA_predicted_q0.5_i2024-08-31T12:00:00Z_r1'
  },
  bess: {
    power_rating_mw: 50,
    energy_capacity_mwh: 100,
    max_charge_mw: 50,
    max_discharge_mw: 50,
    min_soc_pct: 10,
    max_soc_pct: 90,
    charge_efficiency_pct: 95,
    discharge_efficiency_pct: 95,
    ramp_mw_per_min: 5,
    parasitic_load_mw: 0.2
  }
};
```
