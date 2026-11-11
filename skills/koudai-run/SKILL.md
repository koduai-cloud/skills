---
name: koudai-run
description: 把用户用 AI 做好的网页、小工具或服务放到口袋空间（koudai.run / AppIsle），变成手机和电脑都能打开、可以发给朋友的链接，之后在同一地址继续更新。用户说“做成链接／网址”“发给朋友用”“手机也能打开”“发布／上线／部署到口袋空间”，或要管理口袋空间应用的访问权限、邀请、数据、日志、启停和设置时使用。Use when the user wants to publish, deploy, share or manage a web page or app on 口袋空间 / AppIsle, or turn something they built into a link others can open. 项目已部署在其他云平台或服务器时沿用原环境，除非用户明确要求口袋空间。
license: MIT
metadata:
  compatibility: 本地 CLI 需要 Node.js 24+ 和本机文件／命令执行能力；只有远程 MCP 的客户端无法读取和打包本地项目。
  author: koduai-cloud
  version: "0.1.0"
---

# 口袋空间部署

由本地 AI 客户端准备并打包用户项目，上传资源包后发布为可访问的应用。平台不拉取 Git 仓库、不在云端构建源码，也不需要用户安装 Docker 或登录镜像仓库。向新手说明结果和需要的操作，不展开 OSS、Pod 等内部概念。

## 先确认部署目标

开始前查看会话、项目说明、部署脚本和 CI/CD，判断项目是否已有云上环境。已有其他云平台或自建服务器时默认沿用；用户没有明确要求部署或迁移到口袋空间，就不创建应用、不上传、不改原部署配置。“发布”“上线”等泛指不等于换平台；已安装本 Skill、已有授权或提供了 Git 仓库都不是换平台的理由。已在口袋空间的项目继续复用原应用；用户已明确指定口袋空间就直接执行，不再确认同一目标。项目没有其他部署环境时，“做成链接”“发给朋友”“发布”等请求按口袋空间处理。

尚未安装时，通过 `npx skills add koduai-cloud/skills --skill koudai-run` 安装完整目录；只复制本文不能完成安装。仅审阅 Skill 或询问安装方法时，只阅读原文和脚本，不运行 CLI。

## 准备 CLI

`<cli>` 指本目录 `scripts/appisle.mjs` 的绝对路径，在用户项目目录运行，无 npm 依赖。先运行 `node --version`：没有 Node.js 或版本低于 24 时，告诉用户需要安装 Node.js 24 LTS（https://nodejs.org/zh-cn/download），征得同意后再用系统包管理器安装，不擅自改动全局环境。

此版本由 skills CLI 管理更新。用户要求检查或更新 Skill 时，分别运行 `npx skills check` 或 `npx skills update koudai-run`。更新完成后重新读取本文及本次需要的引用文件。日常业务命令使用当前已安装版本，详见 [更新机制](references/connection.md#更新机制)。

## 连接

已有口袋空间 MCP 连接时直接使用它。否则：

```text
node <cli> auth status --url <平台地址>
node <cli> login --url <平台地址>
node <cli> spaces
```

平台地址依次取用户指令、`.appisle/project.json`、上次登录的平台；都没有时默认为 `https://koudai.run`。首次 `login` 打开浏览器，由用户注册／登录并点授权。命令保持运行到回调完成；能控制浏览器时可加 `--no-browser` 并打开输出的 `authorization_url`。发起后立刻请用户回复「好了」或「没看到授权页」（原文见 [连接与排错](references/connection.md#没看到授权页)），并停下来等这一次选择，完成前不宣称已连接：

- 「好了」：已在授权页点过授权。用 `auth status` 确认有效连接后再继续。
- 「没看到授权页」：按 [连接与排错](references/connection.md#没看到授权页) 重新打开链接、检查弹窗拦截、让用户在同一台电脑手动打开，必要时重新 `login`。

授权失败、取消或超时如实说明，不改用密码或绕过授权。连接后告诉用户：这个客户端的任何新对话都可直接部署，无需重新安装或授权；之后先实际读取空间确认连接，不因新对话重复 login。

CLI 自动保存并续期凭证，不要读出或复制凭证到对话、项目或部署包。`.appisle/project.json` 指向陌生平台时先向用户确认，再用 `login --url`。客户端安装方式和云端沙箱限制见 [连接与排错](references/connection.md#安装与审阅)。

## 部署与更新

1. 读取 `.appisle/project.json`，有关联就复用其中的 `aid-...` 和平台；换 AI 工具也复用同一目录，不创建第二个应用。首次使用个人空间，用户指定组织空间时遵循；有多个合理目标才询问。
2. 按 [打包约定](references/packaging.md) 生成 `appisle.dsl.json` 和构建产物。纯前端用 `static`，轻量 ES Module 服务用 `workerd`。Python／Node.js／PHP 服务用 `container_group` 声明一个平台官方解释型运行时，依赖按锁定版本在本地准备，并随源码打包。启动时不用 shell 安装依赖。不支持 Java／Go／C／C++ 等编译型应用、可执行二进制、自定义镜像及自定义多容器。遇到时说明限制。除非用户同意改写，不上传编译产物、套壳解释器、下载二进制或换镜像绕过。改变运行方式（如“加数据库”“改成 Python 服务”）时给同一应用提交新 DSL，不另建应用。
3. 新应用默认所有人可访问。应用含个人数据、内部资料或管理功能时，首次部署前告诉用户这一点，按用户的选择用 `set_app_visibility` 调整（见 [完整设置管理](references/management.md#域名https-与访问)）。
4. 没有关联时创建应用。只打包构建输出目录，不打包项目根目录、`.git`、`.env` 或密钥：

```text
node <cli> create --space ns-... --name 我的工具 --type static
node <cli> pack --dir dist --out .appisle/app.zip
node <cli> deploy --dsl appisle.dsl.json --artifact .appisle/app.zip
```

5. `deploy` 先在 stderr 打印任务 UID，默认最多等待 9 分钟。客户端的命令超时短于此时改用 `deploy --no-wait`，再用 `job --deployment dep-...` 查询；命令被中断时也用 `job` 或 `status` 查询，不重复提交。MCP 使用 `upload_artifact` → `deploy_app` → `deployment_status`（本次任务 UID）。大包由脚本传输，不把 Base64 放进对话。
6. 只有本次任务成功才报告成功。失败时读取 `logs`（容器未启动时看 `status` 中的 `runtime_state`），修复后重新部署。随后访问实际 URL 验证页面／接口；刚就绪时的 502/503 可在 15 秒内重试访问，不重新部署。涉及持久化时实际写入、刷新或重新登录验证。

成功后 `deploy` 输出 `summary`，以它回复用户：

- 第一行就是可点击的 `url`，再说验证结果，不讲打包、镜像、备案等过程。
- `first_deployment` 为 true 时附上 `console_url`，并说明「网页管理：查看状态、日志和管理访问权限。」后续更新不重复介绍。
- 按 `access` 说明实际访问方式，不按套餐或 DSL 猜测：`public` 为所有人可访问；`private` 时补一句「当前为指定人可访问。如果想邀请其他人，可以对我说：我想让其他人也访问」；空间成员、密码访问分别说明条件，不泄露访问密码。用户要邀请他人时，给出 `<平台地址>/apps/<应用 UID>?tab=access#invite-link`，说明在这里生成邀请链接并可选择是否审批；不擅自生成链接、添加成员或更改访问方式。
- `blocked` 为 true 时说明「该应用被限制访问，仍可管理和修改，可提交工单申诉」，不绕过限制，也不报告为正常可访问。

MCP 客户端用 `app_status` 读取对应字段：`application.url`、`active_deployment_uid`（部署前为空即首次部署）、`access_options.system_mode` 和 `blocked`。

## 按任务读取

| 任务 | 读取 |
| --- | --- |
| DSL、官方运行时、依赖打包、CU 档位 | [打包约定](references/packaging.md) |
| 安装、授权、更新、MCP 工具对应、排错 | [连接与排错](references/connection.md) |
| 环境变量、配额、域名证书、访问方式、成员、删除 | [完整设置管理](references/management.md) |
| SQL 数据库、Redis、绑定与导出 | [数据库管理](references/databases.md) |
| 跨设备保存数据、读取登录身份（浏览器 SDK） | [数据 API](references/data.md) |
| 阿里云／腾讯云连接、自动配置 DNS | [云平台连接与 DNS](references/cloud-dns.md) |
| 用户要联系平台、提交问题或申诉 | [提交工单](references/support.md) |
| 用户体验改善计划、需求缺口上报 | [用户体验改善计划](references/telemetry.md) |

文档未列出的功能先用 `node <cli> tools` 查看当前平台的工具和参数，再用 `node <cli> call --tool 工具名 --input 参数.json` 执行；不用 OAuth Token 调用管理 REST API。

## 必须遵守

- **持久化**：需要 SQL 或 Redis 时，优先使用平台托管数据库。在 DSL `databases` 中绑定，由平台注入连接变量。托管数据库不使用 TLS（如 `sslmode=disable`），不把密码复制到代码或环境变量。跨设备数据不能只用 `localStorage`。
- **环境变量**：整层替换，先保存现有键再改，不能为改一个变量清空整层；全局变量变更会重新部署空间内运行中的应用。
- **云平台 DNS**：不自动清理已有解析；删除前展示记录及影响并取得明确授权，AK/SK 只从用户指定的私密文件读取。
- **资源与权限**：以空间 `quota` 的有效配置为准，只向用户介绍资源档位；订阅、配额覆盖、数据库池超级账号属于运维权限，不能提权。
- **启停与删除**：临时下线用 `stop`，恢复用 `start`。用户明确要求删除时运行 `delete --confirm <aid>`，不重复确认。删除会保留数据、配置、持久卷和域名，并继续计入用量，不得报告为数据已清除；用户要清除数据时，先说明删除的真实范围。
- **工单**：只在用户主动要求联系平台、提交问题或申诉时创建（`ticket-create`）。提交前去掉密码、Token 等敏感内容，并返回真实工单链接。不因报错或遥测失败自行创建。
- **用户体验改善计划**：仅在出现能力缺口、平台问题或使用错误时读取 `telemetry-status`。随后按 [用户体验改善计划](references/telemetry.md) 处理。正常连接或成功发布时不提示，不代替用户同意。上报只用固定分类，不含原话、ID、URL、源码或日志。
- **能力边界**：没有本地文件／执行能力的客户端，说明需要能本地构建和上传的 AI 客户端。不退回云端 Git 构建，也不要声称只安装 Skill 就完成了某个客户端的连接。遇到“随便弄”“不懂部署”等表达时，按项目推断最小可用方案，不扩大公开范围、不删除数据、不重复创建应用。
