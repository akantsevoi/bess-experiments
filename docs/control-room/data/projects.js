// Projects with embedded revenue-loss summaries and BMS errors (demo data)
(function(){
  const project001 = {
    projectId: 'P-001',
    name: 'Hamburg BESS',
    location: { city: 'Hamburg', country: 'DE', lat: 53.55, lon: 10.00 },
    sizeMWh: 80,
    batteries: [
      { battery_id: 'B1', capacity_kwh: 20000, power_kw: 5000, supplier: 'VendorX', model: 'VX-5000', commissionedAt: '2024-04-01T00:00:00Z' },
      { battery_id: 'B2', capacity_kwh: 20000, power_kw: 5000, supplier: 'VendorX', model: 'VX-5000', commissionedAt: '2024-04-01T00:00:00Z' },
      { battery_id: 'B3', capacity_kwh: 20000, power_kw: 5000, supplier: 'VendorX', model: 'VX-5000', commissionedAt: '2024-04-01T00:00:00Z' },
      { battery_id: 'B4', capacity_kwh: 20000, power_kw: 5000, supplier: 'VendorX', model: 'VX-5000', commissionedAt: '2024-04-01T00:00:00Z' }
    ],
    slaStatus: 'green',
    uptimePct: 97.8,
    revenueLoss: {
      window: { start: '2025-09-20T00:00:00Z', end: '2025-09-22T00:00:00Z' },
      kpi: {
        revPredEur: 12840.32,
        revActEur: 12105.91,
        lossEur: 734.41,
        lossDowntimeEur: 420.00,
        utilizationPct: 83.5,
        timeAvailabilityPct: 98.2,
        dispatchAvailabilityPct: 96.1,
        priceWeightedAvailabilityPct: 95.4,
        headroomCostEur: 210.55,
        distanceToBreachMin: 320
      },
      cumulative: [], // charts can be added later
      dailyBreakdown: [
        { date: '2025-09-20', revPredEur: 6400.12, revActEur: 6100.01, lossEur: 300.11, lossDowntimeEur: 160.00, utilizationPct: 82.3, timeAvailabilityPct: 98.5, dispatchAvailabilityPct: 96.8, headroomCostEur: 90.21 },
        { date: '2025-09-21', revPredEur: 6440.20, revActEur: 6005.90, lossEur: 434.30, lossDowntimeEur: 260.00, utilizationPct: 84.7, timeAvailabilityPct: 97.9, dispatchAvailabilityPct: 95.5, headroomCostEur: 120.34 }
      ],
      lossBreakdown: { downtimeEur: 420.00, deviationEur: 314.41 }
    },
    errorsOpen: [
      {
        errorId: 'E-123', projectId: 'P-001', batteryId: 'B1',
        firstSeenAt: '2025-09-21T14:20:00Z', status: 'maintenance_scheduled', severity: 'critical',
        title: 'DC bus overvoltage', actionHint: 'Check inverter DC link and precharge circuit.',
        manualUrl: 'https://vendorx.com/manuals/vx5000.pdf', manualPage: 132,
        ticketId: 'TCK-7789', maintenance: { scheduledAt: '2025-09-24T08:00:00Z', durationMin: 120 }
      },
      {
        errorId: 'E-456', projectId: 'P-001', batteryId: 'B3',
        firstSeenAt: '2025-09-22T05:10:00Z', status: 'acknowledged', severity: 'medium',
        title: 'Cell temperature imbalance', actionHint: 'Run thermal calibration and inspect coolant loop.',
        manualUrl: 'https://vendorx.com/manuals/vx5000.pdf', manualPage: 88,
        ticketId: null, maintenance: null
      }
    ]
  };

  const project002 = {
    projectId: 'P-002',
    name: 'Stockholm BESS',
    location: { city: 'Stockholm', country: 'SE', lat: 59.33, lon: 18.07 },
    sizeMWh: 80,
    batteries: [
      { battery_id: 'S1', capacity_kwh: 26000, power_kw: 6000, supplier: 'NordCell', model: 'NC-6M', commissionedAt: '2024-06-15T00:00:00Z' },
      { battery_id: 'S2', capacity_kwh: 26000, power_kw: 6000, supplier: 'NordCell', model: 'NC-6M', commissionedAt: '2024-06-15T00:00:00Z' },
      { battery_id: 'S3', capacity_kwh: 26000, power_kw: 6000, supplier: 'NordCell', model: 'NC-6M', commissionedAt: '2024-06-15T00:00:00Z' }
    ],
    slaStatus: 'yellow',
    uptimePct: 95.6,
    revenueLoss: {
      window: { start: '2025-09-20T00:00:00Z', end: '2025-09-22T00:00:00Z' },
      kpi: {
        revPredEur: 10100.00,
        revActEur: 9550.00,
        lossEur: 550.00,
        lossDowntimeEur: 380.00,
        utilizationPct: 78.2,
        timeAvailabilityPct: 95.2,
        dispatchAvailabilityPct: 93.0,
        priceWeightedAvailabilityPct: 92.2,
        headroomCostEur: 140.10,
        distanceToBreachMin: 80
      },
      cumulative: [],
      dailyBreakdown: [
        { date: '2025-09-20', revPredEur: 5050.00, revActEur: 4800.00, lossEur: 250.00, lossDowntimeEur: 180.00, utilizationPct: 77.8, timeAvailabilityPct: 95.6, dispatchAvailabilityPct: 93.2, headroomCostEur: 70.00 },
        { date: '2025-09-21', revPredEur: 5050.00, revActEur: 4750.00, lossEur: 300.00, lossDowntimeEur: 200.00, utilizationPct: 78.6, timeAvailabilityPct: 94.8, dispatchAvailabilityPct: 92.8, headroomCostEur: 70.10 }
      ],
      lossBreakdown: { downtimeEur: 380.00, deviationEur: 170.00 }
    },
    errorsOpen: [
      {
        errorId: 'E-789', projectId: 'P-002', batteryId: 'S2',
        firstSeenAt: '2025-09-21T09:45:00Z', status: 'in_progress', severity: 'low',
        title: 'Sensor calibration drift', actionHint: 'Recalibrate SoC estimator and verify voltage taps.',
        manualUrl: 'https://nordcell.example/manuals/nc-6m.pdf', manualPage: 54,
        ticketId: 'TCK-8899', maintenance: { scheduledAt: '2025-09-23T10:00:00Z', durationMin: 45 }
      }
    ]
  };

  const project003 = {
    projectId: 'P-003',
    name: 'Berlin BESS',
    location: { city: 'Berlin', country: 'DE', lat: 52.52, lon: 13.40 },
    sizeMWh: 120,
    batteries: [
      { battery_id: 'BL1', capacity_kwh: 30000, power_kw: 7000, supplier: 'GerStor', model: 'GS-7K', commissionedAt: '2024-03-10T00:00:00Z' },
      { battery_id: 'BL2', capacity_kwh: 30000, power_kw: 7000, supplier: 'GerStor', model: 'GS-7K', commissionedAt: '2024-03-10T00:00:00Z' },
      { battery_id: 'BL3', capacity_kwh: 30000, power_kw: 7000, supplier: 'GerStor', model: 'GS-7K', commissionedAt: '2024-03-10T00:00:00Z' },
      { battery_id: 'BL4', capacity_kwh: 15000, power_kw: 5000, supplier: 'GerStor', model: 'GS-5K', commissionedAt: '2024-03-10T00:00:00Z' },
      { battery_id: 'BL5', capacity_kwh: 15000, power_kw: 5000, supplier: 'GerStor', model: 'GS-5K', commissionedAt: '2024-03-10T00:00:00Z' }
    ],
    slaStatus: 'red',
    uptimePct: 93.2,
    revenueLoss: {
      window: { start: '2025-09-20T00:00:00Z', end: '2025-09-21T00:00:00Z' },
      kpi: {
        revPredEur: 14200.00,
        revActEur: 13220.00,
        lossEur: 980.00,
        lossDowntimeEur: 680.00,
        utilizationPct: 72.1,
        timeAvailabilityPct: 93.2,
        dispatchAvailabilityPct: 90.5,
        priceWeightedAvailabilityPct: 90.0,
        headroomCostEur: 180.25,
        distanceToBreachMin: 0
      },
      cumulative: [],
      dailyBreakdown: [
        { date: '2025-09-20', revPredEur: 14200.00, revActEur: 13220.00, lossEur: 980.00, lossDowntimeEur: 680.00, utilizationPct: 72.1, timeAvailabilityPct: 93.2, dispatchAvailabilityPct: 90.5, headroomCostEur: 180.25 }
      ],
      lossBreakdown: { downtimeEur: 680.00, deviationEur: 300.00 }
    },
    errorsOpen: [
      {
        errorId: 'E-901', projectId: 'P-003', batteryId: 'BL2',
        firstSeenAt: '2025-09-20T04:20:00Z', status: 'maintenance_scheduled', severity: 'critical',
        title: 'PCS overtemperature', actionHint: 'Inspect cooling fans and heat sinks; schedule replacement.',
        manualUrl: 'https://gerstor.example/manuals/gs-7k.pdf', manualPage: 67,
        ticketId: 'TCK-9901', maintenance: { scheduledAt: '2025-09-23T07:00:00Z', durationMin: 90 }
      }
    ]
  };

  const project004 = {
    projectId: 'P-004',
    name: 'Frankfurt BESS',
    location: { city: 'Frankfurt', country: 'DE', lat: 50.11, lon: 8.68 },
    sizeMWh: 60,
    batteries: [
      { battery_id: 'FF1', capacity_kwh: 15000, power_kw: 4000, supplier: 'GerStor', model: 'GS-4K', commissionedAt: '2024-05-01T00:00:00Z' },
      { battery_id: 'FF2', capacity_kwh: 15000, power_kw: 4000, supplier: 'GerStor', model: 'GS-4K', commissionedAt: '2024-05-01T00:00:00Z' }
    ],
    slaStatus: 'green',
    uptimePct: 98.1,
    revenueLoss: {
      window: { start: '2025-09-20T00:00:00Z', end: '2025-09-21T00:00:00Z' },
      kpi: {
        revPredEur: 5400.00,
        revActEur: 5290.00,
        lossEur: 110.00,
        lossDowntimeEur: 20.00,
        utilizationPct: 86.0,
        timeAvailabilityPct: 98.7,
        dispatchAvailabilityPct: 97.2,
        priceWeightedAvailabilityPct: 97.0,
        headroomCostEur: 10.50,
        distanceToBreachMin: 380
      },
      cumulative: [],
      dailyBreakdown: [
        { date: '2025-09-20', revPredEur: 5400.00, revActEur: 5290.00, lossEur: 110.00, lossDowntimeEur: 20.00, utilizationPct: 86.0, timeAvailabilityPct: 98.7, dispatchAvailabilityPct: 97.2, headroomCostEur: 10.50 }
      ],
      lossBreakdown: { downtimeEur: 20.00, deviationEur: 90.00 }
    },
    errorsOpen: []
  };

  const projects = [project001, project002, project003, project004];
  window.projects = projects;
  window.getProjectById = id => projects.find(p => p.projectId === id) || null;
})();
