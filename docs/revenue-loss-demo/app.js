// Utility to read File or text and parse JSON or CSV
async function parseJsonOrCsv(fileOrText) {
  let text;
  if (fileOrText instanceof File) {
    text = await fileOrText.text();
  } else if (typeof fileOrText === 'string') {
    text = fileOrText;
  } else {
    throw new Error('Unsupported input');
  }
  text = text.trim();
  if (!text) return [];
  if (text[0] === '[' || text[0] === '{') {
    return JSON.parse(text);
  }
  // simple CSV parser
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = cols[i] ? cols[i].trim() : '');
    return obj;
  });
}

function toDate(v) { return new Date(v); }

function stepFillPriceTo5(priceRows, window) {
  const pts = priceRows.map(r => ({ ts: toDate(r.ts), price: Number(r.price_eur_mwh), interval: Number(r.interval_min || 60) }));
  pts.sort((a,b)=>a.ts-b.ts);
  const start = window && window.start ? new Date(window.start) : pts[0].ts;
  const last = pts[pts.length-1];
  const endDefault = new Date(last.ts.getTime() + last.interval*60000);
  const end = window && window.end ? new Date(window.end) : endDefault;
  if (start < pts[0].ts || end > endDefault) {
    throw new Error('Price series does not cover selected window');
  }
  const res = [];
  let idx = 0;
  let cur = pts[0].price;
  let nextChange = new Date(pts[0].ts.getTime() + pts[0].interval*60000);
  for (let t = new Date(start); t < end; t = new Date(t.getTime()+5*60000)) {
    while (idx+1 < pts.length && t >= pts[idx+1].ts) {
      idx++;
      cur = pts[idx].price;
      nextChange = new Date(pts[idx].ts.getTime() + pts[idx].interval*60000);
    }
    res.push({ slice_ts: t.toISOString(), price_eur_mwh: cur });
  }
  return res;
}

function explodePredTo5(predBlocks, batteries) {
  const bmap = new Map(batteries.map(b => [b.battery_id, b]));
  const res = [];
  for (const block of predBlocks) {
    const b = bmap.get(block.battery_id);
    if (!b) throw new Error('Unknown battery ' + block.battery_id);
    const start = toDate(block.start_ts);
    const end = toDate(block.end_ts);
    if (!(end > start)) throw new Error('start_ts >= end_ts');
    let power = Number(block.power_kw);
    const max = Number(b.power_kw);
    power = Math.max(-max, Math.min(max, power));
    const mode = block.mode;
    if (mode === 'CHARGE' && power > 0) power = -Math.abs(power);
    if (mode === 'DISCHARGE' && power < 0) power = Math.abs(power);
    if (mode === 'IDLE') power = 0;
    for (let t = new Date(start); t < end; t = new Date(t.getTime()+5*60000)) {
      res.push({ battery_id: block.battery_id, slice_ts: t.toISOString(), mode, power_kw: power });
    }
  }
  return res;
}

function aggregateActualTo5(actualRows, batteries, window) {
  const bmap = new Map(batteries.map(b => [b.battery_id, b]));
  const start = new Date(window.start);
  const end = new Date(window.end);
  const groups = new Map();
  for (const row of actualRows) {
    const b = bmap.get(row.battery_id);
    if (!b) throw new Error('Unknown battery ' + row.battery_id);
    const ts = toDate(row.ts);
    if (ts < start || ts >= end) continue;
    const bucket = new Date(Math.floor(ts.getTime()/300000)*300000).toISOString();
    const m = groups.get(row.battery_id) || new Map();
    if (!groups.has(row.battery_id)) groups.set(row.battery_id, m);
    const arr = m.get(bucket) || [];
    arr.push(row);
    m.set(bucket, arr);
  }
  const res = [];
  for (const b of batteries) {
    let lastSoc = null;
    const m = groups.get(b.battery_id) || new Map();
    for (let t = new Date(start); t < end; t = new Date(t.getTime()+5*60000)) {
      const key = t.toISOString();
      const rows = m.get(key);
      if (rows && rows.length) {
        const mean = rows.reduce((s,r)=>s+Number(r.power_kw),0) / rows.length;
        const clipped = Math.max(-b.power_kw, Math.min(b.power_kw, mean));
        const last = rows[rows.length-1];
        if (last.soc_pct !== undefined) lastSoc = Number(last.soc_pct);
        res.push({ battery_id: b.battery_id, slice_ts: key, mode: last.mode, power_kw: clipped, soc_pct: lastSoc });
      } else {
        res.push({ battery_id: b.battery_id, slice_ts: key, mode: 'DOWNTIME', power_kw: 0, soc_pct: lastSoc });
      }
    }
  }
  return res;
}

function buildSliceIndex(window) {
  const start = new Date(window.start);
  const end = new Date(window.end);
  const arr = [];
  for (let t = new Date(start); t < end; t = new Date(t.getTime()+5*60000)) {
    arr.push(t.toISOString());
  }
  return arr;
}

function alignByBattery(slices, pred5, act5) {
  const result = new Map();
  const pmap = new Map();
  for (const p of pred5) {
    let m = pmap.get(p.battery_id);
    if (!m) { m = new Map(); pmap.set(p.battery_id, m); }
    m.set(p.slice_ts, p);
  }
  const amap = new Map();
  for (const a of act5) {
    let m = amap.get(a.battery_id);
    if (!m) { m = new Map(); amap.set(a.battery_id, m); }
    m.set(a.slice_ts, a);
  }
  const ids = new Set([...pmap.keys(), ...amap.keys()]);
  for (const id of ids) {
    result.set(id, { pred: pmap.get(id) || new Map(), act: amap.get(id) || new Map() });
  }
  return result;
}

function computeDiffRows(price5, pred5, act5, batteries) {
  const priceMap = new Map(price5.map(p => [p.slice_ts, p.price_eur_mwh]));
  const aligned = alignByBattery(Array.from(priceMap.keys()), pred5, act5);
  const h = 5/60;
  const rows = [];
  for (const [battery_id, maps] of aligned.entries()) {
    for (const [slice_ts, price] of priceMap.entries()) {
      const pred = maps.pred.get(slice_ts) || { mode: 'IDLE', power_kw: 0 };
      const act = maps.act.get(slice_ts) || { mode: 'DOWNTIME', power_kw: 0 };
      const e_pred = pred.power_kw * h;
      const e_act = act.power_kw * h;
      const price_kwh = price / 1000;
      const rev_pred = e_pred * price_kwh;
      const rev_act = e_act * price_kwh;
      const loss = rev_pred - rev_act;
      const downtime_loss = act.mode === 'DOWNTIME' ? rev_pred : 0;
      rows.push({
        slice_ts,
        battery_id,
        price_eur_mwh: price,
        pred_mode: pred.mode,
        pred_power_kw: pred.power_kw,
        act_mode: act.mode,
        act_power_kw: act.power_kw,
        e_pred_kwh: e_pred,
        e_act_kwh: e_act,
        rev_pred_eur: rev_pred,
        rev_act_eur: rev_act,
        loss_eur: loss,
        loss_downtime_eur: downtime_loss,
        is_downtime: act.mode === 'DOWNTIME'
      });
    }
  }
  return rows;
}

function aggregateSummaries(diffRows, batteries) {
  const perMap = new Map();
  const bmap = new Map(batteries.map(b => [b.battery_id, b]));
  const h = 5/60;
  for (const r of diffRows) {
    const day = r.slice_ts.slice(0,10);
    const key = r.battery_id + '|' + day;
    let agg = perMap.get(key);
    if (!agg) {
      agg = { battery_id: r.battery_id, day, rev_pred_eur: 0, rev_act_eur: 0, loss_eur: 0, loss_downtime_eur: 0, util_energy: 0, capacity_energy: 0 };
      perMap.set(key, agg);
    }
    agg.rev_pred_eur += r.rev_pred_eur;
    agg.rev_act_eur += r.rev_act_eur;
    agg.loss_eur += r.loss_eur;
    agg.loss_downtime_eur += r.loss_downtime_eur;
    agg.util_energy += Math.abs(r.e_act_kwh);
    const rating = bmap.get(r.battery_id).power_kw;
    agg.capacity_energy += rating * h;
  }
  const perBattery = [];
  for (const agg of perMap.values()) {
    agg.utilization_pct = agg.capacity_energy ? (agg.util_energy/agg.capacity_energy)*100 : 0;
    perBattery.push(agg);
  }
  const portfolio = { rev_pred_eur:0, rev_act_eur:0, loss_eur:0, loss_downtime_eur:0, util_energy:0, capacity_energy:0 };
  for (const r of diffRows) {
    portfolio.rev_pred_eur += r.rev_pred_eur;
    portfolio.rev_act_eur += r.rev_act_eur;
    portfolio.loss_eur += r.loss_eur;
    portfolio.loss_downtime_eur += r.loss_downtime_eur;
    portfolio.util_energy += Math.abs(r.e_act_kwh);
    const rating = bmap.get(r.battery_id).power_kw;
    portfolio.capacity_energy += rating * h;
  }
  portfolio.utilization_pct = portfolio.capacity_energy ? (portfolio.util_energy/portfolio.capacity_energy)*100 : 0;
  return { perBattery, portfolio };
}

function downloadCsv(name, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g,'""') + '"';
    }
    return s;
  };
  const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => esc(r[h])).join(','))).join('\n');
  const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8;'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Rendering helpers
function renderKPIs(portfolio) {
  const div = document.getElementById('kpis');
  div.innerHTML = `
    <p>Predicted Revenue: ${portfolio.rev_pred_eur.toFixed(2)} EUR</p>
    <p>Actual Revenue: ${portfolio.rev_act_eur.toFixed(2)} EUR</p>
    <p>Revenue Loss: ${portfolio.loss_eur.toFixed(2)} EUR</p>
    <p>Downtime Loss: ${portfolio.loss_downtime_eur.toFixed(2)} EUR</p>
    <p>Utilization: ${portfolio.utilization_pct.toFixed(2)} %</p>`;
}

function renderSummaryTable(rows) {
  const div = document.getElementById('summaryTable');
  if (!rows.length) { div.innerHTML = 'No data'; return; }
  let html = '<table><thead><tr><th>Battery</th><th>Day</th><th>Pred Rev</th><th>Act Rev</th><th>Loss</th><th>Downtime Loss</th><th>Util %</th></tr></thead><tbody>';
  for (const r of rows) {
    html += `<tr><td>${r.battery_id}</td><td>${r.day}</td><td>${r.rev_pred_eur.toFixed(2)}</td><td>${r.rev_act_eur.toFixed(2)}</td><td>${r.loss_eur.toFixed(2)}</td><td>${r.loss_downtime_eur.toFixed(2)}</td><td>${r.utilization_pct.toFixed(2)}</td></tr>`;
  }
  html += '</tbody></table>';
  div.innerHTML = html;
}

function renderDiffTable(rows) {
  const div = document.getElementById('diffTable');
  if (!rows.length) { div.innerHTML = 'No data'; return; }
  const headers = ['slice_ts','battery_id','price_eur_mwh','pred_mode','pred_power_kw','act_mode','act_power_kw','e_pred_kwh','e_act_kwh','rev_pred_eur','rev_act_eur','loss_eur','is_downtime'];
  let html = '<table><thead><tr>' + headers.map(h=>`<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr>' + headers.map(h => `<td>${typeof r[h] === 'number' ? r[h].toFixed(2) : r[h]}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table>';
  div.innerHTML = html;
}

function renderCumChart(batteryId, range) {
  const series = lastDiffRows.filter(r => r.battery_id === batteryId);
  const scales = { x: {} };
  if (range) {
    scales.x.min = range.start;
    scales.x.max = range.end;
  } else if (series.length) {
    scales.x.min = series[0].slice_ts;
    scales.x.max = series[series.length - 1].slice_ts;
  }
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('cumChart');
  if (!ctx) return;
  if (renderCumChart.chart) renderCumChart.chart.destroy();
  renderCumChart.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: series.map(r => r.slice_ts),
      datasets: [{ label: 'Loss EUR', data: series.map(r => r.loss_eur) }]
    },
    options: { scales }
  });
}

// Main run
let lastDiffRows = [], lastSummary = [], dataWindow;

async function runCalculation() {
  try {
    const priceFile = document.getElementById('priceFile').files[0];
    const batteryFile = document.getElementById('batteryFile').files[0];
    const predFile = document.getElementById('predFile').files[0];
    const actFile = document.getElementById('actFile').files[0];
    const [priceRows, batteries, predBlocks, actRows] = await Promise.all([
      parseJsonOrCsv(priceFile),
      parseJsonOrCsv(batteryFile),
      parseJsonOrCsv(predFile),
      parseJsonOrCsv(actFile)
    ]);
    let start = document.getElementById('startTs').value;
    let end = document.getElementById('endTs').value;
    const times = [];
    priceRows.forEach(r => { times.push(toDate(r.ts)); const e = new Date(toDate(r.ts).getTime()+Number(r.interval_min||60)*60000); times.push(e); });
    predBlocks.forEach(b => { times.push(toDate(b.start_ts)); times.push(toDate(b.end_ts)); });
    actRows.forEach(a => times.push(toDate(a.ts)));
    times.sort((a,b)=>a-b);
    const defaultStart = times[0];
    const defaultEnd = times[times.length-1];
    start = start ? new Date(start) : defaultStart;
    end = end ? new Date(end) : defaultEnd;
    const window = { start, end };
    dataWindow = window;
    const price5 = stepFillPriceTo5(priceRows, window);
    let pred5 = explodePredTo5(predBlocks, batteries);
    pred5 = pred5.filter(r => { const t = toDate(r.slice_ts); return t >= start && t < end; });
    const act5 = aggregateActualTo5(actRows, batteries, window);
    const diffRows = computeDiffRows(price5, pred5, act5, batteries);
    const { perBattery, portfolio } = aggregateSummaries(diffRows, batteries);
    renderKPIs(portfolio);
    renderSummaryTable(perBattery);
    renderDiffTable(diffRows);
    document.getElementById('results').style.display = 'block';
    lastDiffRows = diffRows;
    lastSummary = perBattery;
    const sel = document.getElementById('batterySel');
    if (sel) {
      renderCumChart(sel.value, dataWindow);
      sel.addEventListener('change', e => renderCumChart(e.target.value, dataWindow));
    }
  } catch (e) {
    alert(e.message);
    console.error(e);
  }
}

document.getElementById('runBtn').addEventListener('click', runCalculation);
document.getElementById('downloadDiff').addEventListener('click', () => downloadCsv('diff.csv', lastDiffRows));
document.getElementById('downloadSummary').addEventListener('click', () => downloadCsv('summary.csv', lastSummary));
