import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../build/web/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const options = {
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'inline',
  define: { 'process.env.NODE_ENV': '"production"' },
};

await build({ ...options, entryPoints: ['src/main.jsx'], outfile: 'build/web/app.js' });
// Keep the public HTML contract independent of the bundler's CSS naming.
await cp(new URL('app.css', output), new URL('styles.css', output));
await rm(new URL('app.css', output));
await build({ ...options, entryPoints: ['src/login.jsx'], outfile: 'build/web/auth.js' });

for (const name of [
  'index.html', 'favicon.png', 'favicon.svg', 'browser-storage.js', 'account-storage.js',
  'browser-hooks.js', 'auth-guard.js',
]) {
  await cp(new URL(`../web/${name}`, import.meta.url), new URL(name, output));
}
const login = await readFile(new URL('../worker/login.html', import.meta.url), 'utf8');
const loginCSS = await readFile(new URL('auth.css', output), 'utf8');
await writeFile(new URL('login.html', output), login.replace('<!-- LOGIN_STYLES -->', `<style>${loginCSS}</style>`));

await import('./prepare-dist.mjs');
console.log('Built the React application and sign-in interface.');
