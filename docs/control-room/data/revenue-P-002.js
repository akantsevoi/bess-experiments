// Hardcoded revenue-loss input dataset for project P-002 (small synthetic window)
(function(){
  const start = '2025-09-21T00:00:00Z';
  const end   = '2025-09-21T01:30:00Z'; // 1.5 hours

  const batteries = [
    { battery_id: 'S1', capacity_kwh: 26000, power_kw: 6000 },
    { battery_id: 'S2', capacity_kwh: 26000, power_kw: 6000 },
    { battery_id: 'S3', capacity_kwh: 26000, power_kw: 6000 }
  ];

  const price = [
    { ts: '2025-09-21T00:00:00Z', price_eur_mwh: 110, interval_min: 15 },
    { ts: '2025-09-21T00:15:00Z', price_eur_mwh: 130, interval_min: 15 },
    { ts: '2025-09-21T00:30:00Z', price_eur_mwh: 160, interval_min: 15 },
    { ts: '2025-09-21T00:45:00Z', price_eur_mwh: 140, interval_min: 15 },
    { ts: '2025-09-21T01:00:00Z', price_eur_mwh: 120, interval_min: 15 },
    { ts: '2025-09-21T01:15:00Z', price_eur_mwh: 150, interval_min: 15 }
  ];

  const pred = [
    { battery_id: 'S1', start_ts: start, end_ts: end, mode: 'DISCHARGE', power_kw: 4000 },
    { battery_id: 'S2', start_ts: start, end_ts: '2025-09-21T01:00:00Z', mode: 'CHARGE', power_kw: -3500 },
    { battery_id: 'S2', start_ts: '2025-09-21T01:00:00Z', end_ts: end, mode: 'DISCHARGE', power_kw: 3500 },
    { battery_id: 'S3', start_ts: start, end_ts: end, mode: 'IDLE', power_kw: 0 }
  ];

  const actual = [];
  for (let t = new Date(start); t < new Date(end); t = new Date(t.getTime()+5*60000)){
    const iso = t.toISOString();
    // S1 derated early then normal
    const s1 = iso < '2025-09-21T00:30:00Z' ? 2500 : 3800; actual.push({ battery_id:'S1', ts: iso, mode:'DISCHARGE', power_kw: s1, soc_pct: 70 });
    // S2 normal charge then a downtime pocket 01:05–01:15 before discharge resumes
    if (iso < '2025-09-21T01:00:00Z') actual.push({ battery_id:'S2', ts: iso, mode:'CHARGE', power_kw: -3300, soc_pct: 40 });
    else if (iso >= '2025-09-21T01:05:00Z' && iso < '2025-09-21T01:15:00Z') actual.push({ battery_id:'S2', ts: iso, mode:'DOWNTIME', power_kw: 0, soc_pct: 40 });
    else actual.push({ battery_id:'S2', ts: iso, mode:'DISCHARGE', power_kw: 3200, soc_pct: 45 });
    // S3 idle
    actual.push({ battery_id:'S3', ts: iso, mode:'IDLE', power_kw: 0, soc_pct: 50 });
  }

  window.revenueData = window.revenueData || {};
  window.revenueData['P-002'] = { window: { start, end }, batteries, price, pred, actual, pMinPct: 5, slaPct: 95 };
})();

