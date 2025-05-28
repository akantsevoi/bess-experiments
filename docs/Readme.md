# UI prototype

Fake data for UI prototype

## Energy prices

```json

{    
    "forecast_run_id": "run-0",
    "issued_at": "2025-05-27T00:00:00Z",
    "market_node": "SE3",
    "currency": "EUR",
    "price_unit": "€/MWh",
    "horizon_hours": 24,
    "prices": [
        { "start": "2025-05-27T01:00:00Z", "price": 70.40 },
        { "start": "2025-05-27T02:00:00Z", "price": 70.80 },
        { "start": "2025-05-27T03:00:00Z", "price": 71.20 },
        { "start": "2025-05-27T04:00:00Z", "price": 71.60 },
        { "start": "2025-05-27T05:00:00Z", "price": 72.00 },
        { "start": "2025-05-27T06:00:00Z", "price": 72.40 },
        { "start": "2025-05-27T07:00:00Z", "price": 89.80 },
        { "start": "2025-05-27T08:00:00Z", "price": 134.20 },
        { "start": "2025-05-27T09:00:00Z", "price": 178.60 },
        { "start": "2025-05-27T10:00:00Z", "price": 101.00 },
        { "start": "2025-05-27T11:00:00Z", "price": 60.40 },
        { "start": "2025-05-27T12:00:00Z", "price": 52.80 },
        { "start": "2025-05-27T13:00:00Z", "price": 51.20 },
        { "start": "2025-05-27T14:00:00Z", "price": 75.60 },
        { "start": "2025-05-27T15:00:00Z", "price": 76.00 },
        { "start": "2025-05-27T16:00:00Z", "price": 80.40 },
        { "start": "2025-05-27T17:00:00Z", "price": 98.80 },
        { "start": "2025-05-27T18:00:00Z", "price": 158.20 },
        { "start": "2025-05-27T19:00:00Z", "price": 156.60 },
        { "start": "2025-05-27T20:00:00Z", "price": 154.00 },
        { "start": "2025-05-27T21:00:00Z", "price": 134.40 },
        { "start": "2025-05-27T22:00:00Z", "price": 90.80 },
        { "start": "2025-05-27T23:00:00Z", "price": 79.20 },
        { "start": "2025-05-28T00:00:00Z", "price": 60.60 }
    ],
    "schema_version": 2
}

```


## Maintenance requests

```json

{
    "requests": [
        {
            "event_id": "93656c8c-a1e1-11ee-8f33-fbc920f02a36",
            "issue_id": "3883a81a-aebd-4573-87b3-ea46350f1be8",
            "revision": 1,
            "detected_at": "2025-05-23T05:17:00Z",
            "asset_id": "BESS-03",
            "component_name": "Power Conversion System",
            "component_id": "BESS-03.PCS-2",
            "fault_code": "PCS_OVERTEMP",
            "severity_level": "CRITICAL",
            "reaction_time_limit": "30h",
            "estimated_repair_hours": 2.5,  
            "manual_url": "https://maint.example.com/pcs/ovtemp#step3",
            "status": "OPEN",
            "comment": "Temperature rose to 95 °C; fan #2 failed.",
            "schema_version": 3
        },
        {
            "event_id": "d14b6d0a-d68b-48c6-86f9-3b9b6c6844f9",
            "issue_id": "5d95696b-a100-4a7a-9f05-c2eef82c659a",
            "revision": 1,
            "detected_at": "2025-05-23T04:18:00Z",
            "asset_id": "BESS-01",
            "component_name": "Power Conversion System",
            "component_id": "BESS-01.PCS-1",
            "fault_code": "PCS_OVERTEMP",
            "severity_level": "LOW",
            "reaction_time_limit": "30h",
            "estimated_repair_hours": 0.5,  
            "manual_url": "https://maint.example.com/pcs/ovtemp#step3",
            "status": "OPEN",
            "comment": "Temperature rose to 75 °C; fan #2 failed.",
            "schema_version": 3
        }
    ]
}
```

# Assets modules

```json
{
    "assets": [
        {
            "id": "BESS-01",
            "display_name": "Module 1",
            "modules": [
                {
                    "id": "BESS-01.PCS-1",
                    "type": "fan"
                },
                {
                    "id": "BESS-01.PCS-2",
                    "type": "fan"
                }
            ]
        },
        {
            "id": "BESS-02",
            "display_name": "Forgot to add the name",
            "modules": [
                {
                    "id": "BESS-02.PCS-1",
                    "type": "fan"
                },
                {
                    "id": "BESS-02.PCS-2",
                    "type": "fan"
                }
            ]
        },
        {
            "id": "BESS-03",
            "display_name": "Best module",
            "modules": [
                {
                    "id": "BESS-03.PCS-1",
                    "type": "fan"
                },
                {
                    "id": "BESS-03.PCS-2",
                    "type": "fan"
                }
            ]
        },
        {
            "id": "BESS-04",
            "display_name": "unknown",
            "modules": [
                {
                    "id": "BESS-04.PCS-1",
                    "type": "fan"
                },
                {
                    "id": "BESS-04.PCS-2",
                    "type": "fan"
                }
            ]
        },
        {
            "id": "BESS-05",
            "display_name": "default name",
            "modules": [
                {
                    "id": "BESS-05.PCS-1",
                    "type": "fan"
                },
                {
                    "id": "BESS-06.PCS-2",
                    "type": "fan"
                }
            ]
        },
        {
            "id": "BESS-07",
            "display_name": ":)",
            "modules": [
                {
                    "id": "BESS-07.PCS-1",
                    "type": "fan"
                },
                {
                    "id": "BESS-07.PCS-2",
                    "type": "fan"
                }
            ]
        },
    ]
}
```

# Maintenance schedule

```json
{
    "schedule": [
        {
            "plan_id": "5460e244-2fb1-45ce-ad45-e90d3aca1473",
            "request_issue_id": "3883a81a-aebd-4573-87b3-ea46350f1be8",
            "maintenance_start": "2025-05-27T12:00:00Z",
            "maintenance_end": "2025-05-27T14:00:00Z",
            "asset_id":"BESS-03"
        },
        {
            "plan_id": "709d5c30-b8e5-4e5e-ade0-d4e321f5b921",
            "request_issue_id": "5d95696b-a100-4a7a-9f05-c2eef82c659a",
            "maintenance_start": "2025-05-27T15:00:00Z",
            "maintenance_end": "2025-05-27T16:00:00Z",
            "asset_id":"BESS-01"
        }
    ],
}
```