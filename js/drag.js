// ── Drag-and-drop node reassignment ──
//
// Strategy:
// 1. A single delegated mousedown on document catches all card clicks via
//    closest('[data-nid]') — no per-card listener attachment, no timing issues.
// 2. On first mousemove past threshold, a full-screen transparent overlay div
//    is inserted to capture ALL subsequent mouse events, sidestepping d3-zoom.
// 3. Drop detection uses getBoundingClientRect() hit-testing against all cards.
// 4. On mouseup the overlay is removed and commitMove() is called if valid.
//
// data-nid values are numeric indices (0, 1, 2…) to avoid content filters.
// _nidMap[index] → real node id string  (built in chart.js before each render)
// _nidRev[id]    → numeric index string (also built in chart.js)

let _dragGhost     = null;
let _dragSourceId  = null;   // real node id string
let _dropTargetId  = null;   // real node id string
let _dragMoved     = false;
let _startX        = 0;
let _startY        = 0;
let _activeDragCol = '#64748b';
let _overlay       = null;

// ── Cost delta state ──
let _dragSubtreeCost  = 0;   // sum of dragged employee + all descendants salaries
let _dragSubtreeCount = 0;   // number of reports moving with the dragged node
let _costBadge        = null; // floating badge element

const DRAG_THRESHOLD = 6;

// ── Descendant guard ──
function isDescendantOf(candidateId, ancestorId) {
    const visited = new Set();
    let current = candidateId;
    while (current) {
        if (visited.has(current)) break;
        visited.add(current);
        const node = allData.find(d => d.id === current);
        if (!node) break;
        if (node.parentId === ancestorId) return true;
        current = node.parentId;
    }
    return false;
}

// ── Resolve numeric nid index ↔ real node id ──
function nidToId(nidIdx) {
    return (window._nidMap && window._nidMap[nidIdx] !== undefined)
        ? window._nidMap[nidIdx] : null;
}
function idToNid(nodeId) {
    return (window._nidRev && window._nidRev[nodeId] !== undefined)
        ? String(window._nidRev[nodeId]) : null;
}

// ── Compute subtree cost (employee + all descendants) ──
function subtreeCost(rootId) {
    let total = 0, count = 0;
    const queue = [rootId];
    const seen  = new Set();
    while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const node = allData.find(d => d.id === id);
        if (!node || node.isGhost) continue;
        if (id !== rootId) count++;
        total += cleanSal(node.salary);
        allData.filter(d => d.parentId === id && !d.isGhost).forEach(c => queue.push(c.id));
    }
    return { total, count };
}

// ── Ghost label that follows the cursor ──
function createGhost(name, col) {
    removeGhost();
    const ghost = document.createElement('div');
    ghost.id = 'dragGhost';
    ghost.innerText = '↳ ' + name;
    ghost.style.cssText = [
        'position:fixed', 'pointer-events:none', 'z-index:999999',
        'padding:6px 13px', 'border-radius:8px',
        'background:#ffffff', 'border:2px solid ' + col,
        'color:#1a1a2e', 'font-size:11px', 'font-weight:700',
        "font-family:'Nunito',sans-serif",
        'box-shadow:0 4px 16px rgba(180,160,130,0.28)',
        'opacity:0.95', 'white-space:nowrap',
        'transform:translate(12px,-50%)',
        'transition:border-color 0.12s',
        'left:-9999px', 'top:-9999px',
    ].join(';');
    document.body.appendChild(ghost);
    return ghost;
}
function moveGhost(x, y) {
    if (_dragGhost) { _dragGhost.style.left = x + 'px'; _dragGhost.style.top = y + 'px'; }
}
function removeGhost() {
    const old = document.getElementById('dragGhost');
    if (old) old.remove();
    _dragGhost = null;
}

// ── Cost badge — shows near cursor with employee info ──
function createCostBadge(name, salary, reportCount) {
    removeCostBadge();
    const badge = document.createElement('div');
    badge.id = 'dragCostBadge';
    const reports = reportCount > 0 ? ` +${reportCount} report${reportCount !== 1 ? 's' : ''}` : '';
    badge.innerHTML = `
        <div style="font-weight:800;font-size:11px;color:#1a1a2e;">${name}</div>
        <div style="font-size:10px;color:#e85d3d;font-weight:700;margin-top:2px;">${fmtK(salary)}${reports}</div>
    `;
    badge.style.cssText = [
        'position:fixed', 'pointer-events:none', 'z-index:999998',
        'padding:7px 12px', 'border-radius:10px',
        'background:#ffffff',
        'border:1px solid #e8e4dc',
        'box-shadow:0 4px 20px rgba(180,160,130,0.30)',
        'white-space:nowrap',
        "font-family:'Nunito',sans-serif",
        'transform:translate(-50%, calc(-100% - 14px))',
        'left:-9999px', 'top:-9999px',
        'opacity:0', 'transition:opacity 0.12s',
    ].join(';');
    document.body.appendChild(badge);
    requestAnimationFrame(() => { badge.style.opacity = '1'; });
    _costBadge = badge;
    return badge;
}
function moveCostBadge(x, y) {
    if (_costBadge) { _costBadge.style.left = x + 'px'; _costBadge.style.top = y + 'px'; }
}
function removeCostBadge() {
    const old = document.getElementById('dragCostBadge');
    if (old) old.remove();
    _costBadge = null;
}

// ── Full-screen overlay — captures all mouse events during drag ──
function createOverlay() {
    const ov = document.createElement('div');
    ov.id = 'dragOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;cursor:grabbing;';
    ov.addEventListener('mousemove', _onMove);
    ov.addEventListener('mouseup',   _onUp);
    ov.addEventListener('mouseleave', _onUp);
    document.body.appendChild(ov);
    return ov;
}
function removeOverlay() {
    const ov = document.getElementById('dragOverlay');
    if (ov) ov.remove();
    _overlay = null;
}

// ── Rect hit-test — returns the real node id ──
function nodeIdAtPoint(x, y) {
    const cards = document.querySelectorAll('[data-nid]');
    for (const card of cards) {
        const r = card.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            return nidToId(card.getAttribute('data-nid')) || card.getAttribute('data-nid');
        }
    }
    return null;
}

// ── Drop-target highlight ──
function setDropHighlight(nodeId, on) {
    const nidIdx = idToNid(nodeId);
    const el = document.querySelector('[data-nid="' + (nidIdx !== null ? nidIdx : CSS.escape(nodeId)) + '"]');
    if (!el) return;
    el.classList.toggle('drag-drop-target', on);
}

// ── Drop toast notification ──
let _toastTimer = null;
function showDropToast(sourceName, targetName, costImpact) {
    const existing = document.getElementById('dropToast');
    if (existing) { existing.remove(); clearTimeout(_toastTimer); }

    const impactStr = costImpact === 0
        ? '<span style="color:var(--green);font-weight:800;">No cost impact</span>'
        : `<span style="color:var(--accent);font-weight:800;">${costImpact > 0 ? '+' : ''}${fmtK(costImpact)} impact</span>`;

    const toast = document.createElement('div');
    toast.id = 'dropToast';
    toast.innerHTML = `
        <div style="display:flex;align-items:center;gap:9px;">
            <div style="font-size:15px;">✓</div>
            <div>
                <div style="font-weight:800;font-size:12px;color:#1a1a2e;">
                    ${sourceName} → ${targetName}
                </div>
                <div style="font-size:11px;margin-top:2px;">${impactStr}</div>
            </div>
            <div id="dropToastClose" style="margin-left:auto;cursor:pointer;color:#6b6880;font-size:16px;line-height:1;padding:2px 4px;" onclick="document.getElementById('dropToast').remove()">×</div>
        </div>
    `;
    toast.style.cssText = [
        'position:fixed',
        'top:72px',          // just below nav
        'left:50%',
        'transform:translateX(-50%) translateY(-8px)',
        'z-index:200000',
        'background:#ffffff',
        'border:1px solid #e8e4dc',
        'border-left:3px solid #2d9b6f',
        'border-radius:14px',
        'padding:12px 16px',
        'box-shadow:0 8px 32px rgba(180,160,130,0.22)',
        "font-family:'Nunito',sans-serif",
        'white-space:nowrap',
        'opacity:0',
        'transition:opacity 0.2s, transform 0.2s',
        'min-width:280px',
    ].join(';');
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Auto-dismiss after 3s
    _toastTimer = setTimeout(() => {
        if (!toast.parentNode) return;
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-8px)';
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 220);
    }, 3000);
}

// ── Commit the move ──
function commitMove(sourceId, targetId) {
    const sourceNode = allData.find(d => d.id === sourceId);
    if (!sourceNode) return;

    const oldParentId = sourceNode.parentId;
    const newParentId = targetId;

    // Push to undo stack (scenario-aware)
    dragUndoStack.push({ id: sourceId, oldParentId, newParentId });
    dragRedoStack = []; // new move clears redo stack
    if (g('undoBtn')) g('undoBtn').style.display = 'flex';
    if (typeof _ssUpdateUndoRedo === 'function') _ssUpdateUndoRedo();

    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === sourceId);
        if (n) n.parentId = newParentId;
    });

    // Auto-save if in scenario mode
    if (typeof _autoSaveScenario === 'function') _autoSaveScenario();

    // Compute cost impact (across dept boundaries)
    const srcDept = sourceNode.department;
    const tgt = allData.find(d => d.id === targetId);
    const tgtDept = tgt ? tgt.department : null;
    // Currently shows $0 if same dept, subtree cost as impact if crossing dept boundary.
    // This wires the calculation — extend the formula as product evolves.
    const costImpact = (srcDept && tgtDept && srcDept !== tgtDept) ? _dragSubtreeCost : 0;

    const targetNode = allData.find(d => d.id === targetId);
    showDropToast(
        sourceNode.name,
        targetNode ? targetNode.name : targetId,
        costImpact
    );

    if (typeof _smartRefresh === 'function') _smartRefresh(false); else refresh(false);
}

// ── Drag move handler (on overlay) ──
function _onMove(e) {
    if (!_dragSourceId) return;
    const cx = e.clientX, cy = e.clientY;

    if (!_dragMoved) {
        if (Math.sqrt((cx-_startX)**2 + (cy-_startY)**2) < DRAG_THRESHOLD) return;
        _dragMoved = true;
        const srcNode = allData.find(d => d.id === _dragSourceId);
        _dragGhost = createGhost(srcNode ? srcNode.name : _dragSourceId, _activeDragCol);
        // Show cost badge
        if (srcNode) {
            createCostBadge(srcNode.name, cleanSal(srcNode.salary), _dragSubtreeCount);
        }
        const srcNid = idToNid(_dragSourceId);
        const srcCard = document.querySelector('[data-nid="' + (srcNid !== null ? srcNid : CSS.escape(_dragSourceId)) + '"]');
        if (srcCard) srcCard.classList.add('drag-source');
    }

    moveGhost(cx, cy);
    moveCostBadge(cx, cy);

    const hoverId = nodeIdAtPoint(cx, cy);
    if (hoverId !== _dropTargetId) {
        if (_dropTargetId) setDropHighlight(_dropTargetId, false);
        _dropTargetId = null;
        if (hoverId && hoverId !== _dragSourceId && !isDescendantOf(hoverId, _dragSourceId)) {
            _dropTargetId = hoverId;
            setDropHighlight(_dropTargetId, true);
            if (_dragGhost) _dragGhost.style.borderColor = '#2d9b6f';
        } else {
            if (_dragGhost) _dragGhost.style.borderColor = _activeDragCol;
        }
    }
}

// ── Drag end handler (on overlay) ──
function _onUp(e) {
    removeOverlay();

    const srcNid  = idToNid(_dragSourceId || '');
    const srcCard = document.querySelector('[data-nid="' + (srcNid !== null ? srcNid : CSS.escape(_dragSourceId || '')) + '"]');
    if (srcCard) srcCard.classList.remove('drag-source');
    if (_dropTargetId) setDropHighlight(_dropTargetId, false);
    removeGhost();
    removeCostBadge();

    const sourceId = _dragSourceId;
    const targetId = _dropTargetId;
    const wasMoved = _dragMoved;

    _dragSourceId = null;
    _dropTargetId = null;
    _dragMoved    = false;

    if (!wasMoved || !sourceId || !targetId || targetId === sourceId) return;
    if (isDescendantOf(targetId, sourceId)) return;
    commitMove(sourceId, targetId);
}

// ── Delegated mousedown on document ──
// Catches clicks on any [data-nid] card, including ones added after initial render.
// Only active when the Org Chart page is visible — prevents interference with nav clicks.
document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;

    // Allow drag on Org Chart page, or Scenario Studio planner when in scenario mode
    const orgPage   = document.getElementById('pageOrgchart');
    const ssPage    = document.getElementById('pageScenarioStudio');
    const onOrgChart  = orgPage && orgPage.classList.contains('active');
    const onSSPlanner = ssPage && ssPage.classList.contains('active') && isScenarioMode
                        && (typeof _ssView === 'undefined' || _ssView === 'planner');
    if (!onOrgChart && !onSSPlanner) return;

    // Find the nearest ancestor (or self) with data-nid
    const card = e.target.closest('[data-nid]');
    if (!card) return;

    const nidIdx = card.getAttribute('data-nid');
    const nodeId = nidToId(nidIdx) || nidIdx;
    if (!nodeId) return;

    e.stopPropagation();
    e.preventDefault();

    _dragSourceId  = nodeId;
    _dropTargetId  = null;
    _dragMoved     = false;
    _startX        = e.clientX;
    _startY        = e.clientY;
    const n = allData.find(d => d.id === nodeId);
    _activeDragCol = n ? (deptCol[n.department] || '#64748b') : '#64748b';

    // Pre-compute subtree cost at drag start
    if (n) {
        const st = subtreeCost(nodeId);
        _dragSubtreeCost  = st.total;
        _dragSubtreeCount = st.count;
    }

    _overlay = createOverlay();
}, true); // capture phase so we beat d3-zoom

// ── initDrag: no-op kept for compatibility (delegation handles everything) ──
function initDrag() {}

// ── Undo (scenario-aware) ──
function undoLastMove() {
    if (!dragUndoStack.length) return;
    const { id, oldParentId, newParentId } = dragUndoStack.pop();
    dragRedoStack.push({ id, oldParentId, newParentId });
    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === id);
        if (n) n.parentId = oldParentId;
    });
    if (!dragUndoStack.length && g('undoBtn')) g('undoBtn').style.display = 'none';
    if (typeof _ssUpdateUndoRedo === 'function') _ssUpdateUndoRedo();
    if (typeof _autoSaveScenario === 'function') _autoSaveScenario();
    if (typeof _smartRefresh === 'function') _smartRefresh(false); else refresh(false);
}
