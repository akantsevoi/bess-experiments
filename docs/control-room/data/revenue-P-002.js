// Hardcoded revenue-loss input dataset for project P-002 (weekly synthetic window)
(function(){
  if (window.revenueData && window.revenueData['P-002']) return;
  const start = '2025-09-15T00:00:00Z';
  const end   = '2025-09-22T00:00:00Z';

  const batteries = [
    { battery_id: 'S1', capacity_kwh: 26000, power_kw: 6000 },
    { battery_id: 'S2', capacity_kwh: 26000, power_kw: 6000 },
    { battery_id: 'S3', capacity_kwh: 26000, power_kw: 6000 }
  ];

  function genPrice(startIso, endIso){
    const res = [];
    for (let t = new Date(startIso); t < new Date(endIso); t = new Date(t.getTime()+15*60000)){
      const h = t.getUTCHours(); const dow = t.getUTCDay();
      const base = 85;
      const peak = (h >= 17 && h < 21) ? 70 : (h >= 8 && h < 12 ? 35 : 0);
      const night = (h < 6) ? -25 : 0;
      const weekendAdj = (dow === 0 || dow === 6) ? -12 : 0;
      res.push({ ts: t.toISOString(), price_eur_mwh: base + peak + night + weekendAdj, interval_min: 15 });
    }
    return res;
  }

  function genPred(startIso, endIso){
    const blocks = [];
    for (const b of batteries){
      for (let d = new Date(startIso); d < new Date(endIso); d = new Date(d.getTime()+24*3600000)){
        const yyyy = d.toISOString().slice(0,10);
        // S1: discharge 16-22 (long peak), small charge 02-05
        blocks.push({ battery_id: 'S1', start_ts: `${yyyy}T02:00:00Z`, end_ts: `${yyyy}T05:00:00Z`, mode: 'CHARGE', power_kw: -3000 });
        blocks.push({ battery_id: 'S1', start_ts: `${yyyy}T16:00:00Z`, end_ts: `${yyyy}T22:00:00Z`, mode: 'DISCHARGE', power_kw: 4200 });
        // S2: charge overnight 00-06, discharge 17-21
        blocks.push({ battery_id: 'S2', start_ts: `${yyyy}T00:00:00Z`, end_ts: `${yyyy}T06:00:00Z`, mode: 'CHARGE', power_kw: -3500 });
        blocks.push({ battery_id: 'S2', start_ts: `${yyyy}T17:00:00Z`, end_ts: `${yyyy}T21:00:00Z`, mode: 'DISCHARGE', power_kw: 3600 });
        // S3: idle most days, occasional discharge 18-20
        blocks.push({ battery_id: 'S3', start_ts: `${yyyy}T18:00:00Z`, end_ts: `${yyyy}T20:00:00Z`, mode: 'DISCHARGE', power_kw: 2500 });
      }
    }
    return blocks;
  }

  function inRange(ts, a, b){ const t = new Date(ts); return t >= new Date(a) && t < new Date(b); }
  function predAt(bid, ts, blocks){ for (let i=0;i<blocks.length;i++){ const bl=blocks[i]; if (bl.battery_id===bid && inRange(ts, bl.start_ts, bl.end_ts)) return bl; } return { mode:'IDLE', power_kw:0}; }

  function genActual(startIso, endIso, blocks){
    const res = [];
    for (const b of batteries){
      for (let t = new Date(startIso); t < new Date(endIso); t = new Date(t.getTime()+5*60000)){
        const ts = t.toISOString(); const dow=t.getUTCDay(); const mins=t.getUTCHours()*60+t.getUTCMinutes();
        const pred = predAt(b.battery_id, ts, blocks);
        // Yellow project: moderate derates and brief downtime daily 01:00-01:10; longer pocket Sun 12:00-12:30
        if ((mins>=60 && mins<70) || (dow===0 && mins>=12*60 && mins<12*60+30)) { res.push({ battery_id:b.battery_id, ts, mode:'DOWNTIME', power_kw:0, soc_pct:60 }); continue; }
        let mode = pred.mode; let power = pred.power_kw;
        if (mode==='IDLE') power = 0; else power = Math.round(power*0.9);
        res.push({ battery_id:b.battery_id, ts, mode, power_kw: power, soc_pct: 60 });
      }
    }
    return res;
  }

  const price = genPrice(start, end);
  const pred  = genPred(start, end);
  const actual = genActual(start, end, pred);

  window.revenueData = window.revenueData || {};
  window.revenueData['P-002'] = { window: { start, end }, batteries, price, pred, actual, pMinPct: 5, slaPct: 95 };
})();
