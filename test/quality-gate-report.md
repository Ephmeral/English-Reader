# 阶段2 分级质量验收门报告（规格 §6）

> 复现：`npm run report:quality`（默认文章 `test/sample-article.txt`，滑块 3）

## 结果

| 指标 | 值 | 通过线 | 结论 |
|---|---|---|---|
| 总 word token | 626 | — | — |
| 标记 token | 36 (5.8%) | — | 密度健康 |
| 误判率（假难+假易）/总词 | ≈ 0.5–1.5% | **< 10%** | ✅ 通过 |
| 每段假难 | ≤ 1 | **≤ 1** | ✅ 通过 |

## 人工核对（逐词）

- **词形还原工作正常**：`comprehensible→comprehend`、`treacherous→treachery`、`outpaces→outpace`、`skeptics→sceptic`、`refreshingly→refresh`、`distraction→distract` 等均正确还原到词族 headword。
- **假难（false-hard）**：修复 `children's`（去所有格→`children`/1k）后，剩 `classmate`、`overturns`、`bottleneck` 三个表外复合/派生词，均为边界情形（本身确属不常见），分布在不同段落（每段 ≤1）。
- **假易（false-easy）**：未发现明显漏标的难词；高 band 难词（`treatise`/8k、`devour`/7k、`ambush`/6k、`outpace`/11k）均被标出。
- **专名抑制生效**：2 个疑似专名 OOV（如 `Krashen`、`Stephen`）被 `marking.ts` 抑制，未制造满屏假难。

## 采用的便宜修法（§6 sanctioned）

1. **去所有格词形还原**：表外兜底时先剥 `'s`/`'`，修掉 `children's` 类假难。
2. **专名抑制**：首字母大写且 OOV 的词不高亮（band 仍诚实记 null，照写日志）。

## 结论

**达到 §6 通过线，允许进入阶段 3。** 带病分级未进入下游。
