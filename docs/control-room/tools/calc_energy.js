#!/usr/bin/env node
/*
  Calculate total charge and total discharge from a static revenue dataset.

  Usage:
    node docs/control-room/tools/calc_energy.js data/static/revenue-P-001.json
    node docs/control-room/tools/calc_energy.js path/to.json --interval 5

  Notes:
  - Infers the per-sample interval per battery using the median delta between timestamps.
    If inference fails, falls back to the value provided by --interval (minutes) or 5 minutes.
  - Uses actual series only; energy (kWh) = power_kw * (dt_minutes/60).
  - Totals:
      total_discharge_kwh = sum(max(0, power_kw) * dt_h)
      total_charge_kwh    = sum(max(0, -power_kw) * dt_h)
*/

const fs = require('fs');
const path = require('path');
const EnergyUtils = require('../js/energy_utils.js');

function parseArgs(argv){
  const args = { file: null, intervalMin: null };
  for (let i = 2; i < argv.length; i++){
    const a = argv[i];
    if (!args.file && !a.startsWith('-')) { args.file = a; continue; }
    if (a === '--interval' || a === '-i') { args.intervalMin = Number(argv[++i]); continue; }
  }
  return args;
}

function format(num, digits=3){
  return (num ?? 0).toFixed(digits);
}

async function main(){
  const args = parseArgs(process.argv);
  if (!args.file){
    console.error('Usage: node docs/control-room/tools/calc_energy.js data/static/revenue-P-001.json [--interval 5]');
    process.exit(1);
  }
  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)){
    console.error('File not found:', filePath);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  try { data = JSON.parse(raw); }
  catch (e){ console.error('Invalid JSON:', e.message); process.exit(1); }

  const res = EnergyUtils.computeChargeDischargeTotals(data, args.intervalMin);
  console.log('File:', path.basename(filePath));
  for (const r of res.perBattery){
    console.log(`Battery ${r.battery_id}: charge=${format(r.charge_kwh,2)} kWh, discharge=${format(r.discharge_kwh,2)} kWh (dt=${format(r.interval_min_used,2)} min)`);
  }
  console.log('Totals:', `charge=${format(res.totals.charge_kwh,2)} kWh, discharge=${format(res.totals.discharge_kwh,2)} kWh`);
}

main().catch(e => { console.error(e); process.exit(1); });
