import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod, lstat, mkdir, open, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const rootFiles = new Set([
  '.editorconfig', '.gitattributes', '.gitignore',
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  'CHANGELOG.md', 'LICENSE', 'NOTICE',
  'package.json', 'package-lock.json', 'drizzle.config.js',
]);
const sourceDirectories = new Set([
  'src', 'web', 'worker', 'db', 'drizzle', 'scripts', 'test',
  'assets', 'deploy', 'docs', '.github',
]);
const excludedDirectories = new Set([
  '.git', '.openai', '.rhythm-data', '.wrangler', '.sites-runtime',
  '.codex', '.agents', '.idea', 'node_modules', 'work', 'artifacts',
  'screenshots', 'exports', 'backups', 'build', 'dist', 'coverage',
]);
const extensionsByDirectory = {
  src: /\.(?:js|jsx|css)$/,
  web: /\.(?:js|html|css)$/,
  worker: /\.(?:mjs|js|html|css)$/,
  db: /\.js$/,
  scripts: /\.(?:mjs|js|cjs|sh)$/,
  test: /\.(?:mjs|js|cjs)$/,
  docs: /\.md$/,
};
const exactPaths = new Set([
  'assets/icon-256.png', 'web/favicon.png', 'web/favicon.svg', 'deploy/hosting.example.json',
  'docs/images/daily-journal.jpg', 'docs/images/insights.jpg',
  'docs/images/dark-appearance.jpg', 'docs/images/mobile-journal.jpg',
  '.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md',
  '.github/dependabot.yml', '.github/dependabot.yaml',
]);

// This is a source allowlist, not a secret scanner. Review the contents of the
// resulting source/ directory before committing it. Git tracking and ignore
// state deliberately have no influence on which files can be exported.
export function isSourcePath(path) {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\')) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || excludedDirectories.has(part))) {
    return false;
  }
  if (parts.length === 1) return rootFiles.has(path);
  if (parts.slice(1).some(part => part.startsWith('.'))) return false;
  if (path === 'worker/generated-assets.mjs') return false;
  if (exactPaths.has(path)) return true;
  if (extensionsByDirectory[parts[0]]?.test(path)) return true;
  if (/^drizzle\/\d{4}_[a-zA-Z0-9_]+\.sql$/.test(path)) return true;
  if (/^drizzle\/meta\/(?:_journal|\d+_snapshot)\.json$/.test(path)) return true;
  return /^\.github\/(?:workflows|ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\/[^/]+\.(?:md|ya?ml)$/.test(path);
}

function within(parent, path) {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function inspectOutputPath(path) {
  let cursor = resolve(path);
  while (true) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error('Output paths must not contain symbolic links.');
      if (cursor === path) throw new Error('The output directory already exists; choose a new directory.');
      if (!stat.isDirectory()) throw new Error('The output parent must be a directory.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

async function collectFiles(root) {
  const files = [];
  async function visit(path) {
    const fullPath = join(root, path);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) throw new Error('Source symbolic links are not supported.');
    if (stat.isDirectory()) {
      if (await realpath(fullPath) !== fullPath) throw new Error('Source symbolic links are not supported.');
      for (const entry of (await readdir(fullPath)).sort()) {
        if (entry.startsWith('.') || excludedDirectories.has(entry)) continue;
        const child = `${path}/${entry}`;
        const childStat = await lstat(join(root, child));
        // Check symlinks even when their suffix would not be selected. Never
        // follow a link in a source directory to determine its target's type.
        if (childStat.isSymbolicLink()) throw new Error('Source symbolic links are not supported.');
        if (childStat.isDirectory() || isSourcePath(child)) await visit(child);
      }
      return;
    }
    if (!isSourcePath(path)) return;
    if (!stat.isFile()) throw new Error('Source paths must be regular files.');
    const handle = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const currentStat = await handle.stat();
      if (!currentStat.isFile()) throw new Error('Source paths must be regular files.');
      const data = await handle.readFile();
      files.push({
        path, data, mode: currentStat.mode & 0o111 ? 0o755 : 0o644,
        bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
      });
    } finally {
      await handle.close();
    }
  }
  for (const entry of (await readdir(root)).sort()) {
    if (rootFiles.has(entry) || sourceDirectories.has(entry)) await visit(entry);
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export async function prepareSource({ root = projectRoot, output = 'work/source-release' } = {}) {
  if (typeof output !== 'string' || !output.trim() ||
      output.split(/[\\/]/).includes('..') || output.includes('\0')) {
    throw new Error('Choose an output path without traversal components.');
  }
  root = await realpath(resolve(root));
  const destination = resolve(root, output);
  if (within(destination, root) ||
      [...sourceDirectories, ...rootFiles].some(path => within(join(root, path), destination))) {
    throw new Error('The output directory must be outside the source directories.');
  }
  if (within(root, destination)) {
    const firstDirectory = relative(root, destination).split(sep)[0];
    if (excludedDirectories.has(firstDirectory) && firstDirectory !== 'work') {
      throw new Error('Choose a new output directory outside private, generated, and tooling directories.');
    }
  }
  await inspectOutputPath(destination);
  const files = await collectFiles(root);
  if (!files.some(file => file.path === 'package.json') ||
      !files.some(file => file.path === 'src/main.jsx')) {
    throw new Error('The source root must contain package.json and src/main.jsx.');
  }
  // Validate the entire source before creating output. mkdir without recursive
  // on the destination also protects against accidentally replacing a review.
  await mkdir(dirname(destination), { recursive: true });
  await inspectOutputPath(destination);
  await mkdir(destination);
  try {
    await mkdir(join(destination, 'source'));
    for (const file of files) {
      const target = join(destination, 'source', file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.data, { flag: 'wx', mode: file.mode });
      await chmod(target, file.mode);
    }
    const manifest = {
      schemaVersion: 1,
      files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    };
    await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    return { destination, fileCount: files.length, manifest };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log('Usage: node scripts/prepare-source.mjs [--output NEW_DIRECTORY]\nCreates source/ and manifest.json. Review source contents before committing.');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
    throw new Error('Usage: node scripts/prepare-source.mjs [--output NEW_DIRECTORY]');
  }
  const result = await prepareSource(args.length ? { output: args[1] } : {});
  console.log(`Prepared ${result.fileCount} source files in ${result.destination}`);
  console.log('Review source/ before committing. SHA-256 checksums are in manifest.json.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Avoid echoing operating-system errors containing machine-specific paths.
    console.error(error.code ? 'Source preparation failed. Check file access and choose a new output directory.' : error.message);
    process.exitCode = 1;
  });
}
