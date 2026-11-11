# 云平台连接与 DNS

用户可连接阿里云 `aliyun`、腾讯云 `tencent`。连接属于空间，仅空间 owner/admin 可以管理和使用。所有连接接口使用 `cld-` 加 12 位小写字母数字的 UID，不传内部数字 ID。云端 DNS 记录的 `record_id` 是供应商返回的字符串，必须原样保留，不能转 JavaScript Number。

## 连接管理

先 `list_cloud_connections`（`namespace_uid`），复用用户指定或明确适用的连接。`cloud_connection_detail`（`uid`）只返回名称、平台和掩码 AK，不会读出 AK/SK。

新建 `create_cloud_connection`：`namespace_uid,name,provider,access_key,secret_key`。更新 `update_cloud_connection`：`uid,name`，更换密钥时同时填写 `access_key,secret_key`，两者省略保留现有密钥。空间和供应商不能改变。保存会检查 DNS 读取权限，凭证加密入库。只使用用户为此连接提供的密钥，不借用平台部署、OSS、短信或验证码账号。密钥输入保存在 `.appisle/private/` 下受保护且不入 Git 的文件；不得在对话、命令参数、日志、代码或产物中打印。

```text
node <cli> tools --tool create_cloud_connection
node <cli> call --tool create_cloud_connection --input .appisle/private/cloud-create.json
node <cli> call --tool check_cloud_connection --input .appisle/private/cloud-check.json
```

`check_cloud_connection` 只证明域名列表读取权限，添加/删除权限在对应操作时验证。优先使用限定 DNS 域名范围的子账号密钥。阿里云需要 `alidns:DescribeDomains`、`alidns:DescribeDomainRecords`、`alidns:AddDomainRecord`、`alidns:DeleteDomainRecord`；腾讯云需要 `dnspod:DescribeDomainList`、`dnspod:DescribeRecordList`、`dnspod:CreateRecord`、`dnspod:DeleteRecord`。权限及资源范围以供应商控制台为准，不建议为方便授予云账号全部权限。

删除连接用 `delete_cloud_connection`（`uid,confirmation`，confirmation 为完整连接 UID）。删除连接会保留云上的解析和口袋空间已绑定的域名；它只移除平台保存的凭证。用户明确指定删除连接时无需重复请求同一项授权。

## 应用域名流程

1. 读取应用与同空间连接，调用 `check_cloud_dns`，传 `app_uid,cloud_uid,host`。host 是完整域名，不带协议、端口或路径。平台查询该账号 DNS 管理的最长匹配域名，并读取此主机名下所有精确记录，包括停用记录，不把其他子域名或泛解析当成可以删除的目标。
2. `owned:false` 表示此账号的 DNS 域名列表中没有对应域名。换连接或使用手动 `add_domain`，不把“注册于该云平台”当作“DNS 也由该账号托管”。
3. 向用户展示已有记录及待添加的 `rr,type,cname_target,ttl`。`already_configured:true` 表示已有默认线路 CNAME 正确指向此应用，可直接绑定。`can_add:false` 时不能创建，不可自动覆盖或删除。
4. 用户需要删除时，先展示要删除的完整域名、记录 ID、类型、值、线路及可能中断原服务的影响；在用户明确授权这一条记录后调用 `delete_cloud_dns_record`。传上一步的 `preview_token`、`record_id` 和 `confirmation`（完整域名），以及原 `app_uid,cloud_uid,host`。已有明确且具体的删除授权可以直接执行，不再重复确认。受保护的 NS/SOA 记录不能通过此流程删除。
5. 每次删除后重新 `check_cloud_dns`。预览 10 分钟有效；记录、连接或应用目标变化会使它失效，必须重新检查和展示变化，不能循环重试旧预览。
6. 用户确认添加预览后调用 `bind_cloud_dns`，传 `app_uid,cloud_uid,host,preview_token`。它创建默认线路 CNAME、绑定应用并尝试验证；若已有正确 CNAME 则复用。接口不会自动公开应用、签发证书或删除冲突解析。
7. 成功后检查返回的域名 `verified_at`；未生效时保留绑定并稍后 `verify_domain`，不要删除重建。HTTPS 仍需空间证书和 `set_domain_tls`；访问权限通过应用 `access_options` 判断。

云 API 请求超时可能已产生效果，先重新检查现状再决定后续操作。不要盲目重复增删。删除口袋空间的域名绑定（`delete_domain`）也不会删除云端 DNS，若需清理云记录，先在绑定存在时按以上流程处理，再解绑。

官方 API：[阿里云 DNS](https://help.aliyun.com/zh/dns/api-alidns-2015-01-09-overview)、[腾讯云 DNSPod](https://cloud.tencent.com/document/api/1427/56194)。
