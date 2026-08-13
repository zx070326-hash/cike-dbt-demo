# 此刻｜DBT 心理自助技能助手 Demo

面向 18 岁以上成人内部测试的移动端优先原型。它不是诊断或治疗工具，也不替代心理咨询师或精神科医生。

当前版本完成了质量优先的 V3 对话闭环：服务端先处理危机、他人安全与诊疗/用药边界，再判断用户此刻更需要倾听、稳定、澄清、学习还是练习；随后从两册 DBT 资料中检索可追溯证据，并以“陪伴对话”或“知识伴读”两种模式推进一个小步骤。专业知识、技能卡与来源默认折叠展示，练习记录只保存在当前浏览器。

知识层已建立自动覆盖门禁：两册共 1176 个 PDF 页均在来源清单中，1156 个非空页面形成 1189 个 source-exact 原文片段和 1156 个父上下文块，681595 个 OCR 字符覆盖率为 100%，孤立非空页面和证据断链均为 0。18 张结构化技能卡当前只用于导航，尚未经过专业审核。这些指标证明内容进入了可引用知识底座，不等于 OCR、技能解释、用户体验或临床安全已经完成人工验证。完整设计见 [V3 质量优先架构](docs/V3_QUALITY_FIRST_ARCHITECTURE.md) 和 [RAG / Evidence Bundle 契约](docs/V3_RAG_EVIDENCE_CONTRACT.md)。

## 本地启动

```powershell
npm install
npm run dev
```

默认地址：`http://localhost:3000`。

## 验证

```powershell
npm run lint
npm test
```

`npm test` 会重新构建站点，并验证生产 API、客户端交互、双模式表达、重复回复防护、书内检索、引用、诊疗边界、危机优先路由和多轮会话状态。

本地模型服务启动后，可以另行运行真实供应商冒烟测试：

```powershell
npm run test:model
```

## 重新摄取资料

Python 环境安装 `tools/ocr/requirements.txt` 后：

```powershell
.venv\Scripts\python.exe tools\ocr\full_ingest.py --workers 8 --dpi 105
npm run rag:build
npm run knowledge:build
npm run knowledge:validate
```

OCR 中间文件位于 `data/ocr/`，不会提交到版本库；页级来源索引为 `data/rag/index-v1.json`，V2 知识包为 `data/knowledge/knowledge-v2.json`，公开覆盖摘要为 `data/knowledge/manifest-v2.json`。V2 构建会验证每个片段是页级原文的精确切片，并检查所有非空字符、页面和 Wiki 证据链接。摄取器开启文字方向分类；复杂表格页仍可能出现阅读顺序错乱。OCR 置信度只反映识别模型的行级打分，不等于文字准确率，关键结论仍需对照原页复核。

## 可选闭源模型

复制 `.env.example` 为 `.env.local`，设置 `MODEL_PROVIDER`、`MODEL_API_KEY`、`MODEL_NAME` 和 `MODEL_BASE_URL`。支持 OpenAI-compatible Chat Completions 与 Anthropic Messages 两种适配方式。

没有密钥时系统仍可演示检索、引用、双模式表达、安全边界和结构化练习。配置模型后，模型只能看到受限对话历史和本轮 Evidence Bundle；引用 ID 会在服务端白名单校验，回答还会经过证据支持、重复性、结构和安全复核。结构无效、含个人情境代填推断、核验失败或供应商异常时自动降级。对话内容会发送给所配置的第三方模型供应商处理，界面会提醒测试者不要输入身份信息。不要把真实密钥提交到 Git；本地使用 `.env.local`，部署时使用平台 Secret/环境变量。

## 实现边界

- 当前是来源精确片段上的多信号检索、父块补全、来源质量过滤和 Evidence Bundle，不是生产级临床系统，也没有把检索命中当成疗效或安全证明。
- “陪伴对话”与“知识伴读”共享同一证据层，但采用不同表达顺序；每轮默认只推进一个问题、技能或动作。
- 危机拦截仅为产品原型能力，尚未经过临床验证、独立红队或真实转介演练。
- 已建立服务端持久化与私有书籍资产的数据结构，但账号、加密读写、导出和删除尚未接入页面；当前练习记录仍只在浏览器本地。
- 尚未确认两册书的商业使用授权，因此不公开部署扫描页或完整 OCR 语料。
- 接入真实用户前仍需专业人员抽检、隐私与数据保留方案、人工转介机制以及至少百例普通/边界评测和独立危机红队集。
