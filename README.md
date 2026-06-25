# 英语阅读器 · i+1 Reader (MVP)

分级阅读 + 按需 i+1 英解英：打开英文文档，按你的水平给词汇分级，对超出水平的词点击即用简洁英文当场解释。纯本地、无登录。

> 设计与决策记录（战略规划 / PRD / 实现交接规格 / ADR）保存在本地 `docs/`，按 `.gitignore` 未随公开仓库提交。

## 快速开始

```bash
npm install
npm run gen:lexicon   # 生成词频查找表（需先放好 src/data/BNC_COCA_lists.csv，见「数据准备」）
npm run gen:dict      # 生成离线词典 WordNet + ECDICT 到 src/data/dict/
npm run dev           # 打开 http://localhost:5173
```

> ⚠️ **词典 / 词频数据未随仓库提交**（许可与体积原因，见 `src/data/SOURCE.md`）。
> 首次运行前须用上面的 `gen:*` 脚本在本地生成，否则会因缺少
> `lexicon-table.json` / `dict/*.json` 而构建失败。详见下方「数据准备」。

在「设置」里可勾选 **Mock**（无需 API key 即可体验解释闭环），或填入 OpenAI 兼容的
`baseURL / model / apiKey`（默认 DeepSeek）使用真实 LLM。

## 数据准备（数据未入库）

为避免在公开仓库再分发受许可约束的数据，下列文件已被 `.gitignore`，需本地生成：

| 产物 | 生成命令 | 上游来源 |
|---|---|---|
| `src/data/lexicon-table.json` | `npm run gen:lexicon` | 需先放置 `src/data/BNC_COCA_lists.csv`（BNC/COCA word family lists，教育/研究用途）|
| `src/data/dict/wordnet.json` | `npm run gen:dict:wordnet` | 自动下载 WordNet 3.0（Princeton 许可）|
| `src/data/dict/ecdict.json` | `npm run gen:dict:ecdict` | 需提供 ECDICT `ecdict.csv`（脚本头部有来源链接）|

许可边界与诚实界定见 `src/data/SOURCE.md`。

## 验证脚本

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run test:offsets    # 校验 surface===source.slice 不变式（阶段1）
npm run test:epub       # 校验 EPUB 解析：章节/偏移/封面/DRM
npm run report:quality  # 分级质量验收门报告（阶段2 §6）
npm run build           # 生产构建
```

## 架构（深模块 + 信息隐藏）

```
文件 ─▶ SourceParser ─▶ Document（统一词元流，平台无关核心资产）
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                     ▼
     Lexicon            Reader UI              Storage
  level/annotate     渲染/点击/弹释义        save/load（IndexedDB）
   (查 BNC/COCA)           │
                          ▼
                      AIService.explain  ← 唯一 LLM 入口 + 按「词+水平」狠缓存
```

- `src/core/` 纯 TS，禁 import React/DOM；`src/ui/` 依赖 core，单向。
- 五条留缝（`Storage` / `User` / `SourceParser` / `AIService`/`AITransport` / `Level`）只定窄接口。

## 关键决策（见交接规格 v1.2）

| 项 | 选择 |
|---|---|
| 词频表 | BNC/COCA word family lists（band=1..25 k-list；Related forms 兼作词形还原）|
| 滑块 | 整数 1..25，默认 3；`band > slider` 标记 |
| LLM | OpenAI 兼容 transport（默认 DeepSeek），key 存本地；含 Mock |
| 词形还原 | 仅查表 + 小写/去所有格兜底，无额外库；专名在标记层抑制 |

## 阶段完成度

阶段 0 骨架/契约/数据预检 · 1 解析渲染 · 2 分级+滑块+验收门(PASS) · 3 点词释义+缓存 ·
4 生词本+理解度+Storage · 5 默认书+导出+收尾 —— **全部完成并经浏览器端到端验证**。

**v1.3 / v1.4 扩展**（均经端到端验证）：EPUB 上传与电子书式阅读（目录 / 书签 / 划线评论 / 续读 / 章节渲染 / 内联图片）；离线词典优先（WordNet 英英 + ECDICT 英汉）+ LLM 按需 i+1 解释；全局查词；透视(x-ray)分级热力图；按覆盖率的书籍可读性评估。设计决策记录见 `docs/adr/`（本地）与 `CONTEXT.md`。

成功信号埋点（`src/core/events`）：`session_*` / `doc_open` / `reading_progress` /
`word_click` / `comprehension_mark` / `explain_shown(cacheHit)`，可在「设置」导出 JSON。
