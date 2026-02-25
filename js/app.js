// ── Navigation history ──
var navHistory = ['home'];
var navHistoryIdx = 0;

function _updateNavBtns() {
    var back = g('navBack');
    var fwd  = g('navFwd');
    if (!back || !fwd) return;
    var atStart = navHistoryIdx === 0;
    var atEnd   = navHistoryIdx === navHistory.length - 1;
    back.style.opacity       = atStart ? '0.3' : '1';
    back.style.pointerEvents = atStart ? 'none' : 'auto';
    fwd.style.opacity        = atEnd   ? '0.3' : '1';
    fwd.style.pointerEvents  = atEnd   ? 'none' : 'auto';
}

function navGoBack() {
    if (navHistoryIdx === 0) return;
    navHistoryIdx--;
    showPage(navHistory[navHistoryIdx], false);
}

function navGoFwd() {
    if (navHistoryIdx === navHistory.length - 1) return;
    navHistoryIdx++;
    showPage(navHistory[navHistoryIdx], false);
}

// ── Page navigation ──
function showPage(name, push) {
    // Always dismiss spotlight when navigating
    if (typeof closeSpot === 'function') closeSpot();

    if (push !== false) {
        // Truncate any forward history then push
        navHistory = navHistory.slice(0, navHistoryIdx + 1);
        navHistory.push(name);
        navHistoryIdx = navHistory.length - 1;
    }
    _updateNavBtns();

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const pageId = 'page' + name.charAt(0).toUpperCase() + name.slice(1);
    const navId  = 'nl'   + name.charAt(0).toUpperCase() + name.slice(1);
    const pageEl = g(pageId);
    const navEl  = g(navId);
    if (pageEl) pageEl.classList.add('active');
    if (navEl)  navEl.classList.add('active');

    if (name === 'home') {
        renderHome();
    }
    if (name === 'orgHealth' && allData.length) {
        renderOrgHealth();
    }
    if (name === 'compensation' && allData.length) {
        if (typeof renderCompensation === 'function') renderCompensation();
    }
    if (name === 'scenarioStudio') {
        if (typeof renderScenarioStudio === 'function') renderScenarioStudio();
    }
    if (name === 'dashboard' && allData.length) {
        // Defer one frame so the page is visible and Chart.js gets real canvas dimensions
        requestAnimationFrame(() => updateStats(viewData));
    }
    if (name === 'orgchart' && allData.length) {
        // Give the layout a moment to settle before fitting
        setTimeout(() => { try { orgC.render().fit(); } catch(e) {} }, 80);
    }
}

// ── Org chart view reset ──
function resetOrgView() {
    if (g('globalSearch')) g('globalSearch').value = '';
    if (g('orgDeptFilter')) g('orgDeptFilter').value = '';
    // Clear node highlights
    document.querySelectorAll('[data-nid]').forEach(function (card) {
        card.style.opacity    = '';
        card.style.boxShadow  = '';
        card.style.transform  = '';
        card.style.zIndex     = '';
        card.style.transition = '';
    });
    viewData = JSON.parse(JSON.stringify(allData));
    refresh(false);
}

// ── Dashboard view reset ──
function resetDashView() {
    if (g('dDept')) g('dDept').value = '';
    if (g('dMgr'))  g('dMgr').value  = '';
    viewData = JSON.parse(JSON.stringify(allData));
    updateStats(viewData);
}

// ── Org health score ──
function orgHealth(real) {
    const flags = {
        overExtended:       [],
        wideSpan:           [],
        lowRatedManagers:   [],
        perfConcentration:  [],
        tenureRisk:         null,
        missingRatings:     0,
        compensationEquity: [],
        successionGaps:     [],
        singlePoints:       [],
        deptHealth:         [],
    };

    // ── Tenure ──
    const tens = real.map(tenYrs).filter(v => v !== null);
    const avgT = tens.length ? tens.reduce((a, b) => a + b, 0) / tens.length : 0;
    if (tens.length) {
        const lvl = avgT < 1 ? 'critical' : avgT < 2 ? 'warning' : 'ok';
        flags.tenureRisk = { avgT, level: lvl };
    }

    // ── Span of control ──
    const mgrs = real.filter(d => real.some(e => e.parentId === d.id));
    mgrs.forEach(m => {
        const n = real.filter(d => d.parentId === m.id).length;
        if (n >= 12) flags.overExtended.push({ name: m.name, title: m.title, dept: m.department, reportCount: n });
        else if (n >= 9) flags.wideSpan.push({ name: m.name, title: m.title, dept: m.department, reportCount: n });
    });

    // ── Performance ratings ──
    const rats = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, NR: 0 };
    real.forEach(d => { const r = pRat(d.rating); if (r in rats) rats[r]++; });
    flags.missingRatings = rats.NR || 0;
    const lowPerf = (rats[1] || 0) + (rats[2] || 0);
    const lpPct   = real.length ? (lowPerf / real.length) * 100 : 0;
    if (lpPct > 0) flags.perfConcentration.push({ type: 'low', pct: lpPct, count: lowPerf });

    // ── Low-rated managers ──
    mgrs.forEach(m => {
        const r = pRat(m.rating);
        if (r !== 'NR' && r <= 2) flags.lowRatedManagers.push({ name: m.name, title: m.title, dept: m.department, rating: r });
    });

    // ── Compensation equity (flag groups >40% variance for detail table) ──
    const allDepts  = [...new Set(real.map(d => d.department).filter(Boolean))];
    const allLevels = [...new Set(real.map(d => d.jobLevel).filter(Boolean))];
    let hasModVariance = false;
    allDepts.forEach(dept => {
        allLevels.forEach(level => {
            const grp  = real.filter(d => d.department === dept && d.jobLevel === level);
            if (grp.length < 2) return;
            const sals = grp.map(d => cleanSal(d.salary)).filter(s => s > 0);
            if (sals.length < 2) return;
            const minSal = Math.min(...sals), maxSal = Math.max(...sals);
            if (minSal <= 0) return;
            const variance = maxSal / minSal;
            if (variance > 1.4) flags.compensationEquity.push({ dept, level, minSal, maxSal, variance });
            else if (variance > 1.25) hasModVariance = true;
        });
    });

    // ── Succession gaps ──
    mgrs.forEach(m => {
        const reports      = real.filter(d => d.parentId === m.id);
        const hasHighRated = reports.some(d => { const r = pRat(d.rating); return r !== 'NR' && r >= 4; });
        if (!hasHighRated) flags.successionGaps.push({ name: m.name, title: m.title, dept: m.department, reportCount: reports.length });
    });

    // ── Single points of failure ──
    allDepts.forEach(dept => {
        allLevels.forEach(level => {
            const grp = real.filter(d => d.department === dept && d.jobLevel === level);
            if (grp.length !== 1) return;
            const emp = grp[0];
            const reportCount = real.filter(d => d.parentId === emp.id).length;
            if (reportCount >= 3) flags.singlePoints.push({ name: emp.name, title: emp.title, dept: emp.department, jobLevel: emp.jobLevel, reportCount });
        });
    });

    // ── Department health (flag depts ≤ 3.0 avg rating) ──
    allDepts.forEach(dept => {
        const de    = real.filter(d => d.department === dept);
        const rated = de.filter(d => { const r = pRat(d.rating); return r !== 'NR'; });
        if (!rated.length) return;
        const avgRating = rated.reduce((s, d) => s + pRat(d.rating), 0) / rated.length;
        if (avgRating <= 3.0) flags.deptHealth.push({ dept, avgRating, headcount: de.length });
    });

    // ── Risk category classification ──
    const riskCategories = [];

    // 1. Tenure Risk
    if (!tens.length) {
        riskCategories.push({ name: 'Tenure Risk', status: 'nodata', description: 'No start date data available' });
    } else if (avgT < 1) {
        riskCategories.push({ name: 'Tenure Risk', status: 'high', description: `Average tenure is ${avgT.toFixed(1)} years — critical attrition risk` });
    } else if (avgT < 2) {
        riskCategories.push({ name: 'Tenure Risk', status: 'moderate', description: `Average tenure is ${avgT.toFixed(1)} years — below healthy baseline` });
    } else {
        riskCategories.push({ name: 'Tenure Risk', status: 'healthy', description: `Average tenure is ${avgT.toFixed(1)} years across the organization` });
    }

    // 2. Span of Control
    if (!mgrs.length) {
        riskCategories.push({ name: 'Span of Control', status: 'nodata', description: 'No managers identified' });
    } else if (flags.overExtended.length > 0) {
        riskCategories.push({ name: 'Span of Control', status: 'high', description: `${flags.overExtended.length} manager${flags.overExtended.length !== 1 ? 's' : ''} with 12+ direct reports` });
    } else if (flags.wideSpan.length > 0) {
        riskCategories.push({ name: 'Span of Control', status: 'moderate', description: `${flags.wideSpan.length} manager${flags.wideSpan.length !== 1 ? 's' : ''} with 9–11 direct reports` });
    } else {
        riskCategories.push({ name: 'Span of Control', status: 'healthy', description: `All ${mgrs.length} managers have 8 or fewer direct reports` });
    }

    // 3. Performance Distribution
    const totalRated = [5,4,3,2,1].reduce((a, k) => a + (rats[k] || 0), 0);
    if (!totalRated) {
        riskCategories.push({ name: 'Performance Distribution', status: 'nodata', description: 'No performance ratings available' });
    } else if (lpPct >= 20) {
        riskCategories.push({ name: 'Performance Distribution', status: 'high', description: `${lpPct.toFixed(1)}% of employees rated ≤2★ — high low-performer density` });
    } else if (lpPct >= 10) {
        riskCategories.push({ name: 'Performance Distribution', status: 'moderate', description: `${lpPct.toFixed(1)}% of employees rated ≤2★ — elevated low-performer share` });
    } else {
        riskCategories.push({ name: 'Performance Distribution', status: 'healthy', description: `Low-performer density is ${lpPct.toFixed(1)}% — below the 10% threshold` });
    }

    // 4. Manager Quality
    const ratedMgrs = mgrs.filter(m => pRat(m.rating) !== 'NR');
    if (!ratedMgrs.length) {
        riskCategories.push({ name: 'Manager Quality', status: 'nodata', description: 'No manager performance ratings available' });
    } else if (flags.lowRatedManagers.length > 0) {
        riskCategories.push({ name: 'Manager Quality', status: 'high', description: `${flags.lowRatedManagers.length} manager${flags.lowRatedManagers.length !== 1 ? 's' : ''} rated ≤2★` });
    } else if (ratedMgrs.some(m => pRat(m.rating) === 3)) {
        riskCategories.push({ name: 'Manager Quality', status: 'moderate', description: 'Some managers rated 3★ — leadership performance could be stronger' });
    } else {
        riskCategories.push({ name: 'Manager Quality', status: 'healthy', description: 'All rated managers are 4★ or 5★ — leadership is performing well' });
    }

    // 5. Rating Coverage
    const nrPct = real.length ? (rats.NR / real.length) * 100 : 0;
    if (!real.length) {
        riskCategories.push({ name: 'Rating Coverage', status: 'nodata', description: 'No employee data' });
    } else if (nrPct >= 30) {
        riskCategories.push({ name: 'Rating Coverage', status: 'high', description: `${nrPct.toFixed(1)}% of employees unrated — review cycle gaps` });
    } else if (nrPct >= 15) {
        riskCategories.push({ name: 'Rating Coverage', status: 'moderate', description: `${nrPct.toFixed(1)}% of employees unrated` });
    } else {
        riskCategories.push({ name: 'Rating Coverage', status: 'healthy', description: `${(100 - nrPct).toFixed(0)}% of employees have performance ratings on file` });
    }

    // 6. Compensation Equity
    if (!allDepts.length || !allLevels.length) {
        riskCategories.push({ name: 'Compensation Equity', status: 'nodata', description: 'Insufficient data for equity analysis' });
    } else if (flags.compensationEquity.length > 0) {
        riskCategories.push({ name: 'Compensation Equity', status: 'high', description: `${flags.compensationEquity.length} dept/level group${flags.compensationEquity.length !== 1 ? 's' : ''} with >40% salary variance` });
    } else if (hasModVariance) {
        riskCategories.push({ name: 'Compensation Equity', status: 'moderate', description: 'Some dept/level groups show 25–40% salary variance' });
    } else {
        riskCategories.push({ name: 'Compensation Equity', status: 'healthy', description: 'All dept/level groups are within 25% pay variance' });
    }

    // 7. Succession Coverage
    const gapRatio = mgrs.length ? flags.successionGaps.length / mgrs.length : 0;
    if (!mgrs.length) {
        riskCategories.push({ name: 'Succession Coverage', status: 'nodata', description: 'No managers identified' });
    } else if (gapRatio > 0.5) {
        riskCategories.push({ name: 'Succession Coverage', status: 'high', description: `${flags.successionGaps.length} of ${mgrs.length} managers have no high-rated direct report` });
    } else if (gapRatio > 0.25) {
        riskCategories.push({ name: 'Succession Coverage', status: 'moderate', description: `${flags.successionGaps.length} of ${mgrs.length} managers have no 4★+ direct report` });
    } else {
        riskCategories.push({ name: 'Succession Coverage', status: 'healthy', description: `${mgrs.length - flags.successionGaps.length} of ${mgrs.length} managers have at least one high-rated direct report` });
    }

    // 8. Single Points of Failure
    const spofCount = flags.singlePoints.length;
    if (!allDepts.length) {
        riskCategories.push({ name: 'Single Points of Failure', status: 'nodata', description: 'Insufficient data' });
    } else if (spofCount >= 3) {
        riskCategories.push({ name: 'Single Points of Failure', status: 'high', description: `${spofCount} key-person dependencies identified` });
    } else if (spofCount > 0) {
        riskCategories.push({ name: 'Single Points of Failure', status: 'moderate', description: `${spofCount} key-person dependenc${spofCount !== 1 ? 'ies' : 'y'} identified` });
    } else {
        riskCategories.push({ name: 'Single Points of Failure', status: 'healthy', description: 'No sole-occupant dept/level roles with 3+ direct reports' });
    }

    // 9. Department Health
    const highDepts = flags.deptHealth.filter(d => d.avgRating < 2.5);
    const modDepts  = flags.deptHealth.filter(d => d.avgRating >= 2.5);
    if (!allDepts.length) {
        riskCategories.push({ name: 'Department Health', status: 'nodata', description: 'No department data' });
    } else if (highDepts.length > 0) {
        riskCategories.push({ name: 'Department Health', status: 'high', description: `${highDepts.length} department${highDepts.length !== 1 ? 's' : ''} with avg rating below 2.5★` });
    } else if (modDepts.length > 0) {
        riskCategories.push({ name: 'Department Health', status: 'moderate', description: `${modDepts.length} department${modDepts.length !== 1 ? 's' : ''} with avg rating 2.5–3.0★` });
    } else {
        riskCategories.push({ name: 'Department Health', status: 'healthy', description: 'All departments average above 3.0★ in performance ratings' });
    }

    // Derive a simple summary label from high-risk count (for home card, dashboard)
    const highCount = riskCategories.filter(c => c.status === 'high').length;
    const label = highCount === 0 ? 'Healthy' : highCount <= 2 ? 'Needs Attention' : 'Critical Issues';
    const color = highCount === 0 ? 'green'  : highCount <= 2 ? 'amber'           : 'red';

    return { flags, riskCategories, label, color };
}

// ── Home page renderer ──
function renderHome() {
    const real = allData.filter(d => !d.isGhost);
    if (!real.length) return;

    // ── Health score card ──
    const health = orgHealth(real);
    const scoreColor = health.color === 'green' ? 'var(--green)' : health.color === 'amber' ? 'var(--amber)' : 'var(--red)';
    const rc        = health.riskCategories;
    const highCt    = rc.filter(c => c.status === 'high').length;
    const modCt     = rc.filter(c => c.status === 'moderate').length;
    const healthyCt = rc.filter(c => c.status === 'healthy').length;
    const nodataCt  = rc.filter(c => c.status === 'nodata').length;
    const barSegs = [
        highCt    ? `<div style="flex:${highCt};background:#e03e3e;"></div>` : '',
        modCt     ? `<div style="flex:${modCt};background:#f0a500;"></div>` : '',
        healthyCt ? `<div style="flex:${healthyCt};background:#2d9b6f;"></div>` : '',
        nodataCt  ? `<div style="flex:${nodataCt};background:#e5e7eb;"></div>` : '',
    ].join('');
    const countParts = [
        highCt    ? `<span style="color:#e03e3e;">${highCt} High</span>` : '',
        modCt     ? `<span style="color:#f0a500;">${modCt} Moderate</span>` : '',
        healthyCt ? `<span style="color:#2d9b6f;">${healthyCt} Healthy</span>` : '',
    ].filter(Boolean).join('<span style="color:#d1d5db;"> · </span>');
    g('cardHealthScore').innerHTML = `<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;">${barSegs}</div><div style="display:flex;gap:6px;margin-top:5px;font-size:10px;font-weight:700;">${countParts}</div>`;
    g('cardHealthScore').style.color = '';
    g('homeHealthScore').innerText   = health.label;
    g('homeHealthScore').style.color = scoreColor;

    const insightFlags = [];
    health.flags.overExtended.forEach(m => insightFlags.push({ t: `${m.name}: ${m.reportCount} reports`, cls: 'red' }));
    health.flags.lowRatedManagers.forEach(m => insightFlags.push({ t: `Low-rated mgr: ${m.name}`, cls: 'amber' }));
    if (health.flags.missingRatings) insightFlags.push({ t: `${health.flags.missingRatings} missing ratings`, cls: 'amber' });
    health.flags.successionGaps.slice(0, 2).forEach(m => insightFlags.push({ t: `Succession gap: ${m.name}`, cls: 'amber' }));
    health.flags.singlePoints.forEach(m => insightFlags.push({ t: `Key-person risk: ${m.name}`, cls: 'red' }));
    if (!insightFlags.length) insightFlags.push({ t: 'No critical risk signals', cls: 'green' });

    g('cardHealthSub').innerText = health.label === 'Healthy' ? 'Organization is healthy' : health.label === 'Needs Attention' ? 'Some areas need attention' : 'Critical issues detected';
    g('cardHealthList').innerHTML = insightFlags.slice(0, 4).map(f =>
        `<div class="insight-row"><span class="insight-row-lbl">${f.t}</span><span class="insight-row-val ${f.cls}">●</span></div>`
    ).join('');

    // ── Top performers card ──
    const top5 = real.filter(d => pRat(d.rating) === 5);
    g('cardTopCount').innerText = top5.length;
    g('cardTopSub').innerText   = `${((top5.length / real.length) * 100).toFixed(1)}% of workforce rated 5★`;
    // Group by dept
    const topByDept = {};
    top5.forEach(d => { topByDept[d.department] = (topByDept[d.department] || 0) + 1; });
    const topDepts = Object.entries(topByDept).sort((a, b) => b[1] - a[1]).slice(0, 5);
    g('cardTopList').innerHTML = topDepts.map(([dept, n]) =>
        `<div class="insight-row"><span class="insight-row-lbl">${dept}</span><span class="insight-row-val green">${n}</span></div>`
    ).join('');

    // ── Growth card ──
    const yr = new Date(); yr.setFullYear(yr.getFullYear() - 1);
    const r12 = real.filter(d => { const s = new Date(d.startDate); return !isNaN(s) && s >= yr; });
    g('cardGrowthVal').innerText = r12.length;
    const growthPct = real.length ? ((r12.length / real.length) * 100).toFixed(1) : 0;
    g('cardGrowthSub').innerText = `${growthPct}% growth rate (rolling 12m)`;
    // Hires by dept
    const hireByDept = {};
    r12.forEach(d => { hireByDept[d.department] = (hireByDept[d.department] || 0) + 1; });
    const hireDepts = Object.entries(hireByDept).sort((a, b) => b[1] - a[1]).slice(0, 5);
    g('cardGrowthList').innerHTML = hireDepts.map(([dept, n]) =>
        `<div class="insight-row"><span class="insight-row-lbl">${dept}</span><span class="insight-row-val green">${n}</span></div>`
    ).join('');

    // ── Payroll by dept card ──
    const sals = real.map(d => cleanSal(d.salary)).filter(s => s > 0);
    const totalPayroll = sals.reduce((a, b) => a + b, 0);
    g('cardPayrollVal').innerText = fmtM(totalPayroll);
    g('cardPayrollSub').innerText = `Across ${[...new Set(real.map(d => d.department))].length} departments`;
    const payByDept = {};
    real.forEach(d => {
        const s = cleanSal(d.salary);
        if (s > 0) payByDept[d.department] = (payByDept[d.department] || 0) + s;
    });
    const topPayDepts = Object.entries(payByDept).sort((a, b) => b[1] - a[1]).slice(0, 5);
    g('cardPayrollList').innerHTML = topPayDepts.map(([dept, total]) =>
        `<div class="insight-row"><span class="insight-row-lbl">${dept}</span><span class="insight-row-val">${fmtM(total)}</span></div>`
    ).join('');
}

// ── Top-bar panel toggles ──
function toggleDashboard() { showPage('dashboard'); }
function toggleAI()        { g('aiPanel').classList.toggle('open'); }

// ── Org chart department filter ──
function applyOrgDeptFilter(dept) {
    if (!allData.length) return;
    if (!dept) {
        viewData = JSON.parse(JSON.stringify(allData));
        refresh(true);
        return;
    }
    viewData = JSON.parse(JSON.stringify(allData.filter(d => d.department === dept || d.isGhost)));
    const ns = new Set(viewData.map(d => d.id));
    viewData.forEach(d => { if (!ns.has(d.parentId)) d.parentId = 'VIEW_ROOT'; });
    if (!viewData.find(d => d.id === 'VIEW_ROOT')) {
        viewData.push({ id: 'VIEW_ROOT', name: dept, isGhost: true, parentId: null });
    }
    refresh(true);
}

// ── Full reset (called by csv.js on file load) ──
function resetAll() {
    dragUndoStack = []; dragRedoStack = [];
    if (g('undoBtn')) g('undoBtn').style.display = 'none';
    closeSpot();
    if (allData.length) { viewData = JSON.parse(JSON.stringify(allData)); refresh(true); }
}

// ── Initialisation ──
Chart.register(ChartDataLabels);
initFileInput();

// Auto-load sample data on startup
(function () {
    if (typeof SAMPLE_DATA === 'undefined') {
        console.error('[Canopy] SAMPLE_DATA is not defined — js/sampleData.js may not have loaded');
        return;
    }
    console.log('[Canopy] SAMPLE_DATA loaded:', SAMPLE_DATA.length, 'records');

    try {
        allData = SAMPLE_DATA.map(d => ({ ...d, parentId: d.parentId === null ? 'ROOT' : d.parentId }));
        allData.push({ id: 'ROOT', name: 'Organization', isGhost: true, parentId: null });
        deptCol = {};
        [...new Set(allData.filter(d => d.department).map(d => d.department))]
            .forEach((d, i) => { deptCol[d] = PAL[i % PAL.length]; });
        viewData = JSON.parse(JSON.stringify(allData));
        g('demoBadge').style.display = 'inline-flex';
        console.log('[Canopy] allData:', allData.length, '| viewData:', viewData.length, '| depts:', Object.keys(deptCol).length);
    } catch (e) {
        console.error('[Canopy] Error building sample data:', e);
        return;
    }

    // Defer render to requestAnimationFrame so the browser has completed its
    // first layout pass and the chart container has non-zero dimensions.
    requestAnimationFrame(function () {
        try {
            refresh(true);
            updateAIStatus();
            renderHome();   // populate home page insight cards
            console.log('[Canopy] Chart rendered with sample data');
        } catch (e) {
            console.error('[Canopy] refresh() failed:', e);
        }
    });
})();

// Hide demo badge when real CSV is uploaded
g('fileInput').addEventListener('change', function () {
    g('demoBadge').style.display = 'none';
});

// ── Scenario public API (callable from console or future UI) ──
// Usage:
//   Canopy.saveScenario('Reorg Q3', 'Sales team restructure')  → returns id
//   Canopy.loadScenario(id)   — switches to the scenario
//   Canopy.exitScenario()     — returns to live data
//   Canopy.deleteScenario(id) — removes it from localStorage
//   Canopy.listScenarios()    → returns array of { id, name, createdAt, description }
//   Canopy.undoLastMove()     — undo last drag (also works in scenarios)
//   Canopy.redoLastMove()     — redo last undone drag
window.Canopy = {
    saveScenario:   (name, desc) => saveScenario(name, desc),
    loadScenario:   (id)         => loadScenario(id),
    exitScenario:   ()           => exitScenario(),
    deleteScenario: (id)         => deleteScenario(id),
    listScenarios:  ()           => Object.values(scenarios).map(({ id, name, createdAt, description }) => ({ id, name, createdAt, description })),
    undoLastMove:   ()           => undoLastMove(),
    redoLastMove:   ()           => redoLastMove(),
    getState:       ()           => ({ isScenarioMode, currentScenarioId, employees: allData.filter(d => !d.isGhost).length }),
};

