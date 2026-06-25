// Lexicon（规格 §1.4）：词 → 频段的分级。不负责释义（唯一释义路径是 AIService.explain）。

export interface Lexicon {
  /**
   * 词的频段。OOV 返回 null。
   * 纯函数、同步、廉价（查静态表）。输入应为已小写化的词面或原形。
   */
  level(word: string): number | null;
  /** 词形还原 + 查表。返回所用原形与频段。导入预处理用此。 */
  annotate(surface: string): { lemma: string; band: number | null };
}

/** lexicon-table.json 的结构（由 scripts/gen-lexicon.mjs 生成）。 */
export interface LexiconTable {
  version: number;
  source: string;
  maxBand: number;
  lemmas: string[];
  bands: number[];
  surface: Record<string, number>;
}

/**
 * 表驱动实现。数据来自 BNC/COCA 词族表（来源/授权见 src/data/SOURCE.md）。
 * 整个数据源藏在本接口之后：将来换词频表对其它模块零影响。
 */
/** 去所有格：children's → children（§6 廉价"改进词形还原"，安全且只在表外兜底时触发）。 */
function stripPossessive(word: string): string {
  return word.replace(/['’]s$/, '').replace(/['’]$/, '');
}

function withApostropheVariants(entries: Record<string, string>): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    variants[key] = value;
    variants[key.replace(/'/g, '’')] = value;
  }
  return variants;
}

const CONTRACTION_BASE_WORDS = withApostropheVariants({
  "aren't": 'are',
  "can't": 'can',
  "couldn't": 'could',
  "didn't": 'did',
  "doesn't": 'does',
  "don't": 'do',
  "hadn't": 'had',
  "hasn't": 'has',
  "haven't": 'have',
  "isn't": 'is',
  "mightn't": 'might',
  "mustn't": 'must',
  "needn't": 'need',
  "oughtn't": 'ought',
  "shan't": 'shall',
  "shouldn't": 'should',
  "wasn't": 'was',
  "weren't": 'were',
  "won't": 'will',
  "wouldn't": 'would',
  "i've": 'have',
  "you've": 'have',
  "we've": 'have',
  "they've": 'have',
  "could've": 'have',
  "should've": 'have',
  "would've": 'have',
  "might've": 'have',
  "must've": 'have',
  "who've": 'have',
  "you're": 'are',
  "we're": 'are',
  "they're": 'are',
  "there're": 'are',
  "i'll": 'will',
  "you'll": 'will',
  "he'll": 'will',
  "she'll": 'will',
  "it'll": 'will',
  "we'll": 'will',
  "they'll": 'will',
  "that'll": 'will',
  "who'll": 'will',
  "i'd": 'would',
  "you'd": 'would',
  "he'd": 'would',
  "she'd": 'would',
  "it'd": 'would',
  "we'd": 'would',
  "they'd": 'would',
  "that'd": 'would',
  "who'd": 'would',
  "there'd": 'would',
  "i'm": 'am',
  "he's": 'is',
  "she's": 'is',
  "it's": 'is',
  "that's": 'is',
  "what's": 'is',
  "there's": 'is',
  "here's": 'is',
  "who's": 'is',
  "where's": 'is',
  "how's": 'is',
  "let's": 'let',
});

export class TableLexicon implements Lexicon {
  private readonly table: LexiconTable;

  constructor(table: LexiconTable) {
    this.table = table;
  }

  /** 查表索引：先原样，再尝试去所有格。 */
  private lookupBase(key: string): number | undefined {
    const idx = this.table.surface[key];
    if (idx !== undefined) return idx;
    const dep = stripPossessive(key);
    return dep !== key ? this.table.surface[dep] : undefined;
  }

  private contraction(key: string): { lemma: string; band: number } | null {
    const base = CONTRACTION_BASE_WORDS[key];
    if (base === undefined) return null;
    const idx = this.lookupBase(base);
    if (idx === undefined) return { lemma: base, band: 1 };
    return { lemma: this.table.lemmas[idx] ?? base, band: this.table.bands[idx] ?? 1 };
  }

  level(word: string): number | null {
    const key = word.toLowerCase();
    const contraction = this.contraction(key);
    if (contraction !== null) return contraction.band;
    const idx = this.lookupBase(key);
    if (idx === undefined) return null;
    return this.table.bands[idx] ?? null;
  }

  annotate(surface: string): { lemma: string; band: number | null } {
    const key = surface.toLowerCase();
    const contraction = this.contraction(key);
    if (contraction !== null) return contraction;
    const idx = this.lookupBase(key);
    if (idx === undefined) {
      // 兜底（决策 A）：查不到 → lemma 回退为小写词面，band=null（OOV→最难）。不引入 lemmatizer 库。
      return { lemma: key, band: null };
    }
    return { lemma: this.table.lemmas[idx] ?? key, band: this.table.bands[idx] ?? null };
  }
}
