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
    // Clear node highlights
    document.querySelectorAll('[data-nid]').forEach(function (card) {
        card.style.opacity    = '';
        card.style.boxShadow  = '';
        card.style.transform  = '';
        card.style.zIndex     = '';
        card.style.transition = '';
    });
    if (g('dDept'))      g('dDept').value      = '';
    if (g('dMgr'))       g('dMgr').value       = '';
    if (g('filterMode')) g('filterMode').value  = 'none';
    if (g('filterVal'))  g('filterVal').value   = '';
    if (typeof toggleFilterUI === 'function') toggleFilterUI();
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
    let score = 100;
    const penalties = [];
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

    // ── Avg tenure penalty ──
    const tens = real.map(tenYrs).filter(v => v !== null);
    const avgT = tens.length ? tens.reduce((a, b) => a + b, 0) / tens.length : 0;
    if (avgT < 1) {
        score -= 18;
        penalties.push({ category: 'Tenure Risk', description: `Avg tenure ${avgT.toFixed(1)} yrs — critical attrition risk`, impact: -18 });
        flags.tenureRisk = { avgT, level: 'critical' };
    } else if (avgT < 2) {
        score -= 10;
        penalties.push({ category: 'Tenure Risk', description: `Avg tenure ${avgT.toFixed(1)} yrs — below healthy baseline`, impact: -10 });
        flags.tenureRisk = { avgT, level: 'warning' };
    } else if (avgT < 3) {
        score -= 5;
        penalties.push({ category: 'Tenure Risk', description: `Avg tenure ${avgT.toFixed(1)} yrs — slightly below average`, impact: -5 });
        flags.tenureRisk = { avgT, level: 'low' };
    }

    // ── Span of control ──
    const mgrs = real.filter(d => real.some(e => e.parentId === d.id));
    let spanPenalty = 0;
    mgrs.forEach(m => {
        const n = real.filter(d => d.parentId === m.id).length;
        if (n >= 12) {
            flags.overExtended.push({ name: m.name, title: m.title, dept: m.department, reportCount: n });
            spanPenalty += 8;
        } else if (n >= 9) {
            flags.wideSpan.push({ name: m.name, title: m.title, dept: m.department, reportCount: n });
            spanPenalty += 3;
        }
    });
    if (spanPenalty > 0) {
        score -= spanPenalty;
        penalties.push({ category: 'Span of Control', description: `${flags.overExtended.length} over-extended, ${flags.wideSpan.length} wide-span manager${flags.wideSpan.length !== 1 ? 's' : ''}`, impact: -spanPenalty });
    }

    // ── Low performers & missing ratings ──
    const rats = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, NR: 0 };
    real.forEach(d => { const r = pRat(d.rating); if (r in rats) rats[r]++; });
    flags.missingRatings = rats.NR || 0;

    const lowPerf = (rats[1] || 0) + (rats[2] || 0);
    const lpPct   = real.length ? (lowPerf / real.length) * 100 : 0;
    if (lpPct >= 20) {
        score -= 14;
        penalties.push({ category: 'Performance Concentration', description: `${lpPct.toFixed(1)}% rated ≤2★ — high low-performer density`, impact: -14 });
        flags.perfConcentration.push({ type: 'low', pct: lpPct, count: lowPerf });
    } else if (lpPct >= 10) {
        score -= 7;
        penalties.push({ category: 'Performance Concentration', description: `${lpPct.toFixed(1)}% rated ≤2★ — elevated low-performer share`, impact: -7 });
        flags.perfConcentration.push({ type: 'low', pct: lpPct, count: lowPerf });
    }

    const nrPct = real.length ? (rats.NR / real.length) * 100 : 0;
    if (nrPct >= 30) {
        score -= 10;
        penalties.push({ category: 'Missing Ratings', description: `${nrPct.toFixed(1)}% of employees unrated — review cycle gaps`, impact: -10 });
    } else if (nrPct >= 15) {
        score -= 5;
        penalties.push({ category: 'Missing Ratings', description: `${nrPct.toFixed(1)}% of employees unrated`, impact: -5 });
    }

    // ── Low-rated managers ──
    mgrs.forEach(m => {
        const r = pRat(m.rating);
        if (r !== 'NR' && r <= 2) flags.lowRatedManagers.push({ name: m.name, title: m.title, dept: m.department, rating: r });
    });
    if (flags.lowRatedManagers.length) {
        const lrmPenalty = flags.lowRatedManagers.length * 6;
        score -= lrmPenalty;
        penalties.push({ category: 'Low-Rated Managers', description: `${flags.lowRatedManagers.length} manager${flags.lowRatedManagers.length !== 1 ? 's' : ''} rated ≤2★`, impact: -lrmPenalty });
    }

    // ── Compensation equity (max -15) ──
    const allDepts  = [...new Set(real.map(d => d.department).filter(Boolean))];
    const allLevels = [...new Set(real.map(d => d.jobLevel).filter(Boolean))];
    const equityGroups = [];
    allDepts.forEach(dept => {
        allLevels.forEach(level => {
            const grp  = real.filter(d => d.department === dept && d.jobLevel === level);
            if (grp.length < 2) return;
            const sals = grp.map(d => cleanSal(d.salary)).filter(s => s > 0);
            if (sals.length < 2) return;
            const minSal  = Math.min(...sals);
            const maxSal  = Math.max(...sals);
            if (minSal <= 0) return;
            const variance = maxSal / minSal;
            if (variance > 1.4) equityGroups.push({ dept, level, minSal, maxSal, variance });
        });
    });
    flags.compensationEquity = equityGroups;
    const equityPenalty = Math.min(equityGroups.length * 5, 15);
    if (equityPenalty > 0) {
        score -= equityPenalty;
        penalties.push({ category: 'Compensation Equity', description: `${equityGroups.length} dept/level group${equityGroups.length !== 1 ? 's' : ''} with >40% salary variance`, impact: -equityPenalty });
    }

    // ── Succession gaps (max -12) ──
    const successionGaps = [];
    mgrs.forEach(m => {
        const reports      = real.filter(d => d.parentId === m.id);
        const hasHighRated = reports.some(d => { const r = pRat(d.rating); return r !== 'NR' && r >= 4; });
        if (!hasHighRated) successionGaps.push({ name: m.name, title: m.title, dept: m.department, reportCount: reports.length });
    });
    flags.successionGaps = successionGaps;
    const successionPenalty = Math.min(successionGaps.length * 3, 12);
    if (successionPenalty > 0) {
        score -= successionPenalty;
        penalties.push({ category: 'Succession Gaps', description: `${successionGaps.length} manager${successionGaps.length !== 1 ? 's' : ''} with no high-rated direct reports`, impact: -successionPenalty });
    }

    // ── Single points of failure (max -10) ──
    const singlePoints = [];
    allDepts.forEach(dept => {
        allLevels.forEach(level => {
            const grp = real.filter(d => d.department === dept && d.jobLevel === level);
            if (grp.length !== 1) return;
            const emp         = grp[0];
            const reportCount = real.filter(d => d.parentId === emp.id).length;
            if (reportCount >= 3) singlePoints.push({ name: emp.name, title: emp.title, dept: emp.department, jobLevel: emp.jobLevel, reportCount });
        });
    });
    flags.singlePoints = singlePoints;
    const spofPenalty = Math.min(singlePoints.length * 5, 10);
    if (spofPenalty > 0) {
        score -= spofPenalty;
        penalties.push({ category: 'Single Points of Failure', description: `${singlePoints.length} key-person dependenc${singlePoints.length !== 1 ? 'ies' : 'y'} identified`, impact: -spofPenalty });
    }

    // ── Department health (max -8) ──
    const deptHealthFlags = [];
    allDepts.forEach(dept => {
        const de    = real.filter(d => d.department === dept);
        const rated = de.filter(d => { const r = pRat(d.rating); return r !== 'NR'; });
        if (!rated.length) return;
        const avgRating = rated.reduce((s, d) => s + pRat(d.rating), 0) / rated.length;
        if (avgRating < 2.5) deptHealthFlags.push({ dept, avgRating, headcount: de.length });
    });
    flags.deptHealth = deptHealthFlags;
    const deptHealthPenalty = Math.min(deptHealthFlags.length * 4, 8);
    if (deptHealthPenalty > 0) {
        score -= deptHealthPenalty;
        penalties.push({ category: 'Department Health', description: `${deptHealthFlags.length} department${deptHealthFlags.length !== 1 ? 's' : ''} with avg rating below 2.5★`, impact: -deptHealthPenalty });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const label = score >= 80 ? 'Healthy' : score >= 60 ? 'Needs Attention' : 'Critical';
    const color = score >= 80 ? 'green' : score >= 60 ? 'amber' : 'red';

    return { score, label, color, penalties, flags };
}

// ── Home page renderer ──
function renderHome() {
    const real = allData.filter(d => !d.isGhost);
    if (!real.length) return;

    // ── Health score card ──
    const health = orgHealth(real);
    const score  = health.score;
    const scoreColor = health.color === 'green' ? 'var(--green)' : health.color === 'amber' ? 'var(--amber)' : 'var(--red)';
    g('cardHealthScore').innerText = score + '/100';
    g('cardHealthScore').style.color = scoreColor;
    g('homeHealthScore').innerText   = score + '/100';
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
function toggleControls() {
    g('controlStrip').classList.toggle('hidden');
    setTimeout(() => { if (allData.length) orgC.render().fit(); }, 350);
}

function toggleDashboard() { showPage('dashboard'); }
function toggleAI()        { g('aiPanel').classList.toggle('open'); }

// ── Bulk-action bubble tags ──
function renderTags() {
    const box = g('bubbleBox');
    box.querySelectorAll('.tag-bubble').forEach(b => b.remove());
    tags.forEach(t => {
        const b = document.createElement('div');
        b.className = 'tag-bubble';
        b.innerHTML = `${t} <span class="tag-remove" onclick="rmTag('${t.replace(/'/g, "\\'")}')">×</span>`;
        box.insertBefore(b, g('editTarget'));
    });
}

window.rmTag = id => { tags = tags.filter(t => t !== id); renderTags(); };

// ── Filter panel UI ──
function toggleFilterUI() {
    g('filterUI').style.display = g('filterMode').value === 'none' ? 'none' : 'block';
}

// ── Edit panel UI ──
function toggleEditUI() {
    const mode = g('editMode').value;
    g('destList').innerHTML = '';
    g('editUI').style.display       = mode === 'none' ? 'none' : 'block';
    g('bubbleSys').style.display    = mode === 'hire' ? 'none' : 'block';
    g('hireFields').style.display   = mode === 'hire' ? 'block' : 'none';
    g('editDest').style.display     = mode === 'delete' ? 'none' : 'block';
    g('editDest').placeholder       = mode === 'deptUpdate' ? 'Select department…' : 'Select reporting manager…';

    if (mode === 'move' || mode === 'hire') {
        allData.filter(d => !d.isGhost).forEach(m => {
            const o = document.createElement('option');
            o.value = m.id;
            g('destList').appendChild(o);
        });
    } else if (mode === 'deptUpdate') {
        [...new Set(allData.filter(d => !d.isGhost).map(d => d.department))].forEach(d => {
            const o = document.createElement('option');
            o.value = d;
            g('destList').appendChild(o);
        });
    }
}

// ── Execute bulk edit ──
function runEdit() {
    const mode = g('editMode').value;
    const dest = g('editDest').value;

    if (mode === 'hire') {
        const hN = g('hireName').value.trim();
        if (!hN) { alert('Please enter a name.'); return; }
        const mgr = allData.find(d => d.id === dest);
        allData.push({
            id: hN, name: hN, title: 'Draft Hire',
            parentId: dest || 'ROOT',
            department: mgr ? mgr.department : 'Unassigned',
            salary: g('hireSal').value || 0,
            startDate: new Date().toLocaleDateString(),
            rating: 'NR',
            jobLevel: g('hireLevel').value || 'IC1',
            email: '', city: '', state: '',
        });
    } else {
        tags.forEach(name => {
            const t = allData.find(d => d.id === name);
            if (!t) return;
            if (mode === 'move')            t.parentId   = dest;
            else if (mode === 'deptUpdate') t.department = dest;
            else if (mode === 'delete') {
                allData.filter(d => d.parentId === t.id).forEach(r => r.parentId = t.parentId);
                allData = allData.filter(d => d.id !== name);
            }
        });
    }
    resetAll();
}

// ── Filter / view ──
function applyFilter() {
    const mode = g('filterMode').value;
    const val  = g('filterVal').value;
    if (!val || !allData.length) return;

    if (mode === 'team') {
        const root = allData.find(d => d.id === val);
        if (!root) return;
        const sub = [root];
        const kids = id => allData.forEach(d => { if (d.parentId === id) { sub.push(d); kids(d.id); } });
        kids(val);
        viewData = JSON.parse(JSON.stringify(sub));
        viewData.find(d => d.id === val).parentId = null;
        refresh();
        orgC.setCentered(val).render();
    } else {
        viewData = JSON.parse(JSON.stringify(allData.filter(d => d.department === val)));
        const ns = new Set(viewData.map(d => d.id));
        viewData.forEach(d => { if (!ns.has(d.parentId)) d.parentId = 'VIEW_ROOT'; });
        viewData.push({ id: 'VIEW_ROOT', name: val, isGhost: true, parentId: null });
        refresh(true);
    }
}

// ── Full reset ──
function resetAll() {
    tags = []; renderTags();
    dragUndoStack = []; g('undoBtn').style.display = 'none';
    ['globalSearch', 'filterVal', 'editTarget', 'editDest', 'dDept', 'dMgr', 'hireName', 'hireSal']
        .forEach(id => { if (g(id)) g(id).value = ''; });
    g('filterMode').value = 'none';
    g('editMode').value   = 'none';
    toggleEditUI();
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

// Bubble-tag input: add tag when employee id matched
g('editTarget').addEventListener('input', function (e) {
    const v   = e.target.value;
    const emp = allData.find(d => d.id === v);
    if (emp && !tags.includes(v)) {
        tags.push(v);
        renderTags();
        e.target.value = '';
    }
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

