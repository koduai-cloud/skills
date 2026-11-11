// Fixed classifications only; never pass an exception, prompt, URL, token,
// resource identifier, request arguments or source files to automatic reports.
export const telemetryCapabilities = {
  "scheduled_tasks": "定时执行应用任务",
  "background_jobs": "运行后台任务",
  "persistent_connections": "支持持续连接",
  "gpu_compute": "使用 GPU 运行应用",
  "higher_resources": "提高应用资源档位",
  "autoscaling": "自动扩缩容",
  "application_backups": "备份和恢复应用",
  "deployment_rollback": "回滚应用版本",
  "release_strategy": "灰度或分环境发布",
  "git_deployment": "从代码仓库自动发布",
  "custom_runtime": "使用更多运行环境",
  "build_dependencies": "安装额外运行依赖",
  "logs_and_monitoring": "查看更多日志和监控",
  "database_import": "导入已有数据库",
  "database_export": "导出数据库",
  "database_types": "使用更多数据库类型",
  "database_maintenance": "管理数据库维护任务",
  "external_database": "连接外部数据库",
  "persistent_files": "管理持久化文件",
  "object_storage": "使用对象存储",
  "custom_domain": "绑定和管理域名",
  "automatic_https": "自动管理 HTTPS 证书",
  "external_network": "访问外部网络服务",
  "team_collaboration": "多人协作管理空间",
  "access_permissions": "设置更细的访问权限",
  "invitation_management": "管理邀请和审批",
  "public_access": "设置公开访问",
  "password_access": "设置密码访问",
  "login_methods": "支持更多登录方式",
  "identity_integration": "接入统一身份认证",
  "batch_operations": "批量管理应用或资源",
  "api_automation": "通过接口自动管理资源",
  "skill_installation": "安装或更新 Skill",
  "skill_tool_support": "通过 Skill 操作现有功能",
  "skill_diagnostics": "通过 Skill 排查问题",
  "skill_guidance": "改进 Skill 说明和指引",
  "billing_options": "支持更多购买付款或售后方式",
  "data_migration": "迁移应用或业务数据",
  "client_compatibility": "支持更多 AI 客户端",
  "regional_access": "改善不同地区的访问",
  "availability": "提高服务可用性",
  "other": "其他尚未分类的功能需求"
};

export function validateTelemetry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['kind','feature','operation','code','capability','http_status'].includes(k))) throw new Error('遥测只允许固定分类，不接受摘要、原文或其他数据');
  const kinds=['capability_gap','platform_error','usage_error'];
  const features=['deployment','database','domains','access','resources','space','account','billing','files','skill','console','help','other'];
  const operations=['create','update','deploy','start','stop','delete','read','write','connect','authorize','query','export','invite','configure','pay','render','request','other'];
  const codes=['unsupported_feature','unsupported_skill','server_error','network_error','client_error','deployment_failed','validation_error','permission_denied','resource_missing','conflict','quota_exceeded','rate_limited','request_failed'];
  if (!kinds.includes(input.kind)||!features.includes(input.feature)||!operations.includes(input.operation)||!codes.includes(input.code)) throw new Error('遥测分类无效');
  if (input.http_status!==undefined&&![0,400,403,404,409,413,422,429,500,502,503,504].includes(input.http_status)) throw new Error('遥测状态无效');
  if (input.kind==='capability_gap') {
    if (!['unsupported_feature','unsupported_skill'].includes(input.code)||!Object.hasOwn(telemetryCapabilities,input.capability)) throw new Error('请选择当前目录中的能力分类；无法匹配时使用 other，不发送原文');
  } else if (input.capability) throw new Error('错误遥测不接受需求内容');
  return {...input};
}

export function errorClassification(tool,status=0) {
  const parts=String(tool).split('_');
  const categories={app:'deployment',apps:'deployment',deployment:'deployment',artifact:'deployment',database:'database',databases:'database',redis:'database',domain:'domains',domains:'domains',certificate:'domains',certificates:'domains',cloud:'domains',space:'space',spaces:'space',member:'access',members:'access',invitation:'access',invitations:'access',invite:'access',visibility:'access',ticket:'help',tickets:'help',quota:'resources',resources:'resources',resource:'resources'};
  const feature=parts.some(p=>['quota','resources','resource'].includes(p))?'resources':parts.some(p=>['visibility','invitation','invitations','invite','members','member'].includes(p))?'access':parts.map(p=>categories[p]).find(Boolean)||'skill';
  const operation=parts.find(p=>['create','update','deploy','start','stop','delete','read','write','connect','authorize','query','export','invite','configure','pay'].includes(p))||(parts.includes('set')?'configure':parts.some(p=>['list','status','logs','detail','get'].includes(p))?'read':'request');
  const code=feature==='deployment'&&operation==='deploy'&&status>=500?'deployment_failed':({0:'network_error',400:'validation_error',403:'permission_denied',404:'resource_missing',409:'conflict',413:'quota_exceeded',422:'validation_error',429:'rate_limited'})[status]||'server_error';
  return {kind:status===0||status>=500?'platform_error':'usage_error',feature,operation,code,http_status:[0,400,403,404,409,413,422,429,500,502,503,504].includes(status)?status:0};
}

export async function reportFailure(call,tool,status) {
  if (['report_telemetry','telemetry_status'].includes(tool)||status===401) return;
  const controller=new AbortController();
  let timeout;
  try {
    const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('telemetry timeout'));},1000);});
    await Promise.race([deadline,(async()=>{
      const consent=await call('telemetry_status',{},controller.signal);
      if (!controller.signal.aborted&&consent?.enabled===true) await call('report_telemetry',errorClassification(tool,status),controller.signal);
    })()]);
  } catch { /* Telemetry must never replace or delay the primary failure indefinitely. */ }
  finally {clearTimeout(timeout);controller.abort();}
}
