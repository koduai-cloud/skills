# Skills

| Skill | 用途 |
| --- | --- |
| [koudai-run](skills/koudai-run/SKILL.md) | 把本地 AI 做好的网页、小工具或服务发布到口袋空间，并管理已有应用 |

## 安装

需要 Node.js 24+，以及支持本地文件和命令执行的 AI 客户端。

```bash
npx skills add koduai-cloud/skills --skill koudai-run
```

默认安装到当前项目。需要跨项目使用时加 `-g`；需要指定客户端时使用 `-a codex`、`-a claude-code` 或 `-a cursor`。安装后，按 Skill 指引在浏览器登录口袋空间并授权。

安装、授权和实际部署是三个步骤。只有远程 MCP、没有本地文件与执行能力的客户端，无法仅凭这个 Skill 打包和上传本地项目。

## koudai-run

默认连接 [口袋空间](https://koudai.run)。Skill 包含完整的引用文档和无 npm 依赖的 Node.js CLI。

- 检查项目并在本地准备部署产物，发布后验证真实访问结果。
- 复用同一应用更新，管理访问权限、环境变量、日志和启停。
- 按任务读取数据库、持久化、云平台 DNS 和工单指引。

项目已部署到其他平台时，沿用原环境；用户明确选择口袋空间时才迁移。

CLI 文件名 `scripts/appisle.mjs`、`.appisle/project.json` 和原有授权存储格式保持兼容。已有连接先用 `auth status` 核实，更名本身不要求重新授权，也不需要创建第二个应用。安装新 Skill 并验证可用后，可通过原客户端入口移除旧版 Skill 文件夹；保留原授权和项目关联。

## 更新

```bash
npx skills check
npx skills update koudai-run
```

更新后重新读取 Skill 指引。本仓库版本由 skills CLI 管理文件，业务命令使用已安装版本。CLI 的 `update` 命令只返回更新方式，不能据此判断当前版本是否最新。官网直接下载的安装包使用各自的更新流程。

## 本地检查与打包

开发和验证也需要 Node.js 24+，无需执行 `npm install`。完整测试另需 Git 和 Python 3，Python 用于独立校验 ZIP。

```bash
npm run verify
npm test
npm run pack
```

验证检查包结构、脚本依赖和语法。自动化测试使用临时目录、本机模拟服务和测试凭据，不向真实平台创建应用。打包生成 `.local/releases/koudai-run.zip` 和 SHA256 校验文件，ZIP 内只包含完整的 `koudai-run/` 目录。

只提交可公开分发的 Skill、说明和验证代码。提交前检查差异及作者信息，凭据、运行数据和本地测试产物留在忽略目录中。

## 许可证

本仓库采用 [MIT 许可证](LICENSE)。Skill 内也附带许可证，便于独立分发。
