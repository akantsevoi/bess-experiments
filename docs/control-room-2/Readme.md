# Control room 2

BESS control room application. 

# Idea of the product
Orka is a purpose-built SLA (Service Level Agreement) supplier management platform designed for Battery Energy Storage System (BESS) operators. It automates performance tracking, quantifies financial impact from supplier inefficiencies, and optimizes maintenance scheduling to maximize asset uptime and revenue.
1. Orka addresses the major gap in visibility and accountability across suppliers maintaining BESS assets. It converts what’s typically handled via manual spreadsheets and emails into an automated, data-driven platform.
2. Orka automates and integrates the entire SLA monitoring and supplier evaluation process:
    - Real-Time SLA Tracking:
        - Monitors supplier performance live against contractual KPIs.
        - Replaces manual reporting with automated scorecards.
    - Revenue-at-Risk Quantification:
        - Translates underperformance into clear financial metrics, revealing cost-saving opportunities.
    - Optimized Maintenance Scheduling:
        - Aligns maintenance timing with price signals, maximizing uptime during peak revenue hours and minimizing OPEX waste.
3. Value Proposition
    - Increased Asset Availability: Fewer unplanned outages through proactive insights.
    - Data-Driven Accountability: Clear supplier scorecards and traceable metrics.
    - Revenue Optimization: Maximizes utilization during profitable market periods.
    - Operational Efficiency: Reduces manual admin burden on asset operators.
4. Target User
    - Operators, owners, and managers of Battery Energy Storage Systems with multiple third-party service providers and maintenance SLAs

# Data model

In order to calculate revenue loss we need few data sources:
1. predicted electricity price
2. actual electricity prices
    - same as 1 but what happend in real life
    - will be used to compare revenue
3. documents/contracts from which we can extract targeted metrics: SLA, TTR, revenue loss, etc.
    - here we'll need some formulas of how we will calculate our metrics. They might vary for different operators/customers
4. BESS telemetry streams with the current state(charging, discharging, idle, down, etc.)
    - that one will show what exactly happens and how much electricity we buy/sell and what actually will happen to the module
5. predicted consumption
    - same as item 4 but the one that was predicted
    - will be used to compare revenue

## Predicted price
- event_id: unique id of provided piece of information
- zone_code: Bidding zone (e.g., DE-LU, GB, SE3 or EIC like 10Y1001A1001A82H).
- market: Price type — DA, INTRADAY, RT.
- currency: ISO 4217 (e.g., EUR, GBP).
- issued_at: Forecast issuance timestamp (UTC, ISO 8601).
- interval_start: Delivery interval start (UTC, ISO 8601).
- interval_duration_min: Interval length in minutes (e.g., 60, 30, 15).
- quantile: [0..1] used in case we have several predictions for the same time interval(default is 0.5)
- price_per_mwh: Numeric price in currency/MWh (can be negative).
- source: Provider/model identifier (e.g., ENTSOE_DA_V1).
- revision: Integer or tag if the operator issues corrections.


## Actual price
- event_id: unique id of provided piece of information
- zone_code: Bidding zone (e.g., DE-LU, GB, SE3; EIC optional).
- currency: ISO 4217 (e.g., EUR, GBP).
- interval_start: Delivery interval start (UTC, ISO 8601).
- interval_duration_min: Interval length in minutes (e.g., 60, 30, 15).
- price_per_mwh: Settlement/clearing price in currency/MWh (can be negative).
- source: Provider/feed identifier (e.g., ENTSOE_DA, N2EX_RT).
- revision: Integer or tag if the operator issues corrections.
- series: If we have several provider with different methodologies(auction vs continuous). Not very important rn

## BESS telemetry stream(what happens/happened)
- event_id: Unique identifier of the telemetry record.
- asset_id: Identifier of the BESS site or asset.
- unit_id: Optional identifier of a sub-unit (inverter, container, battery block).
- interval_start: Start of the telemetry interval (UTC, ISO 8601).
- interval_duration_min: Interval length in minutes (e.g., 5, 15, 30, 60).
- state: High-level operational state of the BESS (CHARGING, DISCHARGING, IDLE, DOWN, DERATED, STARTING, STOPPING).

Electrical measurements
- active_power_mw: Average active power during the interval (positive = discharge to grid, negative = charging).
    - High-frequency SCADA signal
    - Often averaged, filtered, or clipped
- reactive_power_mvar: Average reactive(grid stabilizing) power during the interval.
- energy_charged_mwh: Energy absorbed from the grid during the interval.
    - settlement-relevant value
- energy_discharged_mwh: Energy delivered to the grid during the interval.
    - settlement-relevant value
- grid_connection_status: Connection state to the grid (CONNECTED, DISCONNECTED).

Availability and capability
- available_power_mw: Maximum power the asset could have delivered or absorbed during the interval.
- available_energy_mwh: Usable energy available given SoE and technical constraints.
- availability_flag: Whether the asset meets the SLA availability definition for this interval.

Battery state
- state_of_health_pct: Estimated remaining battery health (%).
- state_of_energy_pct: State of energy at the end of the interval (%).
- min_soe_pct: Lower operational SoE limit enforced by the system.
- max_soe_pct: Upper operational SoE limit enforced by the system.
- temperature_c_avg: Average battery temperature (if available).

Downtime and fault attribution
- downtime_flag: Indicates whether the asset is unavailable or constrained.
- downtime_reason: Root cause of downtime or derating (SCHEDULED_MAINTENANCE, UNSCHEDULED_MAINTENANCE, INVERTER_FAULT, BATTERY_FAULT, HVAC_FAULT, COMMUNICATION_FAILURE, GRID_OUTAGE, SAFETY_LOCKOUT).
- responsible_party: Party accountable for the downtime (OEM, O_AND_M_PROVIDER, OPERATOR, GRID_OPERATOR).
- ticket_id: Reference to maintenance or incident ticket (if applicable).

## Predicted consumption
- event_id: Unique identifier of the prediction record.
- asset_id: Identifier of the BESS site or asset.
- interval_start: Start of the predicted interval (UTC, ISO 8601).
- interval_duration_min: Interval length in minutes.
- predicted_state: Expected operating state (CHARGING, DISCHARGING, IDLE).
- predicted_power_mw: Expected average power for the interval.
- predicted_energy_mwh: Expected energy charged or discharged.
- predicted_soe_pct_end: Expected state of energy at the end of the interval.
- optimizer_version: Identifier of the optimization logic or model used.
    - not very important rn, but can be used to compare different models in the future
- price_assumption_source: Price forecast source used for the prediction.

# SLA & Performance Metrics

## Definitions/terminology
- t∈{1,…,T} with duration Δt (in hours/minutes). 
All the datapoints are resampled to the same Δt:
    - bigger intervals split
    - smaller intervals - proportional average
- I_SLA = set of intervals that count for SLA
- A_t = availability flag
    - 1 = available according to SLA
    - 0 = unavailable
- S_t = should-be-working flag
      1 = asset was expected to operate (charge or discharge)
      0 = asset expected to be idle
- p_t = actual electricity price (currency per MWh)
- E_act_dis_t  = actual discharged energy (MWh)
- E_act_chg_t  = actual charged energy (MWh)
- E_pred_dis_t = predicted discharged energy (MWh)
- E_pred_chg_t = predicted charged energy (MWh)

## Time-based SLA (For how much of the contract time was the asset available?)
```
SLA_time = 
    available_time / eligible_time
where
available_time = 
    sum over t in I_SLA of (A_t * Δt)
eligible_time = 
    sum over t in I_SLA of Δt
```
## Supplier-attributed time-based SLA (How much of the unavailability was actually the supplier’s fault?)
Supplier-attributed time-based SLA measures availability after excluding downtime that was not caused by the supplier. ex.:
- grid outage does not count against supplier
- inverter faults count
```
Supplier_available_time =
    sum over t in I_SLA of (Supplier_available_t * Δt)

Eligible_time =
    sum over t in I_SLA of Δt

Supplier_SLA_time =
    Supplier_available_time / Eligible_time
```
## Price-weighted SLA
- w_t = max(p_t · d_t, 0)
    - decides weight on a particular time interval(how much it counts)
- d_t ∈ {+1 (discharge), −1 (charge), 0 (idle)}
    - predicted states(ex. if predicted - idle then price is 0)
    - same as S_t but signed
```
SLA_price =
    weighted_available_value / weighted_expected_value
where
weighted_available_value =
    sum over t in I_SLA of (A_t * S_t * w_t * Δt)
weighted_expected_value =
    sum over t in I_SLA of (S_t * w_t * Δt)
```
### example
| t  | p_t | Predicted state | A_t (available) | S_t (counts) | d_t | w_t | Weighted_t = S_t · w_t · Δt (expected) | WeightedAvailable_t = A_t · Weighted_t |
| - | - | - | - | - | - | - | - | - |
| t1 | 200 | DISCHARGING | 0 | 1 | +1  | 200 | 200| 0 |
| t2 | 15| IDLE| 0| 0| 0| 0| 0| 0|
| t3 | -100| CHARGING| 1| 1| -1  | 100| 100| 100|

```
TotalWeightedExpected  = 200 + 0 + 100 = 300
TotalWeightedAvailable =   0 + 0 + 100 = 100

SLA_price = 100 / 300 = 0.3333... = 33.33%
```
Which means that out of 100 economically important 'units' the asset was available only for 33.(3) of them.

## Revenuce calculation
### Predicted Revenue
```
Revenue_predicted =
    sum over t of (p_t * (E_pred_dis_t - E_pred_chg_t))
```
### Actual revenue
```
Revenue_actual =
    sum over t of (p_t * (E_act_dis_t - E_act_chg_t))
```
### Total revenue loss
```
Revenue_loss =
    Revenue_predicted - Revenue_actual
```
### Revenue loss(caused by downtime)
```
Revenue_loss_downtime =
    sum over t of (
        (1 - A_t)
        * S_t
        * p_t
        * (E_pred_dis_t - E_pred_chg_t)
    )
```
### Supplier-attributed downtime revenue loss
- R_t = supplier responsibility flag
    - 1 = downtime caused by supplier
    - 0 = not supplier responsibility
```
Revenue_loss_downtime_supplier =
    sum over t of (
        (1 - A_t)
        * R_t
        * S_t
        * p_t
        * (E_pred_dis_t - E_pred_chg_t)
    )
```

## Utilization

### Energy-throughput utilization
Out of everything this battery could have moved, how much did it really move?
```
Utilization_throughput =
    total_energy_moved / maximum_possible_energy
where
total_energy_moved =
    sum over t of (E_act_dis_t + E_act_chg_t)
maximum_possible_energy =
    P_rated * sum over t of Δt
```
### Active-time utilization
During what fraction of time was the BESS actively operating instead of sitting idle or being unavailable?
```
Utilization_active_time =
    active_time / total_time
where
active_time =
    sum over t where state is CHARGING or DISCHARGING of Δt
```

### Power-based utilization
How hard (in MW) did I run the asset on average? Intensity
```
Utilization_power =
    sum over t of (abs(p_t) * Δt)
    /
    (P_rated * sum over t of Δt)
```