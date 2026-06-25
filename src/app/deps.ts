// 依赖装配（规格 §4：依赖注入，禁全局可变单例的"业务状态"；此处只构造无状态盒子）。
// 每个盒子可按缝替换：parser / lexicon / ai / storage。

import { TextSourceParser } from '../core/parser/source-parser';
import type { SourceParser } from '../core/parser/source-parser';
import { CompositeSourceParser } from '../core/parser/composite-source-parser';
import { EpubSourceParser } from '../core/parser/epub-source-parser';
import { TableLexicon } from '../core/lexicon/lexicon';
import type { LexiconTable } from '../core/lexicon/lexicon';
import { BandLevelScale } from '../core/model/level';
import { IndexedDbStorage } from '../core/storage/indexeddb-storage';
import { EventLogger } from '../core/events/logger';
import { IndexedDbDictionary } from '../core/dictionary/indexeddb-dictionary';
import type { Dictionary } from '../core/dictionary/dictionary';
import { CachedAIService } from '../core/ai/cached-ai-service';
import { StorageExplainCache } from '../core/ai/storage-explain-cache';
import { OpenAICompatTransport, DEFAULT_AI_CONFIG } from '../core/ai/openai-transport';
import type { OpenAICompatConfig } from '../core/ai/openai-transport';
import { MockTransport } from '../core/ai/mock-transport';
import type { AIService } from '../core/ai/ai-service';
import type { Storage } from '../core/storage/storage';

import rawTable from '../data/lexicon-table.json';
import wordnetUrl from '../data/dict/wordnet.json?url';
import ecdictUrl from '../data/dict/ecdict.json?url';

export interface DictEnabled {
  wordnet: boolean;
  ecdict: boolean;
}

export const DEFAULT_DICT_ENABLED: DictEnabled = {
  wordnet: true,
  ecdict: false,
};

export interface ReadingPrefs {
  measureCh: number;
  fontPx: number;
  lineHeight: number;
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  measureCh: 70,
  fontPx: 19,
  lineHeight: 1.8,
};

export type Theme = 'day' | 'sepia' | 'night';

export const DEFAULT_THEME: Theme = 'day';

export interface Deps {
  parser: SourceParser;
  lexicon: TableLexicon;
  scale: BandLevelScale;
  storage: Storage;
  logger: EventLogger;
  dictionaries: Dictionary[];
  /** 按当前设置构造 AIService（key/baseURL/model/mock 可变，故按需构造）。 */
  makeAIService: () => Promise<AIService>;
}

export const SETTINGS_KEYS = {
  aiConfig: 'aiConfig',
  aiUseMock: 'aiUseMock',
  sliderLevel: 'sliderLevel',
  dictEnabled: 'dictEnabled',
  xray: 'xray',
  readingPrefs: 'readingPrefs',
  theme: 'theme',
} as const;

export function createDeps(): Deps {
  const storage = new IndexedDbStorage();
  const lexicon = new TableLexicon(rawTable as unknown as LexiconTable);
  const parser = new CompositeSourceParser([new EpubSourceParser(), new TextSourceParser()]);
  const scale = new BandLevelScale();
  const logger = new EventLogger(storage);
  const cache = new StorageExplainCache(storage);
  const dictionaries: Dictionary[] = [
    new IndexedDbDictionary({
      id: 'wordnet',
      label: 'WordNet',
      kind: 'EE',
      seedUrl: wordnetUrl,
      seedVersion: 3,
    }),
    new IndexedDbDictionary({
      id: 'ecdict',
      label: 'ECDICT',
      kind: 'EC',
      seedUrl: ecdictUrl,
      seedVersion: 1,
    }),
  ];

  const makeAIService = async (): Promise<AIService> => {
    const useMock = (await storage.getSetting<boolean>(SETTINGS_KEYS.aiUseMock)) ?? false;
    if (useMock) {
      return new CachedAIService(new MockTransport(), cache);
    }
    const cfg =
      (await storage.getSetting<OpenAICompatConfig>(SETTINGS_KEYS.aiConfig)) ?? DEFAULT_AI_CONFIG;
    return new CachedAIService(new OpenAICompatTransport(cfg), cache);
  };

  return { parser, lexicon, scale, storage, logger, dictionaries, makeAIService };
}
