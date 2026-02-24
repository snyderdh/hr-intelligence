// ── CSV parsing ──
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

// ── File input handler ──
function initFileInput() {
    g('fileInput').addEventListener('change', function (e) {
        const r = new FileReader();
        r.onload = ev => {
            const rows = parseCSV(ev.target.result);
            const h = rows[0].map(s => s.trim().toLowerCase());
            const ci = k => h.indexOf(k);

            const iF  = ci('full name');
            const iT  = ci('title');
            const iM  = ci('manager (name)');
            const iD  = ci('department');
            const iS  = ci('salary');
            const iR  = ci('2025 mid-year rating');
            const iL  = ci('job level');
            const iE  = ci('work email');
            const iDt = ci('start date');
            const iCy = ci('city');
            const iSt = ci('state/cty.');

            allData = rows.slice(1)
                .filter(r => r[iF] && r[iF].trim())
                .map(r => ({
                    id:         r[iF].trim(),
                    name:       r[iF].trim(),
                    title:      iT  >= 0 ? r[iT].trim()  : '',
                    parentId:   (iM >= 0 && r[iM].trim()) ? r[iM].trim() : 'ROOT',
                    department: iD  >= 0 ? r[iD].trim()  : 'Unassigned',
                    salary:     iS  >= 0 ? r[iS].trim()  : 0,
                    rating:     iR  >= 0 ? r[iR].trim()  : 'NR',
                    jobLevel:   iL  >= 0 ? r[iL].trim()  : 'IC1',
                    email:      iE  >= 0 ? r[iE].trim()  : '',
                    startDate:  iDt >= 0 ? r[iDt].trim() : '',
                    city:       iCy >= 0 ? r[iCy].trim() : '',
                    state:      iSt >= 0 ? r[iSt].trim() : '',
                }));

            // Fix orphaned parents
            const ns = new Set(allData.map(d => d.id));
            allData.forEach(d => { if (d.parentId !== 'ROOT' && !ns.has(d.parentId)) d.parentId = 'ROOT'; });

            // Add ghost root node
            allData.push({ id: 'ROOT', name: 'Organization', isGhost: true, parentId: null });

            // Assign dept colors
            deptCol = {};
            [...new Set(allData.filter(d => d.department).map(d => d.department))]
                .forEach((d, i) => { deptCol[d] = PAL[i % PAL.length]; });

            resetAll();
        };
        r.readAsText(e.target.files[0]);
    });
}

// ── CSV export ──
function dlCSV() {
    if (!allData.length) return;
    let csv = 'Full Name,Title,Manager (name),Department,Salary,Work Email,Start Date,Job Level,2025 Mid-Year Rating\n';
    allData.filter(d => !d.isGhost).forEach(d => {
        csv += `"${d.name}","${d.title}","${d.parentId === 'ROOT' ? '' : d.parentId}","${d.department}","${d.salary}","${d.email}","${d.startDate}","${d.jobLevel}","${d.rating}"\n`;
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'org_export.csv';
    a.click();
}
