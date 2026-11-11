# 平台托管数据库

`<cli>` 是本 skill 的 `scripts/appisle.mjs`。复用已有 OAuth 授权，不向用户索取数据库池的超级密码。数据库按空间归属，所有者和空间管理员可管理。UID 为 `db-` 加 8 位随机小写英文或数字；SQL 数据库名和账号把连字符换成下划线。Redis 没有 SQL 数据库名。

## 发现与创建

```text
node <cli> databases --space ns-...
node <cli> database-types --space ns-...
node <cli> database-create --space ns-... --name 网站数据 --engine pgsql-18
node <cli> database-info --database db-xxxxxxxx
```

类型枚举严格为 `mysql-80`（MySQL 8.0）、`pgsql-18`（PostgreSQL 18）、`redis-7`（Redis 7）。没有可用池时不能创建。可创建的数量以空间有效配额为准。创建、改密或删除失败时资源会保留操作状态，使用 `database-retry --database ...` 重试同一资源，不重复创建。记录数据库 UID 到项目文档；不要记录密码。

## 应用绑定：不把密码写进项目

首次部署直接声明下面的 `databases`。已有应用用 `app-databases --app aid-... --file bindings.json --deploy`（MCP `set_app_databases`）只更改绑定数组并复用原产物；空数组解除绑定，不删除数据库。未发布应用可省略 `--deploy` 只保存，已发布应用必须显式重新部署并启动。其他 DSL 配置保持不变；详见 [完整设置管理](management.md#数据库自动对接)。

容器应用 DSL 在顶层增加 `databases`。`container` 必须是容器名称，`env_prefix` 是环境变量前缀；一个应用最多 8 个绑定。

```json
{
  "version": 1,
  "type": "container_group",
  "entry_container": "web",
  "containers": [{ "name": "web", "image": "node:24-bookworm-slim", "port": 8080, "command": ["node", "server.js"] }],
  "databases": [
    { "uid": "db-xxxxxxxx", "container": "web", "env_prefix": "DB" },
    { "uid": "db-yyyyyyyy", "container": "web", "env_prefix": "REDIS" }
  ]
}
```

控制器仅允许绑定同空间的就绪数据库，并在部署时从加密凭证生成 Kubernetes Secret。注入 `<前缀>_HOST`、`_PORT`、`_NAME`、`_USER`、`_PASSWORD`、`_URL`、`_TLS_MODE`；Redis 另有 `_DB` 和 `_KEY_PREFIX`。这些变量不能与手写的环境变量重名。连接地址和端口由数据库池给出，不假定 localhost。网络策略自动允许同空间池的精确地址和端口。

上例使用官方运行时镜像，`server.js` 及依赖通过资源 ZIP 上传，部署时同时传 `--artifact`，见 [打包约定](packaging.md)。

workerd 可省略 `container` 将同样的信息注入 Worker 环境；先确认所用数据库驱动是否兼容当前 workerd 的网络能力。普通 Node.js/Python 数据库驱动推荐使用容器运行。静态网站禁止绑定数据库凭证；前端需经后端访问，不能把密码打包进浏览器代码。

密码轮换后重新部署绑定的应用，才能让进程读取新环境变量。导出、改密、删除前先确认实际目标。删除仍被应用绑定的数据库会被拒绝；先修改 DSL 移除绑定并重新部署。

## 内外网直连：不使用 TLS

口袋空间托管数据库无论内网还是外网均不需要也不支持 TLS，使用平台提供的地址、端口和账号密码即可直接连接。`database-info` / `database_detail` 返回的 `tls_mode` 及注入的 `<前缀>_TLS_MODE` 均应为 `disable`。不需要 CA 文件、客户端证书或 PEM 私钥，也不需要到云厂商下载证书；网站域名的 HTTPS 证书与数据库连接无关。

| 数据库／驱动 | 连接配置 |
| --- | --- |
| PostgreSQL / psycopg | `sslmode=disable`。 |
| Node.js `pg` | `ssl: false`；优先使用分项变量，避免连接 URL 中的 SSL 参数覆盖此选项。 |
| MySQL | 不配置 `ssl`，关闭驱动或 ORM 默认启用的 TLS。 |
| Redis | 使用 `redis://`，不使用 `rediss://` 或启用 `tls` / `ssl`。 |

若实际返回的模式不是 `disable`，先核对平台地址和数据库详情，报告配置不一致，不自行修改数据库池。连接失败时检查地址、端口、账号密码和网络权限，不通过启用 TLS、索取证书或设置全局 `NODE_TLS_REJECT_UNAUTHORIZED=0` 解决。

Node.js **`pg`** 直连示例：

```js
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 8000,
});
```

Python **psycopg 3** 直连示例：

```python
import os
import psycopg

conn = psycopg.connect(
    host=os.environ['DB_HOST'], port=int(os.environ['DB_PORT']),
    dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
    password=os.environ['DB_PASSWORD'], sslmode='disable', connect_timeout=8,
)
```

修改后实际连接并写读应用数据，不能以数据库 `ready` 或应用部署成功代替连接验收。连接凭据继续保存在平台注入变量或私密文件中，不展示在回复、日志或部署包中。

## 查询、建表、导出

```text
node <cli> database-schema --database db-xxxxxxxx
node <cli> database-query --database db-xxxxxxxx --file read.sql
node <cli> database-execute --database db-xxxxxxxx --file migration.sql
node <cli> database-export --database db-xxxxxxxx --out backup.sql
```

查询使用只读事务，最多 200 行、约 1 MiB 返回、6 秒超时。执行工具使用租户自己的账号，接受一条 SQL，绝不使用池的超级账号。DDL / 写入由用户的建表、迁移或应用开发指示授权；没有指示时不运行破坏性操作。MySQL DDL 可能隐式提交，不声称整份迁移可事务回滚。表多时 `database-schema` 可能截断，使用带条件的 information_schema 查询分页。

SQL 导出使用原生 `mysqldump 8.0` / `pg_dump 18`，返回 SQL 文件，不包含平台账号或其他库。Redis 导出为 JSON Lines，首行格式标记 `appisle-redis-dump-v1`，之后每行有 DB、Base64 编码的键和 DUMP 值、TTL 毫秒；使用对应版本的 Redis RESTORE 恢复。Redis 导出期间仍可写入，不是原子快照。在线导出上限 256 MiB、50 秒，更大数据量用数据库原生客户端。CLI 不覆盖已存在的导出文件。

## Redis 隔离

客户端必须使用独立用户名、密码和所分配的 DB 编号，并为每个键加上详情中的 `key_prefix`，例如 `db_xxxxxxxx:users`。不要把 DB 编号本身当作安全边界。共享池 ACL 拒绝访问其他前缀、全局扫描、FLUSHDB/FLUSHALL、配置、复制和脚本等命令。需要这些实例级功能时使用独享实例。

MCP 的 `redis_get` 和 `redis_set` 提供受限字符串读写，键必须带完整前缀，值最多 1 MiB；`redis_set` 可指定 `ttl_seconds`（0 为不过期）。

CLI 对应 `redis-get --database db-... --key 完整键名` 和 `redis-set --database db-... --key 完整键名 --file 文本文件 --ttl 秒数`，值从文件读取，不通过命令行传递。

## 密码与 MCP

```text
node <cli> database-credentials --database db-xxxxxxxx
node <cli> database-password --database db-xxxxxxxx --password-file 私密文件路径
node <cli> database-delete --database db-xxxxxxxx --confirm db-xxxxxxxx
```

`database-credentials` 只把密码和连接串写到 `.appisle/private/db-xxxxxxxx.json`，限制目录权限，并输出文件路径；不把文件内容展示在回复、日志、Git 或部署包中。重复获取前移走旧文件。密码 12–64 位，英文大写、小写、数字、符号至少三种；支持符号 `!@#$%^&*()_+-={}[]:,.?/~`。通常应用绑定不需要读出密码，原生客户端或明确需要连接串时再读取。

详情的 MCP 地址形如 `https://平台/mcp?database_uid=db-xxxxxxxx`，没有内嵌密码。需要正常口袋空间 OAuth / Bearer 授权；专属链接只提供当前数据库工具，跨 UID 调用会被拒绝。平台通用 MCP 同时提供 `database_types`、`list_databases`、`create_database`、`database_detail`、`database_credentials`、`database_schema`、`query_database`、`execute_database`、`database_export`、`database_password`、`delete_database`、`retry_database`、`redis_get`、`redis_set`。
