// ── Org Health page ──

// Dept filter helper: called from dept table row clicks
window._ohDeptFilter = function (dept) {
    showPage('orgchart');
    applyOrgDeptFilter(dept);
    if (g('orgDeptFilter')) g('orgDeptFilter').value = dept;
};

function renderOrgHealth() {
    const el = g('pageOrgHealth');
    if (!el) return;
    if (typeof orgHealth !== 'function') return;

    const real = allData.filter(d => !d.isGhost);
    if (!real.length) {
        el.innerHTML = '<div class="oh-empty"><div class="oh-empty-icon">📋</div><div class="oh-empty-text">Load data to view org health analysis</div></div>';
        return;
    }

    const health = orgHealth(real);
    const { label, color, riskCategories, flags } = health;

    const scoreVar = color === 'green' ? 'var(--green)' : color === 'amber' ? 'var(--amber)' : 'var(--red)';

    // HTML escape helper
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // ── Metrics ──
    const sals = real.map(d => cleanSal(d.salary)).filter(s => s > 0);
    const totalPayroll = sals.reduce((a, b) => a + b, 0);

    // ── Risk category counts ──
    const rc        = riskCategories;
    const highCt    = rc.filter(c => c.status === 'high').length;
    const modCt     = rc.filter(c => c.status === 'moderate').length;
    const healthyCt = rc.filter(c => c.status === 'healthy').length;
    const nodataCt  = rc.filter(c => c.status === 'nodata').length;

    // ── SECTION A: Hero banner with segmented risk bar ──
    const sectionA = `
    <div class="oh-hero">
        <div class="oh-hero-center">
            <div class="oh-hero-label" style="color:${scoreVar};">${esc(label)}</div>
            <div class="oh-risk-bar">
                ${highCt    ? `<div class="oh-risk-seg oh-risk-seg-high"    style="flex:${highCt};"></div>` : ''}
                ${modCt     ? `<div class="oh-risk-seg oh-risk-seg-moderate" style="flex:${modCt};"></div>` : ''}
                ${healthyCt ? `<div class="oh-risk-seg oh-risk-seg-healthy"  style="flex:${healthyCt};"></div>` : ''}
                ${nodataCt  ? `<div class="oh-risk-seg oh-risk-seg-nodata"   style="flex:${nodataCt};"></div>` : ''}
            </div>
            <div class="oh-risk-counts">
                ${highCt    ? `<span class="oh-risk-count-high">${highCt} High Risk</span>` : ''}
                ${modCt     ? `<span class="oh-risk-count-moderate">${modCt} Moderate</span>` : ''}
                ${healthyCt ? `<span class="oh-risk-count-healthy">${healthyCt} Healthy</span>` : ''}
                ${nodataCt  ? `<span class="oh-risk-count-nodata">${nodataCt} No Data</span>` : ''}
            </div>
            <div class="oh-hero-chips">
                <span class="oh-chip">${real.length} employees</span>
                <span class="oh-chip">${fmtM(totalPayroll)} payroll</span>
                <span class="oh-chip">${rc.length} risk categories</span>
            </div>
        </div>
    </div>`;

    // ── SECTION B: Risk Breakdown ──
    const workingCats = rc.filter(c => c.status === 'healthy' || c.status === 'nodata');
    const concernCats = rc.filter(c => c.status === 'high' || c.status === 'moderate')
                          .sort((a, b) => (a.status === 'high' ? 0 : 1) - (b.status === 'high' ? 0 : 1));

    const workingHtml = workingCats.length
        ? workingCats.map(c => `<div class="oh-breakdown-row">
            <span class="oh-check">${c.status === 'nodata' ? '—' : '✓'}</span>
            <div>
                <div class="oh-breakdown-cat">${esc(c.name)}</div>
                <div class="oh-working-desc">${esc(c.description)}</div>
            </div>
        </div>`).join('')
        : '<div class="oh-breakdown-none">All categories show issues.</div>';

    const concernsHtml = concernCats.length
        ? concernCats.map(c => {
            const isHigh = c.status === 'high';
            return `<div class="oh-concern-row" style="border-left-color:${isHigh ? 'var(--red)' : 'var(--amber)'};">
                <div class="oh-concern-hd">
                    <span class="${isHigh ? 'oh-badge-high' : 'oh-badge-moderate'}">${isHigh ? 'HIGH RISK' : 'MODERATE'}</span>
                    <span class="oh-breakdown-cat">${esc(c.name)}</span>
                </div>
                <div class="oh-breakdown-desc">${esc(c.description)}</div>
            </div>`;
        }).join('')
        : '<div class="oh-breakdown-none" style="color:var(--green);">✓ No concerns — excellent org health!</div>';

    const sectionB = `
    <div>
        <div class="oh-section-hd">Risk Breakdown</div>
        <div class="oh-breakdown-grid">
            <div class="oh-breakdown-col">
                <div class="oh-breakdown-col-hd oh-col-green">✓ What's Working</div>
                ${workingHtml}
            </div>
            <div class="oh-breakdown-col">
                <div class="oh-breakdown-col-hd oh-col-red">⚠ Areas of Concern</div>
                ${concernsHtml}
            </div>
        </div>
    </div>`;

    // ── SECTION C: Risk Flag Cards (only render cards with active flags) ──
    const SEV = {
        high:   { col: 'var(--red)',   bg: 'rgba(224,62,62,0.08)',   label: 'HIGH RISK' },
        medium: { col: 'var(--amber)', bg: 'rgba(240,165,0,0.08)',   label: 'MODERATE RISK' },
        low:    { col: 'var(--muted)', bg: 'rgba(107,104,128,0.08)', label: '' },
    };

    const RISK_CATS = [
        {
            icon: '🔑', title: 'Single Points of Failure', baseSeverity: 'high',
            getItems: f => f.singlePoints,
            getTableHtml: f => !f.singlePoints.length ? '' : `<div class="oh-flag-tbl-wrap"><table class="oh-flag-tbl">
                <thead><tr><th>Employee</th><th>Title</th><th>Department</th><th>Job Level</th><th>Direct Reports</th></tr></thead>
                <tbody>${f.singlePoints.map((m, i) => `<tr class="${i % 2 ? 'oh-flag-tbl-alt' : ''}">
                    <td class="oh-flag-tbl-name">${esc(m.name)}</td>
                    <td>${esc(m.title || '—')}</td>
                    <td>${esc(m.dept || '—')}</td>
                    <td>${esc(m.jobLevel || '—')}</td>
                    <td>${m.reportCount}</td>
                </tr>`).join('')}</tbody>
            </table></div>`,
        },
        {
            icon: '⚠️', title: 'Over-Extended Managers', baseSeverity: 'high',
            getItems: f => [...f.overExtended, ...f.wideSpan],
            getTableHtml: f => {
                const all = [
                    ...f.overExtended.map(m => ({ ...m, span: '12+ reports' })),
                    ...f.wideSpan.map(m => ({ ...m, span: '9–11 reports' })),
                ];
                return !all.length ? '' : `<div class="oh-flag-tbl-wrap"><table class="oh-flag-tbl">
                    <thead><tr><th>Manager</th><th>Title</th><th>Department</th><th>Direct Reports</th></tr></thead>
                    <tbody>${all.map((m, i) => `<tr class="${i % 2 ? 'oh-flag-tbl-alt' : ''}">
                        <td class="oh-flag-tbl-name">${esc(m.name)}</td>
                        <td>${esc(m.title || '—')}</td>
                        <td>${esc(m.dept || '—')}</td>
                        <td>${m.reportCount} <span class="oh-tbl-note">(${m.span})</span></td>
                    </tr>`).join('')}</tbody>
                </table></div>`;
            },
        },
        {
            icon: '🔁', title: 'Succession Gaps', baseSeverity: 'medium',
            getItems: f => f.successionGaps,
            getTableHtml: f => !f.successionGaps.length ? '' : `<div class="oh-flag-tbl-wrap"><table class="oh-flag-tbl">
                <thead><tr><th>Manager</th><th>Title</th><th>Department</th><th>Reports</th></tr></thead>
                <tbody>${f.successionGaps.map((m, i) => `<tr class="${i % 2 ? 'oh-flag-tbl-alt' : ''}">
                    <td class="oh-flag-tbl-name">${esc(m.name)}</td>
                    <td>${esc(m.title || '—')}</td>
                    <td>${esc(m.dept || '—')}</td>
                    <td>${m.reportCount}</td>
                </tr>`).join('')}</tbody>
            </table></div>`,
        },
        {
            icon: '💰', title: 'Compensation Equity', baseSeverity: 'medium',
            getItems: f => f.compensationEquity,
            getTableHtml: f => !f.compensationEquity.length ? '' : `<div class="oh-flag-tbl-wrap"><table class="oh-flag-tbl">
                <thead><tr><th>Department</th><th>Job Level</th><th>Min Salary</th><th>Max Salary</th><th>Spread</th></tr></thead>
                <tbody>${f.compensationEquity.map((eq, i) => `<tr class="${i % 2 ? 'oh-flag-tbl-alt' : ''}">
                    <td class="oh-flag-tbl-name">${esc(eq.dept)}</td>
                    <td>${esc(eq.level)}</td>
                    <td>${fmtK(eq.minSal)}</td>
                    <td>${fmtK(eq.maxSal)}</td>
                    <td>${((eq.variance - 1) * 100).toFixed(0)}%</td>
                </tr>`).join('')}</tbody>
            </table></div>`,
        },
        {
            icon: '⭐', title: 'Low-Rated Managers', baseSeverity: 'high',
            getItems: f => f.lowRatedManagers,
            getTableHtml: f => !f.lowRatedManagers.length ? '' : `<div class="oh-flag-tbl-wrap"><table class="oh-flag-tbl">
                <thead><tr><th>Manager</th><th>Title</th><th>Department</th><th>Rating</th></tr></thead>
                <tbody>${f.lowRatedManagers.map((m, i) => `<tr class="${i % 2 ? 'oh-flag-tbl-alt' : ''}">
                    <td class="oh-flag-tbl-name">${esc(m.name)}</td>
                    <td>${esc(m.title || '—')}</td>
                    <td>${esc(m.dept || '—')}</td>
                    <td><span style="color:var(--red);font-weight:800;">${m.rating}★</span></td>
                </tr>`).join('')}</tbody>
            </table></div>`,
        },
        {
            icon: '🏢', title: 'Department Health', baseSeverity: 'medium',
            getItems: f => f.deptHealth,
            getTableHtml: f => !f.deptHealth.length ? '' : `<div class="oh-flag-tbl-wrap"><table class="oh-flag-tbl">
                <thead><tr><th>Department</th><th>Headcount</th><th>Avg Rating</th></tr></thead>
                <tbody>${f.deptHealth.map((d, i) => `<tr class="${i % 2 ? 'oh-flag-tbl-alt' : ''}">
                    <td class="oh-flag-tbl-name">${esc(d.dept)}</td>
                    <td>${d.headcount}</td>
                    <td><span style="color:var(--red);font-weight:800;">${d.avgRating.toFixed(2)}★</span></td>
                </tr>`).join('')}</tbody>
            </table></div>`,
        },
        {
            icon: '📅', title: 'Tenure Risk', baseSeverity: 'medium',
            getItems: f => f.tenureRisk ? [f.tenureRisk] : [],
            getTableHtml: f => !f.tenureRisk ? '' : `<div class="oh-flag-stat">
                <span class="oh-flag-stat-val" style="color:var(--amber);">${f.tenureRisk.avgT.toFixed(1)}<span style="font-size:15px;font-weight:700;"> yrs avg</span></span>
                <span class="oh-flag-stat-lbl">${f.tenureRisk.level === 'critical' ? 'Critical attrition risk — average tenure under 1 year' : f.tenureRisk.level === 'warning' ? 'Below healthy baseline — average tenure under 2 years' : 'Slightly below average — consider improving retention'}</span>
            </div>`,
        },
        {
            icon: '❓', title: 'Missing Ratings', baseSeverity: 'low',
            getItems: f => f.missingRatings > 0 ? [{ count: f.missingRatings }] : [],
            getTableHtml: f => f.missingRatings <= 0 ? '' : `<div class="oh-flag-stat">
                <span class="oh-flag-stat-val" style="color:var(--muted);">${f.missingRatings}</span>
                <span class="oh-flag-stat-lbl">employee${f.missingRatings !== 1 ? 's' : ''} with no performance rating on file</span>
            </div>`,
        },
        {
            icon: '📉', title: 'Performance Concentration', baseSeverity: 'high',
            getItems: f => f.perfConcentration,
            getTableHtml: f => {
                const pc = f.perfConcentration[0];
                return !pc ? '' : `<div class="oh-flag-stat">
                    <span class="oh-flag-stat-val" style="color:var(--red);">${pc.pct.toFixed(1)}%</span>
                    <span class="oh-flag-stat-lbl">${pc.count} employees rated ≤2★ — ${pc.pct >= 20 ? 'high' : 'elevated'} low-performer density</span>
                </div>`;
            },
        },
    ];

    const activeFlagCards = RISK_CATS
        .filter(cat => cat.getItems(flags).length > 0)
        .map(cat => {
            const items = cat.getItems(flags);
            const sev   = SEV[cat.baseSeverity];
            return `
            <div class="oh-flag-card">
                <div class="oh-flag-card-hd">
                    <span class="oh-flag-icon">${cat.icon}</span>
                    <div class="oh-flag-title-wrap">
                        <div class="oh-flag-title">${esc(cat.title)} <span class="oh-flag-count" style="background:${sev.bg};color:${sev.col};">${items.length}</span></div>
                        ${sev.label ? `<span class="oh-severity-badge" style="background:${sev.bg};color:${sev.col};">${sev.label}</span>` : ''}
                    </div>
                </div>
                <div class="oh-flag-items">${cat.getTableHtml(flags)}</div>
            </div>`;
        });

    const sectionC = activeFlagCards.length
        ? `<div>
            <div class="oh-section-hd">Risk Signals</div>
            <div class="oh-flags-grid">${activeFlagCards.join('')}</div>
        </div>`
        : `<div class="oh-trend-note" style="color:var(--green);border-color:rgba(45,155,111,0.4);background:rgba(45,155,111,0.06);">✓ All risk signal checks are clear — excellent organizational health.</div>`;

    // ── SECTION D: Department Overview table ──
    const depts = [...new Set(real.map(d => d.department).filter(Boolean))].sort();

    const deptRows = depts.map(dept => {
        const de     = real.filter(d => d.department === dept);
        const hc     = de.length;
        const dSals  = de.map(d => cleanSal(d.salary)).filter(s => s > 0);
        const avgSal = dSals.length ? dSals.reduce((a, b) => a + b, 0) / dSals.length : 0;
        const rated  = de.filter(d => { const r = pRat(d.rating); return r !== 'NR'; });
        const avgRat = rated.length ? rated.reduce((s, d) => s + pRat(d.rating), 0) / rated.length : null;
        const mgrSet = new Set(de.map(d => d.parentId).filter(Boolean));
        const dMgrs  = de.filter(d => mgrSet.has(d.id));
        const mgrCt  = dMgrs.length;
        const dSpan  = mgrCt ? ((hc - mgrCt) / mgrCt).toFixed(1) : '—';

        let mini = 100;
        if (avgRat !== null && avgRat < 2.5) mini -= 30;
        else if (avgRat !== null && avgRat < 3.5) mini -= 10;
        const spanNum = mgrCt ? (hc - mgrCt) / mgrCt : 0;
        if (spanNum > 10) mini -= 20;
        else if (spanNum > 7) mini -= 10;
        mini = Math.max(0, Math.min(100, mini));
        const miniCol = mini >= 80 ? 'var(--green)' : mini >= 60 ? 'var(--amber)' : 'var(--red)';

        const col = deptCol[dept] || '#64748b';

        const starsHtml = avgRat !== null
            ? `<span style="color:var(--amber);letter-spacing:-1px;font-size:11px;">${'★'.repeat(Math.round(avgRat))}${'☆'.repeat(5 - Math.round(avgRat))}</span> <span style="color:var(--muted);font-size:10px;">${avgRat.toFixed(1)}</span>`
            : '<span style="color:var(--muted);">NR</span>';

        return `
        <div class="oh-dept-row" onclick="window._ohDeptFilter(this.dataset.dept)" data-dept="${esc(dept)}">
            <div class="oh-dept-name">
                <span class="oh-dept-dot" style="background:${col};"></span>
                ${esc(dept)}
            </div>
            <div class="oh-dept-cell">${hc}</div>
            <div class="oh-dept-cell">${avgSal ? fmtK(avgSal) : '—'}</div>
            <div class="oh-dept-cell">${starsHtml}</div>
            <div class="oh-dept-cell">${mgrCt}</div>
            <div class="oh-dept-cell">${dSpan}</div>
            <div class="oh-dept-bar-cell">
                <div class="oh-dept-mini-track">
                    <div class="oh-dept-mini-fill" style="width:${mini}%;background:${miniCol};"></div>
                </div>
                <span class="oh-dept-mini-val" style="color:${miniCol};">${mini}</span>
            </div>
        </div>`;
    }).join('');

    const sectionD = depts.length ? `
    <div>
        <div class="oh-section-hd">Department Overview</div>
        <div class="oh-dept-table">
            <div class="oh-dept-header">
                <div>Department</div>
                <div>HC</div>
                <div>Avg Salary</div>
                <div>Avg Rating</div>
                <div>Managers</div>
                <div>Span</div>
                <div>Health</div>
            </div>
            ${deptRows}
        </div>
    </div>` : '';

    // ── SECTION E: Trend note ──
    const sectionE = `
    <div class="oh-trend-note">
        📊 Risk analysis is calculated from live data. Load a scenario in Workforce Planning to model how structural changes affect your org health.
    </div>`;

    // ── Render ──
    el.innerHTML = `
    <div class="oh-page-inner">
        <div class="oh-page-header">
            <div class="oh-page-title">Org Health</div>
            <div class="oh-page-subtitle">Structural analysis across ${real.length} employees · Last updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        ${sectionA}
        ${sectionB}
        ${sectionC}
        ${sectionD}
        ${sectionE}
    </div>`;
}
