// ── Scenario Studio ──
// Full-page scenario planner with Planner and Compare sub-views.
// Requires: state.js (scenarios, saveScenario, loadScenario, exitScenario,
//           dragUndoStack, dragRedoStack), drag.js, chart.js

var _ssView = 'planner';   // 'planner' | 'compare'
var orgCS   = null;        // d3.OrgChart instance for Scenario Studio

// ── Smart refresh: routes to the correct refresh function based on active page ──
window._smartRefresh = function (fit) {
    var ssPage = document.getElementById('pageScenarioStudio');
    if (ssPage && ssPage.classList.contains('active')) {
        ssRefresh(fit || false);
    } else {
        refresh(fit || false);
    }
};

// ── HTML-escape helper ──
function _ssEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Compute org metrics from a data array ──
function _ssMet(data) {
    var real = data.filter(function (d) { return !d.isGhost; });
    var headcount = real.length;
    var payroll   = real.reduce(function (s, d) { return s + cleanSal(d.salary); }, 0);
    var avgSal    = headcount ? payroll / headcount : 0;
    var deptCount = new Set(real.map(function (d) { return d.department; }).filter(Boolean)).size;
    var repCts    = {};
    real.forEach(function (d) {
        if (d.parentId) repCts[d.parentId] = (repCts[d.parentId] || 0) + 1;
    });
    var managers  = real.filter(function (d) { return repCts[d.id]; });
    var totalReps = managers.reduce(function (s, m) { return s + repCts[m.id]; }, 0);
    var span      = managers.length ? totalReps / managers.length : 0;
    return { headcount: headcount, payroll: payroll, avgSal: avgSal,
             deptCount: deptCount, managerCount: managers.length, span: span };
}

// ── Personnel changes between two datasets ──
function _ssDiff(dataA, dataB) {
    var mA = {}, mB = {};
    dataA.filter(function (d) { return !d.isGhost && d.id; }).forEach(function (d) { mA[d.id] = d; });
    dataB.filter(function (d) { return !d.isGhost && d.id; }).forEach(function (d) { mB[d.id] = d; });
    var changes = [];
    Object.values(mB).forEach(function (b) {
        var a = mA[b.id];
        if (!a || a.parentId === b.parentId) return;
        var oldMgr = a.parentId ? ((mA[a.parentId] || {}).name || a.parentId) : 'None';
        var newMgr = b.parentId ? ((mB[b.parentId] || mA[b.parentId] || {}).name || b.parentId) : 'None';
        changes.push({ name: b.name || b.id, oldMgr: oldMgr, newMgr: newMgr });
    });
    return changes;
}

// ── Delta formatters ──
function _ssDInt(d) {
    if (!d) return '<span class="ss-dz">\u2014</span>';
    return '<span class="' + (d > 0 ? 'ss-dp' : 'ss-dn') + '">' + (d > 0 ? '+' : '\u2212') + Math.abs(Math.round(d)).toLocaleString() + '</span>';
}
function _ssDMon(d, fmt) {
    if (!d) return '<span class="ss-dz">\u2014</span>';
    return '<span class="' + (d > 0 ? 'ss-dp' : 'ss-dn') + '">' + (d > 0 ? '+' : '\u2212') + fmt(Math.abs(d)) + '</span>';
}
function _ssDDec(d) {
    if (!d) return '<span class="ss-dz">\u2014</span>';
    return '<span class="' + (d > 0 ? 'ss-dp' : 'ss-dn') + '">' + (d > 0 ? '+' : '\u2212') + Math.abs(d).toFixed(1) + '</span>';
}

// ── Update undo/redo button disabled state ──
function _ssUpdateUndoRedo() {
    var u = document.getElementById('ssUndoBtn');
    var r = document.getElementById('ssRedoBtn');
    if (u) u.disabled = !dragUndoStack.length;
    if (r) r.disabled = !dragRedoStack.length;
}

// ── Update toolbar (mode tag, exit button, scenario select) ──
function _ssUpdateToolbar() {
    var tag  = document.getElementById('ssModeTag');
    var exit = document.getElementById('ssExitBtn');
    if (tag) {
        var sc = isScenarioMode ? scenarios[currentScenarioId] : null;
        tag.textContent = sc ? sc.name : 'Live Data';
        tag.className   = 'ss-mode-tag ' + (isScenarioMode ? 'ss-scenario' : 'ss-live');
    }
    if (exit) exit.style.display = isScenarioMode ? 'inline-flex' : 'none';
    _ssUpdateUndoRedo();
    _ssPopulateScenarioSelect();
}

// ── Populate scenario dropdown ──
function _ssPopulateScenarioSelect() {
    var sel = document.getElementById('ssScenarioSel');
    if (!sel) return;
    var ids = Object.keys(scenarios).sort(function (a, b) {
        return new Date(scenarios[b].createdAt) - new Date(scenarios[a].createdAt);
    });
    sel.innerHTML = '<option value="">\u2014 Select scenario \u2014</option>'
        + ids.map(function (id) {
            return '<option value="' + _ssEsc(id) + '"'
                + (id === currentScenarioId ? ' selected' : '') + '>'
                + _ssEsc(scenarios[id].name) + '</option>';
        }).join('');
}

// ── Financial impact panel ──
function _ssUpdateFinancial() {
    var el = document.getElementById('ssFinancial');
    if (!el) return;

    if (!isScenarioMode || !_liveDataSnapshot) {
        el.innerHTML = '<div class="ss-panel-hd">Financial Impact</div>'
            + '<div class="ss-panel-empty">Load a scenario to see financial impact vs. baseline.</div>';
        return;
    }

    var mL = _ssMet(_liveDataSnapshot);
    var mS = _ssMet(allData);
    var payDelta  = mS.payroll  - mL.payroll;
    var hcDelta   = mS.headcount - mL.headcount;
    var avgDelta  = mS.avgSal   - mL.avgSal;
    var spanDelta = mS.span     - mL.span;

    var payCol  = payDelta < 0 ? 'var(--green)' : payDelta > 0 ? 'var(--red)' : 'var(--muted)';
    var payStr  = payDelta === 0 ? '<span class="ss-dz">\u2014</span>'
                : '<span style="color:' + payCol + ';">' + (payDelta > 0 ? '+' : '\u2212') + fmtK(Math.abs(payDelta)) + '</span>';

    el.innerHTML = '<div class="ss-panel-hd">Financial Impact</div>'
        + '<div class="ss-fin-grid">'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Payroll Delta</span><span class="ss-fin-val">' + payStr + '</span></div>'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Headcount</span><span class="ss-fin-val">' + _ssDInt(hcDelta) + ' (' + mS.headcount + ' total)</span></div>'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Avg Salary</span><span class="ss-fin-val">' + _ssDMon(avgDelta, fmtK) + ' (' + fmtK(mS.avgSal) + ' now)</span></div>'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Avg Span</span><span class="ss-fin-val">' + _ssDDec(spanDelta) + ' (' + mS.span.toFixed(1) + ' now)</span></div>'
        + '<div class="ss-fin-annot">vs. live baseline \u00b7 ' + mL.headcount + ' employees</div>'
        + '</div>';
}

// ── Change log panel ──
function _ssUpdateChangeLog() {
    var el = document.getElementById('ssChangeLog');
    if (!el) return;

    var count = dragUndoStack.length;
    if (!count) {
        el.innerHTML = '<div class="ss-panel-hd">Change Log</div>'
            + '<div class="ss-panel-empty">Drag employees to reassign. Changes appear here.</div>';
        return;
    }

    var items = dragUndoStack.slice().reverse().map(function (entry, i) {
        var emp    = allData.find(function (d) { return d.id === entry.id; });
        var newMgr = allData.find(function (d) { return d.id === entry.newParentId; });
        var oldMgr = _liveDataSnapshot
            ? ((_liveDataSnapshot.find(function (d) { return d.id === entry.oldParentId; }) || {}).name || entry.oldParentId)
            : entry.oldParentId;
        return '<div class="ss-log-item">'
            + '<span class="ss-log-num">' + (dragUndoStack.length - i) + '</span>'
            + '<div class="ss-log-body">'
            + '<div class="ss-log-name">' + _ssEsc(emp ? emp.name : entry.id) + '</div>'
            + '<div class="ss-log-detail">' + _ssEsc(oldMgr || '?') + ' \u2192 ' + _ssEsc(newMgr ? newMgr.name : entry.newParentId) + '</div>'
            + '</div></div>';
    }).join('');

    el.innerHTML = '<div class="ss-panel-hd">Change Log <span class="ss-log-ct">' + count + '</span></div>' + items;
}

// ── Build nidMap for SS chart (also used by drag.js via window._nidMap/_nidRev) ──
function _ssBuildNidMap() {
    window._nidMap = {};
    window._nidRev = {};
    var i = 0;
    viewData.forEach(function (d) {
        if (!d.isGhost) {
            _nidMap[i] = d.id;
            _nidRev[d.id] = i;
            i++;
        }
    });
}

// ── Scenario Studio org chart refresh ──
function ssRefresh(fit) {
    if (!orgCS) {
        try { orgCS = new d3.OrgChart().container('#ssChartWrap .ss-chart-container'); }
        catch (e) { return; }
    }
    if (!viewData.length) return;

    _ssBuildNidMap();

    // Compute headcount badges
    var map = {};
    viewData.forEach(function (d) { map[d.id] = d; d._hc = 0; });
    viewData.forEach(function (d) {
        var p = map[d.parentId];
        while (p) { p._hc++; p = map[p.parentId]; }
    });

    var hexToRgba = function (hex, a) {
        var h = hex.replace('#', '');
        var r = parseInt(h.slice(0,2), 16), gg = parseInt(h.slice(2,4), 16), b = parseInt(h.slice(4,6), 16);
        return 'rgba(' + r + ',' + gg + ',' + b + ',' + a + ')';
    };

    orgCS
        .data(viewData)
        .nodeWidth(function () { return 220; })
        .nodeHeight(function () { return 96; })
        .compact(true)
        .nodeContent(function (d) {
            if (d.data.isGhost) {
                return '<div style="padding:10px 14px;background:#f5f3ef;border:1px solid #e8e4dc;color:#6b6880;border-radius:14px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;font-family:\'Nunito\',sans-serif;">' + d.data.name + '</div>';
            }
            var col   = deptCol[d.data.department] || '#64748b';
            var colBg = hexToRgba(col, 0.1);
            var r     = pRat(d.data.rating);
            var rbar  = '';
            if (r !== 'NR') {
                var dots = '';
                for (var i = 0; i < r; i++) dots += '<div style="width:7px;height:2px;border-radius:1px;background:' + col + ';opacity:0.9;"></div>';
                for (var i = r; i < 5; i++) dots += '<div style="width:7px;height:2px;border-radius:1px;background:#e8e4dc;"></div>';
                rbar = '<div style="display:flex;gap:2px;margin-top:5px;">' + dots + '</div>';
            }
            var nidIdx = window._nidRev[d.data.id];
            return '<div data-nid="' + nidIdx + '" onclick="window.spotById(window._nidMap[' + nidIdx + '])"'
                + ' style="position:relative;cursor:pointer;padding:9px 11px 9px 14px;background:#ffffff;border-left:3px solid ' + col + ';border-radius:14px;height:74px;border:1px solid #e8e4dc;border-left:3px solid ' + col + ';box-shadow:0 2px 8px rgba(180,160,130,0.13),0 1px 3px rgba(180,160,130,0.08);transition:box-shadow 0.18s,transform 0.12s;font-family:\'Nunito\',sans-serif;"'
                + ' onmouseenter="this.style.boxShadow=\'0 6px 20px rgba(180,160,130,0.22),0 2px 6px rgba(180,160,130,0.12)\';this.style.transform=\'translateY(-1px)\'"'
                + ' onmouseleave="this.style.boxShadow=\'0 2px 8px rgba(180,160,130,0.13),0 1px 3px rgba(180,160,130,0.08)\';this.style.transform=\'none\'">'
                + (d.data._hc > 0 ? '<div style="position:absolute;top:-8px;right:-8px;background:' + col + ';color:#fff;border:2px solid #fafaf7;border-radius:50%;width:20px;height:20px;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:\'Nunito\',sans-serif;">' + d.data._hc + '</div>' : '')
                + '<div style="font-weight:800;font-size:11px;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + d.data.name + '</div>'
                + '<div style="font-size:9px;color:#6b6880;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;">' + d.data.title + '</div>'
                + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">'
                + '<div style="font-size:8px;color:' + col + ';background:' + colBg + ';padding:1px 7px;border-radius:50px;font-weight:800;">' + d.data.department + '</div>'
                + '<span style="font-size:8px;color:#6b6880;font-weight:700;">' + (d.data.jobLevel || '') + '</span>'
                + '</div>' + rbar
                + '<div style="position:absolute;bottom:8px;right:8px;display:flex;gap:4px;">'
                + '<button onmousedown="event.stopPropagation()" onclick="event.stopPropagation();window.addReportTo(window._nidMap[' + nidIdx + '])" style="width:22px;height:22px;border-radius:50%;background:rgba(45,155,111,0.12);color:#2d9b6f;border:1px solid rgba(45,155,111,0.3);font-size:13px;font-weight:800;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;">+</button>'
                + '<button onmousedown="event.stopPropagation()" onclick="event.stopPropagation();window.removeEmployee(window._nidMap[' + nidIdx + '])" style="width:22px;height:22px;border-radius:50%;background:rgba(224,62,62,0.08);color:#e03e3e;border:1px solid rgba(224,62,62,0.22);font-size:13px;font-weight:800;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;">\u2212</button>'
                + '</div></div>';
        })
        .render();

    if (fit) orgCS.fit();

    setTimeout(function () { initDrag(); }, 0);
    setTimeout(function () { initDrag(); }, 100);

    _ssUpdateFinancial();
    _ssUpdateChangeLog();
    _ssUpdateUndoRedo();
}

// ── Compare view: update diff table and personnel changes ──
function _ssUpdateCompare() {
    var el = document.getElementById('ssCompareContent');
    if (!el) return;

    var selA = document.getElementById('ssCmpSelA');
    var selB = document.getElementById('ssCmpSelB');
    if (!selA || !selB) return;

    var valA = selA.value, valB = selB.value;

    function getDs(val) {
        if (val === 'live') return _liveDataSnapshot || allData.filter(function (d) { return !d.isGhost; });
        var sc = scenarios[val];
        return (sc && sc.data) ? sc.data.filter(function (d) { return !d.isGhost; }) : [];
    }
    function lbl(val) {
        if (val === 'live') return 'Live Data';
        return (scenarios[val] || {}).name || '\u2014';
    }

    var dataA = getDs(valA), dataB = getDs(valB);
    var mA = _ssMet(dataA), mB = _ssMet(dataB);
    var lblA = lbl(valA), lblB = lbl(valB);

    var rows = [
        { label: 'Headcount',     a: mA.headcount,    b: mB.headcount,    fv: function (v) { return Math.round(v).toLocaleString(); }, fd: _ssDInt },
        { label: 'Total Payroll', a: mA.payroll,       b: mB.payroll,      fv: fmtM,                                                  fd: function (d) { return _ssDMon(d, fmtM); } },
        { label: 'Avg Salary',    a: mA.avgSal,        b: mB.avgSal,       fv: fmtK,                                                  fd: function (d) { return _ssDMon(d, fmtK); } },
        { label: 'Departments',   a: mA.deptCount,     b: mB.deptCount,    fv: function (v) { return Math.round(v).toLocaleString(); }, fd: _ssDInt },
        { label: 'Managers',      a: mA.managerCount,  b: mB.managerCount, fv: function (v) { return Math.round(v).toLocaleString(); }, fd: _ssDInt },
        { label: 'Avg Span',      a: mA.span,          b: mB.span,         fv: function (v) { return v.toFixed(1); },                  fd: _ssDDec },
    ];

    var tableRows = rows.map(function (row, i) {
        var delta = row.b - row.a;
        return '<tr' + (i % 2 ? ' class="ss-alt"' : '') + '>'
            + '<td class="ss-cm-lbl">' + row.label + '</td>'
            + '<td>' + row.fv(row.a) + '</td>'
            + '<td>' + row.fv(row.b) + '</td>'
            + '<td>' + row.fd(delta) + '</td></tr>';
    }).join('');

    var changes = _ssDiff(dataA, dataB);
    var changesHtml = !changes.length
        ? '<div class="ss-panel-empty">No reporting changes between these datasets.</div>'
        : '<ul class="ss-changes-list">' + changes.map(function (c) {
            return '<li><strong>' + _ssEsc(c.name) + '</strong> \u2014 ' + _ssEsc(c.oldMgr) + ' \u2192 ' + _ssEsc(c.newMgr) + '</li>';
        }).join('') + '</ul>';

    el.innerHTML = '<div class="ss-cmp-section">'
        + '<div class="ss-panel-hd">Metric Comparison</div>'
        + '<table class="ss-cmp-table">'
        + '<thead><tr><th>Metric</th><th>' + _ssEsc(lblA) + '</th><th>' + _ssEsc(lblB) + '</th><th>\u0394</th></tr></thead>'
        + '<tbody>' + tableRows + '</tbody></table></div>'
        + '<div class="ss-cmp-section">'
        + '<div class="ss-panel-hd">Personnel Changes (' + changes.length + ')</div>'
        + changesHtml + '</div>';
}

// Expose for onchange attribute
window._ssUpdateCompare = _ssUpdateCompare;

// ── Build compare selectors ──
function _ssBuildCmpSelectors() {
    var ids = Object.keys(scenarios).sort(function (a, b) {
        return new Date(scenarios[b].createdAt) - new Date(scenarios[a].createdAt);
    });
    function opts(selected) {
        var live = '<option value="live"' + (selected === 'live' ? ' selected' : '') + '>Live Data</option>';
        return live + ids.map(function (id) {
            return '<option value="' + _ssEsc(id) + '"' + (id === selected ? ' selected' : '') + '>' + _ssEsc(scenarios[id].name) + '</option>';
        }).join('');
    }
    var selA = document.getElementById('ssCmpSelA');
    var selB = document.getElementById('ssCmpSelB');
    if (selA) selA.innerHTML = opts('live');
    if (selB) selB.innerHTML = opts(ids[0] || 'live');
    _ssUpdateCompare();
}

// ── Switch Planner / Compare tab ──
window.ssSwitchTab = function (view) {
    _ssView = view;
    var planner = document.getElementById('ssPlannerView');
    var compare = document.getElementById('ssCompareView');
    var tP = document.getElementById('ssTabPlanner');
    var tC = document.getElementById('ssTabCompare');

    if (view === 'planner') {
        if (planner) planner.style.display = 'flex';
        if (compare) compare.style.display = 'none';
        if (tP) tP.classList.add('ss-tab-active');
        if (tC) tC.classList.remove('ss-tab-active');
        // Ensure chart renders correctly on tab switch
        if (orgCS && allData.length) {
            setTimeout(function () { try { orgCS.render(); } catch (e) {} }, 60);
        }
    } else {
        if (planner) planner.style.display = 'none';
        if (compare) compare.style.display = 'flex';
        if (tP) tP.classList.remove('ss-tab-active');
        if (tC) tC.classList.add('ss-tab-active');
        _ssBuildCmpSelectors();
    }
};

// ── New scenario ──
window.ssNewScenario = function () {
    var name = prompt('Scenario name:', 'Scenario ' + (Object.keys(scenarios).length + 1));
    if (!name || !name.trim()) return;
    var id = saveScenario(name.trim(), '');
    if (!id) return;
    ssOnSelectChange(id);
};

// ── Handle scenario dropdown change ──
window.ssOnSelectChange = function (forcedId) {
    var sel = document.getElementById('ssScenarioSel');
    var id  = forcedId || (sel ? sel.value : '');
    if (sel && forcedId) sel.value = forcedId;

    if (!id) {
        if (isScenarioMode) ssExitScenario();
        return;
    }
    loadScenario(id);   // calls refresh(true) on main chart — harmless (invisible)
    ssRefresh(true);
    _ssUpdateToolbar();
};

// ── Undo / Redo ──
window.ssUndo = function () {
    undoLastMove();
    // undoLastMove already calls _smartRefresh which calls ssRefresh
    // panels are updated inside ssRefresh; also update undo/redo state
    _ssUpdateUndoRedo();
};

window.ssRedo = function () {
    redoLastMove();
    _ssUpdateUndoRedo();
};

// ── Exit scenario ──
window.ssExitScenario = function () {
    exitScenario();     // calls refresh(true) on main chart — harmless (invisible)
    ssRefresh(true);
    _ssUpdateToolbar();
};

// ── Export comparison CSV ──
window.ssExportCmp = function () {
    var selA = document.getElementById('ssCmpSelA');
    var selB = document.getElementById('ssCmpSelB');
    if (!selA || !selB) return;

    var valA = selA.value, valB = selB.value;

    function getDs(val) {
        if (val === 'live') return _liveDataSnapshot || allData.filter(function (d) { return !d.isGhost; });
        var sc = scenarios[val];
        return (sc && sc.data) ? sc.data.filter(function (d) { return !d.isGhost; }) : [];
    }
    function lbl(val) {
        if (val === 'live') return 'Live Data';
        return (scenarios[val] || {}).name || '\u2014';
    }

    var dataA = getDs(valA), dataB = getDs(valB);
    var mA = _ssMet(dataA), mB = _ssMet(dataB);
    var lblA = lbl(valA), lblB = lbl(valB);

    function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }

    var metricRows = [
        ['Metric', lblA, lblB, 'Delta (B \u2212 A)'],
        ['Headcount', Math.round(mA.headcount), Math.round(mB.headcount), Math.round(mB.headcount - mA.headcount)],
        ['Total Payroll', mA.payroll.toFixed(2), mB.payroll.toFixed(2), (mB.payroll - mA.payroll).toFixed(2)],
        ['Avg Salary', mA.avgSal.toFixed(2), mB.avgSal.toFixed(2), (mB.avgSal - mA.avgSal).toFixed(2)],
        ['Departments', mA.deptCount, mB.deptCount, mB.deptCount - mA.deptCount],
        ['Managers', mA.managerCount, mB.managerCount, mB.managerCount - mA.managerCount],
        ['Avg Span', mA.span.toFixed(2), mB.span.toFixed(2), (mB.span - mA.span).toFixed(2)],
    ];

    var csv = metricRows.map(function (r) { return r.map(q).join(','); }).join('\r\n');

    var changes = _ssDiff(dataA, dataB);
    csv += '\r\n\r\nPersonnel Changes\r\n';
    if (!changes.length) {
        csv += q('No reporting changes between these datasets.');
    } else {
        csv += [q('Employee'), q('Old Manager'), q('New Manager')].join(',') + '\r\n';
        csv += changes.map(function (c) { return [q(c.name), q(c.oldMgr), q(c.newMgr)].join(','); }).join('\r\n');
    }

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'scenario-comparison.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
};

// ── Add report to manager (Scenario Studio only) ──
window.addReportTo = function (managerId) {
    var manager = allData.find(function (d) { return d.id === managerId; });
    if (!manager) { console.error('Manager not found:', managerId); return; }

    var levels = [...new Set(allData.filter(function (d) { return !d.isGhost; }).map(function (d) { return d.jobLevel; }).filter(Boolean))].sort();
    var depts  = [...new Set(allData.filter(function (d) { return !d.isGhost; }).map(function (d) { return d.department; }).filter(Boolean))].sort();
    var today  = new Date().toISOString().split('T')[0];

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.28);z-index:200000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:28px;width:340px;box-shadow:0 20px 50px rgba(180,160,130,0.25);font-family:Nunito,sans-serif;">'
        + '<div style="font-size:15px;font-weight:800;color:#1a1a2e;margin-bottom:16px;">Add Report to ' + _ssEsc(manager.name) + '</div>'
        + '<input id="_an" type="text" placeholder="Full Name *" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;outline:none;">'
        + '<input id="_at" type="text" placeholder="Job Title" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;outline:none;">'
        + '<input id="_as" type="number" placeholder="Annual Salary ($)" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;outline:none;">'
        + '<select id="_al" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;background:#fafaf7;"><option value="">Job Level...</option>' + levels.map(function (l) { return '<option>' + l + '</option>'; }).join('') + '</select>'
        + '<select id="_ad" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:16px;box-sizing:border-box;background:#fafaf7;">' + depts.map(function (d) { return '<option' + (d === manager.department ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select>'
        + '<div style="display:flex;gap:8px;">'
        + '<button id="_asave" style="flex:1;padding:9px;border-radius:50px;background:#e85d3d;color:#fff;border:none;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Add Employee</button>'
        + '<button id="_acanc" style="flex:1;padding:9px;border-radius:50px;background:#f5f3ef;color:#6b6880;border:1px solid #e8e4dc;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>'
        + '</div></div>';

    document.body.appendChild(overlay);
    setTimeout(function () { var n = document.getElementById('_an'); if (n) n.focus(); }, 50);

    document.getElementById('_asave').onclick = function () {
        var name = document.getElementById('_an').value.trim();
        if (!name) { document.getElementById('_an').style.borderColor = '#e03e3e'; return; }
        var uid = 'emp_' + Date.now();
        var newEmp = {
            id: uid, name: name,
            title:      document.getElementById('_at').value.trim() || '',
            parentId:   managerId,
            department: document.getElementById('_ad').value || manager.department,
            salary:     document.getElementById('_as').value || '0',
            rating:     'NR',
            jobLevel:   document.getElementById('_al').value || '',
            email: '', startDate: today, city: '', state: '', isGhost: false
        };
        allData.push(newEmp);
        viewData.push(JSON.parse(JSON.stringify(newEmp)));
        overlay.remove();
        if (typeof _autoSaveScenario === 'function') _autoSaveScenario();
        ssRefresh(false);
    };
    document.getElementById('_acanc').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
};

// ── Remove employee (Scenario Studio only) ──
window.removeEmployee = function (employeeId) {
    var emp = allData.find(function (d) { return d.id === employeeId; });
    if (!emp || emp.isGhost || !emp.parentId) return;
    var parent     = allData.find(function (d) { return d.id === emp.parentId; });
    var reports    = allData.filter(function (d) { return d.parentId === employeeId && !d.isGhost; });
    var parentName = parent ? parent.name : 'the organization';

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.28);z-index:200000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:28px;width:320px;box-shadow:0 20px 50px rgba(180,160,130,0.25);font-family:Nunito,sans-serif;">'
        + '<div style="font-size:15px;font-weight:800;color:#1a1a2e;margin-bottom:6px;">Remove ' + _ssEsc(emp.name) + '?</div>'
        + '<div style="font-size:12px;color:#6b6880;margin-bottom:4px;">' + _ssEsc(emp.title || '') + '</div>'
        + '<div style="font-size:12px;color:#6b6880;margin-bottom:22px;">' + (reports.length > 0 ? reports.length + ' direct report' + (reports.length > 1 ? 's' : '') + ' will move up to ' + _ssEsc(parentName) + '.' : 'No direct reports to reassign.') + '</div>'
        + '<div style="display:flex;gap:8px;">'
        + '<button id="_rconf" style="flex:1;padding:9px;border-radius:50px;background:#e03e3e;color:#fff;border:none;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Remove</button>'
        + '<button id="_rcanc" style="flex:1;padding:9px;border-radius:50px;background:#f5f3ef;color:#6b6880;border:1px solid #e8e4dc;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>'
        + '</div></div>';

    document.body.appendChild(overlay);

    document.getElementById('_rconf').onclick = function () {
        allData.forEach(function (d) { if (d.parentId === employeeId) d.parentId = emp.parentId; });
        viewData.forEach(function (d) { if (d.parentId === employeeId) d.parentId = emp.parentId; });
        allData  = allData.filter(function (d) { return d.id !== employeeId; });
        viewData = viewData.filter(function (d) { return d.id !== employeeId; });
        overlay.remove();
        if (typeof _autoSaveScenario === 'function') _autoSaveScenario();
        ssRefresh(false);
    };
    document.getElementById('_rcanc').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
};

// ── Render the Scenario Studio page ──
function renderScenarioStudio() {
    var el = g('pageScenarioStudio');
    if (!el) return;

    if (!el.dataset.built) {
        el.dataset.built = 'yes';
        el.innerHTML = [
            '<div id="ssTbar">',
            '  <div id="ssTbarLeft">',
            '    <select id="ssScenarioSel" onchange="ssOnSelectChange()"></select>',
            '    <button class="ss-new-btn" onclick="ssNewScenario()">+ New Scenario</button>',
            '    <span id="ssModeTag" class="ss-mode-tag ss-live">Live Data</span>',
            '  </div>',
            '  <div id="ssTbarCenter">',
            '    <button class="ss-tab-btn ss-tab-active" id="ssTabPlanner" onclick="ssSwitchTab(\'planner\')">&#9997; Planner</button>',
            '    <button class="ss-tab-btn" id="ssTabCompare" onclick="ssSwitchTab(\'compare\')">&#8644; Compare</button>',
            '  </div>',
            '  <div id="ssTbarRight">',
            '    <button class="ss-ctrl-btn" id="ssUndoBtn" onclick="ssUndo()" disabled>&#8617; Undo</button>',
            '    <button class="ss-ctrl-btn" id="ssRedoBtn" onclick="ssRedo()" disabled>&#8635; Redo</button>',
            '    <button class="ss-exit-btn" id="ssExitBtn" onclick="ssExitScenario()" style="display:none;">&#x2715; Exit Scenario</button>',
            '  </div>',
            '</div>',

            '<div id="ssPlannerView" style="display:flex;flex:1;min-height:0;">',
            '  <div id="ssChartPanel">',
            '    <div id="ssChartWrap"><div class="ss-chart-container"></div></div>',
            '    <div id="ssChartEmpty" class="ss-chart-empty">',
            '      <div style="font-size:32px;opacity:0.25;margin-bottom:10px;">&#9997;</div>',
            '      <div>Select or create a scenario to start planning</div>',
            '    </div>',
            '  </div>',
            '  <div id="ssSidePanel">',
            '    <div id="ssFinancial"><div class="ss-panel-hd">Financial Impact</div><div class="ss-panel-empty">Load a scenario to see financial impact.</div></div>',
            '    <div id="ssChangeLog"><div class="ss-panel-hd">Change Log</div><div class="ss-panel-empty">Drag employees to reassign. Changes appear here.</div></div>',
            '  </div>',
            '</div>',

            '<div id="ssCompareView" style="display:none;flex:1;flex-direction:column;overflow:auto;padding:24px;gap:0;">',
            '  <div class="ss-cmp-selectors">',
            '    <div class="ss-cmp-col">',
            '      <div class="ss-cmp-lbl">Dataset A</div>',
            '      <select id="ssCmpSelA" onchange="window._ssUpdateCompare()"></select>',
            '    </div>',
            '    <div class="ss-cmp-col">',
            '      <div class="ss-cmp-lbl">Dataset B</div>',
            '      <select id="ssCmpSelB" onchange="window._ssUpdateCompare()"></select>',
            '    </div>',
            '    <button class="ss-ctrl-btn" style="align-self:flex-end;" onclick="ssExportCmp()">&#8595; Export CSV</button>',
            '  </div>',
            '  <div id="ssCompareContent"></div>',
            '</div>',
        ].join('\n');

        // Auto-create "Scenario 1" if no scenarios exist
        if (Object.keys(scenarios).length === 0 && allData.filter(function (d) { return !d.isGhost; }).length > 0) {
            var id = saveScenario('Scenario 1', 'Baseline snapshot');
            if (id) {
                loadScenario(id);   // also calls refresh(true) on main chart — harmless
            }
        }
    }

    // Initialize orgCS if not yet done
    if (!orgCS) {
        try { orgCS = new d3.OrgChart().container('#ssChartWrap .ss-chart-container'); }
        catch (e) {}
    }

    _ssUpdateToolbar();

    // Show/hide the empty state hint
    var empty = document.getElementById('ssChartEmpty');
    if (empty) empty.style.display = (allData.length && isScenarioMode) ? 'none' : 'flex';

    if (allData.length) {
        if (_ssView === 'planner') {
            ssRefresh(true);
        } else {
            _ssBuildCmpSelectors();
        }
    }
}
