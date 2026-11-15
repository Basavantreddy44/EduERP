import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './bootstrap';
import { buildOpenApi } from './openapi';

/** Writes docs/api/openapi.json (reviewed in PRs so API changes are visible). No DB access needed. */
async function main(): Promise<void> {
  const app = await createApp();
  const doc = buildOpenApi(app);
  const out = path.resolve(__dirname, '../../../docs/api/openapi.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  await app.close();
  console.log(`OpenAPI written: ${path.relative(process.cwd(), out)} (${Object.keys(doc.paths).length} paths)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
