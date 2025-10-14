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
    const elRag = document.getElementById('topStripRag');
    if (elRag) elRag.innerHTML = html;
  }

  function renderPortfolioTable(rows){
    const mount = document.getElementById('portfolioTable');
    if (!rows?.length){ mount.innerHTML = '<p class="muted">No projects</p>'; return; }
    let html = '<table><thead><tr>'+
      '<th>Name</th><th>Revenue (Pred / Act, Loss) EUR</th><th>Last Maintenance</th><th>Location</th><th>Size (MWh)</th>'+
      '</tr></thead><tbody>';
    for (const r of rows){
      const loc = `${r.location.city}, ${r.location.country}`;
      const revPred = (typeof r.rev_pred_eur === 'number') ? (r.rev_pred_eur).toFixed(2) : '—';
      const revAct = (typeof r.rev_act_eur === 'number') ? (r.rev_act_eur).toFixed(2) : '—';
      const lossNum = (typeof r.loss_eur === 'number') ? r.loss_eur : null;
      const lossClass = (lossNum == null) ? '' : (lossNum > 0 ? 'text-red' : (lossNum < 0 ? 'text-green' : ''));
      const loss = (lossNum == null) ? '—' : `<span class="${lossClass}">${lossNum.toFixed(2)}</span>`;
      html += `<tr data-id="${r.projectId}">
        <td>${r.name}</td>
        <td>${revPred} / ${revAct} (${loss})</td>
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

  // RAG Matrix helpers
  async function loadRagExtras(){
    try {
      const viaHttp = (typeof location !== 'undefined' && location.protocol !== 'file:');
      if (!viaHttp) return;
      const resp = await fetch('data/static/rag-metrics.json', { cache: 'no-store' });
      if (resp.ok){ window.ragExtras = await resp.json(); }
    } catch (e) { /* ignore */ }
  }

  async function loadRagMatrix(){
    try {
      const viaHttp = (typeof location !== 'undefined' && location.protocol !== 'file:');
      if (!viaHttp) return;
      const [mResp, pResp] = await Promise.all([
        fetch('data/static/rag-matrix.json', { cache: 'no-store' }),
        fetch('data/static/rag-panels.json', { cache: 'no-store' })
      ]);
      if (mResp && mResp.ok){ window.ragMatrix = await mResp.json(); }
      if (pResp && pResp.ok){ window.ragPanels = await pResp.json(); }
    } catch (e) { /* ignore */ }
  }

  function classify(value, thresholds){
    // thresholds: { r:number, a:[lo,hi], g:number } as percentage cutoffs
    if (typeof value !== 'number' || !isFinite(value)) return null;
    if (value < thresholds.r) return 'r';
    if (value <= thresholds.a[1]){ return (value < thresholds.a[0]) ? 'r' : 'a'; }
    return 'g';
  }

  function aggAvailability(project, revMetrics){
    const t = { r: 97, a: [97, 98], g: 98 };
    const availability = Number(revMetrics?.a_time_pct);
    const dots = [];
    const extras = (window.ragExtras && window.ragExtras[project.projectId] && window.ragExtras[project.projectId].availability_reliability) || null;
    const mttr = extras?.MTTR_h; const mtbf = extras?.MTBF_h; const resp = extras?.response_time_min; const compAvail = extras?.component_availability_pct; const critical = extras?.critical_alerts || 0;
    // Sub-KPIs
    if (typeof compAvail === 'number') dots.push({ k: 'Component', v: compAvail, s: classify(compAvail, { r: 97, a: [97,98], g: 98 }) });
    if (typeof mttr === 'number') dots.push({ k: 'MTTR', v: mttr, s: mttr > 24 ? 'r' : (mttr > 20 ? 'a' : 'g') });
    if (typeof mtbf === 'number') dots.push({ k: 'MTBF', v: mtbf, s: mtbf < 300 ? 'r' : (mtbf < 500 ? 'a' : 'g') });
    if (typeof resp === 'number') dots.push({ k: 'Response', v: resp, s: resp > 60 ? 'r' : (resp > 30 ? 'a' : 'g') });
    const base = classify(availability, t);
    const elevated = (critical > 0) ? 'r' : base;
    return { value: availability, status: elevated, dots, breach: (critical > 0), extras };
  }

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

  function aggMaintenance(project){
    const t = { r: 90, a: [90,95], g: 95 };
    const extras = (window.ragExtras && window.ragExtras[project.projectId] && window.ragExtras[project.projectId].maintenance_service) || {};
    const prev = Number(extras?.preventive_pct);
    const corr = Number(extras?.corrective_closure_pct);
    const rep = Number(extras?.repeat_issue_rate_pct);
    const aging = Number(extras?.work_order_aging_h);
    const baseVal = isFinite(prev) && isFinite(corr) ? Math.min(prev, corr) : (isFinite(prev) ? prev : (isFinite(corr) ? corr : null));
    const dots = [];
    if (isFinite(prev)) dots.push({ k: 'Preventive', v: prev, s: classify(prev, t) });
    if (isFinite(corr)) dots.push({ k: 'Corrective', v: corr, s: classify(corr, t) });
    if (isFinite(rep)) dots.push({ k: 'Repeat', v: rep, s: rep > 10 ? 'r' : (rep > 5 ? 'a' : 'g') });
    if (isFinite(aging)) dots.push({ k: 'Aging', v: aging, s: aging > 48 ? 'r' : (aging > 24 ? 'a' : 'g') });
    return { value: baseVal, status: classify(baseVal, t), dots, extras };
  }

  function aggPerformance(project, revMetrics){
    const t = { r: 88, a: [88,91], g: 91 };
    const rte = Number(revMetrics?.rte_pct);
    const soh = computeProjectSoh(project);
    const extras = (window.ragExtras && window.ragExtras[project.projectId] && window.ragExtras[project.projectId].performance_efficiency) || {};
    const temp = Number(extras?.temp_compliance_pct);
    const dots = [];
    if (isFinite(rte)) dots.push({ k: 'RTE', v: rte, s: classify(rte, t) });
    if (isFinite(soh)) dots.push({ k: 'SoH', v: soh, s: soh < 70 ? 'r' : (soh < 80 ? 'a' : 'g') });
    if (isFinite(temp)) dots.push({ k: 'Temp', v: temp, s: temp < 90 ? 'r' : (temp < 95 ? 'a' : 'g') });
    const base = classify(rte, t);
    return { value: rte, status: base, dots, extras };
  }

  function aggCommercial(projectId, revenueSummary){
    const t = { r: 90, a: [90,95], g: 95 };
    const extras = (window.ragExtras && window.ragExtras[projectId] && window.ragExtras[projectId].commercial) || {};
    let base = Number(extras?.sla_score_pct);
    if (!isFinite(base) && revenueSummary){
      const { rev_pred_eur, loss_eur } = revenueSummary;
      const pred = Number(rev_pred_eur), loss = Number(loss_eur);
      if (isFinite(pred) && pred > 0 && isFinite(loss)) base = Math.max(0, 100 - 100 * (loss / pred));
    }
    const dots = [];
    if (isFinite(base)) dots.push({ k: 'SLA Score', v: base, s: classify(base, t) });
    if (typeof extras?.damages_eur === 'number') dots.push({ k: 'Damages', v: extras.damages_eur, s: extras.damages_eur > 0 ? 'r' : 'g' });
    if (typeof extras?.invoice_disputes === 'number') dots.push({ k: 'Disputes', v: extras.invoice_disputes, s: extras.invoice_disputes > 0 ? 'a' : 'g' });
    return { value: base, status: classify(base, t), dots, extras };
  }

  function aggData(projectId){
    const t = { r: 95, a: [95,99], g: 99 };
    const extras = (window.ragExtras && window.ragExtras[projectId] && window.ragExtras[projectId].data_reporting) || {};
    const comp = Number(extras?.data_completeness_pct);
    const tel = Number(extras?.telemetry_uptime_pct);
    const del = Number(extras?.report_delivery_pct);
    const alarm = Number(extras?.alarm_accuracy_pct);
    const base = isFinite(comp) ? comp : (isFinite(tel) ? tel : null);
    const dots = [];
    if (isFinite(tel)) dots.push({ k: 'Telemetry', v: tel, s: classify(tel, t) });
    if (isFinite(comp)) dots.push({ k: 'Completeness', v: comp, s: classify(comp, t) });
    if (isFinite(del)) dots.push({ k: 'Delivery', v: del, s: classify(del, t) });
    if (isFinite(alarm)) dots.push({ k: 'Alarm', v: alarm, s: classify(alarm, t) });
    return { value: base, status: classify(base, t), dots, extras };
  }

  function cellClass(status){ return status === 'g' ? 'g' : (status === 'a' ? 'a' : 'r'); }

  function trendArrow(curr, prev){ if (!isFinite(curr) || !isFinite(prev)) return '—'; if (curr > prev + 0.1) return '↑'; if (curr < prev - 0.1) return '↓'; return '—'; }

  function ensureTooltip(){
    let el = document.querySelector('.rag-tip');
    if (!el){ el = document.createElement('div'); el.className = 'rag-tip'; el.style.display = 'none'; document.body.appendChild(el); }
    return el;
  }

  function showTip(html, x, y){ const tip = ensureTooltip(); tip.innerHTML = html; tip.style.left = (x+12)+'px'; tip.style.top = (y+12)+'px'; tip.style.display = 'block'; }
  function hideTip(){ const tip = document.querySelector('.rag-tip'); if (tip) tip.style.display = 'none'; }

  function openDrawer(html){ const d = document.getElementById('ragDrawer'); const c = document.getElementById('ragDrawerContent'); if (c) c.innerHTML = html; if (d){ d.setAttribute('aria-hidden','false'); } }
  function closeDrawer(){ const d = document.getElementById('ragDrawer'); if (d){ d.setAttribute('aria-hidden','true'); } }

  async function renderRagMatrix(){
    const mount = document.getElementById('ragMatrix');
    if (!mount) return;
    mount.innerHTML = '<p class="muted">Loading…</p>';
    await Promise.all([loadRagExtras(), loadRagMatrix()]);

    const projects = window.projects || [];
    const matrix = window.ragMatrix || {};

    // Populate Supplier filter options once
    (function populateSuppliers(){
      try {
        const el = document.getElementById('ragFilterSupplier');
        if (!el) return;
        // if already populated beyond the default, skip
        const existing = new Set(Array.from(el.options).map(o => o.value));
        const sup = new Set();
        for (const p of projects){
          for (const b of (p.batteries||[])) if (b.supplier) sup.add(String(b.supplier));
        }
        for (const s of Array.from(sup).sort()){
          if (existing.has(s)) continue;
          const opt = document.createElement('option'); opt.value = s; opt.textContent = s; el.appendChild(opt);
        }
      } catch {}
    })();

    // Read filters
    const fSupplier = (document.getElementById('ragFilterSupplier')||{}).value || '';
    const fRegion = (document.getElementById('ragFilterRegion')||{}).value || '';
    const fKpi = (document.getElementById('ragFilterKpi')||{}).value || '';

    // Apply row filters: by Supplier (any battery match) and Region (country code)
    const filteredProjects = projects.filter(p => {
      if (fRegion && String(p.location?.country||'') !== String(fRegion)) return false;
      if (fSupplier){
        const any = (p.batteries||[]).some(b => String(b.supplier||'') === String(fSupplier));
        if (!any) return false;
      }
      return true;
    });

    // Daily summary (static from matrix availability statuses)
    const headerEl = document.getElementById('ragDailySummary');
    if (headerEl){
      let g=0,a=0,r=0;
      for (const p of filteredProjects){
        const pm = matrix[p.projectId];
        const s = pm && pm.availability && pm.availability.status || 'a';
        if (s==='g') g++; else if (s==='a') a++; else r++;
      }
      headerEl.textContent = `${g} OK · ${a} at risk · ${r} breach`;
    }

    let html = '<table><thead><tr>'+
      '<th>Project</th>'+
      '<th>Availability & Reliability</th>'+
      '<th>Maintenance & Service</th>'+
      '<th>Performance & Efficiency</th>'+
      '<th>Commercial / Contractual</th>'+
      '<th>Data & Reporting</th>'+
      '</tr></thead><tbody>';
    for (const p of filteredProjects){
      const pm = matrix[p.projectId] || {};
      function cell(label){
        const o = pm[label] || {};
        const cls = cellClass(o.status) + ((o.pulse || o.status==='r') ? ' pulse' : '');
        const main = (isFinite(o.value_pct) ? formatPct(o.value_pct) : '—');
        const micro = Array.isArray(o.sub) ? o.sub.slice(0,5).map(d => `<span class="dot ${cellClass(d.status)}" title="${d.label}"></span>`).join('') : '';
        return `<td><div class="rag-cell ${cls}" data-kpi="${label}"><div class="main">${main}</div><div class="micro">${micro}</div></div></td>`;
      }
      html += `<tr data-id="${p.projectId}">`+
        `<td class="rag-project">${p.name}</td>`+
        cell('availability')+
        cell('maintenance')+
        cell('performance')+
        cell('commercial')+
        cell('data')+
      `</tr>`;
    }
    html += '</tbody></table>';
    mount.innerHTML = '<div class="rag-matrix">'+html+'</div>';

    // Highlight selected KPI column by dimming others
    (function applyKpiHighlight(){
      if (!fKpi) return; // none selected
      const table = mount.querySelector('table');
      if (!table) return;
      // Header marks
      const headerMap = {
        availability: 1,
        maintenance: 2,
        performance: 3,
        commercial: 4,
        data: 5
      };
      const idx = headerMap[fKpi]; // 0 is the project col
      const ths = table.querySelectorAll('thead th');
      ths.forEach((th,i)=> { th.classList.toggle('focus', i===idx); th.classList.toggle('dim', i!==0 && i!==idx); });
      // Body cells
      table.querySelectorAll('tbody tr').forEach(tr => {
        const cells = tr.querySelectorAll('td');
        cells.forEach((td,i)=>{
          const rc = td.querySelector('.rag-cell');
          if (!rc) return;
          rc.classList.toggle('focus', i===idx);
          rc.classList.toggle('dim', i!==idx);
        });
      });
    })();

    // Hover tooltip
    mount.querySelectorAll('tbody tr').forEach(tr => {
      const pid = tr.getAttribute('data-id');
      const project = (window.projects||[]).find(x=>x.projectId===pid);
      const pm = matrix[pid] || {};
      tr.querySelectorAll('.rag-cell').forEach(cell => {
        const kpi = cell.getAttribute('data-kpi');
        cell.addEventListener('mousemove', (ev) => {
          const o = pm[kpi] || {};
          const items = (Array.isArray(o.sub)? o.sub : []).map(d => `<li>${d.label}: ${d.value ?? '—'}${d.unit ?? ''}</li>`).join('');
          const title = {
            availability: 'Availability & Reliability', maintenance: 'Maintenance & Service', performance: 'Performance & Efficiency', commercial: 'Commercial / Contractual', data: 'Data & Reporting'
          }[kpi] || 'KPI';
          showTip(`<h4>${title}</h4><ul>${items}</ul>`, ev.clientX, ev.clientY);
          document.body.style.backdropFilter = 'blur(1px)';
        });
        cell.addEventListener('mouseleave', () => { hideTip(); document.body.style.backdropFilter = ''; });
        cell.addEventListener('click', () => {
          const o = pm[kpi] || {};
          const pd = (window.ragPanels && window.ragPanels[pid] && window.ragPanels[pid][kpi]) || {};
          const pts = Array.isArray(o.trend) ? o.trend : [o.value_pct || 0];
          const w=320,h=56; const xs= pts.length>1 ? (w/(pts.length-1)) : w; const ys = v => h - (v/100)*h; let d=''; pts.forEach((v,i)=>{ d += (i?'L':'M') + (i*xs).toFixed(1)+','+ys(v).toFixed(1)+' '; });
          const clause = pd.clause || '—';
          const subj = pd.email?.subject || `SLA — ${project.name}`;
          const body = pd.email?.body || '';
          const reasons = (pd.reasons || []).map(r => `<li>${r}</li>`).join('');
          const insight = (pd.insights || []).map(r => `<li>${r}</li>`).join('');
          const statusLabel = o.status==='g' ? 'All good' : (o.status==='a' ? 'At risk' : 'Breach detected');
          const panel = `
            <h3>${statusLabel}</h3>
            <div class="section">Project: <strong>${project.name}</strong> · KPI: <strong>${({availability:'Availability',maintenance:'Maintenance',performance:'Performance',commercial:'Commercial',data:'Data'})[kpi]}</strong></div>
            <div class="section">
              <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" stroke="#374151" stroke-width="2" fill="none"/></svg>
            </div>
            <div class="section">Current: ${isFinite(o.value_pct)?formatPct(o.value_pct):'—'}</div>
            ${reasons ? `<div class="section"><strong>Reasons</strong><ul>${reasons}</ul></div>` : ''}
            <div class="section"><strong>Contractual Reference</strong><div>${clause}</div></div>
            ${body ? `<div class="section"><strong>Auto‑Drafted Claim Email</strong><div><div><em>Subject:</em> ${subj}</div><pre style="white-space:pre-wrap;background:rgba(0,0,0,.04);padding:8px;border-radius:8px;">${body}</pre><div style="display:flex; gap:8px;"><button class=\"btn primary\">Send Claim</button><button class=\"btn\">Edit</button><button class=\"btn\">Dismiss Breach</button></div></div></div>` : ''}
            ${insight ? `<div class="section"><strong>AI Insight</strong><ul>${insight}</ul></div>` : ''}
          `;
          openDrawer(panel);
        });
      });
    });

    const closeBtn = document.getElementById('ragDrawerClose');
    if (closeBtn){ closeBtn.onclick = closeDrawer; }

    // Bind filter change handlers once
    if (!window._ragFiltersBound){
      const elS = document.getElementById('ragFilterSupplier');
      const elR = document.getElementById('ragFilterRegion');
      const elK = document.getElementById('ragFilterKpi');
      [elS, elR, elK].forEach(el => { if (el) el.addEventListener('change', () => renderRagMatrix()); });
      window._ragFiltersBound = true;
    }
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

  // Revenue summary aligned with revenue_static.js logic (simplified for totals)
  function computeProjectRevenue(rev){
    try {
      const start = new Date(rev.window.start); const end = new Date(rev.window.end);
      // Build 5-min price map
      const pricePts = (rev.price || []).map(r => ({ ts: new Date(r.ts), price_eur_mwh: Number(r.price_eur_mwh), interval: Number(r.interval_min || 60) }));
      pricePts.sort((a,b)=> a.ts - b.ts);
      const price5 = [];
      if (pricePts.length === 0) return null;
      let idx = 0; let cur = pricePts[0].price_eur_mwh;
      for (let t = new Date(start); t < end; t = new Date(t.getTime() + 5*60000)){
        while (idx + 1 < pricePts.length && t >= pricePts[idx + 1].ts) { idx++; cur = pricePts[idx].price_eur_mwh; }
        price5.push({ slice_ts: t.toISOString(), price_eur_kwh: cur / 1000 });
      }
      const priceMap = new Map(price5.map(p => [p.slice_ts, p.price_eur_kwh]));
      // Predicted blocks index
      const predBlocks = new Map();
      for (const bl of (rev.pred || [])){ let arr = predBlocks.get(bl.battery_id); if (!arr){ arr = []; predBlocks.set(bl.battery_id, arr);} arr.push({ s:new Date(bl.start_ts).getTime(), e:new Date(bl.end_ts).getTime(), p:Number(bl.power_kw) }); }
      function predAt(bid, tsIso){ const t = new Date(tsIso).getTime(); const arr = predBlocks.get(bid)||[]; for (let i=0;i<arr.length;i++){ const b=arr[i]; if (t>=b.s && t<b.e) return b.p; } return 0; }
      // Actual map by battery and 5-min bucketed ts (normalize to avoid drift)
      const actByBat = new Map();
      for (const r of (rev.actual || [])){
        let m = actByBat.get(r.battery_id); if (!m){ m = new Map(); actByBat.set(r.battery_id, m); }
        const ts = new Date(r.ts); const bucket = new Date(Math.floor(ts.getTime()/300000)*300000).toISOString();
        m.set(bucket, Number(r.power_kw||0));
      }
      const h = 5/60;
      let revPred = 0, revAct = 0;
      for (const b of (rev.batteries || [])){
        const m = actByBat.get(b.battery_id) || new Map();
        for (let i=0; i<price5.length; i++){
          const ts = price5[i].slice_ts; const price = priceMap.get(ts);
          const pPred = predAt(b.battery_id, ts);
          const pAct = m.has(ts) ? Number(m.get(ts)) : 0;
          revPred += (pPred * h) * price;
          revAct  += (pAct  * h) * price;
        }
      }
      // Ensure finite numbers
      const clean = (v) => (isFinite(v) ? v : 0);
      return { rev_pred_eur: clean(revPred), rev_act_eur: clean(revAct), loss_eur: clean(revPred - revAct) };
    } catch (e) { return null; }
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
        const rsum = computeProjectRevenue(rev);
        const status = statusFromATime(m.a_time_pct, slaCfg);
        rows.push({ projectId: p.projectId, name: p.name, slaStatus: status, uptimePct: m.a_time_pct, lastMaintenanceAt: meta.lastMaintenanceAt || null, location: meta.location || p.location, sizeMWh: meta.sizeMWh || p.sizeMWh, rev_pred_eur: rsum ? rsum.rev_pred_eur : null, rev_act_eur: rsum ? rsum.rev_act_eur : null, loss_eur: rsum ? rsum.loss_eur : null });
        totalSlices += m.slices_total; downtimeSlices += m.downtime_slices; counts[status]++;
      } else {
        const status = meta.slaStatus || p.slaStatus || 'yellow';
        rows.push({ projectId: p.projectId, name: p.name, slaStatus: status, uptimePct: meta.uptimePct || p.uptimePct || slaCfg.targetPct, lastMaintenanceAt: meta.lastMaintenanceAt || null, location: meta.location || p.location, sizeMWh: meta.sizeMWh || p.sizeMWh, rev_pred_eur: null, rev_act_eur: null, loss_eur: null });
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
    const views = { overview: document.getElementById('overview'), sla: document.getElementById('sla'), rag: document.getElementById('rag') };
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
      } else if (target === 'rag') {
        renderRagMatrix();
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
    // Deep-link support: #sla or #rag opens respective tab
    const hash = (window.location.hash || '').replace('#','');
    if (hash === 'sla') activate('sla');
    else if (hash === 'rag') activate('rag');
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
