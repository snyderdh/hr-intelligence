// ── Global state ──
let allData  = [];   // full dataset (includes ghost ROOT node after CSV load)
let viewData = [];   // currently rendered subset (filtered or full)
let deptCol  = {};   // department → color mapping

// ── UI state ──
let chartInst = null;        // Chart.js instance
let drillMode = 'headcount'; // active dashboard drill: 'headcount'|'salary'|'tier'|'rating'
let tags      = [];          // selected employee IDs in the bulk-action bubble input
let aiHist        = [];      // Claude conversation history [{role, content}]
let aiLoading     = false;   // prevent concurrent AI requests
let dragUndoStack = [];      // [{id, oldParentId, newParentId, scenarioId}] — drag undo
let dragRedoStack = [];      // [{id, oldParentId, newParentId}] — drag redo

// ── Scenario management ──
// A scenario is a named snapshot of org data users can freely edit without
// touching the baseline live data. Stored in localStorage for persistence.
let scenarios         = {};    // { [id]: { id, name, description, createdAt, data: [...] } }
let currentScenarioId = null;  // null = live data, string = scenario id
let isScenarioMode    = false; // true when viewing / editing a scenario
let _liveDataSnapshot = null;  // deep copy of allData before entering a scenario

// ── Load scenarios from localStorage on startup ──
(function _hydrateScenarios() {
    try {
        const raw = localStorage.getItem('canopy_scenarios');
        if (raw) scenarios = JSON.parse(raw);
    } catch (e) {
        scenarios = {};
    }
})();

function _persistScenarios() {
    try { localStorage.setItem('canopy_scenarios', JSON.stringify(scenarios)); }
    catch (e) { console.warn('[Canopy] Could not persist scenarios:', e); }
}

// ── Save current allData as a named scenario ──
function saveScenario(name, description) {
    if (!name || !name.trim()) { alert('Please provide a scenario name.'); return null; }
    const id = 'sc_' + Date.now();
    const real = allData.filter(d => !d.isGhost);
    scenarios[id] = {
        id,
        name: name.trim(),
        description: (description || '').trim(),
        createdAt: new Date().toISOString(),
        data: JSON.parse(JSON.stringify(real)),
    };
    _persistScenarios();
    console.log('[Canopy] Saved scenario:', id, name);
    return id;
}

// ── Load a scenario — swaps allData/viewData to the scenario's copy ──
function loadScenario(id) {
    const sc = scenarios[id];
    if (!sc) { console.warn('[Canopy] Scenario not found:', id); return; }

    // Preserve live data snapshot so we can return to it
    if (!isScenarioMode) {
        _liveDataSnapshot = JSON.parse(JSON.stringify(allData));
    }

    currentScenarioId = id;
    isScenarioMode    = true;
    dragUndoStack     = [];
    dragRedoStack     = [];

    // Rebuild allData from the scenario — re-attach ghost root
    allData = JSON.parse(JSON.stringify(sc.data));
    allData.push({ id: 'ROOT', name: 'Organization', isGhost: true, parentId: null });

    // Rebuild dept colors
    deptCol = {};
    [...new Set(allData.filter(d => d.department).map(d => d.department))]
        .forEach((d, i) => { deptCol[d] = PAL[i % PAL.length]; });

    viewData = JSON.parse(JSON.stringify(allData));
    if (typeof refresh === 'function') refresh(true);
    console.log('[Canopy] Loaded scenario:', id, sc.name);
}

// ── Return to live data ──
function exitScenario() {
    if (!isScenarioMode || !_liveDataSnapshot) return;
    allData = JSON.parse(JSON.stringify(_liveDataSnapshot));
    _liveDataSnapshot = null;
    currentScenarioId = null;
    isScenarioMode    = false;
    dragUndoStack     = [];
    dragRedoStack     = [];

    deptCol = {};
    [...new Set(allData.filter(d => d.department).map(d => d.department))]
        .forEach((d, i) => { deptCol[d] = PAL[i % PAL.length]; });

    viewData = JSON.parse(JSON.stringify(allData));
    if (typeof refresh === 'function') refresh(true);
}

// ── Delete a scenario (cannot delete the currently active one) ──
function deleteScenario(id) {
    if (currentScenarioId === id) {
        alert('Exit the scenario before deleting it.');
        return false;
    }
    delete scenarios[id];
    _persistScenarios();
    return true;
}

// ── Auto-save scenario changes whenever commitMove is called (wired in drag.js) ──
function _autoSaveScenario() {
    if (!isScenarioMode || !currentScenarioId) return;
    const sc = scenarios[currentScenarioId];
    if (!sc) return;
    sc.data = JSON.parse(JSON.stringify(allData.filter(d => !d.isGhost)));
    _persistScenarios();
}

// ── Redo (scenario-aware) ──
function redoLastMove() {
    if (!dragRedoStack.length) return;
    const { id, newParentId } = dragRedoStack.pop();
    const entry = { id, oldParentId: null, newParentId };
    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === id);
        if (n) { entry.oldParentId = n.parentId; n.parentId = newParentId; }
    });
    dragUndoStack.push(entry);
    if (typeof g === 'function' && g('undoBtn')) g('undoBtn').style.display = 'flex';
    if (typeof _ssUpdateUndoRedo === 'function') _ssUpdateUndoRedo();
    _autoSaveScenario();
    if (typeof _smartRefresh === 'function') _smartRefresh(false); else if (typeof refresh === 'function') refresh(false);
}

// ── Constants ──
const PAL = [
    '#38bdf8','#6366f1','#10b981','#f59e0b','#ef4444',
    '#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16'
];

// ── Shared org chart instance ──
const orgC = new d3.OrgChart().container('.chart-container');


// ── Utility helpers ──
const g        = id => document.getElementById(id);
const cleanSal = v  => parseFloat(String(v).replace(/[$,]/g, '')) || 0;
const fmtN     = n  => '$' + Math.round(n).toLocaleString();
const fmtK     = n  => '$' + Math.round(n / 1000).toLocaleString() + 'K';
const fmtM     = n  => '$' + (n / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
const pRat     = v  => {
    if (!v || String(v).trim() === '') return 'NR';
    const m = String(v).match(/\d/);
    return m ? parseInt(m[0]) : 'NR';
};
const tenYrs = d => {
    const s = new Date(d.startDate);
    return isNaN(s) ? null : (new Date() - s) / (1000 * 60 * 60 * 24 * 365.25);
};
const group = d => {
    const lv = (d.jobLevel || '').trim().toUpperCase();
    if (lv === 'C-LEVEL' || lv.startsWith('CEO')) return 'C-Level';
    if (lv.startsWith('VP') || lv.startsWith('SVP')) return 'VP';
    if (allData.some(e => e.parentId === d.id && !e.isGhost)) return 'People Managers';
    return 'Individual Contributors';
};
