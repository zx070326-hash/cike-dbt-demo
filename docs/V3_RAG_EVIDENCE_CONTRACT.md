# V3 质量优先 RAG 与 Evidence Bundle

本文件说明知识/RAG 子系统已经实现的契约。它不宣称临床有效，也不把自动生成的技能卡当作专业审核结论。

## 1. 真相层与派生层

- `knowledge-v2.json` 仍保留 1189 个 source-exact chunks，覆盖 1156 个非空页面的 681595 个字符。
- `section`、`text`、页码和字符区间保留原始可追溯值。
- `displaySection`、`sourceQuality`、`skillCardIds` 和 `parentBlockId` 是派生元数据；它们不覆盖原文。
- 目录、前言、短页、低 OCR 置信度和不可靠标题会被标记。原文仍在知识包中，但不作为主要 grounding 证据。
- `groundingEligible` 只回答“能不能被检索和核对”；`displayRole`（`primary` / `supporting` / `index-only`）另行回答“是否适合直接展示给用户”。空表、课程目录和交叉引用不会因为来自原书就自动占据课程页首位。
- `displayScore` 与 `displayIssues` 记录展示质量判定。患者讲义优先，训练师说明用于补充，练习单在明确练习情境中使用；`index-only` 内容仍保留在专家检索与全书索引中。

## 2. 父上下文

每个非空来源页有一个 parent block。父块只保存 source-exact chunk ID，不保存改写后的“综合正文”。命中片段后可以补充同页，以及同技能或同标题的相邻页上下文。这样把“召回粒度”和“生成上下文粒度”分离，同时保留逐字符溯源。

## 3. Skill Card

18 个导航节点现在具有统一字段：

- 定义；
- 适用情境；
- 不适用情境；
- 第一步行动；
- 关联技能；
- 检索提示语；
- 每类主张的证据 ID；
- 审核与内容权限状态。

当前卡片均为 `source-linked-unreviewed` 和 `navigation-only`。这些字段可以帮助召回、专业审核和模型规划，但不得作为稳定权威正文直接发布。只有专业人员把卡片、对应主张和证据逐项审核后，才允许变更为 `professionally-reviewed` / `reviewed-content`。

## 4. Evidence Bundle

`buildEvidenceBundle(query, hits)` 提供兼容现有 `retrieveEvidence` 的新生成契约：

```text
query
skillCards[]                 # 卡片身份与审核状态
evidence[]                   # E1...En，原文、页码、字符区间、质量
claimBindings[]              # 主张类型 -> 允许引用的 evidence IDs
citationPolicy               # 逐主张引用约束
diagnostics                  # 父块、低质量、专业审核统计
```

定义、适用性、步骤和书内事实必须逐主张引用。未审核卡片的草稿即使绑定了候选证据，也保持 `publishableAsStableClaim: false`。

## 5. 冻结评测

`data/eval/retrieval-cases-v0.3.json` 包含 64 条模糊与对照情境，覆盖行为链/STOP 对照、关系困扰、接纳与改变、核对事实、危机生存、人际效能、正念、脆弱性和越界控制。

执行：

```powershell
npx tsx tools/rag/evaluate_retrieval.mjs
```

报告写入 `data/eval/retrieval-quality-report-v0.3.json`，包含 route accuracy、skill-card Recall@1/3/5、MRR、evidence-term Recall@5、父块解析率、来源可追溯率和低质量主要来源比例。

这些指标是工程金标集上的检索结果，不是临床有效性、真实用户体验或专业审核的替代证据。
