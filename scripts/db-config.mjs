import fs from 'node:fs';
import path from 'node:path';

// Reads DB credentials from .env, tolerating the commented-out block the
// operations team ships in the repo.
export function loadDbConfig() {
  const envPath = path.join(process.cwd(), '.env');
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*#?\s*(DB_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) out[m[1]] = v;
  }
  return {
    host: process.env.DB_HOST || out.DB_HOST,
    port: Number(process.env.DB_PORT || out.DB_PORT || 3306),
    database: process.env.DB_DATABASE || out.DB_DATABASE,
    user: process.env.DB_USERNAME || out.DB_USERNAME,
    password: process.env.DB_PASSWORD || out.DB_PASSWORD,
  };
}
