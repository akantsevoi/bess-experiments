# BESS Revenue Loss Analysis Specification

This document outlines the data inputs, calculations, and visualizations for the BESS (Battery Energy Storage System) revenue loss analysis tool.

## 1. Input Data

The tool requires four JSON or CSV files as input(ex check in fiels folder):

### 1.1. Battery Metadata (`battery_meta.json`)

Contains the specifications for each battery in the portfolio.

-   `battery_id` (string): Unique identifier for the battery.
-   `capacity_kwh` (number): Total energy capacity of the battery in kilowatt-hours.
-   `power_kw` (number): Maximum charge/discharge power in kilowatts.

### 1.2. Price Data (`price_15min.json`)

Contains the electricity market prices.

-   `ts` (string): Timestamp for the start of the price interval (ISO 8601 format).
-   `price_eur_mwh` (number): Price of electricity in Euros per megawatt-hour.
-   `interval_min` (number): The duration of the price interval in minutes (e.g., 15).

### 1.3. Predicted Schedule (`pred_schedule.json`)

The planned operational schedule for each battery, determined by an optimization model.

-   `battery_id` (string): The battery this schedule applies to.
-   `start_ts` (string): Start timestamp for the operational block.
-   `end_ts` (string): End timestamp for the operational block.
-   `mode` (string): mode ∈ {CHARGE, DISCHARGE, IDLE}.
-   `power_kw` (number): The power to be used. Negative for charging, positive for discharging.

### 1.4. Actual Events (`actual_events_5min.json`)

The recorded real-world performance of each battery.

-   `battery_id` (string): The battery the event belongs to.
-   `ts` (string): Timestamp of the measurement.
-   `mode` (string): The recorded operational mode ∈ {CHARGE, DISCHARGE, IDLE, DOWNTIME}. 
-   `power_kw` (number): The measured power.
-   `soc_pct` (number): The measured state of charge as a percentage.

## 2. Calculations

The core of the analysis is to compare the predicted revenue with the actual revenue and quantify the loss. All data is standardized to **5-minute intervals**.

### 2.1. Data Standardization

-   **Price Data**: Prices are upsampled from their original interval (e.g., 15 minutes) to 5-minute intervals, assuming the price is constant within its original interval.
-   **Predicted Schedule**: The schedule blocks are "exploded" into a series of 5-minute intervals with the specified power.
-   **Actual Events**: If multiple events occur within a 5-minute bucket, their power is averaged. If no event occurs, it's considered `DOWNTIME`.

### 2.2. Core Formulas

For each 5-minute time slice `t`:

-   **Energy (kWh)**:
    `Energy (kWh) = Power (kW) * (5 / 60) hours`

-   **Revenue (EUR)**:
    `Revenue (EUR) = Energy (kWh) * Price (EUR/kWh)`

These formulas are applied to both predicted and actual data to get `rev_pred_eur` and `rev_act_eur` for each slice.

### 2.3. Key Metrics

-   **Revenue Loss**:
    `Loss (EUR) = Predicted Revenue - Actual Revenue`

-   **Downtime Loss**:
    A subset of the total loss, calculated as the predicted revenue during periods where the battery was in `DOWNTIME`.

-   **Deviation Loss**:
    The portion of the loss that is not due to downtime.
    `Deviation Loss = Total Loss - Downtime Loss`

-   **Utilization**:
    The percentage of the battery's potential energy throughput that was actually used.
    `Utilization % = (Total Actual Energy Dispatched / (Rated Power * Time)) * 100`

### 2.4. Availability Metrics (time-based and value-based)

Availability is computed on the same 5-minute intervals.

-   **Time-Based Availability (`A_time`)**
    Fraction of time the battery is not in `DOWNTIME`:
    `A_time = (Number of non-DOWNTIME slices) / (Total slices in period)`
    *Note*: Partial derates still count as “available” here; only explicit `DOWNTIME` marks unavailability.

-   **Value-Based Availability (`A_dispatch`)**
    Evaluates availability only when the battery was expected to operate (charge or discharge), using the predicted schedule:
    - Define an “instructed” slice when `abs(pred_power_kw) >= P_min`. (`P_min` is configurable; default is **5% of battery power rating**.)
    - For instructed slices, compute partial availability:
      `a(t) = min(1, abs(act_power_kw) / abs(pred_power_kw))`
    - For non-instructed slices, set `a(t) = 1` (they do not penalize the score).
    - Dispatch-weighted availability (restricted to instructed slices):
      `A_dispatch = (Σ a(t) over instructed slices) / (Number of instructed slices)`

-   **(Optional) Price-Weighted Availability (`A_econ`)**
    Weigh availability by the economic importance of each slice:
    - Weight per slice: `w(t) = price_eur_mwh(t) * abs(pred_power_kw(t))`
    - `A_econ = (Σ a(t) * w(t)) / (Σ w(t))`

-   **Headroom Cost (informational)**
    Monetized shortfall during periods that do **not** breach a time-based SLA threshold (e.g., 95%):
    `Headroom Cost (EUR) = Σ ((abs(pred_power_kw) - abs(act_power_kw))⁺ * (5/60) * (price_eur_mwh/1000))`
    computed over slices where the rolling/windowed `A_time` remains ≥ the SLA target.

## 3. Display & Visualization

The results are presented through several KPIs and charts:

### 3.1. KPIs (Key Performance Indicators)

-   **Total Predicted Revenue**: Sum of `rev_pred_eur` over the selected period.
-   **Total Actual Revenue**: Sum of `rev_act_eur` over the period.
-   **Total Revenue Loss**: Sum of `loss_eur` over the period.
-   **Total Downtime Loss**: Sum of `loss_downtime_eur`.
-   **Portfolio Utilization %**: The utilization percentage for the entire portfolio.

### 3.2. Charts

-   **Cumulative Revenue Chart**: A line chart showing the cumulative predicted vs. actual revenue over time. Downtime periods are marked with a transparent grey background.
-   **Loss Breakdown Chart**: A stacked bar chart showing the breakdown of revenue loss into "Downtime Loss" and "Deviation Loss" for each battery on each day. A line series for "Utilization %" is overlaid.
-   **Loss Heatmap**: A matrix visualizing either the total `Loss (EUR)` or the dispatch `Error (abs(actual_power - pred_power))` for each battery (y-axis) at each hour of the day (x-axis). Cell color intensity represents the magnitude of the metric. Downtime hours are marked with a diamond shape.

### 3.3. Availability KPIs & Visualizations

-   **Availability KPIs**:
    - `Time Availability (A_time %)` for the selected window.
    - `Value-Based Availability (A_dispatch %)`; the configured `P_min` is shown in the legend.
    - `(Optional) Price-Weighted Availability (A_econ %)` if price-weighting is enabled.
    - **Headroom Cost (EUR)** and **Distance to Breach** (minutes of additional downtime until a 95% SLA would be breached).

-   **Availability Timeline**: Ribbon view over time per battery with segments colored as *Available*, *Derated* (partial availability), and *Downtime*. Price or predicted power can be overlaid to highlight high-value periods.

-   **Top Outage Episodes Table**: List of contiguous unavailability/derate episodes with start/end time, duration, average price, lost energy (kWh), and estimated cost (EUR). Sortable by cost or duration.

-   **SLA Window Summary**: Monthly (or user-selected) window cards showing `A_time`, `A_dispatch`, `(optional) A_econ`, number of incidents, and cumulative Headroom Cost.
