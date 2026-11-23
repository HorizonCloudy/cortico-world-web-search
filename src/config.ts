import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WorldSection } from 'cortico/world.ts';

/**
 * World id。同时派生实例 id、事件 type、配置键 `worlds.<id>.*` 与 promptDoc key，
 * 所以只在这里写一次。
 */
export const WEB_SEARCH_ID = 'web-search-multi';

/** World 显示名。用于 `WorldDefinition.label` 与 `webUi().label`，与 package.json 的 `cortico.displayName` 一致。 */
export const WEB_SEARCH_LABEL = '聚合搜索';

/** 聚合搜索支持的提供商，按价格从低到高（官方价随变动，仅作量级参考）。 */
export type SearchProvider =
  | 'anysearch'
  | 'tavily'
  | 'exa'
  | 'bocha'
  | 'ali'
  | 'zhipu'
  | 'perplexity'
  | 'serper'
  | 'brave'
  | 'mojeek'
  | 'youcom'
  | 'linkup'
  | 'firecrawl'
  | 'kimi';

/** 每个提供商的宿主 secret 名；密钥由宿主注入，不写入配置文件明文。 */
export const PROVIDER_SECRET: Record<SearchProvider, string> = {
  anysearch: 'ANYSEARCH_API_KEY',
  tavily: 'TAVILY_API_KEY',
  exa: 'EXA_API_KEY',
  bocha: 'BOCHA_API_KEY',
  ali: 'ALI_IQS_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  serper: 'SERPER_API_KEY',
  brave: 'BRAVE_API_KEY',
  mojeek: 'MOJEEK_API_KEY',
  youcom: 'YDC_API_KEY',
  linkup: 'LINKUP_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
};

/**
 * 全部 provider id 的运行时单一来源：逐字派生自 PROVIDER_SECRET。
 * PROVIDER_SECRET 是 Record<SearchProvider, string>，TS 保证其键与 SearchProvider 联合逐字同源；
 * 工具 enum、PROVIDER_ADAPTERS.id、一致性测试都对齐这张表，加引擎时只改上面一处。
 */
export const SEARCH_PROVIDER_IDS = Object.keys(PROVIDER_SECRET) as SearchProvider[];

/**
 * 无需密钥也能调用的提供商（匿名限速）。与 `PROVIDER_ADAPTERS` 的 `requiresKey: false` 同义，
 * 放在这里是为了让 `prompt-vars.ts` 只依赖本文件、不反向 import `world.ts`（会成环）。
 */
export const ANONYMOUS_PROVIDERS: ReadonlySet<SearchProvider> = new Set<SearchProvider>(['anysearch']);

/** 每家的定位短句，给提示词「可用引擎范围」用；状态（已配密钥/匿名可用）由渲染时现算。 */
export const PROVIDER_NOTE: Record<SearchProvider, string> = {
  anysearch: '限速较低，配密钥后额度更大',
  tavily: 'Agent 原生，稳定',
  exa: '向量语义检索',
  bocha: '中文覆盖广、延迟低',
  ali: '国内访问稳定',
  zhipu: '聚合引擎，随模型计费',
  perplexity: '索引新，摘要可能为空',
  serper: '最便宜的 Google SERP',
  brave: '自有索引，不依赖 Google/Bing',
  mojeek: '独立欧洲索引',
  youcom: 'Web + News 双源',
  linkup: 'agentic 检索',
  firecrawl: '垂类索引（research/pdf 等）',
  kimi: '国内直连',
};

/**
 * 聚合模式：
 * - `multi`：并发调用全部可用引擎，跨源按 url 去重（默认，与旧行为逐字一致）。
 * - `single`：只调用优先级最高的一家，失败不自动换家。
 */
export type SearchMode = 'multi' | 'single';

/** 面板 enum 的单一来源。 */
export const SEARCH_MODES: readonly SearchMode[] = ['multi', 'single'];

/** 各提供商是否参与聚合；缺失密钥的提供商在运行时自动跳过。 */
export interface ProviderSwitches {
  anysearch: boolean;
  tavily: boolean;
  exa: boolean;
  bocha: boolean;
  ali: boolean;
  zhipu: boolean;
  perplexity: boolean;
  serper: boolean;
  brave: boolean;
  mojeek: boolean;
  youcom: boolean;
  linkup: boolean;
  firecrawl: boolean;
  kimi: boolean;
}

/** 配置节 `worlds.web-search-multi`。 */
export interface WebSearchConfigSection extends WorldSection {
  /** 是否启用此 World。 */
  enabled: boolean;
  /** 参与聚合的提供商开关。 */
  providers: ProviderSwitches;
  /** 一次搜索最多返回的结果条数。 */
  maxResults: number;
  /**
   * 聚合模式。旧配置文件没有这个键，装配层用 `defaults()` 深合并补齐（`deploy.ts:150-156`），
   * 读取处仍用 `resolveSearchMode()` 归一，未知值回落 `multi`。
   */
  searchMode: SearchMode;
}

/** `worlds.web-search-multi` 的缺省值：全部提供商开启，最多返回 5 条，多引擎优先。 */
export const WEB_SEARCH_DEFAULTS: WebSearchConfigSection = {
  enabled: false,
  providers: {
    anysearch: true, tavily: true, exa: true, bocha: true, ali: true,
    zhipu: true, perplexity: true, serper: true, brave: true,
    mojeek: true, youcom: true, linkup: true, firecrawl: true, kimi: true,
  },
  maxResults: 5,
  searchMode: 'multi',
};

const K = `worlds.${WEB_SEARCH_ID}`;

/** 控制台的配置组：开关逐家派生自 providers，无端点覆盖旋钮。 */
export const WEB_SEARCH_CONFIG_GROUP: ConfigGroup = {
  id: `world:${WEB_SEARCH_ID}`,
  owner: `world:${WEB_SEARCH_ID}`,
  schema: {
    type: 'object',
    title: 'Web 搜索（多源聚合）',
    properties: {
      [`${K}.enabled`]: {
        type: 'boolean',
        title: '启用',
        description: `是否启用 ${WEB_SEARCH_ID} 多源聚合搜索世界。`,
      },
      [`${K}.searchMode`]: {
        type: 'string',
        title: '搜索模式',
        enum: [...SEARCH_MODES],
        description: 'multi：并发全部可用引擎、按 url 去重（默认）；single：只调用优先级最高的一家，失败不自动换家。改完重载前缀后提示词里的方案段才刷新。',
      },
      ...Object.fromEntries((Object.keys(WEB_SEARCH_DEFAULTS.providers) as SearchProvider[]).map((p) => [
        `${K}.providers.${p}`,
        { type: 'boolean', title: `启用 ${p}`, description: `是否让 ${p} 参与聚合；缺密钥时自动跳过。` },
      ])),
      [`${K}.maxResults`]: {
        type: 'integer',
        title: '最大结果数',
        minimum: 1,
        maximum: 10,
        description: '一次搜索最多返回的结果条数（逐家去重后再截断）。',
      },
    },
  },
};
