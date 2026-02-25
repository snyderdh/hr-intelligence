// ── Tenure chart instance ──
let tenureChartInst = null;

// ── US state → timezone lookup ──
const TZ_MAP = {
    AL:'CT', AK:'AKT', AZ:'MT', AR:'CT', CA:'PT', CO:'MT', CT:'ET', DC:'ET',
    DE:'ET', FL:'ET', GA:'ET', HI:'HAT', ID:'MT', IL:'CT', IN:'ET', IA:'CT',
    KS:'CT', KY:'ET', LA:'CT', ME:'ET', MD:'ET', MA:'ET', MI:'ET', MN:'CT',
    MS:'CT', MO:'CT', MT:'MT', NE:'CT', NV:'MT', NH:'ET', NJ:'ET', NM:'MT',
    NY:'ET', NC:'ET', ND:'CT', OH:'ET', OK:'CT', OR:'PT', PA:'ET', RI:'ET',
    SC:'ET', SD:'CT', TN:'CT', TX:'CT', UT:'MT', VT:'ET', VA:'ET', WA:'PT',
    WV:'ET', WI:'CT', WY:'MT',
};

// ── Dashboard drill mode ──
function setDrill(mode) {
    drillMode = mode;
    updateStats(viewData);
}

function swTab(btn, pId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
    });
    btn.classList.add('active');
    const pane = g(pId);
    if (pane) {
        pane.classList.add('active');
        // Tenure and Geo are scrollable block-level panes; Chart uses flex
        pane.style.display = (pId === 'tTenure' || pId === 'tGeo') ? 'block' : 'flex';
    }
}

// ── Stats engine (top-bar pills + dashboard sidebar) ──
function updateStats(data) {
    const real = data.filter(d => !d.isGhost);
    if (!real.length) return;

    const sals  = real.map(d => cleanSal(d.salary)).filter(s => s > 0).sort((a, b) => a - b);
    const total = sals.reduce((a, b) => a + b, 0);
    const avg   = sals.length ? total / sals.length : 0;
    const med   = sals.length % 2 === 0
        ? (sals[sals.length / 2 - 1] + sals[sals.length / 2]) / 2
        : sals[Math.floor(sals.length / 2)] || 0;
    const mn = sals[0] || 0, mx = sals[sals.length - 1] || 0;

    const mgrs = real.filter(d => real.some(e => e.parentId === d.id));
    const span = mgrs.length ? ((real.length - mgrs.length) / mgrs.length).toFixed(1) : '—';

    const tens = real.map(tenYrs).filter(v => v !== null);
    const avgT = tens.length ? tens.reduce((a, b) => a + b, 0) / tens.length : 0;

    const grps = { 'C-Level': 0, 'VP': 0, 'People Managers': 0, 'Individual Contributors': 0 };
    real.forEach(d => { const gr = group(d); if (gr in grps) grps[gr]++; });

    const rats = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, NR: 0 };
    real.forEach(d => { const r = pRat(d.rating); if (r in rats) rats[r]++; });

    const dCts = {};
    real.forEach(d => { dCts[d.department] = (dCts[d.department] || 0) + 1; });

    const yr = new Date(); yr.setFullYear(yr.getFullYear() - 1);
    const r12 = real.filter(d => { const s = new Date(d.startDate); return !isNaN(s) && s >= yr; }).length;

    // Top-bar stat pills
    g('statHC').innerText      = real.length;
    g('statPayroll').innerText = fmtM(total);
    g('statAvgSal').innerText  = fmtK(avg);
    g('statTenure').innerText  = avgT.toFixed(1) + 'y';
    g('statSpan').innerText    = span;

    // Dashboard sidebar
    g('dTotal').innerText = fmtM(total);
    g('dAvg').innerText   = fmtN(avg);
    g('dMed').innerText   = fmtN(med);
    g('dRange').innerText = fmtK(mn) + ' – ' + fmtK(mx);

    g('tierList').innerHTML = Object.entries(grps)
        .map(([k, v]) => `<div class="mr"><span class="mk">${k}</span><span class="mv">${v}</span></div>`)
        .join('');

    g('perfList').innerHTML = [5, 4, 3, 2, 1, 'NR']
        .map(r => `<div class="mr"><span class="mk">Rating ${r}</span><span class="mv">${rats[r]}</span></div>`)
        .join('');

    g('deptList').innerHTML = Object.entries(dCts).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<div class="mr"><span class="mk">${k}</span><span class="mv">${v}</span></div>`)
        .join('');

    g('dSpan').innerText   = span + ':1';
    g('dTen').innerText    = avgT.toFixed(1) + ' yrs';
    g('dGrowth').innerText = r12;

    const tp = real.length ? ((rats[5] / real.length) * 100).toFixed(1) : 0;
    const lc = (rats[1] || 0) + (rats[2] || 0);
    const lp = real.length ? ((lc / real.length) * 100).toFixed(1) : 0;
    g('dTop').innerText = tp + '%';
    g('dLow').innerText = lp + '%';

    buildChart(real, grps, rats, dCts);
    buildTenure(real);
    buildGeo(real);

    if (typeof renderHome === 'function') renderHome();
    if (typeof renderOrgHealth === 'function') renderOrgHealth();
    if (typeof renderCompensation === 'function') renderCompensation();
}

// ── Chart.js drill chart ──
function buildChart(real, grps, rats, dCts) {
    if (chartInst) { try { chartInst.destroy(); } catch(e) {} chartInst = null; }
    const canvas = g('mainChart');
    const stale = canvas && Chart.getChart(canvas);
    if (stale) { try { stale.destroy(); } catch(e) {} }
    const depts = [...new Set(allData.filter(d => !d.isGhost).map(d => d.department))].sort();
    let lbs, vals, type = 'bar', cols;

    if (drillMode === 'rating') {
        lbs   = ['5★', '4★', '3★', '2★', '1★', 'NR'];
        vals  = [rats[5], rats[4], rats[3], rats[2], rats[1], rats.NR];
        cols  = ['#10b981', '#38bdf8', '#f59e0b', '#f97316', '#ef4444', '#64748b'];
        type  = 'pie';
        g('chartLbl').innerText = 'Performance Rating Distribution';
    } else if (drillMode === 'tier') {
        lbs  = ['C-Level', 'VP', 'Managers', 'ICs'];
        vals = [grps['C-Level'], grps['VP'], grps['People Managers'], grps['Individual Contributors']];
        cols = PAL;
        g('chartLbl').innerText = 'Headcount by Strategic Tier';
    } else if (drillMode === 'salary') {
        lbs  = depts;
        vals = depts.map(d => {
            const e = allData.filter(x => x.department === d);
            return e.length ? Math.round(e.reduce((a, b) => a + cleanSal(b.salary), 0) / e.length) : 0;
        });
        cols = PAL;
        g('chartLbl').innerText = 'Average Salary by Department';
    } else {
        lbs  = depts;
        vals = depts.map(d => allData.filter(x => !x.isGhost && x.department === d).length);
        cols = PAL;
        g('chartLbl').innerText = 'Headcount by Department';
    }

    const tot = vals.reduce((a, b) => a + b, 0);
    chartInst = new Chart(g('mainChart'), {
        type,
        data: {
            labels: lbs,
            datasets: [{
                data: vals,
                backgroundColor: cols,
                borderRadius: type === 'bar' ? 5 : 0,
                borderWidth: type === 'pie' ? 2 : 0,
                borderColor: '#080c14',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: type === 'pie', position: 'bottom', labels: { color: '#94a3b8', padding: 14, font: { size: 11 } } },
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 10 },
                    formatter: (v, ctx) => {
                        if (!v || tot === 0) return '';
                        return drillMode === 'salary' ? fmtK(v) : v + ' (' + ((v / tot) * 100).toFixed(1) + '%)';
                    },
                    display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
                },
            },
            scales: type === 'pie' ? {} : {
                y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                x: { ticks: { color: '#64748b', maxRotation: 45, font: { size: 9 } }, grid: { display: false } },
            },
        },
    });
}

// ── Helpers ──
function _fmtT(yrs) {
    if (yrs === null || yrs === undefined) return '—';
    if (yrs < 1 / 12) return '<1 mo';
    if (yrs < 1) return Math.round(yrs * 12) + ' mo';
    return yrs.toFixed(1) + ' yr';
}

function _median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function _fmtDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Build tenure analytics tab ──
function buildTenure(real) {
    const el = g('tTenure');
    if (!el) return;

    const total = real.length;
    const withT = real.map(d => ({ ...d, _t: tenYrs(d) })).filter(d => d._t !== null);
    const esc   = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // ── A: Band histogram ──
    const BANDS = [
        { label: '<6 mo',   min: 0,   max: 0.5,      col: '#e03e3e' },
        { label: '6–12 mo', min: 0.5, max: 1,         col: '#ef7a44' },
        { label: '1–2 yr',  min: 1,   max: 2,         col: '#f0a500' },
        { label: '2–3 yr',  min: 2,   max: 3,         col: '#a3c940' },
        { label: '3–5 yr',  min: 3,   max: 5,         col: '#22c55e' },
        { label: '5–10 yr', min: 5,   max: 10,        col: '#2d9b6f' },
        { label: '10+ yr',  min: 10,  max: Infinity,  col: '#1a7a55' },
    ];
    const bandCts = BANDS.map(b => withT.filter(d => d._t >= b.min && d._t < b.max).length);

    // ── B: Dept table ──
    const depts = [...new Set(real.map(d => d.department).filter(Boolean))].sort();
    const deptRows = depts.map(dept => {
        const de  = real.filter(d => d.department === dept);
        const te  = de.map(d => tenYrs(d)).filter(v => v !== null);
        const avgT = te.length ? te.reduce((a, b) => a + b, 0) / te.length : 0;
        const medT = _median(te);
        const u1   = te.filter(t => t < 1).length;
        const u2   = te.filter(t => t < 2).length;
        const wd   = de.filter(d => !isNaN(new Date(d.startDate)));
        wd.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
        const newest  = wd[0] || null;
        const longest = wd[wd.length - 1] || null;
        return { dept, hc: de.length, avgT, medT, u1, u2, newest, longest };
    }).sort((a, b) => a.avgT - b.avgT);

    // ── C: Job level table ──
    const levs = [...new Set(real.map(d => d.jobLevel).filter(Boolean))].sort();
    const levRows = levs.map(lv => {
        const le   = real.filter(d => d.jobLevel === lv);
        const te   = le.map(d => tenYrs(d)).filter(v => v !== null);
        const avgT = te.length ? te.reduce((a, b) => a + b, 0) / te.length : 0;
        const u2   = te.filter(t => t < 2).length;
        const sals = le.map(d => cleanSal(d.salary)).filter(s => s > 0);
        const avgS = sals.length ? sals.reduce((a, b) => a + b, 0) / sals.length : 0;
        return { lv, hc: le.length, avgT, u2, avgS };
    }).sort((a, b) => a.avgT - b.avgT);

    // ── D: New hires this year ──
    const thisYear = new Date().getFullYear();
    const newHires = real
        .filter(d => { const s = new Date(d.startDate); return !isNaN(s) && s.getFullYear() === thisYear; })
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    // ── E: Long-tenured (5yr+) ──
    const longT = withT.filter(d => d._t >= 5).sort((a, b) => b._t - a._t);

    // Destroy old chart instance before rebuilding innerHTML
    if (tenureChartInst) { try { tenureChartInst.destroy(); } catch(e) {} tenureChartInst = null; }

    el.innerHTML = `<div class="an-page">

<div class="an-section">
    <div class="an-hd">Tenure Distribution <span class="an-ct">${withT.length} of ${total} with known start dates</span></div>
    <div class="an-chart-wrap"><canvas id="tenureChart"></canvas></div>
</div>

<div class="an-section">
    <div class="an-hd">Tenure by Department <span class="an-sub">sorted by avg tenure — most at-risk first</span></div>
    <div class="an-table-wrap"><table class="an-table">
        <thead><tr>
            <th>Department</th><th>HC</th><th>Avg Tenure</th><th>Median</th>
            <th>% &lt;1yr</th><th>% &lt;2yr</th><th>Newest Hire</th><th>Longest Tenured</th>
        </tr></thead>
        <tbody>${deptRows.map((r, i) => {
            const bc = r.avgT > 0 && r.avgT < 1 ? 'an-row-red' : r.avgT > 0 && r.avgT < 2 ? 'an-row-amber' : '';
            return `<tr class="${bc}${i % 2 ? ' an-alt' : ''}">
                <td class="an-lbl">${esc(r.dept)}</td>
                <td>${r.hc}</td>
                <td><strong>${_fmtT(r.avgT)}</strong></td>
                <td>${_fmtT(r.medT)}</td>
                <td>${r.hc ? ((r.u1 / r.hc) * 100).toFixed(0) + '%' : '—'}</td>
                <td>${r.hc ? ((r.u2 / r.hc) * 100).toFixed(0) + '%' : '—'}</td>
                <td style="font-size:11px;">${r.newest ? esc(r.newest.name) : '—'}</td>
                <td style="font-size:11px;">${r.longest ? esc(r.longest.name) : '—'}</td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>
    <div class="an-legend">
        <span class="an-leg-dot" style="background:var(--red);"></span>&nbsp;Avg &lt;1yr &ensp;
        <span class="an-leg-dot" style="background:var(--amber);"></span>&nbsp;Avg &lt;2yr
    </div>
</div>

<div class="an-section">
    <div class="an-hd">Tenure by Job Level <span class="an-sub">sorted by avg tenure ascending</span></div>
    <div class="an-table-wrap"><table class="an-table">
        <thead><tr><th>Job Level</th><th>HC</th><th>Avg Tenure</th><th>Avg Salary</th><th>% &lt;2yr</th></tr></thead>
        <tbody>${levRows.map((r, i) => `<tr class="${i % 2 ? 'an-alt' : ''}">
            <td class="an-lbl">${esc(r.lv)}</td>
            <td>${r.hc}</td>
            <td><strong>${_fmtT(r.avgT)}</strong></td>
            <td>${r.avgS ? fmtK(r.avgS) : '—'}</td>
            <td>${r.hc ? ((r.u2 / r.hc) * 100).toFixed(0) + '%' : '—'}</td>
        </tr>`).join('')}</tbody>
    </table></div>
</div>

<div class="an-section">
    <div class="an-hd">New Hires in ${thisYear} <span class="an-ct">${newHires.length} employee${newHires.length !== 1 ? 's' : ''}</span></div>
    ${!newHires.length
        ? `<div class="an-empty">No hires recorded for ${thisYear}</div>`
        : `<div class="an-table-wrap"><table class="an-table">
            <thead><tr><th>Name</th><th>Title</th><th>Department</th><th>Manager</th><th>Start Date</th><th>Tenure</th></tr></thead>
            <tbody>${newHires.map((d, i) => {
                const mgr = allData.find(e => e.id === d.parentId);
                return `<tr class="${i % 2 ? 'an-alt' : ''}">
                    <td class="an-lbl">${esc(d.name)}</td>
                    <td>${esc(d.title || '—')}</td>
                    <td>${esc(d.department || '—')}</td>
                    <td>${esc(mgr ? mgr.name : '—')}</td>
                    <td>${_fmtDate(d.startDate)}</td>
                    <td>${_fmtT(tenYrs(d))}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`}
</div>

<div class="an-section">
    <div class="an-hd">Institutional Knowledge Carriers <span class="an-sub">5+ year tenure</span> <span class="an-ct">${longT.length}</span></div>
    ${!longT.length
        ? '<div class="an-empty">No employees with 5+ years of tenure found</div>'
        : `<div class="an-table-wrap"><table class="an-table">
            <thead><tr><th>Name</th><th>Title</th><th>Department</th><th>Tenure</th><th>Rating</th></tr></thead>
            <tbody>${longT.map((d, i) => {
                const r    = pRat(d.rating);
                const rStr = r === 'NR'
                    ? '<span class="an-nr">NR</span>'
                    : `<span style="color:var(--amber);letter-spacing:-1px;">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</span> <span style="font-size:10px;color:var(--muted);">(${r})</span>`;
                return `<tr class="${i % 2 ? 'an-alt' : ''}">
                    <td class="an-lbl">${esc(d.name)}</td>
                    <td>${esc(d.title || '—')}</td>
                    <td>${esc(d.department || '—')}</td>
                    <td><strong style="color:var(--green);">${_fmtT(d._t)}</strong></td>
                    <td>${rStr}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`}
</div>

</div>`;

    // ── Create tenure histogram chart ──
    const canvas = g('tenureChart');
    if (canvas) {
        tenureChartInst = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: BANDS.map(b => b.label),
                datasets: [{
                    data: bandCts,
                    backgroundColor: BANDS.map(b => b.col),
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
                        anchor: 'end',
                        align: 'start',
                        color: '#fff',
                        font: { weight: 'bold', size: 10 },
                        formatter: v => {
                            if (!v) return '';
                            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : 0;
                            return `${v}  (${pct}%)`;
                        },
                        display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
                    },
                },
                scales: {
                    x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(180,160,130,0.10)' } },
                    y: { ticks: { color: '#6b6880', font: { size: 11, weight: '700' } }, grid: { display: false } },
                },
            },
        });
    }
}

// ── Build location analytics tab ──
function buildGeo(real) {
    const el = g('tGeo');
    if (!el) return;

    const total = real.length;
    const esc   = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Build location map
    const locMap = {};
    real.forEach(d => {
        const loc = [d.city, d.state].filter(Boolean).join(', ');
        if (loc) {
            if (!locMap[loc]) locMap[loc] = [];
            locMap[loc].push(d);
        }
    });
    const locKeys = Object.keys(locMap).sort((a, b) => locMap[b].length - locMap[a].length);
    const noLoc   = total - locKeys.reduce((s, k) => s + locMap[k].length, 0);

    // ── A: Summary ──
    const topLoc    = locKeys[0] || 'Unknown';
    const hqEmps    = locMap[topLoc] || [];
    const colocPct  = total > 0 ? ((hqEmps.length / total) * 100).toFixed(1) : 0;
    const countries = [...new Set(real.map(d => d.country).filter(Boolean))];

    // ── B: Location table rows ──
    const locTableRows = locKeys.map((loc, i) => {
        const emps   = locMap[loc];
        const hc     = emps.length;
        const pct    = total > 0 ? ((hc / total) * 100).toFixed(1) : 0;
        const depts  = [...new Set(emps.map(d => d.department).filter(Boolean))];
        const dStr   = depts.slice(0, 3).join(', ') + (depts.length > 3 ? ` +${depts.length - 3}` : '');
        const sals   = emps.map(d => cleanSal(d.salary)).filter(s => s > 0);
        const avgS   = sals.length ? sals.reduce((a, b) => a + b, 0) / sals.length : 0;
        const rated  = emps.filter(d => pRat(d.rating) !== 'NR');
        const avgR   = rated.length ? rated.reduce((s, d) => s + pRat(d.rating), 0) / rated.length : null;
        const parts  = loc.split(', ');
        const city   = parts[0] || '', state = parts.slice(1).join(', ') || '';
        return `<tr class="${i % 2 ? 'an-alt' : ''} geo-loc-row" data-city="${esc(city)}" data-state="${esc(state)}" onclick="window._geoLocRow(this)" title="Click to filter Org Chart to ${esc(loc)}">
            <td class="an-lbl"><span class="geo-pin">📍</span>${esc(loc)}</td>
            <td>${hc}</td>
            <td>${pct}%</td>
            <td class="geo-depts-cell">${esc(dStr) || '—'}</td>
            <td>${avgS ? fmtK(avgS) : '—'}</td>
            <td>${avgR !== null ? '<span style="color:var(--amber);">★</span> ' + avgR.toFixed(1) : '—'}</td>
        </tr>`;
    });
    if (noLoc) {
        locTableRows.push(`<tr class="${locTableRows.length % 2 ? '' : 'an-alt'}">
            <td class="an-lbl" style="color:var(--muted);font-style:italic;">No location on file</td>
            <td>${noLoc}</td><td>${total > 0 ? ((noLoc / total) * 100).toFixed(1) : 0}%</td><td colspan="3">—</td>
        </tr>`);
    }

    // ── C: Dept × Location matrix (top 8 locations) ──
    const matrixLocs = locKeys.slice(0, 8);
    const depts = [...new Set(real.map(d => d.department).filter(Boolean))].sort();
    function hexToRgba(hex, a) {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0,2),16), gg = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
        return `rgba(${r},${gg},${b},${a})`;
    }
    const matrixHtml = depts.map((dept, di) => {
        const col   = deptCol[dept] || '#64748b';
        const cells = matrixLocs.map(loc => {
            const cnt = (locMap[loc] || []).filter(d => d.department === dept).length;
            if (!cnt) return '<td class="geo-mcell geo-mcell-empty">\u2014</td>';
            const op  = cnt === 1 ? 0.22 : cnt <= 3 ? 0.45 : cnt <= 6 ? 0.70 : 0.90;
            return `<td class="geo-mcell" style="background:${hexToRgba(col, op)};color:${cnt >= 4 ? '#fff' : col};font-weight:800;">${cnt}</td>`;
        }).join('');
        return `<tr class="${di % 2 ? 'an-alt' : ''}">
            <td class="geo-mdept"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px;vertical-align:middle;"></span>${esc(dept)}</td>
            ${cells}
        </tr>`;
    }).join('');
    const matrixHdrCells = matrixLocs
        .map(loc => `<th class="geo-mhdr" title="${esc(loc)}">${esc(loc.length > 13 ? loc.slice(0, 11) + '\u2026' : loc)}</th>`)
        .join('');

    // ── D: Timezone distribution ──
    const tzCts   = {}, tzDepts = {};
    real.forEach(d => {
        const st  = String(d.state || '').trim().toUpperCase();
        const tz  = TZ_MAP[st] || (st ? 'Other' : 'Unknown');
        tzCts[tz] = (tzCts[tz] || 0) + 1;
        if (!tzDepts[tz]) tzDepts[tz] = new Set();
        if (d.department) tzDepts[tz].add(d.department);
    });
    const TZ_LABELS = { ET:'Eastern', CT:'Central', MT:'Mountain', PT:'Pacific', AKT:'Alaska', HAT:'Hawaii', Other:'Other/Intl', Unknown:'Unknown' };
    const tzEntries = Object.entries(tzCts).sort((a, b) => b[1] - a[1]);
    const maxTzPct  = tzEntries.length ? (tzEntries[0][1] / total) * 100 : 0;
    const tzWarn    = maxTzPct >= 70
        ? `<div class="geo-tz-warn">⚠ Heavy timezone concentration — ${maxTzPct.toFixed(0)}% of org in one timezone. Consider distributed hiring to improve time-zone coverage.</div>`
        : '';
    const tzRows = tzEntries.map(([tz, n], i) => {
        const pct  = total > 0 ? ((n / total) * 100).toFixed(1) : 0;
        const ds   = [...(tzDepts[tz] || [])].slice(0, 4).join(', ');
        return `<tr class="${i % 2 ? 'an-alt' : ''}">
            <td class="an-lbl"><strong>${TZ_LABELS[tz] || tz}</strong> <span class="geo-tz-code">${tz}</span></td>
            <td>${n}</td><td>${pct}%</td>
            <td><div class="geo-tz-bar-track"><div style="width:${pct}%;background:var(--accent);height:100%;border-radius:2px;"></div></div></td>
            <td class="geo-depts-cell">${esc(ds) || '—'}</td>
        </tr>`;
    }).join('');

    // ── E: Location × Job Level ──
    const reportSet = new Set(real.map(d => d.parentId).filter(Boolean));
    function jlGroup(d) {
        const lv = (d.jobLevel || '').trim().toUpperCase();
        if (lv === 'C-LEVEL' || lv.startsWith('CEO')) return 'C-Level';
        if (lv.startsWith('VP') || lv.startsWith('SVP')) return 'VP';
        if (reportSet.has(d.id)) return 'Mgr';
        return 'IC';
    }
    const jlCats = ['C-Level', 'VP', 'Mgr', 'IC'];
    const locLvlRows = locKeys.map((loc, i) => {
        const emps = locMap[loc];
        const cats = jlCats.map(c => emps.filter(d => jlGroup(d) === c).length);
        return `<tr class="${i % 2 ? 'an-alt' : ''}">
            <td class="an-lbl">${esc(loc)}</td>
            ${cats.map(c => `<td>${c || '\u2014'}</td>`).join('')}
            <td><strong>${emps.length}</strong></td>
        </tr>`;
    }).join('');

    // ── F: Co-located vs Distributed ──
    const distCount = total - hqEmps.length - noLoc;
    const distPct   = total > 0 ? ((distCount / total) * 100).toFixed(1) : 0;

    // ── Render ──
    el.innerHTML = `<div class="an-page">

<div class="geo-summary-strip">
    <div class="geo-summary-card">
        <div class="geo-sval">${locKeys.length}</div>
        <div class="geo-slbl">Unique Locations</div>
    </div>
    <div class="geo-summary-card">
        <div class="geo-sval">${countries.length || 1}</div>
        <div class="geo-slbl">${countries.length > 1 ? 'Countries' : 'Country'}</div>
    </div>
    <div class="geo-summary-card geo-summary-wide">
        <div class="geo-sval" style="font-size:15px;font-weight:800;">${esc(topLoc)}</div>
        <div class="geo-slbl">Most Common Location</div>
    </div>
    <div class="geo-summary-card">
        <div class="geo-sval" style="color:var(--green);">${colocPct}%</div>
        <div class="geo-slbl">Co-located at HQ</div>
    </div>
</div>

<div class="an-section">
    <div class="an-hd">Employees by Location <span class="an-sub">click a row to filter Org Chart</span></div>
    <div class="an-table-wrap"><table class="an-table">
        <thead><tr><th>Location</th><th>HC</th><th>% Org</th><th>Departments</th><th>Avg Salary</th><th>Avg Rating</th></tr></thead>
        <tbody>${locTableRows.join('')}</tbody>
    </table></div>
</div>

${depts.length && matrixLocs.length >= 2 ? `
<div class="an-section">
    <div class="an-hd">Department × Location Matrix ${matrixLocs.length < locKeys.length ? `<span class="an-sub">top ${matrixLocs.length} locations shown</span>` : ''}</div>
    <div class="an-table-wrap"><table class="an-table geo-matrix">
        <thead><tr><th>Department</th>${matrixHdrCells}</tr></thead>
        <tbody>${matrixHtml}</tbody>
    </table></div>
</div>` : ''}

${tzEntries.length ? `
<div class="an-section">
    <div class="an-hd">Timezone Distribution</div>
    ${tzWarn}
    <div class="an-table-wrap"><table class="an-table">
        <thead><tr><th>Timezone</th><th>HC</th><th>% Org</th><th>Distribution</th><th>Departments</th></tr></thead>
        <tbody>${tzRows}</tbody>
    </table></div>
</div>` : ''}

${locKeys.length ? `
<div class="an-section">
    <div class="an-hd">Location × Job Level</div>
    <div class="an-table-wrap"><table class="an-table">
        <thead><tr><th>Location</th><th>C-Level</th><th>VP</th><th>Manager</th><th>IC</th><th>Total</th></tr></thead>
        <tbody>${locLvlRows}</tbody>
    </table></div>
</div>` : ''}

${topLoc ? `
<div class="an-section">
    <div class="an-hd">Co-located vs Distributed <span class="an-sub">HQ = ${esc(topLoc)}</span></div>
    <div class="geo-coloc-strip">
        <div class="geo-coloc-card geo-coloc-hq">
            <div class="geo-coloc-val">${colocPct}%</div>
            <div class="geo-coloc-lbl">Co-located</div>
            <div class="geo-coloc-sub">${hqEmps.length} employees at ${esc(topLoc)}</div>
        </div>
        <div class="geo-coloc-card">
            <div class="geo-coloc-val">${distPct}%</div>
            <div class="geo-coloc-lbl">Distributed</div>
            <div class="geo-coloc-sub">${distCount} employees at other locations</div>
        </div>
        ${noLoc ? `<div class="geo-coloc-card">
            <div class="geo-coloc-val" style="color:var(--muted);">${noLoc}</div>
            <div class="geo-coloc-lbl" style="color:var(--muted);">No Location</div>
            <div class="geo-coloc-sub">Location data missing</div>
        </div>` : ''}
    </div>
</div>` : ''}

</div>`;
}

// ── Location row click: filter org chart to that location ──
window._geoLocRow = function (el) {
    const city  = el.dataset.city;
    const state = el.dataset.state;
    const label = [city, state].filter(Boolean).join(', ');
    const filtered = allData.filter(d => !d.isGhost && d.city === city && d.state === state);
    if (!filtered.length) return;
    viewData = JSON.parse(JSON.stringify(filtered));
    const ns = new Set(viewData.map(d => d.id));
    viewData.forEach(d => { if (!ns.has(d.parentId)) d.parentId = 'VIEW_ROOT'; });
    viewData.push({ id: 'VIEW_ROOT', name: label, isGhost: true, parentId: null });
    showPage('orgchart');
    refresh(true);
};

// ── Dashboard filter shortcuts (from dept/mgr dropdowns) ──
function dashFilter(mode) {
    const val = g(mode === 'dept' ? 'dDept' : 'dMgr').value;
    if (!val || !allData.length) { resetDashView(); return; }
    const real = allData.filter(d => !d.isGhost);
    if (mode === 'dept') {
        viewData = JSON.parse(JSON.stringify(real.filter(d => d.department === val)));
    } else {
        const sub = [];
        const collect = id => {
            const node = real.find(d => d.id === id);
            if (node && !sub.find(s => s.id === id)) {
                sub.push(node);
                real.filter(d => d.parentId === id).forEach(c => collect(c.id));
            }
        };
        collect(val);
        viewData = JSON.parse(JSON.stringify(sub));
    }
    updateStats(viewData);
}
