// ── Scenario Studio ──
// Full-page scenario planner with Planner and Compare sub-views.
// Requires: state.js (scenarios, saveScenario, loadScenario, exitScenario,
//           dragUndoStack, dragRedoStack), drag.js, chart.js

var _ssView = 'planner';   // 'planner' | 'compare'
var orgCS   = null;        // d3.OrgChart instance for Scenario Studio
var _ssChartWrapObserver = null; // ResizeObserver for #ssChartWrap
var _ssPanelCollapsed = false;   // right side panel collapse state

// ── Smart refresh: routes to the correct chart based on active page ──
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

// ── Render scenario pill bar ──
function _ssRenderPillBar() {
    var bar = document.getElementById('ssPillBar');
    if (!bar) return;

    var ids = Object.keys(scenarios).sort(function (a, b) {
        return new Date(scenarios[a].createdAt) - new Date(scenarios[b].createdAt);
    });

    if (!ids.length) {
        bar.innerHTML = '<span class="ss-no-scenarios">No scenarios — click + New</span>';
        return;
    }

    bar.innerHTML = ids.map(function (id) {
        var sc       = scenarios[id];
        var isActive = (id === currentScenarioId);
        return '<div class="ss-pill' + (isActive ? ' ss-pill-active' : '') + '" data-scenid="' + _ssEsc(id) + '">'
            + '<span class="ss-pill-name">' + _ssEsc(sc.name) + '</span>'
            + (isActive ? '' : '<span class="ss-pill-del" title="Delete ' + _ssEsc(sc.name) + '">\u00d7</span>')
            + '</div>';
    }).join('');

    // Attach events via addEventListener
    bar.querySelectorAll('.ss-pill').forEach(function (pill) {
        var id = pill.dataset.scenid;
        pill.querySelector('.ss-pill-name').addEventListener('click', function () {
            if (id !== currentScenarioId) ssOnSelectChange(id);
        });
        var delBtn = pill.querySelector('.ss-pill-del');
        if (delBtn) {
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                _ssShowDeleteConfirm(id, delBtn);
            });
        }
    });
}

// ── Show inline delete-confirm popover ──
function _ssShowDeleteConfirm(id, anchorEl) {
    document.querySelectorAll('.ss-del-popover').forEach(function (p) { p.remove(); });
    var sc = scenarios[id];
    if (!sc) return;

    var pop = document.createElement('div');
    pop.className = 'ss-del-popover';
    pop.innerHTML = '<div class="ss-del-msg">Delete <strong>' + _ssEsc(sc.name) + '</strong>?<br>This cannot be undone.</div>'
        + '<div class="ss-del-btns">'
        + '<button class="ss-del-confirm">Delete</button>'
        + '<button class="ss-del-cancel">Cancel</button>'
        + '</div>';

    var rect = anchorEl.getBoundingClientRect();
    pop.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
    pop.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
    document.body.appendChild(pop);

    pop.querySelector('.ss-del-confirm').addEventListener('click', function () {
        pop.remove();
        _ssDeleteScenario(id);
    });
    pop.querySelector('.ss-del-cancel').addEventListener('click', function () { pop.remove(); });

    var closeHandler = function (e) {
        if (!pop.contains(e.target) && e.target !== anchorEl) {
            pop.remove();
            document.removeEventListener('mousedown', closeHandler);
        }
    };
    setTimeout(function () { document.addEventListener('mousedown', closeHandler); }, 10);
}

// ── Delete scenario and recover gracefully ──
function _ssDeleteScenario(id) {
    var wasActive = (currentScenarioId === id);
    deleteScenario(id);

    var remaining = Object.keys(scenarios);
    if (wasActive) {
        if (remaining.length > 0) {
            ssOnSelectChange(remaining[0]);
        } else {
            // Exit scenario mode and create a fresh Scenario 1
            if (isScenarioMode) exitScenario();
            var newId = saveScenario('Scenario 1', 'Baseline snapshot');
            if (newId) ssOnSelectChange(newId);
        }
    }

    _ssRenderPillBar();
    _ssUpdateToolbar();
}

// ── Update toolbar (mode tag, exit button, pill bar) ──
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
    _ssRenderPillBar();
}

// ── Toggle collapsible panel ──
function _ssTogglePanel(bodyId, arrowId, storageKey) {
    var body  = document.getElementById(bodyId);
    var arrow = document.getElementById(arrowId);
    if (!body) return;
    var collapsed = body.classList.contains('ss-coll-collapsed');
    if (collapsed) {
        body.classList.remove('ss-coll-collapsed');
        if (arrow) arrow.textContent = '\u25bc'; // ▼
        try { sessionStorage.setItem(storageKey, 'false'); } catch (e) {}
    } else {
        body.classList.add('ss-coll-collapsed');
        if (arrow) arrow.textContent = '\u25b6'; // ▶
        try { sessionStorage.setItem(storageKey, 'true'); } catch (e) {}
    }
}

// ── Restore collapse states from sessionStorage ──
function _ssRestoreCollapseStates() {
    var finC = sessionStorage.getItem('ss_financial_collapsed') === 'true';
    var logC = sessionStorage.getItem('ss_changelog_collapsed') === 'true';
    var finBody  = document.getElementById('ssFinancialBody');
    var finArrow = document.getElementById('ssFinancialArrow');
    var logBody  = document.getElementById('ssChangeLogBody');
    var logArrow = document.getElementById('ssChangeLogArrow');
    if (finC && finBody) { finBody.classList.add('ss-coll-collapsed'); if (finArrow) finArrow.textContent = '\u25b6'; }
    if (logC && logBody) { logBody.classList.add('ss-coll-collapsed'); if (logArrow) logArrow.textContent = '\u25b6'; }
}

// ── Toggle the right side panel collapse ──
function _ssToggleSidePanel() {
    _ssPanelCollapsed = !_ssPanelCollapsed;
    try { sessionStorage.setItem('ss_panel_collapsed', _ssPanelCollapsed ? 'true' : 'false'); } catch (e) {}
    _ssApplySidePanelState();
}

function _ssApplySidePanelState() {
    var panel = document.getElementById('ssSidePanel');
    var tab   = document.getElementById('ssPanelTab');
    var arrow = document.getElementById('ssPanelArrow');
    var dot   = document.getElementById('ssPanelDot');
    if (!panel) return;
    if (_ssPanelCollapsed) {
        panel.style.right = '-360px';
        if (tab)   tab.style.right   = '0px';
        if (arrow) arrow.textContent = '\u2039'; // ‹ = expand left
    } else {
        panel.style.right = '0px';
        if (tab)   tab.style.right   = '360px';
        if (arrow) arrow.textContent = '\u203a'; // › = collapse right
    }
    // Coral dot on tab when collapsed with pending changes
    if (dot) dot.style.display = (_ssPanelCollapsed && dragUndoStack.length > 0) ? 'block' : 'none';
}

// ── Financial impact panel ──
function _ssUpdateFinancial() {
    var body    = document.getElementById('ssFinancialBody');
    var summary = document.getElementById('ssFinancialSummary');
    if (!body) return;

    if (!isScenarioMode || !_liveDataSnapshot) {
        body.innerHTML = '<div class="ss-panel-empty">Load a scenario to see financial impact vs. baseline.</div>';
        if (summary) summary.textContent = '';
        return;
    }

    var mL = _ssMet(_liveDataSnapshot);
    var mS = _ssMet(allData);
    var payDelta  = mS.payroll   - mL.payroll;
    var hcDelta   = mS.headcount - mL.headcount;
    var avgDelta  = mS.avgSal    - mL.avgSal;
    var spanDelta = mS.span      - mL.span;

    var payCol = payDelta < 0 ? 'var(--green)' : payDelta > 0 ? 'var(--red)' : 'var(--muted)';
    var payStr = payDelta === 0
        ? '<span class="ss-dz">\u2014</span>'
        : '<span style="color:' + payCol + ';">' + (payDelta > 0 ? '+' : '\u2212') + fmtK(Math.abs(payDelta)) + '</span>';

    body.innerHTML = '<div class="ss-fin-grid">'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Payroll Delta</span><span class="ss-fin-val">' + payStr + '</span></div>'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Headcount</span><span class="ss-fin-val">' + _ssDInt(hcDelta) + ' (' + mS.headcount + ' total)</span></div>'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Avg Salary</span><span class="ss-fin-val">' + _ssDMon(avgDelta, fmtK) + ' (' + fmtK(mS.avgSal) + ' now)</span></div>'
        + '<div class="ss-fin-row"><span class="ss-fin-lbl">Avg Span</span><span class="ss-fin-val">' + _ssDDec(spanDelta) + ' (' + mS.span.toFixed(1) + ' now)</span></div>'
        + '<div class="ss-fin-annot">vs. live baseline \u00b7 ' + mL.headcount + ' employees</div>'
        + '</div>';

    if (summary) {
        var sign  = payDelta > 0 ? '\u2191' : payDelta < 0 ? '\u2193' : '';
        summary.textContent = payDelta !== 0
            ? sign + fmtK(Math.abs(payDelta)) + ' \u00b7 ' + dragUndoStack.length + ' change' + (dragUndoStack.length !== 1 ? 's' : '')
            : (dragUndoStack.length ? dragUndoStack.length + ' change' + (dragUndoStack.length !== 1 ? 's' : '') : '');
    }
}

// ── Change log panel ──
function _ssUpdateChangeLog() {
    var body  = document.getElementById('ssChangeLogBody');
    var badge = document.getElementById('ssChangeLogCount');
    if (!body) return;

    var count = dragUndoStack.length;

    if (badge) {
        badge.textContent = count || '';
        badge.style.display = count ? 'inline-flex' : 'none';
    }

    if (!count) {
        body.innerHTML = '<div class="ss-panel-empty">Drag employees to reassign. Changes appear here.</div>';
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

    body.innerHTML = items;
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

// ── Populate dept filter from current allData ──
function _ssPopulateDeptFilter() {
    var sel = document.getElementById('ssDeptFilter');
    if (!sel) return;
    var current = sel.value;
    var depts = [...new Set(allData.filter(function (d) { return !d.isGhost && d.department; }).map(function (d) { return d.department; }))].sort();
    sel.innerHTML = '<option value="">All Departments</option>'
        + depts.map(function (d) { return '<option value="' + _ssEsc(d) + '"' + (d === current ? ' selected' : '') + '>' + _ssEsc(d) + '</option>'; }).join('');
}

// ── Apply search / dept filter to SS chart ──
function _ssApplySearch() {
    var q    = ((document.getElementById('ssSearchInput') || {}).value || '').toLowerCase().trim();
    var dept = ((document.getElementById('ssDeptFilter')  || {}).value || '');

    if (!q && !dept) {
        viewData = JSON.parse(JSON.stringify(allData));
    } else {
        var matched = allData.filter(function (d) {
            if (d.isGhost) return false;
            var matchQ = !q || (d.name  || '').toLowerCase().indexOf(q) !== -1
                            || (d.title || '').toLowerCase().indexOf(q) !== -1;
            var matchD = !dept || d.department === dept;
            return matchQ && matchD;
        });
        viewData = JSON.parse(JSON.stringify(matched));
        var ns = new Set(viewData.map(function (d) { return d.id; }));
        viewData.forEach(function (d) { if (!ns.has(d.parentId)) d.parentId = 'ROOT'; });
        viewData.push({ id: 'ROOT', name: 'Organization', isGhost: true, parentId: null });
    }
    ssRefresh(true);
}

// ── Scenario Studio org chart refresh ──
function ssRefresh(fit) {
    if (!orgCS) {
        try { orgCS = new d3.OrgChart().container('#ssChartWrap .ss-chart-container'); }
        catch (e) { return; }
    }
    if (!viewData.length) return;

    _ssBuildNidMap();

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
        .nodeHeight(function () { return 86; })
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
                + '</div>';
        })
        .render();

    if (fit) orgCS.fit();

    setTimeout(function () { initDrag(); }, 0);
    setTimeout(function () { initDrag(); }, 100);

    _ssUpdateFinancial();
    _ssUpdateChangeLog();
    _ssUpdateUndoRedo();
    _ssApplySidePanelState();
}

// ── Compare view ──
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
        { label: 'Headcount',     a: mA.headcount,   b: mB.headcount,   fv: function (v) { return Math.round(v).toLocaleString(); }, fd: _ssDInt },
        { label: 'Total Payroll', a: mA.payroll,      b: mB.payroll,     fv: fmtM,                                                  fd: function (d) { return _ssDMon(d, fmtM); } },
        { label: 'Avg Salary',    a: mA.avgSal,       b: mB.avgSal,      fv: fmtK,                                                  fd: function (d) { return _ssDMon(d, fmtK); } },
        { label: 'Departments',   a: mA.deptCount,    b: mB.deptCount,   fv: function (v) { return Math.round(v).toLocaleString(); }, fd: _ssDInt },
        { label: 'Managers',      a: mA.managerCount, b: mB.managerCount, fv: function (v) { return Math.round(v).toLocaleString(); }, fd: _ssDInt },
        { label: 'Avg Span',      a: mA.span,         b: mB.span,        fv: function (v) { return v.toFixed(1); },                  fd: _ssDDec },
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
    var toolbar = document.getElementById('ssPlannerToolbar');
    var tP      = document.getElementById('ssTabPlanner');
    var tC      = document.getElementById('ssTabCompare');

    if (view === 'planner') {
        if (planner) planner.style.display = 'flex';
        if (compare) compare.style.display = 'none';
        if (toolbar) toolbar.style.display = 'flex';
        if (tP) tP.classList.add('ss-tab-active');
        if (tC) tC.classList.remove('ss-tab-active');
        if (orgCS && allData.length) {
            setTimeout(function () { try { orgCS.render(); } catch (e) {} }, 60);
        }
    } else {
        if (planner) planner.style.display = 'none';
        if (compare) compare.style.display = 'flex';
        if (toolbar) toolbar.style.display = 'none';
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

// ── Handle scenario selection (pill click or programmatic) ──
window.ssOnSelectChange = function (id) {
    if (!id) {
        if (isScenarioMode) ssExitScenario();
        return;
    }

    // Load scenario into allData / viewData / currentScenarioId
    loadScenario(id);

    // Reset drag history for the new scenario
    dragUndoStack = [];
    dragRedoStack = [];

    // Destroy and recreate orgCS to force a clean D3 render
    if (orgCS) {
        try { orgCS.clear(); } catch (e) {}
        orgCS = null;
    }
    var container = document.querySelector('#ssChartWrap .ss-chart-container');
    if (container) container.innerHTML = '';

    _ssUpdateToolbar();   // updates pill bar, mode tag, undo/redo
    _ssUpdateFinancial();
    _ssUpdateChangeLog();

    var empty = document.getElementById('ssChartEmpty');
    if (empty) empty.style.display = 'none';

    // Delay render so #ssChartWrap has non-zero dimensions
    setTimeout(function () {
        if (!orgCS) {
            try { orgCS = new d3.OrgChart().container('#ssChartWrap .ss-chart-container'); }
            catch (e) {}
        }
        ssRefresh(true);
        _ssPopulateDeptFilter();
    }, 100);
};

// ── Undo / Redo ──
window.ssUndo = function () {
    undoLastMove();
    _ssUpdateUndoRedo();
};

window.ssRedo = function () {
    redoLastMove();
    _ssUpdateUndoRedo();
};

// ── Exit scenario ──
window.ssExitScenario = function () {
    exitScenario();
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

// ── Open Add Employee modal (toolbar-level; manager selected from dropdown) ──
window.openAddEmployeeModal = function () {
    if (!isScenarioMode) { alert('Please load a scenario first.'); return; }
    var levels = [...new Set(allData.filter(function (d) { return !d.isGhost; }).map(function (d) { return d.jobLevel; }).filter(Boolean))].sort();
    var depts  = [...new Set(allData.filter(function (d) { return !d.isGhost; }).map(function (d) { return d.department; }).filter(Boolean))].sort();
    var mgrs   = allData.filter(function (d) { return !d.isGhost && allData.some(function (e) { return e.parentId === d.id; }); })
                        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    var today  = new Date().toISOString().split('T')[0];

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.28);z-index:200000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:28px;width:360px;box-shadow:0 20px 50px rgba(180,160,130,0.25);font-family:Nunito,sans-serif;max-height:90vh;overflow-y:auto;">'
        + '<div style="font-size:15px;font-weight:800;color:#1a1a2e;margin-bottom:16px;">Add Employee</div>'
        + '<div style="font-size:10px;font-weight:800;color:#6b6880;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em;">Reports To</div>'
        + '<select id="_amgr" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;background:#fafaf7;">'
        + mgrs.map(function (m) { return '<option value="' + _ssEsc(m.id) + '">' + _ssEsc(m.name) + ' (' + _ssEsc(m.department || '') + ')</option>'; }).join('')
        + '</select>'
        + '<input id="_an" type="text" placeholder="Full Name *" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;outline:none;">'
        + '<input id="_at" type="text" placeholder="Job Title" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;outline:none;">'
        + '<input id="_as" type="number" placeholder="Annual Salary ($)" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;outline:none;">'
        + '<select id="_al" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:9px;box-sizing:border-box;background:#fafaf7;">'
        + '<option value="">Job Level...</option>' + levels.map(function (l) { return '<option>' + _ssEsc(l) + '</option>'; }).join('')
        + '</select>'
        + '<select id="_ad" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:16px;box-sizing:border-box;background:#fafaf7;">'
        + depts.map(function (d) { return '<option>' + _ssEsc(d) + '</option>'; }).join('')
        + '</select>'
        + '<div style="display:flex;gap:8px;">'
        + '<button id="_asave" style="flex:1;padding:9px;border-radius:50px;background:#e85d3d;color:#fff;border:none;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Add Employee</button>'
        + '<button id="_acanc" style="flex:1;padding:9px;border-radius:50px;background:#f5f3ef;color:#6b6880;border:1px solid #e8e4dc;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>'
        + '</div></div>';

    document.body.appendChild(overlay);
    setTimeout(function () { var n = document.getElementById('_an'); if (n) n.focus(); }, 50);

    document.getElementById('_asave').onclick = function () {
        var name = document.getElementById('_an').value.trim();
        if (!name) { document.getElementById('_an').style.borderColor = '#e03e3e'; return; }
        var managerId = document.getElementById('_amgr').value;
        var manager   = allData.find(function (d) { return d.id === managerId; });
        var uid = 'emp_' + Date.now();
        var newEmp = {
            id: uid, name: name,
            title:      document.getElementById('_at').value.trim() || '',
            parentId:   managerId,
            department: document.getElementById('_ad').value || (manager ? manager.department : ''),
            salary:     document.getElementById('_as').value || '0',
            rating:     'NR',
            jobLevel:   document.getElementById('_al').value || '',
            email: '', startDate: today, city: '', state: '', isGhost: false,
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

// ── Open Remove Employee modal (toolbar-level; employee chosen from dropdown) ──
window.openRemoveEmployeeModal = function () {
    if (!isScenarioMode) { alert('Please load a scenario first.'); return; }
    var emps = allData.filter(function (d) { return !d.isGhost && d.parentId; })
                      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.28);z-index:200000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:28px;width:340px;box-shadow:0 20px 50px rgba(180,160,130,0.25);font-family:Nunito,sans-serif;">'
        + '<div style="font-size:15px;font-weight:800;color:#1a1a2e;margin-bottom:16px;">Remove Employee</div>'
        + '<select id="_remp" style="width:100%;padding:9px 13px;border:1.5px solid #e8e4dc;border-radius:12px;font-family:Nunito,sans-serif;font-size:13px;margin-bottom:16px;box-sizing:border-box;background:#fafaf7;">'
        + emps.map(function (e) { return '<option value="' + _ssEsc(e.id) + '">' + _ssEsc(e.name) + ' — ' + _ssEsc(e.title || e.department || '') + '</option>'; }).join('')
        + '</select>'
        + '<div style="display:flex;gap:8px;">'
        + '<button id="_rconf2" style="flex:1;padding:9px;border-radius:50px;background:#e03e3e;color:#fff;border:none;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Remove</button>'
        + '<button id="_rcanc2" style="flex:1;padding:9px;border-radius:50px;background:#f5f3ef;color:#6b6880;border:1px solid #e8e4dc;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>'
        + '</div></div>';

    document.body.appendChild(overlay);

    document.getElementById('_rconf2').onclick = function () {
        window.removeEmployee(document.getElementById('_remp').value);
        overlay.remove();
    };
    document.getElementById('_rcanc2').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
};

// ── Remove employee (toolbar Remove modal handler) ──
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
        allData.forEach(function (d)  { if (d.parentId === employeeId) d.parentId = emp.parentId; });
        viewData.forEach(function (d) { if (d.parentId === employeeId) d.parentId = emp.parentId; });
        allData  = allData.filter(function (d)  { return d.id !== employeeId; });
        viewData = viewData.filter(function (d) { return d.id !== employeeId; });
        overlay.remove();
        if (typeof _autoSaveScenario === 'function') _autoSaveScenario();
        ssRefresh(false);
    };
    document.getElementById('_rcanc').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
};

// ── Attach ResizeObserver on #ssChartWrap ──
function _ssInitResizeObserver() {
    var wrap = document.getElementById('ssChartWrap');
    if (!wrap || _ssChartWrapObserver) return;
    var lastH = 0;
    _ssChartWrapObserver = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
            var h = entry.contentRect.height;
            if (lastH === 0 && h > 0 && orgCS && allData.length && isScenarioMode) {
                ssRefresh(true);
            }
            lastH = h;
        });
    });
    _ssChartWrapObserver.observe(wrap);
}

// ── Render the Scenario Studio page (lazy — built once) ──
function renderScenarioStudio() {
    if (typeof closeSpot === 'function') closeSpot();
    var el = g('pageScenarioStudio');
    if (!el) return;

    if (!el.dataset.built) {
        el.dataset.built = 'yes';

        el.innerHTML = [
            // ── Mobile notice (hidden on desktop via CSS) ──
            '<div class="ss-mobile-notice">',
            '  <div style="text-align:center;padding:32px 24px;max-width:380px;margin:0 auto;">',
            '    <div style="font-size:48px;margin-bottom:16px;">📋</div>',
            '    <div style="font-size:20px;font-weight:800;color:var(--text);font-family:var(--font-hd);margin-bottom:12px;">Workforce Planning</div>',
            '    <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:24px;">Workforce Planning is optimized for desktop. Please open Canopy on a larger screen to model org changes and analyze financial impact.</p>',
            '    <button onclick="showPage(\'orgchart\')" style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer;width:100%;font-family:var(--font-ui);">View Org Chart</button>',
            '  </div>',
            '</div>',

            // ── Desktop content (hidden on mobile via CSS) ──
            '<div class="ss-desktop-content">',

            // ── Main toolbar ──
            '<div id="ssTbar">',
            '  <div id="ssTbarLeft">',
            '    <button id="ssNewBtn" class="ss-new-btn">+ New</button>',
            '    <div id="ssPillBar" class="ss-pill-bar"></div>',
            '  </div>',
            '  <div id="ssTbarCenter">',
            '    <button class="ss-tab-btn ss-tab-active" id="ssTabPlanner">&#9997; Planner</button>',
            '    <button class="ss-tab-btn" id="ssTabCompare">&#8644; Compare</button>',
            '  </div>',
            '  <div id="ssTbarRight">',
            '    <span id="ssModeTag" class="ss-mode-tag ss-live">Live Data</span>',
            '    <button class="ss-exit-btn" id="ssExitBtn" style="display:none;">&#x2715; Exit Scenario</button>',
            '  </div>',
            '</div>',

            // ── Planner sub-toolbar ──
            '<div id="ssPlannerToolbar">',
            '  <div class="ss-pt-left">',
            '    <button id="ssAddEmpBtn" class="ss-pt-btn ss-pt-green">&#xFF0B; Add Employee</button>',
            '    <button id="ssRemEmpBtn" class="ss-pt-btn ss-pt-red">&#xFF0D; Remove Employee</button>',
            '    <button class="ss-ctrl-btn" id="ssUndoBtn" disabled>&#8617; Undo</button>',
            '    <button class="ss-ctrl-btn" id="ssRedoBtn" disabled>&#8635; Redo</button>',
            '  </div>',
            '  <div class="ss-pt-right">',
            '    <input type="text" id="ssSearchInput" class="ss-search-input" placeholder="Search employee\u2026">',
            '    <select id="ssDeptFilter" class="ss-dept-select"><option value="">All Departments</option></select>',
            '  </div>',
            '</div>',

            // ── Planner view: full-width chart ──
            '<div id="ssPlannerView" style="display:flex;flex:1;min-height:0;">',
            '  <div id="ssChartPanel">',
            '    <div id="ssChartWrap"><div class="ss-chart-container"></div></div>',
            '    <div id="ssChartEmpty" class="ss-chart-empty">',
            '      <div style="font-size:32px;opacity:0.25;margin-bottom:10px;">&#9997;</div>',
            '      <div>Select or create a scenario to start planning</div>',
            '    </div>',
            '  </div>',
            '</div>',

            // ── Fixed overlay side panel (position:fixed, collapses to the right) ──
            '<div id="ssSidePanel">',

            // Financial Impact (collapsible)
            '  <div id="ssFinancial">',
            '    <div class="ss-coll-hd" id="ssFinancialHd">',
            '      <div class="ss-coll-title">',
            '        <span class="ss-panel-hd-txt">Financial Impact</span>',
            '        <span class="ss-coll-summary" id="ssFinancialSummary"></span>',
            '      </div>',
            '      <span class="ss-coll-arrow" id="ssFinancialArrow">&#9660;</span>',
            '    </div>',
            '    <div class="ss-coll-body" id="ssFinancialBody">',
            '      <div class="ss-panel-empty">Load a scenario to see financial impact.</div>',
            '    </div>',
            '  </div>',

            // Change Log (collapsible)
            '  <div id="ssChangeLog">',
            '    <div class="ss-coll-hd" id="ssChangeLogHd">',
            '      <div class="ss-coll-title">',
            '        <span class="ss-panel-hd-txt">Change Log</span>',
            '        <span class="ss-log-ct" id="ssChangeLogCount" style="display:none;"></span>',
            '      </div>',
            '      <span class="ss-coll-arrow" id="ssChangeLogArrow">&#9660;</span>',
            '    </div>',
            '    <div class="ss-coll-body" id="ssChangeLogBody">',
            '      <div class="ss-panel-empty">Drag employees to reassign. Changes appear here.</div>',
            '    </div>',
            '  </div>',

            '</div>',

            // ── Toggle tab (fixed, moves with panel) ──
            '<div id="ssPanelTab">',
            '  <span id="ssPanelArrow" class="ss-panel-tab-arrow">\u203a</span>',
            '  <span id="ssPanelDot"  class="ss-panel-strip-dot" style="display:none;"></span>',
            '</div>',

            // ── Compare view ──
            '<div id="ssCompareView" style="display:none;flex:1;flex-direction:column;overflow:auto;padding:24px;gap:0;">',
            '  <div class="ss-cmp-selectors">',
            '    <div class="ss-cmp-col">',
            '      <div class="ss-cmp-lbl">Dataset A</div>',
            '      <select id="ssCmpSelA"></select>',
            '    </div>',
            '    <div class="ss-cmp-col">',
            '      <div class="ss-cmp-lbl">Dataset B</div>',
            '      <select id="ssCmpSelB"></select>',
            '    </div>',
            '    <button class="ss-ctrl-btn" id="ssExportBtn" style="align-self:flex-end;">&#8595; Export CSV</button>',
            '  </div>',
            '  <div id="ssCompareContent"></div>',
            '</div>',

            '</div>',  // close ss-desktop-content
        ].join('\n');

        // ── Attach all event listeners (no inline onclick on toolbar buttons) ──
        document.getElementById('ssNewBtn').addEventListener('click', window.ssNewScenario);
        document.getElementById('ssTabPlanner').addEventListener('click', function () { ssSwitchTab('planner'); });
        document.getElementById('ssTabCompare').addEventListener('click', function () { ssSwitchTab('compare'); });
        document.getElementById('ssExitBtn').addEventListener('click', window.ssExitScenario);

        document.getElementById('ssAddEmpBtn').addEventListener('click', function () { window.openAddEmployeeModal(); });
        document.getElementById('ssRemEmpBtn').addEventListener('click', function () { window.openRemoveEmployeeModal(); });
        document.getElementById('ssUndoBtn').addEventListener('click', function () { window.ssUndo(); });
        document.getElementById('ssRedoBtn').addEventListener('click', function () { window.ssRedo(); });

        document.getElementById('ssSearchInput').addEventListener('input', _ssApplySearch);
        document.getElementById('ssSearchInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') _ssApplySearch();
        });
        document.getElementById('ssDeptFilter').addEventListener('change', _ssApplySearch);

        document.getElementById('ssFinancialHd').addEventListener('click', function () {
            _ssTogglePanel('ssFinancialBody', 'ssFinancialArrow', 'ss_financial_collapsed');
        });
        document.getElementById('ssChangeLogHd').addEventListener('click', function () {
            _ssTogglePanel('ssChangeLogBody', 'ssChangeLogArrow', 'ss_changelog_collapsed');
        });

        document.getElementById('ssPanelTab').addEventListener('click', _ssToggleSidePanel);

        // Restore side panel collapse state from sessionStorage
        try { _ssPanelCollapsed = sessionStorage.getItem('ss_panel_collapsed') === 'true'; } catch (e) {}
        _ssApplySidePanelState();

        document.getElementById('ssCmpSelA').addEventListener('change', _ssUpdateCompare);
        document.getElementById('ssCmpSelB').addEventListener('change', _ssUpdateCompare);
        document.getElementById('ssExportBtn').addEventListener('click', window.ssExportCmp);

        // Auto-create Scenario 1 if no scenarios exist and data is loaded
        if (Object.keys(scenarios).length === 0 && allData.filter(function (d) { return !d.isGhost; }).length > 0) {
            var id = saveScenario('Scenario 1', 'Baseline snapshot');
            if (id) loadScenario(id);
        }

        // Restore collapse states from sessionStorage
        _ssRestoreCollapseStates();

        // Start ResizeObserver
        _ssInitResizeObserver();
    }

    // Initialize orgCS if not yet done
    if (!orgCS) {
        try { orgCS = new d3.OrgChart().container('#ssChartWrap .ss-chart-container'); }
        catch (e) {}
    }

    _ssUpdateToolbar();

    var empty = document.getElementById('ssChartEmpty');
    if (empty) empty.style.display = (allData.length && isScenarioMode) ? 'none' : 'flex';

    if (allData.length) {
        if (_ssView === 'planner') {
            _ssPopulateDeptFilter();
            ssRefresh(true);
        } else {
            _ssBuildCmpSelectors();
        }
    }
}
