// UMD module exposing computeChargeDischargeTotals for both browser and Node.
// Mirrors the logic used by docs/control-room/tools/calc_energy.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EnergyUtils = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function median(nums){
    if (!nums || !nums.length) return NaN;
    const arr = nums.slice().sort((a,b)=>a-b);
    const mid = Math.floor(arr.length/2);
    return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
  }

  function inferIntervalMin(rows){
    if (!rows || rows.length < 2) return NaN;
    const ts = rows.map(r => new Date(r.ts || r.slice_ts).getTime()).filter(v => !isNaN(v)).sort((a,b)=>a-b);
    const dts = [];
    for (let i=1; i<ts.length; i++){
      const dtMin = (ts[i] - ts[i-1]) / 60000;
      if (dtMin > 0 && dtMin < 180) dts.push(dtMin);
    }
    return median(dts);
  }

  function computeChargeDischargeTotals(dataset, fallbackIntervalMin){
    const actual = (dataset && dataset.actual) ? dataset.actual : [];
    const byBattery = new Map();
    for (const r of actual){
      const id = r.battery_id || r.batteryId || 'UNKNOWN';
      if (!byBattery.has(id)) byBattery.set(id, []);
      byBattery.get(id).push(r);
    }

    const results = [];
    let totalCharge = 0, totalDis = 0;
    byBattery.forEach((rows, bid) => {
      let dtMin = inferIntervalMin(rows);
      if (!isFinite(dtMin) || dtMin <= 0) dtMin = Number(fallbackIntervalMin) || 5;
      const dtH = dtMin / 60;
      let charge = 0, dis = 0;
      for (const r of rows){
        const p = Number(r.power_kw ?? r.act_power_kw ?? 0);
        if (!isFinite(p)) continue;
        if (p > 0) dis += p * dtH; else if (p < 0) charge += (-p) * dtH;
      }
      results.push({ battery_id: bid, charge_kwh: charge, discharge_kwh: dis, interval_min_used: dtMin });
      totalCharge += charge; totalDis += dis;
    });
    results.sort((a,b)=> String(a.battery_id).localeCompare(String(b.battery_id)));
    return { perBattery: results, totals: { charge_kwh: totalCharge, discharge_kwh: totalDis } };
  }

  return { median, inferIntervalMin, computeChargeDischargeTotals };
}));

