# Contributing

Thank you for helping improve Rhythm Web. Keep changes focused and describe the user-visible problem, the resulting behavior, and how you verified it. Use English for repository documentation, issues, and pull requests; keep application text in the existing localization system.

## Development setup

Follow [README.md](README.md) to install dependencies, build, and start the local preview. The project uses Flutter Web for the interface and a Cloudflare Worker with D1 for account storage. Local preview data persists between restarts.

Before submitting a change, run the checks relevant to it:

```sh
npm run build
npm test
```

The build runs Dart analysis and Flutter tests; `npm test` runs the Node.js suites. Build first when running Worker integration tests so they exercise current code. The [README](README.md#development) lists focused suites for iteration. Add regression tests for behavior changes, especially persistence, import validation, authentication, and concurrent saves. Use isolated test databases rather than your everyday journal.

Use the existing code style and keep new user-facing strings in `lib/l10n.dart`. Preserve both supported interface languages. Avoid unrelated formatting or generated file changes.

## Data and privacy

- Use synthetic habits, dates, entries, identities, and credentials in tests and examples. Do not copy a real journal into a fixture.
- Keep local databases, exports, screenshots of personal journals, environment files, deployment identifiers, and credentials out of commits and pull-request attachments.
- Review both the staged file list and diff before committing. Ignored files are a safeguard, not a substitute for review.
- Preserve backward-compatible import behavior and avoid silent data loss. Model or serialization changes must be reflected in Dart validation, Worker validation, browser adapters, and relevant tests.
- Follow [SECURITY.md](SECURITY.md) for vulnerability reports; do not publish sensitive details in an issue.

## Pull requests

Explain the change and list the checks you ran. For interface changes, include a screenshot using synthetic data when it helps review. Document changes to setup, storage, or deployment assumptions. Keep generated builds and local runtime state out of the patch.

Use the issue templates for reproducible bugs and feature proposals. For release preparation, follow [docs/RELEASING.md](docs/RELEASING.md); preparing a source snapshot is separate from approving its publication.

Contributions are provided under the project's [MIT License](LICENSE).
