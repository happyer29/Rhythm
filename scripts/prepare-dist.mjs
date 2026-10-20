import { cpSync, existsSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = `${root}/build/web`, target = `${root}/dist`;
const requiredAssets = [
  'index.html', 'app.js', 'styles.css', 'browser-storage.js', 'account-storage.js',
  'browser-hooks.js', 'auth-guard.js',
];
const publicAssets = ['favicon.png', 'favicon.svg'];
for (const name of [...requiredAssets, 'auth.js', 'login.html', ...publicAssets]) {
  if (!existsSync(`${source}/${name}`)) throw new Error(`Missing ${name}. Run npm run build first.`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(`${target}/client`, { recursive: true });
mkdirSync(`${target}/.openai`, { recursive: true });
const protectedAssets = {};
const mime = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
};
for (const name of requiredAssets) {
  protectedAssets[`/${name}`] = {
    body: readFileSync(`${source}/${name}`, 'utf8'),
    type: mime[name.split('.').at(-1)],
  };
}
// Only generic icon formats are public. All application HTML, JavaScript,
// and CSS must pass the Worker's session checks, including future build output.
const fingerprint = content => createHash('sha256').update(content).digest('hex').slice(0, 16);
const assetVersions = Object.fromEntries(Object.entries(protectedAssets)
  .map(([path, asset]) => [path, fingerprint(asset.body)]));
for (const name of publicAssets) {
  cpSync(`${source}/${name}`, `${target}/client/${name}`);
  assetVersions[`/${name}`] = fingerprint(readFileSync(`${source}/${name}`));
}
const versionAssets = html => html.replace(
  /(src|href)="(\/[^"?]+\.(?:js|css|png|svg))"/g,
  (match, attribute, path) => assetVersions[path]
    ? `${attribute}="${path}?v=${assetVersions[path]}"`
    : match,
);
protectedAssets['/index.html'].body = versionAssets(protectedAssets['/index.html'].body);
for (const name of readdirSync(`${target}/client`)) {
  if (!publicAssets.includes(name)) throw new Error(`Unexpected public asset: ${name}`);
}
const loginJS = readFileSync(`${source}/auth.js`, 'utf8');
assetVersions['/auth.js'] = fingerprint(loginJS);
const loginHTML = versionAssets(readFileSync(`${source}/login.html`, 'utf8'));
writeFileSync(`${root}/worker/generated-assets.mjs`, [
  `export const protectedAssets = ${JSON.stringify(protectedAssets)};`,
  `export const loginHTML = ${JSON.stringify(loginHTML)};`,
  `export const loginJS = ${JSON.stringify(loginJS)};`,
].join('\n'));
await build({
  entryPoints: [`${root}/worker/index.mjs`], outfile: `${target}/server/index.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  minify: true, sourcemap: false,
});
// Local builds do not need an account-specific deployment configuration.
// Keep the real hosting file outside source control; use the example to deploy.
if (existsSync(`${root}/.openai/hosting.json`)) {
  cpSync(`${root}/.openai/hosting.json`, `${target}/.openai/hosting.json`);
}
cpSync(`${root}/drizzle`, `${target}/.openai/drizzle`, { recursive: true });
console.log('Built authenticated Worker with protected React assets.');
