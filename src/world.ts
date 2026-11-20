import type { ToolCallContext, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { fileURLToPath } from 'node:url';
import {
  PROVIDER_SECRET,
  SearchProvider,
  WEB_SEARCH_CONFIG_GROUP,
  WEB_SEARCH_DEFAULTS,
  type ProviderSwitches,
  type WebSearchConfigSection,
} from './config.ts';

const WEB_SEARCH_ID = 'web-search';
const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

/** 工具声明，与 describe.json 的 web_search 一致。 */
const TOOL_DECLS: ToolDef[] = [
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

const ENV_PROMPT_KEY = `worlds.${WEB_SEARCH_ID}.envPrompt`;

/** 把任一提供商的返回归一化为 { title, url, snippet }[]。 */
function normalize(data: unknown): { title: string; url: string; snippet: string; provider: string }[] {
  const raw =
    Array.isArray(data)
      ? data
      : (data as { results?: unknown; items?: unknown } | null)?.results ??
        (data as { items?: unknown })?.items ??
        [];
  const out: { title: string; url: string; snippet: string; provider: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title : typeof r.name === 'string' ? r.name : '';
    const url =
      typeof r.url === 'string' ? r.url : typeof r.link === 'string' ? r.link : typeof r.uri === 'string' ? r.uri : '';
    const snippet =
      typeof r.snippet === 'string' ? r.snippet : typeof r.content === 'string' ? r.content : typeof r.summary === 'string' ? r.summary : '';
    if (!title && !url) continue;
    out.push({ title, url, snippet, provider: '' });
  }
  return out;
}

/** 单提供商请求配置。 */
interface ProviderRequest {
  provider: SearchProvider;
  url: string;
  headers: Record<string, string>;
  body: string;
  ok: (status: number) => boolean;
  parse: (json: unknown) => { title: string; url: string; snippet: string }[];
}

/** 各提供商的请求构造：密钥、端点、鉴权方式、body 形状、结果路径按官方文档。 */
function providerRequests(
  keys: Partial<Record<SearchProvider, string>>,
  query: string,
  maxResults: number,
  anysearchEndpoint?: string,
): ProviderRequest[] {
  const req = (provider: SearchProvider, url: string, headers: Record<string, string>, body: unknown) => ({
    provider,
    url,
    headers,
    body: JSON.stringify(body),
    ok: (status: number) => status >= 200 && status < 300,
    parse: (json: unknown) => normalize(json).map((r) => ({ ...r, provider })),
  });

  const out: ProviderRequest[] = [];

  if (keys.anysearch) {
    out.push(req(
      'anysearch',
      anysearchEndpoint ?? 'https://api.anysearch.com/v1/search',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.anysearch}` },
      { query, max_results: maxResults },
    ));
  }
  if (keys.tavily) {
    out.push(req(
      'tavily',
      'https://api.tavily.com/search',
      { 'Content-Type': 'application/json' },
      { api_key: keys.tavily, query, max_results: maxResults },
    ));
  }
  if (keys.exa) {
    out.push(req(
      'exa',
      'https://api.exa.ai/search',
      { 'Content-Type': 'application/json', 'x-api-key': keys.exa },
      { query, num_results: maxResults },
    ));
  }
  if (keys.bocha) {
    out.push(req(
      'bocha',
      'https://api.bocha.ai/search',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.bocha}` },
      { query, count: maxResults },
    ));
  }
  if (keys.ali) {
    out.push(req(
      'ali',
      'https://api.iqs.aliyun.com/search',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.ali}` },
      { query, page_size: maxResults },
    ));
  }
  if (keys.tencent) {
    out.push(req(
      'tencent',
      'https://search.tencent.com/api/search',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.tencent}` },
      { query, limit: maxResults },
    ));
  }
  if (keys.zhipu) {
    out.push(req(
      'zhipu',
      'https://open.bigmodel.cn/api/paas/v4/tools/web_search',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.zhipu}` },
      { query, search_result_count: maxResults },
    ));
  }
  if (keys.perplexity) {
    out.push(req(
      'perplexity',
      'https://api.perplexity.ai/chat/completions',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${keys.perplexity}` },
      { model: 'sonar', messages: [{ role: 'user', content: query }], max_tokens: maxResults },
    ));
  }
  if (keys.serper) {
    out.push(req(
      'serper',
      'https://google.serper.dev/search',
      { 'Content-Type': 'application/json', 'X-API-KEY': keys.serper },
      { q: query, num: maxResults },
    ));
  }
  if (keys.brave) {
    out.push(req(
      'brave',
      'https://api.search.brave.com/res/v1/web/search',
      { 'Content-Type': 'application/json', 'X-Subscription-Token': keys.brave },
      { q: query, count: maxResults },
    ));
  }

  return out;
}

/** 各提供商原始 JSON 的结果路径解析（与 providerRequests 同序）。 */
function parseProvider(provider: SearchProvider, json: unknown): { title: string; url: string; snippet: string }[] {
  switch (provider) {
    case 'perplexity': {
      const c = json as { choices?: Array<{ message?: { content?: string } }> } | null;
      const content = c?.choices?.[0]?.message?.content ?? '';
      return [{ title: 'Perplexity 答案', url: '', snippet: content }];
    }
    case 'serper': {
      const s = json as { answerBox?: { title?: string; link?: string; snippet?: string }; organic?: unknown[] } | null;
      const extra: { title: string; url: string; snippet: string }[] = [];
      if (s?.answerBox) {
        extra.push({
          title: s.answerBox.title ?? 'Serper 答案框',
          url: s.answerBox.link ?? '',
          snippet: s.answerBox.snippet ?? '',
        });
      }
      if (Array.isArray(s?.organic)) {
        for (const o of s.organic) {
          if (!o || typeof o !== 'object') continue;
          const r = o as Record<string, unknown>;
          extra.push({
            title: typeof r.title === 'string' ? r.title : '',
            url: typeof r.link === 'string' ? r.link : '',
            snippet: typeof r.snippet === 'string' ? r.snippet : '',
          });
        }
      }
      return extra;
    }
    default: {
      return normalize(json).map((r) => ({ ...r, provider }));
    }
  }
}

/** 面板提示：对用户说明各提供商的价格、定位、优势与硬约束。 */
export const PROVIDER_HINTS: Record<SearchProvider, { price: string; position: string; strength: string; hardLimit: string }> = {
  anysearch: {
    price: '免费 1000 次/天',
    position: 'API + MCP + Skill，个人项目与原型首选',
    strength: '免费额度大，多协议可用',
    hardLimit: '匿名访问受较低限速，建议配 API key',
  },
  tavily: {
    price: '$8/千次（1000 credits/月免费）',
    position: 'Agent 默认项，含 extract/crawl/map',
    strength: '2026 年并入 Nebius，Agent 原生',
    hardLimit: '密钥必填，无匿名访问',
  },
  exa: {
    price: '$7/千次（快速模式 $4）',
    position: '向量语义检索，擅长探索式查询',
    strength: '索引新，适合“找不到关键词”的场景',
    hardLimit: '密钥必填，密钥以 x-api-key 头传递',
  },
  bocha: {
    price: '约 ¥20/千次',
    position: '中文场景综合最强，自带 reranker',
    strength: '0.15s 延迟，支持 MCP，中文覆盖广',
    hardLimit: '密钥必填，中文搜索为主',
  },
  ali: {
    price: '约 ¥12/千次 Lite，Standard ¥30–42，Deep ¥50',
    position: '有 OpenAI 兼容格式的国内主力',
    strength: '阿里云联网搜索，国内访问稳定',
    hardLimit: '密钥必填，付费后付费',
  },
  tencent: {
    price: '约 ¥18–22/千次轻量版后付费',
    position: '腾讯云联网搜索轻量版',
    strength: '国内主流引擎，后付费计费',
    hardLimit: '密钥必填，需腾讯云账号',
  },
  zhipu: {
    price: '含在 token 费用内',
    position: 'Tool Calling + MCP，聚合 5 家引擎',
    strength: '聚合多引擎，调用简单',
    hardLimit: '密钥必填，随模型账单计费',
  },
  perplexity: {
    price: '$5/千次',
    position: '原始结果，索引新、覆盖广',
    strength: '答案带引用，适合深度研究',
    hardLimit: '密钥必填，Sonar 异步接口已停止支持',
  },
  serper: {
    price: '$0.3–1/千次',
    position: '最便宜的 Google SERP，无正文提取',
    strength: '价格最低，适合排名追踪',
    hardLimit: '密钥必填，不含正文，合规风险自评',
  },
  brave: {
    price: '$5/月免费额度',
    position: '自有索引约 300 亿页，不依赖 Google/Bing',
    strength: '自建索引，避免单一供应商',
    hardLimit: '密钥必填，免费额度有限',
  },
};

/** 聚合：并行调用所有开启且有密钥的提供商，按 url 去重，截断到 maxResults。 */
async function searchAllProviders(
  keys: Partial<Record<SearchProvider, string>>,
  switches: ProviderSwitches,
  query: string,
  maxResults: number,
  anysearchEndpoint?: string,
): Promise<{ title: string; url: string; snippet: string; provider: string }[]> {
  const requests = providerRequests(keys, query, maxResults, anysearchEndpoint).filter((r) => switches[r.provider]);

  const results = await Promise.all(
    requests.map(async (r) => {
      try {
        const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: r.body });
        if (!r.ok(res.status)) throw new Error(`${r.provider} HTTP ${res.status}`);
        const json = await res.json();
        return parseProvider(r.provider, json).map((x) => ({ ...x, provider: r.provider }));
      } catch {
        return [] as { title: string; url: string; snippet: string; provider: string }[];
      }
    }),
  );

  const merged = results.flat();
  const seen = new Set<string>();
  const deduped: { title: string; url: string; snippet: string; provider: string }[] = [];
  for (const item of merged) {
    const key = item.url.toLowerCase();
    if (!item.url || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.slice(0, maxResults);
}

export class WebSearchWorld implements World {
  readonly id = WEB_SEARCH_ID;
  private host: WorldHost | null = null;

  constructor(private readonly opts: { cfg: WebSearchConfigSection; timezone: string; getApiKey: (name: string) => string | undefined }) {}

  envPromptVars(): Record<string, string> {
    return { 'web-search.endpoint': this.opts.cfg.endpoint ?? '(default)' };
  }

  tools(): ToolDef[] {
    return [{ ...TOOL_DECLS[0], handler: this.searchHandler.bind(this) }];
  }

  webUi(): WorldWebUiDecl {
    return {
      label: 'web-search',
      config: [WEB_SEARCH_CONFIG_GROUP],
      promptDocs: [
        {
          key: ENV_PROMPT_KEY,
          title: 'Web 搜索环境',
          description: '在哪些情况下调用 web_search，如何引用搜索结果，不要滥用搜索，各提供商的价格与约束见面板提示。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'web-search.endpoint', description: 'Anysearch 的 REST 端点，留空则按提供商默认。' },
          ],
        },
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    await host.pushEvent({
      type: 'web-search.started',
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      ts: nowIso(this.opts.timezone),
      text: 'web-search 已就绪。',
    });
  }

  async stop(): Promise<void> {
    this.host = null;
  }

  private async searchHandler(args: Record<string, unknown>, _ctx: ToolCallContext): Promise<ToolOutcome> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return { text: '缺少查询关键词。', failed: true };
    const maxResults = typeof args.max_results === 'number' && Number.isFinite(args.max_results)
      ? Math.min(10, Math.max(1, Math.floor(args.max_results)))
      : 5;

    const keys: Partial<Record<SearchProvider, string>> = {};
    for (const provider of Object.keys(PROVIDER_SECRET) as SearchProvider[]) {
      const k = this.opts.getApiKey(PROVIDER_SECRET[provider]);
      if (k) keys[provider] = k;
    }
    if (Object.keys(keys).length === 0) {
      return {
        text: '缺少搜索密钥：请在宿主的 secrets 中设置 ANYSEARCH_API_KEY / TAVILY_API_KEY / EXA_API_KEY / BOCHA_API_KEY / ALI_IQS_API_KEY / TENCENT_SEARCH_API_KEY / ZHIPU_API_KEY / PERPLEXITY_API_KEY / SERPER_API_KEY / BRAVE_API_KEY（按提供商），不要把密钥写入配置文件明文。',
        failed: true,
      };
    }

    let results: { title: string; url: string; snippet: string; provider: string }[];
    try {
      results = await searchAllProviders(keys, this.opts.cfg.providers, query, maxResults, this.opts.cfg.endpoint);
    } catch (err) {
      return { text: `搜索失败：${(err as Error)?.message ?? String(err)}`, failed: true };
    }

    const hintLines = Object.entries(PROVIDER_HINTS).map(([p, h]) => `- ${p}: ${h.price}，${h.position}；${h.strength}。${h.hardLimit}`).join('\n');
    const lines = results.map((r, i) => `${i + 1}. [${r.provider}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n');
    return { text: `${lines || '未找到结果。'}\n\n提供商提示：\n${hintLines}` };
  }
}
