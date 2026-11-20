import type { WorldDefinition } from 'cortico/world.ts';
import { describeTools } from 'cortico/world.ts';
import type { WebSearchConfigSection } from './config.ts';
import { WEB_SEARCH_DEFAULTS, WEB_SEARCH_ID } from './config.ts';
import { WEB_SEARCH_TOOL_DECLS, WebSearchWorld } from './world.ts';

/**
 * `web-search-multi` World 的定义。
 *
 * id 不能是 `web-search`：官方包 `cortico-world-websearch@0.2.17` 已发布，
 * 首次发布前就用不近名的值；工具名同理不能是内建的 `web_search`。
 */
export const WebSearch: WorldDefinition<WebSearchConfigSection> = {
  id: WEB_SEARCH_ID,
  label: WEB_SEARCH_ID,
  defaults: () => structuredClone(WEB_SEARCH_DEFAULTS),
  create: (ctx) => new WebSearchWorld({
    cfg: ctx.cfg,
    timezone: ctx.timezone,
    getApiKey: (name: string) => ctx.secret(name),
    botDir: ctx.botDir,
  }),
  describe: {
    tools: describeTools(WEB_SEARCH_TOOL_DECLS, {
      web_search_multi: {
        zh: '在多个搜索提供商上并行搜索，返回去重后的标题、网址和简介；可用 max_results 限制返回条数，最多 10 条。',
        en: 'Search several providers in parallel and return deduplicated titles, URLs and snippets. Limit results with max_results, at most 10.',
      },
    }),
    events: [
      {
        type: `${WEB_SEARCH_ID}.started`,
        description: {
          zh: '世界已挂载。',
          en: 'The world was mounted.',
        },
      },
    ],
  },
};
