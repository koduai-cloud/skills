#!/usr/bin/env node
import {ticketCommands,runTicketCommand} from './tickets.mjs';
import {validateTelemetry,reportFailure} from './telemetry.mjs';
import { readFile, writeFile, mkdir, readdir, lstat, stat } from 'node:fs/promises';
import { resolve, relative, dirname, basename, join, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { platformOrigin, selectedPlatform, readCredential, accessToken, apiTokenConfigured, login, logout } from './auth.mjs';
import { databaseCommands, runDatabaseCommand } from './databases.mjs';
import { managementCommands, managementAppCommands, runManagementCommand } from './management.mjs';
import { updateSkill } from './update.mjs';
import { publisher } from './publisher.mjs';
import { projectDirectory } from './project.mjs';

// Same limits the platform applies to an uploaded package.
const MAX_ZIP = 32 * 1024 * 1024, MAX_EXPANDED = 128 * 1024 * 1024;
async function requestJSON(url, options = {}) {
  const u = new URL(url), request = new Request(url, options);
  const body = options.body === undefined ? undefined : Buffer.from(await request.arrayBuffer());
  const headers = Object.fromEntries(request.headers);
  headers.host = u.host;
  if (body) headers['content-length'] = String(body.length);
  const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost');
  return new Promise((resolveRequest, rejectRequest) => {
    const transport = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = transport({ protocol: u.protocol, hostname: local ? '127.0.0.1' : u.hostname.replace(/^\[|\]$/g, ''), servername: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: options.method, headers, signal: options.signal || AbortSignal.timeout(60000) }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) { req.destroy(new Error('平台响应超过限制')); return; } chunks.push(chunk); });
      response.on('error', rejectRequest);
      response.on('end', () => {
        let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { rejectRequest(new Error(`平台返回 HTTP ${response.statusCode}`)); return; }
        resolveRequest({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300, value });
      });
    });
    // Never follow redirects: authorization headers and token bodies stay on
    // the origin explicitly selected by the user.
    req.on('error', error => rejectRequest(new Error(error.name === 'AbortError' ? '平台请求超时，请检查网络；写入类操作先用 status 核对结果，不要直接重复提交' : error.message === '平台响应超过限制' ? error.message : '无法连接平台，请检查网络和平台地址'))); req.end(body);
  });
}
export function parseArgs(args) {
  const [rawCommand = 'help', ...tail] = args;
  const rest = [...tail];
  let command = ['--help', '-h'].includes(rawCommand) ? 'help' : rawCommand;
  if (command === 'auth') { if (rest.shift() !== 'status') throw new Error('用法: auth status'); command = 'auth-status'; }
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) throw new Error(`未知参数 ${rest[i]}`);
    const key = rest[i].slice(2);
    options[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
  return { command, options };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Dependency-free deterministic ZIP: entries are deflated when that makes them
// smaller. All file content must already be built locally; packaging never
// evaluates application code.
const secretNames = ['.git', '.hg', '.svn', '.appisle', '.local', '.ssh', '.aws', '.azure', '.kube', '.docker', '.npmrc', '.pypirc', '.netrc', '.dockercfg', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'];
const envTemplates = ['.env.example', '.env.sample', '.env.template'];
async function credentialFile(full, lower) {
  if (/\.(key|p12|pfx|kubeconfig)$/.test(lower)) return true;
  if (lower === '.env' || (lower.startsWith('.env.') && !envTemplates.includes(lower))) return true;
  // Certificate bundles such as certifi/cacert.pem are public; only private keys are refused.
  if (lower.endsWith('.pem')) return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(await readFile(full, 'latin1'));
  return false;
}

export async function packDirectory(directory, output) {
  const root = resolve(directory), out = resolve(output);
  if (!out.toLowerCase().endsWith('.zip')) throw new Error('输出文件必须使用 .zip 扩展名');
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('打包目录必须是普通目录');
  const files = [];
  let expanded = 0;
  async function walk(dir) {
    for (const entry of (await readdir(dir)).sort()) {
      const full = join(dir, entry);
      if (full === out) continue;
      const info = await lstat(full);
      // npm links command shims here; the runtime starts programs directly.
      if (info.isSymbolicLink() && basename(dir) === '.bin' && basename(dirname(dir)) === 'node_modules') continue;
      if (info.isSymbolicLink()) throw new Error(`部署包不允许符号链接: ${relative(root, full)}`);
      const lower = entry.toLowerCase();
      if (secretNames.includes(lower) || (info.isFile() && await credentialFile(full, lower))) {
        throw new Error(`拒绝打包凭证或开发目录: ${relative(root, full)}；请仅选择构建产物目录并移除此文件`);
      }
      if (info.isDirectory()) await walk(full);
      else if (info.isFile()) {
        files.push({ full, size: info.size, mode: info.mode & 0o111 ? 0o100755 : 0o100644 });
        expanded += info.size;
        if (files.length > 2000) throw new Error('部署包最多 2000 个文件');
        if (expanded > MAX_EXPANDED) throw new Error('部署内容解压后超过 128 MiB');
      } else throw new Error(`不支持的文件类型: ${relative(root, full)}`);
    }
  }
  await walk(root);
  if (!files.length) throw new Error('部署目录为空');
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(relative(root, file.full).replaceAll('\\', '/'));
    if (name.length > 65535) throw new Error('文件名过长');
    const data = await readFile(file.full), crc = crc32(data), deflated = deflateRawSync(data);
    const method = deflated.length < data.length ? 8 : 0, stored = method ? deflated : data;
    if (offset + stored.length > MAX_ZIP) throw new Error('部署包压缩后超过 32 MiB');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(stored.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE((file.mode << 16) >>> 0, 38);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(stored.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    localParts.push(header, name, stored); centralParts.push(central, name); offset += header.length + name.length + stored.length;
  }
  const centralSize = centralParts.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...localParts, ...centralParts, end]);
  if (zip.length > MAX_ZIP) throw new Error('部署包压缩后超过 32 MiB');
  await mkdir(dirname(out), { recursive: true }); await writeFile(out, zip);
  return { artifact: out, files: files.length, bytes: zip.length, expanded_bytes: expanded };
}

const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));

export async function readProject(cwd = process.cwd()) {
  try {
    const p = JSON.parse(await readFile(join(cwd, '.appisle', 'project.json'), 'utf8'));
    if (!/^aid-(?:[a-z0-9]{10}|[a-z0-9]{16})$/.test(p.app_uid) || !p.platform_url) throw new Error('应用关联文件不正确');
    p.platform_url = platformOrigin(p.platform_url);
    return p;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function createMCPClient(base, request = requestJSON, env = process.env) {
  let sequence = 0, existingToken;
  const rpc = async (method, params, signal, timeout = 60000) => {
    // Automatic telemetry reuses the already obtained credential. It must never
    // acquire the OAuth file lock, refresh credentials or start a login flow.
    const automatic = !!signal;
    if (automatic && (!existingToken || method!=='tools/call' || !['telemetry_status','report_telemetry'].includes(params.name))) throw new Error('telemetry unavailable');
    let auth = automatic ? {token:existingToken} : await accessToken(base, request, env);
    existingToken=auth.token;
    let requestID;
    const invoke = () => request(`${base}/mcp`, { method: 'POST', signal: signal || AbortSignal.timeout(timeout), headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestID=++sequence, method, params }) });
    let response = await invoke();
    if (response.status === 401 && !automatic && auth.source === 'oauth') { auth = await accessToken(base, request, env, true); existingToken=auth.token; response = await invoke(); }
    if (!response.ok) throw Object.assign(new Error(response.status === 401 ? '授权无效，请重新 login' : `平台返回 HTTP ${response.status}`),{status:response.status});
    if (response.value.error) throw new Error(`MCP 请求失败 (${response.value.error.code})`);
    if (response.value.jsonrpc !== '2.0' || response.value.id !== requestID || !('result' in response.value)) throw new Error('平台 MCP 响应不正确');
    return response.value.result;
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'koudai-run-skill', version: '0.1.0' } });
  const rawCall = async (name, args = {}, signal, timeout) => {
    if (name === 'report_telemetry') args = validateTelemetry(args);
    const value = await rpc('tools/call', { name, arguments: args }, signal, timeout);
    const text = value.content?.find(c => c.type === 'text')?.text;
    let out; try { out = JSON.parse(text); } catch { throw new Error('平台工具响应不正确'); }
    if (value.isError) throw Object.assign(new Error(out.error || '平台工具调用失败'),{status:out.status || 500});
    return out;
  };
  const call = async (name,args={},{timeout}={}) => { try {return await rawCall(name,args,undefined,timeout)} catch(error) {await reportFailure(rawCall,name,error.status??0);throw error} };
  call.listTools = async () => (await rpc('tools/list', {})).tools;
  return call;
}

export const commands = ['help', 'update', 'pack', 'login', 'logout', 'auth', 'auth-status', 'spaces', 'apps', 'create', 'link', 'upload', 'deploy', 'status', 'logs', 'start', 'stop', 'delete', 'telemetry-status', 'telemetry-report', ...databaseCommands, ...managementCommands, ...ticketCommands];

export async function main(args = process.argv.slice(2)) {
  const { command, options: o } = parseArgs(args);
  if (command === 'help') {
    console.log(`应用/空间管理：tools [--tool 工具名] 查看当前平台参数；call --tool 工具名 --input 参数.json [--no-wait]\nquota | space-info --space ns-...\napp-update [--app aid-...] [--name 名称] [--description 描述]\napp-env [--app aid-...] [--out .appisle/private/env.json]（默认只显示名称）\nspace-env --space ns-... [--out .appisle/private/env.json]\napp-env-set [--app aid-...] --file 完整变量.json [--no-wait]\nspace-env-set --space ns-... --file 完整变量.json [--no-wait]\napp-databases [--app aid-...] --file 绑定数组.json [--deploy] [--no-wait]\ncertificate-create --space ns-... --name 名称 --certificate-file chain.pem --key-file key.pem\nredis-get --database db-... --key 完整键名\nredis-set --database db-... --key 完整键名 --file 文本文件 [--ttl 秒数]\njob --deployment dep-...\n全部管理能力见 references/management.md；敏感读取只输出私密文件路径。`);
    console.log('工单：ticket-create --title 标题 --content-file 问题说明.txt [--category deployment] [--priority normal]；tickets 查询；ticket --ticket tkt-... 查看。');
    console.log('用户体验改善计划：telemetry-status 查看授权和设置入口；telemetry-report --file 分类.json。首次授权只能由用户在网页设置中选择。');
    console.log('Skill 更新：npx skills check；npx skills update koudai-run。update [--check] 只显示更新方式，不下载或替换安装文件。');
    console.log(`数据库管理：
databases | database-types --space ns-...
database-create --space ns-... --name 名称 --engine mysql-80|pgsql-18|redis-7
database-info | database-schema | database-retry --database db-xxxxxxxx
database-query | database-execute --database db-xxxxxxxx --file SQL文件
database-credentials --database db-xxxxxxxx（仅写入私密文件）
database-password --database db-xxxxxxxx --password-file 私密文件
database-export --database db-xxxxxxxx --out 导出文件
database-delete --database db-xxxxxxxx --confirm db-xxxxxxxx
`);
    console.log(`口袋空间部署 Skill (Node.js 24+)\n\nlogin [--url 平台地址] [--no-browser] [--timeout 300000]\nauth status [--url 平台地址]\nlogout [--url 平台地址]\nspaces\napps [--space ns-...]\ncreate --space ns-... --name 工具 --type static|workerd|container_group\nlink --app aid-...\npack --dir dist --out app.zip\nupload [--app aid-...] --artifact app.zip\ndeploy [--app aid-...] --dsl appisle.dsl.json [--artifact app.zip] [--no-wait]\nstatus [--app aid-...]\nlogs [--app aid-...]\nstart|stop [--app aid-...] [--no-wait]\ndelete [--app aid-...] --confirm aid-...\n\n在应用项目目录运行。首次 login 在浏览器注册/登录并授权。\n授权保存在本机用户配置目录；APPISLE_CONFIG_DIR 可隔离配置。\ncreate/link 保存 .appisle/project.json，更新时复用应用 UID；.appisle 自动加入 Git 忽略。\n平台地址可用 --url 或 APPISLE_URL 指定，默认连接 https://koudai.run，仅本机允许 HTTP。\n兼容 APPISLE_TOKEN 或 APPISLE_TOKEN_FILE，仅发送给 APPISLE_URL 指定的平台，凭证不会输出。`);
    return;
  }
  if (!commands.includes(command) || command === 'auth') throw new Error(`未知命令 ${command}`);
  if (o.timeout !== undefined && !(Number(o.timeout) > 0 && Number(o.timeout) <= 1800000)) throw new Error('timeout 应为 1–1800000 毫秒');
  // The installer owns GitHub skill updates. Do not read project mappings or
  // credentials, or contact service-hosted skill endpoints for this command.
  if (command === 'update') { console.log(JSON.stringify(await updateSkill({ source: o.url, checkOnly: !!o.check }), null, 2)); return; }
  const project = await readProject().catch(error => { if (command === 'pack') return null; throw error; });
  const base = platformOrigin(o.url || process.env.APPISLE_URL || project?.platform_url || await selectedPlatform().catch(() => undefined) || publisher);
  if (command === 'pack') {
    const out = resolve(required(o, 'out'));
    if (out.startsWith(resolve('.appisle') + sep)) await projectDirectory();
    console.log(JSON.stringify(await packDirectory(required(o, 'dir'), out), null, 2)); return;
  }
  const appCommands = ['create', 'link', 'upload', 'deploy', 'status', 'logs', 'start', 'stop', 'delete', 'call', ...managementAppCommands];
  if (project && appCommands.includes(command) && project.platform_url !== base) throw new Error('当前目录属于另一个平台，请切换到对应项目目录，不会跨平台复用应用 UID');
  if (['create', 'link'].includes(command) && project) throw new Error(`此目录已关联 ${project.app_uid}，请直接 deploy；新应用请使用新目录`);
  // A cloned repository must not be able to start an authorization flow
  // against an origin the user never chose.
  if (command === 'login' && !o.url && !process.env.APPISLE_URL && project && base !== publisher && !(await readCredential(base))) {
    throw new Error(`此目录的 .appisle/project.json 指向 ${base}，不是本 Skill 的默认平台。确认可信后使用 login --url ${base}`);
  }
  if (command === 'login') { console.log(JSON.stringify(await login(base, { request: requestJSON, noBrowser: !!o['no-browser'], timeout: Number(o.timeout || 300000) }), null, 2)); return; }
  if (command === 'logout') { console.log(JSON.stringify(await logout(base, requestJSON), null, 2)); return; }
  if (command === 'auth-status') {
    const credential = await readCredential(base);
    const external = apiTokenConfigured(base);
    if (!credential && !external) { console.log(JSON.stringify({ authenticated: false, platform_url: base }, null, 2)); return; }
    const call = await createMCPClient(base), spaces = await call('list_spaces');
    console.log(JSON.stringify({ authenticated: true, platform_url: base, source: external ? 'api_token' : 'oauth', spaces: spaces.length }, null, 2)); return;
  }
  const call = await createMCPClient(base);
  if(ticketCommands.includes(command)){console.log(JSON.stringify(await runTicketCommand(command,o,{call}),null,2));return;}
  if (command === 'telemetry-status') {console.log(JSON.stringify(await call('telemetry_status'),null,2));return}
  if (command === 'telemetry-report') {
    if (!o.file || o.file===true) throw new Error('请用 --file 指定只包含固定分类的 JSON 文件');
    const raw=await readFile(String(o.file),'utf8');if(Buffer.byteLength(raw)>2048)throw new Error('遥测文件不能超过 2 KiB');
    const input=validateTelemetry(JSON.parse(raw));
    console.log(JSON.stringify(await call('report_telemetry',input),null,2));return;
  }
  if (databaseCommands.includes(command)) { console.log(JSON.stringify(await runDatabaseCommand(command,o,{call,base,request:requestJSON}),null,2));return; }
  const appID = () => {
    const uid = o.app || project?.app_uid;
    if (typeof uid !== 'string' || !/^aid-(?:[a-z0-9]{10}|[a-z0-9]{16})$/.test(uid)) throw new Error('请指定正确 --app 或先创建/关联应用');
    return uid;
  };
  const upload = async (app, path) => {
    const { size } = await stat(path);
    if (size > MAX_ZIP) throw new Error('部署包超过 32 MiB');
    // Allow slow uplinks about 256 KiB/s for the Base64 body on top of a minute.
    return call('upload_artifact', { app_uid: app, filename: basename(path), data_base64: (await readFile(path)).toString('base64') }, { timeout: 60000 + Math.ceil(size * 4 / 3 / (256 * 1024)) * 1000 });
  };
  const associate = async application => {
    await projectDirectory();
    // Exclusive creation prevents two CLI processes silently replacing a mapping.
    await writeFile('.appisle/project.json', JSON.stringify({ app_uid: application.uid, platform_url: base, namespace_uid: application.namespace_uid }, null, 2) + '\n', { flag: 'wx' });
  };
  const waitForJob = async (uid, job) => {
    if (o['no-wait']) return job;
    const timeout = Number(o.timeout || 540000);
    if (!(timeout > 0 && timeout <= 1800000)) throw new Error('timeout 应为 1–1800000 毫秒');
    const deadline = Date.now() + timeout;
    // Print the UID first: a client may kill a long command before it returns.
    console.error(`已提交任务 ${job.uid}，等待完成；如命令被中断，用 job --deployment ${job.uid} 查询，不要重复提交`);
    while (Date.now() < deadline) {
      let state;
      try { state = await call('deployment_status', { uid: job.uid }); }
      catch (error) {
        // Polling a known job is read-only. Never re-submit a deployment after
        // a transport error: the original write may already have succeeded.
        if (/平台返回 HTTP (502|503|504)|无法连接平台|平台请求超时/.test(error.message || '')) { await wait(1500); continue; }
        throw error;
      }
      const current = state.deployment;
      if (current?.uid === job.uid) {
        if (current.status === 'succeeded') return { deployment: current, application: state.application };
        if (['failed', 'cancelled'].includes(current.status)) throw new Error(`任务 ${job.uid} ${current.status === 'cancelled' ? '已取消' : '失败'}：${current.error || current.logs || '请用 logs 查看原因'}`);
      } else if (current?.uid) throw new Error(`出现更新的部署，当前任务 ${job.uid} 的结果需在管理端部署记录中确认`);
      await wait(1500);
    }
    throw new Error(`等待超时，任务 ${job.uid} 仍在平台执行；使用 status 查询`);
  };
  if (managementCommands.includes(command)) {
    console.log(JSON.stringify(await runManagementCommand(command, o, { call, appID, waitForJob: job => waitForJob(undefined, job) }), null, 2));
    return;
  }
  let result;
  switch (command) {
    case 'spaces': result = await call('list_spaces'); break;
    case 'apps': result = await call('list_apps', o.space ? { namespace_uid: String(o.space) } : {}); break;
    case 'create': {
      result = await call('create_app', { namespace_uid: required(o, 'space'), name: required(o, 'name'), description: o.description || '', type: required(o, 'type') });
      try { await associate(result); } catch { throw new Error(`应用已创建 (${result.uid})，本地关联保存失败；请记录 UID 并使用 --app，不要重复 create`); }
      break;
    }
    case 'link': {
      const state = await call('app_status', { uid: appID() });
      if (!state.application.can_manage) throw new Error('当前账号没有此应用的管理权限');
      await associate(state.application); result = state.application; break;
    }
    case 'upload': result = await upload(appID(), required(o, 'artifact')); break;
    case 'deploy': {
      const uid = appID(), dsl = JSON.parse(await readFile(required(o, 'dsl'), 'utf8'));
      const first = !(await call('app_status', { uid })).application?.active_deployment_uid;
      const artifact = o.artifact ? await upload(uid, o.artifact) : null;
      const job = await call('deploy_app', { uid, dsl, ...(artifact ? { artifact_uid: artifact.uid } : {}) });
      result = await waitForJob(uid, job);
      if (result.deployment?.status === 'succeeded') {
        // Report what the server says now, not what the DSL or plan implies.
        const { application: app = {} } = await call('app_status', { uid });
        result.summary = { url: app.url, first_deployment: first, ...(first ? { console_url: `${base}/apps/${uid}` } : {}), access: app.access_options?.system_mode || app.system_visibility || app.visibility, blocked: !!app.blocked };
      }
      break;
    }
    case 'status': result = await call('app_status', { uid: appID() }); break;
    case 'logs': result = await call('app_logs', { uid: appID() }); break;
    case 'delete': { const uid = appID(); if (o.confirm !== uid) throw new Error('删除会停止应用并移入回收状态，数据保留，可由管理员恢复；请用 --confirm ' + uid + ' 明确目标'); const job = await call('delete_app', { uid }); result = await waitForJob(uid, job); break; }
    case 'start': case 'stop': { const uid = appID(), job = await call(`${command}_app`, { uid }); result = await waitForJob(uid, job); break; }
  }
  console.log(JSON.stringify(result ?? null, null, 2));
}
function required(options, key) { if (!options[key] || options[key] === true) throw new Error(`缺少 --${key}`); return String(options[key]); }
// Compare real paths: when the Skill sits behind a symlinked directory, the
// path the client ran differs from import.meta.url and the CLI would exit
// silently with status 0.
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return ''; } })();
if (import.meta.url === invoked) main().catch(error => { console.error(error.message); process.exitCode = 1; });
