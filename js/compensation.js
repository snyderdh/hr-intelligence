// ── Compensation Insights Page ──

// ── Module state ──
var compFilters = { dept: '', geoTier: '', manager: '', leadership: '' };
var _compCharts  = [null, null, null];
var _compPanelOpen  = { belowMin: true, flightRisk: true, overdue: true, masterTable: false };
var _compCurrentData = [];
var _compTableSort   = { col: 'name', dir: 'asc' };
var _compTableSearch = '';
var _compEnrichedData = [];  // enriched employee records (populated in renderCompensation)

// ── HTML escape helper ──
const _cEsc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Tier multiplier lookup ──
const _TIER_MULT = { 'Tier 1': 1.0, 'Tier 2': 0.9, 'Tier 3': 0.85, 'Tier 4': 0.8, 'Tier 5': 0.75 };

// ── getBandField ──
// Reads a band field from an employee object, checking both canonical and
// common variant names. Returns 0 if not found or not a valid positive number.
function getBandField(emp) {
    const keys = Array.prototype.slice.call(arguments, 1);
    for (var ki = 0; ki < keys.length; ki++) {
        var val = emp[keys[ki]];
        if (val !== undefined && val !== null && val !== '') {
            var n = parseFloat(String(val).replace(/[$,\s"]/g, ''));
            if (!isNaN(n) && n > 0) return n;
        }
    }
    return 0;
}

// ── enrichCompData ──
// Ensures all comp fields exist on every employee.
// When band data (bandMin/Mid/Max) is already present from a CSV upload, those
// values are used as-is. Fields are only calculated when missing.
function enrichCompData(employees) {
    // FIX 3 diagnostic — shows exactly what data enrichCompData is seeing
    console.log('[Canopy] enrichCompData called. Demo mode:', window._usingDemoData,
        'First employee bandMid raw:', employees.length ? employees[0].bandMid : 'no employees',
        'BandMax raw:', employees.length ? employees[0].BandMax : 'no employees');

    const bandMidByLevel = {
        'IC1': 58000,  'IC2': 75000,  'IC3': 98000,  'IC4': 125000,
        'IC5': 155000, 'IC6': 190000,
        'M1':  120000, 'M2': 145000,  'M3': 170000,  'M4': 200000,
        'M5':  235000, 'M6': 270000,
        'VP':  210000, 'C-Level': 285000
    };
    const geoTierByCity = {
        'San Francisco': 'Tier 1', 'New York': 'Tier 1', 'Seattle': 'Tier 1',
        'Boston': 'Tier 1', 'Washington': 'Tier 1',
        'Los Angeles': 'Tier 2', 'Chicago': 'Tier 2', 'Austin': 'Tier 2',
        'Denver': 'Tier 2', 'San Diego': 'Tier 2', 'Miami': 'Tier 2',
        'Portland': 'Tier 3', 'Atlanta': 'Tier 3', 'Dallas': 'Tier 3',
        'Nashville': 'Tier 3', 'Minneapolis': 'Tier 3', 'Phoenix': 'Tier 3',
        'Salt Lake City': 'Tier 4', 'Indianapolis': 'Tier 4', 'Columbus': 'Tier 4',
        'Kansas City': 'Tier 4', 'Charlotte': 'Tier 4'
    };
    const tierGeoDiff = {
        'Tier 1': '100%', 'Tier 2': '90%', 'Tier 3': '85%',
        'Tier 4': '80%',  'Tier 5': '75%'
    };
    const _pf = v => parseFloat(String(v || 0).replace(/[$,\s"]/g, '')) || 0;

    // ── Diagnostic: confirm band data is being read ──
    const _diagSample = employees.find(function(e) { return !e.isGhost; });
    if (_diagSample) {
        const _dMin = getBandField(_diagSample, 'bandMin', 'BandMin', 'min');
        const _dMid = getBandField(_diagSample, 'bandMid', 'BandMid', 'mid', 'midpoint');
        const _dMax = getBandField(_diagSample, 'bandMax', 'BandMax', 'max');
        console.log('[Canopy] Band check — bandMin:', _dMin,
            'bandMid:', _dMid, 'bandMax:', _dMax,
            'hasExistingBands:', _dMin > 0 && _dMid > 0 && _dMax > 0);
    }

    return employees.map(function (emp) {
        if (emp.isGhost) return emp;

        const salary = _pf(emp.salary);

        // Check 1 — valid band values already present (CSV upload or sampleData.js)
        // Uses getBandField to tolerate original-case CSV column names that
        // weren't normalised (e.g. BandMax, Q1 stored directly on the object).
        const hasExistingBands = (
            getBandField(emp, 'bandMid', 'BandMid', 'mid', 'midpoint') > 0 &&
            getBandField(emp, 'bandMin', 'BandMin', 'min') > 0 &&
            getBandField(emp, 'bandMax', 'BandMax', 'max') > 0
        );

        // Check 2 — valid geoTier already present
        const VALID_TIERS = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5'];
        const hasExistingGeoTier = emp.geoTier && VALID_TIERS.includes(String(emp.geoTier).trim());

        let adjMin, adjQ1, adjMid, adjQ3, adjMax, geoTier, geoDiff;

        if (hasExistingBands) {
            // Use CSV-supplied band values — never overwrite with calculations
            adjMin  = getBandField(emp, 'bandMin', 'BandMin', 'band_min', 'min');
            adjMax  = getBandField(emp, 'bandMax', 'BandMax', 'band_max', 'max');
            adjMid  = getBandField(emp, 'bandMid', 'BandMid', 'band_mid', 'mid', 'midpoint');
            // Q1/Q3: use CSV value if present; otherwise interpolate from Min/Max
            const _q1val = getBandField(emp, 'bandQ1', 'BandQ1', 'Q1', 'q1', 'band_q1');
            const _q3val = getBandField(emp, 'bandQ3', 'BandQ3', 'Q3', 'q3', 'band_q3');
            adjQ1   = _q1val > 0 ? _q1val : adjMin + (adjMax - adjMin) * 0.25;
            adjQ3   = _q3val > 0 ? _q3val : adjMin + (adjMax - adjMin) * 0.75;
            geoTier = hasExistingGeoTier
                        ? String(emp.geoTier).trim()
                        : (geoTierByCity[(emp.city || '').trim()] || 'Tier 3');
            geoDiff = tierGeoDiff[geoTier] || '85%';
        } else {
            // No band data — calculate from jobLevel + city
            const baseMid = bandMidByLevel[emp.jobLevel] || 85000;
            geoTier = hasExistingGeoTier
                        ? String(emp.geoTier).trim()
                        : (geoTierByCity[(emp.city || '').trim()] || 'Tier 3');
            const mult = _TIER_MULT[geoTier] || 0.85;
            geoDiff = tierGeoDiff[geoTier] || '85%';
            adjMin  = Math.round(baseMid * 0.75  * mult / 1000) * 1000;
            adjQ1   = Math.round(baseMid * 0.875 * mult / 1000) * 1000;
            adjMid  = Math.round(baseMid          * mult / 1000) * 1000;
            adjQ3   = Math.round(baseMid * 1.125 * mult / 1000) * 1000;
            adjMax  = Math.round(baseMid * 1.25  * mult / 1000) * 1000;
        }

        // Always re-derive compaRatio and quartile from the final band values
        const compaRatio = adjMid > 0 ? Math.round((salary / adjMid) * 100) / 100 : 0;

        var quartile = 'Q2';
        if      (salary < adjMin)  quartile = 'Below Min';
        else if (salary < adjQ1)   quartile = 'Q1';
        else if (salary < adjMid)  quartile = 'Q2';
        else if (salary < adjQ3)   quartile = 'Q3';
        else if (salary <= adjMax) quartile = 'Q4';
        else                       quartile = 'Above Max';

        var lastPayIncrease = emp.lastPayIncrease || '';
        if (!lastPayIncrease) {
            var monthsAgo = 6 + Math.floor(Math.random() * 18);
            var d = new Date(2026, 1, 25);
            d.setMonth(d.getMonth() - monthsAgo);
            lastPayIncrease = d.toISOString().split('T')[0];
        }

        return Object.assign({}, emp, {
            salary,
            bandMin: adjMin, bandQ1: adjQ1, bandMid: adjMid,
            bandQ3:  adjQ3,  bandMax: adjMax,
            geoTier, geoDiff,
            compaRatio, quartile,
            belowMin: salary < adjMin,
            aboveMax: salary > adjMax,
            lastPayIncrease
        });
    });
}

// ── getTenureYears ──
function getTenureYears(startDate) {
    const s = new Date(startDate);
    if (isNaN(s)) return null;
    return (Date.now() - s) / (1000 * 60 * 60 * 24 * 365.25);
}

// ── getMonthsSinceIncrease ──
function getMonthsSinceIncrease(lastPayIncrease) {
    if (!lastPayIncrease) return null;
    const d = new Date(lastPayIncrease);
    if (isNaN(d)) return null;
    return (Date.now() - d) / (1000 * 60 * 60 * 24 * 30.44);
}

// ── isFlightRisk ──
function isFlightRisk(emp) {
    const rating  = pRat(emp.rating);
    const cr      = emp.compaRatio;
    const tenure  = getTenureYears(emp.startDate);
    if (rating === 'NR' || cr == null || tenure === null) return false;
    if (rating >= 4 && cr < 1.0 && tenure > 1) return true;
    if (rating === 3 && cr < 1.0 && tenure > 2) return true;
    return false;
}

// ── getFilteredCompData ──
function getFilteredCompData() {
    let data = _compEnrichedData.slice();   // use enriched snapshot, not raw allData
    const f = compFilters;

    if (f.dept) {
        data = data.filter(d => d.department === f.dept);
    }
    if (f.geoTier) {
        data = data.filter(d => d.geoTier === f.geoTier);
    }
    if (f.manager) {
        const collect = id => {
            const real = allData.filter(d => !d.isGhost);
            const directs = real.filter(d => d.parentId === id);
            let result = [];
            directs.forEach(d => { result.push(d); result = result.concat(collect(d.id)); });
            return result;
        };
        const mgrEmp = data.find(d => d.id === f.manager);
        const subs   = collect(f.manager).filter(d => data.some(e => e.id === d.id));
        data = mgrEmp ? [mgrEmp, ...subs.filter(d => d.id !== mgrEmp.id)] : subs;
    }
    if (f.leadership) {
        const managerIds = new Set(allData.filter(d => !d.isGhost).map(d => d.parentId).filter(Boolean));
        if (f.leadership === 'vp') {
            data = data.filter(d => ['VP', 'C-Level'].includes(d.jobLevel));
        } else if (f.leadership === 'director') {
            data = data.filter(d => ['VP', 'C-Level'].includes(d.jobLevel));
        } else if (f.leadership === 'manager') {
            data = data.filter(d => managerIds.has(d.id) || ['VP', 'C-Level'].includes(d.jobLevel));
        }
    }
    return data;
}

// ── computeCompMetrics ──
function computeCompMetrics(data) {
    const sals        = data.map(d => cleanSal(d.salary)).filter(s => s > 0);
    const totalPayroll = sals.reduce((a, b) => a + b, 0);
    const withCR      = data.filter(d => d.compaRatio != null);
    const avgCR       = withCR.length ? withCR.reduce((s, d) => s + d.compaRatio, 0) / withCR.length : 0;
    const belowMinCount = data.filter(d => d.belowMin === true).length;
    const aboveMaxCount = data.filter(d => d.aboveMax === true).length;
    const flightRiskCount = data.filter(isFlightRisk).length;
    const overdueCount = data.filter(d => {
        const mo = getMonthsSinceIncrease(d.lastPayIncrease);
        return mo !== null && mo >= 18;
    }).length;
    const belowMidCount = data.filter(d => d.compaRatio != null && d.compaRatio < 1.0).length;
    const aboveMidCount = data.filter(d => d.compaRatio != null && d.compaRatio >= 1.0).length;
    const costToFix = data
        .filter(d => d.belowMin === true)
        .reduce((sum, d) => sum + Math.max(0, (d.bandMin || 0) - cleanSal(d.salary)), 0);

    const tierCounts = {};
    data.forEach(d => { if (d.geoTier) tierCounts[d.geoTier] = (tierCounts[d.geoTier] || 0) + 1; });
    const tierEntries    = Object.entries(tierCounts).sort((a, b) => b[1] - a[1]);
    const mostCommonTier = tierEntries[0] ? tierEntries[0][0] : '—';
    const tierCount      = tierEntries.length;
    const locCount       = new Set(data.map(d => [d.city, d.state].filter(Boolean).join(', ')).filter(Boolean)).size;

    return {
        totalPayroll, avgCR, belowMinCount, aboveMaxCount, flightRiskCount,
        overdueCount, belowMidCount, aboveMidCount, costToFix,
        mostCommonTier, tierCount, locCount, total: data.length,
    };
}

// ─────────────────────────────────────────────────────
// ── Main render entry point ──
// ─────────────────────────────────────────────────────
function renderCompensation() {
    const el = g('pageCompensation');
    if (!el) return;

    // ── DIAGNOSTIC (remove after confirming data pipeline) ──
    const _diagSample = allData.filter(d => !d.isGhost).slice(0, 3);
    console.log('COMP DIAGNOSTIC — sample employees:', JSON.stringify(_diagSample.map(d => ({
        name: d.name, salary: d.salary,
        bandMid: d.bandMid, bandMin: d.bandMin, bandMax: d.bandMax,
        compaRatio: d.compaRatio, quartile: d.quartile,
        geoTier: d.geoTier, geoDiff: d.geoDiff,
        belowMin: d.belowMin, aboveMax: d.aboveMax,
        lastPayIncrease: d.lastPayIncrease
    })), null, 2));

    // ── Enrich data (no-op when fields already present in sampleData.js) ──
    _compEnrichedData = enrichCompData(allData.filter(d => !d.isGhost));

    const real = _compEnrichedData;
    if (!real.length) {
        el.innerHTML = `
        <div class="comp-empty">
            <div class="comp-empty-icon">💰</div>
            <p class="comp-empty-text">Load data to view compensation insights</p>
        </div>`;
        return;
    }

    // Destroy existing chart instances before rebuilding DOM
    _compCharts.forEach((c, i) => {
        if (c) { try { c.destroy(); } catch (e) {} _compCharts[i] = null; }
    });

    const data    = getFilteredCompData();
    _compCurrentData = data;
    const metrics = computeCompMetrics(data);

    // Filter option lists (from full enriched data, not filtered subset)
    const depts    = [...new Set(real.map(d => d.department).filter(Boolean))].sort();
    const tiers    = [...new Set(real.map(d => d.geoTier).filter(Boolean))].sort();
    const managers = real
        .filter(d => real.some(e => e.parentId === d.id))
        .map(d => d.id).sort();

    el.innerHTML = `
<div class="comp-header">
    <div class="comp-title">Compensation Insights</div>
    <div class="comp-subtitle">Pay equity, band placement &amp; compensation risk</div>
</div>

<div class="comp-filters-bar">
    <select class="comp-filter-sel" onchange="compSetFilter('dept', this.value)">
        <option value="">All Departments</option>
        ${depts.map(d => `<option value="${_cEsc(d)}"${compFilters.dept === d ? ' selected' : ''}>${_cEsc(d)}</option>`).join('')}
    </select>
    <select class="comp-filter-sel" onchange="compSetFilter('geoTier', this.value)">
        <option value="">All Tiers</option>
        ${tiers.map(t => `<option value="${_cEsc(t)}"${compFilters.geoTier === t ? ' selected' : ''}>${_cEsc(t)}</option>`).join('')}
    </select>
    <select class="comp-filter-sel" onchange="compSetFilter('manager', this.value)">
        <option value="">All Managers</option>
        ${managers.map(m => `<option value="${_cEsc(m)}"${compFilters.manager === m ? ' selected' : ''}>${_cEsc(m)}</option>`).join('')}
    </select>
    <select class="comp-filter-sel" onchange="compSetFilter('leadership', this.value)">
        <option value="">All Levels</option>
        <option value="vp"${compFilters.leadership === 'vp' ? ' selected' : ''}>VP &amp; Above</option>
        <option value="director"${compFilters.leadership === 'director' ? ' selected' : ''}>Director &amp; Above</option>
        <option value="manager"${compFilters.leadership === 'manager' ? ' selected' : ''}>Manager &amp; Above</option>
    </select>
    <button class="toolbar-reset-btn" onclick="compResetFilters()">↺ Reset Filters</button>
    <span class="comp-filter-count">${data.length} of ${real.length} employees</span>
</div>

<div class="comp-page-body">

    <!-- ── Section 1: Summary Cards ── -->
    <div class="comp-cards-grid">
        ${_buildCompCards(data, metrics)}
    </div>

    <!-- ── Section 2: Charts ── -->
    <div class="comp-charts-row">
        <div class="comp-chart-card">
            <div class="comp-section-hd">Compa-Ratio Distribution</div>
            <div class="comp-section-sub">How employees are distributed relative to their band midpoint</div>
            <div class="comp-chart-wrap"><canvas id="compChartA"></canvas></div>
        </div>
        <div class="comp-chart-card">
            <div class="comp-section-hd">Pay Band Placement by Department</div>
            <div class="comp-chart-wrap" style="height:300px;"><canvas id="compChartB"></canvas></div>
        </div>
    </div>
    <div class="comp-chart-card comp-chart-card-wide">
        <div class="comp-section-hd">Salary Range by Job Level</div>
        <div class="comp-section-sub">Actual salary spread vs compensation band midpoint</div>
        <div class="comp-chart-wrap"><canvas id="compChartC"></canvas></div>
    </div>

    <!-- ── Section 3: Action Tables ── -->
    <div class="comp-section-label">Priority Action Items</div>
    ${_buildCompActionTables(data)}

    <!-- ── Section 4: Geo Tier Analysis ── -->
    ${_buildCompGeoTier(data, real)}

    <!-- ── Section 5: Master Table ── -->
    ${_buildCompMasterTable(data)}

</div>`;

    // Build charts after DOM paint
    requestAnimationFrame(() => {
        _buildCompChartA(data);
        _buildCompChartB(data);
        _buildCompChartC(data);
    });
}

// ─────────────────────────────────────────────────────
// ── Section builders ──
// ─────────────────────────────────────────────────────

function _buildCompCards(data, metrics) {
    const { totalPayroll, avgCR, belowMinCount, aboveMaxCount, flightRiskCount,
            overdueCount, belowMidCount, aboveMidCount, costToFix,
            mostCommonTier, tierCount, locCount, total } = metrics;

    // Card 2: compa-ratio color + sub text
    let crColor, crText;
    if      (avgCR >= 0.95 && avgCR <= 1.05) { crColor = 'var(--green)'; crText = 'At midpoint'; }
    else if (avgCR > 1.05  && avgCR <= 1.15) { crColor = 'var(--amber)'; crText = 'Above midpoint'; }
    else if (avgCR >= 0.85 && avgCR < 0.95)  { crColor = 'var(--amber)'; crText = 'Below midpoint'; }
    else if (avgCR > 1.15)                   { crColor = 'var(--red)';   crText = 'Significantly above midpoint'; }
    else                                      { crColor = 'var(--red)';   crText = 'Below midpoint'; }

    // Card 7: segmented salary vs midpoint bar
    const totalMid = belowMidCount + aboveMidCount;
    const belowPct = totalMid ? Math.round((belowMidCount / totalMid) * 100) : 0;
    const abovePct = 100 - belowPct;
    const midBar = totalMid
        ? `<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:8px;">
               ${belowMidCount ? `<div style="flex:${belowMidCount};background:#ef7a44;"></div>` : ''}
               ${aboveMidCount ? `<div style="flex:${aboveMidCount};background:#2d9b6f;"></div>` : ''}
           </div>
           <div class="comp-card-sub">${belowPct}% below midpoint · ${abovePct}% above midpoint</div>`
        : '<div class="comp-card-sub">No compa-ratio data</div>';

    return `
    <div class="comp-card">
        <div class="comp-card-title">Total Payroll</div>
        <div class="comp-card-val">${fmtM(totalPayroll)}</div>
        <div class="comp-card-sub">across ${total} employees</div>
    </div>
    <div class="comp-card">
        <div class="comp-card-title">Avg Compa-Ratio</div>
        <div class="comp-card-val">${avgCR.toFixed(2)}</div>
        <div class="comp-card-sub" style="color:${crColor};font-weight:700;">${crText}</div>
    </div>
    <div class="comp-card${belowMinCount > 0 ? ' comp-card-tint-red' : ''}">
        <div class="comp-card-title">Below Band Min</div>
        <div class="comp-card-val${belowMinCount > 0 ? ' comp-val-red' : ''}">${belowMinCount}</div>
        <div class="comp-card-sub">employees below band minimum</div>
        ${belowMinCount > 0 ? `<div class="comp-card-cost">+ ${fmtK(costToFix)} to bring all to minimum</div>` : ''}
    </div>
    <div class="comp-card${aboveMaxCount > 0 ? ' comp-card-tint-amber' : ''}">
        <div class="comp-card-title">Above Band Max</div>
        <div class="comp-card-val${aboveMaxCount > 0 ? ' comp-val-amber' : ''}">${aboveMaxCount}</div>
        <div class="comp-card-sub">employees above band maximum</div>
    </div>
    <div class="comp-card${flightRiskCount > 0 ? ' comp-card-tint-red' : ''}">
        <div class="comp-card-title">Flight Risk</div>
        <div class="comp-card-val${flightRiskCount > 0 ? ' comp-val-red' : ''}">${flightRiskCount}</div>
        <div class="comp-card-sub">high/mid performers underpaid vs tenure</div>
    </div>
    <div class="comp-card${overdueCount > 0 ? ' comp-card-tint-amber' : ''}">
        <div class="comp-card-title">Overdue Increases</div>
        <div class="comp-card-val${overdueCount > 0 ? ' comp-val-amber' : ''}">${overdueCount}</div>
        <div class="comp-card-sub">employees overdue for review (18+ months)</div>
    </div>
    <div class="comp-card">
        <div class="comp-card-title">Salary vs Band Mid</div>
        <div class="comp-card-val-bar">${midBar}</div>
    </div>
    <div class="comp-card">
        <div class="comp-card-title">Geo Tier Breakdown</div>
        <div class="comp-card-val comp-val-geo">${_cEsc(mostCommonTier)}</div>
        <div class="comp-card-sub">${locCount} location${locCount !== 1 ? 's' : ''} across ${tierCount} tier${tierCount !== 1 ? 's' : ''}</div>
    </div>`;
}

function _buildCompActionTables(data) {
    const esc = _cEsc;

    // ── TABLE A: Below Minimum ──
    const belowMinEmps = data
        .filter(d => d.belowMin === true)
        .map(d => {
            const sal    = cleanSal(d.salary);
            const gap    = Math.max(0, (d.bandMin || 0) - sal);
            const gapPct = sal > 0 ? ((gap / sal) * 100).toFixed(1) : '—';
            const mgr    = allData.find(e => e.id === d.parentId && !e.isGhost);
            return { ...d, _sal: sal, _gap: gap, _gapPct: gapPct, _mgrName: mgr ? mgr.name : '—' };
        })
        .sort((a, b) => b._gap - a._gap);

    const totalGap    = belowMinEmps.reduce((s, d) => s + d._gap, 0);
    const belowMinOpen = _compPanelOpen.belowMin;

    const belowMinBody = belowMinEmps.length === 0
        ? `<div class="comp-ok-state">✓ No employees are below their band minimum</div>`
        : `<div class="an-table-wrap"><table class="an-table">
            <thead><tr>
                <th>Employee</th><th>Title</th><th>Dept</th><th>Geo Tier</th>
                <th>Current Salary</th><th>Band Min</th><th>Gap ($)</th><th>Gap (%)</th><th>Manager</th>
            </tr></thead>
            <tbody>${belowMinEmps.map((d, i) => `<tr class="${i % 2 ? 'an-alt' : ''}">
                <td class="an-lbl">${esc(d.name)}</td>
                <td>${esc(d.title || '—')}</td>
                <td>${esc(d.department || '—')}</td>
                <td>${esc(d.geoTier || '—')}</td>
                <td>${fmtN(d._sal)}</td>
                <td>${fmtN(d.bandMin || 0)}</td>
                <td style="color:var(--red);font-weight:700;">−${fmtN(d._gap)}</td>
                <td style="color:var(--red);font-weight:700;">${d._gapPct}%</td>
                <td>${esc(d._mgrName)}</td>
            </tr>`).join('')}</tbody>
          </table></div>`;

    // ── TABLE B: Flight Risk ──
    const flightEmps = data
        .filter(isFlightRisk)
        .map(d => {
            const rating  = pRat(d.rating);
            const tenure  = getTenureYears(d.startDate);
            const isHigh  = rating >= 4 && (d.compaRatio || 0) < 0.90;
            return { ...d, _rating: rating, _tenure: tenure, _isHigh: isHigh };
        })
        .sort((a, b) => {
            if (a._isHigh !== b._isHigh) return (b._isHigh ? 1 : 0) - (a._isHigh ? 1 : 0);
            return (a.compaRatio || 0) - (b.compaRatio || 0);
        });

    const flightOpen = _compPanelOpen.flightRisk;
    const flightBadgeClass = flightEmps.some(d => d._isHigh) ? 'comp-badge-count-red'
        : flightEmps.length > 0 ? 'comp-badge-count-amber' : 'comp-badge-count';

    const flightBody = flightEmps.length === 0
        ? `<div class="comp-ok-state">✓ No flight risk employees identified</div>`
        : `<div class="an-table-wrap"><table class="an-table">
            <thead><tr>
                <th>Employee</th><th>Title</th><th>Dept</th><th>Rating</th>
                <th>Tenure</th><th>Salary</th><th>Band Mid</th><th>Compa-Ratio</th>
                <th>Quartile</th><th>Last Increase</th><th>Risk Level</th>
            </tr></thead>
            <tbody>${flightEmps.map((d, i) => {
                const stars   = d._rating === 'NR' ? 'NR' : '★'.repeat(d._rating) + '☆'.repeat(5 - d._rating);
                const tenStr  = d._tenure !== null ? d._tenure.toFixed(1) + ' yr' : '—';
                const cr      = d.compaRatio || 0;
                const crColor = cr < 0.85 ? 'var(--red)' : 'var(--amber)';
                const badge   = d._isHigh
                    ? '<span class="comp-badge-high">HIGH</span>'
                    : '<span class="comp-badge-moderate">MODERATE</span>';
                return `<tr class="${i % 2 ? 'an-alt' : ''}">
                    <td class="an-lbl">${esc(d.name)}</td>
                    <td>${esc(d.title || '—')}</td>
                    <td>${esc(d.department || '—')}</td>
                    <td style="color:var(--amber);letter-spacing:-1px;">${stars}</td>
                    <td>${tenStr}</td>
                    <td>${fmtN(cleanSal(d.salary))}</td>
                    <td>${d.bandMid ? fmtN(d.bandMid) : '—'}</td>
                    <td style="color:${crColor};font-weight:700;">${cr.toFixed(2)}</td>
                    <td>${esc(d.quartile || '—')}</td>
                    <td>${esc(d.lastPayIncrease || '—')}</td>
                    <td>${badge}</td>
                </tr>`;
            }).join('')}</tbody>
          </table></div>`;

    // ── TABLE C: Overdue Pay Reviews ──
    const overdueEmps = data
        .map(d => ({ ...d, _months: getMonthsSinceIncrease(d.lastPayIncrease) }))
        .filter(d => d._months !== null && d._months >= 18)
        .sort((a, b) => b._months - a._months);

    const overdueOpen = _compPanelOpen.overdue;
    const overdueBody = overdueEmps.length === 0
        ? `<div class="comp-ok-state">✓ No employees are overdue for pay review</div>`
        : `<div class="an-table-wrap"><table class="an-table">
            <thead><tr>
                <th>Employee</th><th>Title</th><th>Dept</th><th>Rating</th>
                <th>Current Salary</th><th>Compa-Ratio</th><th>Last Increase</th>
                <th>Months Since</th><th>Band Position</th>
            </tr></thead>
            <tbody>${overdueEmps.map((d, i) => {
                const mo      = Math.round(d._months);
                const moColor = mo > 24 ? 'var(--red)' : 'var(--amber)';
                const rating  = pRat(d.rating);
                const stars   = rating === 'NR' ? '—' : '★'.repeat(rating) + '☆'.repeat(5 - rating);
                const cr      = d.compaRatio || 0;
                const crColor = cr < 0.85 ? 'var(--red)' : cr > 1.15 ? 'var(--accent)' : 'inherit';
                return `<tr class="${i % 2 ? 'an-alt' : ''}">
                    <td class="an-lbl">${esc(d.name)}</td>
                    <td>${esc(d.title || '—')}</td>
                    <td>${esc(d.department || '—')}</td>
                    <td style="color:var(--amber);letter-spacing:-1px;">${stars}</td>
                    <td>${fmtN(cleanSal(d.salary))}</td>
                    <td style="color:${crColor};font-weight:700;">${cr.toFixed(2)}</td>
                    <td>${esc(d.lastPayIncrease || '—')}</td>
                    <td style="color:${moColor};font-weight:700;">${mo} mo</td>
                    <td>${esc(d.quartile || '—')}</td>
                </tr>`;
            }).join('')}</tbody>
          </table></div>`;

    return `
    <div class="comp-action-card">
        <div class="comp-action-hdr" onclick="compTogglePanel('belowMin')">
            <div class="comp-action-hdr-left">
                <span class="comp-action-icon">🚨</span>
                <span class="comp-action-title">Below Minimum Band</span>
                <span class="comp-badge-count${belowMinEmps.length > 0 ? '-red' : ''}">${belowMinEmps.length}</span>
                ${belowMinEmps.length > 0 ? `<span class="comp-remediate">Cost to remediate: ${fmtK(totalGap)}</span>` : ''}
            </div>
            <span class="comp-toggle-btn" id="compArrow_belowMin">${belowMinOpen ? '▲' : '▼'}</span>
        </div>
        <div class="comp-action-body" id="compPanel_belowMin" style="display:${belowMinOpen ? 'block' : 'none'};">
            ${belowMinBody}
        </div>
    </div>

    <div class="comp-action-card">
        <div class="comp-action-hdr" onclick="compTogglePanel('flightRisk')">
            <div class="comp-action-hdr-left">
                <span class="comp-action-icon">✈️</span>
                <span class="comp-action-title">Flight Risk Employees</span>
                <span class="${flightBadgeClass}">${flightEmps.length}</span>
            </div>
            <span class="comp-toggle-btn" id="compArrow_flightRisk">${flightOpen ? '▲' : '▼'}</span>
        </div>
        <div class="comp-action-body" id="compPanel_flightRisk" style="display:${flightOpen ? 'block' : 'none'};">
            ${flightBody}
        </div>
    </div>

    <div class="comp-action-card">
        <div class="comp-action-hdr" onclick="compTogglePanel('overdue')">
            <div class="comp-action-hdr-left">
                <span class="comp-action-icon">🕐</span>
                <span class="comp-action-title">Overdue for Pay Review</span>
                <span class="comp-badge-count${overdueEmps.length > 0 ? '-amber' : ''}">${overdueEmps.length}</span>
            </div>
            <span class="comp-toggle-btn" id="compArrow_overdue">${overdueOpen ? '▲' : '▼'}</span>
        </div>
        <div class="comp-action-body" id="compPanel_overdue" style="display:${overdueOpen ? 'block' : 'none'};">
            ${overdueBody}
        </div>
    </div>`;
}

function _buildCompGeoTier(data, real) {
    const esc   = _cEsc;
    const tiers = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5'];

    function hexToRgba(hex, a) {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0,2),16), gg = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
        return `rgba(${r},${gg},${b},${a})`;
    }

    const tierCards = tiers.map(tier => {
        const emps  = data.filter(d => d.geoTier === tier);
        if (!emps.length) {
            return `<div class="comp-geo-tier-card comp-geo-empty">
                <div class="comp-geo-tier-lbl">${tier}</div>
                <div class="comp-geo-tier-count comp-geo-count-empty">0</div>
                <div class="comp-geo-tier-sub">No employees</div>
            </div>`;
        }
        const sals  = emps.map(d => cleanSal(d.salary)).filter(s => s > 0);
        const avgSal = sals.length ? sals.reduce((a, b) => a + b, 0) / sals.length : 0;
        const withCR = emps.filter(d => d.compaRatio != null);
        const avgCR  = withCR.length ? withCR.reduce((s, d) => s + d.compaRatio, 0) / withCR.length : 0;
        const diff   = emps[0] ? (emps[0].geoDiff || '') : '';
        return `<div class="comp-geo-tier-card">
            <div class="comp-geo-tier-lbl">${tier}</div>
            <div class="comp-geo-tier-count">${emps.length}</div>
            <div class="comp-geo-tier-sub">${diff} geo · ${avgCR.toFixed(2)} avg CR</div>
            <div class="comp-geo-tier-sal">${fmtK(avgSal)} avg salary</div>
        </div>`;
    });

    // Dept × Geo Tier matrix
    const depts       = [...new Set(data.map(d => d.department).filter(Boolean))].sort();
    const activeTiers = tiers.filter(t => data.some(d => d.geoTier === t));

    const matrixRows = depts.map((dept, di) => {
        const col   = deptCol[dept] || '#64748b';
        const cells = activeTiers.map(tier => {
            const cnt = data.filter(d => d.department === dept && d.geoTier === tier).length;
            if (!cnt) return '<td class="geo-mcell geo-mcell-empty">—</td>';
            const op = cnt === 1 ? 0.22 : cnt <= 3 ? 0.45 : cnt <= 6 ? 0.70 : 0.90;
            return `<td class="geo-mcell" style="background:${hexToRgba(col, op)};color:${cnt >= 4 ? '#fff' : col};font-weight:800;">${cnt}</td>`;
        }).join('');
        return `<tr class="${di % 2 ? 'an-alt' : ''}">
            <td class="geo-mdept">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px;vertical-align:middle;"></span>
                ${esc(dept)}
            </td>
            ${cells}
        </tr>`;
    }).join('');

    // Cost implications
    const actualTotal = data.map(d => cleanSal(d.salary)).reduce((a, b) => a + b, 0);

    // Recalculate: each employee's salary = compaRatio × bandMidBase × tierMultiplier
    // bandMidBase = bandMid / currentTierMultiplier (remove geo adjustment)
    const hypoT1 = data.reduce((sum, d) => {
        const mult     = _TIER_MULT[d.geoTier] || 1.0;
        const midBase  = (d.bandMid || 0) / mult;
        return sum + (d.compaRatio || 1.0) * midBase * 1.0;
    }, 0);
    const hypoT3 = data.reduce((sum, d) => {
        const mult    = _TIER_MULT[d.geoTier] || 1.0;
        const midBase = (d.bandMid || 0) / mult;
        return sum + (d.compaRatio || 1.0) * midBase * 0.85;
    }, 0);
    const delta    = actualTotal - hypoT3;
    const deltaStr = delta >= 0
        ? `<span style="color:var(--red);font-weight:700;">+${fmtM(Math.abs(delta))} premium vs Tier 3</span>`
        : `<span style="color:var(--green);font-weight:700;">−${fmtM(Math.abs(delta))} savings vs Tier 3</span>`;

    return `
    <div class="comp-full-card">
        <div class="comp-section-hd">Geo Tier Impact</div>

        <div class="comp-geo-strip">${tierCards.join('')}</div>

        ${activeTiers.length && depts.length ? `
        <div style="margin-top:20px;">
            <div class="an-hd" style="margin-bottom:10px;">Department × Geo Tier Matrix</div>
            <div class="an-table-wrap"><table class="an-table geo-matrix">
                <thead><tr>
                    <th>Department</th>
                    ${activeTiers.map(t => `<th>${esc(t)}</th>`).join('')}
                </tr></thead>
                <tbody>${matrixRows}</tbody>
            </table></div>
        </div>` : ''}

        <div class="comp-cost-section">
            <div class="an-hd" style="margin-bottom:14px;">Cost Implications</div>
            <div class="comp-cost-grid">
                <div class="comp-cost-row">
                    <span class="comp-cost-lbl">Total payroll at current geo mix</span>
                    <span class="comp-cost-val">${fmtM(actualTotal)}</span>
                </div>
                <div class="comp-cost-row">
                    <span class="comp-cost-lbl">Hypothetical if all Tier 1 (no geo discount)</span>
                    <span class="comp-cost-val">${fmtM(hypoT1)}</span>
                </div>
                <div class="comp-cost-row">
                    <span class="comp-cost-lbl">Hypothetical if geo-optimized (all Tier 3 · ×0.85)</span>
                    <span class="comp-cost-val">${fmtM(hypoT3)}</span>
                </div>
                <div class="comp-cost-row comp-cost-delta">
                    <span class="comp-cost-lbl">Current vs Tier 3 optimized</span>
                    <span class="comp-cost-val">${deltaStr}</span>
                </div>
            </div>
        </div>
    </div>`;
}

function _buildCompMasterTable(data) {
    const isOpen = _compPanelOpen.masterTable;
    return `
    <div class="comp-action-card">
        <div class="comp-action-hdr" onclick="compTogglePanel('masterTable')">
            <div class="comp-action-hdr-left">
                <span class="comp-action-title">All Employees — Compensation Detail</span>
                <span class="comp-badge-count">${data.length}</span>
            </div>
            <span class="comp-toggle-btn" id="compArrow_masterTable">${isOpen ? '▲' : '▼'}</span>
        </div>
        <div class="comp-action-body" id="compPanel_masterTable" style="display:${isOpen ? 'block' : 'none'};">
            <div class="comp-master-search-wrap">
                <input type="text" class="comp-master-search"
                    placeholder="Search by name or department…"
                    value="${_cEsc(_compTableSearch)}"
                    oninput="compSearchTable(this.value)">
            </div>
            <div class="an-table-wrap">
                <table class="an-table comp-master-table" id="compMasterTable">
                    <thead id="compMasterTableHead">${_buildMasterTableHeader()}</thead>
                    <tbody id="compMasterTableBody">${_buildMasterTableRows()}</tbody>
                </table>
            </div>
        </div>
    </div>`;
}

function _buildMasterTableHeader() {
    const cols = [
        { key: 'name',         label: 'Employee' },
        { key: 'title',        label: 'Title' },
        { key: 'dept',         label: 'Dept' },
        { key: 'level',        label: 'Level' },
        { key: 'location',     label: 'Location' },
        { key: 'geoTier',      label: 'Geo Tier' },
        { key: 'salary',       label: 'Salary' },
        { key: 'bandMin',      label: 'Band Min' },
        { key: 'bandMid',      label: 'Band Mid' },
        { key: 'bandMax',      label: 'Band Max' },
        { key: 'compaRatio',   label: 'Compa-Ratio' },
        { key: 'quartile',     label: 'Quartile' },
        { key: 'rating',       label: 'Rating' },
        { key: 'tenure',       label: 'Tenure' },
        { key: 'lastIncrease', label: 'Last Increase' },
        { key: 'monthsSince',  label: 'Months Since' },
        { key: 'belowMin',     label: 'Below Min' },
        { key: 'aboveMax',     label: 'Above Max' },
    ];
    const s = _compTableSort;
    return `<tr>${cols.map(c => {
        const arrow = s.col === c.key ? (s.dir === 'asc' ? ' ↑' : ' ↓') : '';
        return `<th onclick="compSortTable('${c.key}')" style="cursor:pointer;white-space:nowrap;user-select:none;">${c.label}${arrow}</th>`;
    }).join('')}</tr>`;
}

function _buildMasterTableRows() {
    const esc = _cEsc;
    let rows  = [..._compCurrentData];

    // Search filter
    if (_compTableSearch) {
        const q = _compTableSearch.toLowerCase();
        rows = rows.filter(d =>
            (d.name || '').toLowerCase().includes(q) ||
            (d.department || '').toLowerCase().includes(q)
        );
    }

    // Sort
    const s = _compTableSort;
    const getSortVal = d => {
        switch (s.col) {
            case 'name':         return (d.name || '').toLowerCase();
            case 'title':        return (d.title || '').toLowerCase();
            case 'dept':         return (d.department || '').toLowerCase();
            case 'level':        return (d.jobLevel || '').toLowerCase();
            case 'location':     return [d.city, d.state].filter(Boolean).join(', ').toLowerCase();
            case 'geoTier':      return (d.geoTier || '').toLowerCase();
            case 'salary':       return cleanSal(d.salary);
            case 'bandMin':      return d.bandMin || 0;
            case 'bandMid':      return d.bandMid || 0;
            case 'bandMax':      return d.bandMax || 0;
            case 'compaRatio':   return d.compaRatio || 0;
            case 'quartile':     return (d.quartile || '').toLowerCase();
            case 'rating':       { const r = pRat(d.rating); return r === 'NR' ? -1 : r; }
            case 'tenure':       return getTenureYears(d.startDate) || 0;
            case 'lastIncrease': return d.lastPayIncrease || '';
            case 'monthsSince':  return getMonthsSinceIncrease(d.lastPayIncrease) || 0;
            case 'belowMin':     return d.belowMin ? 1 : 0;
            case 'aboveMax':     return d.aboveMax ? 1 : 0;
            default:             return '';
        }
    };
    rows.sort((a, b) => {
        const va = getSortVal(a), vb = getSortVal(b);
        if (va < vb) return s.dir === 'asc' ? -1 : 1;
        if (va > vb) return s.dir === 'asc' ? 1 : -1;
        return 0;
    });

    if (!rows.length) {
        return `<tr><td colspan="18" style="padding:20px;text-align:center;color:var(--muted);font-weight:600;">No employees match your search</td></tr>`;
    }

    return rows.map((d, i) => {
        const sal     = cleanSal(d.salary);
        const cr      = d.compaRatio || 0;
        const crColor = cr < 0.85 ? 'var(--red)' : cr < 0.95 ? 'var(--amber)' : cr <= 1.05 ? 'var(--green)' : cr <= 1.15 ? 'var(--amber)' : 'var(--accent)';
        const tenure  = getTenureYears(d.startDate);
        const months  = getMonthsSinceIncrease(d.lastPayIncrease);
        const moColor = months !== null ? (months > 24 ? 'var(--red)' : months >= 18 ? 'var(--amber)' : 'inherit') : 'inherit';
        const moWt    = months !== null && months >= 18 ? 'font-weight:700;' : '';
        const rating  = pRat(d.rating);
        const stars   = rating === 'NR' ? '—' : '★'.repeat(rating);
        return `<tr class="${i % 2 ? 'an-alt' : ''}">
            <td class="an-lbl">${esc(d.name)}</td>
            <td class="comp-td-truncate">${esc(d.title || '—')}</td>
            <td>${esc(d.department || '—')}</td>
            <td>${esc(d.jobLevel || '—')}</td>
            <td class="comp-td-truncate">${esc([d.city, d.state].filter(Boolean).join(', ') || '—')}</td>
            <td>${esc(d.geoTier || '—')}</td>
            <td>${sal ? fmtN(sal) : '—'}</td>
            <td>${d.bandMin ? fmtN(d.bandMin) : '—'}</td>
            <td>${d.bandMid ? fmtN(d.bandMid) : '—'}</td>
            <td>${d.bandMax ? fmtN(d.bandMax) : '—'}</td>
            <td style="color:${crColor};font-weight:700;">${cr.toFixed(2)}</td>
            <td>${esc(d.quartile || '—')}</td>
            <td style="color:var(--amber);letter-spacing:-1px;">${stars}</td>
            <td>${tenure !== null ? tenure.toFixed(1) + ' yr' : '—'}</td>
            <td style="white-space:nowrap;">${esc(d.lastPayIncrease || '—')}</td>
            <td style="color:${moColor};${moWt}">${months !== null ? Math.round(months) + ' mo' : '—'}</td>
            <td style="text-align:center;">${d.belowMin ? '<span style="color:var(--red);" title="Below band minimum">●</span>' : ''}</td>
            <td style="text-align:center;">${d.aboveMax ? '<span style="color:var(--amber);" title="Above band maximum">●</span>' : ''}</td>
        </tr>`;
    }).join('');
}

function _rebuildMasterTableBody() {
    const tbody = g('compMasterTableBody');
    const thead = g('compMasterTableHead');
    if (tbody) tbody.innerHTML = _buildMasterTableRows();
    if (thead) thead.innerHTML = _buildMasterTableHeader();
}

// ─────────────────────────────────────────────────────
// ── Chart builders ──
// ─────────────────────────────────────────────────────

function _buildCompChartA(data) {
    const canvas = g('compChartA');
    if (!canvas) return;
    const stale = Chart.getChart(canvas);
    if (stale) { try { stale.destroy(); } catch (e) {} }

    const bands = [
        { label: '< 0.75',      min: 0,    max: 0.75,    col: '#e03e3e' },
        { label: '0.75 – 0.85', min: 0.75, max: 0.85,    col: '#ef7a44' },
        { label: '0.85 – 0.95', min: 0.85, max: 0.95,    col: '#f0a500' },
        { label: '0.95 – 1.05', min: 0.95, max: 1.05,    col: '#2d9b6f' },
        { label: '1.05 – 1.15', min: 1.05, max: 1.15,    col: '#f0a500' },
        { label: '1.15 – 1.25', min: 1.15, max: 1.25,    col: '#8b5cf6' },
        { label: '> 1.25',      min: 1.25, max: Infinity, col: '#8b5cf6' },
    ];

    const counts = bands.map(b =>
        data.filter(d => d.compaRatio != null && d.compaRatio >= b.min && d.compaRatio < b.max).length
    );

    _compCharts[0] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: bands.map(b => b.label),
            datasets: [{
                data: counts,
                backgroundColor: bands.map(b => b.col),
                borderRadius: 4,
                borderWidth: 0,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: {
                    anchor: 'end', align: 'start',
                    color: '#fff',
                    font: { family: 'Nunito', weight: '700', size: 10 },
                    formatter: v => v > 0 ? String(v) : '',
                    display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
                },
            },
            scales: {
                x: { ticks: { color: '#6b6880', font: { family: 'Nunito', size: 10 } }, grid: { color: 'rgba(180,160,130,0.10)' } },
                y: { ticks: { color: '#6b6880', font: { family: 'Nunito', weight: '700', size: 11 } }, grid: { display: false } },
            },
        },
    });
}

function _buildCompChartB(data) {
    const canvas = g('compChartB');
    if (!canvas) return;
    const stale = Chart.getChart(canvas);
    if (stale) { try { stale.destroy(); } catch (e) {} }

    const depts     = [...new Set(data.map(d => d.department).filter(Boolean))].sort();
    const quartiles = ['Below Min', 'Q1', 'Q2', 'Q3', 'Q4', 'Above Max'];
    const colors    = ['#e03e3e', '#ef7a44', '#f0a500', '#a3c940', '#2d9b6f', '#8b5cf6'];

    const datasets = quartiles.map((q, qi) => ({
        label: q,
        data: depts.map(dept => data.filter(d => d.department === dept && d.quartile === q).length),
        backgroundColor: colors[qi],
        borderRadius: 3,
        borderSkipped: false,
    }));

    _compCharts[1] = new Chart(canvas, {
        type: 'bar',
        data: { labels: depts, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true, position: 'bottom',
                    labels: { color: '#6b6880', font: { family: 'Nunito', size: 10 }, padding: 12, boxWidth: 12 },
                },
                datalabels: {
                    color: '#fff',
                    font: { family: 'Nunito', weight: '700', size: 9 },
                    formatter: v => v >= 2 ? String(v) : '',
                    display: ctx => ctx.dataset.data[ctx.dataIndex] >= 2,
                },
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: '#6b6880', font: { family: 'Nunito', size: 10 }, maxRotation: 35 },
                    grid: { display: false },
                },
                y: {
                    stacked: true,
                    ticks: { color: '#6b6880', font: { family: 'Nunito', size: 10 } },
                    grid: { color: 'rgba(180,160,130,0.10)' },
                },
            },
        },
    });
}

function _buildCompChartC(data) {
    const canvas = g('compChartC');
    if (!canvas) return;
    const stale = Chart.getChart(canvas);
    if (stale) { try { stale.destroy(); } catch (e) {} }

    const levelOrder = ['IC1','IC2','IC3','IC4','IC5','IC6','M1','M2','VP','C-Level'];
    const levels     = levelOrder.filter(lv => data.some(d => d.jobLevel === lv));

    const levelData = levels.map(lv => {
        const emps = data.filter(d => d.jobLevel === lv);
        const sals = emps.map(d => cleanSal(d.salary)).filter(s => s > 0);
        if (!sals.length) return null;
        const minS = Math.min(...sals);
        const maxS = Math.max(...sals);
        const avgS = sals.reduce((a, b) => a + b, 0) / sals.length;
        const midEmp = emps.find(d => d.bandMid);
        return { lv, minS, maxS, avgS, bandMid: midEmp ? midEmp.bandMid : 0 };
    }).filter(Boolean);

    if (!levelData.length) return;

    _compCharts[2] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: levelData.map(d => d.lv),
            datasets: [
                {
                    label: 'Salary Range (Min → Max)',
                    type: 'bar',
                    data: levelData.map(d => [d.minS, d.maxS]),
                    backgroundColor: 'rgba(99,102,241,0.22)',
                    borderColor:     'rgba(99,102,241,0.55)',
                    borderWidth: 1,
                    borderRadius: 4,
                    borderSkipped: false,
                    datalabels: { display: false },
                },
                {
                    label: 'Avg Salary',
                    type: 'line',
                    data: levelData.map(d => d.avgS),
                    borderColor:     '#e85d3d',
                    backgroundColor: '#e85d3d',
                    pointStyle: 'circle',
                    pointRadius: 7,
                    pointHoverRadius: 9,
                    showLine: false,
                    borderWidth: 0,
                    datalabels: { display: false },
                },
                {
                    label: 'Band Mid',
                    type: 'line',
                    data: levelData.map(d => d.bandMid),
                    borderColor:     '#2d9b6f',
                    backgroundColor: '#2d9b6f',
                    pointStyle: 'rectRot',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    showLine: true,
                    borderWidth: 1.5,
                    borderDash: [5, 4],
                    tension: 0,
                    datalabels: { display: false },
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true, position: 'bottom',
                    labels: { color: '#6b6880', font: { family: 'Nunito', size: 10 }, padding: 14, boxWidth: 14 },
                },
                datalabels: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const val = ctx.raw;
                            if (Array.isArray(val)) return `${ctx.dataset.label}: ${fmtK(val[0])} → ${fmtK(val[1])}`;
                            return `${ctx.dataset.label}: ${fmtK(val)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: '#6b6880', font: { family: 'Nunito', weight: '700', size: 11 } },
                    grid: { display: false },
                },
                y: {
                    ticks: { color: '#6b6880', font: { family: 'Nunito', size: 10 }, callback: v => fmtK(v) },
                    grid: { color: 'rgba(180,160,130,0.10)' },
                },
            },
        },
    });
}

// ─────────────────────────────────────────────────────
// ── Public controls (called from inline HTML) ──
// ─────────────────────────────────────────────────────

window.compSetFilter = function (key, val) {
    compFilters[key] = val;
    renderCompensation();
};

window.compResetFilters = function () {
    compFilters = { dept: '', geoTier: '', manager: '', leadership: '' };
    renderCompensation();
};

window.compTogglePanel = function (id) {
    _compPanelOpen[id] = !_compPanelOpen[id];
    const body  = g('compPanel_' + id);
    const arrow = g('compArrow_' + id);
    if (body)  body.style.display  = _compPanelOpen[id] ? 'block' : 'none';
    if (arrow) arrow.textContent   = _compPanelOpen[id] ? '▲' : '▼';
};

window.compSortTable = function (col) {
    if (_compTableSort.col === col) {
        _compTableSort.dir = _compTableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        _compTableSort.col = col;
        _compTableSort.dir = 'asc';
    }
    _rebuildMasterTableBody();
};

window.compSearchTable = function (val) {
    _compTableSearch = (val || '').toLowerCase();
    _rebuildMasterTableBody();
};
