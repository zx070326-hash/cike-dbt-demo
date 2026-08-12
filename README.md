# 此刻｜DBT 心理自助技能助手 Demo

面向 18 岁以上成人内部测试的移动端优先原型。它不是诊断或治疗工具，也不替代心理咨询师或精神科医生。

当前版本已完成一个可运行的本地闭环：两册扫描版 DBT 资料经过逐页 OCR，生成保留书名、PDF 页码、印刷页码、原文字符区间与置信度的 V2 知识包；服务端先做危机与诊疗边界拦截，再通过 Evidence Wiki 扩展问题并检索来源精确片段，最后选择受约束模型生成、人工核验模板或仅展示检索结果。“核对事实”另有六步结构化练习，记录只保存在当前浏览器。

V2 已建立自动覆盖门禁：两册共 1176 个 PDF 页均在来源清单中，1156 个非空页面形成 1189 个原文片段，681595 个 OCR 字符覆盖率为 100%，孤立非空页面和 Wiki 证据断链均为 0。这证明内容进入了可引用知识底座，不等于 OCR、技能解释或临床安全已经完成人工/专业验证。完整设计见 [V2 第一性原理架构](docs/V2_FIRST_PRINCIPLES_ARCHITECTURE.md)。

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

`npm test` 会重新构建站点并验证页面渲染、书内检索、资料外拒答、诊疗边界和危机优先路由。

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

没有密钥时系统仍可完整演示检索、引用、安全边界和“核对事实”练习；正念、痛苦耐受、行为链和 DEAR MAN 等核心技能会在相邻书页能验证关键概念时返回固定解释模板，其他问题则返回原始证据或停止回答。配置模型后，模型只能看到最近六条受限对话和本轮召回页面，返回的引用 ID 会在服务端白名单校验，回答还会经过第二次证据支持检查和核心技能结构校验；结构无效、遗漏核心组成、含个人情境代填推断、核验失败或供应商异常时自动降级。对话内容会发送给所配置的第三方模型供应商处理，界面会提醒测试者不要输入身份信息。

## 实现边界

- 当前是来源精确片段上的“Evidence Wiki 扩展 + BM25 风格稀疏排序”检索，不是最终的生产级向量/重排服务，也没有把检索命中当成疗效或临床安全证明。
- 只有“核对事实”完成了结构化多步工作流；其他技能仍是带原页引用的资料学习模式。
- 危机拦截仅为产品原型能力，尚未经过临床验证、独立红队或真实转介演练。
- 已建立服务端持久化与私有书籍资产的数据结构，但账号、加密读写、导出和删除尚未接入页面；当前练习记录仍只在浏览器本地。
- 尚未确认两册书的商业使用授权，因此不公开部署扫描页或完整 OCR 语料。
- 接入真实用户前仍需专业人员抽检、隐私与数据保留方案、人工转介机制以及至少百例普通/边界评测和独立危机红队集。
