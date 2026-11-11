// UI: floating button on hackerrank.com that opens a full-screen leaderboard overlay.
(() => {
  if (window.__hracmLoaded) return;
  window.__hracmLoaded = true;

  const STORE_KEY = 'hracm:lastSlug';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const slugFromUrl = () => {
    const m = location.pathname.match(/^\/contests\/([^/]+)/);
    return m ? m[1] : null;
  };
  const storedSlug = () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } };

  let root = null;
  let timer = null;
  let lastResult = null;

  const btn = document.createElement('button');
  btn.id = 'hracm-open';
  btn.textContent = 'ACM Leaderboard';
  btn.addEventListener('click', open);
  document.body.appendChild(btn);

  function open() {
    if (root) { root.hidden = false; return; }
    root = document.createElement('div');
    root.id = 'hracm-root';
    root.innerHTML = `
      <div class="hracm-bar">
        <strong>ACM Leaderboard</strong>
        <label>Contest <input id="hracm-slug" placeholder="contest-slug" /></label>
        <button id="hracm-load">Load</button>
        <label title="Refresh every 30 seconds"><input type="checkbox" id="hracm-auto" /> Auto-refresh</label>
        <label title="Use a different contest start (your local time), e.g. for a past contest whose start was later edited">Start override <input type="datetime-local" id="hracm-start" /></label>
        <label title="Contest length in minutes. Leave blank to use the contest's end − start">Duration <input type="number" id="hracm-duration" min="1" step="1" placeholder="from contest" style="width:110px" /></label>
        <label title="For testing: count submissions made outside start → start + duration"><input type="checkbox" id="hracm-outside" /> Include outside window</label>
        <input id="hracm-filter" placeholder="Filter user…" />
        <button id="hracm-csv">CSV</button>
        <span id="hracm-status"></span>
        <button id="hracm-close" title="Close">✕</button>
      </div>
      <div id="hracm-body"></div>`;
    document.body.appendChild(root);
    const $ = (id) => root.querySelector('#' + id);
    $('hracm-slug').value = slugFromUrl() || storedSlug() || '';
    $('hracm-load').onclick = refresh;
    $('hracm-slug').onkeydown = (e) => { if (e.key === 'Enter') refresh(); };
    $('hracm-outside').onchange = refresh;
    $('hracm-start').onchange = refresh;
    $('hracm-duration').onchange = refresh;
    $('hracm-filter').oninput = () => lastResult && render(lastResult);
    $('hracm-close').onclick = () => { root.hidden = true; };
    $('hracm-csv').onclick = downloadCsv;
    $('hracm-auto').onchange = (e) => {
      clearInterval(timer);
      if (e.target.checked) timer = setInterval(refresh, 30000);
    };
    if ($('hracm-slug').value) refresh();
  }

  let loading = false;
  let rerun = false; // a settings change arrived mid-load; load again when done
  async function refresh() {
    if (loading) { rerun = true; return; }
    const $ = (id) => root.querySelector('#' + id);
    const slug = $('hracm-slug').value.trim();
    if (!slug) return;
    try { localStorage.setItem(STORE_KEY, slug); } catch {}
    loading = true;
    $('hracm-status').textContent = 'Loading…';
    try {
      const startVal = $('hracm-start').value; // "YYYY-MM-DDTHH:MM", local time
      const durVal = parseInt($('hracm-duration').value, 10);
      const res = await HRACM.load(slug, {
        includeOutside: $('hracm-outside').checked,
        startOverride: startVal ? new Date(startVal).getTime() / 1000 : null,
        durationOverride: durVal > 0 ? durVal : null,
        onProgress: (n, t) => { $('hracm-status').textContent = `Loading submissions ${n}/${t}…`; },
      });
      lastResult = res;
      render(res);
      const parts = [`${res.submissionCount} submissions`, `updated ${new Date().toLocaleTimeString()}`];
      if (res.pending) parts.push(`${res.pending} still judging`);
      if (res.outside) parts.push(`${res.outside} outside window${$('hracm-outside').checked ? ' (included)' : ' (ignored)'}`);
      $('hracm-status').textContent = parts.join(' · ');
    } catch (e) {
      $('hracm-status').textContent = 'Error: ' + e.message + (/40[13]/.test(e.message) ? ' (you need moderator access to this contest)' : '');
    } finally {
      loading = false;
      if (rerun) { rerun = false; refresh(); }
    }
  }

  function render(res) {
    const q = root.querySelector('#hracm-filter').value.trim().toLowerCase();
    const rows = q ? res.rows.filter((r) => r.username.toLowerCase().includes(q)) : res.rows;
    const ch = res.challenges;
    const start = new Date(res.start * 1000).toLocaleString();
    const head = ch.map((c, i) => `<th title="${esc(c.name)} (${c.maxScore} pts)">${String.fromCharCode(65 + i)}<div class="hracm-sub">${esc(c.name)}</div></th>`).join('');
    const body = rows.map((r) => {
      const cells = ch.map((c) => {
        const x = r.cells[c.slug];
        if (!x) return '<td class="hracm-none"></td>';
        const ce = x.ignored ? ` · ${x.ignored} CE` : '';
        if (x.solved) {
          return `<td class="hracm-ok${x.first ? ' hracm-first' : ''}" title="Accepted at ${x.minutes} min, ${x.wrong} wrong before">
            <b>${fmt(x.score)}</b><div class="hracm-sub">${x.minutes}′${x.wrong ? ` · ${x.wrong} wrong` : ''}${ce}</div></td>`;
        }
        const tried = [x.wrong ? `${x.wrong} wrong` : '', x.ignored ? `${x.ignored} CE` : ''].filter(Boolean).join(' · ');
        return `<td class="hracm-bad" title="Not solved"><b>0</b><div class="hracm-sub">${tried}</div></td>`;
      }).join('');
      return `<tr><td class="hracm-rank">${r.rank}</td><td class="hracm-user"><a href="/profile/${encodeURIComponent(r.username)}" target="_blank">${esc(r.username)}</a></td>
        <td class="hracm-num">${r.solved}</td><td class="hracm-num hracm-total">${fmt(r.total)}</td>${cells}</tr>`;
    }).join('');
    const C = HRACM.config;
    const durNote = { contest: 'from contest settings', override: 'override', default: 'contest has no end time, using default' }[res.durationSource];
    root.querySelector('#hracm-body').innerHTML = `
      <div class="hracm-rule">Per solved problem: problem score + (${res.duration} − minutes) / ${C.TIME_BONUS_DIVISOR} − wrong × ${C.WRONG_PENALTY}. Minutes rounded up. Compilation errors are not counted as wrong.</div>
      <div class="hracm-meta">Start ${esc(start)}${root.querySelector('#hracm-start').value ? ' (override)' : ''} · duration ${res.duration} min (${durNote}) · ${res.rows.length} contestants</div>
      <table class="hracm-table"><thead><tr><th>#</th><th>User</th><th>Solved</th><th>Score</th>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${4 + ch.length}" class="hracm-empty">No submissions counted yet.</td></tr>`}</tbody></table>`;
  }

  function downloadCsv() {
    if (!lastResult) return;
    const ch = lastResult.challenges;
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Rank', 'User', 'Solved', 'Score', ...ch.flatMap((c) => [`${c.name} score`, `${c.name} minutes`, `${c.name} wrong`])].map(q).join(',')];
    for (const r of lastResult.rows) {
      const cells = ch.flatMap((c) => {
        const x = r.cells[c.slug];
        return x ? [x.solved ? x.score : 0, x.solved ? x.minutes : '', x.wrong] : [0, '', 0];
      });
      lines.push([r.rank, r.username, r.solved, r.total, ...cells].map(q).join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `${root.querySelector('#hracm-slug').value.trim()}-leaderboard.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
