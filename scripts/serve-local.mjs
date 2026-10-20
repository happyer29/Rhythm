// Loopback-only development harness. No bypass is included in the Worker bundle.
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntime } from '../test/worker-runtime.mjs';

const owner = 'local-development-owner';
const types = {'.wasm':'application/wasm','.js':'text/javascript','.json':'application/json','.otf':'font/otf','.ttf':'font/ttf','.png':'image/png','.bin':'application/octet-stream'};

function readBody(request, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      request.off('data', data);
      request.off('end', end);
      request.off('error', fail);
      request.off('aborted', aborted);
    };
    const fail = error => {
      cleanup();
      // A rejected/aborted upload can still report a socket error while draining.
      request.once('error', () => {});
      reject(error);
    };
    const aborted = () => fail(new Error('REQUEST_ABORTED'));
    const end = () => { cleanup(); resolveBody(Buffer.concat(chunks)); };
    const data = chunk => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error('BODY_TOO_LARGE'));
        request.resume();
      } else {
        chunks.push(chunk);
      }
    };
    request.on('data', data);
    request.on('end', end);
    request.on('error', fail);
    request.on('aborted', aborted);
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise(resolveClosed => {
    const deadline = setTimeout(() => server.closeAllConnections(), 5000);
    deadline.unref();
    server.close(() => { clearTimeout(deadline); resolveClosed(); });
    server.closeIdleConnections();
  });
}

export async function startLocalServer({
  port = 8788,
  d1Persist = resolve('.rhythm-data/d1'),
  testAccount = false,
} = {}) {
  const staticRoot = resolve('dist/client');
  let runtime;
  let origin;
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) {
        response.writeHead(403); response.end(); return;
      }
      if (!runtime) {
        response.writeHead(503, {'Retry-After':'1'});
        response.end('Local preview is starting.'); return;
      }
      const url = new URL(request.url, origin);
      const file = resolve(staticRoot, '.' + decodeURIComponent(url.pathname));
      if (file.startsWith(staticRoot + '/') && ['GET','HEAD'].includes(request.method) &&
          (await stat(file).catch(() => null))?.isFile()) {
        response.writeHead(200, {
          'Content-Type':types[extname(file)] ?? 'application/octet-stream',
          'X-Content-Type-Options':'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : await readFile(file)); return;
      }
      const headers = new Headers();
      for (const [key,value] of Object.entries(request.headers)) {
        if (value && !key.toLowerCase().startsWith('oai-')) {
          headers.set(key, Array.isArray(value) ? value.join(',') : value);
        }
      }
      headers.set('oai-authenticated-user-id', owner);
      let body;
      if (!['GET','HEAD'].includes(request.method)) {
        const journalRequest = url.pathname === '/api/journal' || url.pathname.startsWith('/api/journal/');
        body = await readBody(request, journalRequest ? 2 * 1024 * 1024 : 4096);
      }
      const result = await runtime.dispatchFetch(url.href, {
        method:request.method, headers, body, redirect:'manual',
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const tooLarge = error.message === 'BODY_TOO_LARGE';
      response.writeHead(tooLarge ? 413 : 503, tooLarge ? {'Connection':'close'} : {});
      response.end(tooLarge ? 'Request body too large.' : 'Local preview unavailable.');
    }
  });
  try {
    // Reserve the public port before opening the database: a second dev server
    // must not initialize or compete for an already-running server's data.
    await new Promise((resolveListening, reject) => {
      const fail = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', fail); resolveListening(); };
      server.once('error', fail);
      server.once('listening', ready);
      server.listen(port, '127.0.0.1');
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    await mkdir(d1Persist, {recursive:true, mode:0o700});
    const created = await createRuntime({d1Persist});
    runtime = created.runtime;
    if (testAccount) {
      const admin = await created.db.prepare('SELECT id FROM admin WHERE id = 1').first();
      if (!admin) {
        const result = await runtime.dispatchFetch(origin + '/api/auth/setup', {
          method:'POST',
          headers:{'oai-authenticated-user-id':owner, Origin:origin,
            'Content-Type':'application/json', 'X-Rhythm-Request':'1'},
          body:JSON.stringify({username:'demo-admin',password:'development-only-demo-passphrase',remember:true}),
        });
        if (!result.ok) throw new Error(`Could not seed local test account (HTTP ${result.status}).`);
      }
    }
    let closing;
    return {
      origin,
      close() {
        return closing ??= (async () => {
          await closeServer(server);
          await runtime.dispose();
        })();
      },
    };
  } catch (error) {
    await closeServer(server);
    await runtime?.dispose();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const preview = await startLocalServer({testAccount:process.argv.includes('--test-account')});
    console.log(`Rhythm local preview: ${preview.origin}`);
    console.log('Accounts and journals persist in .rhythm-data/d1.');
    const close = () => preview.close().catch(() => { process.exitCode = 1; });
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error('Rhythm could not start: 127.0.0.1:8788 is already in use. Existing data was not changed.');
    } else {
      console.error(`Rhythm could not start: ${error.message}`);
    }
    process.exitCode = 1;
  }
}
