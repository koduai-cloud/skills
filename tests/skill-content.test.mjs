import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/koudai-run');
const documents = async () => ['SKILL.md', ...(await readdir(join(skill, 'references'))).filter(n => n.endsWith('.md')).map(n => `references/${n}`)];
// GitHub-style heading anchors, which clients use to open a section.
const slug = heading => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

test('SKILL.md stays a short entry point with bilingual triggers', async () => {
  const text = await readFile(join(skill, 'SKILL.md'), 'utf8');
  assert.ok(Buffer.byteLength(text) <= 11 * 1024, `SKILL.md is ${Buffer.byteLength(text)} bytes; move details into references`);
  const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  assert.match(front, /^name: koudai-run$/m);
  const description = front.match(/^description: (.+)$/m)?.[1] ?? '';
  // Novices ask for a link their friends can open, not for a deployment.
  for (const word of ['部署', '上线', '口袋空间', 'deploy', '链接', '手机', '发给朋友']) assert.ok(description.includes(word), word);
  assert.ok(description.length <= 1024);
  assert.match(front, /^  compatibility: .*Node\.js 24/m);
});

test('the entry point describes installing the complete GitHub skill', async () => {
  const text = await readFile(join(skill, 'SKILL.md'), 'utf8');
  assert.match(text, /npx skills add koduai-cloud\/skills --skill koudai-run/);
});

test('every fenced code block closes on a line of its own', async () => {
  for (const name of await documents()) {
    let open = false;
    for (const [index, line] of (await readFile(join(skill, name), 'utf8')).split('\n').entries()) {
      if (!line.startsWith('```')) continue;
      if (open) assert.equal(line.trim(), '```', `${name}:${index + 1} closing fence carries text`);
      open = !open;
    }
    assert.ok(!open, `${name} has an unclosed code block`);
  }
});

test('every relative link and section anchor in the Skill resolves', async () => {
  for (const name of await documents()) {
    const text = await readFile(join(skill, name), 'utf8');
    for (const [, target] of text.matchAll(/\]\((?!https?:)([^)\s]+)\)/g)) {
      const [file, anchor] = target.split('#');
      const path = file ? join(skill, dirname(name), file) : join(skill, name);
      assert.ok((await stat(path)).isFile(), `${name} → ${target}`);
      if (anchor) {
        const headings = [...(await readFile(path, 'utf8')).matchAll(/^#{1,6} (.+)$/gm)].map(m => slug(m[1]));
        assert.ok(headings.includes(anchor), `${name} → ${target}`);
      }
    }
  }
});

test('authorization offers 好了 or 没看到授权页 and a recovery path', async () => {
  const entry = await readFile(join(skill, 'SKILL.md'), 'utf8');
  const connection = await readFile(join(skill, 'references/connection.md'), 'utf8');
  const section = connection.split(/^## /m).find(part => part.startsWith('没看到授权页'));
  assert.ok(section, 'missing 没看到授权页 section');
  for (const phrase of ['「好了」', '「没看到授权页」']) {
    assert.ok(entry.includes(phrase), `SKILL.md missing ${phrase}`);
    assert.ok(section.includes(phrase), `section missing ${phrase}`);
  }
  assert.match(section, /请在打开的页面登录口袋空间/);
  for (const step of ['authorization_url', '弹窗', '同一台电脑', '手动打开', '重新执行 `login`', '换一个浏览器', '提交工单']) {
    assert.ok(section.includes(step), step);
  }
  assert.match(entry, /references\/connection\.md#没看到授权页/);
});

test('user-facing documents carry no local-development addresses or codes', async () => {
  for (const name of await documents()) {
    const text = await readFile(join(skill, name), 'utf8');
    for (const banned of ['console.localhost', '233233']) assert.ok(!text.includes(banned), `${name}: ${banned}`);
  }
});
