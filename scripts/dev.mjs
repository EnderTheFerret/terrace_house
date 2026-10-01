// Runs server + web dev servers together. `node scripts/dev.mjs mock|real`.
// ponytail: tiny spawn wrapper instead of a `concurrently` dependency.
import { spawn } from 'node:child_process';

const mode = process.argv[2] === 'mock' ? 'mock' : 'real';
const env = { ...process.env, MODE: mode };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  spawn(npm, ['run', 'dev', '-w', 'apps/server'], { stdio: 'inherit', env, shell: true }),
  spawn(npm, ['run', 'dev', '-w', 'apps/web'], { stdio: 'inherit', env, shell: true }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
console.log(`\n  shared roof — ${mode} mode. open http://localhost:5173\n`);
