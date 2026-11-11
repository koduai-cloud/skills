import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { secureDirectory } from './auth.mjs';
import { projectDirectory } from './project.mjs';

export const managementCommands = ['tools', 'call', 'job', 'quota', 'space-info', 'app-update', 'app-env', 'app-env-set', 'space-env', 'space-env-set', 'app-databases', 'certificate-create', 'redis-get', 'redis-set'];
export const managementAppCommands = ['app-update', 'app-env', 'app-env-set', 'app-databases'];
const required = (o, key) => { if (!o[key] || o[key] === true) throw new Error(`缺少 --${key}`); return String(o[key]); };
async function jsonFile(path) {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('JSON 配置文件不能超过 1 MiB');
  try { return JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new Error('配置文件必须是有效 JSON'); }
}
async function privateResult(value, path, cwd) {
  const out = resolve(cwd, path || join('.appisle', 'private', `settings-${Date.now()}-${randomBytes(4).toString('hex')}.json`));
  // User-named outputs must also stay in a private directory. Do not change
  // permissions of an arbitrary project/home directory as a side effect.
  const dir = join(cwd, '.appisle', 'private');
  if (dirname(out) !== resolve(dir)) throw new Error('敏感输出请保存到当前项目 .appisle/private/ 目录');
  await projectDirectory(cwd); await secureDirectory(dir);
  try { await lstat(out); throw new Error('输出文件已存在，请使用新文件名'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(out, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { saved_file: out };
}

export async function runManagementCommand(command, o, { call, appID, waitForJob, cwd = process.cwd() }) {
  const finish = async value => {
    const ids = value?.deployment_uids || (value?.deployment_uid ? [value.deployment_uid] : value?.action && value?.uid ? [value.uid] : []);
    if (o['no-wait'] || !ids.length) return value;
    const deployments = [];
    for (const uid of ids) {
      const state = await waitForJob({ uid });
      deployments.push({ uid, status: state.deployment.status, app_uid: state.deployment.app_uid });
    }
    return { ...value, deployments };
  };
  if (command === 'tools') {
    const tools = await call.listTools();
    if (o.tool) { const tool = tools.find(t => t.name === o.tool); if (!tool) throw new Error('平台不支持该工具'); return tool; }
    return o.full ? tools : tools.map(({ name, description }) => ({ name, description }));
  }
  if (command === 'call') {
    const name = required(o, 'tool'), args = o.input ? await jsonFile(o.input) : {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是 JSON 对象');
    if (!(await call.listTools()).some(t => t.name === name)) throw new Error('平台不支持该工具；先运行 tools');
    if (['delete_app', 'delete_database'].includes(name) && o.confirm !== args.uid) throw new Error('删除需要 --confirm 与目标 uid 相同');
    const value = await call(name, args);
    if (['app_environment', 'space_environment', 'database_credentials'].includes(name)) return privateResult(value, o.out, cwd);
    if (o.out) { await writeFile(resolve(cwd, o.out), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { saved_file: resolve(cwd, o.out) }; }
    return finish(value);
  }
  if (command === 'job') return call('deployment_status', { uid: required(o, 'deployment') });
  if (command === 'quota' || command === 'space-info') return call(command === 'quota' ? 'space_quota' : 'space_detail', { namespace_uid: required(o, 'space') });
  if (command === 'app-update') {
    const { application } = await call('app_status', { uid: appID() });
    return call('update_app', { uid: appID(), name: o.name ?? application.name, description: o.description ?? application.description, ...(o.dsl ? { dsl: await jsonFile(o.dsl) } : {}) });
  }
  if (['app-env', 'space-env', 'app-env-set', 'space-env-set'].includes(command)) {
    const space = command.startsWith('space-'), id = space ? { namespace_uid: required(o, 'space') } : { uid: appID() };
    const tool = space ? 'space_environment' : 'app_environment';
    if (!command.endsWith('-set')) {
      const values = await call(tool, id);
      return o.out ? privateResult(values, o.out, cwd) : { names: Object.keys(values).sort(), count: Object.keys(values).length };
    }
    const values = await jsonFile(required(o, 'file'));
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(v => typeof v !== 'string')) throw new Error('环境变量文件必须是变量名到字符串的 JSON 对象');
    return finish(await call('set_' + tool, { ...id, values }));
  }
  if (command === 'app-databases') {
    const bindings = await jsonFile(required(o, 'file'));
    if (!Array.isArray(bindings)) throw new Error('数据库绑定文件必须为 JSON 数组');
    return finish(await call('set_app_databases', { uid: appID(), bindings, deploy: !!o.deploy }));
  }
  if (command === 'certificate-create') return call('create_certificate', { namespace_uid: required(o, 'space'), name: required(o, 'name'), certificate: await readFile(required(o, 'certificate-file'), 'utf8'), private_key: await readFile(required(o, 'key-file'), 'utf8') });
  if (command === 'redis-get' || command === 'redis-set') {
    const args = { uid: required(o, 'database'), key: required(o, 'key') };
    if (command === 'redis-set') {
      args.value = await readFile(required(o, 'file'), 'utf8');
      args.ttl_seconds = o.ttl === undefined ? 0 : Number(o.ttl);
      if (!Number.isSafeInteger(args.ttl_seconds) || args.ttl_seconds < 0) throw new Error('ttl 必须为非负整数秒数');
    }
    return call(command.replace('-', '_'), args);
  }
  throw new Error('未知管理命令');
}
