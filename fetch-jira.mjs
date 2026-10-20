// Curio project hub: refreshes project-data.json from Jira.
// Runs in GitHub Actions on a schedule (see the workflow file). Needs two repository secrets:
//   JIRA_EMAIL      the Atlassian login email that owns the token
//   JIRA_API_TOKEN  an Atlassian API token (https://id.atlassian.com/manage-profile/security/api-tokens)
// Settings (project key, excluded epics, hidden rows) come from config.json in the same folder.
// If anything fails, the script exits with an error and leaves project-data.json untouched,
// so the website keeps showing the last good data.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'project-data.json');

async function loadConfig() {
  const cfg = JSON.parse(await readFile(path.join(HERE, 'config.json'), 'utf8'));
  const fields = { start: 'customfield_10706', epicLink: 'customfield_10015', ...(cfg.jiraFields || {}) };
  return {
    site: (cfg.jiraSite || 'https://curiogroup.atlassian.net').replace(/\/$/, ''),
    project: cfg.project,
    excluded: cfg.excludedEpics || [],
    hide: (cfg.hideRows || []).map((s) => new RegExp(s, 'i')),
    names: cfg.hideNamesInTitles || [],
    fields,
  };
}

export function tidy(rows, c) {
  const nameRe = c.names.length ? new RegExp(`\\s*\\((?:[^)]*\\b(?:${c.names.join('|')})\\b[^)]*)\\)`, 'g') : null;
  return rows
    .filter((r) => !c.hide.some((re) => re.test(r.summary || '')))
    .filter((r) => !c.excluded.includes(r.epic))
    .map((r) => ({ ...r, summary: (nameRe ? (r.summary || '').replace(nameRe, '') : (r.summary || '')).trim() }))
    .sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]));
}

const STATUS = { done: 'Done', indeterminate: 'In progress', new: 'To do' };

function shape(issue, c) {
  const f = issue.fields || {};
  const cat = f.status && f.status.statusCategory ? f.status.statusCategory.key : 'new';
  const epic = f[c.fields.epicLink] || (f.parent && f.parent.key) || null;
  const day = (v) => (v ? String(v).slice(0, 10) : null);
  return { key: issue.key, epic, status: STATUS[cat] || 'To do', start: day(f[c.fields.start]), due: day(f.duedate), summary: f.summary || '' };
}

async function fetchAll(c) {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error('JIRA_EMAIL and JIRA_API_TOKEN secrets are not set.');
  const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  let jql = `project = ${c.project} AND issuetype not in subTaskIssueTypes() AND issuetype != Epic`;
  if (c.excluded.length) jql += ` AND ("Epic Link" is EMPTY OR "Epic Link" not in (${c.excluded.join(', ')}))`;
  jql += ' ORDER BY key';
  const fields = ['summary', 'status', 'duedate', 'parent', c.fields.start, c.fields.epicLink];
  const rows = [];
  let nextPageToken;
  for (let page = 0; page < 50; page += 1) {
    const res = await fetch(`${c.site}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
    });
    if (!res.ok) throw new Error(`Jira answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    (body.issues || []).forEach((i) => rows.push(shape(i, c)));
    if (body.isLast || !body.nextPageToken) return rows;
    nextPageToken = body.nextPageToken;
  }
  throw new Error('Stopped after 50 pages; check the project key.');
}

async function save(issues, c) {
  const data = { project: c.project, synced_at: new Date().toISOString(), issues };
  await writeFile(OUT + '.tmp', JSON.stringify(data, null, 1) + '\n');
  await rename(OUT + '.tmp', OUT);
}

async function main() {
  const c = await loadConfig();
  const raw = await fetchAll(c);
  if (raw.length === 0) throw new Error('Jira returned no issues; keeping the previous data.');
  const issues = tidy(raw, c);
  await save(issues, c);
  console.log(`Saved ${issues.length} issues (${issues.filter((r) => r.status === 'Done').length} done) from ${raw.length} in Jira.`);
}

// First data file from rows saved elsewhere: node fetch-jira.mjs --from rows.json
async function fromFile(file) {
  const c = await loadConfig();
  const issues = tidy(JSON.parse(await readFile(file, 'utf8')), c);
  await save(issues, c);
  console.log(`Saved ${issues.length} issues from ${file}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--from');
  (i > -1 ? fromFile(process.argv[i + 1]) : main()).catch((e) => { console.error(e.message); process.exit(1); });
}
