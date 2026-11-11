import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseID, runDatabaseCommand } from '../skills/koudai-run/scripts/databases.mjs';

test('database identifiers and destructive confirmation are checked before RPC',async()=>{
 assert.throws(()=>databaseID({database:'db-../../a'}));let calls=0;
 await assert.rejects(()=>runDatabaseCommand('database-delete',{database:'db-abcdefgh',confirm:'db-ijklmnop'},{call:async()=>{calls++;}}));assert.equal(calls,0);
});
test('database credentials go only to a protected private file and cannot overwrite it',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'appisle-db-cli-'));let calls=0;
 try {
  const result=await runDatabaseCommand('database-credentials',{database:'db-abcdefgh'},{cwd,call:async(name)=>{calls++;assert.equal(name,'database_credentials');return {password:'SecretA9!value',url:'mysql://private'};}});
  assert.equal(JSON.stringify(result).includes('SecretA9!'),false);assert.equal(JSON.parse(await readFile(result.credentials_file,'utf8')).password,'SecretA9!value');
  await assert.rejects(()=>runDatabaseCommand('database-credentials',{database:'db-abcdefgh'},{cwd,call:async()=>{calls++;}}));assert.equal(calls,1);
 } finally {await rm(cwd,{recursive:true,force:true});}
});
test('read and write SQL commands select different MCP tools',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'appisle-db-sql-'));const file=join(cwd,'statement.sql');
 try {await writeFile(file,'SELECT 1');const calls=[];const call=async(name,args)=>{calls.push({name,args});return {};};
  await runDatabaseCommand('database-query',{database:'db-abcdefgh',file},{cwd,call});await runDatabaseCommand('database-execute',{database:'db-abcdefgh',file},{cwd,call});
  assert.deepEqual(calls.map(c=>c.name),['query_database','execute_database']);assert.ok(calls.every(c=>c.args.sql==='SELECT 1'));
 } finally {await rm(cwd,{recursive:true,force:true});}
});
