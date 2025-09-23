// Hardcoded revenue-loss input dataset for project P-001 (weekly synthetic window)
(function(){
  if (window.revenueData && window.revenueData['P-001']) return;
  const start = '2025-09-15T00:00:00Z';
  const end   = '2025-09-22T00:00:00Z'; // 7 days

  const batteries = [
    { battery_id: 'B1', capacity_kwh: 20000, power_kw: 5000 },
    { battery_id: 'B2', capacity_kwh: 20000, power_kw: 5000 }
  ];

  function genPrice(startIso, endIso){
    const res = [];
    for (let t = new Date(startIso); t < new Date(endIso); t = new Date(t.getTime()+15*60000)){
      const h = t.getUTCHours();
      const dow = t.getUTCDay(); // 0 Sun .. 6 Sat
      const base = 70;
      const peak = (h >= 17 && h < 21) ? 60 : (h >= 8 && h < 12 ? 40 : 0);
      const night = (h < 6) ? -20 : 0;
      const weekendAdj = (dow === 0 || dow === 6) ? -10 : 0;
      const price = base + peak + night + weekendAdj;
      res.push({ ts: t.toISOString(), price_eur_mwh: price, interval_min: 15 });
    }
    return res;
  }

  function genPred(startIso, endIso){
    const blocks = [];
    for (const b of batteries){
      for (let d = new Date(startIso); d < new Date(endIso); d = new Date(d.getTime()+24*3600000)){
        const day = new Date(d);
        const yyyy = day.toISOString().slice(0,10);
        // Charge 00:00-06:00 at 60% power
        blocks.push({ battery_id: b.battery_id, start_ts: `${yyyy}T00:00:00Z`, end_ts: `${yyyy}T06:00:00Z`, mode: 'CHARGE', power_kw: -Math.round(b.power_kw*0.6) });
        // Discharge 17:00-21:00 at 70% power
        blocks.push({ battery_id: b.battery_id, start_ts: `${yyyy}T17:00:00Z`, end_ts: `${yyyy}T21:00:00Z`, mode: 'DISCHARGE', power_kw: Math.round(b.power_kw*0.7) });
        // The rest implicitly IDLE
      }
    }
    return blocks;
  }

  function inRange(ts, startIso, endIso){ const t = new Date(ts); return t >= new Date(startIso) && t < new Date(endIso); }

  function predAt(bid, ts, blocks){
    for (let i=0;i<blocks.length;i++){
      const b = blocks[i];
      if (b.battery_id !== bid) continue;
      if (inRange(ts, b.start_ts, b.end_ts)) return { mode: b.mode, power_kw: b.power_kw };
    }
    return { mode: 'IDLE', power_kw: 0 };
  }

  function genActual(startIso, endIso, blocks){
    const res = [];
    for (const b of batteries){
      for (let t = new Date(startIso); t < new Date(endIso); t = new Date(t.getTime()+5*60000)){
        const ts = t.toISOString();
        const dow = t.getUTCDay();
        const mins = t.getUTCHours()*60 + t.getUTCMinutes();
        const p = predAt(b.battery_id, ts, blocks);
        // Downtime windows (occasional): mid-day 12:00-13:00 on Wed (3) and small 10-min hiccup daily at 03:00
        const isSmallHiccup = (mins >= 180 && mins < 190); // 03:00-03:10
        const isWedMid = (dow === 3 && mins >= 12*60 && mins < 13*60);
        if (isWedMid || isSmallHiccup){ res.push({ battery_id: b.battery_id, ts, mode: 'DOWNTIME', power_kw: 0, soc_pct: 50 }); continue; }
        let mode = p.mode;
        let power = p.power_kw;
        if (mode === 'IDLE') power = 0;
        // Mild derate/noise
        power = Math.round(power * (mode==='IDLE' ? 0 : 0.95));
        res.push({ battery_id: b.battery_id, ts, mode, power_kw: power, soc_pct: 50 });
      }
    }
    return res;
  }

  const price = genPrice(start, end);
  const pred  = genPred(start, end);
  const actual = genActual(start, end, pred);

  window.revenueData = window.revenueData || {};
  window.revenueData['P-001'] = { window: { start, end }, batteries, price, pred, actual, pMinPct: 5, slaPct: 95 };
})();
