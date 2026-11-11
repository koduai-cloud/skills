import { readFile, writeFile, mkdir, lstat, rename, unlink, open, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const SCOPE = 'appisle:manage';

export function platformOrigin(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('平台 URL 不正确'); }
  const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || u.hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname);
  if (!['https:', 'http:'].includes(u.protocol) || (u.protocol === 'http:' && !local) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('平台地址必须是 HTTPS origin；HTTP 仅支持本机地址');
  return u.origin;
}

export function configDirectory(env = process.env) {
  return join(env.APPISLE_CONFIG_DIR || (process.platform === 'win32' ? join(env.LOCALAPPDATA || homedir(), 'AppIsle') : join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'appisle')), 'credentials');
}

export function credentialPath(base, env = process.env) {
  return join(configDirectory(env), `${createHash('sha256').update(platformOrigin(base)).digest('hex')}.json`);
}

export async function secureDirectory(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('凭证目录不能是符号链接');
  if (process.platform === 'win32') {
    const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { windowsHide: true });
    const sid = stdout.trim();
    if (!/^S-1-\d+(?:-\d+)+$/.test(sid)) throw new Error('无法确认本机用户身份');
    await runFile('icacls.exe', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
  } else await chmod(dir, 0o700);
}

export async function readCredential(base, env = process.env) {
  const path = credentialPath(base, env);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('凭证文件不是普通文件');
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.platform_url !== platformOrigin(base) || data.resource !== `${base}/mcp`) throw new Error('凭证的平台绑定不匹配，请重新 login');
    return data;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeCredential(base, data, env) {
  const dir = configDirectory(env), path = credentialPath(base, env);
  await secureDirectory(dir);
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(data) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

export async function selectedPlatform(env = process.env) {
  try { return platformOrigin(JSON.parse(await readFile(join(configDirectory(env), 'active.json'), 'utf8')).platform_url); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function lockCredential(base, env, action) {
  await secureDirectory(configDirectory(env));
  const path = `${credentialPath(base, env)}.lock`, deadline = Date.now() + 15000;
  let handle;
  while (!handle) {
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await lstat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 5 * 60 * 1000) { await unlink(path).catch(() => {}); continue; }
      if (Date.now() > deadline) throw new Error('其他命令正在更新授权，请稍后重试');
      await wait(100);
    }
  }
  try { return await action(); } finally { await handle.close(); await unlink(path).catch(() => {}); }
}

function endpoint(base, metadata, name) {
  const value = metadata[name];
  let u;
  try { u = new URL(value); } catch { throw new Error('平台 OAuth 元数据不完整'); }
  if (u.origin !== base || u.username || u.password || u.hash) throw new Error('拒绝跨平台 OAuth 端点');
  return u.href;
}

function oauthError(response, context) {
  // Responses may echo request fields. Never relay their descriptions/tokens.
  const code = /^[a-z_]{1,64}$/.test(response.value?.error) ? response.value.error : `HTTP ${response.status}`;
  return new Error(`${context}失败 (${code})，请重新 login`);
}

async function tokenRequest(request, url, form) {
  const response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  if (!response.ok) throw oauthError(response, '授权');
  const value = response.value;
  if (typeof value.access_token !== 'string' || !value.access_token || value.token_type?.toLowerCase() !== 'bearer' || !(value.expires_in > 0) || value.scope !== SCOPE || typeof value.refresh_token !== 'string') throw new Error('平台返回的授权格式不正确');
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: Date.now() + value.expires_in * 1000 };
}

export function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(32).toString('base64url') };
}

function sameSecret(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function loopbackCallback(state, timeout = 300000, platform) {
  const returnOrigin = platform ? platformOrigin(platform) : '';
  let accept, reject, timer, browserResponse, used = false;
  const completed = new Promise((res, rej) => { accept = res; reject = rej; });
  // Install a rejection handler immediately while discovery/registration runs.
  completed.catch(() => {});
  const path = `/callback/${randomBytes(16).toString('hex')}`;
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (req.method !== 'GET' || u.pathname !== path || req.headers.host !== `127.0.0.1:${server.address().port}` || used) { res.writeHead(404); res.end('Not found'); return; }
    if ([...u.searchParams.keys()].some(key => u.searchParams.getAll(key).length > 1) || !sameSecret(state, u.searchParams.get('state'))) { res.writeHead(400); res.end('Invalid authorization state'); return; }
    if (u.searchParams.has('error')) { used = true; res.writeHead(400); res.end('授权已取消，可关闭此页面。'); reject(new Error('用户取消授权')); return; }
    const code = u.searchParams.get('code');
    if (!code || code.length > 2048) { res.writeHead(400); res.end('Missing authorization code'); return; }
    used = true; clearTimeout(timer);
    if (returnOrigin) browserResponse = res;
    else res.end('授权回调已收到，请返回 AI 工具查看结果。');
    accept(code);
  });
  await new Promise((resolve, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', resolve); });
  timer = setTimeout(() => reject(new Error('等待浏览器授权超时，请重新 login')), timeout);
  return {
    redirectURI: `http://127.0.0.1:${server.address().port}${path}`, completed,
    async finish(clientID) {
      if (!browserResponse || browserResponse.destroyed) return;
      const response = browserResponse; browserResponse = undefined;
      if (clientID) {
        const target = new URL('/start', returnOrigin);
        target.searchParams.set('connected_client', clientID);
        target.hash = 'setup-step-3';
        response.writeHead(303, { Location: target.href });
      } else response.writeHead(400);
      await new Promise(resolve => {
        response.once('close', resolve);
        response.end(clientID ? '授权完成，正在返回口袋空间。' : '连接未完成，请返回 AI 客户端重试。', resolve);
      });
    },
    close() { clearTimeout(timer); server.close(); server.closeAllConnections(); },
  };
}

function openBrowser(url) {
  // URL never enters shell source. PowerShell receives it through an environment
  // variable, while macOS/Linux receive one exec argument with shell disabled.
  let child;
  if (process.platform === 'win32') child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:APPISLE_BROWSER_URL -WindowStyle Hidden'], { env: { ...process.env, APPISLE_BROWSER_URL: url }, windowsHide: true, stdio: 'ignore' });
  else child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true, shell: false });
  child.on('error', () => {}); child.unref();
}

export async function login(base, { request, env = process.env, noBrowser = false, timeout = 300000, emit = value => console.log(JSON.stringify(value)) } = {}) {
  base = platformOrigin(base);
  if (!(timeout > 0 && timeout <= 900000)) throw new Error('timeout 应为 1–900000 毫秒');
  const secrets = pkce(), callback = await loopbackCallback(secrets.state, timeout, base);
  try {
    const discovery = await request(`${base}/.well-known/oauth-authorization-server`);
    if (!discovery.ok || discovery.value?.issuer !== base) throw new Error('平台 OAuth issuer 不匹配');
    const metadata = discovery.value;
    const authorization = endpoint(base, metadata, 'authorization_endpoint'), tokenEndpoint = endpoint(base, metadata, 'token_endpoint');
    const registration = endpoint(base, metadata, 'registration_endpoint'), revokeEndpoint = endpoint(base, metadata, 'revocation_endpoint');
    // The console recognises the skill's grant by this exact name and shows it in the reader's language; keep it as is.
    const registered = await request(registration, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'AppIsle Deploy Skill', redirect_uris: [callback.redirectURI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE }) });
    if (!registered.ok || typeof registered.value.client_id !== 'string') throw oauthError(registered, '客户端注册');
    const clientID = registered.value.client_id, authorizationURL = new URL(authorization);
    const params = { client_id: clientID, redirect_uri: callback.redirectURI, response_type: 'code', scope: SCOPE, state: secrets.state, code_challenge: secrets.challenge, code_challenge_method: 'S256', resource: `${base}/mcp` };
    for (const [key, value] of Object.entries(params)) authorizationURL.searchParams.set(key, value);
    emit({ authorization_url: authorizationURL.href, expires_in_seconds: Math.ceil(timeout / 1000) });
    if (!noBrowser) openBrowser(authorizationURL.href);
    const code = await callback.completed;
    const tokens = await tokenRequest(request, tokenEndpoint, { grant_type: 'authorization_code', client_id: clientID, redirect_uri: callback.redirectURI, code_verifier: secrets.verifier, code, resource: `${base}/mcp` });
    await lockCredential(base, env, () => writeCredential(base, { platform_url: base, resource: `${base}/mcp`, client_id: clientID, token_endpoint: tokenEndpoint, revocation_endpoint: revokeEndpoint, ...tokens }, env));
    await writeFile(join(configDirectory(env), 'active.json'), JSON.stringify({ platform_url: base }) + '\n', { mode: 0o600 });
    // Only return to the ready step after token exchange and durable local save.
    // The console independently verifies this client has an active grant.
    await callback.finish(clientID);
    return { authenticated: true, platform_url: base, expires_at: new Date(tokens.expires_at).toISOString() };
  } catch (error) { await callback.finish(); throw error; }
  finally { callback.close(); }
}

// An API token is only sent to the platform named by APPISLE_URL, never to an
// origin taken from a project's .appisle/project.json or a --url argument.
export function apiTokenConfigured(base, env = process.env) {
  if (!env.APPISLE_TOKEN && !env.APPISLE_TOKEN_FILE) return false;
  try { return !!env.APPISLE_URL && platformOrigin(env.APPISLE_URL) === platformOrigin(base); } catch { return false; }
}

export async function accessToken(base, request, env = process.env, forceRefresh = false) {
  if (apiTokenConfigured(base, env)) {
    const direct = env.APPISLE_TOKEN || (await readFile(env.APPISLE_TOKEN_FILE, 'utf8')).trim();
    if (direct) return { token: direct, source: 'api_token' };
  }
  let credential = await readCredential(base, env);
  if (!credential) throw new Error(env.APPISLE_TOKEN || env.APPISLE_TOKEN_FILE ? 'APPISLE_TOKEN 只用于 APPISLE_URL 指定的平台；请将 APPISLE_URL 设为当前平台，或运行 login' : '尚未授权，请运行 login');
  if (forceRefresh || credential.expires_at < Date.now() + 30000) {
    const previousToken = credential.access_token;
    credential = await lockCredential(base, env, async () => {
      const current = await readCredential(base, env);
      if (!current) throw new Error('授权已退出，请重新 login');
      if (current.expires_at > Date.now() + 30000 && (!forceRefresh || current.access_token !== previousToken)) return current;
      const tokens = await tokenRequest(request, endpoint(base, current, 'token_endpoint'), { grant_type: 'refresh_token', client_id: current.client_id, refresh_token: current.refresh_token, resource: `${base}/mcp` });
      const updated = { ...current, ...tokens };
      await writeCredential(base, updated, env);
      return updated;
    });
  }
  return { token: credential.access_token, source: 'oauth' };
}

export async function logout(base, request, env = process.env) {
  let revoked = false;
  await lockCredential(base, env, async () => {
    const credential = await readCredential(base, env);
    if (credential) {
      const response = await request(endpoint(base, credential, 'revocation_endpoint'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: credential.client_id, token: credential.refresh_token || credential.access_token }).toString() });
      if (!response.ok) throw oauthError(response, '撤销授权');
      await unlink(credentialPath(base, env)); revoked = true;
    }
  });
  return { authenticated: false, platform_url: base, revoked, ...(apiTokenConfigured(base, env) ? { note: '环境变量中的 API Token 仍由你管理；请从管理端撤销并清除环境变量' } : {}) };
}
