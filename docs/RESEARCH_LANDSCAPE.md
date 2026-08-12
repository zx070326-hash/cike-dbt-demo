# DBT 心理自助 AI：相关项目、设计模式与技术路线调研

调研日期：2026-08-12

## 1. 结论

当前项目不应实现成“一个接上知识库的通用聊天机器人”，也不应让自主 Agent 自由决定心理干预过程。更合适的产品和技术形态是：

> DBT 技能工具箱 + 结构化练习 + 有限生成式对话 + 原始证据 RAG + 独立安全控制 + 可重复评测

当前 Demo 已经验证了“核对事实”的页面和交互闭环。下一步应优先建设完整、可追溯的语料管线和真实 RAG，然后把规则式对话替换为受状态机约束的模型生成。

## 2. 同类产品与项目

| 项目 | 已体现的设计 | 对本项目的价值 | 不能直接照搬的部分 |
|---|---|---|---|
| [Wysa](https://www.wysa.com/faq-clinical-program) | CBT 等循证练习、AI 对话、人类教练、安全计划；明确不适合危机场景和严重持续性问题 | 清晰界定适用人群、把 AI 作为正式照护的补充、单独提供安全计划 | 产品资料和自述证据不能替代独立临床验证 |
| [Woebot](https://woebothealth.com/technology-overview/) | 临床人员参与内容设计；对关注性语言进行检测；长期采用强结构化内容 | 说明心理产品不必追求完全自由生成，临床内容治理比模型“聪明”更重要 | 闭源，无法直接复用实现；也不能把 NLP 检测等同于实时人工危机服务 |
| [VA Mental Health Apps](https://mobile.va.gov/mental-health-and-behavioral-therapy-apps) | 按问题和技能拆分的工具型应用 | 支持“聊天不是唯一入口”的设计；技能库、练习、记录可以独立使用 | 目标人群和医疗体系与国内项目不同 |
| [DBT Diary Card & Skills Coach](https://apps.apple.com/us/app/dbt-diary-card-skills-coach/id479013889) | 参考手册、行为记录、技能教练三部分 | 非常适合本项目的信息架构；日记卡是核心，而非聊天历史 | 商业应用页面不是疗效证据 |
| [DBT-Mind](https://dbt-mind.com/) | 技能库、日记卡、引导练习、危机中心和 AI 教练 | 可借鉴首页信息架构和“当下需要帮助”入口 | 产品声明需独立核验，不应照搬其危机承诺 |
| [Berkeley DBT](https://www.ischool.berkeley.edu/projects/2024/berkeley-dbt) | GPT-4 DBT 技能教练、合成患者对话、DBT 遵循度和技能抽取评测 | 是最接近当前需求的公开项目；值得借鉴其仿真评测和 DBT 专项指标 | 学生 Capstone 原型，不是生产级临床或安全验证 |
| [LLooMi](https://doi.org/10.3389/frai.2026.1712596) | 意图感知、结构化知识库、RAG、提示词约束、尽量不保存个人数据 | 值得采用“意图/紧急度路由”和数据最小化 | 其正确性与相关性评分不等于心理干预有效性或危机安全性 |
| [MedRAG](https://github.com/gzxiong/MedRAG) | 将语料、检索器和模型分离；同时比较 BM25 和语义检索 | 值得采用模块化接口和检索基准 | 面向医学问答基准，不包含多轮心理技能工作流 |

## 3. 开源 RAG 与工作流项目

### RAGFlow

[RAGFlow](https://github.com/infiniflow/ragflow)有扫描文档解析、可视化切分、引用展示和人工干预能力。它适合用作 OCR/切分效果的对照工具或快速后台，但整套系统较重，而且心理安全逻辑仍需自行实现，因此不建议直接作为正式运行时核心。

### Dify

[Dify](https://github.com/langgenius/dify)适合快速试验提示词、知识管线和简单工作流。它可以用于内部原型比较，但正式产品需要更严格的引用校验、隐私隔离、危机状态机和自动化测试，因此核心后端建议自己控制。

### Haystack / LlamaIndex

[Haystack](https://github.com/deepset-ai/haystack)适合构建显式的检索流水线；[LlamaIndex Citation Query Engine](https://docs.llamaindex.ai/en/v0.10.17/api_reference/query/query_engines/citation_query_engine.html)提供了引用节点的现成思路。可以参考或局部使用，但不应让框架的数据模型替代我们自己的来源、页码和技能结构。

### GraphRAG 与 LLM Wiki

[Microsoft GraphRAG](https://github.com/microsoft/graphrag)适合回答跨大量文档的全局主题和实体关系问题，但官方也提示索引成本较高。两册 DBT 书目前不需要先上 GraphRAG。

[LLM-Wiki](https://arxiv.org/abs/2605.25480)可作为二期的“专业人员审核知识层”：把技能适用条件、步骤和关系整理成稳定页面。它不能替代原始证据库，每个 Wiki 结论仍需反向链接到书籍原页。

## 4. 学术证据对产品设计的影响

本轮在 PubMed 做了两组定向检索：

- 心理健康聊天机器人、随机对照试验、安全与评测：检索到 166 条，查看相关度最高的 10 条。
- DBT、聊天机器人、移动应用与数字干预：检索到 19 条，查看相关度最高的 10 条。

关键发现：

1. [DBT 移动应用系统综述](https://doi.org/10.1186/s40479-021-00167-5)识别出 21 款免费应用；技能训练最常见，只有少数包含日记卡，并明确认为 DBT 应用仍需谨慎开发和临床评价。
2. [DBT 应用融入治疗的混合方法研究](https://doi.org/10.2196/14913)显示，应用更适合作为现实情境中的技能使用工具和患者—治疗师共同信息源，而不是替代治疗。
3. [2025 年 AI 聊天机器人系统综述与 Meta 分析](https://doi.org/10.2196/79850)报告了小到中等的心理困扰改善，但指出检索式系统的结果更稳定，生成式系统的总体有效性仍不确定，安全协议和长期验证是缺口。
4. [心理健康对话 AI 伦理范围综述](https://doi.org/10.2196/60432)总结了安全伤害、危机处置、依赖、隐私、透明度、责任和拟人化等主要风险。

因此，Demo 的成功标准不能只使用“回答自然”“用户喜欢”，还必须独立衡量检索、引用、技能选择、流程遵循和危机漏检。

## 5. 推荐产品设计

### 首页不是纯聊天窗口

建议保留四个一级入口：

1. 此刻需要帮助：根据当前情绪快速选择技能。
2. DBT 技能：正念、痛苦耐受、情绪调节、人际效能等技能库。
3. 练习与日记卡：结构化记录，而不是保存漫长聊天文本。
4. 我的安全计划：个人支持资源、紧急联系人、12356 与 120。

### 对话采用短会话

每次会话围绕一个明确目标：识别问题、选择技能、完成练习、总结下一步。结束后由用户选择是否保存结构化摘要，不默认把原始聊天变成长时记忆。

### 引用采用“结论—证据”绑定

每个可验证的知识性结论都返回 `citation_id`。服务端检查该引用是否属于本次检索上下文，客户端再映射为章节、印刷页码、PDF 页码和扫描页。不能把“检索到了某页”直接当作“这句话被该页支持”。

### 低摩擦日记卡

记录应尽量使用强度滑块、技能多选和短文本；允许跳过；不要依靠连续签到、情感依赖或使用时长来提高留存。

## 6. 推荐系统架构

```text
用户输入
  -> 本地/服务端第一层危机规则
  -> 独立风险分类与诊疗边界判断
  -> DBT 技能与会话状态路由
  -> 关键词 + 向量混合召回
  -> 重排序与父级章节补全
  -> 闭源模型结构化生成
  -> 引用支持度、越界内容和危机复检
  -> 回答 + 来源 + 下一步练习
```

推荐技术栈：

| 部分 | 选择 |
|---|---|
| Web/H5 | 保留当前 Next.js + TypeScript |
| AI 后端 | Python + FastAPI + Pydantic |
| OCR/版面 | PyMuPDF + PaddleOCR PP-StructureV3；保留页图和坐标 |
| 业务与知识数据 | PostgreSQL |
| 向量检索 | pgvector |
| 关键词检索 | 中文分词后的全文字段；与向量结果做 RRF 融合 |
| 重排序 | 外部 rerank API，保持供应商可替换 |
| 生成模型 | 闭源前沿模型 API，强制 JSON Schema 输出 |
| 工作流 | 先自行实现有限状态机；流程复杂后再引入 LangGraph |
| 文件 | 私有对象存储；扫描页使用短时授权链接 |
| 观测 | OpenTelemetry；脱敏后再接 Langfuse 或 Phoenix |
| 评测 | 自建冻结集为主，Ragas 等通用指标为辅 |

## 7. 不建议采用的路线

- 不直接把整本书塞进超长上下文：成本高，定位与引用难以验证。
- 不使用只有向量检索的 naive RAG：DBT 术语、练习编号和章节标题需要关键词召回。
- 不把聊天历史全部写进向量库作为“记忆”：会扩大隐私风险，也可能放大用户过去的负性叙事。
- 不先做 GraphRAG、知识图谱或微调：当前没有证据证明它们能改变一期决策。
- 不让 Agent 自由选择危机处理：危机路径必须是确定性的产品规则。
- 不直接把 Dify/RAGFlow 的默认流程当成生产安全架构。
- 不把 LLM-as-a-judge 的高分当作临床有效、安全或真实世界证明。

## 8. 评测体系

至少建立以下独立指标：

1. OCR：字词准确率、标题识别率、阅读顺序、页码映射正确率。
2. 检索：Recall@5、MRR、正确章节命中率、跨章节问题命中率。
3. 引用：每个事实主张是否被引用片段直接支持；页码是否正确。
4. DBT：技能路由准确率、步骤完整性、DBT 遵循度、是否过早建议。
5. 对话：澄清问题质量、用户退出尊重、是否形成短会话闭环。
6. 安全：自伤自杀召回率、隐晦表达漏检率、误报率、诊断/用药越界率。
7. 隐私：是否超量收集、是否能导出与删除、日志是否包含原始敏感文本。

[Ragas](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)提供上下文精度、召回、忠实度等通用指标；[Langfuse](https://langfuse.com/blog/2025-10-28-rag-observability-and-evals)和 [Phoenix](https://arize.com/docs/phoenix/)可帮助跟踪检索和生成步骤。但最终发布门槛必须包含人工核验和心理专业人员评审。

## 9. 安全、隐私与监管基线

- [WHO AI 健康伦理指南](https://www.who.int/publications-detail-redirect/9789240037403)强调自主、安全、透明、责任、公平和可持续性。
- [美国精神医学学会应用评估模型](https://www.psychiatry.org/psychiatrists/practice/mental-health-apps/the-app-evaluation-model)依次考察背景、可访问性、隐私安全、临床基础、可用性和数据整合。
- 中国《[人工智能拟人化互动服务管理暂行办法](https://www.cac.gov.cn/2026-04/10/c_1777558395078289.htm)》要求 AI 身份提示、极端情境干预、交互数据保护、复制删除选项以及避免诱导依赖。
- 《[个人信息保护法](https://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)》将医疗健康信息列为敏感个人信息。
- 国家卫健委已将 [12356](https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml)设为全国统一心理援助热线。

这些要求意味着：正式版不能只有一句免责声明；必须在数据结构、对话状态、日志策略、退出机制和危机流程中实现相应能力。

## 10. 推荐实施顺序

1. 完成两册 PDF 的全量 OCR、章节树、页码映射和人工抽检。
2. 建立 PostgreSQL/pgvector 数据模型和离线混合检索评测。
3. 把当前固定证据 API 替换为真实检索，但暂时保持模板式回答。
4. 接入闭源模型 API，实施结构化输出、引用校验和模型供应商适配。
5. 实现“核对事实”的多轮有限状态机，并由专业人员评审。
6. 将冻结评测扩展到至少 100 条普通/边界案例和独立危机红队集。
7. 通过版权、隐私、合规和危机流程审查后，再增加账户、云端记录与部署。

## 11. 检索可复现信息

- PubMed 访问日期：2026-08-12。
- 查询 1：`((mental health[Title/Abstract]) AND (chatbot[Title/Abstract] OR conversational agent[Title/Abstract])) AND (randomized controlled trial[Publication Type] OR safety[Title/Abstract] OR evaluation[Title/Abstract])`；`sort=relevance`，共 166 条，读取前 10 条。
- 查询 2：`(dialectical behavior therapy[Title/Abstract] OR DBT[Title/Abstract]) AND (chatbot[Title/Abstract] OR conversational agent[Title/Abstract] OR mobile app[Title/Abstract] OR digital intervention[Title/Abstract])`；`sort=relevance`，共 19 条，读取前 10 条。
- 使用 NCBI E-utilities：`esearch.fcgi`、`esummary.fcgi` 与 `efetch.fcgi`。
- 本调研为有界定向检索，不是穷尽式系统综述；产品页面中的功能和疗效声明应视为项目方自述。

