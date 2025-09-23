// Hardcoded revenue-loss input dataset for project P-003 (Berlin) — weekly, more downtime (red)
(function(){
  if (window.revenueData && window.revenueData['P-003']) return;
  const start = '2025-09-15T00:00:00Z';
  const end   = '2025-09-22T00:00:00Z';
  const batteries = [
    { battery_id: 'BL1', capacity_kwh: 30000, power_kw: 7000 },
    { battery_id: 'BL2', capacity_kwh: 30000, power_kw: 7000 },
    { battery_id: 'BL3', capacity_kwh: 30000, power_kw: 7000 },
    { battery_id: 'BL4', capacity_kwh: 15000, power_kw: 5000 },
    { battery_id: 'BL5', capacity_kwh: 15000, power_kw: 5000 }
  ];

  function genPrice(a,b){ const out=[]; for(let t=new Date(a); t<new Date(b); t=new Date(t.getTime()+15*60000)){ const h=t.getUTCHours(); const dow=t.getUTCDay(); const base=80; const peak=(h>=17&&h<21)?80:(h>=8&&h<12?50:0); const night=(h<6)?-30:0; const weekend=(dow===0||dow===6)?-15:0; out.push({ ts:t.toISOString(), price_eur_mwh: base+peak+night+weekend, interval_min:15 }); } return out; }

  function genPred(a,b){ const bl=[]; for(const bat of batteries){ for(let d=new Date(a); d<new Date(b); d=new Date(d.getTime()+24*3600000)){ const yyyy=d.toISOString().slice(0,10); bl.push({ battery_id:bat.battery_id, start_ts:`${yyyy}T01:00:00Z`, end_ts:`${yyyy}T05:00:00Z`, mode:'CHARGE', power_kw:-Math.round(bat.power_kw*0.5) }); bl.push({ battery_id:bat.battery_id, start_ts:`${yyyy}T17:00:00Z`, end_ts:`${yyyy}T22:00:00Z`, mode:'DISCHARGE', power_kw:Math.round(bat.power_kw*0.65) }); } } return bl; }

  function inRange(ts,a,b){ const t=new Date(ts); return t>=new Date(a) && t<new Date(b); }
  function predAt(id,ts,blocks){ for(let i=0;i<blocks.length;i++){ const x=blocks[i]; if(x.battery_id===id && inRange(ts,x.start_ts,x.end_ts)) return x; } return { mode:'IDLE', power_kw:0}; }

  function genActual(a,b,blocks){ const out=[]; for(const bat of batteries){ for(let t=new Date(a); t<new Date(b); t=new Date(t.getTime()+5*60000)){ const ts=t.toISOString(); const dow=t.getUTCDay(); const mins=t.getUTCHours()*60+t.getUTCMinutes(); const pr=predAt(bat.battery_id,ts,blocks); // Red: daily downtime pockets 11:00-11:30 and 19:30-20:00; plus Wed 02:00-03:00
      if ((mins>=11*60&&mins<11*60+30) || (mins>=19*60+30&&mins<20*60) || (dow===3 && mins>=2*60 && mins<3*60)) { out.push({ battery_id:bat.battery_id, ts, mode:'DOWNTIME', power_kw:0, soc_pct:55 }); continue; }
      let mode=pr.mode; let pw=pr.power_kw; if (mode==='IDLE') pw=0; else pw=Math.round(pw*0.8); out.push({ battery_id:bat.battery_id, ts, mode, power_kw:pw, soc_pct:55 }); } } return out; }

  const price=genPrice(start,end); const pred=genPred(start,end); const actual=genActual(start,end,pred);
  window.revenueData=window.revenueData||{}; window.revenueData['P-003']={ window:{start,end}, batteries, price, pred, actual, pMinPct:5, slaPct:95 };
})();
