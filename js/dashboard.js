// ── Dashboard drill mode ──
function setDrill(mode) {
    drillMode = mode;
    updateStats(viewData);
}

function swTab(btn, pId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    g(pId).classList.add('active');
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
    g('statHC').innerText     = real.length;
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
    buildRisk(real, mgrs, avgT, rats);
    buildTenure(real);
    buildLevel(real);
    buildGeo(real);
}

// ── Chart.js drill chart ──
function buildChart(real, grps, rats, dCts) {
    if (chartInst) chartInst.destroy();
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

// ── Risk flags ──
function buildRisk(real, mgrs, avgT, rats) {
    const flags = [];

    mgrs.forEach(m => {
        const n = real.filter(d => d.parentId === m.id).length;
        if (n >= 12)     flags.push({ l: 'high',   i: '🔴', t: `Over-Extended: ${m.name}`,  d: `${n} direct reports — critical span. Risk of manager burnout and degraded support.` });
        else if (n >= 9) flags.push({ l: 'medium', i: '🟡', t: `Wide Span: ${m.name}`,       d: `${n} direct reports — approaching upper healthy limit.` });
    });

    mgrs.forEach(m => {
        const r = pRat(m.rating);
        if (r !== 'NR' && r <= 2)
            flags.push({ l: 'high', i: '⚠️', t: `Low-Rated Manager: ${m.name}`, d: `Rating ${r}/5. Low-performing leaders degrade team morale and output.` });
    });

    [...new Set(real.map(d => d.department))].forEach(dept => {
        const de  = real.filter(d => d.department === dept);
        const lw  = de.filter(d => { const r = pRat(d.rating); return r !== 'NR' && r <= 2; });
        const pct = de.length ? (lw.length / de.length) * 100 : 0;
        if (pct >= 25 && lw.length >= 2)
            flags.push({ l: 'medium', i: '📉', t: `Performance Risk: ${dept}`, d: `${lw.length} of ${de.length} (${pct.toFixed(0)}%) rated ≤2.` });
    });

    if (avgT < 2)      flags.push({ l: 'high',   i: '🔄', t: 'Critical Tenure Risk',      d: `Avg tenure ${avgT.toFixed(1)} yrs. Investigate drivers of attrition or rapid growth.` });
    else if (avgT < 3) flags.push({ l: 'medium', i: '🔄', t: 'Below-Average Tenure',       d: `Avg ${avgT.toFixed(1)} yrs. Monitor retention in key roles.` });

    const nr = real.filter(d => pRat(d.rating) === 'NR').length;
    if (nr) flags.push({ l: 'low', i: '📋', t: `${nr} Missing Rating${nr > 1 ? 's' : ''}`, d: 'Ensure all employees are included in performance review cycles.' });

    const top5 = real.filter(d => pRat(d.rating) === 5).length;
    if (top5 && top5 / real.length >= 0.2)
        flags.push({ l: 'low', i: '⭐', t: 'Strong Performer Density', d: `${top5} employees (${((top5 / real.length) * 100).toFixed(0)}%) rated 5★ — excellent talent concentration.` });

    if (!flags.length) flags.push({ l: 'low', i: '✅', t: 'No Critical Risk Signals', d: 'Organization appears structurally healthy based on available data.' });

    g('riskList').innerHTML = flags
        .map(f => `<div class="risk-flag ${f.l}"><div style="font-size:17px;flex-shrink:0;margin-top:1px;">${f.i}</div><div><div class="rt">${f.t}</div><div class="rd-text">${f.d}</div></div></div>`)
        .join('');
}

// ── Tenure distribution bars ──
function buildTenure(real) {
    const bk = { '<1 yr': 0, '1–2': 0, '2–4': 0, '4–7': 0, '7+': 0 };
    real.forEach(d => {
        const t = tenYrs(d);
        if (t === null) return;
        if (t < 1)      bk['<1 yr']++;
        else if (t < 2) bk['1–2']++;
        else if (t < 4) bk['2–4']++;
        else if (t < 7) bk['4–7']++;
        else            bk['7+']++;
    });
    const mx = Math.max(...Object.values(bk), 1);
    g('tenureBars').innerHTML = Object.entries(bk)
        .map(([k, v]) => `<div class="bar-row"><div class="bar-lbl">${k}</div><div class="bar-track"><div class="bar-fill" style="width:${(v / mx * 100).toFixed(0)}%;background:var(--accent);"></div></div><div class="bar-ct">${v}</div></div>`)
        .join('');
}

// ── Avg salary by job level ──
function buildLevel(real) {
    const ord = ['C-Level', 'VP', 'M2', 'M1', 'IC4', 'IC3', 'IC2', 'IC1'];
    const lm  = {};
    real.forEach(d => {
        const lv = (d.jobLevel || '').trim();
        if (!lm[lv]) lm[lv] = [];
        const s = cleanSal(d.salary);
        if (s > 0) lm[lv].push(s);
    });
    const rows = ord
        .filter(l => lm[l] && lm[l].length)
        .map(l => ({ l, avg: lm[l].reduce((a, b) => a + b, 0) / lm[l].length, n: lm[l].length }));
    const mx = Math.max(...rows.map(r => r.avg), 1);
    g('levelBars').innerHTML = rows
        .map(({ l, avg, n }) => `<div class="bar-row"><div class="bar-lbl">${l} <span style="opacity:0.4;font-size:9px;">(${n})</span></div><div class="bar-track"><div class="bar-fill" style="width:${(avg / mx * 100).toFixed(0)}%;background:var(--accent2);"></div></div><div class="bar-ct">${fmtK(avg)}</div></div>`)
        .join('');
}

// ── Headcount by location ──
function buildGeo(real) {
    const geo = {};
    real.forEach(d => {
        const loc = [d.city, d.state].filter(Boolean).join(', ');
        if (loc) geo[loc] = (geo[loc] || 0) + 1;
    });
    const sorted = Object.entries(geo).sort((a, b) => b[1] - a[1]);
    const mx = sorted[0]?.[1] || 1;
    g('geoList').innerHTML = sorted
        .map(([loc, n]) => `<div style="margin-bottom:9px;"><div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="font-size:11px;color:var(--muted);">${loc}</span><span style="font-size:11px;font-weight:700;">${n}</span></div><div class="bar-track"><div class="bar-fill" style="width:${(n / mx * 100).toFixed(0)}%;background:var(--accent2);"></div></div></div>`)
        .join('');
}

// ── Dashboard filter shortcuts (from dept/mgr dropdowns) ──
function dashFilter(mode) {
    const val = g(mode === 'dept' ? 'dDept' : 'dMgr').value;
    if (!val) return;
    g('filterVal').value   = val;
    g('filterMode').value  = mode === 'dept' ? 'dept' : 'team';
    applyFilter();
}
