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

The core of the analysis is to compare the predicted revenue with the actual revenue and quantify the loss. All data is standardized to **configurable discretization intervals** (default: 5 minutes).

### 2.1. Data Standardization

-   **Price Data**: Prices are upsampled from their original interval (e.g., 15 minutes) to discretization intervals, assuming the price is constant within its original interval.
-   **Predicted Schedule**: The schedule blocks are "exploded" into a series of discretization intervals with the specified power.
-   **Actual Events**: If multiple events occur within a discretization interval bucket, their power is averaged. If no event occurs, it's considered `DOWNTIME`.

# Development

Follow instructions [AGENTS.md](./AGENTS.md)