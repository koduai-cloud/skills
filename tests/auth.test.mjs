import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { platformOrigin, pkce, loopbackCallback, login, readCredential, accessToken, credentialPath, logout } from '../skills/koudai-run/scripts/auth.mjs';

const CLI = fileURLToPath(new URL('../skills/koudai-run/scripts/appisle.mjs', import.meta.url));
const response = (value, status = 200) => ({ value, status, ok: status >= 200 && status < 300 });

test('platform origins reject remote plaintext and credential-bearing URLs', () => {
  for (const value of ['http://example.com', 'http://127.evil.com', 'https://a.test/path', 'https://u:p@a.test', 'https://a.test?x=1']) assert.throws(() => platformOrigin(value));
  for (const value of ['http://console.localhost:18080', 'http://127.0.0.1:1234', 'http://[::1]:1234', 'https://appisle.example']) assert.equal(platformOrigin(`${value}/`), value);
  const p = pkce(); assert.ok(p.verifier.length >= 43); assert.equal(p.challenge, createHash('sha256').update(p.verifier).digest('base64url'));
});

test('loopback requires bound state, unique parameters and a single callback', async () => {
  const callback = await loopbackCallback('expected-state', 3000);
  try {
    assert.equal((await fetch(`${callback.redirectURI}?code=secret&state=wrong`)).status, 400);
    assert.equal((await fetch(`${callback.redirectURI}?code=secret&state=expected-state&state=wrong`)).status, 400);
    const good = `${callback.redirectURI}?code=one-use-code&state=expected-state`;
    assert.equal((await fetch(good)).status, 200); assert.equal(await callback.completed, 'one-use-code');
    assert.equal((await fetch(good)).status, 404);
  } finally { callback.close(); }
});

test('loopback timeout and denial terminate without a credential', async () => {
  const timeout = await loopbackCallback('state', 30);
  try { await assert.rejects(timeout.completed, /超时/); } finally { timeout.close(); }
  const denied = await loopbackCallback('state');
  try { await fetch(`${denied.redirectURI}?error=access_denied&state=state`); await assert.rejects(denied.completed, /取消/); } finally { denied.close(); }
});

test('OAuth PKCE login, credential binding, serialized refresh, and revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appisle-auth-'));
  const env = { APPISLE_CONFIG_DIR: root }, base = 'http://console.localhost:18080';
  let authorize, tokenCalls = 0, refreshCalls = 0, revoked = false;
  const emitted = [];
  const request = async (url, options = {}) => {
    assert.ok(url.startsWith(base + '/'));
    if (url.endsWith('/.well-known/oauth-authorization-server')) return response({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke` });
    if (url.endsWith('/oauth/register')) { const inValue = JSON.parse(options.body); assert.equal(inValue.token_endpoint_auth_method, 'none'); assert.deepEqual(inValue.grant_types, ['authorization_code', 'refresh_token']); return response({ client_id: 'client-test' }, 201); }
    if (url.endsWith('/oauth/token')) {
      tokenCalls++;
      const form = new URLSearchParams(options.body);
      assert.equal(form.get('resource'), `${base}/mcp`);
      if (form.get('grant_type') === 'authorization_code') {
        assert.equal(form.get('code'), 'private-code');
        assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), authorize.searchParams.get('code_challenge'));
      } else { refreshCalls++; assert.equal(form.get('refresh_token'), 'private-refresh-1'); }
      return response({ token_type: 'Bearer', access_token: `private-access-${tokenCalls}`, refresh_token: `private-refresh-${tokenCalls}`, scope: 'appisle:manage', expires_in: 3600 });
    }
    if (url.endsWith('/oauth/revoke')) { assert.equal(new URLSearchParams(options.body).get('token'), 'private-refresh-2'); revoked = true; return response({}); }
    throw new Error('Unexpected endpoint');
  };
  try {
    const pending = login(base, { request, env, noBrowser: true, emit: value => { emitted.push(value); authorize = new URL(value.authorization_url); } });
    while (!authorize) await new Promise(done => setImmediate(done));
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ code: 'private-code', state: authorize.searchParams.get('state') });
    const returned = await fetch(callback, { redirect: 'manual' });
    assert.equal(returned.status, 303);
    assert.equal(returned.headers.get('location'), base + '/start?connected_client=client-test#setup-step-3');
    assert.equal(returned.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(!returned.headers.get('location').includes('private-code'));
    const result = await pending;
    assert.equal(result.authenticated, true);
    assert.ok(!JSON.stringify([emitted, result]).includes('private-'));
    const stored = await readCredential(base, env);
    assert.equal(stored.access_token, 'private-access-1');
    assert.equal(await readCredential('https://other.example', env), null);
    await writeFile(credentialPath(base, env), JSON.stringify({ ...stored, expires_at: 0 }));
    const both = await Promise.all([accessToken(base, request, env), accessToken(base, request, env)]);
    assert.equal(refreshCalls, 1); assert.ok(both.every(value => value.token === 'private-access-2'));
    const out = await logout(base, request, env);
    assert.equal(out.revoked, true); assert.equal(revoked, true); assert.equal(await readCredential(base, env), null);
    await writeFile(credentialPath(base, env), JSON.stringify({ ...stored, platform_url: 'https://other.example' }));
    await assert.rejects(readCredential(base, env), /绑定/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('OAuth metadata cannot send credentials to a foreign endpoint', async () => {
  const base = 'http://127.0.0.1:12345';
  let requests = 0;
  await assert.rejects(login(base, { noBrowser: true, request: async () => { requests++; return response({ issuer: base, authorization_endpoint: 'https://other.example/authorize' }); } }), /跨平台/);
  assert.equal(requests, 1);
});

test('failed token exchange never redirects the browser to onboarding success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appisle-auth-failure-'));
  const base = 'https://appisle.example'; let authorize;
  const request = async url => {
    if (url.endsWith('/.well-known/oauth-authorization-server')) return response({issuer:base,authorization_endpoint:base+'/oauth/authorize',token_endpoint:base+'/oauth/token',registration_endpoint:base+'/oauth/register',revocation_endpoint:base+'/oauth/revoke'});
    if (url.endsWith('/oauth/register')) return response({client_id:'client-failed'});
    return response({error:'invalid_grant'},400);
  };
  const pending = login(base,{request,env:{APPISLE_CONFIG_DIR:root},noBrowser:true,emit:value=>{authorize=new URL(value.authorization_url);}});
  pending.catch(()=>{});
  try {
    while(!authorize) await new Promise(done=>setImmediate(done));
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({code:'rejected-code',state:authorize.searchParams.get('state')});
    const result = await fetch(callback,{redirect:'manual'});
    assert.equal(result.status,400);assert.equal(result.headers.get('location'),null);
    await assert.rejects(pending);assert.equal(await readCredential(base,{APPISLE_CONFIG_DIR:root}),null);
  } finally { await rm(root,{recursive:true,force:true}); }
});

async function runCLI(args, cwd, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, APPISLE_TOKEN: '', APPISLE_TOKEN_FILE: '', ...env }, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject); child.once('exit', code => resolveRun({ code, stdout, stderr }));
  });
}

test('CLI mapping rejects a platform switch and repeated create before any HTTP write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appisle-project-'));
  try {
    await mkdir(join(root, '.appisle'));
    await writeFile(join(root, '.appisle/project.json'), JSON.stringify({ app_uid: 'aid-1234567890abcdef', platform_url: 'https://first.example' }));
    const mismatch = await runCLI(['deploy', '--url', 'https://second.example', '--dsl', 'missing.json'], root);
    assert.equal(mismatch.code, 1); assert.match(mismatch.stderr, /另一个平台/);
    const duplicate = await runCLI(['create', '--url', 'https://first.example'], root);
    assert.equal(duplicate.code, 1); assert.match(duplicate.stderr, /已关联/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI talks MCP over HTTP and reports only its exact deployment UID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appisle-mcp-'));
  let requests = [], latest = 'dep-requested', outage = false;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks)); requests.push(value);
    assert.equal(req.url, '/mcp'); assert.equal(req.headers.authorization, 'Bearer hidden-api-token');
    if (outage && value.params?.name === 'deployment_status') { outage = false; res.writeHead(502); res.end('gateway restarting'); return; }
    let out;
    if (value.method === 'initialize') out = { protocolVersion: '2025-06-18' };
    else {
      let result;
      if (value.params.name === 'deploy_app') result = { uid: 'dep-requested', status: 'queued' };
      else result = { application: { uid: 'aid-1234567890', status: 'running' }, deployment: { uid: latest, status: 'succeeded' } };
      out = { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: out }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await writeFile(join(root, 'appisle.dsl.json'), JSON.stringify({ version: 1, type: 'container_group' }));
    const args = ['deploy', '--url', base, '--app', 'aid-1234567890', '--dsl', 'appisle.dsl.json'];
    const tokenEnv = { APPISLE_TOKEN: 'hidden-api-token', APPISLE_URL: base };
    const ok = await runCLI(args, root, tokenEnv);
    assert.equal(ok.code, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).deployment.uid, 'dep-requested');
    assert.ok(!`${ok.stdout}${ok.stderr}`.includes('hidden-api-token'));
    outage = true; requests = [];
    const recovered = await runCLI(args, root, tokenEnv);
    assert.equal(recovered.code, 0, recovered.stderr);
    assert.equal(requests.filter(v => v.params?.name === 'deploy_app').length, 1, 'transport retry duplicated the deployment');
    assert.equal(requests.filter(v => v.params?.name === 'deployment_status').length, 2);
    latest = 'dep-another'; requests = [];
    const changed = await runCLI(args, root, tokenEnv);
    assert.equal(changed.code, 1); assert.match(changed.stderr, /出现更新的部署/); assert.ok(!changed.stdout.includes('succeeded'));
    assert.deepEqual(requests.map(v => v.method === 'initialize' ? 'initialize' : v.params.name), ['initialize', 'app_status', 'deploy_app', 'deployment_status']);
  } finally { server.close(); server.closeAllConnections(); await rm(root, { recursive: true, force: true }); }
});
