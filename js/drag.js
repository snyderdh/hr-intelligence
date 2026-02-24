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

let _dragGhost       = null;
let _dragSourceId    = null;   // real node id string
let _dropTargetId    = null;   // real node id string
let _dragMoved       = false;
let _startX          = 0;
let _startY          = 0;
let _activeDragCol   = '#64748b';
let _overlay         = null;
let _dragReportCount = 0;      // # descendants moving with the dragged node
let _dragSalary      = 0;      // salary of the dragged node

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

// ── Subtree helper: collect all descendants of a node ──
function getSubtreeNodes(nodeId, data) {
    const result = [];
    const queue  = [nodeId];
    while (queue.length) {
        const id   = queue.shift();
        const node = data.find(d => d.id === id);
        if (!node) continue;
        result.push(node);
        data.filter(d => d.parentId === id && !d.isGhost).forEach(c => queue.push(c.id));
    }
    return result;
}

// ── Ghost label that follows the cursor ──
function createGhost(name, col, salary, reportCount) {
    removeGhost();
    const ghost = document.createElement('div');
    ghost.id = 'dragGhost';

    const salStr = salary > 0 ? fmtK(salary) : '';
    const rptStr = reportCount > 0
        ? `${reportCount} report${reportCount !== 1 ? 's' : ''}`
        : 'No reports';

    ghost.innerHTML =
        `<div style="font-weight:800;font-size:11px;color:#1a1a2e;">↳ ${name}</div>` +
        (salStr
            ? `<div style="font-size:10px;margin-top:3px;color:${col};font-weight:700;">${salStr} · <span style="color:#6b6880;">${rptStr}</span></div>`
            : '');

    ghost.style.cssText = [
        'position:fixed', 'pointer-events:none', 'z-index:999999',
        'padding:8px 14px', 'border-radius:10px',
        'background:#fffcf8', 'border:2px solid ' + col,
        'box-shadow:0 8px 28px rgba(180,160,130,0.38)',
        'opacity:0.97', 'white-space:nowrap',
        "font-family:'Nunito',sans-serif",
        'transform:translate(14px,-50%)',
        'transition:border-color 0.12s',
        'left:-9999px', 'top:-9999px',
    ].join(';');
    document.body.appendChild(ghost);
    return ghost;
}

// ── Drop toast ──
function showDropToast(employeeName, newManagerName, costDelta) {
    const old = document.getElementById('dropToast');
    if (old) old.remove();

    const impactStr = costDelta === 0
        ? 'No cost impact'
        : (costDelta > 0 ? '+' : '') + fmtK(costDelta) + ' impact';
    const hasImpact = costDelta !== 0;

    const toast = document.createElement('div');
    toast.id = 'dropToast';
    toast.innerHTML =
        `<span>✓ <strong>${employeeName}</strong> → <strong>${newManagerName}</strong></span>` +
        `<span style="color:${hasImpact ? 'var(--accent)' : 'var(--green)'};font-weight:800;">${impactStr}</span>`;
    toast.style.cssText = [
        'position:fixed', 'top:76px', 'left:50%', 'transform:translateX(-50%)',
        'background:#fffcf8', 'border:1px solid #e8e4dc', 'border-radius:50px',
        'padding:9px 22px', 'font-size:12px', "font-family:'Nunito',sans-serif",
        'font-weight:600', 'color:#1a1a2e',
        'box-shadow:0 8px 28px rgba(180,160,130,0.28)',
        'z-index:999999', 'display:flex', 'align-items:center', 'gap:14px',
        'white-space:nowrap', 'animation:toastIn 0.24s cubic-bezier(0.34,1.56,0.64,1)',
    ].join(';');
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.28s, transform 0.28s';
        toast.style.opacity    = '0';
        toast.style.transform  = 'translateX(-50%) translateY(-6px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
function moveGhost(x, y) {
    if (_dragGhost) { _dragGhost.style.left = x + 'px'; _dragGhost.style.top = y + 'px'; }
}
function removeGhost() {
    const old = document.getElementById('dragGhost');
    if (old) old.remove();
    _dragGhost = null;
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

// ── Commit the move ──
function commitMove(sourceId, targetId) {
    const sourceNode = allData.find(d => d.id === sourceId);
    const targetNode = allData.find(d => d.id === targetId);
    if (!sourceNode) return;

    const previousParentId = sourceNode.parentId;

    if (isScenarioMode) {
        // Record in scenario history and clear redo stack
        scenarioHistory.push({
            employeeId:      sourceId,
            previousParentId,
            newParentId:     targetId,
            timestamp:       Date.now(),
        });
        scenarioRedoStack = [];

        // Apply the move
        [allData, viewData].forEach(arr => {
            const n = arr.find(d => d.id === sourceId);
            if (n) n.parentId = targetId;
        });

        // Auto-persist the scenario
        if (scenarios[currentScenarioId]) {
            scenarios[currentScenarioId].data = JSON.parse(JSON.stringify(allData));
            persistScenarios();
        }

        // Update banner undo/redo button state
        if (typeof updateScenarioBanner === 'function') updateScenarioBanner();
    } else {
        // Live mode — existing undo stack
        dragUndoStack.push({ id: sourceId, oldParentId: previousParentId });
        g('undoBtn').style.display = 'flex';

        [allData, viewData].forEach(arr => {
            const n = arr.find(d => d.id === sourceId);
            if (n) n.parentId = targetId;
        });
    }

    // Show post-drop toast (cost delta always $0 — wire point ready for budget logic)
    showDropToast(sourceNode.name, targetNode ? targetNode.name : targetId, 0);

    refresh(false);
}

// ── Drag move handler (on overlay) ──
function _onMove(e) {
    if (!_dragSourceId) return;
    const cx = e.clientX, cy = e.clientY;

    if (!_dragMoved) {
        if (Math.sqrt((cx-_startX)**2 + (cy-_startY)**2) < DRAG_THRESHOLD) return;
        _dragMoved = true;
        const srcNode = allData.find(d => d.id === _dragSourceId);
        // Compute subtree stats for the badge
        if (srcNode) {
            _dragSalary      = cleanSal(srcNode.salary);
            const subtree    = getSubtreeNodes(_dragSourceId, allData);
            _dragReportCount = subtree.length - 1; // exclude the node itself
        }
        _dragGhost = createGhost(
            srcNode ? srcNode.name : _dragSourceId,
            _activeDragCol,
            _dragSalary,
            _dragReportCount
        );
        const srcNid = idToNid(_dragSourceId);
        const srcCard = document.querySelector('[data-nid="' + (srcNid !== null ? srcNid : CSS.escape(_dragSourceId)) + '"]');
        if (srcCard) srcCard.classList.add('drag-source');
    }

    moveGhost(cx, cy);

    const hoverId = nodeIdAtPoint(cx, cy);
    if (hoverId !== _dropTargetId) {
        if (_dropTargetId) setDropHighlight(_dropTargetId, false);
        _dropTargetId = null;
        if (hoverId && hoverId !== _dragSourceId && !isDescendantOf(hoverId, _dragSourceId)) {
            _dropTargetId = hoverId;
            setDropHighlight(_dropTargetId, true);
            if (_dragGhost) _dragGhost.style.borderColor = '#10b981';
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
// No per-card listener attachment needed — works automatically for expand/collapse too.
document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;

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

    _overlay = createOverlay();
}, true); // capture phase so we beat d3-zoom

// ── initDrag: no-op kept for compatibility (delegation handles everything) ──
function initDrag() {}

// ── Undo (live mode only — scenario undo is in scenarios.js) ──
function undoLastMove() {
    if (isScenarioMode) return; // handled by scnUndo() in scenarios.js
    if (!dragUndoStack.length) return;
    const { id, oldParentId } = dragUndoStack.pop();
    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === id);
        if (n) n.parentId = oldParentId;
    });
    if (!dragUndoStack.length) g('undoBtn').style.display = 'none';
    refresh(false);
}
