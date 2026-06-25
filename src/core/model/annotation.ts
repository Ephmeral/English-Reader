// 批注模型（规格 §1.7，v1.3）。纯 TS，不依赖 React/DOM。
// 学习者对某文档某处的标注：点=书签、区间=划线、可选 note=评论。
// 与 VocabEntry 严格分离（见 CONTEXT.md / docs/adr/0002）。

/** 批注锚点：点 = 书签；区间 = 划线。偏移索引到 Document.source。 */
export type Anchor =
  | { kind: 'point'; offset: number }
  | { kind: 'range'; start: number; end: number };

export interface Annotation {
  /** uuid。 */
  id: string;
  docId: string;
  anchor: Anchor;
  /** range 锚定时的引用原文（= source.slice(start,end)）；point 可为空。供列表展示与自校验。 */
  quote: string;
  /** 可选评论。range+note = 带评论的划线；point+note = 带备注的书签。 */
  note?: string;
  /** 可选高亮色（UI 调色板键）。 */
  color?: string;
  createdAt: number;
  updatedAt: number;
}
