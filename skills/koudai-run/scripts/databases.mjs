import { readFile, writeFile, open, unlink, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { accessToken, secureDirectory } from './auth.mjs';
import { projectDirectory } from './project.mjs';

export const databaseCommands = ['databases', 'database-types', 'database-create', 'database-info', 'database-schema', 'database-query', 'database-execute', 'database-credentials', 'database-password', 'database-delete', 'database-retry', 'database-export'];
const required = (o,key) => { if (!o[key] || o[key] === true) throw new Error(`缺少 --${key}`); return String(o[key]); };
export function databaseID(options) { const uid = required(options,'database'); if (!/^db-[a-z0-9]{8}$/.test(uid)) throw new Error('数据库 UID 应为 db- 加 8 位小写字母或数字'); return uid; }

export async function downloadDatabase(base, uid, output, token) {
  output = resolve(output);
  const file = await open(output, 'wx', 0o600);
  try {
    const u = new URL(`/api/v1/database/export?uid=${encodeURIComponent(uid)}`, base);
    await new Promise((resolveRequest,reject) => {
      const transport = u.protocol === 'https:' ? httpsRequest : httpRequest;
      const local = u.hostname === 'localhost' || u.hostname.endsWith('.localhost');
      const req = transport({ protocol:u.protocol, hostname:local?'127.0.0.1':u.hostname.replace(/^\[|\]$/g,''), servername:u.hostname, port:u.port||undefined, path:u.pathname+u.search, method:'GET', headers:{Host:u.host,Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(65000) }, async response => {
        if (response.statusCode !== 200) { response.resume();reject(new Error(`数据库导出失败（HTTP ${response.statusCode}）`));return; }
        let bytes = 0;
        try { for await (const chunk of response) { bytes += chunk.length; if(bytes>256*1024*1024) {response.destroy();throw new Error('导出超过 256 MiB');} await file.write(chunk); } resolveRequest(); } catch(e){reject(e);}
      });
      // No redirects: the token stays on the explicitly selected platform.
      req.on('error',()=>reject(new Error('导出连接中断，请检查数据库状态后重试')));req.end();
    });
    await file.sync();return { exported_file:output };
  } catch(e){await file.close();await unlink(output).catch(()=>{});throw e;} finally {await file.close().catch(()=>{});}
}

export async function runDatabaseCommand(command,o,{call,base,request,cwd=process.cwd()}) {
  if(command==='databases'||command==='database-types') return call(command==='databases'?'list_databases':'database_types',{namespace_uid:required(o,'space')});
  if(command==='database-create') return call('create_database',{namespace_uid:required(o,'space'),name:required(o,'name'),engine:required(o,'engine')});
  const uid=databaseID(o);
  if(command==='database-credentials') {
    await projectDirectory(cwd);const dir=join(cwd,'.appisle','private');await secureDirectory(dir);
    const out=join(dir,`${uid}.json`);
    // Never overwrite a credential file or follow a symlink by accident.
    try {await lstat(out);throw new Error('私密凭证文件已存在；请先移走旧文件再重新获取');} catch(e){if(e.code!=='ENOENT')throw e;}
    const credentials=await call('database_credentials',{uid});await writeFile(out,JSON.stringify(credentials,null,2)+'\n',{flag:'wx',mode:0o600});return {credentials_file:out};
  }
  if(command==='database-password') {const password=(await readFile(required(o,'password-file'),'utf8')).replace(/\r?\n$/,'');return call('database_password',{uid,password});}
  if(command==='database-query'||command==='database-execute') {const sql=await readFile(required(o,'file'),'utf8');if(Buffer.byteLength(sql)>65536)throw new Error('SQL 文件不能超过 64 KiB');return call(command==='database-query'?'query_database':'execute_database',{uid,sql});}
  if(command==='database-delete') {if(o.confirm!==uid)throw new Error(`删除数据库和全部数据需要 --confirm ${uid}`);return call('delete_database',{uid,confirmation:uid});}
  if(command==='database-export') {await call('database_detail',{uid});const auth=await accessToken(base,request);return downloadDatabase(base,uid,required(o,'out'),auth.token);}
  const names={'database-info':'database_detail','database-schema':'database_schema','database-retry':'retry_database'};
  return call(names[command],{uid});
}
