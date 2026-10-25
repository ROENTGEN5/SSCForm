import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { parseEnv } from 'node:util';

let local = {};
try { local = parseEnv(await readFile('.env', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const env = { ...local, ...process.env };
const demo = process.argv.includes('--demo');
const url = env.SUPABASE_URL || '';
const key = env.SUPABASE_PUBLISHABLE_KEY || '';
if (!demo) {
  if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url)) throw new Error('Set SUPABASE_URL to your HTTPS Supabase project URL.');
  let legacyRole;
  try { legacyRole = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch {}
  if (!(key.startsWith('sb_publishable_') || legacyRole === 'anon') || key.includes('replace_me')) {
    throw new Error('Set SUPABASE_PUBLISHABLE_KEY to a publishable key (or legacy anon key). Secret/service_role keys are forbidden.');
  }
}
await mkdir('dist/js', { recursive: true });
await build({ entryPoints: ['js/app.js'], outdir: 'dist/js', bundle: true, splitting: true, format: 'esm', minify: true, target: ['es2022'], define: {
  __APP_CONFIG__: JSON.stringify({ url: demo ? '' : url, key: demo ? '' : key, demo })
} });
await cp('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'dist/js/pdf.worker.js');
for (const [source, target] of [['standard_fonts', 'pdf-fonts'], ['cmaps', 'pdf-cmaps'], ['wasm', 'pdf-wasm']]) {
  await cp(`node_modules/pdfjs-dist/${source}`, `dist/${target}`, { recursive: true });
}
for (const path of ['index.html', 'css', 'assets', 'sample-survey-questions.json']) await cp(path, `dist/${path}`, { recursive: true });
await writeFile('dist/robots.txt', 'User-agent: *\nDisallow: /?admin=1\n');
console.log(demo ? 'Built explicit demo: responses are not saved.' : 'Production build ready in dist/.');
if (process.argv.includes('--serve')) {
  const { headers } = JSON.parse(await readFile('vercel.json', 'utf8'));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.json': 'application/json', '.wasm': 'application/wasm' };
  createServer(async (req, res) => {
    for (const header of headers[0].headers) res.setHeader(header.key, header.value);
    const path = resolve('dist', '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(resolve('dist') + '/') && !path.startsWith(resolve('dist') + '\\')) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
    catch { res.writeHead(404).end('Not found'); }
  }).listen(Number(env.PORT || 3000), '127.0.0.1', () => console.log(`Open http://127.0.0.1:${env.PORT || 3000} (restart after source edits).`));
}
