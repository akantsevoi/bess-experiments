# BESS Revenue-Loss Demo (HTML + JS)

A one-page, backend-less prototype to quantify revenue loss from deviations vs. a predicted dispatch plan.  
All data is loaded locally (JSON/CSV), normalized to 5-minute slices, aligned by `(battery_id, slice_ts)`, and then aggregated into per-battery and portfolio KPIs.

## What this demo does
- Ingests **Energy Price**, **Battery Meta**, **Predicted Schedule**, **Actual Events**.
- Resamples everything to **5-minute** canonical slices.
- Joins predicted vs. actual power with prices to compute **revenue, loss, and downtime loss**.
- (New) Computes **Availability** two ways and shows how contract design changes the money:
  - **Time-based Availability** (contract style)
  - **Value-based Availability** (dispatch/price weighted)

---

## Inputs (files or pasted JSON/CSV)
- **Price**: step series in 5/15/30/60-min intervals → forward-filled to 5-min. Column keys: `ts`, `price_eur_mwh`, `interval_min`.
- **Battery Meta**: `battery_id`, `display_name`, `capacity_kwh`, `power_kw`.
- **Predicted Schedule** (blocks): `battery_id`, `start_ts`, `end_ts`, `mode` ∈ {CHARGE, DISCHARGE, IDLE}, `power_kw` (sign rule: discharge +, charge −).
- **Actual Events** (samples or 5-min): `battery_id`, `ts`, `mode` ∈ {CHARGE, DISCHARGE, IDLE, DOWNTIME}, `power_kw`, optional `soc_pct`.

> All timestamps are ISO-8601 with timezone. Internal timezone shown in UI: **Europe/Stockholm**.

---

## Canonical 5-minute model (internal)
- **Price5**: `{ slice_ts, price_eur_mwh }`
- **Pred5**: `{ battery_id, slice_ts, mode, power_kw }`
- **Act5**: `{ battery_id, slice_ts, mode, power_kw, soc_pct? }`

---

## Revenue & Loss (existing)
For each slice \(t\) (5 minutes → \(h=\frac{5}{60}\) h):
- \( \text{price}_{\text{kWh}}(t) = \frac{\text{price}_{\text{EUR/MWh}}(t)}{1000} \)
- \( e_{\text{pred}}(t) = P_{\text{pred}}(t)\cdot h \), \( e_{\text{act}}(t) = P_{\text{act}}(t)\cdot h \)
- \( \text{rev}_{\text{pred}}(t) = e_{\text{pred}}(t)\cdot \text{price}_{\text{kWh}}(t) \)
- \( \text{rev}_{\text{act}}(t)  = e_{\text{act}}(t)\cdot \text{price}_{\text{kWh}}(t) \)
- **Loss**: \( \text{loss}(t) = \text{rev}_{\text{pred}}(t) - \text{rev}_{\text{act}}(t) \)
- **Downtime loss**: if `act.mode == DOWNTIME`, then \( \text{loss}_{\text{downtime}}(t) = \text{rev}_{\text{pred}}(t) \) else 0

Aggregations are simple sums over a selected window and battery set.

---

## NEW — Availability Analytics

### Why
Time-based SLAs reward being “up” in low-value hours and ignore being “down” when money is highest.  
We show both **Time-based** and **Value-based** availability to surface hidden costs and align incentives.

### A) Time-based Availability (contract style)
Measures *minutes up* over *total minutes*, regardless of price or schedule.

**Definition**
- Define a slice as **available** when the asset is not in `DOWNTIME`.  
  (Optional stricter rule for partial derate: consider available if \(|P_{\text{act}}(t)| \ge \theta \cdot \text{power\_rating}\), with default \(\theta=0.9\).)
- Let \(U(t)=1\) if available at \(t\), else 0.

\[
A_{\text{time}}=\frac{\sum_t U(t)}{\sum_t 1}
\]

**Notes**
- Contractual exclusions (e.g., grid outage) can be toggled in UI; excluded slices are removed from both numerator and denominator.

### B) Value-based Availability (dispatch/price weighted)
Measures availability **only when it matters economically**.

**Instructed window**
- A slice is **instructed** if \(|P_{\text{pred}}(t)| \ge P_{\min}\) (default \(P_{\min}=0.1\cdot\text{power\_rating}\)).

**Partial availability**
\[
a(t)=
\begin{cases}
\min\!\left(1,\ \dfrac{|P_{\text{act}}(t)|}{|P_{\text{pred}}(t)|}\right), & \text{if instructed}\\[6pt]
1, & \text{otherwise}
\end{cases}
\]

**Economic weight**  
Use money at stake as a weight:  
\[
w(t)=\text{price}_{\text{kWh}}(t)\cdot |P_{\text{pred}}(t)|
\]

**Definition**
\[
A_{\text{value}}=\frac{\sum_t a(t)\cdot w(t)\cdot \mathbf{1}_{\text{instructed}}(t)}{\sum_t w(t)\cdot \mathbf{1}_{\text{instructed}}(t)}
\]

**Interpretation**
- \(A_{\text{time}}\) can be ≥95% while \(A_{\text{value}}\) is lower if outages/derates cluster in high-price hours.
- When no schedule exists, an alternate baseline can be used in UI: \(w(t)=\text{price}_{\text{kWh}}(t)\cdot \text{power\_rating}\).

### C) “Headroom Cost” (optional KPI)
Money left on the table while you are still **above** the time-based SLA threshold.

\[
\text{HeadroomCost}=\sum_{\substack{t\ \text{in window where}\ A_{\text{time}}\ge \text{SLA}}}
\Big(|P_{\text{pred}}(t)|-|P_{\text{act}}(t)|\Big)^{+}\cdot h \cdot \text{price}_{\text{kWh}}(t)
\]

This isolates the gap that standard contracts ignore.

---

## UI — How availability is displayed

### KPIs (top cards)
- **A_time**: Time-based availability (%, with/without exclusions)
- **A_value**: Value-based availability (%)
- **Revenue Loss (total)**, **Downtime Loss**, **Headroom Cost** (optional)
- **Distance to Breach**: additional downtime minutes at current pattern until SLA floor (e.g., 95%) is crossed

### Charts
- **Availability ribbon** (per 5-min slice): Available / Derated / Downtime, with **price overlay**.
- **Loss by hour**: bars of loss(t) with markers where slices are instructed.

### Tables
- **Per-battery daily summary**:  
  `date, battery_id, A_time, A_value, rev_pred_eur, rev_act_eur, loss_eur, loss_downtime_eur, headroom_cost_eur`
- **Per-slice diff** (existing) gains extra columns:  
  `instructed (bool), a(t) (0..1), w(t)`

### Config (sidebar)
- SLA floor (default **95%**), availability **threshold θ** (default **90% of rating**), **P_min** for “instructed” (default **10% of rating**), **Apply exclusions** (on/off), **Baseline** for value weighting (Predicted vs Rating-based).

---

## Validation rules (hard errors)
- Timestamps are parseable and ordered; schedule blocks have `start < end`.
- Battery IDs in schedules/actuals exist in meta.
- Price series covers the selected window after step-fill.
- Power is clipped to rating; SOC ∈ [0,100].

---

## Acceptance tests (deterministic)
1) **All match**: Predicted==Actual → \(A_{\text{time}}=A_{\text{value}}=100\%\), Loss=0.  
2) **Off-peak downtime**: Downtime only at low prices → \(A_{\text{time}}\) drops slightly, \(A_{\text{value}}\) barely changes.  
3) **Peak downtime**: Downtime in top-decile price hours → same minutes lost, but \(A_{\text{value}}\ll A_{\text{time}}\); HeadroomCost > 0 if still above SLA.  
4) **Derate**: Actual power at 70% of instructed → partial \(a(t)=0.7\) reduces \(A_{\text{value}}\) without counting as full downtime.

---

## Notes & scope
- Round-trip efficiency, degradation/SoH, and ancillary services are out of scope for v1.
- Availability uses existing inputs; if a true capability signal (`available_power_kw`, `derate_reason`) becomes available, swap \(a(t)\) to use capability vs. instruction.

---

## Changelog
- **2025-08-11** — Added **Availability Analytics** section with **Time-based** and **Value-based** availability metrics, formulas, UI, and tests.
