/* Curio project hub. Reads config.json, charter.json and project-data.json from the same folder. */
(() => {
  'use strict';

  const DAY = 864e5;
  const now = new Date();
  const TODAY = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const P = (s) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00Z') : null);
  const fShort = (d) => d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  const fDay = (d) => WD[d.getUTCDay()] + ' ' + fShort(d);
  const fMon = (d) => MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  const mFloor = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const mAdd = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const daysTo = (d) => Math.round((d - TODAY) / DAY);
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };

  const S = { cfg: null, ch: null, rows: [], syncedAt: null, state: 'loading' };
  const open = new Set();
  let current = 'timeline';

  /* ---------- Data shaping ---------- */
  function norm(r) {
    const sum = String(r.summary || '');
    const gm = sum.match(/\(Gateway (\d)\)/);
    let cat = 'act';
    if (/SME Review|client review/i.test(sum)) cat = 'rev';
    else if (/Synthesia|video|Graphic|Technical Build|H5P|Canvas shell|environment QA|Build Remediation|Build review/i.test(sum)) cat = 'media';
    const s = P(r.start);
    const d = P(r.due);
    return {
      key: r.key, epic: r.epic, status: r.status, done: r.status === 'Done', doing: r.status === 'In progress',
      s: s || d, d: d || s, sum, gw: gm ? gm[1] : null, cat,
      title: sum.replace(/^\d[\d.,a-z\s-]*?—\s*/i, '').replace(/\s*\(Gateway \d\)/, '').trim(),
    };
  }
  const byDate = (a, b) => (a.s ? +a.s : Infinity) - (b.s ? +b.s : Infinity)
    || (a.d ? +a.d : Infinity) - (b.d ? +b.d : Infinity)
    || Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]);
  const inEpics = (epics) => (r) => (epics || []).includes(r.epic);
  const span = (a, b) => (+a === +b ? fShort(a) : fShort(a) + ' to ' + fShort(b));

  function groupStat(rows) {
    const starts = rows.map((r) => r.s).filter(Boolean).sort((a, b) => a - b);
    const dues = rows.map((r) => r.d).filter(Boolean).sort((a, b) => a - b);
    return { done: rows.filter((r) => r.done).length, total: rows.length, start: starts[0] || null, due: dues[dues.length - 1] || null };
  }

  /* ---------- Small builders ---------- */
  const failLine = (msg) => el('div', 'h-fail', msg || 'Failed to load');
  function keyEl(k) {
    if (!S.cfg.linkJiraKeys) return el('span', 'h-key', k);
    const a = el('a', 'h-key', k);
    a.href = S.cfg.jiraSite.replace(/\/$/, '') + '/browse/' + encodeURIComponent(k);
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }
  function tick() {
    const s = svgEl('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' });
    s.appendChild(svgEl('path', { d: 'M2 6.5l2.5 2.5L10 3.5', fill: 'none', stroke: '#FFFFFF', 'stroke-width': '1.8' }));
    return s;
  }
  function statusIcon(r) {
    const st = el('span', 'h-st' + (r.done ? ' done' : r.doing ? ' doing' : ''));
    if (r.done) st.appendChild(tick());
    st.appendChild(el('span', 'h-sr', r.status));
    return st;
  }
  function countChip(done, due) {
    if (done) return el('span', 'h-count ok', 'Signed off');
    if (!due) return el('span', 'h-count', 'No date');
    const n = daysTo(due);
    if (n < 0) return el('span', 'h-count late', (-n) + (n === -1 ? ' day overdue' : ' days overdue'));
    return el('span', 'h-count', n === 0 ? 'Due today' : 'In ' + n + (n === 1 ? ' day' : ' days'));
  }
  function contract(tranche, id) {
    const m = (S.ch.milestones || []).find((x) => x.id === id);
    const v = m && tranche && m.dates ? m.dates[tranche] : null;
    return v ? P(v) : null;
  }
  function fillList(id, items) {
    const ul = $(id);
    if (!ul) return;
    ul.replaceChildren(...(items || []).map((it) => {
      const li = el('li');
      if (typeof it === 'string') li.textContent = it;
      else {
        if (it.label) { li.appendChild(el('strong', null, it.label + ': ')); }
        li.appendChild(document.createTextNode(it.text || ''));
      }
      return li;
    }));
    const sec = ul.closest('[data-optional]');
    if (sec) sec.hidden = !(items && items.length);
  }
  function fillTable(id, cols, rows) {
    const t = $(id);
    if (!t) return;
    const hr = el('tr');
    cols.forEach((c) => hr.appendChild(el('th', null, c.label)));
    t.querySelector('thead').replaceChildren(hr);
    t.querySelector('tbody').replaceChildren(...(rows || []).map((r) => {
      const tr = el('tr');
      cols.forEach((c) => {
        const v = typeof c.get === 'function' ? c.get(r) : r[c.key];
        tr.appendChild(el('td', c.center ? 'c' : null, v == null ? '' : String(v)));
      });
      return tr;
    }));
  }
  const setText = (id, t) => { const n = $(id); if (n) n.textContent = t == null ? '' : t; };

  /* ---------- Header and hero ---------- */
  function drawHeader() {
    const c = S.cfg;
    document.title = c.project + ' project hub · ' + c.client;
    setText('h-for', 'Project hub for ' + c.client);
    setText('h-key', c.project);
    setText('h-eyebrow', c.eyebrow || 'Client project timeline');
    setText('h-title', c.title);
    setText('h-client', c.client);
    const all = groupStat(S.rows);
    const range = all.start ? fMon(all.start) + ' to ' + fMon(all.due) : '—';
    document.querySelectorAll('.h-range').forEach((n) => { n.textContent = range; });

    const cards = $('h-cards');
    cards.replaceChildren(...(c.phases || []).map((ph) => {
      const st = groupStat(S.rows.filter(inEpics(ph.epics)));
      const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      const a = el('article', 'h-card');
      a.appendChild(el('h2', null, ph.name));
      const line = el('div');
      line.appendChild(el('span', 'h-pct', pct + '%'));
      line.appendChild(el('span', 'h-of', st.done + ' of ' + st.total));
      a.appendChild(line);
      const m = el('div', 'h-meter');
      m.setAttribute('aria-hidden', 'true');
      const bar = el('span');
      bar.style.width = pct + '%';
      m.appendChild(bar);
      a.appendChild(m);
      a.appendChild(el('p', null, ph.note || ''));
      return a;
    }));
    if (S.syncedAt) {
      const at = new Date(S.syncedAt);
      setText('synced', isNaN(at) ? '—' : at.toLocaleString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }));
    }
  }

  /* ---------- Timeline ---------- */
  function drawTimeline() {
    const box = $('gantt');
    if (S.state !== 'ok') {
      box.classList.toggle('h-skel', S.state === 'loading');
      box.replaceChildren(...(S.state === 'loading' ? [] : [failLine()]));
      return;
    }
    box.classList.remove('h-skel');
    const dated = S.rows.filter((r) => r.s);
    if (!dated.length) { box.replaceChildren(failLine('No dated work in Jira yet')); return; }
    const x0 = mFloor(new Date(Math.min(...dated.map((r) => +r.s))));
    const x1 = mAdd(mFloor(new Date(Math.max(...dated.map((r) => +r.d)))), 1);
    const months = [];
    for (let m = x0; m < x1; m = mAdd(m, 1)) months.push(m);
    const pct = (d) => ((d - x0) / (x1 - x0)) * 100;
    const parts = [];

    const head = el('div', 'h-months');
    head.appendChild(el('div', 'h-lab'));
    const htrk = el('div', 'h-trk');
    months.forEach((m) => { const l = el('span', 'h-mlab', MON[m.getUTCMonth()]); l.style.left = pct(m) + '%'; htrk.appendChild(l); });
    head.appendChild(htrk);
    parts.push(head);

    const ov = el('div', 'h-overlay');
    months.forEach((m) => { const l = el('div', 'h-mline'); l.style.left = pct(m) + '%'; ov.appendChild(l); });
    if (TODAY >= x0 && TODAY < x1) {
      const t = el('div', 'h-today');
      t.style.left = pct(new Date(+TODAY + DAY / 2)) + '%';
      t.appendChild(el('b', null, 'Today ' + fShort(TODAY)));
      ov.appendChild(t);
    }
    parts.push(ov);

    (S.cfg.groups || []).forEach((G) => {
      const items = S.rows.filter(inEpics(G.epics)).sort(byDate);
      const st = groupStat(items);
      const b = el('button', 'h-grp');
      b.type = 'button';
      b.id = 'grp-' + G.id;
      b.setAttribute('aria-expanded', open.has(G.id) ? 'true' : 'false');
      const lab = el('div', 'h-lab');
      const ch = svgEl('svg', { viewBox: '0 0 10 10', class: 'h-chev', 'aria-hidden': 'true' });
      ch.appendChild(svgEl('path', { d: 'M3 1l4 4-4 4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }));
      lab.appendChild(ch);
      lab.appendChild(el('span', 'h-code', G.id));
      lab.appendChild(el('span', 'h-gname', G.name));
      lab.appendChild(el('span', 'h-gmeta', (st.start ? span(st.start, st.due) : 'Nothing scheduled') + ' · ' + st.done + '/' + st.total));
      b.appendChild(lab);
      const trk = el('div', 'h-trk');
      if (st.start) {
        const sp = el('div', 'h-span');
        sp.style.left = pct(st.start) + '%';
        sp.style.width = Math.max(0.6, pct(new Date(+st.due + DAY)) - pct(st.start)) + '%';
        trk.appendChild(sp);
      }
      b.appendChild(trk);
      b.addEventListener('click', () => { if (open.has(G.id)) open.delete(G.id); else open.add(G.id); drawTimeline(); });
      parts.push(b);
      if (!open.has(G.id)) return;
      if (!items.length) { parts.push(el('div', 'h-empty', 'Nothing scheduled in Jira for this phase yet.')); return; }
      items.forEach((r) => {
        const row = el('div', 'h-row' + (r.done ? ' done' : ''));
        const l = el('div', 'h-lab');
        l.appendChild(statusIcon(r));
        const t = el('div');
        t.appendChild(el('span', 'h-title', r.title));
        if (r.gw) t.appendChild(el('span', 'h-tag', 'Gateway ' + r.gw));
        l.appendChild(t);
        const m = el('div', 'h-meta');
        m.appendChild(keyEl(r.key));
        m.appendChild(el('span', null, r.s ? (+r.s === +r.d ? fDay(r.s) : fDay(r.s) + ' to ' + fDay(r.d)) : 'No dates in Jira'));
        if (!r.done && r.d && r.d < TODAY) m.appendChild(el('span', 'h-od', 'Overdue'));
        l.appendChild(m);
        row.appendChild(l);
        const tr = el('div', 'h-trk');
        if (r.s) {
          if (r.gw) {
            const dm = el('div', 'h-dia');
            dm.style.left = pct(new Date(+r.d + DAY / 2)) + '%';
            tr.appendChild(dm);
          } else {
            const bar = el('div', 'h-bar ' + r.cat);
            bar.style.left = pct(r.s) + '%';
            bar.style.width = (pct(new Date(+r.d + DAY)) - pct(r.s)) + '%';
            tr.appendChild(bar);
          }
        }
        row.appendChild(tr);
        parts.push(row);
      });
    });
    box.replaceChildren(...parts);
  }

  /* ---------- Gateways ---------- */
  function gwRow(title, sub, due, done, contractDate, key) {
    const r = el('div', 'h-gwrow');
    const left = el('div');
    left.appendChild(el('h4', null, title));
    const m = el('div', 'h-meta');
    if (key) m.appendChild(keyEl(key));
    if (sub) m.appendChild(el('span', null, sub));
    m.appendChild(el('span', null, due ? 'Due ' + fDay(due) : 'No date in Jira'));
    if (contractDate) m.appendChild(el('span', null, 'Contract ' + fDay(contractDate)));
    left.appendChild(m);
    r.appendChild(left);
    r.appendChild(countChip(done, due));
    return r;
  }
  function drawGateways() {
    const lists = document.querySelectorAll('.h-gwlist');
    if (S.state !== 'ok') {
      lists.forEach((n) => { n.classList.toggle('h-skel', S.state === 'loading'); n.replaceChildren(...(S.state === 'loading' ? [] : [failLine()])); });
      return;
    }
    const groups = S.cfg.groups || [];
    const trancheLabel = (t) => { const x = (S.cfg.tranches || []).find((y) => y.id === t); return x ? x.short || x.label : ''; };
    lists.forEach((n) => {
      n.classList.remove('h-skel');
      const gw = n.dataset.gw;
      const its = S.rows.filter((r) => r.gw === gw);
      const done = its.filter((r) => r.done).length;
      setText('gw-count-' + gw, done + ' of ' + its.length + ' signed off');
      const out = [];
      if (gw === '1') {
        its.sort(byDate).forEach((r) => {
          const g = groups.find((x) => (x.epics || []).includes(r.epic));
          const t2 = /Tranche 2/i.test(r.sum);
          const tranche = t2 ? 't2' : (g && g.tranche) || 't1';
          out.push(gwRow((trancheLabel(tranche) || 'Blueprint') + ' blueprints', r.title, r.d, r.done, contract(tranche, 'g1'), r.key));
        });
      } else {
        const kind = gw === '2' ? 'design' : 'build';
        groups.filter((g) => g.kind === kind).forEach((G) => {
          const ch = its.filter(inEpics(G.epics)).sort((a, b) => (+a.d || 0) - (+b.d || 0));
          if (!ch.length) return;
          const course = G.course || G.name;
          if (gw === '3') {
            ch.forEach((r) => out.push(gwRow(course + ' final sign-off', trancheLabel(G.tranche), r.d, r.done, contract(G.tranche, 'g3'), r.key)));
            return;
          }
          const next = ch.find((r) => !r.done);
          const last = ch[ch.length - 1];
          const row = gwRow(course + ' storyboards',
            [trancheLabel(G.tranche), ch.filter((r) => r.done).length + ' of ' + ch.length + ' signed off'].filter(Boolean).join(' · '),
            next ? next.d : last.d, !next, contract(G.tranche, 'g2'), null);
          const stages = el('div', 'h-stages');
          ch.forEach((r) => {
            const wk = r.sum.match(/(Week|Module) (\d+)/);
            const name = wk ? wk[1] + ' ' + wk[2] : 'Assessment';
            const late = !r.done && r.d && r.d < TODAY;
            const c = el('span', 'h-stage' + (r.done ? ' done' : r === next ? ' cur' : '') + (late ? ' late' : ''));
            c.appendChild(el('b', null, name));
            c.appendChild(document.createTextNode(r.d ? fShort(r.d) : 'No date'));
            c.title = name + ', ' + r.status + (late ? ', overdue' : '') + ', ' + r.key;
            stages.appendChild(c);
          });
          row.appendChild(stages);
          out.push(row);
        });
      }
      if (!out.length) out.push(el('div', 'h-empty', 'No sign-offs for this gateway in Jira yet.'));
      n.replaceChildren(...out);
    });
  }

  /* ---------- Charter ---------- */
  function drawCharter() {
    const ch = S.ch || {};
    const hd = ch.header || {};
    setText('ch-eyebrow', hd.eyebrow || (S.cfg.project + ' · ' + S.cfg.client));
    setText('ch-summary', hd.summary);
    setText('ch-src', hd.sources);
    const ov = ch.overview || {};
    setText('ov-intro', ov.intro);
    setText('ov-question', ov.question);
    setText('ov-note', ov.note);
    const scope = ch.scope || [];
    const sum = (k) => scope.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    setText('tile-courses', scope.length);
    setText('tile-modules', sum('modules'));
    setText('tile-assessments', sum('assessments'));
    setText('tile-videos', sum('videos'));
    fillTable('t-scope', [
      { label: 'Code', key: 'code' }, { label: 'Course', key: 'course' }, { label: 'Scope', key: 'scope' },
      { label: 'Complexity', key: 'complexity' }, { label: 'Tranche', key: 'tranche' },
      { label: 'Modules', key: 'modules', center: true }, { label: 'Videos', key: 'videos', center: true },
      { label: 'Assessments', key: 'assessments', center: true },
    ], scope);
    fillList('ch-steps', ch.steps);
    fillList('ch-deliv', ch.deliverables);
    setText('tm-intro', ch.timing && ch.timing.intro);
    setText('tm-note', ch.timing && ch.timing.note);
    setText('tm-crit', ch.timing && ch.timing.criticalPath);
    const tr = S.cfg.tranches || [];
    fillTable('t-ms', [{ label: 'Milestone', key: 'milestone' }].concat(tr.map((t) => ({ label: t.label, get: (r) => (r.text || {})[t.id] || '' }))), ch.milestones);
    fillList('ch-stake', ch.stakeholders);
    fillList('ch-meet', ch.meetings);
    fillTable('t-people', [
      { label: 'Person', key: 'name' }, { label: 'Organisation', key: 'org' }, { label: 'Role', key: 'role' },
      { label: 'Blueprint and scope', key: 'blueprint', center: true }, { label: 'Storyboard design', key: 'storyboard', center: true },
      { label: 'Media and graphics', key: 'media', center: true }, { label: 'Canvas build and QA', key: 'build', center: true },
      { label: 'Handover and sign-off', key: 'handover', center: true },
    ], ch.people);
    fillList('ch-success', ch.success);
    fillList('ch-bound', ch.boundaries);
    fillList('ch-dep', ch.dependencies);
    fillList('ch-risk', ch.risks);
    fillList('ch-dec', ch.decisions);
    fillTable('t-actions', [{ label: 'Action', key: 'action' }, { label: 'Owner', key: 'owner' }, { label: 'By', key: 'by' }], ch.actions);
    fillList('ch-tbc', ch.tbc);
  }

  /* ---------- Tabs and drawing ---------- */
  const tabs = [...document.querySelectorAll('.h-tab')];
  function draw() {
    if (S.cfg) drawHeader();
    if (current === 'timeline') drawTimeline();
    if (current === 'gateways') drawGateways();
    if (S.cfg && S.ch) drawCharter();
  }
  function show(id, link) {
    current = id;
    tabs.forEach((b) => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      $(b.dataset.tab).hidden = !on;
    });
    if (link) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ } }
    draw();
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => show(b.dataset.tab, true));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus();
      show(n.dataset.tab, true);
    });
  });
  document.querySelectorAll('.h-nav button').forEach((b) => b.addEventListener('click', () => {
    const t = $(b.dataset.go);
    t.open = true;
    t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $('exp-all').addEventListener('click', () => { ((S.cfg && S.cfg.groups) || []).forEach((g) => open.add(g.id)); drawTimeline(); });
  $('col-all').addEventListener('click', () => { open.clear(); drawTimeline(); });

  const h = location.hash.slice(1);
  if (['timeline', 'gateways', 'charter'].includes(h)) show(h, false);
  else draw();

  /* ---------- Load ---------- */
  const get = (u) => (window.HUB_INLINE && window.HUB_INLINE[u]
    ? Promise.resolve(window.HUB_INLINE[u])
    : fetch(u, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(u); return r.json(); }));
  Promise.all([get('config.json'), get('charter.json'), get('project-data.json')]).then(([cfg, ch, data]) => {
    S.cfg = cfg;
    S.ch = ch;
    S.rows = (data.issues || []).map(norm);
    S.syncedAt = data.synced_at;
    S.state = 'ok';
    draw();
  }).catch(() => { S.state = 'error'; draw(); });
})();
