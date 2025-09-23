// Hardcoded revenue-loss input dataset for project P-001 (small synthetic window)
(function(){
  const start = '2025-09-21T00:00:00Z';
  const end   = '2025-09-21T02:00:00Z'; // 2 hours @ 5-min resolution

  const batteries = [
    { battery_id: 'B1', capacity_kwh: 20000, power_kw: 5000 },
    { battery_id: 'B2', capacity_kwh: 20000, power_kw: 5000 }
  ];

  // price every 15 minutes, will be upsampled to 5-min
  const price = [
    { ts: '2025-09-21T00:00:00Z', price_eur_mwh: 80, interval_min: 15 },
    { ts: '2025-09-21T00:15:00Z', price_eur_mwh: 120, interval_min: 15 },
    { ts: '2025-09-21T00:30:00Z', price_eur_mwh: 150, interval_min: 15 },
    { ts: '2025-09-21T00:45:00Z', price_eur_mwh: 100, interval_min: 15 },
    { ts: '2025-09-21T01:00:00Z', price_eur_mwh: 90, interval_min: 15 },
    { ts: '2025-09-21T01:15:00Z', price_eur_mwh: 140, interval_min: 15 },
    { ts: '2025-09-21T01:30:00Z', price_eur_mwh: 110, interval_min: 15 },
    { ts: '2025-09-21T01:45:00Z', price_eur_mwh: 130, interval_min: 15 }
  ];

  // predicted schedule blocks (CHARGE negative power, DISCHARGE positive)
  const pred = [
    { battery_id: 'B1', start_ts: '2025-09-21T00:00:00Z', end_ts: '2025-09-21T01:00:00Z', mode: 'CHARGE', power_kw: -3000 },
    { battery_id: 'B1', start_ts: '2025-09-21T01:00:00Z', end_ts: '2025-09-21T02:00:00Z', mode: 'DISCHARGE', power_kw: 3500 },
    { battery_id: 'B2', start_ts: '2025-09-21T00:00:00Z', end_ts: '2025-09-21T00:30:00Z', mode: 'CHARGE', power_kw: -2500 },
    { battery_id: 'B2', start_ts: '2025-09-21T00:30:00Z', end_ts: '2025-09-21T02:00:00Z', mode: 'DISCHARGE', power_kw: 3000 }
  ];

  // actual 5-min events (sparse), others treated as downtime
  const actual = [];
  // B1 operates close to plan, with a downtime pocket at 01:20–01:35
  for (let t = new Date(start); t < new Date(end); t = new Date(t.getTime()+5*60000)){
    const iso = t.toISOString();
    const h = t.getUTCHours(); const m = t.getUTCMinutes();
    // B1
    if (iso < '2025-09-21T01:20:00Z' || iso >= '2025-09-21T01:35:00Z'){
      let mode, power;
      if (iso < '2025-09-21T01:00:00Z'){ mode = 'CHARGE'; power = -2800; } else { mode = 'DISCHARGE'; power = 3200; }
      actual.push({ battery_id:'B1', ts: iso, mode, power_kw: power, soc_pct: 50 });
    } else {
      actual.push({ battery_id:'B1', ts: iso, mode:'DOWNTIME', power_kw: 0, soc_pct: 50 });
    }
    // B2 with slight derate during first half-hour of discharge
    let mode2, power2;
    if (iso < '2025-09-21T00:30:00Z'){ mode2='CHARGE'; power2=-2300; }
    else { mode2='DISCHARGE'; power2 = (iso < '2025-09-21T01:00:00Z') ? 2500 : 3000; }
    actual.push({ battery_id:'B2', ts: iso, mode: mode2, power_kw: power2, soc_pct: 60 });
  }

  window.revenueData = window.revenueData || {};
  window.revenueData['P-001'] = { window: { start, end }, batteries, price, pred, actual, pMinPct: 5, slaPct: 95 };
})();

