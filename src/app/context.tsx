// React context：把 Deps 注入组件树。UI 依赖 core，反向禁止（规格 §4）。

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Deps } from './deps';

const DepsContext = createContext<Deps | null>(null);

export function DepsProvider({ deps, children }: { deps: Deps; children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useDeps(): Deps {
  const ctx = useContext(DepsContext);
  if (!ctx) throw new Error('useDeps 必须在 DepsProvider 内使用');
  return ctx;
}
