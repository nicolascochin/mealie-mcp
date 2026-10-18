/**
 * npm run test:live: starts a disposable Mealie (docker-compose.test.yml), waits for it, seeds
 * it, runs the integration suite against it, then removes it. KEEP_MEALIE=1 leaves it running.
 */
import { spawn } from 'node:child_process';
import { seed, waitForMealie } from './seed.js';

const port = process.env.MEALIE_TEST_PORT ?? '9925';
const mealieUrl = `http://127.0.0.1:${port}`;
const compose = ['compose', '-f', 'docker-compose.test.yml', '-p', 'mealie-mcp-test'];

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<number> {
  if ((await run('docker', [...compose, 'up', '-d', '--build'], { ...process.env, MEALIE_TEST_PORT: port })) !== 0) {
    throw new Error('docker compose up failed');
  }
  try {
    console.log(`Waiting for Mealie at ${mealieUrl}…`);
    await waitForMealie(mealieUrl);
    console.log('Seeding Mealie…');
    const data = await seed(mealieUrl);
    return await run('npx', ['vitest', 'run', '--config', 'vitest.live.config.ts'], {
      ...process.env,
      MEALIE_LIVE_SEED: JSON.stringify(data),
    });
  } finally {
    if (process.env.KEEP_MEALIE === '1') console.log(`Mealie left running at ${mealieUrl}`);
    else await run('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
