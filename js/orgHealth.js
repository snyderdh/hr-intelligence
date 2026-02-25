// ── Org Health page ──

// Dept filter helper: called from dept table row clicks
window._ohDeptFilter = function (dept) {
    g('filterVal').value  = dept;
    g('filterMode').value = 'dept';
    applyFilter();
    showPage('orgchart');
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
    const { score, label, color, penalties, flags } = health;

    const scoreVar = color === 'green' ? 'var(--green)' : color === 'amber' ? 'var(--amber)' : 'var(--red)';
    const scoreBg  = color === 'green' ? 'rgba(45,155,111,0.1)' : color === 'amber' ? 'rgba(240,165,0,0.1)' : 'rgba(224,62,62,0.1)';

    // HTML escape helper
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // ── SECTION A: Hero banner ──
    const penaltyPts = penalties.reduce((s, p) => s + Math.abs(p.impact), 0);
    const sectionA = `
    <div class="oh-hero">
        <div class="oh-hero-score-wrap">
            <div class="oh-hero-score" style="color:${scoreVar};">${score}</div>
            <div class="oh-hero-denom">/100</div>
        </div>
        <div class="oh-hero-center">
            <div class="oh-hero-label" style="color:${scoreVar};">Organization is ${label}</div>
            <div class="oh-score-bar-track">
                <div class="oh-score-bar-fill" style="width:${score}%;background:${scoreVar};"></div>
            </div>
            <div class="oh-hero-sub">${real.length} employees · ${penalties.length} penalt${penalties.length !== 1 ? 'ies' : 'y'} fired · ${penaltyPts} pts deducted</div>
        </div>
        <div class="oh-hero-badge" style="background:${scoreBg};border:1px solid ${scoreVar};color:${scoreVar};">${label.toUpperCase()}</div>
    </div>`;

    // ── SECTION B: Score Breakdown ──
    const ALL_CATS = [
        'Tenure Risk', 'Span of Control', 'Performance Concentration',
        'Missing Ratings', 'Low-Rated Managers', 'Compensation Equity',
        'Succession Gaps', 'Single Points of Failure', 'Department Health',
    ];
    const firedCats   = new Set(penalties.map(p => p.category));
    const workingCats = ALL_CATS.filter(c => !firedCats.has(c));

    const workingHtml = workingCats.length
        ? workingCats.map(c => `
            <div class="oh-breakdown-row">
                <span class="oh-check">✓</span>
                <span class="oh-breakdown-cat">${esc(c)}</span>
            </div>`).join('')
        : '<div class="oh-breakdown-none">All categories show issues.</div>';

    const concernsHtml = penalties.length
        ? penalties.map(p => `
            <div class="oh-concern-row">
                <div class="oh-concern-hd">
                    <span class="oh-penalty-badge">${p.impact} pts</span>
                    <span class="oh-breakdown-cat">${esc(p.category)}</span>
                </div>
                <div class="oh-breakdown-desc">${esc(p.description)}</div>
            </div>`).join('')
        : '<div class="oh-breakdown-none" style="color:var(--green);">✓ No penalties — excellent org health!</div>';

    const sectionB = `
    <div>
        <div class="oh-section-hd">Score Breakdown</div>
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

    // ── SECTION C: Risk Flag Cards ──
    const RISK_CATS = [
        {
            icon: '⚠️', title: 'Over-Extended Managers', baseSeverity: 'high',
            getItems: f => [
                ...f.overExtended.map(m => ({ primary: m.name, secondary: m.dept, detail: `${m.reportCount} direct reports — over-extended` })),
                ...f.wideSpan.map(m => ({ primary: m.name, secondary: m.dept, detail: `${m.reportCount} direct reports — wide span` })),
            ],
        },
        {
            icon: '🔁', title: 'Succession Gaps', baseSeverity: 'medium',
            getItems: f => f.successionGaps.map(m => ({ primary: m.name, secondary: m.dept, detail: `${m.reportCount} reports · no high-rated successor` })),
        },
        {
            icon: '💰', title: 'Compensation Equity', baseSeverity: 'medium',
            getItems: f => f.compensationEquity.map(g => ({
                primary: `${g.dept} · ${g.level}`,
                secondary: '',
                detail: `${(g.variance * 100 - 100).toFixed(0)}% pay spread ($${Math.round(g.minSal / 1000)}K – $${Math.round(g.maxSal / 1000)}K)`,
            })),
        },
        {
            icon: '🔑', title: 'Single Points of Failure', baseSeverity: 'high',
            getItems: f => f.singlePoints.map(m => ({ primary: m.name, secondary: m.dept, detail: `${m.jobLevel} · ${m.reportCount} reports · sole occupant at this level` })),
        },
        {
            icon: '⭐', title: 'Low-Rated Managers', baseSeverity: 'high',
            getItems: f => f.lowRatedManagers.map(m => ({ primary: m.name, secondary: m.dept, detail: `Rating ${m.rating}/5` })),
        },
        {
            icon: '🏢', title: 'Department Health', baseSeverity: 'medium',
            getItems: f => f.deptHealth.map(d => ({ primary: d.dept, secondary: `${d.headcount} employees`, detail: `Avg rating ${d.avgRating.toFixed(2)}/5 — below threshold` })),
        },
        {
            icon: '📅', title: 'Tenure Risk', baseSeverity: 'medium',
            getItems: f => f.tenureRisk
                ? [{ primary: `Avg tenure ${f.tenureRisk.avgT.toFixed(1)} years`, secondary: '', detail: f.tenureRisk.level === 'critical' ? 'Below 1 yr — critical attrition risk' : f.tenureRisk.level === 'warning' ? 'Below 2 yrs — below healthy baseline' : 'Below 3 yrs — slightly below average' }]
                : [],
        },
        {
            icon: '❓', title: 'Missing Ratings', baseSeverity: 'low',
            getItems: f => f.missingRatings > 0
                ? [{ primary: `${f.missingRatings} employee${f.missingRatings !== 1 ? 's' : ''} unrated`, secondary: '', detail: 'Not included in current performance review cycle' }]
                : [],
        },
    ];

    const SEV = {
        high:   { col: 'var(--red)',   bg: 'rgba(224,62,62,0.08)',   label: 'High Risk' },
        medium: { col: 'var(--amber)', bg: 'rgba(240,165,0,0.08)',   label: 'Medium Risk' },
        low:    { col: 'var(--muted)', bg: 'rgba(107,104,128,0.08)', label: 'Low Risk' },
        clear:  { col: 'var(--green)', bg: 'rgba(45,155,111,0.08)',  label: 'Clear' },
    };

    const flagCards = RISK_CATS.map(cat => {
        const items     = cat.getItems(flags);
        const hasIssues = items.length > 0;
        const sev       = hasIssues ? SEV[cat.baseSeverity] : SEV.clear;

        const itemsHtml = hasIssues
            ? items.map(item => `
                <div class="oh-flag-item">
                    <div class="oh-flag-item-primary">${esc(item.primary)}</div>
                    ${item.secondary ? `<div class="oh-flag-item-sec">${esc(item.secondary)}</div>` : ''}
                    <div class="oh-flag-item-detail">${esc(item.detail)}</div>
                </div>`).join('')
            : '<div class="oh-flag-ok">✓ No issues detected</div>';

        const countBadge = hasIssues
            ? `<span class="oh-flag-count" style="background:${sev.bg};color:${sev.col};">${items.length}</span>`
            : '';

        return `
        <div class="oh-flag-card" style="opacity:${hasIssues ? '1' : '0.52'};">
            <div class="oh-flag-card-hd">
                <span class="oh-flag-icon">${cat.icon}</span>
                <div class="oh-flag-title-wrap">
                    <div class="oh-flag-title">${esc(cat.title)} ${countBadge}</div>
                    <span class="oh-severity-badge" style="background:${sev.bg};color:${sev.col};">${sev.label}</span>
                </div>
            </div>
            <div class="oh-flag-items">${itemsHtml}</div>
        </div>`;
    }).join('');

    const sectionC = `
    <div>
        <div class="oh-section-hd">Risk Signals</div>
        <div class="oh-flags-grid">${flagCards}</div>
    </div>`;

    // ── SECTION D: Department Health Grid ──
    const depts = [...new Set(real.map(d => d.department).filter(Boolean))].sort();

    const deptRows = depts.map(dept => {
        const de      = real.filter(d => d.department === dept);
        const hc      = de.length;
        const sals    = de.map(d => cleanSal(d.salary)).filter(s => s > 0);
        const avgSal  = sals.length ? sals.reduce((a, b) => a + b, 0) / sals.length : 0;
        const rated   = de.filter(d => { const r = pRat(d.rating); return r !== 'NR'; });
        const avgRat  = rated.length ? rated.reduce((s, d) => s + pRat(d.rating), 0) / rated.length : null;
        const mgrSet  = new Set(de.map(d => d.parentId).filter(Boolean));
        const dMgrs   = de.filter(d => mgrSet.has(d.id));
        const mgrCt   = dMgrs.length;
        const dSpan   = mgrCt ? ((hc - mgrCt) / mgrCt).toFixed(1) : '—';

        // Mini health per dept
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

    const sectionD = `
    <div>
        <div class="oh-section-hd">Department Health</div>
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
    </div>`;

    // ── SECTION E: Trend Note ──
    const sectionE = `
    <div class="oh-trend-note">
        📊 Org Health score is calculated from live data. Load a scenario in Scenario Studio to model how structural changes affect your score.
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
