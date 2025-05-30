# Warm up


### Price data event looks like
```json
{
  "forecast_run_id": "1e9e47f0-a0e2-11ee-b0c4-7bbd3ba14abd",
  "issued_at": "2025-05-23T06:45:00Z",
  "market_node": "SE3",
  "currency": "EUR",
  "price_unit": "€/MWh",
  "horizon_hours": 48,
  "prices": [
    {"start":"2025-05-23T07:00Z","price":78.95},
    {"start":"2025-05-23T08:00Z","price":82.10},
    ...
  ],
  "schema_version": 2
}
```
and each hour the new one comes.
horizon_hours - means we have forecast datapoints for the next 48 hours(48 datapoints)




### Maintenance event stream looks like
```json
{
  "event_id": "93656c8c-a1e1-11ee-8f33-fbc920f02a36",
  "issue_id": "3883a81a-aebd-4573-87b3-ea46350f1be8",
  "revision": 1,
  "detected_at": "2025-05-23T05:17:00Z",
  "asset_id": "BESS-12",
  "component_name": "Power Conversion System",
  "component_id": "BESS-12.PCS-123",
  "fault_code": "PCS_OVERTEMP",
  "severity_level": "CRITICAL",
  "reaction_time_limit": "30h",
  "estimated_repair_hours": 2.5,  
  "manual_url": "https://maint.example.com/pcs/ovtemp#step3",
  "status": "OPEN",
  "comment": "Temperature rose to 95 °C; fan #2 failed.",
  "schema_version": 3
}
```
estimated_repair_hours
- doesn't include the info about how much we need to prepare everything for the maintenance ex: to discharge, moving it offline, cool down, etc



### Maintenance schedule created event
```json
{
  "schema_version": 1,
  "schedule_id": "57f7d29e-08e4-4ade-9269-d0f7c5e41216",
  "revision": 3,                          // 0-based counter
  "generated_at": "2025-05-23T07:55:23Z", // when optimiser produced THIS snapshot
  "valid_from": "2025-05-23T08:00:00Z",   // schedule starts applying
  "basis_price_run_ids": [ // for traceability
    "1e9e47f0-a0e2-11ee-b0c4-7bbd3ba14abd"
  ],
  "basis_event_ids": [  // for traceability
    "93656c8c-a1e1-11ee-8f33-fbc920f02a36"
  ],
  "tasks": [
    {
      "task_id": "bd702712-ad94-4afb-91da-7c60b5e9c7ce",
      "issue_id": "3883a81a-aebd-4573-87b3-ea46350f1be8",
      "asset_id": "BESS-12",
      "component_id": "BESS-12.PCS-123",
      "fault_code": "PCS_OVERTEMP",
      "severity_level": "CRITICAL",
      "manual_url": "https://maint.example.com/pcs/ovtemp#step3",
      "estimated_repair_hours": 2.5,
      "planned_start": "2025-05-23T22:00:00Z",
      "planned_finish": "2025-05-23T24:30:00Z",   
    }
  ]
}
```
