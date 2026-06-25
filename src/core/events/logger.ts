// 事件日志器（规格 §5：不超出事件日志器的 event bus）。
// 管理 sessionId、补全信封字段（id/at/sessionId），append-only 写入 Storage。

import type { Storage } from '../storage/storage';
import type { AppEvent, AppEventBase } from './events';

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/** 分配式 Omit：对联合类型逐成员去字段，否则会塌缩成各成员的公共字段。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 业务方只需提供事件主体（去掉信封里的 id/at/sessionId，保留 type 与各自字段）。 */
type EventPayload = DistributiveOmit<AppEvent, 'id' | 'at' | 'sessionId'>;

export class EventLogger {
  private readonly sessionId: string;
  private readonly sessionStart: number;

  constructor(private readonly storage: Storage) {
    this.sessionId = uuid();
    this.sessionStart = Date.now();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** 写入一条事件，自动补全信封。失败不抛给 UI（日志不应打断阅读），仅 console。 */
  async log(payload: EventPayload): Promise<void> {
    const envelope: AppEventBase = {
      id: uuid(),
      type: payload.type,
      at: Date.now(),
      sessionId: this.sessionId,
    };
    const event = { ...payload, ...envelope } as AppEvent;
    try {
      await this.storage.appendEvent(event);
    } catch (e) {
      console.warn('[events] append failed', e);
    }
  }

  /** 便捷：会话结束（计算时长）。 */
  async logSessionEnd(): Promise<void> {
    await this.log({ type: 'session_end', durationMs: Date.now() - this.sessionStart });
  }
}
