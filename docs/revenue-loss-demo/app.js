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

// Register annotation plugin if available
if (window.ChartAnnotation) {
  Chart.register(window.ChartAnnotation);
}

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
    res.push({ slice_ts: t.toISOString(), price_eur_kwh: cur / 1000 });
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
  const priceMap = new Map(price5.map(p => [p.slice_ts, p.price_eur_kwh]));
  const aligned = alignByBattery(Array.from(priceMap.keys()), pred5, act5);
  const h = 5/60;
  const rows = [];
  for (const [battery_id, maps] of aligned.entries()) {
    for (const [slice_ts, price] of priceMap.entries()) {
      const pred = maps.pred.get(slice_ts) || { mode: 'IDLE', power_kw: 0 };
      const act = maps.act.get(slice_ts) || { mode: 'DOWNTIME', power_kw: 0 };
      const e_pred = pred.power_kw * h;
      const e_act = act.power_kw * h;
      const rev_pred = e_pred * price;
      const rev_act = e_act * price;
      const loss = rev_pred - rev_act;
      const downtime_loss = act.mode === 'DOWNTIME' ? rev_pred : 0;
      rows.push({
        slice_ts,
        battery_id,
        price_eur_kwh: price,
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

// sla: target time-based availability fraction (e.g., 0.95 for 95% A_time)
function aggregateSummaries(diffRows, batteries, pMinFrac, sla) {
  const perMap = new Map();
  const bmap = new Map(batteries.map(b => [b.battery_id, b]));
  const h = 5/60;
  const portfolio = { rev_pred_eur:0, rev_act_eur:0, loss_eur:0, loss_downtime_eur:0, util_energy:0, capacity_energy:0,
    total_slices:0, downtime_slices:0, dispatch_a_sum:0, dispatch_count:0, econ_a_sum:0, econ_w_sum:0, headroom_eur:0 };
  for (const r of diffRows) {
    const day = r.slice_ts.slice(0,10);
    const key = r.battery_id + '|' + day;
    let agg = perMap.get(key);
    if (!agg) {
      agg = { battery_id: r.battery_id, day, rev_pred_eur: 0, rev_act_eur: 0, loss_eur: 0, loss_downtime_eur: 0, util_energy: 0,
        capacity_energy: 0, total_slices:0, downtime_slices:0, dispatch_a_sum:0, dispatch_count:0, econ_a_sum:0, econ_w_sum:0,
        headroom_eur:0 };
      perMap.set(key, agg);
    }
    const rating = bmap.get(r.battery_id).power_kw;
    const pmin = rating * pMinFrac;
    const instruct = Math.abs(r.pred_power_kw) >= pmin;
    const a = instruct ? Math.min(1, Math.abs(r.act_power_kw) / Math.abs(r.pred_power_kw || 1)) : 1;
    const w = r.price_eur_kwh * 1000 * Math.abs(r.pred_power_kw);
    // net revenue impact of deviation excluding downtime (negative = gain)
    const headroom = r.is_downtime ? 0 : (r.rev_pred_eur - r.rev_act_eur);

    agg.rev_pred_eur += r.rev_pred_eur;
    agg.rev_act_eur += r.rev_act_eur;
    agg.loss_eur += r.loss_eur;
    agg.loss_downtime_eur += r.loss_downtime_eur;
    agg.util_energy += Math.abs(r.e_act_kwh);
    agg.capacity_energy += rating * h;
    agg.total_slices += 1;
    if (r.is_downtime) agg.downtime_slices += 1;
    if (instruct) { agg.dispatch_a_sum += a; agg.dispatch_count += 1; }
    agg.econ_a_sum += a * w;
    agg.econ_w_sum += w;
    agg.headroom_eur += headroom;

    portfolio.rev_pred_eur += r.rev_pred_eur;
    portfolio.rev_act_eur += r.rev_act_eur;
    portfolio.loss_eur += r.loss_eur;
    portfolio.loss_downtime_eur += r.loss_downtime_eur;
    portfolio.util_energy += Math.abs(r.e_act_kwh);
    portfolio.capacity_energy += rating * h;
    portfolio.total_slices += 1;
    if (r.is_downtime) portfolio.downtime_slices += 1;
    if (instruct) { portfolio.dispatch_a_sum += a; portfolio.dispatch_count += 1; }
    portfolio.econ_a_sum += a * w;
    portfolio.econ_w_sum += w;
    portfolio.headroom_eur += headroom;
  }
  const perBattery = [];
  for (const agg of perMap.values()) {
    agg.utilization_pct = agg.capacity_energy ? (agg.util_energy/agg.capacity_energy)*100 : 0;
    agg.time_availability_pct = agg.total_slices ? ((agg.total_slices - agg.downtime_slices)/agg.total_slices)*100 : 100;
    agg.dispatch_availability_pct = agg.dispatch_count ? (agg.dispatch_a_sum/agg.dispatch_count)*100 : 100;
    agg.price_weighted_availability_pct = agg.econ_w_sum ? (agg.econ_a_sum/agg.econ_w_sum)*100 : null;
    const a_time_frac = agg.total_slices ? (agg.total_slices - agg.downtime_slices)/agg.total_slices : 1;
    agg.headroom_cost_eur = a_time_frac >= sla ? agg.headroom_eur : 0;
    agg.distance_to_breach_min = Math.max(((agg.total_slices*(1 - sla) - agg.downtime_slices) * 5), 0);
    perBattery.push(agg);
  }
  portfolio.utilization_pct = portfolio.capacity_energy ? (portfolio.util_energy/portfolio.capacity_energy)*100 : 0;
  portfolio.time_availability_pct = portfolio.total_slices ? ((portfolio.total_slices - portfolio.downtime_slices)/portfolio.total_slices)*100 : 100;
  portfolio.dispatch_availability_pct = portfolio.dispatch_count ? (portfolio.dispatch_a_sum/portfolio.dispatch_count)*100 : 100;
  portfolio.price_weighted_availability_pct = portfolio.econ_w_sum ? (portfolio.econ_a_sum/portfolio.econ_w_sum)*100 : null;
  const port_a_time_frac = portfolio.total_slices ? (portfolio.total_slices - portfolio.downtime_slices)/portfolio.total_slices : 1;
  portfolio.headroom_cost_eur = port_a_time_frac >= sla ? portfolio.headroom_eur : 0;
  portfolio.distance_to_breach_min = Math.max(((portfolio.total_slices*(1 - sla) - portfolio.downtime_slices) * 5), 0);
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
  const parts = [
    `<p>Predicted Revenue: ${portfolio.rev_pred_eur.toFixed(2)} EUR</p>`,
    `<p>Actual Revenue: ${portfolio.rev_act_eur.toFixed(2)} EUR</p>`,
    `<p>Revenue Loss: ${portfolio.loss_eur.toFixed(2)} EUR</p>`,
    `<p>Downtime Loss: ${portfolio.loss_downtime_eur.toFixed(2)} EUR</p>`,
    `<p>Utilization: ${portfolio.utilization_pct.toFixed(2)} %</p>`,
    `<p>Time Availability: ${portfolio.time_availability_pct.toFixed(2)} %</p>`,
    `<p>Dispatch Availability: ${portfolio.dispatch_availability_pct.toFixed(2)} %</p>`
  ];
  if (portfolio.price_weighted_availability_pct != null) {
    parts.push(`<p>Price-Weighted Availability: ${portfolio.price_weighted_availability_pct.toFixed(2)} %</p>`);
  }
  parts.push(`<p>Headroom Cost: ${portfolio.headroom_cost_eur.toFixed(2)} EUR</p>`);
  parts.push(`<p>Distance to Breach: ${portfolio.distance_to_breach_min.toFixed(0)} min</p>`);
  div.innerHTML = parts.join('');
}

function renderSummaryTable(rows) {
  const div = document.getElementById('summaryTable');
  if (!rows.length) { div.innerHTML = 'No data'; return; }
  let html = '<table><thead><tr><th>Battery</th><th>Day</th><th>Pred Rev</th><th>Act Rev</th><th>Loss</th><th>Downtime Loss</th><th>Util %</th><th>A_time %</th><th>A_dispatch %</th><th>Headroom EUR</th></tr></thead><tbody>';
  for (const r of rows) {
    html += `<tr><td>${r.battery_id}</td><td>${r.day}</td><td>${r.rev_pred_eur.toFixed(2)}</td><td>${r.rev_act_eur.toFixed(2)}</td><td>${r.loss_eur.toFixed(2)}</td><td>${r.loss_downtime_eur.toFixed(2)}</td><td>${r.utilization_pct.toFixed(2)}</td><td>${r.time_availability_pct.toFixed(2)}</td><td>${r.dispatch_availability_pct.toFixed(2)}</td><td>${r.headroom_cost_eur.toFixed(2)}</td></tr>`;
  }
  html += '</tbody></table>';
  div.innerHTML = html;
}

function renderDiffTable(rows) {
  const div = document.getElementById('diffTable');
  if (!rows.length) { div.innerHTML = 'No data'; return; }
  const headers = ['slice_ts','battery_id','price_eur_kwh','pred_mode','pred_power_kw','act_mode','act_power_kw','e_pred_kwh','e_act_kwh','rev_pred_eur','rev_act_eur','loss_eur','is_downtime'];
  let html = '<table><thead><tr>' + headers.map(h=>`<th>${h}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr>' + headers.map(h => `<td>${typeof r[h] === 'number' ? r[h].toFixed(2) : r[h]}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table>';
  div.innerHTML = html;
}

// Chart helpers
let cumulativeSeries = {}, cumChart = null, breakdownChart = null;

function buildCumulativeSeries(diffRows, batteryId) {
  const grouped = new Map();
  for (const r of diffRows) {
    if (batteryId && r.battery_id !== batteryId) continue;
    const g = grouped.get(r.slice_ts) || {
      rev_pred_eur: 0,
      rev_act_eur: 0,
      pred_power_kw: 0,
      act_power_kw: 0,
      is_downtime: false,
      price: r.price_eur_kwh
    };
    g.rev_pred_eur += r.rev_pred_eur;
    g.rev_act_eur += r.rev_act_eur;
    g.pred_power_kw += r.pred_power_kw;
    g.act_power_kw += r.act_power_kw;
    g.is_downtime = g.is_downtime || r.is_downtime;
    grouped.set(r.slice_ts, g);
  }
  const times = Array.from(grouped.keys()).sort();
  let cumPred = 0, cumAct = 0;
  const series = [];
  for (const ts of times) {
    const g = grouped.get(ts);
    cumPred += g.rev_pred_eur;
    cumAct += g.rev_act_eur;
    series.push({
      ts,
      cum_pred_eur: cumPred,
      cum_act_eur: cumAct,
      is_downtime: g.is_downtime,
      price: g.price,
      pred_power_kw: g.pred_power_kw,
      act_power_kw: g.act_power_kw,
      loss_eur: g.rev_pred_eur - g.rev_act_eur
    });
  }
  return series;
}

function getDowntimeBands(series) {
  const bands = [];
  let start = null;
  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    if (p.is_downtime && !start) start = new Date(p.ts);
    if (!p.is_downtime && start) {
      const end = new Date(series[i].ts);
      bands.push({ start, end });
      start = null;
    }
  }
  if (start) {
    const last = new Date(series[series.length - 1].ts);
    bands.push({ start, end: new Date(last.getTime() + 5 * 60000) });
  }
  return bands;
}

function renderCumChart(batteryId, range) {
  const key = batteryId || 'ALL';
  const series = cumulativeSeries[key] || [];
  const pred = series.map(p => ({ x: new Date(p.ts), y: p.cum_pred_eur }));
  const act = series.map(p => ({ x: new Date(p.ts), y: p.cum_act_eur }));
  const prices = series.map(p => p.price).sort((a,b)=>a-b);
  const threshold = prices[Math.floor(prices.length*0.9)] || 0;
  const annotations = {};
  getDowntimeBands(series).forEach((b,i)=>{
    annotations['downtime'+i] = { type:'box', xMin: b.start, xMax: b.end, yMin:'min', yMax:'max', backgroundColor:'rgba(0,0,0,0.1)', borderWidth:0 };
  });
  series.forEach((p,i)=>{
    if (p.price >= threshold) {
      const x = new Date(p.ts);
      annotations['price'+i] = { type:'line', xMin:x, xMax:x, borderColor:'rgba(0,0,255,0.3)', borderWidth:2, borderDash:[4,4] };
    }
  });
  if (cumChart) cumChart.destroy();
  const ctx = document.getElementById('cumChart').getContext('2d');
  cumChart = new Chart(ctx, {
    type:'line',
    data:{
      datasets:[
        { label:'Predicted', data:pred, borderColor:'blue', tension:0, fill:false },
        { label:'Actual', data:act, borderColor:'orange', tension:0, fill:{ target:'previous', above:'rgba(0,255,0,0.2)', below:'rgba(255,0,0,0.2)' } }
      ]
    },
    options:{
      parsing:false,
      scales:{
        x:{ type:'time', adapters:{ date:{ zone:'Europe/Stockholm' } }, title:{ display:true, text:'Time' } },
        y:{ title:{ display:true, text:'EUR' } }
      },
      plugins:{
        annotation:{ annotations },
        tooltip:{
          callbacks:{
            afterBody:(ctx)=>{
              const p = series[ctx[0].dataIndex];
              return [
                `Price: ${(p.price*1000).toFixed(2)} EUR/MWh`,
                `Pred Power: ${p.pred_power_kw.toFixed(2)} kW`,
                `Act Power: ${p.act_power_kw.toFixed(2)} kW`,
                `Loss: ${p.loss_eur.toFixed(2)} EUR`
              ];
            }
          }
        }
      }
    }
  });
  const defaultStart = series.length ? new Date(series[0].ts) : undefined;
  const defaultEnd = series.length ? new Date(series[series.length - 1].ts) : undefined;
  const start = range && range.start ? range.start : defaultStart;
  const end = range && range.end ? range.end : defaultEnd;
  if (start && end) {
    cumChart.options.scales.x.min = start;
    cumChart.options.scales.x.max = end;
    cumChart.update();
  }
}

function renderLossBreakdown(summary) {
  const labels = summary.map(r => `${r.battery_id} ${r.day}`);
  const downtime = summary.map(r => r.loss_downtime_eur);
  const deviation = summary.map(r => Math.max(r.loss_eur - r.loss_downtime_eur, 0));
  const util = summary.map(r => r.utilization_pct);
  if (breakdownChart) breakdownChart.destroy();
  const ctx = document.getElementById('lossBreakdown').getContext('2d');
  breakdownChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets:[
        { label:'Downtime Loss', data:downtime, backgroundColor:'rgba(200,0,0,0.6)', stack:'loss' },
        { label:'Deviation Loss', data:deviation, backgroundColor:'rgba(200,200,0,0.6)', stack:'loss' },
        { label:'Utilization %', data:util, type:'line', yAxisID:'y1', borderColor:'blue', tension:0 }
      ]
    },
    options:{
      scales:{
        x:{ stacked:true },
        y:{ stacked:true, title:{ display:true, text:'Loss EUR' } },
        y1:{ position:'right', min:0, max:100, title:{ display:true, text:'Util %' } }
      }
    }
  });
}

function buildHeatmapMatrix(diffRows, metric) {
  const matrix = new Map();
  const hours = new Set();
  for (const r of diffRows) {
    const b = r.battery_id;
    let m = matrix.get(b);
    if (!m) { m = new Map(); matrix.set(b, m); }
    const t = new Date(r.slice_ts);
    t.setMinutes(0,0,0);
    const key = t.toISOString();
    hours.add(key);
    let cell = m.get(key);
    if (!cell) { cell = { value:0, downtime:false }; m.set(key, cell); }
    const val = metric === 'error' ? Math.abs(r.act_power_kw - r.pred_power_kw) : Math.max(r.loss_eur,0);
    cell.value += val;
    cell.downtime = cell.downtime || r.is_downtime;
  }
  const hourList = Array.from(hours).sort();
  const batteries = Array.from(matrix.keys()).sort();
  let maxVal = 0;
  for (const b of batteries) {
    const m = matrix.get(b);
    for (const h of hourList) {
      const v = m.get(h)?.value || 0;
      if (v > maxVal) maxVal = v;
    }
  }
  return { matrix, hourList, batteries, maxVal };
}

function renderHeatmap(metric) {
  const { matrix, hourList, batteries, maxVal } = buildHeatmapMatrix(lastDiffRows, metric);
  const container = document.getElementById('heatmap');
  container.innerHTML = '';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  head.appendChild(document.createElement('th'));
  hourList.forEach(h => {
    const th = document.createElement('th');
    th.textContent = new Date(h).toLocaleTimeString('sv-SE', { timeZone:'Europe/Stockholm', day:'2-digit', hour:'2-digit' });
    head.appendChild(th);
  });
  table.appendChild(head);
  const sel = document.getElementById('batterySelect');
  batteries.forEach(b => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = b;
    tr.appendChild(th);
    const m = matrix.get(b);
    hourList.forEach(h => {
      const td = document.createElement('td');
      const cell = m.get(h);
      const val = cell ? cell.value : 0;
      const intensity = maxVal ? val / maxVal : 0;
      td.style.backgroundColor = `rgba(255,0,0,${intensity})`;
      if (cell && cell.downtime) {
        const d = document.createElement('div');
        d.className = 'diamond';
        td.appendChild(d);
      }
      td.dataset.battery = b;
      td.dataset.start = h;
      td.addEventListener('click', () => {
        sel.value = b;
        renderCumChart(b, { start: new Date(h), end: new Date(new Date(h).getTime()+3600000) });
      });
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  container.appendChild(table);
}

function buildAvailabilityMatrix(diffRows, batteries, pMinFrac) {
  const matrix = new Map();
  const hours = new Set();
  const bmap = new Map(batteries.map(b => [b.battery_id, b]));
  for (const r of diffRows) {
    const b = r.battery_id;
    let m = matrix.get(b);
    if (!m) { m = new Map(); matrix.set(b, m); }
    const t = new Date(r.slice_ts); t.setMinutes(0,0,0); const key = t.toISOString();
    hours.add(key);
    let cell = m.get(key);
    if (!cell) { cell = { status:'available' }; m.set(key, cell); }
    if (r.is_downtime) {
      cell.status = 'downtime';
    } else {
      const rating = bmap.get(b).power_kw;
      const pmin = rating * pMinFrac;
      if (Math.abs(r.pred_power_kw) >= pmin && Math.abs(r.act_power_kw) < Math.abs(r.pred_power_kw) - 1e-9) {
        if (cell.status !== 'downtime') cell.status = 'derated';
      }
    }
  }
  return { matrix, hourList: Array.from(hours).sort(), batteries: Array.from(matrix.keys()).sort() };
}

function renderAvailabilityTimeline(diffRows, batteries, pMinFrac) {
  const { matrix, hourList, batteries: ids } = buildAvailabilityMatrix(diffRows, batteries, pMinFrac);
  const container = document.getElementById('availTimeline');
  container.innerHTML = '';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  head.appendChild(document.createElement('th'));
  hourList.forEach(h => {
    const th = document.createElement('th');
    th.textContent = new Date(h).toLocaleTimeString('sv-SE', { timeZone:'Europe/Stockholm', day:'2-digit', hour:'2-digit' });
    head.appendChild(th);
  });
  table.appendChild(head);
  const sel = document.getElementById('batterySelect');
  ids.forEach(b => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = b;
    tr.appendChild(th);
    const m = matrix.get(b);
    hourList.forEach(h => {
      const td = document.createElement('td');
      const status = m.get(h)?.status || 'available';
      if (status === 'downtime') td.style.backgroundColor = 'rgba(244,67,54,0.7)';
      else if (status === 'derated') td.style.backgroundColor = 'rgba(255,235,59,0.7)';
      else td.style.backgroundColor = 'rgba(76,175,80,0.7)';
      td.dataset.battery = b;
      td.dataset.start = h;
      td.addEventListener('click', () => {
        sel.value = b;
        renderCumChart(b, { start: new Date(h), end: new Date(new Date(h).getTime()+3600000) });
      });
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  container.appendChild(table);
}

// Main run
let lastDiffRows = [], lastSummary = [];

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
    const dataTimes = [];
    predBlocks.forEach(b => { dataTimes.push(toDate(b.start_ts)); dataTimes.push(toDate(b.end_ts)); });
    actRows.forEach(a => dataTimes.push(toDate(a.ts)));
    dataTimes.sort((a,b)=>a-b);
    const defaultStart = dataTimes[0];
    const defaultEnd = dataTimes[dataTimes.length-1];
    start = start ? new Date(start) : defaultStart;
    end = end ? new Date(end) : defaultEnd;
    if (start < defaultStart) start = defaultStart;
    if (end > defaultEnd) end = defaultEnd;
    const window = { start, end };
    const price5 = stepFillPriceTo5(priceRows, window);
    let pred5 = explodePredTo5(predBlocks, batteries);
    pred5 = pred5.filter(r => { const t = toDate(r.slice_ts); return t >= start && t < end; });
    const act5 = aggregateActualTo5(actRows, batteries, window);
    const diffRows = computeDiffRows(price5, pred5, act5, batteries);
    const pMinPct = Number(document.getElementById('pMinPct').value) || 5;
    const slaPct = Number(document.getElementById('slaPct').value) || 95;
    const pMinFrac = pMinPct / 100;
    const sla = slaPct / 100; // SLA threshold for time-based availability (A_time)
    const { perBattery, portfolio } = aggregateSummaries(diffRows, batteries, pMinFrac, sla);
    renderKPIs(portfolio);
    renderSummaryTable(perBattery);
    renderDiffTable(diffRows);
    document.getElementById('results').style.display = 'block';
    lastDiffRows = diffRows;
    lastSummary = perBattery;

    // prepare cumulative series and charts
    cumulativeSeries = { 'ALL': buildCumulativeSeries(diffRows, null) };
    const ids = Array.from(new Set(diffRows.map(r => r.battery_id))).sort();
    ids.forEach(id => cumulativeSeries[id] = buildCumulativeSeries(diffRows, id));
    const sel = document.getElementById('batterySelect');
    sel.innerHTML = '<option value="">Portfolio</option>' + ids.map(id => `<option value="${id}">${id}</option>`).join('');
    renderCumChart(sel.value);
    renderLossBreakdown(perBattery);
    renderHeatmap(document.getElementById('heatmapMetric').value);
    renderAvailabilityTimeline(diffRows, batteries, pMinFrac);
  } catch (e) {
    alert(e.message);
    console.error(e);
  }
}

document.getElementById('runBtn').addEventListener('click', runCalculation);
document.getElementById('downloadDiff').addEventListener('click', () => downloadCsv('diff.csv', lastDiffRows));
document.getElementById('downloadSummary').addEventListener('click', () => downloadCsv('summary.csv', lastSummary));
document.getElementById('batterySelect').addEventListener('change', e => renderCumChart(e.target.value));
document.getElementById('heatmapMetric').addEventListener('change', e => renderHeatmap(e.target.value));
