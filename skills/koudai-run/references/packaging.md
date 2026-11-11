# Packaging and deployment

Use JSON DSL version 1. The API rejects unknown fields and low-level Kubernetes/workerd security configuration. The platform chooses namespaces, services, runtime security, and routing. Do not submit Kubernetes YAML.

## Static

Build the site locally. ZIP the **contents** of its output directory, with `index.html` at the ZIP root; not a containing `dist/` directory. Limits: ZIP 32 MiB, extracted 128 MiB, 2000 files, no symlinks or parent/absolute paths.

```json
{"version":1,"type":"static"}
```

Static applications use the shared file-serving service; no dedicated application Pod is created.

## workerd

Bundle dependencies locally into one ES module exporting `default { async fetch(request, env, ctx) { ... } }`. ZIP it as `index.js` at the root. TypeScript must first be compiled locally. Node.js server APIs require the platform official Node.js source runtime instead. Native executable applications are unsupported.

```json
{"version":1,"type":"workerd","worker":{"entry":"index.js","compatibility_date":"2026-09-01"}}
```

User-supplied workerd configuration is not accepted. The platform creates the process configuration and outer workload. The local test environment must not be described as production hardened isolation.

## Official interpreted runtime

Upload a ZIP containing inspectable source and use one official Linux/amd64 Python, Node.js or PHP runtime. The wire-format name remains `container_group`, but custom container groups and custom images are unsupported. Java, Go, C/C++, .NET, native executables, JAR/class files, WASM, native modules and nested runtime archives are outside the supported publishing scope. Do not disguise them as source, launch them through an interpreter or fetch them after deployment. Static assets such as images, fonts and PDFs remain supported.

| Language | Official repository | Startup executable |
| --- | --- | --- |
| Python | `docker.io/library/python:*` | `python` or `python3` |
| Node.js | `docker.io/library/node:*` | `node` |
| PHP | `docker.io/library/php:*` | `php` |

Use references such as `python:3.12-slim`, `node:24-bookworm-slim` or `php:8.4-cli`. Only the exact official repository identity is allowed; similarly named custom registries or namespaces are not. Tags must exist upstream and support Linux/amd64. Official repository digests are also accepted. The platform's additional image approval policy may be narrower. Do not build or push images or require Docker/registry login.

Declare exactly one container and an explicit matching interpreter command. Start the HTTP listener on `0.0.0.0`. Shell startup, arbitrary executable commands, database sidecars and opaque compiled dependencies are unsupported. Prepare pure-language dependencies locally using lockfiles and include them with source. The platform inspects every new or updated publication; unsupported runtime packages are blocked from access while remaining manageable.

```json
{
  "version":1,
  "type":"container_group",
  "entry_container":"web",
  "containers":[
    {"name":"web","image":"node:24-bookworm-slim","port":8080,"persistent_path":"/data","run_as_user":1000,"command":["node","server.js"]}
  ]
}
```

Upload the ZIP with `deploy --dsl appisle.dsl.json --artifact .appisle/app.zip`, including multi-file applications rather than embedding code in the DSL. ZIP limits are 32 MiB compressed, 128 MiB expanded and 2000 files, with no links or unsafe paths. `/app` is writable ephemeral space (256 MiB); updates replace it. `persistent_path` requests an application-scoped persistent volume for durable user data, and `/tmp` provides 64 MiB of shared scratch space. The root filesystem stays read-only. Supported additional container fields are `command`, `args`, and `env`. No privileged mode, host paths, host network, or service-account tokens.

### Timezone and mainland package sources

The platform mounts managed, read-only timezone files at `/etc/localtime`, `/etc/timezone`, and `/usr/share/zoneinfo/Asia/Shanghai`, and defaults `TZ=Asia/Shanghai`. Explicit application/space/container environment values keep their normal precedence.

Container defaults include `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com` and `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`. Prefer a bundled Node application or prepared pure-Python/PHP dependencies. Pin dependencies with a lockfile or requirements file. Do not use shell bootstrap commands, install operating-system packages, download native executables, or switch to custom images.

`allow_internet` defaults to `true` when omitted. Set `allow_internet:false` explicitly to disable public outbound HTTP/network access; saving or redeploying preserves this choice. Cluster/private/metadata addresses stay blocked except for the exact database pool endpoints authorized by the platform, which remain reachable when public outbound access is disabled. Keep secrets outside artifact content and plain DSL fields. Managed database bindings inject credentials at deployment without storing them in the DSL.

## Persistence

For browser identity and data APIs, read [data.md](data.md). For SQL / Redis, first discover and use the platform's [managed databases](databases.md); a separate database container is unnecessary when a suitable pool is available. The top-level `databases` DSL field accepts `{uid, container, env_prefix}` bindings to databases in the same space. For CLI authorization and commands, read [connection.md](connection.md).


## Application resources and type changes

Use the platform's managed database pools; custom database sidecars and user-defined container groups are unsupported. Connect through declared database bindings and retain the same application UID when changing supported runtime type.

Every application includes free basic resources. Set top-level `compute_units` to 0 (basic), 1, 2, 3 or 4; paid tiers reserve the entire selected CU amount from the space's extra pool, not only the difference from basic resources. Free and Personal plans have no extra CU. The single interpreted runtime uses the selected application tier. Present only basic resources and CU labels to users; CPU/memory fields are internal compatibility details. A tier maps internally to 500m CPU / 1024 MiB per CU (basic remains 250m / 512 MiB). The declared persistent mount uses the application PVC. Preserve existing persistent paths and data layouts during updates.

Switching static → workerd/container or container → static uses a new DSL in `deploy`, reusing the same application UID. Upload a new resource ZIP for the target runtime. Moving to static stops/removes the old compute workload while retaining its PVC. Application deletion also retains its PVC and saved configuration for administrator recovery; restoration leaves the application stopped until explicitly started or deployed. Moving back can reuse the data. Never treat changing runtime as permission to discard or expose data.

Public access permits anonymous HTTP requests only on hosts allowed by the application access settings. Password access requires a valid host-bound password session. Inspect app_status.application.access_options and verify the intended entry point. Platform SDK identity/data endpoints continue to require member login; publishing a domain does not make existing private per-user data public. If the user wants an anonymous public service with its own data model/authentication, implement those endpoints in their backend.


### 就绪检查与小型解释型程序

声明了 `port` 的容器会接受 Pod IP 上的 TCP 就绪检查，因此对应服务应监听 `0.0.0.0`，只绑定 `127.0.0.1` 会导致一直等待就绪。只有解释型服务的入口端口进入应用 Service 和网关，托管数据库通过绑定提供连接。没有监听端口的后台任务不要填写 `port`。入口服务应在依赖可用后才对业务请求返回成功，并对数据库启动做有限重试。

Python/Node 程序优先上传多文件资源 ZIP 并使用官方运行时镜像，`command`/`args` 仅声明启动命令；整个 DSL 不超过 64 KiB。依赖应为可审查的纯解释语言内容，不携带原生模块或编译产物。不要让用户登录 Docker 仓库或提供服务器 SSH 作为正常发布流程。

入口代码必须在源码包中。不要用 `NODE_OPTIONS`、`PYTHONPATH`、`PHPRC`、`LD_PRELOAD` 等启动或加载器环境变量改变解释器行为；平台检查合并后的容器、应用和空间配置，发现这类配置会拒绝发布并限制应用访问。普通业务环境变量仍可使用。

小型 Node.js 数据库应用可在本地把锁定版本的纯 JavaScript 驱动和后端打成单个 bundle，再检查完整 JSON DSL 的字节数。应用启动后先确认数据库连接和必要的建表已成功，再开始监听服务端口；通过绑定的 `DB_*` 环境变量连接，前端只访问同源后端。成功后用 `database-schema` / `database-query` 核对应用实际写入的表和记录，不能只以数据库资源 `ready` 判断应用已经接通。
