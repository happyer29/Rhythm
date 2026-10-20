import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { readFileSync,readdirSync } from 'node:fs';
export async function createRuntime({d1Persist} = {}) {
  const runtime = new Miniflare({
    modules:true,
    scriptPath:fileURLToPath(new URL('../dist/server/index.js',import.meta.url)),
    compatibilityDate:'2026-07-30',
    d1Databases:['DB'],
    host:'127.0.0.1',
    port:0,
    ...(d1Persist === undefined ? {} : {d1Persist}),
  });
  try {
    const db = await runtime.getD1Database('DB');
    await db.prepare(`CREATE TABLE IF NOT EXISTS rhythm_local_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    )`).run();
    const names = readdirSync(new URL('../drizzle/',import.meta.url))
      .filter(name => name.endsWith('.sql')).sort();
    for (const name of names) {
      const applied = await db.prepare('SELECT name FROM rhythm_local_migrations WHERE name = ?')
        .bind(name).first();
      if (applied) continue;
      const statements = readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8')
        .split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean);
      try {
        // Schema changes and their marker commit together, so startup can retry.
        await db.batch([
          ...statements.map(sql => db.prepare(sql)),
          db.prepare('INSERT INTO rhythm_local_migrations (name, applied_at) VALUES (?, ?)')
            .bind(name, Date.now()),
        ]);
      } catch (cause) {
        throw new Error(`Could not apply local migration ${name}; its changes were rolled back.`, {cause});
      }
    }
    return {runtime,db};
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
