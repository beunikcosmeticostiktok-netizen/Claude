import { createDb, as, createUser, sudo } from './harness.mjs';

let passed = 0, failed = 0;
const failures = [];
export async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; failures.push([name, e.message]); console.log('  ✗', name, '\n     ', e.message); }
}
export const ok = (c, m) => { if (!c) throw new Error(m || 'asserção falhou'); };
export const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'diferente'}: obtido ${JSON.stringify(a)} esperado ${JSON.stringify(b)}`); };
export async function fails(promise, pattern, m) {
  try { await promise; } catch (e) {
    if (pattern && !new RegExp(pattern, 'i').test(e.message)) throw new Error(`${m || 'erro diferente'}: ${e.message}`);
    return;
  }
  throw new Error(m || 'esperava erro, mas passou');
}

const { db, files } = await createDb();
console.log('Migrações aplicadas:', files.length);
const ctx = { db, as, createUser, sudo, test, ok, eq, fails };

const suites = ['./suites/foundation.mjs', './suites/crm.mjs', './suites/catalog.mjs', './suites/quotes.mjs', './suites/stock.mjs', './suites/production.mjs', './suites/finance.mjs', './suites/projects.mjs', './suites/backfill.mjs'];
for (const s of suites) {
  try { const m = await import(s); console.log('\n' + s); await m.default(ctx); }
  catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(s.slice(2))) continue;
    failed++; failures.push([s, e.stack]); console.log('  ✗ suite', s, e.message);
  }
}
console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed ? 1 : 0);
