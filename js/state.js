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
let dragUndoStack = [];      // [{id, oldParentId}] — drag-and-drop undo history

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

// ── Scenario State ──
let scenarios       = {};    // { id: { id, name, createdAt, description, data: [...] } }
let currentScenarioId = null;
let scenarioHistory   = [];  // [{ employeeId, previousParentId, newParentId, timestamp }]
let scenarioRedoStack = [];
let isScenarioMode    = false;
let baselineData      = [];  // snapshot of allData at CSV load time

// Load persisted scenarios on startup
(function initScenarios() {
    try {
        const raw = localStorage.getItem('canopy_scenarios');
        if (raw) scenarios = JSON.parse(raw);
    } catch (e) { scenarios = {}; }
})();

function persistScenarios() {
    try { localStorage.setItem('canopy_scenarios', JSON.stringify(scenarios)); } catch (e) {}
}

function saveScenario(name, description) {
    const id = 'scn_' + Date.now();
    scenarios[id] = {
        id,
        name:        name.trim(),
        description: (description || '').trim(),
        createdAt:   new Date().toISOString(),
        data:        JSON.parse(JSON.stringify(allData)),
    };
    persistScenarios();
    return id;
}

function loadScenario(id) {
    const scn = scenarios[id];
    if (!scn) return false;
    currentScenarioId = id;
    isScenarioMode    = true;
    scenarioHistory   = [];
    scenarioRedoStack = [];
    allData  = JSON.parse(JSON.stringify(scn.data));
    viewData = JSON.parse(JSON.stringify(allData));
    deptCol  = {};
    [...new Set(allData.filter(d => d.department).map(d => d.department))]
        .forEach((d, i) => { deptCol[d] = PAL[i % PAL.length]; });
    return true;
}

function deleteScenario(id) {
    delete scenarios[id];
    persistScenarios();
}

function exitScenarioMode() {
    currentScenarioId = null;
    isScenarioMode    = false;
    scenarioHistory   = [];
    scenarioRedoStack = [];
    if (baselineData.length) {
        allData  = JSON.parse(JSON.stringify(baselineData));
        viewData = JSON.parse(JSON.stringify(allData));
        deptCol  = {};
        [...new Set(allData.filter(d => d.department).map(d => d.department))]
            .forEach((d, i) => { deptCol[d] = PAL[i % PAL.length]; });
    }
}
