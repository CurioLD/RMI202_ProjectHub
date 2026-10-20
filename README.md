# RMI202 project hub

A client project hub for RMIT Online. Netlify publishes this repository as a website. Every weekday at 7:00am Sydney time, a GitHub Action reads Jira, rewrites `project-data.json` and commits it, and Netlify republishes the site.

| File | What it does | Who changes it |
| --- | --- | --- |
| `index.html`, `styles.css`, `app.js` | The hub page | Nobody |
| `config.json` | Project key, client, phases, timeline groups, hidden rows | Claude, when the project changes |
| `charter.json` | Charter content: scope, milestones, people, risks, actions | Claude, when the charter or SOW changes |
| `project-data.json` | Jira stories and tasks, plus the last update time | The GitHub Action, every weekday |
| `fetch-jira.mjs` | Reads Jira and writes `project-data.json` | Nobody |
| `netlify.toml` | Netlify settings | Nobody |
| `.github/workflows/refresh-jira.yml` | The weekday schedule | Created once on GitHub |

Secrets needed in GitHub (Settings → Secrets and variables → Actions): `JIRA_EMAIL` and `JIRA_API_TOKEN`.

If a refresh fails, the site keeps the last good data and GitHub emails the repository owner. Follow the Curio project hub setup guide for setup and troubleshooting.
