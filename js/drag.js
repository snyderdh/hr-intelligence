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

// ── Ghost label that follows the cursor ──
function createGhost(name, col) {
    removeGhost();
    const ghost = document.createElement('div');
    ghost.id = 'dragGhost';
    ghost.innerText = '↳ ' + name;
    ghost.style.cssText = [
        'position:fixed', 'pointer-events:none', 'z-index:999999',
        'padding:6px 13px', 'border-radius:8px',
        'background:#1e293b', 'border:2px solid ' + col,
        'color:#e2e8f0', 'font-size:11px', 'font-weight:700',
        "font-family:'DM Sans',sans-serif",
        'box-shadow:0 8px 24px rgba(0,0,0,0.7)',
        'opacity:0.93', 'white-space:nowrap',
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
    if (!sourceNode) return;
    dragUndoStack.push({ id: sourceId, oldParentId: sourceNode.parentId });
    g('undoBtn').style.display = 'flex';
    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === sourceId);
        if (n) n.parentId = targetId;
    });
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
        _dragGhost = createGhost(srcNode ? srcNode.name : _dragSourceId, _activeDragCol);
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

// ── Undo ──
function undoLastMove() {
    if (!dragUndoStack.length) return;
    const { id, oldParentId } = dragUndoStack.pop();
    [allData, viewData].forEach(arr => {
        const n = arr.find(d => d.id === id);
        if (n) n.parentId = oldParentId;
    });
    if (!dragUndoStack.length) g('undoBtn').style.display = 'none';
    refresh(false);
}
