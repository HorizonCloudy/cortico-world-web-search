import type { WorldDefinition } from 'cortico/world.ts';
import { describeTools } from 'cortico/world.ts';
import type { WebSearchConfigSection } from './config.ts';
import { WEB_SEARCH_CONFIG_GROUP, WEB_SEARCH_DEFAULTS } from './config.ts';
import { WebSearchWorld } from './world.ts';

/** 工具声明，与 describe.json 的 web_search 一致（handler 在 world.tools() 中绑定）。 */
const TOOL_DECLS = [
  {
    name: 'web_search',
    description: '按关键词在网上搜索，返回标题、网址和简介；可用 max_results 限制返回条数，最多 10 条。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'The search query.' },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 5,
          description: 'Maximum number of results to return.',
        },
      },
      required: ['query'],
    },
    tags: ['read'],
  },
];

/** `web-search` World 的定义。 */
export const WebSearch: WorldDefinition<WebSearchConfigSection> = {
  id: 'web-search',
  label: 'web-search',
  defaults: () => structuredClone(WEB_SEARCH_DEFAULTS),
  create: (ctx) => new WebSearchWorld({
    cfg: ctx.cfg,
    timezone: ctx.timezone,
    getApiKey: (name: string) => ctx.secret(name),
  }),
  describe: {
    tools: describeTools(TOOL_DECLS, {
      web_search: {
        zh: '按关键词在网上搜索，返回标题、网址和简介；可用 max_results 限制返回条数，最多 10 条。',
        en: 'Search the web by keyword and return titles, URLs and snippets. Limit results with max_results, at most 10.',
      },
    }),
    events: [
      {
        type: 'web-search.started',
        description: {
          zh: '世界已挂载。',
          en: 'The world was mounted.',
        },
      },
    ],
  },
};

export { WebSearch };
export type { WebSearchConfigSection };
