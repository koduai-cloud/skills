import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runManagementCommand } from '../skills/koudai-run/scripts/management.mjs';

test('environment reads hide values, explicit export uses private file without overwriting', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'appisle-management-'));
  const call = async () => ({ DATABASE_TOKEN: 'Sensitive9!', EMPTY: '' });
  const context = { cwd, call, appID: () => 'aid-abcdefghijklmnop' };
  try {
    const names = await runManagementCommand('app-env', {}, context);
    assert.deepEqual(names, { names: ['DATABASE_TOKEN', 'EMPTY'], count: 2 });
    const saved = await runManagementCommand('space-env', { space: 'ns-abcdefghijkl', out: '.appisle/private/env.json' }, context);
    assert.ok(!JSON.stringify(saved).includes('Sensitive9!'));
    assert.equal(JSON.parse(await readFile(saved.saved_file, 'utf8')).DATABASE_TOKEN, 'Sensitive9!');
    await assert.rejects(() => runManagementCommand('space-env', { space: 'ns-abcdefghijkl', out: '.appisle/private/env.json' }, context));
    await assert.rejects(() => runManagementCommand('space-env', { space: 'ns-abcdefghijkl', out: 'leak.json' }, context));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('environment writes retain empty values and wait for each exact deployment', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'appisle-management-'));
  const file = join(cwd, 'input.json'), calls = [], waited = [];
  try {
    await writeFile(file, '\ufeff' + JSON.stringify({ GLOBAL: 'value', EMPTY: '' }));
    const result = await runManagementCommand('space-env-set', { space: 'ns-abcdefghijkl', file }, {
      cwd, call: async (name, args) => { calls.push({ name, args }); return { saved: true, deployment_uids: ['dep-one', 'dep-two'] }; },
      waitForJob: async ({ uid }) => { waited.push(uid); return { deployment: { status: 'succeeded', app_uid: 'aid-fixture' } }; },
    });
    assert.deepEqual(calls, [{ name: 'set_space_environment', args: { namespace_uid: 'ns-abcdefghijkl', values: { GLOBAL: 'value', EMPTY: '' } } }]);
    assert.deepEqual(waited, ['dep-one', 'dep-two']);
    assert.equal(result.deployments.length, 2);
    await writeFile(file, '{"INVALID":123}');
    await assert.rejects(() => runManagementCommand('app-env-set', { file }, { appID: () => 'aid-fixture', call: async () => assert.fail('invalid values must not be sent') }));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('generic tool CLI discovers server schema, protects secret results and checks deletion target', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'appisle-management-'));
  const input = join(cwd, 'args.json'); let count = 0;
  const call = async () => { count++; return { SECRET: 'hidden' }; };
  call.listTools = async () => [{ name: 'app_environment', inputSchema: { type: 'object' } }, { name: 'delete_app' }];
  try {
    await writeFile(input, '{"uid":"aid-abcdefghijklmnop"}');
    assert.deepEqual((await runManagementCommand('tools', { tool: 'app_environment' }, { call })).inputSchema, { type: 'object' });
    const result = await runManagementCommand('call', { tool: 'app_environment', input }, { cwd, call });
    assert.ok(result.saved_file); assert.ok(!JSON.stringify(result).includes('hidden'));
    await assert.rejects(() => runManagementCommand('call', { tool: 'delete_app', input }, { cwd, call }));
    await assert.rejects(() => runManagementCommand('call', { tool: 'unknown', input }, { cwd, call }));
    assert.equal(count, 1);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('database binding requires an array and forwards explicit deployment intent', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'appisle-management-')), file = join(cwd, 'bindings.json');
  const calls = [];
  try {
    await writeFile(file, '[{"uid":"db-abcdefgh","container":"web","env_prefix":"DB"}]');
    await runManagementCommand('app-databases', { file, deploy: true, 'no-wait': true }, { appID: () => 'aid-abcdefghijklmnop', call: async (name, args) => { calls.push({ name, args }); return { deployment_uid: 'dep-fixture' }; } });
    assert.equal(calls[0].name, 'set_app_databases'); assert.equal(calls[0].args.deploy, true); assert.equal(calls[0].args.bindings[0].env_prefix, 'DB');
    await writeFile(file, '{}');
    await assert.rejects(() => runManagementCommand('app-databases', { file }, { call: async () => assert.fail('must not send malformed bindings') }));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
