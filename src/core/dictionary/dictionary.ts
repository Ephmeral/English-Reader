export type DictionaryKind = 'EE' | 'EC';

export interface DictSense {
  pos?: string;
  gloss: string;
}

export interface DictEntry {
  word: string;
  phonetic?: string;
  senses: DictSense[];
  translations?: string[];
}

export interface Dictionary {
  id: string;
  label: string;
  kind: DictionaryKind;
  ensureSeeded(): Promise<void>;
  lookup(surface: string, lemma?: string | null): Promise<DictEntry | null>;
}
