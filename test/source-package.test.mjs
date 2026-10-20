import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isSourcePath, prepareSource } from '../scripts/prepare-source.mjs';

async function fixture(t) {
  // realpath is important on macOS, where /var and /tmp are symlinks.
  const { realpath } = await import('node:fs/promises');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rhythm-source-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'Project with spaces — source');
  await mkdir(root);
  async function put(path, contents = 'synthetic fixture\n') {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await put('package.json', '{"name":"synthetic-package"}\n');
  await put('pubspec.yaml', 'name: synthetic_package\n');
  return { directory, root, put };
}

async function pathsBelow(root) {
  const paths = [];
  async function visit(prefix = '') {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await visit(path);
      else paths.push(path);
    }
  }
  await visit();
  return paths.sort();
}

async function verifyManifest(destination) {
  const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest).sort(), ['files', 'schemaVersion']);
  assert.deepEqual(manifest.files.map(file => file.path), await pathsBelow(join(destination, 'source')));
  for (const file of manifest.files) {
    assert.deepEqual(Object.keys(file).sort(), ['bytes', 'path', 'sha256']);
    const contents = await readFile(join(destination, 'source', file.path));
    assert.equal(file.bytes, contents.length);
    assert.equal(file.sha256, createHash('sha256').update(contents).digest('hex'));
  }
  return manifest;
}

test('source export uses an allowlist even for tracked personal or generated files', async t => {
  const { directory, root, put } = await fixture(t);
  const included = [
    '.gitignore', 'README.md', 'LICENSE', 'lib/main.dart', 'web/index.html',
    'web/favicon.png', 'worker/auth.mjs', 'db/schema.ts',
    'drizzle/0000_init.sql', 'drizzle/meta/_journal.json',
    'drizzle/meta/0000_snapshot.json', 'scripts/build.sh', 'test/example.test.mjs',
    'assets/icon-256.png', 'deploy/hosting.example.json',
    'docs/getting-started.md', '.github/workflows/checks.yml',
    '.github/ISSUE_TEMPLATE/bug.yml', '.github/PULL_REQUEST_TEMPLATE.md',
  ];
  const excluded = [
    '.openai/hosting.json', '.rhythm-data/local.sqlite',
    'work/export.json', 'artifacts/screenshot.png', 'screenshots/private.png',
    'exports/habits.json', 'backups/journal.json', '.env', '.env.example',
    '.dev.vars', 'node_modules/private.js', 'build/web/main.dart.js',
    'dist/server/index.js', 'worker/generated-assets.mjs', 'private.json',
    'web/records.json', 'assets/screenshot.png', 'deploy/hosting.json',
    'test/private.json', 'test/backups/private.mjs', 'lib/.private.dart',
    'docs/exports/private.md', '.github/workflows/.private.yml',
    'drizzle/meta/private.json', 'drizzle/journal-export.sql',
    'drizzle/dump.sql', 'drizzle/0002.sql',
    'db/account.sqlite', 'test/journal.sqlite3', 'lib/account.db',
    'worker/account.sqlite-wal', 'web/journal.json',
    'docs/journal.csv', 'test/journal.tsv', 'scripts/account.sql',
  ];
  for (const path of included) await put(path);
  for (const path of excluded) await put(path, 'SYNTHETIC_PRIVATE_MARKER');
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'add', '--all', '--force']);
  const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' });
  assert.ok(excluded.every(path => tracked.includes(path)));
  const result = await prepareSource({ root, output: join(directory, 'review') });
  const manifest = await verifyManifest(result.destination);
  assert.deepEqual(manifest.files.map(file => file.path), [...included, 'package.json', 'pubspec.yaml'].sort());
  assert.equal(result.fileCount, included.length + 2);
  for (const file of manifest.files) {
    assert.equal((await readFile(join(result.destination, 'source', file.path), 'utf8')).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  }
});

test('manifest is reproducible and executable source scripts remain executable', async t => {
  const { directory, root, put } = await fixture(t);
  await put('scripts/build.sh', '#!/bin/sh\nexit 0\n');
  await chmod(join(root, 'scripts/build.sh'), 0o755);
  const first = await prepareSource({ root, output: join(directory, 'one') });
  const second = await prepareSource({ root, output: join(directory, 'two') });
  assert.deepEqual(await verifyManifest(first.destination), await verifyManifest(second.destination));
  assert.deepEqual(await readFile(join(first.destination, 'manifest.json')), await readFile(join(second.destination, 'manifest.json')));
  assert.equal((await lstat(join(first.destination, 'source/scripts/build.sh'))).mode & 0o777, 0o755);
  assert.equal((await lstat(join(first.destination, 'source/package.json'))).mode & 0o777, 0o644);
});

test('existing output is never overwritten and source directories cannot receive exports', async t => {
  const { directory, root, put } = await fixture(t);
  const existing = join(directory, 'existing');
  await mkdir(existing);
  await writeFile(join(existing, 'keep.txt'), 'unchanged');
  await assert.rejects(prepareSource({ root, output: existing }), /already exists/);
  assert.equal(await readFile(join(existing, 'keep.txt'), 'utf8'), 'unchanged');
  for (const output of ['.', 'lib/review', 'web/review', 'docs/review', '.github/review', 'scripts/review', 'README.md/review']) {
    await assert.rejects(prepareSource({ root, output }), /outside the source directories/);
  }
  for (const output of ['.git/review', '.rhythm-data/review', 'build/review', 'node_modules/review']) {
    await assert.rejects(prepareSource({ root, output }), /outside private, generated, and tooling/);
  }
  await put('docs/guide.md');
  const result = await prepareSource({ root });
  assert.equal(result.destination, join(root, 'work/source-release'));
  assert.equal(result.manifest.files.some(file => file.path.startsWith('work/')), false);
});

test('traversal paths and root/ancestor destinations are rejected', async t => {
  const { directory, root } = await fixture(t);
  for (const output of ['../escape', 'work/../../escape', 'work\\..\\escape', '', 'bad\0path']) {
    await assert.rejects(prepareSource({ root, output }), /without traversal components/);
  }
  await assert.rejects(prepareSource({ root, output: directory }), /outside the source directories/);
  for (const path of ['../lib/private.dart', '/lib/main.dart', 'lib/../main.dart', 'lib\\main.dart', 'lib//main.dart']) {
    assert.equal(isSourcePath(path), false);
  }
});

test('source file and directory symlinks are rejected without copying their targets', async t => {
  for (const directoryLink of [false, true]) {
    const { directory, root, put } = await fixture(t);
    await put('lib/main.dart');
    const secret = join(directory, 'private');
    await mkdir(secret);
    await writeFile(join(secret, 'private.dart'), 'SYNTHETIC_PRIVATE_MARKER');
    await symlink(directoryLink ? secret : join(secret, 'private.dart'),
      join(root, directoryLink ? 'lib/linked' : 'lib/link.dart'));
    const output = join(directory, 'review');
    await assert.rejects(prepareSource({ root, output }), /symbolic links/);
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  }
});

test('symlinked output and output parents are rejected', async t => {
  const { directory, root } = await fixture(t);
  const realDirectory = join(directory, 'real-output');
  const link = join(directory, 'linked-output');
  await mkdir(realDirectory);
  await symlink(realDirectory, link);
  for (const output of [link, join(link, 'review')]) {
    await assert.rejects(prepareSource({ root, output }), /symbolic links/);
  }
  assert.deepEqual(await readdir(realDirectory), []);
});

test('CLI validates arguments without creating an unintended export', async t => {
  const { directory } = await fixture(t);
  const script = fileURLToPath(new URL('../scripts/prepare-source.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script, '--output'], { cwd: directory, stdio: 'pipe' }));
  assert.throws(() => execFileSync(process.execPath, [script, '--output', join(directory, 'bad'), '--unknown'], { cwd: directory, stdio: 'pipe' }));
  await assert.rejects(lstat(join(directory, 'bad')), { code: 'ENOENT' });
});

test('current working source exports without Git history or runtime data and matches its manifest', async t => {
  const { directory } = await fixture(t);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await prepareSource({ root, output: join(directory, 'current-review') });
  const manifest = await verifyManifest(result.destination);
  const paths = manifest.files.map(file => file.path);
  for (const required of [
    'README.md', 'LICENSE', 'package-lock.json', 'pubspec.lock',
    'lib/main.dart', 'worker/journal.mjs', 'scripts/prepare-source.mjs',
    'test/source-package.test.mjs', 'docs/RELEASING.md',
    '.github/workflows/ci.yml', '.github/pull_request_template.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
  ]) assert.ok(paths.includes(required), `${required} should be exported`);
  assert.ok(paths.every(isSourcePath));
  assert.equal(paths.includes('worker/generated-assets.mjs'), false);
  assert.equal(paths.some(path => /^(?:\.git\/|\.openai\/|\.rhythm-data\/|work\/|artifacts\/|build\/|dist\/|node_modules\/)/.test(path)), false);
});
