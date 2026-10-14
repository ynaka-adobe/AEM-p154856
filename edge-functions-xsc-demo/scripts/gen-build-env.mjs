// Writes src/generated/build-env.js with every XSC_* value from the process
// environment or ./.env. Fallback for programs without config/secret stores
// (sandbox programs): values are embedded in the deployed package.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(XSC_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('XSC_') && v) env[k] = v;
}
mkdirSync('src/generated', { recursive: true });
writeFileSync('src/generated/build-env.js', `export default ${JSON.stringify(env, null, 2)};\n`);
console.log(`build-env: ${Object.keys(env).join(', ') || '(none)'}`);
