import type { ConfigGroup } from 'cortico/core/types.ts';
import type { WorldSection } from 'cortico/world.ts';

/**
 * World id。同时派生实例 id、事件 type、配置键 `worlds.<id>.*` 与 promptDoc key，
 * 所以只在这里写一次。
 */
export const WEB_SEARCH_ID = 'web-search-multi';

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
}

/** `worlds.web-search-multi` 的缺省值：全部提供商开启，最多返回 5 条。 */
export const WEB_SEARCH_DEFAULTS: WebSearchConfigSection = {
  enabled: false,
  providers: {
    anysearch: true, tavily: true, exa: true, bocha: true, ali: true,
    zhipu: true, perplexity: true, serper: true, brave: true,
    mojeek: true, youcom: true, linkup: true, firecrawl: true, kimi: true,
  },
  maxResults: 5,
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
