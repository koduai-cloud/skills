import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTelemetry,reportFailure,errorClassification} from '../skills/koudai-run/scripts/telemetry.mjs';
import {createMCPClient} from '../skills/koudai-run/scripts/appisle.mjs';

test('only fixed capabilities are accepted; free text never reaches transport',()=>{
 const input={kind:'capability_gap',feature:'deployment',operation:'configure',code:'unsupported_feature',capability:'scheduled_tasks'};
 assert.equal(validateTelemetry(input).capability,'scheduled_tasks');
 for(const raw of ['张三','健康信息','收入一万','١٣٨٠٠٠٠٠٠٠٠','example.xyz','a@example.com','https://koudai.run','aid-1234567890','password=secret']) {
  assert.throws(()=>validateTelemetry({...input,capability:raw}));
  assert.throws(()=>validateTelemetry({...input,summary:raw}));
 }
 assert.throws(()=>validateTelemetry({...input,user_uid:'private'}));
 assert.throws(()=>validateTelemetry({...input,kind:'platform_error',code:'server_error'}));
 assert.throws(()=>validateTelemetry({...input,feature:'deployment|database'}));
});


test('real MCP tools use noun-based classifications',()=>{
 for(const [tool,feature,operation] of [['list_certificates','domains','read'],['list_invitations','access','read'],['create_app','deployment','create'],['list_databases','database','read'],['set_domain_tls','domains','configure'],['set_app_resources','resources','configure'],['set_app_visibility','access','configure'],['create_app_invitation','access','create']]) {
  const report=errorClassification(tool,500);assert.equal(report.feature,feature);assert.equal(report.operation,operation);
 }
 assert.equal(errorClassification('deploy_app',500).code,'deployment_failed');
});

test('automatic errors report only after current affirmative consent and share one deadline',async()=>{
 for(const enabled of [false,true]) {
  const calls=[];await reportFailure(async(name,args,signal)=>{calls.push({name,args,signal});return {enabled}},'deploy_app',500);
  assert.deepEqual(calls.map(c=>c.name),enabled?['telemetry_status','report_telemetry']:['telemetry_status']);
  if(enabled){assert.equal(calls[1].args.feature,'deployment');assert.equal(calls[1].args.kind,'platform_error');assert.ok(!('summary' in calls[1].args));assert.equal(calls[0].signal,calls[1].signal);}
 }
 const calls=[];for(const name of ['telemetry_status','report_telemetry'])await reportFailure(async n=>calls.push(n),name,500);
 await reportFailure(async n=>calls.push(n),'deploy_app',401);assert.deepEqual(calls,[]);
 await assert.doesNotReject(()=>reportFailure(async()=>{throw new Error('unavailable')},'deploy_app',500));
 const start=Date.now();let signal;
 await reportFailure(async(_n,_a,s)=>{signal=s;return new Promise(()=>{});},'deploy_app',500);
 assert.ok(Date.now()-start<1800);assert.ok(signal.aborted);
});

test('MCP client preserves original errors; automatic reports use existing token without credential refresh',async()=>{
 const requests=[];const privateArgs={uid:'aid-private0000',dsl:{password:'must-not-leave-in-telemetry'}};
 const env={APPISLE_TOKEN:'test-only-token',APPISLE_URL:'https://test.example'};
 const request=async(url,options)=>{
  const rpc=JSON.parse(options.body);requests.push(rpc);
  if(rpc.method==='initialize')return {ok:true,status:200,value:{jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:'2025-06-18'}}};
  const {name}=rpc.params;
  // Make fresh credential acquisition fail; automatic telemetry must still reuse its snapshot.
  if(name==='deploy_app')delete env.APPISLE_TOKEN;
  const result=name==='deploy_app'?{content:[{type:'text',text:JSON.stringify({error:'original failure: private payload',status:500})}],isError:true}:{content:[{type:'text',text:JSON.stringify(name==='telemetry_status'?{enabled:true}:{accepted:true})}]};
  return {ok:true,status:200,value:{jsonrpc:'2.0',id:rpc.id,result}};
 };
 const client=await createMCPClient('https://test.example',request,env);
 await assert.rejects(()=>client('deploy_app',privateArgs),/original failure/);
 const report=requests.find(r=>r.params?.name==='report_telemetry');assert.ok(report);
 const serialized=JSON.stringify(report.params.arguments);for(const word of ['private','password','original failure'])assert.ok(!serialized.includes(word));
 const before=requests.length;
 await assert.rejects(()=>client('report_telemetry',{kind:'capability_gap',feature:'skill',operation:'other',code:'unsupported_skill',summary:'姓名张三'}));
 assert.equal(requests.length,before);
});
