# 此刻｜NSSI · DBT 数字化干预一期

面向 18 岁以上成人的 DBT 取向数字化心理自助与远程辅助系统。产品提供 8 周 16 模块、每日 EMA、规则驱动 EMI、六段式数字安全计划、情绪与技能记录、受限知识对话、教练风险队列和版本化配置。它不提供诊断、处方或紧急救援，也不能替代医生、咨询师和现实中的支持。

当前部署（内部工程审阅）：[Cloudflare Workers](https://cike-dbt-demo.zx070326.workers.dev/)

## 架构原则

- 协议状态机决定模块解锁、完成、阈值与升级；Agent 对这些状态只读。
- 确定性安全规则先于检索和生成；独立语义分类器只能增加风险触发，不能取消确定性触发。
- 一个 Agent 服务统一处理对话与提醒个性化；模型输出必须经过阶段限域、引用、禁答、长度与语气校验。
- 日常引导与专家核对共享同一证据。日常模式默认折叠来源；专家模式展示专业主张到原文段落的映射。
- 危机界面和安全计划不依赖自由生成；模型不可用时，协议、EMA、安全计划和确定性对话仍可工作。

## 已实现范围

- 8 周 16 模块课程目录、前置条件和周一/周四计划任务；
- EMA、补记、连续记录、阈值风险事件与三类 EMI；
- 六段式安全计划、版本历史、本机离线副本与全局求助入口；
- 7/30 天趋势、情绪分布、技能频率和规则化效果汇总；
- Cloudflare D1 持久化、AES-GCM 敏感字段加密、追加式哈希审计链；
- 参与者导出/删除、风险与审计去标识化保留、匿名研究 CSV；
- 教练风险队列、用户总览、会话/来源审计、安全计划历史；
- 管理配置草稿、版本、评测门禁和激活流程；
- Cloudflare Cron 调度与站内通知；外部教练 Webhook 接口已保留。

## 知识与引用

两册材料共 1176 个 PDF 页面、1189 个 source-exact 原文分块、1156 个父上下文块和 681595 个非空 OCR 字符，字符覆盖率 100%。每条来源包含书名、章节、PDF/印刷页码、片段 ID、字符区间和稳定段落锚点。18 张结构化技能卡只用于检索导航，当前均明确标记为未完成专业审核。

原始扫描页不随公网 Worker 发布。OCR 与清洗文本属于内部开发资料；正式试点或商业使用前必须完成版权授权和临床内容审核。

## 本地运行

```powershell
npm install
$env:NSSI_ALLOW_EPHEMERAL_STORE = "true"
$env:COACH_ACCESS_TOKEN = "local-coach-token"
$env:ADMIN_ACCESS_TOKEN = "local-admin-token"
npm run dev
```

默认参与者端为 `http://localhost:3000/`，教练端 `/coach`，管理端 `/admin`。本地临时存储仅用于开发，重启会清空，不得用于真实参与者。

## 验证

```powershell
npx tsc --noEmit
npm run lint
npm test
npm run eval:phase1
```

当前自动化回归 66/66 通过。冻结评测包含 212 条安全输入和 112 条忠实度输入；最新机器评测见 [评测结果](reports/nssi-phase1-evaluation-latest.json)，需求追踪与人工验收边界见 [一期追踪矩阵](docs/NSSI_PHASE1_TRACEABILITY.md)。自动评测不构成临床有效性、伦理或医疗器械结论；语气 30 条双人盲评仍需临床团队执行。

## Cloudflare 部署

生产部署使用 `wrangler.deploy.jsonc`、D1 与 Worker Secret。先按顺序执行 `drizzle/0000` 至 `0003` 迁移，再配置以下 Secret：

- `DATA_ENCRYPTION_KEY`
- `MODEL_API_KEY`
- `COACH_ACCESS_TOKEN`
- `ADMIN_ACCESS_TOKEN`
- `COACH_NOTIFICATION_WEBHOOK`（甲方确认真实通知通道后配置）

```powershell
npm run build
npx wrangler deploy --config wrangler.deploy.jsonc
```

密钥不得写入源码、提交历史或前端变量。当前机器生成的 Cloudflare 教练/管理员访问令牌保存在仓库外 `D:\DBT\.nssi-cloudflare-access.json`，并限制为当前 Windows 用户读取。

## 上线门禁

当前是可运行、可持久化的内部工程版本，不是已获准面向真实患者的生产服务。以下事项仍由外部责任方完成：甲方人工风险处置角色与 SLA、真实通知通道、资料版权授权、临床内容/词表/阈值审核、语气双盲评、隐私保留期与法律依据、真机断网冷启动验收。系统不会把这些未确认事项伪装成“已完成”。
