# 词频表数据来源与授权（阶段 0 数据预检记录）

> 规格《实现交接规格》§1.4 / 阶段 0 要求：词频表来源 + 授权必须书面记录，否则阶段 2 阻塞。

## 来源

- **原始数据**：`BNC_COCA_lists.csv` —— 基于 Paul Nation 的 **BNC/COCA word family lists**（25,000 词族，分 1k–25k 共 25 个频段）。
- 取自开源整理仓库 `BNC_COCA_EN2CN`（仅使用其中的 `BNC_COCA_lists.csv` 词族频段表；该仓库的中文释义/音标/例句 `data/*.json` **未使用**，因为 MVP 是英解英）。

## 字段映射（→ `band`）

- CSV `List` 列（`1k`..`25k`）→ `Token.band` 整数 `1..25`，**越大越难**。
- CSV `Related forms` 列 → 词形还原词典：把屈折/派生形式映射回 headword（例：`running`→`run`）。
- 不在表中的词 → `band = null`（OOV），按"最难/高于任何水平"处理。

## 运行期产物

- `npm run gen:lexicon` 读取本 CSV，生成紧凑查找表 `src/data/lexicon-table.json`
  （`lemmas[]` / `bands[]` / `surface{form→lemmaIndex}`）。
- `Lexicon` 模块加载该 JSON。**整个数据源藏在 `Lexicon` 接口之后**，将来替换为正式开放许可的词频表对其它模块零影响（信息隐藏）。

## 授权说明（诚实界定）

- BNC/COCA word family lists 是学术资源，**免费供教育/研究使用**，但并非严格意义上的开放许可（如 CC）。
- **适用范围**：本项目为探索期个人 MVP（作者本人 + 少数朋友、纯本地、不对外分发），属教育/研究用途，可用。
- **若将来对外发布或商用**：需替换为明确开放许可的频率词表（如 SUBTLEX、Google Books N-gram 衍生表）。因数据源完全隐藏在 `Lexicon` 后，替换成本极低。

## band 分段规则（登记）

- band = k-list 序号，离散整数 `1..25`；`maxBand = 25`。
- 滑块（学习者水平）取值域：整数 `1..25`，默认 `3`（约掌握 3k 词族 ≈ 中级）。
- 标记规则：`band > sliderLevel` 的词被高亮；OOV（`band=null`）恒被标记。

## 离线词典来源与授权（阶段 12）

- `dict/wordnet.json`
  - 源：WordNet 3.0 database files，转换脚本 `scripts/gen-dict-wordnet.mjs`。
  - 用途：离线 English-English 查词，首次运行播种到独立 IndexedDB 词典库。
  - 许可：WordNet license，来源与许可见脚本头部链接。
- `dict/ecdict.json`
  - 源：ECDICT CSV，转换脚本 `scripts/gen-dict-ecdict.mjs`。
  - 用途：离线 English-Chinese 查词，默认关闭，可在 Settings 启用。
  - 许可说明：ECDICT 项目说明数据可自由使用；许可边界不如 WordNet 清晰，发布前需复核上游仓库当前说明与数据来源。
