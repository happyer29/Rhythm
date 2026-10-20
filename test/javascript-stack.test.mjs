import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const excludedDirectories = new Set([
  '.git', '.openai', '.rhythm-data', '.dart_tool', '.wrangler', '.sites-runtime',
  '.codex', '.agents', '.idea', 'node_modules', 'work', 'artifacts',
  'screenshots', 'exports', 'backups', 'build', 'dist', 'coverage',
]);

function filesBelow(directory, prefix = '', skip = new Set()) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...filesBelow(join(directory, entry.name), path, skip));
    else paths.push(path);
  }
  return paths;
}

test('application source and tooling require only JavaScript', () => {
  const files = filesBelow(root, '', excludedDirectories);
  assert.deepEqual(files.filter(path => /\.(?:dart|tsx?)$/i.test(path)), []);
  for (const name of [
    'pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml', '.metadata',
    'scripts/flutterw.sh', 'scripts/build-web.sh', 'web/flutter_bootstrap.js',
  ]) assert.equal(existsSync(join(root, name)), false, `${name} must not remain in the active project`);

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.react);
  assert.ok(pkg.dependencies['react-dom']);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /\b(?:flutter|dart|tsc)\b/i);
  assert.doesNotMatch(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'), /\b(?:flutter|dart)\b/i);
});

test('built interfaces mount React and contain no legacy renderer artifacts', () => {
  const files = filesBelow(join(root, 'build/web'));
  assert.ok(files.includes('app.js'));
  assert.ok(files.includes('styles.css'));
  assert.ok(files.includes('auth.js'));
  assert.equal(files.some(path => /flutter|\.dart|canvaskit|skwasm|\.wasm$/i.test(path)), false);

  const appHTML = readFileSync(join(root, 'build/web/index.html'), 'utf8');
  const loginHTML = readFileSync(join(root, 'build/web/login.html'), 'utf8');
  assert.match(appHTML, /id="root"/);
  assert.match(appHTML, /src="\/app\.js"/);
  assert.match(loginHTML, /id="auth-root"/);
  assert.match(loginHTML, /src="\/auth\.js"/);
  assert.doesNotMatch(appHTML + loginHTML, /flutter|\.dart|canvaskit|skwasm/i);
  assert.deepEqual(filesBelow(join(root, 'dist/client')), ['favicon.png', 'favicon.svg']);
});
