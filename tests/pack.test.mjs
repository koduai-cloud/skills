import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { packDirectory } from '../skills/koudai-run/scripts/appisle.mjs';

const run = promisify(execFile);
async function project(t, files) {
  const dir = await mkdtemp(join(tmpdir(), 'appisle-pack-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) { await mkdir(dirname(join(dir, 'app', name)), { recursive: true }); await writeFile(join(dir, 'app', name), content); }
  return { dir, app: join(dir, 'app') };
}

test('compressible output beyond 32 MiB is deflated into a standard ZIP', async t => {
  const text = 'export const value = "lorem ipsum dolor sit amet";\n'.repeat(840000);
  const { dir, app } = await project(t, { 'bundle.js': text, 'logo.bin': Buffer.from([0, 1, 2, 3]) });
  const result = await packDirectory(app, join(dir, 'app.zip'));
  assert.ok(result.expanded_bytes > 40 * 1024 * 1024 && result.bytes < 1024 * 1024);
  // An independent reader must accept every entry and its CRC.
  const { stdout } = await run(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),sorted(i.compress_type for i in z.infolist()),len(z.read("bundle.js")))', join(dir, 'app.zip')]);
  assert.equal(stdout.trim(), `None [0, 8] ${Buffer.byteLength(text)}`);
});

test('dependency layouts are packed while private keys and real env files are refused', async t => {
  const { dir, app } = await project(t, {
    'server.py': 'print(1)', 'vendor/certifi/cacert.pem': '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    'node_modules/left-pad/index.js': 'module.exports = 1', '.env.example': 'API_KEY=', 'tls/server.key.pub.txt': 'public',
  });
  await mkdir(join(app, 'node_modules/.bin'));
  await symlink(process.platform === 'win32' ? join(app, 'node_modules/left-pad') : '../left-pad/index.js', join(app, 'node_modules/.bin/left-pad'), process.platform === 'win32' ? 'junction' : 'file');
  assert.equal((await packDirectory(app, join(dir, 'ok.zip'))).files, 5);
  for (const [name, content] of [['tls/server.key', 'raw secret'], ['id.pem', '-----BEGIN RSA PRIVATE KEY-----\n'], ['.env.production', 'SECRET=1'], ['.env', 'SECRET=1'], ['keystore.p12', 'x']]) {
    const bad = await project(t, { 'index.html': 'ok', [name]: content });
    await assert.rejects(packDirectory(bad.app, join(bad.dir, 'bad.zip')), /拒绝打包/, name);
  }
  const linked = await project(t, { 'index.html': 'ok' });
  await mkdir(join(linked.app, 'assets'));
  await symlink(join(linked.app, 'assets'), join(linked.app, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packDirectory(linked.app, join(linked.dir, 'bad.zip')), /符号链接/);
});
