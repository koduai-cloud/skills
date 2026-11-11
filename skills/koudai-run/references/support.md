# 提交工单

用户明确要求联系平台、提交问题或申诉时，使用 `create_ticket`；是否参与用户体验改善计划，不影响用户主动提交工单。不要因出现报错、能力缺口或遥测失败自行创建工单。

先整理标题、必要的操作步骤、时间、错误类别和影响；工单内容会通知平台内部飞书支持群。去掉密码、验证码、Token、数据库连接串、密钥、完整对话和业务数据，不要自动收集源码或原始日志。用户已经明确给出并要求提交的问题，直接按授权提交；缺少必要问题描述时再询问。已有具体提交授权时不重复确认。

`create_ticket` 参数：`title`（3–120 字）、`content`（5–10000 字）、`category`（general/deployment/billing/account，默认 general）、`priority`（normal/high/urgent，默认 normal）。确属紧急问题才用 urgent，紧急工单会通知所有群成员。

CLI：

```text
node <cli> ticket-create --title "应用更新失败" --content-file .appisle/private/issue.txt --category deployment --priority normal
node <cli> tickets --search "应用更新失败"
node <cli> ticket --ticket <实际工单 UID>
```

正文文件由用户本次授权的问题说明组成，不从其他文件自动拼接敏感材料。创建成功后返回工单编号、可点击的 `url`，告诉用户可在详情查看支持回复、继续补充信息。账号拥有工单，不随空间切换而改变。

提交超时或结果不明时，用 `list_tickets` 核对本人的近期工单，必要时 `ticket_detail` 查看；无法确认就说明结果未知，不重复创建。不能读取他人工单，数据库专用 MCP 授权也不开放工单工具。
