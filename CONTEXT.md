# 英语阅读器 · i+1 Reader

A local-only graded English reader. The single product bet: reading with i+1 *comprehensible input* (text just above your level, with on-demand English-in-English explanation of the hard words) helps people acquire English. Everything in the model exists to serve that bet.

## Language

**Document**:
The platform-independent core asset: one normalized **flat plaintext `source` string** plus a **flat, contiguous token stream** over it. Every content format (txt, md, and now epub) is flattened into this one shape; all features index into it by character offset. A whole book is *one* Document, not a collection of objects.
_Avoid_: File, Book, Article (those are user-facing inputs; the normalized result is always a Document).

**Token**:
One unit of the normalized stream — `word | punct | space | newline` (and, for epub, `image`). Load-bearing invariant: `token.surface === document.source.slice(token.start, token.end)`. Tokens are contiguous and cover the whole `source`.

**Chapter**:
A named region of a Document's flat token stream, defined by a start position. Derived from an epub's spine + navigation; for txt/md there is a single implicit chapter. Chapters are an *index into* the flat stream (for the table of contents and navigation), **not** separate sub-documents.
_Avoid_: Section, Spine item (spine item is the epub-format term; once parsed it becomes a Chapter).

**Band**:
A word's frequency rank segment (integer; smaller = more common/easier). `null` = out-of-vocabulary, treated as hardest. Backed by a swappable frequency list, hidden behind `Lexicon`.
_Avoid_: Difficulty, Frequency (use Band for the discretized value).

**Level**:
An ordinal difficulty value on the same scale as Band. A learner has a Level (set by the manual slider, MVP); a word is *above level* when its Band exceeds the learner's Level — those are the markable, clickable words.

**Dictionary**:
A bundled, offline, instant lookup source (English-English and/or English-Chinese) — the *default* content shown when a word is looked up. Authoritative but *fixed difficulty* and context-blind. Behind a `Dictionary` seam; entries are normalized `DictEntry` records stored in IndexedDB, seeded from open-licensed sources converted **offline** (MDX, if used, is a conversion source only — never parsed at runtime). Distinct from the i+1 explanation.
_Avoid_: Glossary (that's CONTEXT.md), Lexicon (that's frequency banding only).

**DictEntry**:
The normalized stored shape of one dictionary entry: `{ word, phonetic?, senses: {pos?, gloss}[], translations?: string[] }`. Structured and uniform across source dictionaries (an optional `html?` could later carry rich fidelity). Keyed by headword for async IndexedDB lookup.

**i+1 explanation**:
A concise English-in-English definition of a word, **leveled to the learner and context-aware**, produced by the LLM **on explicit demand** (an upgrade button in the lookup popup) — not the default. The product's moat; costly, so it is a deliberate action, not an always-on expense. Hard-cached by (lemma + level).
_Avoid_: Definition, Translation (the explanation is always leveled English; a plain definition comes from the Dictionary).

**Asset**:
A binary resource extracted from an epub (currently images), stored as a Blob keyed by `docId` + `assetId`, and referenced from an inline zero-width image Token. Deleted with its Document.
_Avoid_: Resource, Media.

**Cover**:
The epub's cover image, surfaced as the Document's thumbnail in the Library. A special Asset, not part of the reading flow.

**Mark (comprehension)**:
A learner's recorded grasp of a word — `unknown | fuzzy | known`. Stored per-lemma on a VocabEntry; feeds level estimation and (future) spaced reappearance.

**VocabEntry**:
A vocabulary record keyed **by lemma**, spanning **all** Documents — about a word's acquisition (comprehension Mark, contexts where seen). The i+1 core. Distinct from an Annotation.
_Avoid_: Note, Annotation (those are passage-level and document-local).

**Annotation**:
A learner's mark on a *specific passage in one Document*, about their own thinking — not about a word's difficulty. One entity covering: a **bookmark** (anchor is a *point*), a **highlight** (anchor is a *range* + quoted text), and a **note** (optional free-text comment attached to either). Anchored by `source` offset (see anchoring decision). Strictly separate from VocabEntry.
_Avoid_: Bookmark/Highlight/Note as separate top-level entities — they are forms of one Annotation discriminated by whether the anchor has length and whether a note is attached.

**Lookup**:
The act of clicking any word to see its meaning — dictionary content by default, the i+1 explanation on demand. Available on *every* word, not only highlighted ones; highlighting is a cue, not a gate (see [[reading-mode-i-1]] / ADR-0005).
_Avoid_: Define, Explain (those name the two content sources; "lookup" is the user action).

**System highlight vs user highlight**:
Two distinct visual layers over the text. *System highlight* = the automatic marking of above-Level words (clickable for i+1). *User highlight* = an Annotation the learner created. They overlap and must stay visually distinguishable.

**Personalized level**:
The effective markable set is *not* pure frequency: a word is system-highlighted when its Band is above the learner's Level **and** the learner hasn't marked it `known`. Mastered words drop out even if statistically rare — the level becomes the learner's, not the global frequency line.

**Reading mode (i+1)**:
The default experience and the product's validated bet: a single learner threshold (the slider), highlighting *only* the words just above it, everything else plain. Optimizes for *focus* — read mostly-comprehensible text, learn at the edge.
_Avoid_: Normal mode, Default view (call it the i+1 reading mode).

**X-ray mode**:
An opt-in analysis view, distinct from reading mode: every word tinted by its frequency Band (per-band palette, per-band show/hide), plus the book's vocabulary profile. Serves *difficulty assessment* ("how hard is each word / this book"), not i+1 focus. Does not replace reading mode.
_Avoid_: Vocabulary view, Grading mode (use X-ray mode).

**Vocabulary profile**:
A compact per-book summary computed at import and stored in `DocumentMeta`: running-word count, unique types, and **per-band** running-word counts (index 1..25 by band, index 0 = OOV). Per-band (not 5-bucket) so coverage works at any slider level; x-ray buckets aggregate from it. Small enough to live in meta so the Library shows it without loading the whole book.

**Coverage**:
The share of a book's running words at or below a given learner level — the actionable readability metric (derived live from the Vocabulary profile + slider). Grounded in extensive-reading research: ~98% coverage reads comfortably, ~95% with effort. Reported as "你认识约 X%" plus "达到 95% 覆盖需要约 N k 词汇量". Deliberately **not** called Lexile (proprietary) — it is an honest frequency-coverage proxy.
_Avoid_: Lexile, Reading level (use Coverage / the vocabulary-needed number).

**Reappearance**:
A previously-struggled word (marked `fuzzy`/`unknown`) recurring later in the same book. Surfaced as reinforcement — the spaced-repetition payoff that long, single-theme books provide and scattered articles cannot.
