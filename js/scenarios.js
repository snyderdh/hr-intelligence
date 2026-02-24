// ── Scenario Studio — UI layer ──
// Depends on: state.js (scenarios, isScenarioMode, scenarioHistory, scenarioRedoStack,
//             saveScenario, loadScenario, deleteScenario, exitScenarioMode, persistScenarios)

// ════════════════════════════════════════════════
//  PANEL TOGGLE
// ════════════════════════════════════════════════

function toggleScenarioStudio() {
    const panel = g('scnPanel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) renderScenarioList();
}

// ════════════════════════════════════════════════
//  SCENARIO LIST
// ════════════════════════════════════════════════

function renderScenarioList() {
    const list = g('scnList');
    const ids  = Object.keys(scenarios);

    g('scnCompareBtn').style.display = ids.length >= 2 ? 'flex' : 'none';

    if (!ids.length) {
        list.innerHTML = '<div class="scn-empty">No saved scenarios yet.<br>Load a CSV and click <strong>+ New Scenario</strong> to start.</div>';
        return;
    }

    list.innerHTML = ids.map(id => {
        const scn      = scenarios[id];
        const isActive = id === currentScenarioId;
        const empCount = scn.data.filter(d => !d.isGhost).length;
        const date     = new Date(scn.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `
        <div class="scn-card${isActive ? ' active' : ''}">
            <div class="scn-card-body">
                <div class="scn-card-name">
                    ${scn.name}
                    ${isActive ? '<span class="scn-active-badge">Active</span>' : ''}
                </div>
                <div class="scn-card-meta">${date} · ${empCount} employees</div>
                ${scn.description ? `<div class="scn-card-desc">${scn.description}</div>` : ''}
            </div>
            <div class="scn-card-actions">
                <button class="btn btn-blue" onclick="scnLoad('${id}')">Load</button>
                <button class="btn btn-gray" onclick="scnDelete('${id}')">Delete</button>
            </div>
        </div>`;
    }).join('');
}

// ════════════════════════════════════════════════
//  LOAD / DELETE
// ════════════════════════════════════════════════

function scnLoad(id) {
    if (!allData.filter(d => !d.isGhost).length && !scenarios[id]) return;
    if (loadScenario(id)) {
        refresh(true);
        updateScenarioBanner();
        renderScenarioList();
    }
}

function scnDelete(id) {
    const scn = scenarios[id];
    if (!scn) return;
    if (!confirm(`Delete scenario "${scn.name}"? This cannot be undone.`)) return;
    if (currentScenarioId === id) scnExitToLive();
    deleteScenario(id);
    renderScenarioList();
}

function scnExitToLive() {
    exitScenarioMode();
    dragUndoStack = [];
    g('undoBtn').style.display = 'none';
    refresh(true);
    updateScenarioBanner();
    renderScenarioList();
}

// ════════════════════════════════════════════════
//  NEW SCENARIO FORM
// ════════════════════════════════════════════════

function showNewScnForm() {
    g('scnFormWrap').style.display = 'block';
    g('scnNameInput').focus();
}

function hideNewScnForm() {
    g('scnFormWrap').style.display  = 'none';
    g('scnNameInput').value         = '';
    g('scnDescInput').value         = '';
}

function saveNewScenario() {
    const name = g('scnNameInput').value.trim();
    if (!name) { g('scnNameInput').focus(); return; }
    if (!allData.filter(d => !d.isGhost).length) {
        alert('Load a CSV file first — a scenario captures the current org state.');
        return;
    }
    saveScenario(name, g('scnDescInput').value);
    hideNewScnForm();
    renderScenarioList();
}

// ════════════════════════════════════════════════
//  SCENARIO BANNER (below toolbar when active)
// ════════════════════════════════════════════════

function updateScenarioBanner() {
    const banner = g('scnBanner');
    if (!banner) return;

    if (!isScenarioMode) {
        banner.style.display = 'none';
        return;
    }

    banner.style.display = 'flex';
    const scn = scenarios[currentScenarioId];
    g('scnBannerName').textContent = scn ? scn.name : 'Untitled Scenario';

    // Enable/disable undo/redo
    g('scnUndoBtn').disabled = scenarioHistory.length === 0;
    g('scnRedoBtn').disabled = scenarioRedoStack.length === 0;
}

// ════════════════════════════════════════════════
//  SCENARIO UNDO / REDO
// ════════════════════════════════════════════════

function scnUndo() {
    if (!isScenarioMode || !scenarioHistory.length) return;
    const entry = scenarioHistory.pop();
    scenarioRedoStack.push(entry);
    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === entry.employeeId);
        if (n) n.parentId = entry.previousParentId;
    });
    if (scenarios[currentScenarioId]) {
        scenarios[currentScenarioId].data = JSON.parse(JSON.stringify(allData));
        persistScenarios();
    }
    refresh(false);
    updateScenarioBanner();
}

function scnRedo() {
    if (!isScenarioMode || !scenarioRedoStack.length) return;
    const entry = scenarioRedoStack.pop();
    scenarioHistory.push(entry);
    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === entry.employeeId);
        if (n) n.parentId = entry.newParentId;
    });
    if (scenarios[currentScenarioId]) {
        scenarios[currentScenarioId].data = JSON.parse(JSON.stringify(allData));
        persistScenarios();
    }
    refresh(false);
    updateScenarioBanner();
}

function scnSaveChanges() {
    if (!isScenarioMode || !currentScenarioId) return;
    scenarios[currentScenarioId].data = JSON.parse(JSON.stringify(allData));
    persistScenarios();
    // Brief visual feedback on the button
    const btn = g('scnSaveBtn');
    const orig = btn.textContent;
    btn.textContent = '✓ Saved';
    btn.style.background = 'rgba(45,155,111,0.15)';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1800);
}

// ════════════════════════════════════════════════
//  COMPARISON MODAL  (Prompt 4)
// ════════════════════════════════════════════════

function openCompareModal() {
    g('compareModal').style.display = 'flex';
    populateCompareDropdowns();
    runComparison();
}

function closeCompareModal() {
    g('compareModal').style.display = 'none';
}

function populateCompareDropdowns() {
    const liveOpt = '<option value="__live__">Live Data</option>';
    const scnOpts = Object.values(scenarios)
        .map(s => `<option value="${s.id}">${s.name}</option>`)
        .join('');
    const opts = liveOpt + scnOpts;
    g('compareLeft').innerHTML  = opts;
    g('compareRight').innerHTML = opts;

    // Default: first two options
    const ids = Object.keys(scenarios);
    if (ids.length >= 2) {
        g('compareLeft').value  = ids[0];
        g('compareRight').value = ids[1];
    } else if (ids.length === 1) {
        g('compareLeft').value  = '__live__';
        g('compareRight').value = ids[0];
    }
}

function getCompareData(val) {
    if (val === '__live__') {
        return (baselineData.length ? baselineData : allData).filter(d => !d.isGhost);
    }
    const scn = scenarios[val];
    return scn ? scn.data.filter(d => !d.isGhost) : [];
}

function getCompareLabel(val) {
    if (val === '__live__') return 'Live Data';
    return scenarios[val]?.name || '—';
}

function computeMetrics(data) {
    const sals   = data.map(d => cleanSal(d.salary)).filter(s => s > 0);
    const total  = sals.reduce((a, b) => a + b, 0);
    const mgrs   = data.filter(d => data.some(e => e.parentId === d.id));
    const ics    = data.length - mgrs.length;
    const span   = mgrs.length > 0 ? ics / mgrs.length : 0;
    const depts  = new Set(data.map(d => d.department).filter(Boolean));
    return {
        headcount:    data.length,
        payroll:      total,
        avgSalary:    sals.length ? total / sals.length : 0,
        deptCount:    depts.size,
        managerCount: mgrs.length,
        avgSpan:      span,
    };
}

function runComparison() {
    const lv = g('compareLeft').value;
    const rv = g('compareRight').value;
    const ld = getCompareData(lv);
    const rd = getCompareData(rv);
    const ll = getCompareLabel(lv);
    const rl = getCompareLabel(rv);

    g('compareLeftHead').textContent  = ll;
    g('compareRightHead').textContent = rl;

    const lm = computeMetrics(ld);
    const rm = computeMetrics(rd);

    const rows = [
        { label: 'Total Headcount',      lv: lm.headcount,    rv: rm.headcount,    fmt: v => v,         higherIsBetter: true  },
        { label: 'Total Payroll',        lv: lm.payroll,      rv: rm.payroll,      fmt: v => fmtM(v),   higherIsBetter: false },
        { label: 'Avg Salary',           lv: lm.avgSalary,    rv: rm.avgSalary,    fmt: v => fmtK(v),   higherIsBetter: null  },
        { label: 'Dept Count',           lv: lm.deptCount,    rv: rm.deptCount,    fmt: v => v,         higherIsBetter: null  },
        { label: 'Manager Count',        lv: lm.managerCount, rv: rm.managerCount, fmt: v => v,         higherIsBetter: null  },
        { label: 'Avg Span of Control',  lv: lm.avgSpan,      rv: rm.avgSpan,      fmt: v => v.toFixed(1), higherIsBetter: true },
    ];

    g('compareDiffBody').innerHTML = rows.map(row => {
        const delta   = row.rv - row.lv;
        let deltaText, deltaClass;
        if (Math.abs(delta) < 0.005) {
            deltaText  = '—';
            deltaClass = 'delta-same';
        } else {
            const sign = delta > 0 ? '+' : '−';
            const abs  = Math.abs(delta);
            if (row.label.includes('Payroll') || row.label.includes('Salary')) {
                deltaText = sign + fmtK(abs);
            } else if (row.label.includes('Span')) {
                deltaText = sign + abs.toFixed(1);
            } else {
                deltaText = sign + Math.round(abs);
            }
            if (row.higherIsBetter === null) {
                deltaClass = 'delta-neutral';
            } else {
                const improved = row.higherIsBetter ? delta > 0 : delta < 0;
                deltaClass = improved ? 'delta-good' : 'delta-bad';
            }
        }
        return `<tr>
            <td class="diff-label">${row.label}</td>
            <td class="diff-val">${row.fmt(row.lv)}</td>
            <td class="diff-val">${row.fmt(row.rv)}</td>
            <td class="diff-delta ${deltaClass}">${deltaText}</td>
        </tr>`;
    }).join('');

    buildChangesList(ld, rd, ll, rl);
    // Store for CSV export
    window._lastCompare = { ld, rd, ll, rl, lm, rm, rows };
}

function buildChangesList(ld, rd) {
    const lMap = new Map(ld.map(d => [d.id, d]));
    const rMap = new Map(rd.map(d => [d.id, d]));

    const moved   = [];
    const added   = [];
    const removed = [];

    rd.forEach(emp => {
        const old = lMap.get(emp.id);
        if (!old) {
            added.push(emp.name);
        } else if (old.parentId !== emp.parentId) {
            moved.push({
                name: emp.name,
                from: old.parentId === 'ROOT' ? 'Top Level' : old.parentId,
                to:   emp.parentId === 'ROOT' ? 'Top Level' : emp.parentId,
            });
        }
    });

    ld.forEach(emp => {
        if (!rMap.has(emp.id)) removed.push(emp.name);
    });

    const list = g('compareChangesList');
    if (!moved.length && !added.length && !removed.length) {
        list.innerHTML = '<div class="changes-empty">No structural changes between these two views.</div>';
        return;
    }

    list.innerHTML = [
        ...moved.map(c =>
            `<div class="change-row">
                <span class="change-name">${c.name}</span>
                <span class="change-arrow">→</span>
                <span class="change-detail">moved from <em>${c.from}</em> to <em>${c.to}</em></span>
            </div>`),
        ...added.map(n =>
            `<div class="change-row added">
                <span class="change-name">${n}</span>
                <span class="change-badge added-badge">Added</span>
            </div>`),
        ...removed.map(n =>
            `<div class="change-row removed">
                <span class="change-name">${n}</span>
                <span class="change-badge removed-badge">Removed</span>
            </div>`),
    ].join('');
}

// ── Export comparison as CSV ──
function exportComparisonCSV() {
    const c = window._lastCompare;
    if (!c) return;

    let csv = `Canopy Scenario Comparison: "${c.ll}" vs "${c.rl}"\n\n`;
    csv += 'Metric,' + c.ll + ',' + c.rl + ',Delta\n';
    c.rows.forEach(row => {
        const delta = row.rv - row.lv;
        const sign  = delta > 0 ? '+' : '';
        csv += `"${row.label}",${row.fmt(row.lv)},${row.fmt(row.rv)},${delta === 0 ? '—' : sign + (Number.isInteger(row.lv) ? Math.round(delta) : delta.toFixed(2))}\n`;
    });

    csv += '\nManager Changes\nEmployee,From,To\n';
    const lMap = new Map(c.ld.map(d => [d.id, d]));
    c.rd.forEach(emp => {
        const old = lMap.get(emp.id);
        if (old && old.parentId !== emp.parentId) {
            const from = old.parentId === 'ROOT' ? 'Top Level' : old.parentId;
            const to   = emp.parentId === 'ROOT' ? 'Top Level' : emp.parentId;
            csv += `"${emp.name}","${from}","${to}"\n`;
        }
    });

    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `scenario_comparison_${Date.now()}.csv`;
    a.click();
}
