import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function testDB(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  for (const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x => x.endsWith('.sql'))) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));
  }
  const wrapper = {
    sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const bound = values => ({
        bind(...next) { return bound(next); },
        async first() { return stmt.get(...values) ?? null; },
        async run() { const result = stmt.run(...values); return {success:true,meta:{changes:Number(result.changes)}}; },
      });
      return bound([]);
    },
    async batch(commands) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const command of commands) result.push(await command.run()); sqlite.exec('COMMIT'); return result; }
      catch(error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return wrapper;
}
