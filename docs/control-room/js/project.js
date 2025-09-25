(function(){
  const { formatPct, formatEur, formatDate, qs, badge } = window.Util;

  function renderHeader(p){
    const el = document.getElementById('projectHeader');
    const loc = `${p.location.city}, ${p.location.country}`;
    el.innerHTML = [
      { label: 'Project', value: `${p.name} (${p.projectId})` },
      { label: 'Location', value: loc },
      { label: 'Size', value: `${p.sizeMWh} MWh` },
      { label: 'SLA', value: badge(p.slaStatus) },
      { label: 'Uptime', value: formatPct(p.uptimePct) },
      { label: 'Batteries', value: String(p.batteries.length) }
    ].map(c => `<div class="kpi"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('');
  }

  function renderRevenue(p){
    const r = p.revenueLoss;
    const k = r.kpi;
    const kpiEl = document.getElementById('revKpis');
    kpiEl.innerHTML = [
      { label: 'Predicted Revenue', value: formatEur(k.revPredEur) },
      { label: 'Actual Revenue', value: formatEur(k.revActEur) },
      { label: 'Revenue Loss', value: formatEur(k.lossEur) },
      { label: 'Downtime Loss', value: formatEur(k.lossDowntimeEur) },
      { label: 'Utilization', value: formatPct(k.utilizationPct) },
      { label: 'A_time', value: formatPct(k.timeAvailabilityPct) },
      { label: 'A_dispatch', value: formatPct(k.dispatchAvailabilityPct) },
      { label: 'Headroom', value: formatEur(k.headroomCostEur) }
    ].map(c => `<div class="kpi"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('');

    const dailyEl = document.getElementById('revDaily');
    const rows = r.dailyBreakdown || [];
    if (!rows.length) { dailyEl.innerHTML = '<p class="muted">No daily breakdown</p>'; return; }
    let html = '<table><thead><tr>'+
      '<th>Date</th><th>Pred Rev</th><th>Act Rev</th><th>Loss</th><th>Downtime Loss</th><th>Util %</th><th>A_time %</th><th>A_disp %</th><th>Headroom</th>'+
      '</tr></thead><tbody>';
    for (const d of rows){
      html += `<tr>
        <td>${d.date}</td>
        <td>${formatEur(d.revPredEur)}</td>
        <td>${formatEur(d.revActEur)}</td>
        <td>${formatEur(d.lossEur)}</td>
        <td>${formatEur(d.lossDowntimeEur)}</td>
        <td>${formatPct(d.utilizationPct)}</td>
        <td>${formatPct(d.timeAvailabilityPct)}</td>
        <td>${formatPct(d.dispatchAvailabilityPct)}</td>
        <td>${formatEur(d.headroomCostEur)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    dailyEl.innerHTML = html;
  }

  function renderBmsErrors(p){
    const el = document.getElementById('bmsErrors');
    const rows = p.errorsOpen || [];
    if (!rows.length){ el.innerHTML = '<p class="muted">No open errors</p>'; return; }
    let html = '<table><thead><tr>'+
      '<th>First Seen</th><th>Severity</th><th>Status</th><th>Battery</th><th>Title</th><th>Action</th><th>Manual</th><th>Maintenance</th>'+
      '</tr></thead><tbody>';
    for (const e of rows){
      const manual = e.manualUrl ? `<a href="${e.manualUrl}" target="_blank" rel="noopener">Manual ${e.manualPage ?? ''}</a>` : '-';
      const maint = e.maintenance ? `${formatDate(e.maintenance.scheduledAt)} (${e.maintenance.durationMin}m)` : '-';
      html += `<tr>
        <td>${formatDate(e.firstSeenAt)}</td>
        <td>${e.severity}</td>
        <td>${e.status}</td>
        <td>${e.batteryId ?? '-'}</td>
        <td>${e.title}</td>
        <td>${e.actionHint}</td>
        <td>${manual}</td>
        <td>${maint}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // Energy computations will use shared EnergyUtils to match calc_energy.js

  function renderSlaMetricsForProject(project){
    const mount = document.getElementById('slaProject');
    const policyEl = document.getElementById('slaPolicy');
    if (!mount) return;

    try {
      const rev = (window.revenueData && window.revenueData[project.projectId]) ? window.revenueData[project.projectId] : null;
      if (!rev || !rev.actual || !rev.pred || !rev.batteries) {
        mount.innerHTML = '<p class="muted">No revenue dataset available for SLA computation</p>';
        return;
      }

    const pMinFrac = (rev.pMinPct ?? 5) / 100;
    const slaTargetPct = (typeof rev.slaPct === 'number') ? rev.slaPct : ((window.portfolioSummary && window.portfolioSummary.slaConfig && typeof window.portfolioSummary.slaConfig.targetPct === 'number') ? window.portfolioSummary.slaConfig.targetPct : 95);
    // Index predicted blocks per battery for quick lookup at arbitrary timestamps (for dispatch availability only)
    const predBlocks = new Map();
    for (const bl of rev.pred){ let arr = predBlocks.get(bl.battery_id); if (!arr){ arr=[]; predBlocks.set(bl.battery_id, arr);} arr.push({ s:new Date(bl.start_ts).getTime(), e:new Date(bl.end_ts).getTime(), p:Number(bl.power_kw) }); }
    function predAt(bid, ts){ const t=new Date(ts).getTime(); const arr=predBlocks.get(bid)||[]; for (let i=0;i<arr.length;i++){ const b=arr[i]; if (t>=b.s && t<b.e) return b.p; } return 0; }

    // Compute per-battery metrics
    const results = [];
    // Precompute energy totals via shared function
    const energyTotals = (window.EnergyUtils && typeof window.EnergyUtils.computeChargeDischargeTotals === 'function')
      ? window.EnergyUtils.computeChargeDischargeTotals(rev)
      : { perBattery: [] };
    const energyByBattery = new Map(energyTotals.perBattery.map(r => [String(r.battery_id), r]));

    for (const b of rev.batteries){
      const rows = rev.actual.filter(r => r.battery_id === b.battery_id).slice().sort((x,y)=> new Date(x.ts)-new Date(y.ts));
      const pMin = b.power_kw * pMinFrac;
      let totalSlices = 0;
      let downtimeSlices = 0;
      let dispatchCount = 0;
      let dispatchASum = 0;
      for (const r of rows){
        totalSlices++;
        const mode = r && typeof r.mode !== 'undefined' ? r.mode : 'DOWNTIME';
        const pAct = Number(r && typeof r.power_kw !== 'undefined' ? r.power_kw : 0);
        if (mode === 'DOWNTIME') downtimeSlices++;
        const pPred = Number(predAt(b.battery_id, r.ts) || 0);
        const instructed = Math.abs(pPred) >= pMin;
        if (instructed){ dispatchCount++; const a = Math.min(1, Math.abs(pAct) / Math.max(Math.abs(pPred), 1e-9)); dispatchASum += a; }
      }
      const aTimePct = totalSlices ? ((totalSlices - downtimeSlices) / totalSlices) * 100 : 100;
      const aDispPct = dispatchCount ? (dispatchASum / dispatchCount) * 100 : 100;
      const et = energyByBattery.get(String(b.battery_id));
      const rtePct = (et && et.charge_kwh > 0) ? (et.discharge_kwh / et.charge_kwh) * 100 : null;
      results.push({ battery_id: b.battery_id, a_time_pct: aTimePct, a_dispatch_pct: aDispPct, rte_pct: rtePct });
    }

    // Helpers for RTE coloring/status
    function getRteTargetPct(){
      const s = window.portfolioSummary && window.portfolioSummary.slaMetrics && window.portfolioSummary.slaMetrics.roundTripEfficiency;
      if (s && typeof s.target === 'string'){ const m = String(s.target).match(/([0-9]+(?:\.[0-9]+)?)/); if (m) return Number(m[1]); }
      if (s && typeof s.targetPct === 'number') return s.targetPct;
      return 88.0;
    }
    function rteStatus(rte, target, buffer){
      if (typeof rte !== 'number' || !isFinite(rte)) return null;
      if (rte < target) return 'red';
      if (rte < target + (buffer ?? 5)) return 'yellow';
      return 'green';
    }
    const targetRte = getRteTargetPct();

    // Render table
    let html = '<div class="table-container"><table><thead><tr>'+
      '<th>Battery</th><th>Time Availability</th><th>Dispatch Availability</th><th>RTE</th><th>SLA Target</th>'+
      '</tr></thead><tbody>';
    for (const r of results){
      const rteStr = (typeof r.rte_pct === 'number') ? r.rte_pct.toFixed(1) + '%' : '—';
      const status = rteStatus(r.rte_pct, targetRte, 5);
      const rteBadge = status ? `<span class="badge ${status}">${status==='green'?'ok':(status==='yellow'?'warn':'risk')}</span>` : '';
      html += `<tr>
        <td>${r.battery_id}</td>
        <td>${r.a_time_pct.toFixed(1)}% (target ${slaTargetPct}%)</td>
        <td>${r.a_dispatch_pct.toFixed(1)}%</td>
        <td>${rteStr} ${rteBadge}</td>
        <td>RTE ≥${targetRte}%</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
    mount.innerHTML = html;

    // Render policy details borrowed from portfolio summary
    const sla = (window.portfolioSummary && window.portfolioSummary.slaMetrics) ? window.portfolioSummary.slaMetrics : null;
    if (sla && policyEl){
      const item = (label, value) => value ? `<div><span class="muted">${label}:</span> ${value}</div>` : '';
      const blocks = [];
      if (sla.roundTripEfficiency){
        blocks.push(`
          <div class="kpi">
            <div class="label">${sla.roundTripEfficiency.name}</div>
            <div class="value">Target: ${sla.roundTripEfficiency.target}</div>
            ${item('Measurement', sla.roundTripEfficiency.measurement)}
            ${item('Testing', sla.roundTripEfficiency.testing)}
            ${item('Penalty', sla.roundTripEfficiency.penalty)}
          </div>
        `);
      }
      if (sla.stateOfHealthRetention){
        blocks.push(`
          <div class="kpi">
            <div class="label">${sla.stateOfHealthRetention.name}</div>
            <div class="value">Target: ${sla.stateOfHealthRetention.target}</div>
            ${item('Measurement', sla.stateOfHealthRetention.measurement)}
            ${item('Guarantee', sla.stateOfHealthRetention.guarantee)}
            ${item('Penalty', sla.stateOfHealthRetention.penalty)}
          </div>
        `);
      }
      policyEl.innerHTML = `<div class="kpis">${blocks.join('')}</div>`;
    }
    } catch (e) {
      const mount = document.getElementById('slaProject');
      if (mount) {
        mount.innerHTML = '<p class="muted">Failed to render SLA metrics: ' + (e && e.message ? e.message : e) + '</p>';
      }
    }
  }

  // Init
  const id = qs('projectId', 'P-001');
  const project = window.getProjectById ? window.getProjectById(id) : null;
  if (!project){
    document.querySelector('.content').innerHTML = `<p class="muted">Project not found: ${id}</p>`;
    return;
  }
  renderHeader(project);
  // Do not render static revenue KPIs/daily table from project metadata,
  // weekly charts/tables are computed from hardcoded datasets in revenue_static.js
  renderBmsErrors(project);
})();
