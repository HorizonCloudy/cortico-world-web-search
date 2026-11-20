import type { ConfigGroup, WorldSection } from 'cortico/core/types.ts';

export const WEB_SEARCH_ID = 'web-search';

/** 聚合搜索支持的提供商，按价格从低到高（美元/千次，官方价随变动，仅作量级参考）。 */
export type SearchProvider =
  | 'anysearch'
  | 'tavily'
  | 'exa'
  | 'bocha'
  | 'ali'
  | 'tencent'
  | 'zhipu'
  | 'perplexity'
  | 'serper'
  | 'brave';

/** 每个提供商的宿主 secret 名；密钥由宿主注入，不写入配置文件明文。 */
export const PROVIDER_SECRET: Record<SearchProvider, string> = {
  anysearch: 'ANYSEARCH_API_KEY',
  tavily: 'TAVILY_API_KEY',
  exa: 'EXA_API_KEY',
  bocha: 'BOCHA_API_KEY',
  ali: 'ALI_IQS_API_KEY',
  tencent: 'TENCENT_SEARCH_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  serper: 'SERPER_API_KEY',
  brave: 'BRAVE_API_KEY',
};

/** 各提供商是否参与聚合；缺失密钥的提供商在运行时自动跳过。 */
export interface ProviderSwitches {
  anysearch: boolean;
  tavily: boolean;
  exa: boolean;
  bocha: boolean;
  ali: boolean;
  tencent: boolean;
  zhipu: boolean;
  perplexity: boolean;
  serper: boolean;
  brave: boolean;
}

/** 配置节 `worlds.web-search`。 */
export interface WebSearchConfigSection extends WorldSection {
  /** 是否启用此 World。 */
  enabled: boolean;
  /** 参与聚合的提供商开关。 */
  providers: ProviderSwitches;
  /** Anysearch 的 REST 端点覆盖；留空则按提供商默认。 */
  endpoint?: string;
  /** 一次搜索最多返回的结果条数。 */
  maxResults: number;
}

/** `worlds.web-search` 的缺省值：全部提供商开启，最多返回 5 条。 */
export const WEB_SEARCH_DEFAULTS: WebSearchConfigSection = {
  enabled: false,
  providers: {
    anysearch: true, tavily: true, exa: true, bocha: true,
    ali: true, tencent: true, zhipu: true, perplexity: true,
    serper: true, brave: true,
  },
  endpoint: '',
  maxResults: 5,
};

const K = `worlds.${WEB_SEARCH_ID}`;

/** 控制台的配置组。 */
export const WEB_SEARCH_CONFIG_GROUP: ConfigGroup = {
  id: `world:${WEB_SEARCH_ID}`,
  owner: `world:${WEB_SEARCH_ID}`,
  schema: {
    type: 'object',
    title: 'Web 搜索',
    properties: {
      [`${K}.enabled`]: {
        type: 'boolean',
        title: '启用',
        description: '是否启用 web-search 聚合搜索世界。',
      },
      [`${K}.endpoint`]: {
        type: 'string',
        title: 'Anysearch 端点覆盖',
        description: 'Anysearch 的 REST 端点；留空则按提供商默认。',
      },
      [`${K}.maxResults`]: {
        type: 'integer',
        title: '最大结果数',
        minimum: 1,
        maximum: 10,
        default: 5,
        description: '一次搜索最多返回的结果条数。',
      },
    },
  },
};
