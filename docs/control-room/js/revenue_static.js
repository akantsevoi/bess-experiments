// Static (hardcoded) revenue-loss visualization, matching the demo's outputs.
(function () {
  function toDate(v) { return new Date(v); }

  function stepFillPriceTo5(priceRows, window) {
    var pts = priceRows.map(function (r) { return { ts: toDate(r.ts), price: Number(r.price_eur_mwh), interval: Number(r.interval_min || 60) }; });
    pts.sort(function (a, b) { return a.ts - b.ts; });
    var start = new Date(window.start);
    var last = pts[pts.length - 1];
    var endDefault = new Date(last.ts.getTime() + last.interval * 60000);
    var end = new Date(window.end || endDefault);
    var res = [];
    var idx = 0;
    var cur = pts[0].price;
    for (var t = new Date(start); t < end; t = new Date(t.getTime() + 5 * 60000)) {
      while (idx + 1 < pts.length && t >= pts[idx + 1].ts) { idx++; cur = pts[idx].price; }
      res.push({ slice_ts: t.toISOString(), price_eur_kwh: cur / 1000 });
    }
    return res;
  }

  function explodePredTo5(predBlocks, batteries) {
    var bmap = new Map(batteries.map(function (b) { return [b.battery_id, b]; }));
    var res = [];
    for (var i = 0; i < predBlocks.length; i++) {
      var block = predBlocks[i];
      var b = bmap.get(block.battery_id); if (!b) continue;
      var start = toDate(block.start_ts);
      var end = toDate(block.end_ts);
      var power = Number(block.power_kw);
      var max = Number(b.power_kw);
      power = Math.max(-max, Math.min(max, power));
      var mode = block.mode;
      if (mode === 'CHARGE' && power > 0) power = -Math.abs(power);
      if (mode === 'DISCHARGE' && power < 0) power = Math.abs(power);
      if (mode === 'IDLE') power = 0;
      for (var t = new Date(start); t < end; t = new Date(t.getTime() + 5 * 60000)) {
        res.push({ battery_id: block.battery_id, slice_ts: t.toISOString(), mode: mode, power_kw: power });
      }
    }
    return res;
  }

  function aggregateActualTo5(actualRows, batteries, window) {
    var start = new Date(window.start);
    var end = new Date(window.end);
    var groups = new Map();
    var bmap = new Map(batteries.map(function (b) { return [b.battery_id, b]; }));
    for (var i = 0; i < actualRows.length; i++) {
      var row = actualRows[i];
      if (!bmap.has(row.battery_id)) continue;
      var ts = toDate(row.ts);
      if (ts < start || ts >= end) continue;
      var bucket = new Date(Math.floor(ts.getTime() / 300000) * 300000).toISOString();
      var m = groups.get(row.battery_id) || new Map();
      if (!groups.has(row.battery_id)) groups.set(row.battery_id, m);
      var arr = m.get(bucket) || [];
      arr.push(row);
      m.set(bucket, arr);
    }
    var res = [];
    for (var j = 0; j < batteries.length; j++) {
      var b = batteries[j];
      var lastSoc = null;
      var m2 = groups.get(b.battery_id) || new Map();
      for (var t2 = new Date(start); t2 < end; t2 = new Date(t2.getTime() + 5 * 60000)) {
        var key = t2.toISOString();
        var rows = m2.get(key);
        if (rows && rows.length) {
          var sum = 0; for (var k = 0; k < rows.length; k++) sum += Number(rows[k].power_kw);
          var mean = sum / rows.length;
          var clipped = Math.max(-b.power_kw, Math.min(b.power_kw, mean));
          var last = rows[rows.length - 1];
          if (typeof last.soc_pct !== 'undefined') lastSoc = Number(last.soc_pct);
          res.push({ battery_id: b.battery_id, slice_ts: key, mode: last.mode, power_kw: clipped, soc_pct: lastSoc });
        } else {
          res.push({ battery_id: b.battery_id, slice_ts: key, mode: 'DOWNTIME', power_kw: 0, soc_pct: lastSoc });
        }
      }
    }
    return res;
  }

  function alignByBattery(pred5, act5) {
    var result = new Map();
    var pmap = new Map();
    for (var i = 0; i < pred5.length; i++) {
      var p = pred5[i];
      var m = pmap.get(p.battery_id);
      if (!m) { m = new Map(); pmap.set(p.battery_id, m); }
      m.set(p.slice_ts, p);
    }
    var amap = new Map();
    for (var j = 0; j < act5.length; j++) {
      var a = act5[j];
      var m2 = amap.get(a.battery_id);
      if (!m2) { m2 = new Map(); amap.set(a.battery_id, m2); }
      m2.set(a.slice_ts, a);
    }
    var ids = new Set([].concat(Array.from(pmap.keys()), Array.from(amap.keys())));
    ids.forEach(function (id) {
      result.set(id, { pred: pmap.get(id) || new Map(), act: amap.get(id) || new Map() });
    });
    return result;
  }

  function computeDiffRows(price5, pred5, act5) {
    var priceMap = new Map(price5.map(function (p) { return [p.slice_ts, p.price_eur_kwh]; }));
    var aligned = alignByBattery(pred5, act5);
    var h = 5 / 60;
    var rows = [];
    aligned.forEach(function (maps, battery_id) {
      priceMap.forEach(function (price, slice_ts) {
        var pred = maps.pred.get(slice_ts) || { mode: 'IDLE', power_kw: 0 };
        var act = maps.act.get(slice_ts) || { mode: 'DOWNTIME', power_kw: 0 };
        var e_pred = pred.power_kw * h;
        var e_act = act.power_kw * h;
        var rev_pred = e_pred * price;
        var rev_act = e_act * price;
        rows.push({
          slice_ts: slice_ts,
          battery_id: battery_id,
          price_eur_kwh: price,
          pred_mode: pred.mode,
          pred_power_kw: pred.power_kw,
          act_mode: act.mode,
          act_power_kw: act.power_kw,
          e_pred_kwh: e_pred,
          e_act_kwh: e_act,
          rev_pred_eur: rev_pred,
          rev_act_eur: rev_act,
          loss_eur: (rev_pred - rev_act),
          loss_downtime_eur: act.mode === 'DOWNTIME' ? rev_pred : 0,
          is_downtime: act.mode === 'DOWNTIME'
        });
      });
    });
    return rows;
  }

  function aggregateSummaries(diffRows, batteries, pMinFrac, sla) {
    var perMap = new Map();
    var bmap = new Map(batteries.map(function (b) { return [b.battery_id, b]; }));
    var h = 5 / 60;
    var portfolio = { rev_pred_eur: 0, rev_act_eur: 0, loss_eur: 0, loss_downtime_eur: 0, util_energy: 0, capacity_energy: 0, total_slices: 0, downtime_slices: 0, dispatch_a_sum: 0, dispatch_count: 0, econ_a_sum: 0, econ_w_sum: 0, headroom_eur: 0 };
    for (var i = 0; i < diffRows.length; i++) {
      var r = diffRows[i];
      var day = r.slice_ts.slice(0, 10);
      var key = r.battery_id + '|' + day;
      var agg = perMap.get(key);
      if (!agg) {
        agg = { battery_id: r.battery_id, day: day, rev_pred_eur: 0, rev_act_eur: 0, loss_eur: 0, loss_downtime_eur: 0, util_energy: 0, capacity_energy: 0, total_slices: 0, downtime_slices: 0, dispatch_a_sum: 0, dispatch_count: 0, econ_a_sum: 0, econ_w_sum: 0, headroom_eur: 0 };
        perMap.set(key, agg);
      }
      var rating = bmap.get(r.battery_id).power_kw;
      var instruct = Math.abs(r.pred_power_kw) >= rating * pMinFrac;
      var a = instruct ? Math.min(1, Math.abs(r.act_power_kw) / Math.abs(r.pred_power_kw || 1)) : 1;
      var w = r.price_eur_kwh * 1000 * Math.abs(r.pred_power_kw);
      var headroom = r.is_downtime ? 0 : (r.rev_pred_eur - r.rev_act_eur);

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
    var perBattery = [];
    perMap.forEach(function (agg) {
      agg.utilization_pct = agg.capacity_energy ? (agg.util_energy / agg.capacity_energy) * 100 : 0;
      agg.time_availability_pct = agg.total_slices ? ((agg.total_slices - agg.downtime_slices) / agg.total_slices) * 100 : 100;
      agg.dispatch_availability_pct = agg.dispatch_count ? (agg.dispatch_a_sum / agg.dispatch_count) * 100 : 100;
      agg.price_weighted_availability_pct = agg.econ_w_sum ? (agg.econ_a_sum / agg.econ_w_sum) * 100 : null;
      var a_time_frac = agg.total_slices ? (agg.total_slices - agg.downtime_slices) / agg.total_slices : 1;
      agg.headroom_cost_eur = a_time_frac >= sla ? agg.headroom_eur : 0;
      agg.distance_to_breach_min = Math.max(((agg.total_slices * (1 - sla) - agg.downtime_slices) * 5), 0);
      perBattery.push(agg);
    });
    portfolio.utilization_pct = portfolio.capacity_energy ? (portfolio.util_energy / portfolio.capacity_energy) * 100 : 0;
    portfolio.time_availability_pct = portfolio.total_slices ? ((portfolio.total_slices - portfolio.downtime_slices) / portfolio.total_slices) * 100 : 100;
    portfolio.dispatch_availability_pct = portfolio.dispatch_count ? (portfolio.dispatch_a_sum / portfolio.dispatch_count) * 100 : 100;
    portfolio.price_weighted_availability_pct = portfolio.econ_w_sum ? (portfolio.econ_a_sum / portfolio.econ_w_sum) * 100 : null;
    var port_a_time_frac = portfolio.total_slices ? (portfolio.total_slices - portfolio.downtime_slices) / portfolio.total_slices : 1;
    portfolio.headroom_cost_eur = port_a_time_frac >= sla ? portfolio.headroom_eur : 0;
    portfolio.distance_to_breach_min = Math.max(((portfolio.total_slices * (1 - sla) - portfolio.downtime_slices) * 5), 0);
    return { perBattery: perBattery, portfolio: portfolio };
  }

  function renderKPIs(portfolio) {
    var div = document.getElementById('kpis'); if (!div) return;
    var parts = [
      '<p>Predicted Revenue: ' + portfolio.rev_pred_eur.toFixed(2) + ' EUR</p>',
      '<p>Actual Revenue: ' + portfolio.rev_act_eur.toFixed(2) + ' EUR</p>',
      '<p>Revenue Loss: ' + portfolio.loss_eur.toFixed(2) + ' EUR</p>',
      '<p>Downtime Loss: ' + portfolio.loss_downtime_eur.toFixed(2) + ' EUR</p>',
      '<p>Utilization: ' + portfolio.utilization_pct.toFixed(2) + ' %</p>',
      '<p>Time Availability: ' + portfolio.time_availability_pct.toFixed(2) + ' %</p>',
      '<p>Dispatch Availability: ' + portfolio.dispatch_availability_pct.toFixed(2) + ' %</p>'
    ];
    if (portfolio.price_weighted_availability_pct != null) parts.push('<p>Price-Weighted Availability: ' + portfolio.price_weighted_availability_pct.toFixed(2) + ' %</p>');
    parts.push('<p>Headroom Cost: ' + portfolio.headroom_cost_eur.toFixed(2) + ' EUR</p>');
    parts.push('<p>Distance to Breach: ' + portfolio.distance_to_breach_min.toFixed(0) + ' min</p>');
    div.innerHTML = parts.join('');
  }

  function renderSummaryTable(rows) {
    var div = document.getElementById('summaryTable'); if (!div) return;
    if (!rows.length) { div.innerHTML = 'No data'; return; }
    var html = '<table><thead><tr><th>Battery</th><th>Day</th><th>Pred Rev</th><th>Act Rev</th><th>Loss</th><th>Downtime Loss</th><th>Util %</th><th>A_time %</th><th>A_dispatch %</th><th>Headroom EUR</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr>' +
        '<td>' + r.battery_id + '</td>' +
        '<td>' + r.day + '</td>' +
        '<td>' + r.rev_pred_eur.toFixed(2) + '</td>' +
        '<td>' + r.rev_act_eur.toFixed(2) + '</td>' +
        '<td>' + r.loss_eur.toFixed(2) + '</td>' +
        '<td>' + r.loss_downtime_eur.toFixed(2) + '</td>' +
        '<td>' + r.utilization_pct.toFixed(2) + '</td>' +
        '<td>' + r.time_availability_pct.toFixed(2) + '</td>' +
        '<td>' + r.dispatch_availability_pct.toFixed(2) + '</td>' +
        '<td>' + r.headroom_cost_eur.toFixed(2) + '</td>' +
      '</tr>';
    }
    html += '</tbody></table>';
    div.innerHTML = html;
  }

  function renderDiffTable(rows) {
    var div = document.getElementById('diffTable'); if (!div) return;
    var headers = ['slice_ts', 'battery_id', 'price_eur_kwh', 'pred_mode', 'pred_power_kw', 'act_mode', 'act_power_kw', 'e_pred_kwh', 'e_act_kwh', 'rev_pred_eur', 'rev_act_eur', 'loss_eur', 'is_downtime'];
    var html = '<table><thead><tr>' + headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr>' + headers.map(function (h) {
        var v = r[h];
        return '<td>' + (typeof v === 'number' ? v.toFixed(2) : v) + '</td>';
      }).join('') + '</tr>';
    }
    html += '</tbody></table>';
    div.innerHTML = html;
  }

  var cumulativeSeries = {}, cumChart = null, breakdownChart = null;
  function buildCumulativeSeries(diffRows, batteryId) {
    var grouped = new Map();
    for (var i = 0; i < diffRows.length; i++) {
      var r = diffRows[i];
      if (batteryId && r.battery_id !== batteryId) continue;
      var g = grouped.get(r.slice_ts) || { rev_pred_eur: 0, rev_act_eur: 0, pred_power_kw: 0, act_power_kw: 0, is_downtime: false, price: r.price_eur_kwh };
      g.rev_pred_eur += r.rev_pred_eur;
      g.rev_act_eur += r.rev_act_eur;
      g.pred_power_kw += r.pred_power_kw;
      g.act_power_kw += r.act_power_kw;
      g.is_downtime = g.is_downtime || r.is_downtime;
      grouped.set(r.slice_ts, g);
    }
    var times = Array.from(grouped.keys()).sort();
    var cumPred = 0, cumAct = 0;
    var series = [];
    for (var j = 0; j < times.length; j++) {
      var ts = times[j];
      var g2 = grouped.get(ts);
      cumPred += g2.rev_pred_eur;
      cumAct += g2.rev_act_eur;
      series.push({ ts: ts, cum_pred_eur: cumPred, cum_act_eur: cumAct, is_downtime: g2.is_downtime, price: g2.price, pred_power_kw: g2.pred_power_kw, act_power_kw: g2.act_power_kw, loss_eur: (g2.rev_pred_eur - g2.rev_act_eur) });
    }
    return series;
  }

  function getDowntimeBands(series) {
    var bands = [];
    var start = null;
    for (var i = 0; i < series.length; i++) {
      var p = series[i];
      if (p.is_downtime && !start) start = new Date(p.ts);
      if (!p.is_downtime && start) { var end = new Date(series[i].ts); bands.push({ start: start, end: end }); start = null; }
    }
    if (start) { var last = new Date(series[series.length - 1].ts); bands.push({ start: start, end: new Date(last.getTime() + 5 * 60000) }); }
    return bands;
  }

  function renderCumChart(batteryId, range) {
    var key = batteryId || 'ALL';
    var series = cumulativeSeries[key] || [];
    var pred = series.map(function (p) { return { x: new Date(p.ts), y: p.cum_pred_eur }; });
    var act = series.map(function (p) { return { x: new Date(p.ts), y: p.cum_act_eur }; });
    var prices = series.map(function (p) { return p.price; }).sort(function (a, b) { return a - b; });
    var threshold = prices[Math.floor(prices.length * 0.9)] || 0;
    var annotations = {};
    getDowntimeBands(series).forEach(function (b, i) { annotations['downtime' + i] = { type: 'box', xMin: b.start, xMax: b.end, yMin: 'min', yMax: 'max', backgroundColor: 'rgba(0,0,0,0.1)', borderWidth: 0 }; });
    series.forEach(function (p, i) { if (p.price >= threshold) { var x = new Date(p.ts); annotations['price' + i] = { type: 'line', xMin: x, xMax: x, borderColor: 'rgba(0,0,255,0.3)', borderWidth: 2, borderDash: [4, 4] }; } });
    if (cumChart) cumChart.destroy(); var ctx = document.getElementById('cumChart').getContext('2d');
    cumChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        { label: 'Predicted', data: pred, borderColor: 'blue', tension: 0, fill: false },
        { label: 'Actual', data: act, borderColor: 'orange', tension: 0, fill: { target: 'previous', above: 'rgba(0,255,0,0.2)', below: 'rgba(255,0,0,0.2)' } }
      ] },
      options: { parsing: false, scales: { x: { type: 'time', adapters: { date: { zone: 'Europe/Stockholm' } }, title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'EUR' } } }, plugins: { annotation: { annotations: annotations }, tooltip: { callbacks: { afterBody: function (ctx) { var p = series[ctx[0].dataIndex]; return [ 'Price: ' + (p.price * 1000).toFixed(2) + ' EUR/MWh', 'Pred Power: ' + p.pred_power_kw.toFixed(2) + ' kW', 'Act Power: ' + p.act_power_kw.toFixed(2) + ' kW', 'Loss: ' + p.loss_eur.toFixed(2) + ' EUR' ]; } } } } }
    });
    var defaultStart = series.length ? new Date(series[0].ts) : undefined;
    var defaultEnd = series.length ? new Date(series[series.length - 1].ts) : undefined;
    var start = (range && range.start) ? range.start : defaultStart;
    var end = (range && range.end) ? range.end : defaultEnd;
    if (start && end) { cumChart.options.scales.x.min = start; cumChart.options.scales.x.max = end; cumChart.update(); }
  }

  function renderLossBreakdown(summary) {
    var labels = summary.map(function (r) { return r.battery_id + ' ' + r.day; });
    var downtime = summary.map(function (r) { return r.loss_downtime_eur; });
    var deviation = summary.map(function (r) { return Math.max(r.loss_eur - r.loss_downtime_eur, 0); });
    var util = summary.map(function (r) { return r.utilization_pct; });
    if (breakdownChart) breakdownChart.destroy();
    var ctx = document.getElementById('lossBreakdown').getContext('2d');
    breakdownChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: [
        { label: 'Downtime Loss', data: downtime, backgroundColor: 'rgba(200,0,0,0.6)', stack: 'loss' },
        { label: 'Deviation Loss', data: deviation, backgroundColor: 'rgba(200,200,0,0.6)', stack: 'loss' },
        { label: 'Utilization %', data: util, type: 'line', yAxisID: 'y1', borderColor: 'blue', tension: 0 }
      ] },
      options: { scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'Loss EUR' } }, y1: { position: 'right', min: 0, max: 100, title: { display: true, text: 'Util %' } } } }
    });
  }

  function buildHeatmapMatrix(diffRows, metric) {
    var matrix = new Map();
    var hours = new Set();
    for (var i = 0; i < diffRows.length; i++) {
      var r = diffRows[i];
      var b = r.battery_id;
      var m = matrix.get(b); if (!m) { m = new Map(); matrix.set(b, m); }
      var t = new Date(r.slice_ts); t.setMinutes(0, 0, 0); var key = t.toISOString();
      hours.add(key);
      var cell = m.get(key); if (!cell) { cell = { value: 0, downtime: false }; m.set(key, cell); }
      var val = metric === 'error' ? Math.abs(r.act_power_kw - r.pred_power_kw) : Math.max(r.loss_eur, 0);
      cell.value += val; cell.downtime = cell.downtime || r.is_downtime;
    }
    var hourList = Array.from(hours).sort();
    var batteries = Array.from(matrix.keys()).sort();
    var maxVal = 0;
    for (var bi = 0; bi < batteries.length; bi++) {
      var bb = batteries[bi]; var m2 = matrix.get(bb);
      for (var hi = 0; hi < hourList.length; hi++) { var hkey = hourList[hi]; var c2 = m2.get(hkey); var v = c2 && c2.value ? c2.value : 0; if (v > maxVal) maxVal = v; }
    }
    return { matrix: matrix, hourList: hourList, batteries: batteries, maxVal: maxVal };
  }

  function renderHeatmap(metric, lastDiffRows) {
    var m = buildHeatmapMatrix(lastDiffRows, metric);
    var matrix = m.matrix, hourList = m.hourList, batteries = m.batteries, maxVal = m.maxVal;
    var container = document.getElementById('heatmap'); container.innerHTML = '';
    var table = document.createElement('table');
    var head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    for (var i = 0; i < hourList.length; i++) {
      var th = document.createElement('th'); th.textContent = new Date(hourList[i]).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', day: '2-digit', hour: '2-digit' }); head.appendChild(th);
    }
    table.appendChild(head);
    var sel = document.getElementById('batterySelect');
    for (var bi = 0; bi < batteries.length; bi++) {
      var b = batteries[bi]; var tr = document.createElement('tr'); var th2 = document.createElement('th'); th2.textContent = b; tr.appendChild(th2); var mm = matrix.get(b);
      for (var hi = 0; hi < hourList.length; hi++) {
        var hkey = hourList[hi]; var td = document.createElement('td'); var cell = mm.get(hkey); var val = cell ? cell.value : 0; var intensity = maxVal ? val / maxVal : 0; td.style.backgroundColor = 'rgba(255,0,0,' + intensity + ')'; if (cell && cell.downtime) { var d = document.createElement('div'); d.style.width = '10px'; d.style.height = '10px'; d.style.margin = 'auto'; d.style.transform = 'rotate(45deg)'; d.style.background = 'white'; td.appendChild(d); } td.addEventListener('click', (function (bb, start) { return function () { if (sel) { sel.value = bb; renderCumChart(bb, { start: new Date(start), end: new Date(new Date(start).getTime() + 3600000) }); } }; })(b, hkey)); tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    container.appendChild(table);
  }

  function buildAvailabilityMatrix(diffRows, batteries, pMinFrac) {
    var matrix = new Map();
    var hours = new Set();
    var bmap = new Map(batteries.map(function (b) { return [b.battery_id, b]; }));
    for (var i = 0; i < diffRows.length; i++) {
      var r = diffRows[i];
      var b = r.battery_id; var m = matrix.get(b); if (!m) { m = new Map(); matrix.set(b, m); }
      var t = new Date(r.slice_ts); t.setMinutes(0, 0, 0); var key = t.toISOString(); hours.add(key);
      var cell = m.get(key); if (!cell) { cell = { status: 'available' }; m.set(key, cell); }
      if (r.is_downtime) { cell.status = 'downtime'; }
      else {
        var rating = bmap.get(b).power_kw; var pmin = rating * pMinFrac;
        if (Math.abs(r.pred_power_kw) >= pmin && Math.abs(r.act_power_kw) < Math.abs(r.pred_power_kw) - 1e-9) { if (cell.status !== 'downtime') cell.status = 'derated'; }
      }
    }
    return { matrix: matrix, hourList: Array.from(hours).sort(), batteries: Array.from(matrix.keys()).sort() };
  }

  function renderAvailabilityTimeline(diffRows, batteries, pMinFrac) {
    var bm = buildAvailabilityMatrix(diffRows, batteries, pMinFrac);
    var matrix = bm.matrix, hourList = bm.hourList, ids = bm.batteries;
    var container = document.getElementById('availTimeline'); container.innerHTML = '';
    var table = document.createElement('table');
    var head = document.createElement('tr'); head.appendChild(document.createElement('th'));
    for (var i = 0; i < hourList.length; i++) { var th = document.createElement('th'); th.textContent = new Date(hourList[i]).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', day: '2-digit', hour: '2-digit' }); head.appendChild(th); }
    table.appendChild(head);
    var sel = document.getElementById('batterySelect');
    for (var bi = 0; bi < ids.length; bi++) {
      var b = ids[bi]; var tr = document.createElement('tr'); var th2 = document.createElement('th'); th2.textContent = b; tr.appendChild(th2); var m = matrix.get(b);
      for (var hi = 0; hi < hourList.length; hi++) { var hkey = hourList[hi]; var td = document.createElement('td'); var cell = m.get(hkey); var status = cell && cell.status ? cell.status : 'available'; if (status === 'downtime') td.style.backgroundColor = 'rgba(244,67,54,0.7)'; else if (status === 'derated') td.style.backgroundColor = 'rgba(255,235,59,0.7)'; else td.style.backgroundColor = 'rgba(76,175,80,0.7)'; td.addEventListener('click', (function (bb, start) { return function () { if (sel) { sel.value = bb; renderCumChart(bb, { start: new Date(start), end: new Date(new Date(start).getTime() + 3600000) }); } }; })(b, hkey)); tr.appendChild(td); }
      table.appendChild(tr);
    }
    container.appendChild(table);
  }

  function initFromStatic() {
    var qid = window.Util.qs('projectId', 'P-001');
    var all = window.revenueData || {};
    var rd = all[qid];
    if (!rd) {
      var keys = Object.keys(all);
      if (!keys.length) { console.warn('No hardcoded revenue data available'); return; }
      console.warn('No hardcoded revenue data for project', qid, '— falling back to', keys[0]);
      rd = all[keys[0]];
    }
    var price5 = stepFillPriceTo5(rd.price, rd.window);
    var pred5 = explodePredTo5(rd.pred, rd.batteries).filter(function (r) { var t = toDate(r.slice_ts); return t >= toDate(rd.window.start) && t < toDate(rd.window.end); });
    var act5 = aggregateActualTo5(rd.actual, rd.batteries, rd.window);
    var diffRows = computeDiffRows(price5, pred5, act5);
    var pMinFrac = (typeof rd.pMinPct === 'number' ? rd.pMinPct : 5) / 100;
    var sla = (typeof rd.slaPct === 'number' ? rd.slaPct : 95) / 100;
    var agg = aggregateSummaries(diffRows, rd.batteries, pMinFrac, sla);
    var perBattery = agg.perBattery;
    var portfolio = agg.portfolio;

    document.getElementById('results').style.display = 'block';
    renderKPIs(portfolio);
    renderSummaryTable(perBattery);
    renderDiffTable(diffRows);

    var revKpisEl = document.getElementById('revKpis');
    if (revKpisEl && !revKpisEl.innerHTML.replace(/\s+/g, '')) {
      var items = [
        { label: 'Predicted Revenue', value: portfolio.rev_pred_eur.toFixed(2) + ' EUR' },
        { label: 'Actual Revenue', value: portfolio.rev_act_eur.toFixed(2) + ' EUR' },
        { label: 'Revenue Loss', value: portfolio.loss_eur.toFixed(2) + ' EUR' }
      ];
      revKpisEl.innerHTML = items.map(function (c) { return '<div class="kpi"><div class="label">' + c.label + '</div><div class="value">' + c.value + '</div></div>'; }).join('');
    }

    var sel = document.getElementById('batterySelect');
    sel.innerHTML = '<option value="">All</option>' + rd.batteries.map(function (b) { return '<option value="' + b.battery_id + '">' + b.battery_id + '</option>'; }).join('');
    sel.addEventListener('change', function () { renderCumChart(sel.value || null); });

    if (typeof Chart === 'undefined') {
      var notice = document.createElement('p'); notice.className = 'muted'; notice.textContent = 'Charts unavailable (Chart.js not loaded). Tables are shown instead.'; var res = document.getElementById('results'); res.insertBefore(notice, res.firstChild); return;
    }

    cumulativeSeries = { ALL: buildCumulativeSeries(diffRows, null) };
    for (var bi = 0; bi < rd.batteries.length; bi++) { var b = rd.batteries[bi]; cumulativeSeries[b.battery_id] = buildCumulativeSeries(diffRows, b.battery_id); }
    renderCumChart(null);

    var met = document.getElementById('heatmapMetric');
    function rerenderHeatmap() { renderHeatmap(met.value, diffRows); }
    met.addEventListener('change', rerenderHeatmap);
    rerenderHeatmap();
    renderAvailabilityTimeline(diffRows, rd.batteries, pMinFrac);
    renderLossBreakdown(perBattery);
  }

  if (window.ChartAnnotation) Chart.register(window.ChartAnnotation);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFromStatic); else initFromStatic();
})();

