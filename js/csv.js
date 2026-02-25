// ── CSV parsing (RFC 4180 compliant) ──
function parseCSV(txt) {
    const res = []; let row = ['']; let inQ = false;
    txt = txt.replace(/^\uFEFF/, ''); // strip BOM
    for (let i = 0; i < txt.length; i++) {
        const c = txt[i], n = txt[i + 1];
        if (c === '"') {
            if (inQ && n === '"') { row[row.length - 1] += '"'; i++; }
            else inQ = !inQ;
        } else if (c === ',' && !inQ) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQ) {
            if (row.length > 1 || row[0] !== '') res.push(row);
            row = [''];
            if (c === '\r' && n === '\n') i++;
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') res.push(row);
    return res;
}

// ── Field normalisation helpers ──

// Strip currency formatting and round to integer
const parseSalary = (val) => {
    if (!val) return 0;
    return Math.round(parseFloat(String(val).replace(/[$,\s"]/g, ''))) || 0;
};

// Accept MM/DD/YYYY, M/D/YY, MM-DD-YYYY, YYYY-MM-DD → always output YYYY-MM-DD
const parseDate = (val) => {
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mdy) {
        const y = mdy[3].length === 2 ? '20' + mdy[3] : mdy[3];
        return y + '-' + mdy[1].padStart(2, '0') + '-' + mdy[2].padStart(2, '0');
    }
    const mdd = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (mdd) {
        return mdd[3] + '-' + mdd[1].padStart(2, '0') + '-' + mdd[2].padStart(2, '0');
    }
    return s;
};

// Extract leading digit; handle "3 - Meets Expectations", "NR", blank → "NR"
const parseRating = (val) => {
    if (!val || String(val).trim() === '') return 'NR';
    const s = String(val).trim();
    if (s.toUpperCase() === 'NR') return 'NR';
    const match = s.match(/^(\d)/);
    return match ? parseInt(match[1]) : 'NR';
};

// Strip currency formatting but preserve decimal precision (no rounding)
// Used for band fields so exact CSV values are kept intact.
const parseBandField = (val) => {
    if (!val) return 0;
    return parseFloat(String(val).replace(/[$,\s"]/g, '')) || 0;
};

// ── Column name aliases ──
// Map common HR-system column names to canonical Canopy field names.
// Keys are lowercased for case-insensitive matching.
const COLUMN_ALIASES = {
    // Salary
    'base salary': 'salary', 'base pay': 'salary', 'annual salary': 'salary',
    'compensation': 'salary', 'total comp': 'salary',
    // Name
    'full name': 'name', 'employee name': 'name', 'preferred name': 'name',
    // ID
    'employee id': 'id', 'emp id': 'id', 'employee #': 'id', 'worker id': 'id',
    // parentId / manager
    'manager id': 'parentId', 'manager': 'parentId', 'reports to': 'parentId',
    'direct manager': 'parentId', 'supervisor': 'parentId', 'supervisor id': 'parentId',
    'manager (name)': 'parentId',   // Canopy export format
    // Department
    'dept': 'department', 'team': 'department', 'business unit': 'department',
    'org': 'department', 'function': 'department',
    // Title
    'job title': 'title', 'position': 'title', 'role': 'title', 'position title': 'title',
    // Job level
    'level': 'jobLevel', 'job level': 'jobLevel', 'grade': 'jobLevel',
    'job grade': 'jobLevel', 'band': 'jobLevel',
    // Dates
    'hire date': 'startDate', 'start date': 'startDate', 'employment date': 'startDate',
    'date of hire': 'startDate',
    'last increase date': 'lastPayIncrease', 'last raise date': 'lastPayIncrease',
    'last pay increase': 'lastPayIncrease',
    // Pay bands
    'bandmax': 'bandMax', 'band max': 'bandMax', 'max': 'bandMax',
    'bandmin': 'bandMin', 'band min': 'bandMin', 'min': 'bandMin',
    'q1': 'bandQ1', 'q3': 'bandQ3', 'bandq1': 'bandQ1', 'bandq3': 'bandQ3',
    'mid': 'bandMid', 'midpoint': 'bandMid', 'band mid': 'bandMid',
    // Rating
    'performance rating': 'rating', 'perf rating': 'rating', 'review score': 'rating',
    'performance score': 'rating', 'annual review': 'rating',
    '2025 mid-year rating': 'rating', 'mid-year rating': 'rating',
    // Location
    'location': 'city', 'work location': 'city', 'office': 'city', 'office city': 'city',
    // Email
    'work email': 'email', 'email address': 'email', 'e-mail': 'email',
    // State / region
    'state/cty.': 'state', 'province': 'state', 'region': 'state',
    // Geo tier
    'geo tier': 'geoTier', 'geo': 'geoTier', 'tier': 'geoTier',
    // Compa-ratio
    'compa ratio': 'compaRatio', 'compa-ratio': 'compaRatio',
};

function normaliseHeaders(headers) {
    return headers.map(h => {
        const lower = h.trim().toLowerCase();
        return COLUMN_ALIASES[lower] || h.trim();
    });
}

// ── Parent ID resolution ──
// Some HR exports put manager names in the parentId column instead of IDs.
// After building the employee list, resolve any name-based parentIds to IDs.
function resolveParentIds(employees) {
    const nameToId = {};
    employees.forEach(emp => {
        if (emp.name) nameToId[emp.name.trim().toLowerCase()] = emp.id;
    });
    const existingIds = new Set(employees.map(e => String(e.id).trim()));
    employees.forEach(emp => {
        if (!emp.parentId) return;
        const pid = String(emp.parentId).trim();
        if (!existingIds.has(pid)) {
            const resolvedId = nameToId[pid.toLowerCase()];
            if (resolvedId) {
                emp.parentId = resolvedId;
            } else {
                console.warn('Canopy: could not resolve parentId "' + pid + '" for employee "' + emp.name + '"');
            }
        }
    });
    return employees;
}

// ── Root node detection ──
// If no employee has a blank parentId (no root), find the most-referenced
// internal node and promote them to root automatically.
function ensureRootNode(employees) {
    if (employees.some(e => !e.parentId)) return employees; // root already exists
    const existingIds = new Set(employees.map(e => String(e.id).trim()));
    const parentCounts = {};
    employees.forEach(e => {
        if (e.parentId && existingIds.has(String(e.parentId).trim())) {
            parentCounts[e.parentId] = (parentCounts[e.parentId] || 0) + 1;
        }
    });
    let bestId = null, bestCount = 0;
    Object.entries(parentCounts).forEach(([id, count]) => {
        if (count > bestCount) { bestCount = count; bestId = id; }
    });
    if (bestId) {
        const root = employees.find(e => String(e.id).trim() === bestId);
        if (root) {
            console.warn('Canopy: no root node found — auto-assigning ' + root.name + ' as root');
            root.parentId = '';
        }
    }
    return employees;
}

// ── Upload summary toast ──
function showUploadToast(message, warning) {
    const existing = document.getElementById('uploadToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'uploadToast';
    toast.style.cssText = [
        'position:fixed', 'top:80px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:90000', 'background:rgba(45,155,111,0.1)',
        'border:1px solid rgba(45,155,111,0.3)', 'color:var(--green)',
        'border-radius:12px', 'padding:12px 20px', 'font-size:13px', 'font-weight:600',
        'box-shadow:0 4px 16px rgba(0,0,0,0.10),0 1px 4px rgba(0,0,0,0.06)',
        'min-width:280px', 'max-width:520px', 'display:flex',
        'align-items:flex-start', 'gap:12px', 'font-family:var(--font-ui)',
    ].join(';');
    let inner = '<div style="flex:1;">' + message;
    if (warning) {
        inner += '<div style="color:var(--amber);font-size:12px;margin-top:4px;">' + warning + '</div>';
    }
    inner += '</div>';
    inner += '<button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:inherit;opacity:0.6;font-size:18px;padding:0;line-height:1;flex-shrink:0;min-height:0;">×</button>';
    toast.innerHTML = inner;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 8000);
}

// ── Loading overlay ──
function setLoadingState(active) {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'background:rgba(255,255,255,0.65)',
            'z-index:99999', 'display:none', 'align-items:center',
            'justify-content:center', 'font-family:Nunito,sans-serif',
            'font-size:14px', 'font-weight:700', 'color:#0f1729',
            'backdrop-filter:blur(2px)',
        ].join(';');
        overlay.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">' +
            '<div style="width:32px;height:32px;border:3px solid #e85d3d;border-top-color:transparent;border-radius:50%;animation:_spin 0.7s linear infinite;"></div>' +
            '<div>Loading data\u2026</div>' +
            '</div>';
        // Inline keyframes for the spinner
        const style = document.createElement('style');
        style.textContent = '@keyframes _spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
        document.body.appendChild(overlay);
    }
    overlay.style.display = active ? 'flex' : 'none';
}

// ── File input handler ──
function initFileInput() {
    g('fileInput').addEventListener('change', function (e) {
        if (!e.target.files || !e.target.files[0]) return;
        setLoadingState(true);

        // Capture file reference then reset the input so the same file
        // can be re-selected and will fire the change event again.
        const file = e.target.files[0];
        e.target.value = '';

        const reader = new FileReader();
        reader.onerror = () => {
            console.error('[Canopy] FileReader error');
            setLoadingState(false);
        };
        reader.onload = ev => {
          try {
            const rows = parseCSV(ev.target.result);
            if (rows.length < 2) { setLoadingState(false); return; }

            // Normalise column headers using alias table
            const h = normaliseHeaders(rows[0]);
            const ci  = k => h.indexOf(k);
            // Safe column accessor: returns '' for missing columns or undefined cells
            const col = (row, idx) => (idx >= 0 && row[idx] != null) ? String(row[idx]).trim() : '';

            // Column indices — resolved to canonical names after alias expansion
            const iId   = ci('id');
            const iN    = ci('name');
            const iT    = ci('title');
            const iPid  = ci('parentId');
            const iD    = ci('department');
            const iS    = ci('salary');
            const iR    = ci('rating');
            const iL    = ci('jobLevel');
            const iE    = ci('email');
            const iDt   = ci('startDate');
            const iCy   = ci('city');
            const iSt   = ci('state');
            const iLpi  = ci('lastPayIncrease');
            const iBMin = ci('bandMin');
            const iBMax = ci('bandMax');
            const iBMid = ci('bandMid');
            const iBQ1  = ci('bandQ1');
            const iBQ3  = ci('bandQ3');
            const iGeo  = ci('geoTier');
            const iCr   = ci('compaRatio');
            const iQr   = ci('quartile');

            // Prefer explicit 'name' column; fall back to first column
            const nameIdx = iN >= 0 ? iN : 0;

            let employees = rows.slice(1)
                .filter(row => col(row, nameIdx))
                .map(row => {
                    const name = col(row, nameIdx);
                    const id   = col(row, iId) || name; // use name as ID when no ID column

                    const emp = {
                        id,
                        name,
                        title:           col(row, iT)          || '',
                        parentId:        col(row, iPid)        || '',
                        department:      col(row, iD)          || 'Unassigned',
                        salary:          parseSalary(col(row, iS)),
                        rating:          parseRating(col(row, iR)),
                        jobLevel:        col(row, iL)          || 'IC1',
                        email:           col(row, iE)          || '',
                        startDate:       parseDate(col(row, iDt)),
                        city:            col(row, iCy)         || '',
                        state:           col(row, iSt)         || '',
                        lastPayIncrease: parseDate(col(row, iLpi)),
                    };

                    // Comp band fields — only set when column is present in CSV
                    if (iBMin >= 0) emp.bandMin    = parseBandField(col(row, iBMin));
                    if (iBMax >= 0) emp.bandMax    = parseBandField(col(row, iBMax));
                    if (iBMid >= 0) emp.bandMid    = parseBandField(col(row, iBMid));
                    if (iBQ1  >= 0) emp.bandQ1     = parseBandField(col(row, iBQ1));
                    if (iBQ3  >= 0) emp.bandQ3     = parseBandField(col(row, iBQ3));
                    if (iGeo  >= 0) emp.geoTier    = col(row, iGeo);
                    if (iCr   >= 0) emp.compaRatio = parseFloat(col(row, iCr)) || undefined;
                    if (iQr   >= 0) emp.quartile   = col(row, iQr);

                    return emp;
                });

            // Resolve name-based parentIds → employee IDs
            employees = resolveParentIds(employees);

            // Promote root if no employee has a blank parentId
            employees = ensureRootNode(employees);

            // Count still-unresolvable parentIds before we fix them to ROOT
            const resolvedIds = new Set(employees.map(d => String(d.id).trim()));
            const orphanCount = employees.filter(d =>
                d.parentId && !resolvedIds.has(String(d.parentId).trim())
            ).length;

            // Final pass: route blank or unresolved parentIds to the ghost ROOT node
            employees.forEach(d => {
                if (!d.parentId || !resolvedIds.has(String(d.parentId).trim())) {
                    d.parentId = 'ROOT';
                }
            });

            allData = employees;
            allData.push({ id: 'ROOT', name: 'Organization', isGhost: true, parentId: null });

            // Assign department colours
            deptCol = {};
            [...new Set(allData.filter(d => d.department).map(d => d.department))]
                .forEach((d, i) => { deptCol[d] = PAL[i % PAL.length]; });

            // Show upload summary toast
            const empCount  = allData.filter(d => !d.isGhost).length;
            const deptCount = Object.keys(deptCol).length;
            const toastMsg  = '✓ Loaded ' + empCount + ' employee' + (empCount !== 1 ? 's' : '') +
                              ' across ' + deptCount + ' department' + (deptCount !== 1 ? 's' : '');
            const toastWarn = orphanCount > 0
                ? '⚠ ' + orphanCount + ' employee' + (orphanCount !== 1 ? 's' : '') +
                  ' could not be placed in the org chart — manager not found in dataset'
                : null;
            showUploadToast(toastMsg, toastWarn);

            resetAll();

            // Force full re-render of all page sections with the new data
            requestAnimationFrame(() => {
                if (typeof updateStats  === 'function') updateStats(viewData);
                if (typeof renderHome   === 'function') renderHome();
                setLoadingState(false);
            });
          } catch (err) {
            console.error('[Canopy] CSV parse error:', err);
            setLoadingState(false);
          }
        };
        reader.readAsText(file);
    });
}

// ── CSV export ──
// Exports using canonical column names so the file re-imports cleanly.
function dlCSV() {
    if (!allData.length) return;
    const headers = ['id', 'name', 'title', 'parentId', 'department', 'salary',
                     'email', 'startDate', 'jobLevel', 'rating'];
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    let csv = headers.join(',') + '\n';
    allData.filter(d => !d.isGhost).forEach(d => {
        const pid = (!d.parentId || d.parentId === 'ROOT') ? '' : d.parentId;
        csv += [d.id, d.name, d.title, pid, d.department, d.salary,
                d.email, d.startDate, d.jobLevel, d.rating].map(esc).join(',') + '\n';
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'org_export.csv';
    a.click();
}
