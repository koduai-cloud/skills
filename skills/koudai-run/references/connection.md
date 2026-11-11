# 连接与排错

CLI 位于本 Skill 的 `scripts/appisle.mjs`，需要 Node.js 24+。用绝对路径执行，在用户的项目目录中工作；脚本不会安装依赖、运行构建或上传整个源码项目。

## 安装与审阅

通过 `npx skills add koduai-cloud/skills --skill koudai-run` 安装完整目录。只读取 SKILL.md 不能替代安装，CLI 及引用文档必须一起保留。需要跨项目使用时加 `-g`；需要指定客户端时用 `-a codex`、`-a claude-code` 或 `-a cursor`。只读审阅不运行脚本、不创建 OAuth 连接。

手动安装时，从仓库获取完整的 `skills/koudai-run/` 目录，放到客户端支持的 Skill 位置。Claude Code 可使用 `~/.claude/skills/koudai-run/` 或项目 `.claude/skills/koudai-run/`，见 [官方目录说明](https://code.claude.com/docs/en/skills)。已有同名目录时先检查，保留用户修改。其他客户端使用其正式安装入口，不绕过第三方执行限制。

CLI 需要 Node.js 24+ 和本地文件、命令执行能力，无需安装 Docker 或登录镜像仓库。遇到镜像仓库登录提示时，检查是否误选了自定义镜像构建流程。资源 ZIP 与官方运行时的部署方式见 [打包约定](packaging.md)。

默认服务地址为 `https://koudai.run`。本机 CLI 的 OAuth 回调必须与用户浏览器在同一台电脑。Claude 网页端等云端沙箱无法通过用户电脑的 loopback 完成此流程；只有远程 MCP 的客户端也无法打包本地项目。不要求用户复制凭据或向公网开放回调端口。

## 更新机制

本仓库版本由 skills CLI 管理更新：

```text
npx skills check
npx skills update koudai-run
```

更新后重新读取 SKILL.md 和本次任务需要的引用文件。CLI 的 `node <cli> update` 及 `update --check` 只返回上述更新方式，结果中的 `check_performed: false`、`update_available: null` 表示尚未检查可用版本，不能据此报告已是最新。

业务命令使用已安装版本，不请求平台的 Skill 更新接口，不替换文件，也不写入平台更新来源。`update --url` 会返回明确错误；业务命令中的 `--url` 仍用于选择用户指定的平台。官网直接下载的安装包使用自己的更新流程，本仓库版本独立管理。

CLI 文件名、OAuth 客户端及凭据存储格式、`.appisle/project.json` 保持兼容。先用 `auth status` 核实已有授权；更名本身不要求重新授权或创建第二个应用。若两个安装版本同时存在，在验证新版本后通过客户端入口移除旧 Skill 文件夹，保留授权和项目关联。

## 第一次使用

```text
node <cli> login --url <平台地址>
node <cli> auth status
node <cli> spaces
```

`login` 使用 OAuth 授权码、S256 PKCE 和只监听 `127.0.0.1` 的临时回调端口。浏览器打开平台后，新用户选择注册；完成注册后仍须点击授权。`--no-browser` 输出含 `authorization_url` 的 JSON，适合代理通过可用浏览器工具打开，或交给用户在运行脚本的同一台电脑打开。不要在远程设备访问 loopback 回调地址。

`--timeout` 是毫秒，默认五分钟。取消、超时或回调失败可重新执行 login，旧链接不再使用。授权 URL 不是登录凭证，但也无需长期保存在文档里。

## 没看到授权页

`login` 会尝试打开浏览器，并一直等到回调或超时。用户可能始终看不到授权页。发起授权后，在同一轮对话里发出下面的原文。随后停下来等用户回复。若命令会占住对话，就用仍能接收回复的方式运行 `login`。先拿到 `authorization_url` 再提问。

```text
请在打开的页面登录口袋空间，确认是你的账号后点击「授权」。
完成后回复「好了」。
如果浏览器没有出现授权页，回复「没看到授权页」。
```

- 「好了」：用 `auth status` 确认有效连接，或确认这次 `login` 已返回成功，然后再继续。尚未连接就说明还差哪一步，并再次发出上面的原文。
- 「没看到授权页」：按下面顺序处理。每做完可操作的一步，都请用户再回复「好了」或「没看到授权页」。

1. 确认这次 `login` 仍在运行。进程已退出、被取消或超时后，结束残留进程，重新执行 `login`，只用新打印的 `authorization_url`。
2. 再打开一次授权页。能控制浏览器就打开该链接；否则把完整 `authorization_url` 发给用户，请其在运行命令的同一台电脑上手动打开。不要把 `127.0.0.1` 回调地址交给另一台设备。
3. 请用户检查弹窗拦截，以及浏览器或系统是否拦住了新窗口，允许后重试。没有图形界面、没有默认浏览器，或打开命令失败时，同样改为手动打开链接。
4. 页面出现后，注册或登录，确认是自己的账号，再点击「授权」。
5. 仍然没有页面时，结束当前 `login`，重新执行，换一个浏览器打开新链接。
6. 以上仍看不到授权页时，告诉用户可以联系平台。用户要求提交后，按 [提交工单](support.md) 写上客户端名称、时间和「没看到授权页」；不要附上密码、验证码、Token 或授权链接。

本机 CLI 收到有效回调后先交换令牌并保存凭证，成功才跳回所选平台 `/start` 的第三步；回跳只携带公开客户端 ID，不携带 code、state 或 Token。失败会显示重试提示。控制台会再次查询本账号的真实连接，不能仅靠 URL 参数认为已经完成授权。已安装且已连接的同一客户端可以在任何对话中调用，后续不要重复授权。第三方远程 MCP 客户端仍遵循其注册的 OAuth 回调。

CLI 自动保存、续期连接，不需要手动复制 Token；授权有效期 180 天。`APPISLE_CONFIG_DIR` 可指定凭证目录；测试时指定项目产物目录之外的独立位置。`APPISLE_URL` 或 `--url` 指定平台；已有项目绑定以 `.appisle/project.json` 记录的 URL 为准，都没有时使用上次登录的平台，再退回默认服务 `https://koudai.run`。不得修改项目映射，把同一个应用悄悄部署到另一平台。项目映射指向的平台既不是默认平台、本机也没有它的授权时，`login` 要求显式 `--url`，避免克隆来的项目把授权流程引到陌生网站。

CLI 写入 `.appisle/` 时自动生成忽略全部内容的 `.appisle/.gitignore`，项目关联、部署包和 `.appisle/private/` 下的私密文件不会被 `git add .` 提交。

`APPISLE_TOKEN` / `APPISLE_TOKEN_FILE` 是已有 API Token 用户的兼容入口。新用户授权无需设置这两个变量。使用这两个变量时，必须同时设置 `APPISLE_URL`，Token 只发送给该平台，其他平台的命令改用各自的 OAuth 授权。OAuth Token 用于 `/mcp`，另支持 CLI 的数据库导出下载端点；不能拿它访问其他管理 REST API。

## 日常命令

应用/空间的环境变量、信息、配额、数据库自动绑定、域名证书和访问管理见 [完整设置管理](management.md)。可用 `tools` 查看当前平台工具清单，`tools --tool <name>` 查询参数，`call --tool <name> --input 参数.json` 执行任何已发布工具。

```text
node <cli> apps [--space ns-...]
node <cli> create --space ns-... --name 我的工具 --type static
node <cli> link --app aid-...
node <cli> pack --dir dist --out .appisle/app.zip
node <cli> deploy --dsl appisle.dsl.json --artifact .appisle/app.zip
node <cli> status
node <cli> logs
node <cli> stop
node <cli> start
node <cli> logout
```

创建应用保存 `.appisle/project.json`；更新不用再次 create。在新的本地目录接手已有应用用 link 建立关联。单次指定已有应用时使用 `--app aid-...`。容器 DSL 直接使用 `python:3.12-slim` 等获准官方仓库中的有效 tag，CLI 原样提交，镜像按需拉取；不要求 Docker 或仓库登录，仓库范围见 [打包约定](packaging.md)。`deploy --no-wait` 仅提交任务；默认等待成功／失败，等待前在 stderr 打印任务 UID，超时不代表任务已取消。部署包上传按大小放宽请求超时。启动和停止默认等待任务；指定 `--no-wait` 时仍需 status 确认最终状态。logout 撤销本地这次授权，不停止应用、不删除数据。

## 使用已连接的 MCP

端点为 `<平台地址>/mcp`，通过 OAuth 登录。工具对应：

| 动作 | MCP 工具 |
| --- | --- |
| 查空间／应用 | `list_spaces` / `list_apps` |
| 创建应用 | `create_app` |
| 上传产物 | `upload_artifact`，参数 `app_uid`、`filename`、ZIP `data_base64` |
| 部署 | `deploy_app`，参数 `uid`、`dsl`、可选 `artifact_uid` |
| 查询状态／日志 | `app_status` / `app_logs`，参数 `uid` |
| 启停 | `start_app` / `stop_app`，参数 `uid` |
| 数据库发现与创建 | `database_types` / `list_databases` / `create_database` |
| 数据库详情与表结构 | `database_detail` / `database_schema` |
| SQL 只读查询／显式写入 | `query_database` / `execute_database` |
| Redis 字符串读写 | `redis_get` / `redis_set` |
| 凭证、改密、删除、重试、导出 | `database_credentials` / `database_password` / `delete_database` / `retry_database` / `database_export` |

数据库 CLI、环境变量绑定、Redis 前缀限制和导出格式见 [databases.md](databases.md)。详情中的 `/mcp?database_uid=db-...` 在服务端限定到该数据库，仍需要正常 OAuth 授权。读取凭证时直接写入受限本地文件，不将密码输出到对话或源码。

`app_status` 的 `application` 是应用，`latest_deployment` 是最近任务。必须核对任务 UID；后续任务覆盖了查询结果时，不能拿另一任务的成功冒充本次成功。连接的 MCP 不会自动保存本地项目关联，代理需要把 `app_uid`、`platform_url` 写入 `.appisle/project.json`，并在 `.appisle/.gitignore` 写入 `*`。

## 失败处理

- 无连接／401：检查平台地址，用 login 重新授权；不读取用户密码或换到其他账号规避。
- 没看到授权页：按 [没看到授权页](#没看到授权页) 请用户回复「好了」或「没看到授权页」，再打开链接、检查拦截或重新 login。
- 403：当前账号没有该应用／空间的管理权限。检查已有账号及空间角色。
- 应用关联已存在：使用 status 和 deploy 更新现有应用；新项目放在新的本地目录。
- ZIP 失败：确认只打包构建输出、入口在根目录、大小和路径符合约定。
- 部署失败：查 logs。镜像拉取失败需修正镜像或 registry；不可将宿主机 Docker socket、特权或管理员 kubeconfig 交给应用。
- 应用链接要求登录：先用 `app_status` 核对实际访问方式和空间限制。所有人可访问的应用无需平台登录。指定人或空间成员访问时，需使用已获授权的账号。应用邀请链接须先确认加入，开启审批时须等待通过。不要改成所有人可访问来绕过访问检查。
- 页面能打开但数据失败：SDK 仅可在部署后的应用域名调用，先检查当前登录和成员身份，再处理真实错误。

WorkBuddy、ChatGPT、Claude 的安装界面、文件能力与连接权限各自不同。本目录是通用 Skill，`agents/openai.yaml` 是可选元数据；它不是三个产品的通用插件 manifest。只有实际完成对应客户端安装和授权，才报告该客户端接入成功。
