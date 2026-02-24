// ── Org chart rendering ──

function refresh(fit = false) {
    if (!viewData.length) return;

    // Compute headcount badges
    const map = {};
    viewData.forEach(d => { map[d.id] = d; d._hc = 0; });
    viewData.forEach(d => { let p = map[d.parentId]; while (p) { p._hc++; p = map[p.parentId]; } });

    updateStats(viewData);
    updateAIStatus();
    g('emptyState').classList.add('hidden');

    // Rebuild datalist options
    const mgrs  = [...new Set(allData.filter(d => allData.some(e => e.parentId === d.id)).map(m => m.id))].sort();
    const depts = [...new Set(allData.filter(d => !d.isGhost).map(d => d.department))].sort();
    const levs  = [...new Set(allData.filter(d => !d.isGhost).map(d => d.jobLevel))].sort();

    g('dMgr').innerHTML  = '<option value="">All Teams</option>'  + mgrs.map(m  => `<option value="${m}">${m}</option>`).join('');
    g('dDept').innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    g('namesList').innerHTML = allData.filter(d => !d.isGhost).map(d => `<option value="${d.id}"></option>`).join('');
    g('dynList').innerHTML   = [...depts, ...mgrs].map(v => `<option value="${v}"></option>`).join('');
    g('hireLevel').innerHTML = '<option value="">Job Level…</option>' + levs.map(l => `<option value="${l}">${l}</option>`).join('');

    // Build a numeric index map so data-nid values are plain integers (avoids content filters)
    // _nidMap[integer] = real node id string
    window._nidMap = {};
    window._nidRev = {};
    let _nidCounter = 0;
    viewData.forEach(d => {
        if (!d.isGhost) {
            const idx = _nidCounter++;
            _nidMap[idx] = d.id;
            _nidRev[d.id] = idx;
        }
    });

    orgC
        .data(viewData)
        .nodeWidth(() => 220)
        .nodeHeight(() => 86)
        .compact(true)
        .nodeContent(d => {
            if (d.data.isGhost) {
                return `<div style="padding:10px 14px;background:#0d1525;border:1px solid rgba(255,255,255,0.08);color:#64748b;border-radius:10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">${d.data.name}</div>`;
            }
            const col  = deptCol[d.data.department] || '#64748b';
            // Convert #rrggbb → rgba(r,g,b,0.09) for the dept pill background
            const hexToRgba = (hex, a) => {
                const h = hex.replace('#','');
                const r = parseInt(h.slice(0,2),16), gg = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
                return `rgba(${r},${gg},${b},${a})`;
            };
            const colBg = hexToRgba(col, 0.09);
            const r    = pRat(d.data.rating);
            let rbar = '';
            if (r !== 'NR') {
                let dots = '';
                for (let i = 0; i < r;     i++) dots += `<div style="width:7px;height:2px;border-radius:1px;background:${col};opacity:0.8;"></div>`;
                for (let i = r; i < 5;     i++) dots += `<div style="width:7px;height:2px;border-radius:1px;background:rgba(255,255,255,0.1);"></div>`;
                rbar = `<div style="display:flex;gap:2px;margin-top:5px;">${dots}</div>`;
            }
            // Use numeric index as data-nid value — plain integers pass content filters
            const nidIdx = window._nidRev[d.data.id];
            return `<div data-nid="${nidIdx}" onclick="window.spotById('${d.data.id.replace(/'/g, "\\'")}')"
                style="position:relative;cursor:pointer;padding:9px 11px 9px 14px;background:#111827;border-left:3px solid ${col};border-radius:10px;height:64px;border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${col};box-shadow:0 3px 10px rgba(0,0,0,0.35);transition:box-shadow 0.18s;"
                onmouseenter="this.style.boxShadow='0 5px 18px rgba(0,0,0,0.55)'"
                onmouseleave="this.style.boxShadow='0 3px 10px rgba(0,0,0,0.35)'">
                ${d.data._hc > 0 ? `<div style="position:absolute;top:-8px;right:-8px;background:#1e293b;color:${col};border:2px solid #080c14;border-radius:50%;width:19px;height:19px;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;">${d.data._hc}</div>` : ''}
                <div style="font-weight:700;font-size:11px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.data.name}</div>
                <div style="font-size:9px;color:#64748b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.data.title}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                    <div style="font-size:8px;color:${col};background:${colBg};padding:1px 6px;border-radius:4px;font-weight:700;">${d.data.department}</div>
                    <span style="font-size:8px;color:#475569;font-weight:700;">${d.data.jobLevel || ''}</span>
                </div>${rbar}</div>`;
        })
        .render();

    if (fit) orgC.fit();

    // Re-attach drag behaviour after every render.
    // Try immediately, then again after short delays to catch async DOM writes.
    setTimeout(initDrag, 0);
    setTimeout(initDrag, 100);
    setTimeout(initDrag, 500);
}

// ── Spotlight popup ──
window.spotById = function (id) {
    const e = allData.find(d => d.id === id);
    if (!e) return;
    g('sName').innerText  = e.name;
    g('sTitle').innerText = e.title || '—';
    g('sMgr').innerText   = (!e.parentId || e.parentId === 'ROOT') ? 'Top Level' : e.parentId;
    g('sDept').innerText  = e.department || '—';
    const s = cleanSal(e.salary);
    g('sSal').innerText   = s ? fmtN(s) : '—';
    g('sLvl').innerText   = e.jobLevel || '—';
    const r = pRat(e.rating);
    g('sRating').innerText = r === 'NR' ? 'Not Rated' : '★'.repeat(r) + '☆'.repeat(5 - r) + ` (${r}/5)`;
    g('sLoc').innerText   = [e.city, e.state].filter(Boolean).join(', ') || '—';
    const t = tenYrs(e);
    g('sTen').innerText   = t !== null ? t.toFixed(1) + ' years' : '—';
    g('sEmail').innerText = e.email || '—';
    g('spotlight').style.display = 'block';
};

function closeSpot() {
    g('spotlight').style.display = 'none';
}

function focusEmp(name) {
    const t = allData.find(d => d.id === name);
    if (t) {
        orgC.clearHighlighting();
        orgC.setHighlighted(t.id).setCentered(t.id).render();
        window.spotById(t.id);
    }
}
