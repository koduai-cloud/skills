import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { skillDirectory, skillFiles } from '../scripts/verify-package.mjs';
import { packageSkill } from '../scripts/package-skill.mjs';

const run = promisify(execFile);
const cliPath = join(skillDirectory, 'scripts', 'appisle.mjs');
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'koudai-run-test-'));
  t.after(async () => {
    assert.equal(dirname(await realpath(root)), await realpath(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
function cli(args, cwd, env = {}, script = cliPath) {
  return run(process.execPath, [script, ...args], {
    cwd, windowsHide: true,
    env: { ...process.env, APPISLE_TOKEN: '', APPISLE_TOKEN_FILE: '', APPISLE_URL: '', APPISLE_CONFIG_DIR: join(cwd, 'credentials'), ...env },
  });
}

test('a fresh installation selects the public service without acquiring credentials', async t => {
  const root = await temporary(t);
  const before = await readdir(root);
  const result = await cli(['auth', 'status'], root);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { authenticated: false, platform_url: 'https://koudai.run' });
  assert.deepEqual(await readdir(root), before);
});

test('update guidance never contacts the service or reads a project or legacy update record', async t => {
  const root = await temporary(t);
  await mkdir(join(root, '.appisle'));
  await writeFile(join(root, '.appisle', 'project.json'), 'malformed project');
  await writeFile(join(root, '.appisle-update.json'), 'malformed update record');
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('{}'); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const args of [['update'], ['update', '--check']]) {
    const result = await cli(args, root, { APPISLE_URL: base });
    const value = JSON.parse(result.stdout);
    assert.equal(value.skill_name, 'koudai-run');
    assert.equal(value.updated, false);
    assert.equal(value.check_performed, false);
    assert.equal(value.update_available, null);
    assert.equal(value.update_command, 'npx skills update koudai-run');
  }
  await assert.rejects(cli(['update', '--url', base], root), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /skills update koudai-run/);
    return true;
  });
  assert.equal(requests, 0);
  assert.equal(await readFile(join(root, '.appisle', 'project.json'), 'utf8'), 'malformed project');
  assert.equal(await readFile(join(root, '.appisle-update.json'), 'utf8'), 'malformed update record');
});

test('a symlinked client installation packs offline without replacing installed files', async t => {
  const root = await temporary(t);
  const canonical = join(root, '.agents', 'skills', 'koudai-run');
  const linked = join(root, '.claude', 'skills', 'koudai-run');
  await cp(skillDirectory, canonical, { recursive: true });
  await mkdir(dirname(linked), { recursive: true });
  await symlink(canonical, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(canonical, '.appisle-update.json'), 'legacy state must remain untouched');
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'index.html'), '<h1>Fixture</h1>');
  const files = await skillFiles();
  const before = await Promise.all(files.map(name => readFile(join(canonical, name))));
  const result = await cli(['pack', '--dir', 'dist', '--out', '.appisle/app.zip'], root, {}, join(linked, 'scripts', 'appisle.mjs'));
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).files, 1);
  assert.equal(await realpath(linked), await realpath(canonical));
  for (const [index, name] of files.entries()) assert.deepEqual(await readFile(join(canonical, name)), before[index]);
  assert.equal(await readFile(join(canonical, '.appisle-update.json'), 'utf8'), 'legacy state must remain untouched');
});

test('the independent ZIP is deterministic and contains only the installable skill', async t => {
  const root = await temporary(t);
  const first = await packageSkill({ output: join(root, 'first.zip') });
  const second = await packageSkill({ output: join(root, 'second.zip') });
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.included, await skillFiles());
  assert.ok(first.included.includes('LICENSE'));
  assert.ok(first.included.every(name => !name.endsWith('.test.mjs') && !name.startsWith('.')));
  const zip = await readFile(first.artifact);
  const names = [];
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const stored = zip.readUInt32LE(offset + 18);
    const length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 30, offset + 30 + length).toString('utf8'));
    offset += 30 + length + extra + stored;
  }
  assert.deepEqual(names.sort(), first.included.map(name => 'koudai-run/' + name).sort());
});
