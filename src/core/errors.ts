// 错误体系（规格 §4）：AppError 基类带 code；派生 ParseError / AIError / StorageError。
// 约定：不静默吞错；错误向上抛，由 UI 渲染为 loading/error/retry/empty 状态。

export type AppErrorCode =
  | 'PARSE_UNSUPPORTED'
  | 'PARSE_DECODE'
  | 'PARSE_DRM'
  | 'PARSE_MALFORMED'
  | 'AI_NO_KEY'
  | 'AI_NETWORK'
  | 'AI_RATE_LIMIT'
  | 'AI_ABORTED'
  | 'AI_BAD_RESPONSE'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_IO';

export class AppError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ParseError extends AppError {}
export class AIError extends AppError {}
export class StorageError extends AppError {}
