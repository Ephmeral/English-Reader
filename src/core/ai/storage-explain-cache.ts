// ExplainCache 落地：用 Storage 的 settings 存释义缓存（规格 §1.6 边界允许）。
// 缓存键规则在 ai-service.ts 的 cacheKey() 定义，此处仅做前缀命名空间。

import type { ExplainCache } from './ai-service';
import type { Storage } from '../storage/storage';

const PREFIX = 'explain:';

export class StorageExplainCache implements ExplainCache {
  constructor(private readonly storage: Storage) {}

  async get(key: string): Promise<string | null> {
    return this.storage.getSetting<string>(PREFIX + key);
  }

  async set(key: string, explanation: string): Promise<void> {
    await this.storage.setSetting<string>(PREFIX + key, explanation);
  }
}
