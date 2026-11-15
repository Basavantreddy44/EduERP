// Creates a new migration folder from the difference between the dev database and schema.prisma.
// Usage: pnpm --filter @eduerp/db migrate:new <name>
//
// Why not `prisma migrate dev --create-only`? It replays migrations into a shadow database, and our
// hand-written SQL (grants on _prisma_migrations etc.) does not apply there. The dev DB must be up to
// date first (`pnpm db:migrate`). See docs/adr/ADR-002-prisma-with-raw-sql.md.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('Usage: migrate:new <snake_case_name>');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'prisma', 'migrations');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const dir = path.join(migrationsDir, `${stamp}_${name}`);

const raw = execSync(
  'npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script',
  { cwd: root, encoding: 'utf8' },
);

// Indexes created in hand-written sections are invisible to Prisma, so it always proposes dropping
// them. Remove those proposals (and their "-- DropIndex" comment) automatically.
const handWritten = new Set();
for (const m of fs.readdirSync(migrationsDir)) {
  const file = path.join(migrationsDir, m, 'migration.sql');
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const at = text.indexOf('Hand-written section');
  if (at < 0) continue;
  for (const match of text.slice(at).matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g)) handWritten.add(match[1]);
}

const dropOf = (line) => line.match(/^DROP INDEX "(\w+)";$/)?.[1];
const lines = raw.split(/\r?\n/);
const kept = lines.filter((line, i) => {
  if (handWritten.has(dropOf(line))) return false;
  if (line === '-- DropIndex' && handWritten.has(dropOf(lines[i + 1] ?? ''))) return false;
  return true;
});
const sql = kept.join('\n');

if (!kept.some((l) => l.trim() && !l.trim().startsWith('--'))) {
  console.log('No schema changes found.');
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, 'migration.sql'),
  `${sql.trimEnd()}\n\n-- =====================================================================\n-- Hand-written section (not expressible in schema.prisma). Review on every change.\n-- =====================================================================\n`,
);

const drops = kept.filter((l) => /^(DROP (INDEX|POLICY|TRIGGER|FUNCTION)|ALTER TABLE .* DROP CONSTRAINT)/.test(l));
console.log(`Created ${path.relative(root, dir)}/migration.sql`);
if (drops.length) {
  console.log('\nREVIEW: Prisma proposes these drops. Delete any that remove objects created in a hand-written section:');
  for (const d of drops) console.log('  ' + d);
}
console.log('\nNext: add RLS policies / CHECKs / grants for new tables in the hand-written section, then `pnpm db:migrate`.');
