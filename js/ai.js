// ── AI status indicator ──
function updateAIStatus() {
    const n = allData.filter(d => !d.isGhost).length;
    if (n > 0) {
        g('aiDot').style.background  = '#10b981';
        g('aiStxt').innerText        = `Ready · ${n} employees loaded`;
        g('aiStxt').style.color      = '#10b981';
    } else {
        g('aiDot').style.background  = '#f59e0b';
        g('aiStxt').innerText        = 'Load CSV data to activate';
        g('aiStxt').style.color      = '#f59e0b';
    }
}

// ── Build org context string for Claude ──
function buildCtx() {
    const real = allData.filter(d => !d.isGhost);
    if (!real.length) return 'No data loaded.';

    const tot  = real.reduce((a, d) => a + cleanSal(d.salary), 0);
    const dCts = {}, rDist = {};
    real.forEach(d => {
        dCts[d.department] = (dCts[d.department] || 0) + 1;
        const r = pRat(d.rating);
        rDist[r] = (rDist[r] || 0) + 1;
    });
    const tens = real.map(tenYrs).filter(v => v !== null);
    const avgT = tens.length ? tens.reduce((a, b) => a + b, 0) / tens.length : 0;
    const mgrs = real.filter(d => real.some(e => e.parentId === d.id));

    const roster = real.map(d => {
        const t = tenYrs(d);
        return `${d.name}|${d.title}|mgr:${d.parentId === 'ROOT' ? 'none' : d.parentId}|dept:${d.department}|lvl:${d.jobLevel}|sal:$${cleanSal(d.salary).toLocaleString()}|rating:${d.rating || 'NR'}|tenure:${t !== null ? t.toFixed(1) + 'y' : '?'}|loc:${[d.city, d.state].filter(Boolean).join(', ') || '?'}`;
    }).join('\n');

    return `ORG SNAPSHOT\nEmployees:${real.length} | Payroll:${fmtN(tot)} | AvgSal:${fmtN(tot / real.length)} | AvgTenure:${avgT.toFixed(1)}y | Managers:${mgrs.length}\nDepts:${Object.entries(dCts).map(([k, v]) => `${k}(${v})`).join(', ')}\nRatings:${Object.entries(rDist).map(([k, v]) => `${k}:${v}`).join(', ')}\n\nROSTER (name|title|manager|dept|level|salary|rating|tenure|location):\n${roster}`;
}

function buildSys() {
    return `You are an expert HR analytics assistant embedded in an executive workforce intelligence platform.\n\nYour role:\n- Answer questions about org structure, people, teams, pay, performance, tenure\n- Identify patterns, risks, and opportunities\n- Be concise and direct — give specific names and numbers\n- Use short lists when helpful; stay focused\n- If data doesn't support a claim, say so\n\n${buildCtx()}`;
}

// ── Message rendering helpers ──
function addMsg(role, text) {
    const box = g('aiMsgs');
    box.querySelector('.ai-welcome')?.remove();
    const w  = document.createElement('div'); w.className = `msg ${role === 'assistant' ? 'cl' : 'user'}`;
    const av = document.createElement('div'); av.className = `msg-av ${role === 'assistant' ? 'cl' : 'us'}`; av.innerText = role === 'assistant' ? '✦' : '▲';
    const b  = document.createElement('div'); b.className = 'msg-bbl'; b.innerText = text;
    w.appendChild(av); w.appendChild(b); box.appendChild(w);
    box.scrollTop = box.scrollHeight;
    return b;
}

function showTyping() {
    const box = g('aiMsgs');
    const w  = document.createElement('div'); w.className = 'msg cl'; w.id = 'typingRow';
    const av = document.createElement('div'); av.className = 'msg-av cl'; av.innerText = '✦';
    const b  = document.createElement('div'); b.className = 'msg-bbl typing-bbl';
    b.innerHTML = '<div class="td"></div><div class="td"></div><div class="td"></div>';
    w.appendChild(av); w.appendChild(b); box.appendChild(w);
    box.scrollTop = box.scrollHeight;
}

function hideTyping() { g('typingRow')?.remove(); }

// ── Input helpers ──
function chipQ(el) {
    g('aiInput').value = el.innerText;
    sendAI();
}

function aiKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
}

function aiResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

// ── Send message to Claude ──
async function sendAI() {
    const inp  = g('aiInput');
    const send = g('aiSend');
    const txt  = inp.value.trim();
    if (!txt || aiLoading) return;

    if (!allData.filter(d => !d.isGhost).length) {
        addMsg('assistant', 'Please load a CSV file first — I need org data to analyze!');
        return;
    }

    inp.value = ''; inp.style.height = 'auto';
    aiLoading = true; send.disabled = true;

    addMsg('user', txt);
    aiHist.push({ role: 'user', content: txt });
    showTyping();

    try {
        const res = await fetch('/api/claude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                system: buildSys(),
                messages: aiHist,
            }),
        });
        const data = await res.json();
        hideTyping();

        if (data.content?.[0]?.text) {
            const reply = data.content[0].text;
            addMsg('assistant', reply);
            aiHist.push({ role: 'assistant', content: reply });
            if (aiHist.length > 20) aiHist = aiHist.slice(-20);
        } else if (data.error) {
            addMsg('assistant', `Error: ${data.error.message}`);
        } else {
            addMsg('assistant', 'No response received. Please try again.');
        }
    } catch (err) {
        hideTyping();
        addMsg('assistant', 'Request failed. Please try again.');
        console.error('AI error:', err);
    }

    aiLoading = false; send.disabled = false;
}
