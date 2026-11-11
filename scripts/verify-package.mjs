import assert from 'node:assert/strict';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const skillDirectory = join(repository, 'skills', 'koudai-run');

export async function skillFiles(root = skillDirectory, prefix = '') {
  const names = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    assert.ok(!entry.isSymbolicLink(), 'Skill resources must be regular files: ' + name);
    if (entry.isDirectory()) names.push(...await skillFiles(root, name));
    else {
      assert.ok(entry.isFile(), 'Unsupported Skill resource: ' + name);
      names.push(name);
    }
  }
  return names.sort();
}

export async function verifyPackage() {
  const files = await skillFiles();
  for (const name of ['SKILL.md', 'LICENSE', 'agents/openai.yaml', 'scripts/appisle.mjs', 'scripts/auth.mjs', 'scripts/update.mjs', 'scripts/publisher.mjs']) {
    assert.ok(files.includes(name), 'Missing resource: ' + name);
  }
  const allowed = /^(?:SKILL\.md|LICENSE|agents\/openai\.yaml|references\/[a-z0-9-]+\.md|scripts\/[a-z0-9-]+\.mjs)$/;
  for (const name of files) {
    assert.ok(allowed.test(name) && !name.endsWith('.test.mjs'), 'Unexpected installable file: ' + name);
    const full = join(skillDirectory, name), info = await lstat(full);
    assert.ok(info.isFile() && info.size <= 512 * 1024, 'Invalid resource: ' + name);
    const text = await readFile(full, 'utf8');
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{20,}/.test(text), 'Private key in ' + name);
    assert.ok(!/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(text), 'Token in ' + name);
    assert.ok(!/[A-Z]:[\\/]Users[\\/]|\/Users\/|\/home\/[^/\s]+\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i.test(text), 'Personal path or email in ' + name);
    if (name.endsWith('.mjs')) {
      execFileSync(process.execPath, ['--check', full], { stdio: 'pipe', windowsHide: true });
      for (const [, dependency] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (dependency.startsWith('node:')) continue;
        assert.ok(dependency.startsWith('./') || dependency.startsWith('../'), 'External dependency: ' + dependency);
        const target = resolve(dirname(full), dependency), child = relative(skillDirectory, target);
        assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'Dependency outside Skill: ' + dependency);
        assert.ok((await lstat(target)).isFile(), 'Missing dependency: ' + dependency);
      }
    }
  }
  const entry = await readFile(join(skillDirectory, 'SKILL.md'), 'utf8');
  assert.match(entry, /^---\nname: koudai-run\n/);
  assert.match(entry, /\nlicense: MIT\n/);
  assert.equal(await readFile(join(skillDirectory, 'LICENSE'), 'utf8'), await readFile(join(repository, 'LICENSE'), 'utf8'));
  return { skill: 'koudai-run', files: files.length, scripts: files.filter(name => name.endsWith('.mjs')).length, verified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyPackage(), null, 2));
}
