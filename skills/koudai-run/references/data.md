# 应用数据与身份

浏览器应用通过自身域名访问平台数据，不能把管理 API Token 放进页面。HTML 引入：

```html
<script src="/_appisle/sdk.js"></script>
```

`await appisle.me()` 返回 `{uid,nickname,avatar,app_uid}`。UID 是公开标识，不是权限凭证。手机号不返回给应用。

## 个人或共享数据

- `scope:'user'`：同一登录用户在不同设备上使用同一份数据，其他成员的同名键相互隔离。
- `scope:'app'`：所有获准访问此应用的成员共享同一份数据。没有额外的业务角色限制。

由应用的实际需求选择。共享清单可以用 app；个人工作记录默认 user。不要把邀请权限等同于某种业务管理员身份。

```javascript
const key = 'todos';
const saved = await appisle.data.get(key, 'user');
const items = Array.isArray(saved.value) ? saved.value : [];
const next = await appisle.data.set(key, [...items, {title:'完成第一个应用',done:false}], {
  scope: 'user',
  revision: saved.revision
});
// 保存 next.revision，用于下一次修改。
```

不存在的键返回 `{key,value:null,revision:0}`。传入 revision（包含首次的 0）可防止并发覆盖；冲突返回 HTTP 409，重新加载数据并提示用户，不静默覆盖另一端修改。UI 仅在保存成功后显示“已保存”，失败要保留输入并允许重试。更新部署不能清空数据或更换现有键名。

SDK 遇到非成功 HTTP 响应会抛出 `Error`，其中 `error.status` 是 HTTP 状态码，`error.message` 是平台错误信息；网络失败可能没有 status。用 `error.status === 409` 识别并发冲突。

## 登录与访问方式

新应用默认所有人可访问，访客打开页面时可能尚未登录：`me()` 和数据接口返回 401。页面需要提供「登录」按钮，调用 `appisle.login()` 跳转平台登录，完成后回到当前页面（也可传入站内路径，如 `appisle.login('/todos')`）。不要在页面加载时自动跳转，以免公开内容无法浏览。

SDK 数据只对有权访问该应用的账号开放：应用成员、空间管理员，以及访问方式允许的空间成员。所有人可访问的应用中，已登录但不是成员的账号会收到 403，应提示「需要应用管理员邀请」，不要反复要求登录。个人清单这类只给自己或少数人用的应用，建议改为指定人可访问并用邀请链接添加他人；面向所有访客、各自保存数据的服务，需要在自己的后端实现账号与存储。

```javascript
try {
  const me = await appisle.me();
  showUser(me.nickname);
} catch (error) {
  if (error.status === 401) showLoginButton(() => appisle.login());
  else if (error.status === 403) showNotice('需要应用管理员邀请后才能保存数据');
  else throw error;
}
```

页面渲染用户输入时使用 textContent 或框架的默认文本转义。

`appisle.data.delete(key,scope)` 删除键；删除没有 revision 参数，整份清单的并发修改优先使用 set。限制：每个 JSON 值 1 MiB，整个应用 32 MiB。需要大文件、关系查询或业务后端时使用适合的容器存储方案，不假称此 API 是完整数据库。

## 原始同源 API

- GET `/_appisle/login?return_path=/站内路径`：跳转平台登录
- GET `/_appisle/me`
- GET `/_appisle/data/get?key=todos&scope=user`
- POST `/_appisle/data/set`：`{key,value,scope,revision?}`
- POST `/_appisle/data/delete`：`{key,scope}`

成功响应 `{code:0,message:"ok",data:...}`。浏览器携带同源 HttpOnly 应用 cookie；服务器每次检查登录、应用和空间成员关系。不要自行传入用户 UID 代替身份校验。上述路由不用于管理域名，也不能在本地 file:// 页面直接使用。口袋空间 SDK 不创建独立登录账号。

workerd 暂无服务端 KV binding；需要持久化的轻量前端可以直接使用上述浏览器 SDK。官方 Python／Node.js／PHP 解释型服务可把需保留的文件放在 DSL 的 `persistent_path`，不要存入只读根目录。持久卷保留于启停和重新部署；删除应用也会保留持久卷与数据，停止访问并等待运维按需恢复，保留存储仍计入用量。删除应用不等于清空数据；独立数据库的删除另有规则。
