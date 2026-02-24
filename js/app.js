// ── Top-bar panel toggles ──
function toggleControls() {
    g('controlStrip').classList.toggle('hidden');
    setTimeout(() => { if (allData.length) orgC.render().fit(); }, 350);
}

function toggleDashboard() { g('dashboard').classList.toggle('open'); }
function toggleAI()        { g('aiPanel').classList.toggle('open');   }

// ── Bulk-action bubble tags ──
function renderTags() {
    const box = g('bubbleBox');
    box.querySelectorAll('.tag-bubble').forEach(b => b.remove());
    tags.forEach(t => {
        const b = document.createElement('div');
        b.className = 'tag-bubble';
        b.innerHTML = `${t} <span class="tag-remove" onclick="rmTag('${t.replace(/'/g, "\\'")}')">×</span>`;
        box.insertBefore(b, g('editTarget'));
    });
}

window.rmTag = id => { tags = tags.filter(t => t !== id); renderTags(); };

// ── Filter panel UI ──
function toggleFilterUI() {
    g('filterUI').style.display = g('filterMode').value === 'none' ? 'none' : 'block';
}

// ── Edit panel UI ──
function toggleEditUI() {
    const mode = g('editMode').value;
    g('destList').innerHTML = '';
    g('editUI').style.display       = mode === 'none' ? 'none' : 'block';
    g('bubbleSys').style.display    = mode === 'hire' ? 'none' : 'block';
    g('hireFields').style.display   = mode === 'hire' ? 'block' : 'none';
    g('editDest').style.display     = mode === 'delete' ? 'none' : 'block';
    g('editDest').placeholder       = mode === 'deptUpdate' ? 'Select department…' : 'Select reporting manager…';

    if (mode === 'move' || mode === 'hire') {
        allData.filter(d => !d.isGhost).forEach(m => {
            const o = document.createElement('option');
            o.value = m.id;
            g('destList').appendChild(o);
        });
    } else if (mode === 'deptUpdate') {
        [...new Set(allData.filter(d => !d.isGhost).map(d => d.department))].forEach(d => {
            const o = document.createElement('option');
            o.value = d;
            g('destList').appendChild(o);
        });
    }
}

// ── Execute bulk edit ──
function runEdit() {
    const mode = g('editMode').value;
    const dest = g('editDest').value;

    if (mode === 'hire') {
        const hN = g('hireName').value.trim();
        if (!hN) { alert('Please enter a name.'); return; }
        const mgr = allData.find(d => d.id === dest);
        allData.push({
            id: hN, name: hN, title: 'Draft Hire',
            parentId: dest || 'ROOT',
            department: mgr ? mgr.department : 'Unassigned',
            salary: g('hireSal').value || 0,
            startDate: new Date().toLocaleDateString(),
            rating: 'NR',
            jobLevel: g('hireLevel').value || 'IC1',
            email: '', city: '', state: '',
        });
    } else {
        tags.forEach(name => {
            const t = allData.find(d => d.id === name);
            if (!t) return;
            if (mode === 'move')         t.parentId   = dest;
            else if (mode === 'deptUpdate') t.department = dest;
            else if (mode === 'delete') {
                allData.filter(d => d.parentId === t.id).forEach(r => r.parentId = t.parentId);
                allData = allData.filter(d => d.id !== name);
            }
        });
    }
    resetAll();
}

// ── Filter / view ──
function applyFilter() {
    const mode = g('filterMode').value;
    const val  = g('filterVal').value;
    if (!val || !allData.length) return;

    if (mode === 'team') {
        const root = allData.find(d => d.id === val);
        if (!root) return;
        const sub = [root];
        const kids = id => allData.forEach(d => { if (d.parentId === id) { sub.push(d); kids(d.id); } });
        kids(val);
        viewData = JSON.parse(JSON.stringify(sub));
        viewData.find(d => d.id === val).parentId = null;
        refresh();
        orgC.setCentered(val).render();
    } else {
        viewData = JSON.parse(JSON.stringify(allData.filter(d => d.department === val)));
        const ns = new Set(viewData.map(d => d.id));
        viewData.forEach(d => { if (!ns.has(d.parentId)) d.parentId = 'VIEW_ROOT'; });
        viewData.push({ id: 'VIEW_ROOT', name: val, isGhost: true, parentId: null });
        refresh(true);
    }
}

// ── Full reset ──
function resetAll() {
    tags = []; renderTags();
    dragUndoStack = []; g('undoBtn').style.display = 'none';
    ['globalSearch', 'filterVal', 'editTarget', 'editDest', 'dDept', 'dMgr', 'hireName', 'hireSal']
        .forEach(id => { if (g(id)) g(id).value = ''; });
    g('filterMode').value = 'none';
    g('editMode').value   = 'none';
    toggleEditUI();
    closeSpot();
    if (allData.length) { viewData = JSON.parse(JSON.stringify(allData)); refresh(true); }
}

// ── Initialisation ──
Chart.register(ChartDataLabels);
initFileInput();
updateAIStatus();

// Bubble-tag input: add tag when employee id matched
g('editTarget').addEventListener('input', function (e) {
    const v   = e.target.value;
    const emp = allData.find(d => d.id === v);
    if (emp && !tags.includes(v)) {
        tags.push(v);
        renderTags();
        e.target.value = '';
    }
});
