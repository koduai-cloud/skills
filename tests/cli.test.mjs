import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { commands } from '../skills/koudai-run/scripts/appisle.mjs';
import { runManagementCommand } from '../skills/koudai-run/scripts/management.mjs';

const run = promisify(execFile), here = dirname(fileURLToPath(new URL('../skills/koudai-run/scripts/appisle.mjs', import.meta.url))), CLI = join(here, 'appisle.mjs');
async function temp(t, prefix) { const dir = await mkdtemp(join(tmpdir(), prefix)); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function cli(args, cwd, env = {}, script = CLI) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, APPISLE_TOKEN: '', APPISLE_TOKEN_FILE: '', APPISLE_URL: '', ...env }, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    child.once('error', reject); child.once('exit', code => resolveRun({ code, stdout, stderr }));
  });
}
async function mcpServer(t, handle) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const value = JSON.parse(Buffer.concat(chunks).toString() || '{}'); seen.push({ authorization: req.headers.authorization, value });
    const result = value.method === 'initialize' ? { protocolVersion: '2025-06-18' } : { content: [{ type: 'text', text: JSON.stringify(handle(value.params.name, value.params.arguments)) }], isError: false };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return { base: `http://127.0.0.1:${server.address().port}`, seen };
}

test('an API token is never sent to the platform named by a cloned project', async t => {
  const root = await temp(t, 'appisle-token-'), { base, seen } = await mcpServer(t, () => ({ application: {} }));
  await mkdir(join(root, '.appisle'));
  await writeFile(join(root, '.appisle/project.json'), JSON.stringify({ app_uid: 'aid-abcdefghij', platform_url: base }));
  const env = { APPISLE_TOKEN: 'must-stay-local', APPISLE_CONFIG_DIR: join(root, 'cfg') };
  const refused = await cli(['status'], root, env);
  assert.equal(refused.code, 1); assert.match(refused.stderr, /APPISLE_URL/);
  assert.equal(seen.length, 0);
  const login = await cli(['login', '--no-browser'], root, env);
  assert.equal(login.code, 1); assert.match(login.stderr, /login --url/);
  assert.equal(seen.length, 0);
  assert.equal((await cli(['status'], root, { ...env, APPISLE_URL: base })).code, 0);
  assert.equal(seen.at(-1).authorization, 'Bearer must-stay-local');
});

test('deploy prints its task first and summarizes the access the server reports', async t => {
  const root = await temp(t, 'koudai-run-deploy-');
  let deployed = false;
  const { base } = await mcpServer(t, name => {
    if (name === 'deploy_app') { deployed = true; return { uid: 'dep-1', status: 'queued' }; }
    if (name === 'deployment_status') return { deployment: { uid: 'dep-1', status: 'succeeded' } };
    return { application: { uid: 'aid-abcdefghij', url: 'https://demo.apps.example', ...(deployed ? { active_deployment_uid: 'dep-1' } : {}), access_options: { system_mode: 'public' }, blocked: false } };
  });
  await writeFile(join(root, 'appisle.dsl.json'), '{"version":1,"type":"static"}');
  const result = await cli(['deploy', '--app', 'aid-abcdefghij', '--dsl', 'appisle.dsl.json'], root, { APPISLE_TOKEN: 'x', APPISLE_URL: base });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /dep-1/);
  assert.deepEqual(JSON.parse(result.stdout).summary, { url: 'https://demo.apps.example', first_deployment: true, console_url: `${base}/apps/aid-abcdefghij`, access: 'public', blocked: false });
});

test('an installed package packs offline and ignores a legacy platform update record', async t => {
  const root = await temp(t, 'appisle-offline-'), installed = join(root, '.claude/skills/koudai-run');
  await cp(dirname(here), installed, { recursive: true, filter: source => !source.endsWith('.test.mjs') });
  await writeFile(join(installed, '.appisle-update.json'), JSON.stringify({ source_url: 'http://127.0.0.1:9', files: [] }));
  await mkdir(join(root, 'dist')); await writeFile(join(root, 'dist/index.html'), 'ok');
  const result = await cli(['pack', '--dir', 'dist', '--out', '.appisle/app.zip'], root, {}, join(installed, 'scripts/appisle.mjs'));
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, '');
  assert.equal(await readFile(join(root, '.appisle/.gitignore'), 'utf8').then(text => text.includes('*')), true);
});

test('secrets saved under .appisle never appear as files Git would add', async t => {
  const root = await temp(t, 'appisle-git-');
  await run('git', ['init', '-q'], { cwd: root });
  await runManagementCommand('app-env', { app: 'aid-abcdefghij', out: '.appisle/private/env.json' }, { call: async () => ({ SECRET: 'x' }), appID: () => 'aid-abcdefghij', cwd: root });
  assert.equal((await run('git', ['status', '--porcelain', '-uall'], { cwd: root })).stdout, '');
});

test('every CLI command named in the Skill documents exists', async () => {
  const skill = dirname(here), names = ['SKILL.md', ...['cloud-dns', 'connection', 'data', 'databases', 'management', 'packaging', 'support', 'telemetry'].map(n => `references/${n}.md`)];
  for (const name of names) {
    for (const [, command] of (await readFile(join(skill, name), 'utf8')).matchAll(/node <cli> ([a-z-]+)/g)) assert.ok(commands.includes(command), `${name}: ${command}`);
  }
});
