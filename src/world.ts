/**
 * 多 provider 聚合搜索 World：每家一个独立 adapter（各自的鉴权、端点、请求形状、结果路径），
 * 并行调用、按 url 去重、截断到 maxResults。单家失败只记一条 warn，不影响其他家。
 * 回执只给结果；价格与硬约束留在 ENV_PROMPT.md 与配置面板，不进模型上下文。
 */
import type { ToolCallContext, ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { fileURLToPath } from 'node:url';
import {
  PROVIDER_SECRET,
  SEARCH_PROVIDER_IDS,
  WEB_SEARCH_CONFIG_GROUP,
  WEB_SEARCH_DEFAULTS,
  WEB_SEARCH_ID,
} from './config.ts';
import type { ProviderSwitches, SearchProvider, WebSearchConfigSection } from './config.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const ENV_PROMPT_KEY = `worlds.${WEB_SEARCH_ID}.envPrompt`;
// 模板占位符正则只认 [\w.]，不支持连字符；world id 含连字符，故变量名用下划线。
const VAR_PREFIX = WEB_SEARCH_ID.replace(/-/g, '_');
const ENV_FILE_VAR = `${VAR_PREFIX}.envFile`;
const ANYSEARCH_ENDPOINT = 'https://api.anysearch.com/v1/search';

/**
 * 工具声明，与 describe.json 的 web_search_multi 一致。
 *
 * 工具名不能是 `web_search`：Cortico 内建 world `websearch` 已注册 `web_search`
 * （src/worlds/websearch/world.ts:53），干装载拿内建工具名当 takenToolNames，同名即 failure。
 */
export const WEB_SEARCH_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'web_search_multi',
    description: '按关键词在多个搜索提供商上并行搜索，返回去重后的标题、网址和简介；可用 max_results 限制返回条数，最多 10 条。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'The search query.' },
        provider: {
          type: 'string',
          enum: [...SEARCH_PROVIDER_IDS],
          description: '不填则并行调用所有已开启且已配密钥的引擎；填则只用这一家。',
        },
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

/** 归一化后的一条结果。 */
interface ProviderHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 一家提供商：密钥名、是否必须有密钥、请求构造、原始 JSON 解析。
 * 请求形状与结果路径逐家按官方文档写；新增一家就加一个 adapter，不改聚合逻辑。
 */
interface ProviderAdapter {
  id: SearchProvider;
  /** 环境变量名（宿主 secrets 的键）。 */
  secretName: string;
  /** false = 匿名可用（anysearch）。 */
  requiresKey: boolean;
  build(
    query: string,
    maxResults: number,
    key: string | undefined,
  ): { url: string; init: RequestInit };
  parse(json: unknown): ProviderHit[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 按候选字段名取第一个非空字符串。 */
function pick(obj: Record<string, unknown>, names: readonly string[]): string {
  for (const name of names) {
    const value = asString(obj[name]);
    if (value) return value;
  }
  return '';
}

/** 按路径取嵌套值；中途不是对象时返回 undefined。 */
function pickPath(root: unknown, ...path: readonly string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (!isObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

interface FieldNames {
  title: readonly string[];
  url: readonly string[];
  snippet: readonly string[];
}

/** 把一家提供商的数组按字段名映射成 ProviderHit；没有 url 的条目丢弃（去重键是 url）。 */
function toHits(list: unknown, fields: FieldNames): ProviderHit[] {
  const hits: ProviderHit[] = [];
  for (const raw of asArray(list)) {
    if (!isObject(raw)) continue;
    const url = pick(raw, fields.url);
    if (!url) continue;
    hits.push({ title: pick(raw, fields.title) || url, url, snippet: pick(raw, fields.snippet) });
  }
  return hits;
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

/** POST + JSON body 的通用请求构造。 */
function jsonPost(url: string, headers: Record<string, string>, body: unknown): { url: string; init: RequestInit } {
  return { url, init: { method: 'POST', headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) } };
}

const bearer = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });

/** 14 家提供商的 adapter 表；顺序即回执里合并的优先顺序。 */
export const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [
  {
    id: 'anysearch',
    secretName: PROVIDER_SECRET.anysearch,
    // 匿名可用：没配密钥时仍参与聚合，只是限速更低。
    requiresKey: false,
    build: (query, maxResults, key) => jsonPost(ANYSEARCH_ENDPOINT,
      key ? bearer(key) : {},
      { query, max_results: maxResults },
    ),
    parse: (json) => {
      // 先查业务码：非 0 视为失败，不把 error 字段当结果。
      const code = pickPath(json, 'code');
      if (code !== undefined && code !== null && String(code) !== '0') return [];
      const list = pickPath(json, 'data', 'results') ?? pickPath(json, 'results') ?? pickPath(json, 'items');
      return toHits(list, { title: ['title'], url: ['url'], snippet: ['snippet', 'content'] });
    },
  },
  {
    id: 'tavily',
    secretName: PROVIDER_SECRET.tavily,
    requiresKey: true,
    build: (query, maxResults, key) => jsonPost('https://api.tavily.com/search', {}, {
      query, max_results: maxResults, api_key: key ?? '',
    }),
    parse: (json) => toHits(pickPath(json, 'results'), { title: ['title'], url: ['url'], snippet: ['content'] }),
  },
  {
    id: 'exa',
    secretName: PROVIDER_SECRET.exa,
    requiresKey: true,
    build: (query, maxResults, key) => jsonPost('https://api.exa.ai/search', { 'x-api-key': key ?? '' }, {
      query, numResults: maxResults, contents: { highlights: true },
    }),
    parse: (json) => {
      const hits: ProviderHit[] = [];
      for (const raw of asArray(pickPath(json, 'results'))) {
        if (!isObject(raw)) continue;
        const url = pick(raw, ['url']);
        if (!url) continue;
        const highlights = asArray(raw.highlights).map(asString).filter(Boolean);
        hits.push({ title: pick(raw, ['title']) || url, url, snippet: highlights[0] ?? '' });
      }
      return hits;
    },
  },
  {
    id: 'bocha',
    secretName: PROVIDER_SECRET.bocha,
    requiresKey: true,
    build: (query, maxResults, key) => jsonPost('https://api.bochaai.com/v1/web-search', bearer(key ?? ''), {
      query, count: maxResults, summary: true,
    }),
    // Bing 兼容结构：data.webPages.value[]，标题字段是 name。
    parse: (json) => toHits(pickPath(json, 'data', 'webPages', 'value'), {
      title: ['name'], url: ['url'], snippet: ['snippet'],
    }),
  },
  {
    id: 'ali',
    secretName: PROVIDER_SECRET.ali,
    requiresKey: true,
    build: (query, maxResults, key) => jsonPost('https://cloud-iqs.aliyuncs.com/search/unified', bearer(key ?? ''), {
      query,
      engineType: 'LiteAdvanced',
      contents: { summary: true },
      advancedParams: { numResults: maxResults },
    }),
    parse: (json) => toHits(pickPath(json, 'pageItems'), {
      title: ['title'], url: ['link'], snippet: ['snippet'],
    }),
  },
  {
    id: 'zhipu',
    secretName: PROVIDER_SECRET.zhipu,
    requiresKey: true,
    build: (query, maxResults, key) => jsonPost('https://open.bigmodel.cn/api/paas/v4/web_search', bearer(key ?? ''), {
      search_query: query, search_engine: 'search_pro', count: maxResults,
    }),
    parse: (json) => toHits(pickPath(json, 'search_result'), {
      title: ['title'], url: ['link'], snippet: ['content'],
    }),
  },
  {
    id: 'perplexity',
    secretName: PROVIDER_SECRET.perplexity,
    requiresKey: true,
    // 检索接口是 /search，不是 chat/completions；Sonar Chat Completions 已于 2026-09-27 停止支持。
    build: (query, maxResults, key) => jsonPost('https://api.perplexity.ai/search', bearer(key ?? ''), {
      query, max_results: maxResults,
    }),
    parse: (json) => toHits(pickPath(json, 'results'), {
      title: ['title'], url: ['url'], snippet: ['snippet'],
    }),
  },
  {
    id: 'serper',
    secretName: PROVIDER_SECRET.serper,
    requiresKey: true,
    build: (query, maxResults, key) => jsonPost('https://google.serper.dev/search', { 'X-API-KEY': key ?? '' }, {
      q: query, num: maxResults,
    }),
    parse: (json) => {
      const hits: ProviderHit[] = [];
      // answerBox 是 Google 的直答框：有链接就排第一，没有链接就并入首条正文。
      const box = pickPath(json, 'answerBox');
      if (isObject(box)) {
        const url = pick(box, ['link']);
        const snippet = pick(box, ['snippet', 'answer']);
        if (url) hits.push({ title: pick(box, ['title']) || url, url, snippet });
      }
      hits.push(...toHits(pickPath(json, 'organic'), { title: ['title'], url: ['link'], snippet: ['snippet'] }));
      return hits;
    },
  },
  {
    id: 'brave',
    secretName: PROVIDER_SECRET.brave,
    requiresKey: true,
    // Brave 是 GET + query string，不是 JSON body。
    build: (query, maxResults, key) => ({
      url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      init: { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': key ?? '' } },
    }),
    parse: (json) => toHits(pickPath(json, 'web', 'results'), {
      title: ['title'], url: ['url'], snippet: ['description'],
    }),
  },
  {
    id: 'mojeek',
    secretName: PROVIDER_SECRET.mojeek,
    requiresKey: true,
    // GET + query string：密钥走 api_key 参数（不是 header），条数参数名是 t。
    build: (query, maxResults, key) => ({
      url: `https://api.mojeek.com/search?q=${encodeURIComponent(query)}&t=${maxResults}&fmt=json&api_key=${encodeURIComponent(key ?? '')}`,
      init: { method: 'GET', headers: { Accept: 'application/json' } },
    }),
    // 官方字段是 desc（不是 snippet）；双兜底 response.results[] / results[]。
    parse: (json) => toHits(
      pickPath(json, 'response', 'results') ?? pickPath(json, 'results'),
      { title: ['title'], url: ['url'], snippet: ['desc', 'snippet', 'content'] },
    ),
  },
  {
    id: 'youcom',
    secretName: PROVIDER_SECRET.youcom,
    requiresKey: true,
    // YDC API：X-API-Key 头（不是 YOUCOM_API_KEY），body 用 count，不是 max_results。
    build: (query, maxResults, key) => jsonPost('https://ydc-index.io/v1/search', { 'X-API-Key': key ?? '' }, {
      query, count: maxResults,
    }),
    parse: (json) => {
      // results 是对象不是数组：命中在 results.web[]；不能把顶层 results 当数组（asArray 对对象返回 []）。
      const hits: ProviderHit[] = [];
      for (const raw of asArray(pickPath(json, 'results', 'web'))) {
        if (!isObject(raw)) continue;
        const url = pick(raw, ['url']);
        if (!url) continue;
        // description 优先；snippets 是数组，取第一个非空字符串兜底。
        const description = pick(raw, ['description']);
        const snippets = asArray(raw.snippets).map(asString).filter(Boolean);
        hits.push({ title: pick(raw, ['title']) || url, url, snippet: description || snippets[0] || '' });
      }
      return hits;
    },
  },
  {
    id: 'linkup',
    secretName: PROVIDER_SECRET.linkup,
    requiresKey: true,
    // agentic 默认档：depth='fast'（约 1 秒）+ outputType='searchResults'，三个字段缺一不可。
    build: (query, maxResults, key) => jsonPost('https://api.linkup.so/v1/search', bearer(key ?? ''), {
      q: query, depth: 'fast', outputType: 'searchResults', maxResults,
    }),
    // 官方字段叫 name/content（不是 title/snippet）。
    parse: (json) => toHits(pickPath(json, 'results'), {
      title: ['name'], url: ['url'], snippet: ['content'],
    }),
  },
  {
    id: 'firecrawl',
    secretName: PROVIDER_SECRET.firecrawl,
    requiresKey: true,
    // v2 /search：body 用 limit；sources/categories 走默认，不强制传。
    build: (query, maxResults, key) => jsonPost('https://api.firecrawl.dev/v2/search', bearer(key ?? ''), {
      query, limit: maxResults,
    }),
    // data.* 嵌套坑：命中在 data.web[]，摘要字段是 description。
    parse: (json) => toHits(pickPath(json, 'data', 'web'), {
      title: ['title'], url: ['url'], snippet: ['description'],
    }),
  },
  {
    id: 'kimi',
    secretName: PROVIDER_SECRET.kimi,
    requiresKey: true,
    // Moonshot 工具搜索：查询字段叫 text_query（不是 query），附带 include_content。
    build: (query, maxResults, key) => jsonPost('https://api.moonshot.cn/v1/tools/search', bearer(key ?? ''), {
      text_query: query, limit: maxResults, include_content: true,
    }),
    parse: (json) => toHits(pickPath(json, 'search_results'), {
      title: ['title'], url: ['url'], snippet: ['snippet'],
    }),
  },
];

/** 单家结果：id、命中的条目、失败原因（成功时不带）。 */
interface ProviderRun {
  id: SearchProvider;
  hits: ProviderHit[];
  error?: string;
}

/** 调一家；任何异常都收成 error，不向上抛，避免一家失败拖垮整次搜索。 */
async function runProvider(
  adapter: ProviderAdapter,
  query: string,
  maxResults: number,
  key: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ProviderRun> {
  try {
    const { url, init } = adapter.build(query, maxResults, key);
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json: unknown = await response.json();
    return { id: adapter.id, hits: adapter.parse(json) };
  } catch (error) {
    return { id: adapter.id, hits: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** 记一条 warn；拿不到可用 logger 时返回 false，由调用方在回执里补一行。 */
function logWarn(ctx: ToolCallContext | undefined, message: string): boolean {
  const logger = ctx?.log;
  if (!logger || typeof logger.warn !== 'function') return false;
  try {
    logger.warn(message);
    return true;
  } catch {
    return false;
  }
}

export interface WebSearchWorldOptions {
  /** `worlds.web-search-multi` 活引用；每次搜索现读，改配置立即生效。 */
  cfg: WebSearchConfigSection;
  timezone: string;
  /** 按环境变量名取密钥；空串视为未配置。 */
  getApiKey: (name: string) => string | undefined;
  /** 部署目录，用于拼出密钥文件 .env 的准确路径；测试里可省略。 */
  botDir?: string;
}

/** 生成可操作的密钥配置指引：给出部署 .env 的准确路径、键名与格式。 */
function keySetupHint(botDir: string | undefined, names: string[]): string {
  const file = botDir ? `${botDir.replace(/[\\/]+$/, '')}/.env` : '部署目录的 .env 文件';
  const lines = names.map((name) => `${name}=你的密钥`).join('\n');
  return `请把以下行加入 ${file}（一行一个，等号后填密钥，值不能含空格）：\n${lines}\n保存后下一次调用即生效，无需重启；不要把密钥填进配置面板或发给 bot。`;
}

export class WebSearchWorld implements World {
  readonly id = WEB_SEARCH_ID;

  private host: WorldHost | null = null;

  constructor(private readonly opts: WebSearchWorldOptions) {}

  envPromptVars(): Record<string, string> {
    const envFile = this.opts.botDir ? `${this.opts.botDir.replace(/[\\/]+$/, '')}/.env` : '(未取到部署目录)';
    return { [ENV_FILE_VAR]: envFile };
  }

  tools(): ToolDef[] {
    const decl = WEB_SEARCH_TOOL_DECLS[0];
    return [{ ...decl, handler: this.searchHandler.bind(this) }];
  }

  webUi(): WorldWebUiDecl {
    return {
      label: WEB_SEARCH_ID,
      config: [WEB_SEARCH_CONFIG_GROUP],
      promptDocs: [
        {
          key: ENV_PROMPT_KEY,
          title: 'Web 搜索环境',
          description: '在哪些情况下调用 web_search_multi，如何引用搜索结果，不要滥用搜索。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: ENV_FILE_VAR, description: '密钥文件 .env 的准确路径，用于回答用户「密钥填哪里」。' },
          ],
        },
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    await host.pushEvent({
      type: `${WEB_SEARCH_ID}.started`,
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      ts: nowIso(this.opts.timezone),
      text: `${WEB_SEARCH_ID} 已就绪。`,
    });
  }

  async stop(): Promise<void> {
    this.host = null;
  }

  private async searchHandler(args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return { text: '缺少查询关键词。', failed: true };
    const maxResults = typeof args.max_results === 'number' && Number.isFinite(args.max_results)
      ? Math.min(10, Math.max(1, Math.floor(args.max_results)))
      : 5;

    const cfg = this.opts.cfg;
    const switches: ProviderSwitches = cfg.providers ?? WEB_SEARCH_DEFAULTS.providers;
    const keyOf = (name: string): string | undefined => {
      const value = this.opts.getApiKey(name);
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return trimmed || undefined;
    };

    // 显式指定单家：严格三分支，未知 id / 开关关闭 / 缺密钥都明确失败，禁止静默降级到全部。
    // 未指定：维持原行为——所有「开关打开 且（无需密钥或已配密钥）」的家并行。
    const requested = typeof args.provider === 'string' && args.provider.trim()
      ? args.provider.trim()
      : undefined;
    const usable: Array<{ adapter: ProviderAdapter; key: string | undefined }> = [];
    const missingKeys: string[] = [];

    if (requested !== undefined) {
      const adapter = PROVIDER_ADAPTERS.find((a) => a.id === requested);
      if (!adapter) {
        return {
          text: `未知的 provider "${requested}"。可用 id：${SEARCH_PROVIDER_IDS.join(', ')}。`,
          failed: true,
        };
      }
      if (switches[adapter.id] === false) {
        return {
          text: `provider "${adapter.id}" 已在配置面板中关闭，无法单独调用；请在面板打开它，或不指定 provider 以使用其他已开启的引擎。`,
          failed: true,
        };
      }
      const key = keyOf(adapter.secretName);
      if (adapter.requiresKey && !key) {
        return {
          text: `provider "${adapter.id}" 缺少密钥 ${adapter.secretName}，无法单独调用。\n${keySetupHint(this.opts.botDir, [adapter.secretName])}`,
          failed: true,
        };
      }
      usable.push({ adapter, key });
    } else {
      for (const adapter of PROVIDER_ADAPTERS) {
        if (switches[adapter.id] === false) continue;
        const key = keyOf(adapter.secretName);
        if (adapter.requiresKey && !key) {
          missingKeys.push(adapter.secretName);
          continue;
        }
        usable.push({ adapter, key });
      }
    }
    if (!usable.length) {
      return {
        text: `没有可用的搜索提供商：请先在配置面板打开至少一家开关，再配置密钥。\n${keySetupHint(this.opts.botDir, missingKeys.length ? missingKeys : ['ANYSEARCH_API_KEY'])}\n注：anysearch 可不填密钥匿名使用（限速更低）。`,
        failed: true,
      };
    }

    const runs = await Promise.all(
      usable.map(({ adapter, key }) =>
        runProvider(adapter, query, maxResults, key, ctx?.signal)),
    );
    const failed = runs.filter((run) => run.error !== undefined);
    const logged = failed.length
      ? logWarn(ctx, `${WEB_SEARCH_ID}: ${failed.length} 家提供商调用失败：${failed.map((run) => `${run.id}（${run.error}）`).join('；')}`)
      : false;

    const seen = new Set<string>();
    const merged: Array<ProviderHit & { provider: SearchProvider }> = [];
    for (const run of runs) {
      for (const hit of run.hits) {
        const dedupeKey = hit.url.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        merged.push({ ...hit, provider: run.id });
      }
    }
    const results = merged.slice(0, maxResults);

    if (!results.length) {
      const tail = failed.length ? `\n（${failed.length} 家提供商调用失败：${failed.map((run) => run.id).join(', ')}）` : '';
      return { text: `未找到结果。${tail}` };
    }
    const lines = results
      .map((hit, index) => [`${index + 1}. [${hit.provider}] ${hit.title}`, hit.url, hit.snippet].filter(Boolean).join('\n'))
      .join('\n\n');
    const tail = failed.length && !logged ? `\n\n（${failed.length} 家提供商调用失败：${failed.map((run) => run.id).join(', ')}）` : '';
    return { text: `${lines}${tail}` };
  }
}
