import 'reflect-metadata';
import { createApp } from './bootstrap';
import { config } from './config';

async function main(): Promise<void> {
  const app = await createApp();
  await app.listen(config().API_PORT);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
