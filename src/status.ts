/**
 * 每家搜索引擎的状态检查点：静态判定 + 上一次真实调用的结果。
 *
 * 静态部分只读配置开关与密钥是否存在，不发请求。被动部分由 `WebSearchWorld`
 * 在每次 `web_search_multi` 之后写入 `ProviderLedger`，只在本进程存续。
 *
 * 本文件不 import `world.ts`：adapter 表在那里，反向依赖会成环。判定口径与
 * `prompt-vars.ts` 的 `usableProviders()` 逐字一致（开关没关 且（无需密钥 或 已配密钥））。
 */
import { ANONYMOUS_PROVIDERS, PROVIDER_SECRET, WEB_SEARCH_DEFAULTS } from './config.ts';
import type { ProviderSwitches, SearchProvider, WebSearchConfigSection } from './config.ts';
import { SINGLE_MODE_PRIORITY } from './prompt-vars.ts';

/** 一家引擎的检查点状态。 */
export type CheckState = 'ready' | 'anonymous' | 'no-key' | 'off' | 'last-error';

/** 上一次真实调用的记录。`error` 空串表示成功。 */
export interface LastRun {
  ok: boolean;
  error: string;
  hits: number;
  /** `nowIso(timezone)` 格式的时间戳。 */
  ts: string;
}

/** 一家引擎的检查点。`detail` 面向 WebUI，已经裁短。 */
export interface Checkpoint {
  id: SearchProvider;
  state: CheckState;
  detail: string;
  /** 配置面板里这家的开关。缺键视为打开。 */
  switchOn: boolean;
  /** 这家的密钥是否已配置。 */
  keyed: boolean;
  /** 这家的密钥变量名，明细表直接印出来，省得用户去翻 README。 */
  secretName: string;
  /** 本进程内这家最近一次调用的时间戳。没调过是空串。 */
  lastTs: string;
}

/** `webUi().panels[id].invoke('state')` 的回执，也是 `src/webui.ts` 读的表结构。 */
export interface PanelState extends CheckSummary {
  /** 本次读取的时刻，`nowIso(timezone)` 格式。 */
  updatedAt: string;
  /** 当前聚合模式的界面文案。 */
  mode: string;
  rows: Checkpoint[];
}

/** 摘要计数，给状态灯与徽标用。 */
export interface CheckSummary {
  total: number;
  ready: number;
  blocked: number;
  failed: number;
}

/** `detail` 里错误文本的最大长度；WebUI 徽标是单行控件。 */
const DETAIL_MAX = 64;

const clip = (value: string): string => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX - 1)}…` : flat;
};

/** 状态在 WebUI 上的一句话文案。 */
export const CHECK_LABEL: Record<CheckState, string> = {
  ready: '可用',
  anonymous: '匿名可用',
  'no-key': '缺密钥',
  off: '已关闭',
  'last-error': '上次失败',
};

/**
 * 本进程的调用台账。只保留每家最近一次，内存上限等于提供商数量。
 * 不持久化：跨重启的历史属于运行日志，不属于 WebUI 状态灯。
 */
export class ProviderLedger {
  private readonly runs = new Map<SearchProvider, LastRun>();

  /** 记下一轮并发调用的结果；同一家的旧记录被覆盖。 */
  record(
    entries: ReadonlyArray<{ id: SearchProvider; ok: boolean; error?: string; hits: number }>,
    ts: string,
  ): void {
    for (const entry of entries) {
      this.runs.set(entry.id, {
        ok: entry.ok,
        error: clip(entry.error ?? ''),
        hits: entry.hits,
        ts,
      });
    }
  }

  last(id: SearchProvider): LastRun | undefined {
    return this.runs.get(id);
  }

  /** 已记录过调用的家数，用于区分「没试过」与「试了都成功」。 */
  get size(): number {
    return this.runs.size;
  }

  clear(): void {
    this.runs.clear();
  }

  /**
   * 逐家算检查点，顺序取 `SINGLE_MODE_PRIORITY`，与提示词里的「可用引擎范围」一致。
   * 判定按四步走。第一步看开关，第二步看密钥，第三步看上一次调用，第四步区分匿名与可用。
   */
  checkpoints(
    cfg: Partial<WebSearchConfigSection> | null | undefined,
    keyOf: (secretName: string) => string | undefined,
  ): Checkpoint[] {
    const switches: ProviderSwitches = cfg?.providers ?? WEB_SEARCH_DEFAULTS.providers;
    const rows: Checkpoint[] = [];
    const push = (
      id: SearchProvider,
      state: CheckState,
      detail: string,
      switchOn: boolean,
      keyed: boolean,
      lastTs: string,
    ): void => {
      rows.push({ id, state, detail, switchOn, keyed, secretName: PROVIDER_SECRET[id], lastTs });
    };
    for (const id of SINGLE_MODE_PRIORITY) {
      const secretName = PROVIDER_SECRET[id];
      const anonymous = ANONYMOUS_PROVIDERS.has(id);
      const switchOn = switches[id] !== false;
      const key = keyOf(secretName);
      const keyed = Boolean(key);
      const run = this.runs.get(id);
      const lastTs = run?.ts ?? '';
      if (!switchOn) {
        push(id, 'off', run && !run.ok ? `关闭前上次失败：${run.error}` : '配置面板已关闭', false, keyed, lastTs);
        continue;
      }
      if (!key && !anonymous) {
        push(id, 'no-key', `缺少密钥 ${secretName}`, true, false, lastTs);
        continue;
      }
      if (run && !run.ok) {
        push(id, 'last-error', run.error || '上次调用失败', true, keyed, lastTs);
        continue;
      }
      if (!key && anonymous) {
        push(id, 'anonymous', run ? `匿名调用 ${run.hits} 条` : '匿名可用，尚未调用', true, false, lastTs);
        continue;
      }
      push(id, 'ready', run ? `上次成功 ${run.hits} 条` : '已配密钥，尚未调用', true, true, lastTs);
    }
    return rows;
  }
}

/** 按检查点算摘要。`ready` 含匿名可用，与 `usableProviders()` 同口径。 */
export function summarize(rows: readonly Checkpoint[]): CheckSummary {
  let ready = 0;
  let blocked = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.state === 'ready' || row.state === 'anonymous') ready += 1;
    if (row.state === 'no-key' || row.state === 'off') blocked += 1;
    if (row.state === 'last-error') failed += 1;
  }
  return { total: rows.length, ready, blocked, failed };
}

/** 失败的家的 id 列表，给状态灯 hint。 */
export function failedIds(rows: readonly Checkpoint[]): string[] {
  return rows.filter((row) => row.state === 'last-error').map((row) => row.id);
}

/** 被挡在门外的家的 id 列表（关闭或缺密钥），给状态灯 hint。 */
export function blockedIds(rows: readonly Checkpoint[]): string[] {
  return rows.filter((row) => row.state === 'no-key' || row.state === 'off').map((row) => row.id);
}
