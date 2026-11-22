/**
 * 环境提示词变量的纯函数层：可用引擎范围、搜索方案、聚合模式。
 *
 * 只依赖 `config.ts`，不 import `world.ts`：adapter 表在 world.ts，反向依赖会成环。
 * 三个 describe 函数都不联网、不读 fs，`envPromptVars()` 拿它们拼出四键。
 *
 * 占位符正则只认 `[\w.]`（`cortico/core/template.ts:9`），world id 带连字符，
 * 所以变量名里的 world id 一律写成下划线。
 */
import {
  ANONYMOUS_PROVIDERS,
  PROVIDER_NOTE,
  PROVIDER_SECRET,
  WEB_SEARCH_DEFAULTS,
  WEB_SEARCH_ID,
} from './config.ts';
import type { SearchMode, SearchProvider, WebSearchConfigSection } from './config.ts';

/** 变量名前缀：world id 的连字符换成下划线。 */
export const VAR_PREFIX = WEB_SEARCH_ID.replace(/-/g, '_');

export const ENV_FILE_VAR = `${VAR_PREFIX}.envFile`;
export const AVAILABLE_VAR = `${VAR_PREFIX}.availableProviders`;
export const PLAN_VAR = `${VAR_PREFIX}.searchPlan`;
export const MODE_VAR = `${VAR_PREFIX}.searchMode`;

/**
 * 单引擎优先模式的选家顺序（也是提示词里「可用引擎范围」的展示顺序）。
 *
 * 不从 `PROVIDER_ADAPTERS` 派生：adapter 表按价格升序、匿名限速的 anysearch 排第一，
 * 派生会让单引擎模式永远打到最弱的一家。显式表 + 「与 `SEARCH_PROVIDER_IDS` 互为全排列」
 * 的测试，加第 15 家时同样会红。
 *
 * 排序理由：中文场景（bocha）与 Agent 原生通用（tavily）优先，自有索引（brave）次之，
 * 垂直与国内补充源居中，匿名限速的 anysearch 垫底。
 */
export const SINGLE_MODE_PRIORITY: readonly SearchProvider[] = [
  'bocha',
  'tavily',
  'brave',
  'exa',
  'ali',
  'zhipu',
  'serper',
  'mojeek',
  'youcom',
  'linkup',
  'firecrawl',
  'kimi',
  'perplexity',
  'anysearch',
];

/** 读模式：只有显式 `single` 才走单引擎，`undefined` / 空 / 未知值一律回落 `multi`。 */
export function resolveSearchMode(
  cfg: Partial<WebSearchConfigSection> | null | undefined,
): SearchMode {
  return cfg?.searchMode === 'single' ? 'single' : 'multi';
}

/** 读条数：缺省/非法回落 5，夹在 1..10。 */
export function resolveMaxResults(
  cfg: Partial<WebSearchConfigSection> | null | undefined,
): number {
  const raw = cfg?.maxResults;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return WEB_SEARCH_DEFAULTS.maxResults;
  return Math.min(10, Math.max(1, Math.floor(raw)));
}

/** 一家可调用的引擎。`keyed` 为 false 只可能是匿名可用的家。 */
export interface UsableProvider {
  id: SearchProvider;
  keyed: boolean;
}

/**
 * 按 `SINGLE_MODE_PRIORITY` 顺序算出当前可调用的引擎：
 * 开关没关（缺键视为打开），且「不需要密钥 或 密钥已配置」。
 */
export function usableProviders(
  cfg: Partial<WebSearchConfigSection> | null | undefined,
  keyOf: (secretName: string) => string | undefined,
): UsableProvider[] {
  const switches = cfg?.providers ?? WEB_SEARCH_DEFAULTS.providers;
  const usable: UsableProvider[] = [];
  for (const id of SINGLE_MODE_PRIORITY) {
    if (switches[id] === false) continue;
    const keyed = Boolean(keyOf(PROVIDER_SECRET[id]));
    if (!keyed && !ANONYMOUS_PROVIDERS.has(id)) continue;
    usable.push({ id, keyed });
  }
  return usable;
}

/** 「可用引擎范围」段：逐家状态 + 定位短句；N=0 时给可操作兜底。 */
export function describeAvailableProviders(usable: readonly UsableProvider[]): string {
  if (!usable.length) {
    return '当前没有可调用引擎：配置面板里的开关全关，或缺密钥（anysearch 可匿名使用）。此时调用 web_search_multi 会返回明确错误，请先让使用者开启至少一家并配置密钥。';
  }
  const lines = usable.map(({ id, keyed }) => `- ${id}（${keyed ? '已配密钥' : '匿名可用'}）：${PROVIDER_NOTE[id]}`);
  return [
    `共 ${usable.length} 家可调用（顺序为单引擎优先模式的选取优先级）：`,
    ...lines,
    '未列出的引擎已在配置面板关闭或缺少密钥；对它们显式指定 provider 会返回错误，不会静默改用别家。',
  ].join('\n');
}

/** 「已启用引擎的搜索方案」段：按模式给调用顺序/组合方式/结果汇总/失败回退。 */
export function describeSearchPlan(
  mode: SearchMode,
  usable: readonly UsableProvider[],
  maxResults: number,
): string {
  if (!usable.length) {
    return '当前没有可调用引擎，任何调用都会直接报错；开启至少一家并配置密钥后本段会重算。';
  }
  if (mode === 'single') {
    const first = usable[0].id;
    return [
      `- 调用顺序：串行，只调用一家——取上文「可用引擎范围」的第一家（当前选中 ${first}）。`,
      '- 组合方式：单源，不做跨源合并与去重。',
      `- 结果汇总：${first} 的命中直接截断到 max_results（默认 ${maxResults}，上限 10）；每条带 [${first}]。`,
      '- 失败回退：不自动换家。该家报错时回执给出原因，无命中时只报「未找到结果」；换源请显式传 provider，或让使用者切回多引擎优先。',
    ].join('\n');
  }
  return [
    `- 调用顺序：并发，无先后（一次请求同时问上面全部 ${usable.length} 家）。`,
    '- 组合方式：按内置 adapter 表顺序拼接各家命中，不按引擎权重重排。',
    `- 结果汇总：按 url 去重（忽略大小写，先到先留）→ 截断到 max_results（默认 ${maxResults}，上限 10）；每条带 [provider]。`,
    '- 失败回退：单家失败只跳过该家，其余家结果照常返回；失败家记一条 warn，拿不到运行日志时附在回执末尾；全部失败或无命中时报「未找到结果」。',
  ].join('\n');
}

/** 「搜索模式」段：前缀快照的当前值。 */
export function describeSearchMode(mode: SearchMode): string {
  return mode === 'single' ? '单引擎优先（single）' : '多引擎优先（multi）';
}

/**
 * 读配置失败时的三键兜底：值必须非空，否则 `{{...}}` 会原样泄进系统提示词
 * （`cortico/core/template.ts:27` 对未声明/未赋值的占位符原样保留）。
 *
 * 键是带 `web_search_multi.` 前缀的完整变量名——它会被展开进同一个 vars 对象。
 */
export const PROMPT_VARS_FALLBACK: Readonly<Record<string, string>> = {
  [AVAILABLE_VAR]: '引擎范围读取失败：按「面板默认全开、以已配密钥为准」处理，详情看配置面板。',
  [PLAN_VAR]: '搜索方案读取失败：按默认多引擎并行处理——全部可用引擎并发、按 url 去重后截断到 max_results。',
  [MODE_VAR]: '多引擎优先（multi）',
};

/** 三个变量一起算：`envPromptVars()` 再补上 `envFile`，凑满四键。 */
export function buildPromptVars(
  cfg: Partial<WebSearchConfigSection> | null | undefined,
  keyOf: (secretName: string) => string | undefined,
): Record<string, string> {
  const mode = resolveSearchMode(cfg);
  const usable = usableProviders(cfg, keyOf);
  return {
    [AVAILABLE_VAR]: describeAvailableProviders(usable),
    [PLAN_VAR]: describeSearchPlan(mode, usable, resolveMaxResults(cfg)),
    [MODE_VAR]: describeSearchMode(mode),
  };
}
