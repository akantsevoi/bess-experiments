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
