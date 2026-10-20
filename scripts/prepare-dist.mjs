import { cpSync, existsSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = `${root}/build/web`, target = `${root}/dist`;
if (!existsSync(`${source}/index.html`)) throw new Error('Run flutter build web first.');
rmSync(target, {recursive:true,force:true});
mkdirSync(`${target}/client`,{recursive:true});
mkdirSync(`${target}/.openai`,{recursive:true});
const protectedAssets = {};
for (const name of readdirSync(source)) {
  const path = `${source}/${name}`;
  // App HTML and root scripts are served exclusively by the authenticated Worker.
  // Only generic renderer/font/icon assets enter public static output.
  if (statSync(path).isFile() && /\.(html|js|json)$/.test(name)) {
    protectedAssets[`/${name}`] = {body:readFileSync(path,'utf8'),type:name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'application/json; charset=utf-8'};
  } else if (!name.endsWith('.map')) cpSync(path,`${target}/client/${name}`,{recursive:true});
}
// Migrate browsers that cached the previous static release. Cached scripts must
// not bypass the new startup/session guards or hide the new sign-out control.
const fingerprint = content => createHash('sha256').update(content).digest('hex').slice(0,16);
protectedAssets['/flutter_bootstrap.js'].body = protectedAssets['/flutter_bootstrap.js'].body
  .replaceAll('main.dart.js',`main.dart.js?v=${fingerprint(protectedAssets['/main.dart.js'].body)}`);
protectedAssets['/index.html'].body = protectedAssets['/index.html'].body.replace(/src="([^"]+\.js)"/g,(_,name)=>
  `src="${name}?v=${fingerprint(protectedAssets[`/${name}`].body)}"`);
for (const name of ['index.html','main.dart.js','browser-storage.js','account-storage.js','browser-hooks.js','auth-guard.js','flutter_bootstrap.js']) {
  if (!protectedAssets[`/${name}`]) throw new Error(`Missing protected asset: ${name}`);
  if (existsSync(`${target}/client/${name}`)) throw new Error(`Public asset leaks app: ${name}`);
}
writeFileSync(`${root}/worker/generated-assets.mjs`,[
  `export const protectedAssets = ${JSON.stringify(protectedAssets)};`,
  `export const loginHTML = ${JSON.stringify(readFileSync(`${root}/worker/login.html`,'utf8'))};`,
  `export const loginJS = ${JSON.stringify(readFileSync(`${root}/worker/login.js`,'utf8'))};`,
].join('\n'));
await build({entryPoints:[`${root}/worker/index.mjs`],outfile:`${target}/server/index.js`,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,sourcemap:false});
// Local builds do not need an account-specific deployment configuration.
// Keep the real hosting file outside source control; use the example to deploy.
if (existsSync(`${root}/.openai/hosting.json`)) {
  cpSync(`${root}/.openai/hosting.json`,`${target}/.openai/hosting.json`);
}
cpSync(`${root}/drizzle`,`${target}/.openai/drizzle`,{recursive:true});
console.log('Built authenticated Worker and generic Flutter assets. No public app entrypoint.');
