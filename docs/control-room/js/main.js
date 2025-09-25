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
    const html = cards.map(c => `<div class="kpi"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('');
    if (el) el.innerHTML = html;
    const elSla = document.getElementById('topStripSla');
    if (elSla) elSla.innerHTML = html;
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

  // Helpers to align with tools/calc_energy.js
  function median(arr){ if (!arr.length) return NaN; const a = arr.slice().sort((x,y)=>x-y); const m = Math.floor(a.length/2); return a.length%2 ? a[m] : (a[m-1]+a[m])/2; }
  function inferIntervalMin(rows){
    if (!rows || rows.length < 2) return NaN;
    const ts = rows.map(r => new Date(r.ts).getTime()).filter(v => !isNaN(v)).sort((a,b)=>a-b);
    const dts = [];
    for (let i=1; i<ts.length; i++){ const dtm = (ts[i]-ts[i-1])/60000; if (dtm>0 && dtm<180) dts.push(dtm); }
    return median(dts);
  }

  function computeProjectSla(rev, fallbackSlaTarget){
    const pMinFrac = (rev.pMinPct ?? 5) / 100;
    const slaTargetPct = (typeof rev.slaPct === 'number') ? rev.slaPct : (typeof fallbackSlaTarget === 'number' ? fallbackSlaTarget : 95);
    // Build quick index of predicted blocks per battery
    const predBlocks = new Map();
    for (const bl of rev.pred){ let arr = predBlocks.get(bl.battery_id); if (!arr){ arr=[]; predBlocks.set(bl.battery_id, arr);} arr.push({ s:new Date(bl.start_ts).getTime(), e:new Date(bl.end_ts).getTime(), p:Number(bl.power_kw) }); }
    function predAt(bid, ts){ const t=new Date(ts).getTime(); const arr=predBlocks.get(bid)||[]; for (let i=0;i<arr.length;i++){ const b=arr[i]; if (t>=b.s && t<b.e) return b.p; } return 0; }

    // Group actual rows per battery
    const actualByBat = new Map();
    for (const r of rev.actual){ let a=actualByBat.get(r.battery_id); if(!a){a=[]; actualByBat.set(r.battery_id,a);} a.push(r); }

    let totalSlices=0, downtimeSlices=0, dispatchCount=0, dispatchASum=0;
    const rating = new Map(rev.batteries.map(b=>[b.battery_id, b.power_kw]));

    for (const b of rev.batteries){
      const rows = (actualByBat.get(b.battery_id)||[]).slice().sort((x,y)=> new Date(x.ts)-new Date(y.ts));
      const dtMin = inferIntervalMin(rows) || 5; const dtH = dtMin/60;
      const pMin = b.power_kw * pMinFrac;
      for (const r of rows){
        totalSlices++;
        const mode = r && typeof r.mode !== 'undefined' ? r.mode : 'DOWNTIME';
        const pAct = Number(r && typeof r.power_kw !== 'undefined' ? r.power_kw : 0);
        if (mode === 'DOWNTIME') downtimeSlices++;
        const pPred = Number(predAt(b.battery_id, r.ts) || 0);
        const instructed = Math.abs(pPred) >= pMin;
        if (instructed){ dispatchCount++; const a = Math.min(1, Math.abs(pAct) / Math.max(Math.abs(pPred), 1e-9)); dispatchASum += a; }
      }
    }
    const aTimePct = totalSlices ? ((totalSlices - downtimeSlices) / totalSlices) * 100 : 100;
    const aDispPct = dispatchCount ? (dispatchASum / dispatchCount) * 100 : 100;
    // Use shared total energy calculator to align with calc_energy.js
    const energyTotals = (window.EnergyUtils && typeof window.EnergyUtils.computeChargeDischargeTotals === 'function')
      ? window.EnergyUtils.computeChargeDischargeTotals(rev)
      : { totals: { charge_kwh: NaN, discharge_kwh: NaN } };
    const eC = Number(energyTotals.totals.charge_kwh);
    const eD = Number(energyTotals.totals.discharge_kwh);
    const rtePct = eC > 0 ? (eD / eC) * 100 : null;
    return { a_time_pct: aTimePct, a_dispatch_pct: aDispPct, rte_pct: rtePct, sla_target_pct: slaTargetPct, slices_total: totalSlices, downtime_slices: downtimeSlices };
  }

  // Prefer static JSON snapshots (data/static/revenue-<ID>.json) over inlined JS datasets.
  // This keeps UI SLA metrics aligned with tools/calc_energy.js which operate on the same JSON.
  async function loadRevenueDataForProjects(ids){
    const viaHttp = (typeof location !== 'undefined' && location.protocol !== 'file:');
    window.revenueData = window.revenueData || {};
    if (!viaHttp) return; // avoid fetch errors on file://
    const tasks = ids.map(async (id) => {
      try {
        const resp = await fetch(`data/static/revenue-${id}.json`, { cache: 'no-store' });
        if (resp.ok) {
          const jd = await resp.json();
          // Always override any pre-bundled JS dataset to ensure parity with tool outputs
          window.revenueData[id] = jd;
        }
      } catch (e) { /* ignore, keep existing dataset if any */ }
    });
    await Promise.all(tasks);
  }

  async function loadPortfolioMeta(){
    try {
      const viaHttp = (typeof location !== 'undefined' && location.protocol !== 'file:');
      if (!viaHttp) return; // avoid fetch errors on file://
      const resp = await fetch('data/static/portfolio.json', { cache: 'no-store' });
      if (resp.ok){
        const jd = await resp.json();
        if (jd && jd.portfolioSummary) window.portfolioSummary = jd.portfolioSummary;
        if (jd && Array.isArray(jd.assetPortfolio)) window.assetPortfolio = jd.assetPortfolio;
      }
    } catch (e) { /* ignore */ }
  }

  async function renderSlaProjectsTable(){
    const mount = document.getElementById('slaTable');
    if (!mount){ return; }
    const projects = window.projects || [];
    const fallbackTarget = window.portfolioSummary?.slaConfig?.targetPct ?? 95;
    if (!projects.length){ mount.innerHTML = '<p class="muted">No projects</p>'; return; }

    // Show loading while fetching JSON datasets
    mount.innerHTML = '<p class="muted">Loading…</p>';
    const ids = projects.map(p => p.projectId);
    await loadRevenueDataForProjects(ids);

    const revenue = window.revenueData || {};
    function getRteTargetPct(){
      const s = window.portfolioSummary && window.portfolioSummary.slaMetrics && window.portfolioSummary.slaMetrics.roundTripEfficiency;
      if (s && typeof s.target === 'string'){ const m = String(s.target).match(/([0-9]+(?:\.[0-9]+)?)/); if (m) return Number(m[1]); }
      if (s && typeof s.targetPct === 'number') return s.targetPct;
      return 88.0;
    }
    function getSohTargetPct(){
      const s = window.portfolioSummary && window.portfolioSummary.slaMetrics && window.portfolioSummary.slaMetrics.stateOfHealthRetention;
      if (s && typeof s.target === 'string'){ const m = String(s.target).match(/([0-9]+(?:\.[0-9]+)?)/); if (m) return Number(m[1]); }
      if (s && typeof s.targetPct === 'number') return s.targetPct;
      return 70.0;
    }
    function rteStatus(rte, target, buffer){
      if (typeof rte !== 'number' || !isFinite(rte)) return null;
      if (rte < target) return 'red';
      if (rte < target + (buffer ?? 5)) return 'yellow';
      return 'green';
    }
    const targetRte = getRteTargetPct();
    const targetSoh = getSohTargetPct();

    function computeProjectSoh(project){
      const bats = (project && project.batteries) ? project.batteries : [];
      let baseSum = 0, latestSum = 0, count = 0;
      for (const b of bats){
        const soh = b && b.soh;
        if (!soh || !soh.baseline || !Array.isArray(soh.tests) || !soh.tests.length) continue;
        const base = Number(soh.baseline.usable_kwh);
        const latest = soh.tests.slice().sort((a,b)=> new Date(a.ts)-new Date(b.ts)).slice(-1)[0];
        const latestVal = Number(latest && latest.usable_kwh);
        if (!isFinite(base) || base <= 0 || !isFinite(latestVal) || latestVal <= 0) continue;
        baseSum += base;
        latestSum += latestVal;
        count++;
      }
      if (baseSum <= 0 || count === 0) return null;
      return (latestSum / baseSum) * 100;
    }

    let html = '<div class="table-container"><table><thead><tr>'+
      '<th>Project</th><th>Time Availability</th><th>Dispatch Availability</th><th>RTE</th><th>SoH</th><th>Targets</th>'+
      '</tr></thead><tbody>';
    for (const p of projects){
      const rev = revenue[p.projectId];
      if (!rev){
        html += `<tr data-id="${p.projectId}"><td>${p.name}</td><td colspan="5"><span class="muted">No dataset available</span></td></tr>`;
        continue;
      }
      const m = computeProjectSla(rev, fallbackTarget);
      const timeOk = m.a_time_pct >= m.sla_target_pct;
      const rteStr = (typeof m.rte_pct === 'number') ? m.rte_pct.toFixed(1) + '%' : '—';
      const status = rteStatus(m.rte_pct, targetRte, 5);
      const rteBadge = status ? `<span class="badge ${status}">${status==='green'?'ok':(status==='yellow'?'warn':'risk')}</span>` : '';
      const sohPct = computeProjectSoh(p);
      const sohStatus = rteStatus(sohPct, targetSoh, 5);
      const sohStr = (typeof sohPct === 'number') ? sohPct.toFixed(1) + '%' : '—';
      const sohBadge = sohStatus ? `<span class="badge ${sohStatus}">${sohStatus==='green'?'ok':(sohStatus==='yellow'?'warn':'risk')}</span>` : '';
      html += `<tr data-id="${p.projectId}">
        <td>${p.name}</td>
        <td>${m.a_time_pct.toFixed(1)}% (target ${m.sla_target_pct}%) ${timeOk ? '<span class="badge green">ok</span>' : '<span class="badge red">risk</span>'}</td>
        <td>${m.a_dispatch_pct.toFixed(1)}%</td>
        <td>${rteStr} ${rteBadge}</td>
        <td>${sohStr} ${sohBadge}</td>
        <td>Time ≥${m.sla_target_pct}%, RTE ≥${targetRte}%, SoH ≥${targetSoh}%</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
    mount.innerHTML = html;
    // row click -> navigate to project page
    mount.querySelectorAll('tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-id');
        if (id) window.location.href = `project.html?projectId=${encodeURIComponent(id)}`;
      });
    });
  }

  function statusFromATime(aTimePct, slaConfig){
    const tgt = Number(slaConfig?.targetPct ?? 95);
    const green = Number(slaConfig?.greenBufferPct ?? 2);
    const yellow = Number(slaConfig?.yellowBufferPct ?? 1);
    if (aTimePct >= tgt + green) return 'green';
    if (aTimePct >= tgt + yellow) return 'yellow';
    return 'red';
  }

  async function rebuildOverviewFromStatic(){
    const projectsMeta = window.projects || [];
    const slaCfg = window.portfolioSummary?.slaConfig || { targetPct: 95, greenBufferPct: 2, yellowBufferPct: 1 };
    const ids = projectsMeta.map(p => p.projectId);
    await loadRevenueDataForProjects(ids);
    const revenue = window.revenueData || {};
    const assetMeta = new Map((window.assetPortfolio || []).map(r => [r.projectId, r]));
    const rows = [];
    let totalSlices = 0, downtimeSlices = 0;
    let counts = { green: 0, yellow: 0, red: 0 };
    for (const p of projectsMeta){
      const rev = revenue[p.projectId];
      const meta = assetMeta.get(p.projectId) || p;
      if (rev){
        const m = computeProjectSla(rev, slaCfg.targetPct);
        const status = statusFromATime(m.a_time_pct, slaCfg);
        rows.push({ projectId: p.projectId, name: p.name, slaStatus: status, uptimePct: m.a_time_pct, lastMaintenanceAt: meta.lastMaintenanceAt || null, location: meta.location || p.location, sizeMWh: meta.sizeMWh || p.sizeMWh });
        totalSlices += m.slices_total; downtimeSlices += m.downtime_slices; counts[status]++;
      } else {
        const status = meta.slaStatus || p.slaStatus || 'yellow';
        rows.push({ projectId: p.projectId, name: p.name, slaStatus: status, uptimePct: meta.uptimePct || p.uptimePct || slaCfg.targetPct, lastMaintenanceAt: meta.lastMaintenanceAt || null, location: meta.location || p.location, sizeMWh: meta.sizeMWh || p.sizeMWh });
        counts[status]++;
      }
    }
    const summary = {
      overallUptimePct: totalSlices ? ((totalSlices - downtimeSlices) / totalSlices) * 100 : (window.portfolioSummary?.overallUptimePct || 100),
      slaConfig: slaCfg,
      totalProjects: rows.length,
      projectsByStatus: counts,
      totalCapacityMWh: window.portfolioSummary?.totalCapacityMWh || 0,
      lastUpdatedAt: new Date().toISOString()
    };
    return { summary, rows };
  }

  function initTabs(){
    const tabs = Array.from(document.querySelectorAll('.sidebar .tabs .tab'));
    const views = { overview: document.getElementById('overview'), sla: document.getElementById('sla') };
    function activate(target){
      tabs.forEach(b => b.classList.remove('active'));
      const btn = tabs.find(b => b.getAttribute('data-tab') === target);
      if (btn) btn.classList.add('active');
      Object.keys(views).forEach(k => views[k]?.classList.remove('active'));
      if (views[target]) views[target].classList.add('active');
      if (target === 'sla') {
        const mount = document.getElementById('slaTable');
        if (mount && !mount.innerHTML.trim()) { mount.innerHTML = '<p class="muted">Loading…</p>'; }
        renderSlaProjectsTable();
      }
    }
    tabs.forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const target = btn.getAttribute('data-tab');
        activate(target);
        // keep URL hash in sync for deep-linking
        try { window.location.hash = target; } catch {}
      });
    });
    // Deep-link support: #sla opens SLA tab
    const hash = (window.location.hash || '').replace('#','');
    if (hash === 'sla') activate('sla');
  }

  // Init
  async function loadProjectsMeta(){
    try {
      const viaHttp = (typeof location !== 'undefined' && location.protocol !== 'file:');
      if (!viaHttp) return; // avoid fetch errors on file://
      const resp = await fetch('data/static/projects.json', { cache: 'no-store' });
      if (resp.ok){
        const jd = await resp.json();
        const arr = Array.isArray(jd) ? jd : (Array.isArray(jd.projects) ? jd.projects : []);
        if (arr.length){
          window.projects = arr;
          window.getProjectById = id => arr.find(p => p.projectId === id) || null;
        }
      }
    } catch (e) { /* ignore */ }
  }

  (async function init(){
    try {
      await Promise.all([loadPortfolioMeta(), loadProjectsMeta()]);
      const built = await rebuildOverviewFromStatic();
      renderTopStrip(built.summary);
      renderPortfolioTable(built.rows);
    } catch (e) {
      renderTopStrip(window.portfolioSummary);
      renderPortfolioTable(window.assetPortfolio);
    }
    initTabs();
  })();
})();
