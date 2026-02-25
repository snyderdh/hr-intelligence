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

    // Rebuild datalist options and filters
    const mgrs  = [...new Set(allData.filter(d => allData.some(e => e.parentId === d.id)).map(m => m.id))].sort();
    const depts = [...new Set(allData.filter(d => !d.isGhost).map(d => d.department))].sort();

    g('dMgr').innerHTML  = '<option value="">All Teams</option>'  + mgrs.map(m  => `<option value="${m}">${m}</option>`).join('');
    g('dDept').innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    g('namesList').innerHTML = allData.filter(d => !d.isGhost).map(d => `<option value="${d.id}"></option>`).join('');
    if (g('orgDeptFilter')) {
        const cur = g('orgDeptFilter').value;
        g('orgDeptFilter').innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}"${d === cur ? ' selected' : ''}>${d}</option>`).join('');
    }

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
                return `<div style="padding:10px 14px;background:#f5f3ef;border:1px solid #e8e4dc;color:#6b6880;border-radius:14px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;font-family:'Nunito',sans-serif;">${d.data.name}</div>`;
            }
            const col  = deptCol[d.data.department] || '#64748b';
            // Convert #rrggbb → rgba(r,g,b,0.09) for the dept pill background
            const hexToRgba = (hex, a) => {
                const h = hex.replace('#','');
                const r = parseInt(h.slice(0,2),16), gg = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
                return `rgba(${r},${gg},${b},${a})`;
            };
            const colBg = hexToRgba(col, 0.1);
            const r    = pRat(d.data.rating);
            let rbar = '';
            if (r !== 'NR') {
                let dots = '';
                for (let i = 0; i < r;     i++) dots += `<div style="width:7px;height:2px;border-radius:1px;background:${col};opacity:0.9;"></div>`;
                for (let i = r; i < 5;     i++) dots += `<div style="width:7px;height:2px;border-radius:1px;background:#e8e4dc;"></div>`;
                rbar = `<div style="display:flex;gap:2px;margin-top:5px;">${dots}</div>`;
            }
            // Use numeric index as data-nid value — plain integers pass content filters
            const nidIdx = window._nidRev[d.data.id];
            return `<div data-nid="${nidIdx}" onclick="window.spotById(window._nidMap[${nidIdx}])"
                style="position:relative;cursor:pointer;padding:9px 11px 9px 14px;background:#ffffff;border-left:3px solid ${col};border-radius:14px;height:74px;border:1px solid #e8e4dc;border-left:3px solid ${col};box-shadow:0 2px 8px rgba(180,160,130,0.13),0 1px 3px rgba(180,160,130,0.08);transition:box-shadow 0.18s,transform 0.12s;font-family:'Nunito',sans-serif;"
                onmouseenter="this.style.boxShadow='0 6px 20px rgba(180,160,130,0.22),0 2px 6px rgba(180,160,130,0.12)';this.style.transform='translateY(-1px)'"
                onmouseleave="this.style.boxShadow='0 2px 8px rgba(180,160,130,0.13),0 1px 3px rgba(180,160,130,0.08)';this.style.transform='none'">
                ${d.data._hc > 0 ? `<div style="position:absolute;top:-8px;right:-8px;background:${col};color:#fff;border:2px solid #fafaf7;border-radius:50%;width:20px;height:20px;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:'Nunito',sans-serif;">${d.data._hc}</div>` : ''}
                <div style="font-weight:800;font-size:11px;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.data.name}</div>
                <div style="font-size:9px;color:#6b6880;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;">${d.data.title}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                    <div style="font-size:8px;color:${col};background:${colBg};padding:1px 7px;border-radius:50px;font-weight:800;">${d.data.department}</div>
                    <span style="font-size:8px;color:#6b6880;font-weight:700;">${d.data.jobLevel || ''}</span>
                </div>${rbar}
                </div>`;
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
window.closeSpotlight = closeSpot;

function focusEmp(name) {
    const t = allData.find(d => d.id === name);
    if (!t) return;
    // Clear d3's built-in highlight then centre — we apply our own visual treatment
    orgC.clearHighlighting();
    orgC.setCentered(t.id).render();
    window.spotById(t.id);
    // Wait for d3's render pass to write node DOM before applying styles
    setTimeout(function () { _applySearchHighlight(t.id); }, 100);
}

function _applySearchHighlight(nodeId) {
    const targetNid = window._nidRev && window._nidRev[nodeId] !== undefined
        ? String(window._nidRev[nodeId]) : null;
    document.querySelectorAll('[data-nid]').forEach(function (card) {
        if (card.getAttribute('data-nid') === targetNid) {
            card.style.opacity    = '1';
            card.style.boxShadow  = '0 0 0 3px rgba(232,93,61,0.3), 0 8px 32px rgba(232,93,61,0.2)';
            card.style.transform  = 'scale(1.03)';
            card.style.zIndex     = '10';
            card.style.transition = 'box-shadow 0.25s, transform 0.25s, opacity 0.25s';
        } else {
            card.style.opacity    = '0.4';
            card.style.boxShadow  = '';
            card.style.transform  = '';
            card.style.zIndex     = '';
            card.style.transition = 'opacity 0.25s';
        }
    });
}

function clearEmpSearch() {
    g('globalSearch').value = '';
    document.querySelectorAll('[data-nid]').forEach(function (card) {
        card.style.opacity    = '';
        card.style.boxShadow  = '';
        card.style.transform  = '';
        card.style.zIndex     = '';
        card.style.transition = '';
    });
}

