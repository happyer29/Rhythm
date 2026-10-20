# Rhythm

<img src="assets/icon-256.png" alt="Rhythm icon" width="80" height="80">

A habit journal built with React and JavaScript, a Cloudflare Worker, and D1. Track daily habits, record time by category, explore your history, and keep your journal with your account across browsers.

Rhythm currently supports one administrator and one journal per deployment. Local development is supported out of the box. Hosted use requires an owner-private Sites deployment with a trusted identity gateway; other hosting environments need authentication integration before deployment. See the [deployment boundary](#deployment-boundary).

## Features

- Checkboxes, single and multiple choices, duration, numbers, and text entries.
- Duration categories with ordered sessions: record several sessions on the same topic in a day, or keep time without a category.
- Daily views, statistics, and a yearly activity grid.
- A reversible habit archive that preserves entries, categories, and statistics.
- Account-backed storage, revision conflict detection, and a previous-version backup.
- Validated JSON import and export.
- Responsive React interface, light and dark appearance, English and Simplified Chinese text.

## Run locally

Install Node.js 24 or later and Git. The interface, application logic, build tools, and server are JavaScript; no additional SDK is required.

Replace `YOUR_ACCOUNT` with the GitHub user or organization that hosts your copy of this repository:

```sh
git clone https://github.com/YOUR_ACCOUNT/Rhythm.git
cd Rhythm
npm ci
npm run build
npm run dev
```

Open [http://127.0.0.1:8788](http://127.0.0.1:8788) and create an administrator account on first use. Choose a unique password of 15–128 characters. There is no default production account.

`npm run build` bundles the React journal and sign-in interfaces with esbuild, then builds the Worker. A plain static server does not provide the required authentication and storage API. Rebuild and restart the local server after changing application or server code.

The development server binds to loopback and supplies a development-only platform identity. It applies the SQL migrations and persists accounts and journals in the ignored `.rhythm-data/d1/` directory. Restarting the server keeps this data; deleting that directory removes the local database. Local and hosted instances use separate databases. Do not expose the development server to the network.

## Using the journal

For a duration habit, add categories in its settings or choose **Add session** when recording a day. Each session keeps its category and duration; the daily total is calculated automatically. Repeated categories remain separate sessions.

Choose **⋯ → Archive habit** to remove a habit from today's and future lists. Its past entries and statistics remain available. Restore it through **My habits → Archive → Restore**, or use **Undo** immediately after archiving.

### Saving and backups

The server stores the journal under the administrator account. Sign in to the same account at the same site address to open it in another browser. Reload an already open tab to see changes saved elsewhere; live synchronization is not implemented.

Saving requires a server connection. **Not saved** means the current draft is only in the open tab. Keep the tab open and export a backup before reloading or closing it. If another browser saves first, the stale write is rejected rather than overwriting that journal; export your draft before loading the current server version.

- **Backup options → Export JSON** downloads a separate copy.
- **Restore from JSON** validates a backup and, after confirmation, replaces the account journal in every browser.
- **Export previous version** downloads the snapshot from before the most recent successful save. This is one previous version, not a complete backup history.

Exports use schema version 2, including duration categories and ordered sessions. Version 1 backups can be imported and upgraded. Duration integers and their sums must fit JavaScript's safe-integer range. A journal is limited to 900,000 UTF-8 bytes.

If an account has no journal yet, a nonempty legacy IndexedDB journal can be migrated once. An existing server journal is authoritative; differing browser copies are not merged automatically. Legacy copies are retained. JSON exports and legacy browser copies are not encrypted by Rhythm. Signing out or clearing browser data does not delete the server journal.

## Development

```sh
# Production React and Worker build
npm run build

# All Node.js tests, including Worker/D1 integration tests
npm test

# Focused suites
npm run test:storage
npm run test:auth
npm run test:worker
npm run test:account
```

Run the build before the Worker tests, which exercise the generated bundle. After changing only server code, `npm run build:server` can reuse the existing React build. Changes to `src/`, `web/`, or the sign-in HTML shell require a full build. The GitHub Actions workflow runs `npm run build` and `npm test` for pushes and pull requests; its results appear in the repository's Actions tab when enabled.

| Path | Purpose |
| --- | --- |
| `src/` | React components, journal state, validation, and styles |
| `web/` | Browser storage, authentication lifecycle, and WebMCP integration |
| `worker/` | Authentication and account journal API |
| `drizzle/` | D1 schema migrations |
| `scripts/` | Build and local preview tools |
| `test/` | JavaScript tests with synthetic data |

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and privacy guidelines.

## Preparing source for sharing

Create a separate source snapshot and review manifest:

```sh
npm run prepare:source -- --output work/source-review
```

The output contains `source/` and a `manifest.json` beside it. The preparation tool excludes local databases, personal exports, generated builds, deployment configuration, and Git history. Review the actual files before sharing; an exclusion list cannot establish that every file's contents are safe to publish.

The command does not commit, push, create a release, or change repository visibility. Follow [the release guide](docs/RELEASING.md) to verify a clean snapshot and prepare the first publication.

## Deployment boundary

The current Worker expects an owner-private Sites deployment whose trusted gateway supplies `oai-authenticated-user-id`. That gateway is part of the authentication boundary, including first-time administrator setup. The Worker is **not ready to deploy directly on a public endpoint that accepts this header from clients**. Other hosting environments need a trusted identity integration and a review of initial enrollment before use.

The build produces `dist/server/index.js` and generic assets in `dist/client/`. Deploy the Worker with a D1 binding named `DB` and apply the migrations in `drizzle/`. Do not publish `build/web/` as a standalone static site: that bypasses the app's server access checks.

Platform-specific `.openai/hosting.json` configuration is optional for local builds and must stay outside version control. Use [deploy/hosting.example.json](deploy/hosting.example.json) as a template and configure deployment identifiers and the private audience for your own instance; no deployment account or database is distributed with this project. See [SECURITY.md](SECURITY.md) for the security model and its limits.

## License

Rhythm is licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.
