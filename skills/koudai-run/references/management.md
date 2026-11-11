# 应用与空间完整设置

所有操作复用已有 OAuth 与服务端用户权限。`<cli>` 是本 Skill 的 `scripts/appisle.mjs`。获取当前平台准确参数：

```text
node <cli> tools
node <cli> tools --tool set_domain_tls
node <cli> call --tool list_domains --input domain-list.json
```

`domain-list.json` 示例为 `{"uid":"aid-实际应用UID"}`。`call` 接收 JSON 文件，避免 shell 引号、密码及多行正文泄露。默认等待返回的部署任务，`--no-wait` 只提交；随后用 `job --deployment dep-...` 查询**该任务**。未知工具先查询 tools，不猜接口或用 OAuth Token 调普通管理 REST API。CLI 读取完整环境变量或数据库凭证时只写入 `.appisle/private/` 下的新文件，不打印值、不覆盖已有文件。

## 能力对照

下面覆盖目前用户控制台已有的应用、空间和数据库操作。每个工具的完整必填字段以 `tools --tool <name>` 返回的 JSON Schema 为准。

| 功能 | MCP 工具 / 主要参数 |
| --- | --- |
| 空间、角色、有效配额与使用量 | `list_spaces`；`space_detail` / `space_quota`：`namespace_uid` |
| 应用列表、详情、名称、描述 | `list_apps`；`app_status`：`uid`；`update_app`：`uid,name,description` |
| 创建、部署、产物、历史、任务、日志 | `create_app` / `upload_artifact` / `deploy_app` / `app_deployments` / `deployment_status` / `app_logs` |
| 启动、停止、删除 | `start_app` / `stop_app` / `delete_app`：`uid` |
| 应用环境变量 | `app_environment`：`uid`；`set_app_environment`：`uid,values` |
| 空间全局环境变量 | `space_environment`：`namespace_uid`；`set_space_environment`：`namespace_uid,values` |
| 资源使用与配额调整 | `app_metrics`：`uid,range`；`set_app_resources`：`uid,compute_units`，0 为基础资源，1–4 为 CU 档位；额外档位须有足够的空间 CU，按完整档位占用 |
| 访问方式 | `set_app_visibility`：`uid,visibility`（`private` 指定人可访问 / `space` 空间成员可访问 / `public` 所有人可访问 / `password` 通过密码访问），密码模式首次设置还需 `password` |
| 域名列表、绑定、验证、解绑 | `list_domains`：应用 `uid`；`add_domain`：`app_uid,host`；`verify_domain` / `delete_domain`：域名资源 `uid` |
| 自定义域名 HTTPS | `set_domain_tls`：域名 `uid,https,certificate_uid`，`https` 必须显式 true/false |
| 云账号连接管理 | `list_cloud_connections` / `cloud_connection_detail` / `create_cloud_connection` / `update_cloud_connection` / `check_cloud_connection` / `delete_cloud_connection`，仅空间管理员；连接 UID 为 `cld-` 加 12 位小写字母数字 |
| 云平台 DNS 检查、添加、删除 | `check_cloud_dns` / `bind_cloud_dns` / `delete_cloud_dns_record`；完整操作要求见 [云平台连接与 DNS](cloud-dns.md) |
| 空间证书列表、上传、删除 | `list_certificates`：`namespace_uid`；`create_certificate`：`namespace_uid,name,certificate,private_key`；`delete_certificate`：证书 `uid` |
| 应用访问成员 | `list_app_members`：应用 `uid`；`remove_app_member`：`uid,user_uid` |
| 组织空间成员与角色 | `list_space_members`：`namespace_uid`；`set_space_member`：`namespace_uid,user_uid,role`；`remove_space_member`：`namespace_uid,user_uid` |
| 空间定向邀请、查询、撤销 | `create_invitation`：`target_type=space,target_uid,identity,role?`；`list_invitations`：`target_type,target_uid`；`revoke_invitation`：邀请 `uid` |
| 受邀账号预览、接受 | `preview_invitation` / `accept_invitation`：邀请 `token` |
| 数据库自动绑定和解绑 | `set_app_databases`：应用 `uid,bindings,deploy?` |
| 数据库全生命周期、查询、导出、Redis | 见 [数据库管理](databases.md)，全部可通过 CLI/MCP 完成 |

新建组织空间当前停用。能否邀请空间成员只看有效成员配额，不按空间类型判断；免费版和个人版初始上限为 1 人（含所有者），后台可编辑。移除应用直接成员不会取消通过「所有空间成员」分组或空间成员访问方式继承的权限；管理员角色由空间 owner 调整。用户 Skill 不能设置空间订阅、运维配额覆盖、数据库池超级账号或平台管理员；这些是运维权限。隐藏的固定带宽没有用户修改入口。

## 两级环境变量

```text
node <cli> space-env --space ns-...                                  # 只列名称
node <cli> space-env --space ns-... --out .appisle/private/global.json
node <cli> app-env --app aid-... --out .appisle/private/application.json
node <cli> space-env-set --space ns-... --file .appisle/private/global.json
node <cli> app-env-set --app aid-... --file .appisle/private/application.json
```

文件是完整的字符串映射，例如 `{"TZ":"Asia/Shanghai","LOG_LEVEL":"info","EMPTY":""}`。先读取本层、保留其他键、修改目标键再保存；`{}` 清空本层。应用 `LOG_LEVEL=debug` 只覆盖同名全局变量，`TZ` 等其他全局变量继续存在。删除应用的 `LOG_LEVEL` 恢复继承，设置为空字符串则显式覆盖为空。容器组的每个容器及 workerd 都会注入；静态托管没有运行时变量。数据库自动绑定的保留变量不可覆盖。

保存重新部署运行中的应用，可能短暂不可用；已停止或未发布应用在下次启动/部署时生效。全局保存及所有任务入队是一个事务，存在未结束的非静态应用任务时返回冲突，不能不停重试写入。保持配置不变的全局保存不会重复部署。每层及每个容器合并后最多 64 个变量、32 KiB。

## 数据库自动对接

首次部署直接使用 DSL `databases`；已有应用可只更改绑定数组：

```text
node <cli> app-databases --app aid-... --file bindings.json --deploy
```

`bindings.json`：

```json
[
  {"uid":"db-xxxxxxxx","container":"web","env_prefix":"DB"},
  {"uid":"db-yyyyyyyy","container":"web","env_prefix":"REDIS"}
]
```

这是完整绑定列表，保留所有仍需使用的绑定；空数组解绑所有数据库，**不删除数据库或数据**。仅替换绑定列表，保留当前生效版本的其他 DSL 和原有静态/workerd 产物。未发布应用不加 `--deploy` 时只保存配置；已发布应用必须明确 `--deploy`，会重新部署并启动应用，包括此前停止的应用。应用已有排队任务时拒绝修改。静态应用拒绝绑定；容器名、变量前缀、就绪状态、空间归属均由服务器验证。

自动注入的是连接参数和秘密，不会自动适配任意第三方软件的业务配置；需要按软件支持的变量或配置文件接收它们，例如应用从 `DB_URL` 或 `DB_HOST/PORT/USER/PASSWORD/NAME` 创建连接。不要把数据库密码读出后再复制到全局变量。建表/迁移通过数据库执行工具或应用初始化完成，并验证写入和读取。

## 域名、HTTPS 与访问

依次 `add_domain` → 配置返回的 CNAME → `verify_domain` → `create_certificate`（或复用现有匹配证书）→ `set_domain_tls`。证书上传可直接从文件完成：

```text
node <cli> certificate-create --space ns-... --name 我的域名 --certificate-file fullchain.pem --key-file private.key
```

启用 HTTPS 的参数文件为 `{"uid":"dom-实际UID","https":true,"certificate_uid":"cert-实际UID"}`；关闭传 `https:false`。不要猜 UID 的长度或前缀，用列表返回的值。私钥不写入对话、普通文档或部署包。

先读取 `app_status.application.access_options`：`public`、`password` 决定当前可选的方式，`password_set` 表示是否已设置访问密码，`system_mode` 是平台域名的实际访问方式。所有版本默认支持平台域名公开，新应用默认所有人可访问，已有应用保留原权限，空间单独设置仍优先；不要求先绑定自定义域名。只有用户明确要求更改现有访问方式时才切换，始终以返回的能力和实际访问验证为准，不猜订阅权限。不可用时说明当前应用不支持，不自行更改版本或空间内部策略。

通过密码访问首次设置传入 8–72 字节的 `password`，以后省略或留空保留现有密码。用 `.appisle/private/access.json` 参数文件经 `call --tool set_app_visibility --input ...` 提交，不把密码写进 shell 参数、Git、产物、公开输出或链接。服务端只保存散列，不提供密码回读。切换离开通过密码访问会清除密码，重设密码后访客需重新输入。删除最后一个验证域名时，若系统域名仍支持当前方式则保留，否则恢复私有。

公开或通过密码访问的匿名访客不会获得空间成员身份。个人数据 SDK 仍要求应用成员登录。应用邀请链接供多个登录用户确认加入；空间定向邀请只授予指定账号。工具不会发送短信或邮件。

访问方式和空间成员上限均由版本及有效覆盖配置控制，不能按空间类型或套餐名字推断权限。先读取 `app_status.application.access_options` 和空间有效配额：仅提供允许的方式；`private` 可用 `all_space_members:true` 包含所有空间成员及未来新成员（须 `space_members:true`），还可保留通过共享邀请链接加入的用户；`space` 只允许空间成员，外部邀请不生效。`add_app_member`（`uid,user_uid`）只可选择已有空间成员，应用的外部用户使用应用邀请链接，登录确认或申请加入；`create_invitation` 仅用于空间邀请。域名在独立的「域名」标签管理，访问方式与指定成员在「访问权限」管理。空间人数达到有效 `effective.limits.members` 配额时不能新增或接受成员邀请。


应用邀请入口为 `<平台地址>/apps/<应用UID>?tab=access#invite-link`。链接初始未生成，默认不需要审批，可供多个登录用户分别确认加入。开启审批后，管理员在该页面处理加入申请。更换或关闭链接不移除已有成员，也不自动处理待审批申请。加入应用不代表加入空间。

删除应用为软删除：移除运行部署和访问入口，撤销应用会话及临时授权、关闭邀请链接，保留 ID、已上传内容、配置、环境变量、数据、持久卷、成员、数据库绑定和域名。恢复由运维管理员处理，恢复后保持停止，再启动或发布；邀请链接需重新生成。历史版本已清除的内容不能凭空恢复。保留存储继续计入空间用量，并按适用规则计费。
