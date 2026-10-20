# Preparing a release

This guide covers reviewing source for an initial publication and later releases. It does not authorize a commit, push, GitHub release, deployment, or repository visibility change. The repository owner must approve those actions separately.

## Create a review snapshot

From the development checkout:

```sh
npm run prepare:source -- --output work/source-review
```

The output has two parts:

- `source/`: the proposed repository contents, without the development checkout's Git history.
- `manifest.json`: the file inventory and checksums for review, outside the proposed source tree.

The output directory must not already exist. Choose a new path for each review. Do not copy the entire development checkout or its `.git/` directory into the proposed repository.

## Review the proposed contents

Check the manifest and read the files in `source/`, including tests, documentation, configuration, and image assets. Confirm that:

- All examples and fixtures use synthetic data.
- No journal exports, real habits or categories, personal screenshots, databases, logs, passwords, tokens, private deployment identifiers, or machine-specific paths are included.
- The license and third-party attribution are present, and the README matches the supported setup.
- The source snapshot contains no Git history, generated build output, dependency directories, or local runtime state.

Searches and the preparation tool help find mistakes but do not replace reviewing file contents. If a file needs a correction, edit the development source and prepare a new snapshot so the manifest describes the exact files being considered.

## Verify the clean source

With Node.js 24 or later available:

```sh
cd work/source-review/source
npm ci
npm run build
npm test
```

Record which revision or snapshot was checked and whether each command passed. These are local results; do not describe them as a successful GitHub Actions run until that workflow has actually completed.

For a manual interface check, start `npm run dev` from this clean copy and create a disposable account with synthetic journal entries. Stop another local instance first if it occupies port 8788. Do not import a personal journal into a review or demo instance.

Dependency installation, builds, tests, and a local preview can create ignored files. Review the final file list again before staging; the release should contain the reviewed source, not these generated files.

## Obtain approval before uploading

Give the owner the proposed source tree, its manifest, and the validation results. Keep the remote repository private and empty until the owner approves the first commit and push. A public release or a visibility change needs its own explicit approval.

Before any upload, verify the owner-approved GitHub repository, its account or organization, and its current visibility in repository settings. Do not assume that an existing remote is private.

## Start fresh history after approval

For the initial import, initialize a new Git repository in the reviewed `source/` directory rather than reusing the development repository's history:

```sh
git init -b main
git config user.name "YOUR_PUBLIC_AUTHOR_NAME"
git config user.email "YOUR_GITHUB_NOREPLY_ADDRESS"
git remote add origin https://github.com/YOUR_ACCOUNT/rhythm-web.git
```

Replace `YOUR_ACCOUNT` with the owner-approved GitHub account or organization and replace both identity placeholders before committing. Copy the exact noreply address from your GitHub email settings; do not guess it or use a personal address accidentally. The local configuration applies only to this new repository.

Stage only the reviewed manifest's source files. Inspect `git diff --cached --stat`, `git diff --cached`, and `git status --short`, including file contents that may not be obvious from a filename. Confirm the configured author identity and remote URL. Then make only the commit and push the owner approved.

For later releases, review the new commit range and its authors as well as the current files. Removing a private file from the working tree does not remove it from existing Git history.

## Publish only after approval

After the private push, review the repository's rendered documentation, complete file tree, commit metadata, and GitHub Actions results. Use synthetic data for every demo or screenshot. Enable private vulnerability reporting where available.

Only after the owner approves public publication should a maintainer change visibility or create a public release. Distribution under MIT does not make the application ready for unrestricted public hosting: the trusted identity gateway and owner-private audience described in [SECURITY.md](../SECURITY.md) remain required.
