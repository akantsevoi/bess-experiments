(function(){
  const { formatPct, formatDate, badge } = window.Util;

  function renderTopStrip(summary){
    const el = document.getElementById('topStrip');
    const cards = [
      { label: 'Overall Uptime', value: formatPct(summary.overallUptimePct) },
      { label: 'Total Projects', value: String(summary.totalProjects) },
      { label: 'Green / Yellow / Red', value: `${summary.projectsByStatus.green} / ${summary.projectsByStatus.yellow} / ${summary.projectsByStatus.red}` },
      { label: 'Total Capacity', value: `${summary.totalCapacityMWh} MWh` },
      { label: 'SLA Target', value: formatPct(summary.slaConfig.targetPct) },
      { label: 'Updated', value: formatDate(summary.lastUpdatedAt) }
    ];
    el.innerHTML = cards.map(c => `<div class="kpi"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('');
  }

  function renderPortfolioTable(rows){
    const mount = document.getElementById('portfolioTable');
    if (!rows?.length){ mount.innerHTML = '<p class="muted">No projects</p>'; return; }
    let html = '<table><thead><tr>'+
      '<th>Name</th><th>SLA</th><th>Uptime</th><th>Last Maintenance</th><th>Location</th><th>Size (MWh)</th>'+
      '</tr></thead><tbody>';
    for (const r of rows){
      const loc = `${r.location.city}, ${r.location.country}`;
      html += `<tr data-id="${r.projectId}">
        <td>${r.name}</td>
        <td>${badge(r.slaStatus)}</td>
        <td>${formatPct(r.uptimePct)}</td>
        <td>${r.lastMaintenanceAt ? formatDate(r.lastMaintenanceAt) : '-'}</td>
        <td>${loc}</td>
        <td>${r.sizeMWh}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    mount.innerHTML = html;
    mount.querySelectorAll('tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-id');
        window.location.href = `project.html?projectId=${encodeURIComponent(id)}`;
      });
    });
  }

  // Init
  renderTopStrip(window.portfolioSummary);
  renderPortfolioTable(window.assetPortfolio);
})();

