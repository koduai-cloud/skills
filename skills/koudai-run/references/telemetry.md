# 用户体验改善计划

仅当出现需要上报的能力缺口、平台问题或使用错误时，才读取 `telemetry_status`（CLI：`telemetry-status`）；正常连接、进入控制台或成功发布时不主动提示，用户也可直接在账号设置中选择。`pending` 表示尚未授权，不收集、不上报，简短说明：「是否参与用户体验改善计划？我们仅收集匿名、非隐私类的功能需求和错误分类。拒绝不影响使用，可随时修改」，并提供返回的 `settings_url`；用户未选择时继续原任务。授权是账号设置，以服务端最新状态为准，不能跨账号、平台或会话推断，也不能调用设置 REST API 或通过 Token 代替用户同意。

用户明确选择参与后，平台才接收体验改善反馈，首次默认 pending；拒绝保存在账号设置，后续无需反复询问。`telemetry_status` 返回 `decision`、`enabled`、说明版本和 `settings_url`。首次或已允许者说明版本变化时，给用户这个网页入口自行选择；已拒绝者保持关闭，不反复询问；Skill 没有同意授权的工具。CLI 使用 `telemetry-status`；开发工具授权和用户体验改善计划参与授权是独立选择，拒绝不影响发布。

## 需求缺口

已允许时，用户的需求超出平台能力或当前 Skill 无法正确处理，如实向用户说明限制，并使用 `report_telemetry`，或 `telemetry-report --file .appisle/private/telemetry.json`。参数仅允许 `kind,feature,operation,code,capability,http_status`；不要添加 metadata 或其他字段。示例：

```json
{"kind":"capability_gap","feature":"deployment","operation":"configure","code":"unsupported_feature","capability":"scheduled_tasks"}
```

平台能力缺失用 `unsupported_feature`，Skill 本身无法正确处理用 `unsupported_skill`。`capability` 只能从当前工具 schema 的固定目录选择；例如定时任务 `scheduled_tasks`、批量操作 `batch_operations`、Skill 指引问题 `skill_guidance`。无法匹配用 `other`。摘要由服务端生成，接口不接受 `summary` 或任何自由正文。不得把原话、姓名、公司、健康信息、业务数据、URL、ID、源码、日志或密钥编码进分类字段；未知值会拒收。用户需要描述具体问题时，可自行提交工单，不自动转发对话。

## 错误

CLI、控制台和后端对平台操作错误做最佳努力的自动上报。请求鉴权失败、遥测自身失败及用户应用内部业务内容不采集。错误上报只发固定分类，不填写 capability 或复制异常内容，例如：

```json
{"kind":"platform_error","feature":"deployment","operation":"deploy","code":"deployment_failed","http_status":500}
```

查询当前工具 schema，使用真实受支持的枚举；不能编造资源 ID 来描述失败。上报成功返回 `accepted:true`；未授权、关闭、重复或限流返回 `accepted:false` 和原因，不应重复催促用户授权。上报不可用不影响主任务，也不额外发送邮件、工单或外部消息。网络完全断开时遥测本身也可能失败；浏览器仅在内存中做有限重试，关闭或切换账号即清空。

## 数据与控制

匿名报告没有上报者 UID、手机号、IP、应用 ID、会话、User-Agent、请求参数或原始日志字段。报告时间按小时取整，重复报告合并计数；授权选择单独保存在账号设置，服务端每次入库前重新检查，关闭后拒收新的上报；已提交的匿名报告可继续在平台内部飞书群处理。运维通过分类和摘要管理状态，不能依靠匿名报告联系上报者；需要联系平台时由用户自行提交工单。
