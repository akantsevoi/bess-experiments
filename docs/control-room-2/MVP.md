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
