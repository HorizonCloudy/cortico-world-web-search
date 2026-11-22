/**
 * web-search World 的纯函数级测试：stub 全局 fetch，不联网、不启宿主。
 *
 * 本文件锁住两条阻断契约：
 * - B1（工具名冲突）：工具名不能是 `web_search`，必须是 `web_search_multi`。
 *   Cortico 内建 world `websearch` 的工具名逐字就是 `web_search`，`check:extension` 会把内建
 *   工具名当 takenToolNames 传进干装载，同名即 failure。
 * - B3（默认端点静默失败）：`endpoint: ''` 不是 nullish，`?? 默认` 兜底不生效，`fetch('')`
 *   抛错被 catch 吞掉，默认配置下 anysearch 这条永远静默返回空结果。默认值必须是 undefined
 *   （或兜底改用 `||`），请求必须打到 https://api.anysearch.com/v1/search。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { renderTemplate } from 'cortico/core/template.ts';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { WebSearch } from '../src/definition.ts';
import { PROVIDER_ADAPTERS, WEB_SEARCH_TOOL_DECLS } from '../src/world.ts';
import { PROVIDER_SECRET, SEARCH_PROVIDER_IDS, WEB_SEARCH_CONFIG_GROUP, WEB_SEARCH_DEFAULTS } from '../src/config.ts';
import type { SearchProvider } from '../src/config.ts';
import type { WebSearchConfigSection } from '../src/config.ts';

const packageDir = fileURLToPath(new URL('../', import.meta.url));

/** 内建 world `websearch` 已占用的工具名；干装载把它当 takenToolNames，撞名即 failure。 */
const BUILTIN_WEBSEARCH_TOOL_NAMES = ['web_search'];

const TOOL_CTX = { role: 'test', log: {} } as unknown as ToolCallContext;

const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-search-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (scratchDirs.length) {
    rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
  }
});

/** 每个测试一份独立 ctx，避免 secret / endpoint 在测试之间串味。 */
function newCtx(opts: { secret?: (name: string) => string } = {}) {
  const ctx = fakeWorldContext(WebSearch, { scratchDir: scratchDir(), packageDir });
  Object.assign(ctx.cfg, { enabled: true });
  (ctx.cfg as WebSearchConfigSection).maxResults = 5;
  if (opts.secret) ctx.secret = opts.secret;
  return ctx;
}

/** 捕获 fetch 的 URL 与 init，回一个固定的成功响应。 */
function stubFetch(payload: unknown = { results: [] }) {
  const calls: Array<{ input: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), body: init?.body });
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as unknown as Response;
  }));
  return calls;
}

/** 按 id 取 adapter；找不到就抛，避免拼写错误静默漏测。 */
function adapterOf(id: SearchProvider) {
  const adapter = PROVIDER_ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new Error(`missing adapter: ${id}`);
  return adapter;
}

/** RequestInit.headers 可能是 Headers / 数组 / 普通对象；统一取知名。 */
function headerOf(init: RequestInit, name: string): string {
  const h = init.headers as Record<string, string> | undefined;
  if (h && typeof h === 'object' && !Array.isArray(h) && !(h instanceof Headers)) {
    const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? h[key] : '';
  }
  const headers = new Headers(init.headers);
  return headers.get(name) ?? '';
}

/** 把捕获到的 fetch URL 反查成 provider id（按 origin+pathname，GET 的 query 不影响）。 */
function calledProviderIds(calls: Array<{ input: string }>): SearchProvider[] {
  const ids: SearchProvider[] = [];
  for (const call of calls) {
    let u: URL;
    try { u = new URL(call.input); } catch { continue; }
    const base = `${u.origin}${u.pathname}`;
    const adapter = PROVIDER_ADAPTERS.find((a) => {
      const { url } = a.build('probe', 1, 'k');
      const au = new URL(url);
      return `${au.origin}${au.pathname}` === base;
    });
    if (adapter && !ids.includes(adapter.id)) ids.push(adapter.id);
  }
  return ids;
}

describe('new provider adapters (build shape + official-shape parse fixtures)', () => {
  // ---- mojeek ----
  it('mojeek build(): GET, api_key in query string, count param is t', () => {
    const { url, init } = adapterOf('mojeek').build('hello world', 7, 'mk-key');
    expect(init.method).toBe('GET');
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe('https://api.mojeek.com/search');
    expect(u.searchParams.get('q')).toBe('hello world');
    expect(u.searchParams.get('t')).toBe('7');
    expect(u.searchParams.get('fmt')).toBe('json');
    expect(u.searchParams.get('api_key')).toBe('mk-key');
    expect(headerOf(init, 'Authorization')).toBe('');
  });

  it('mojeek parse(): response.results[] with desc field (official shape)', () => {
    // 来源: https://www2.mojeek.com/support/api/search/json_response.html (response.results[]/title/url/desc) — 抓取 2026-11-20 [未核验]
    const json = { response: { results: [{ title: 'Mojeek Hit', url: 'https://m.test/a', desc: 'Mojeek desc' }] } };
    const hits = adapterOf('mojeek').parse(json);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ title: 'Mojeek Hit', url: 'https://m.test/a', snippet: 'Mojeek desc' });
  });

  // ---- youcom ----
  it('youcom build(): POST, X-API-Key header, body uses count', () => {
    const { url, init } = adapterOf('youcom').build('hello', 6, 'ydc-key');
    expect(init.method).toBe('POST');
    expect(url).toBe('https://ydc-index.io/v1/search');
    expect(headerOf(init, 'X-API-Key')).toBe('ydc-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ query: 'hello', count: 6 });
    expect(body).not.toHaveProperty('max_results');
  });

  it('youcom parse(): results.web[] object, description then snippets[0] (official shape)', () => {
    // 来源: https://you.com/docs/search/overview (POST /v1/search, X-API-Key, results.web[], description/snippets[]) — 抓取 2026-11-20 [未核验]
    const json = { results: { web: [
      { title: 'You Hit', url: 'https://y.test/a', description: 'Web description' },
      { title: 'You Hit 2', url: 'https://y.test/b', snippets: ['snippet fallback'] },
    ] } };
    const hits = adapterOf('youcom').parse(json);
    expect(hits.length).toBe(2);
    expect(hits[0]).toMatchObject({ title: 'You Hit', url: 'https://y.test/a', snippet: 'Web description' });
    expect(hits[1]).toMatchObject({ title: 'You Hit 2', url: 'https://y.test/b', snippet: 'snippet fallback' });
  });

  // ---- linkup ----
  it('linkup build(): POST Bearer, body q + depth fast + outputType + maxResults', () => {
    const { url, init } = adapterOf('linkup').build('hello', 5, 'lk-key');
    expect(init.method).toBe('POST');
    expect(url).toBe('https://api.linkup.so/v1/search');
    expect(headerOf(init, 'Authorization')).toBe('Bearer lk-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ q: 'hello', depth: 'fast', outputType: 'searchResults', maxResults: 5 });
  });

  it('linkup parse(): results[] with name/content fields (official shape)', () => {
    // 来源: https://docs.linkup.so/pages/documentation/endpoints/search/reference (results[]/name/url/content) — 抓取 2026-11-20 [未核验]
    const json = { results: [{ name: 'Linkup Hit', url: 'https://l.test/a', content: 'Linkup content' }] };
    const hits = adapterOf('linkup').parse(json);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ title: 'Linkup Hit', url: 'https://l.test/a', snippet: 'Linkup content' });
  });

  // ---- firecrawl ----
  it('firecrawl build(): POST Bearer, body uses limit', () => {
    const { url, init } = adapterOf('firecrawl').build('hello', 4, 'fc-key');
    expect(init.method).toBe('POST');
    expect(url).toBe('https://api.firecrawl.dev/v2/search');
    expect(headerOf(init, 'Authorization')).toBe('Bearer fc-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ query: 'hello', limit: 4 });
    expect(body).not.toHaveProperty('maxResults');
  });

  it('firecrawl parse(): data.web[] with description (official shape)', () => {
    // 来源: https://docs.firecrawl.dev/api-reference/endpoint/search — 抓取 2026-11-20 [未核验]
    const json = { data: { web: [{ title: 'Firecrawl Hit', url: 'https://f.test/a', description: 'Firecrawl desc' }] } };
    const hits = adapterOf('firecrawl').parse(json);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ title: 'Firecrawl Hit', url: 'https://f.test/a', snippet: 'Firecrawl desc' });
  });

  // ---- kimi ----
  it('kimi build(): POST Bearer, body uses text_query not query, include_content', () => {
    const { url, init } = adapterOf('kimi').build('hello', 3, 'ms-key');
    expect(init.method).toBe('POST');
    expect(url).toBe('https://api.moonshot.cn/v1/tools/search');
    expect(headerOf(init, 'Authorization')).toBe('Bearer ms-key');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ text_query: 'hello', limit: 3, include_content: true });
    expect(body).not.toHaveProperty('query');
  });

  it('kimi parse(): search_results[] with snippet (official shape)', () => {
    // 来源: https://platform.kimi.com/docs/api/tools-search (search_results[]/title/url/snippet/text) — 抓取 2026-11-20 [未核验]
    const json = { search_results: [{ title: 'Kimi Hit', url: 'https://k.test/a', snippet: 'Kimi snippet' }] };
    const hits = adapterOf('kimi').parse(json);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ title: 'Kimi Hit', url: 'https://k.test/a', snippet: 'Kimi snippet' });
  });
});

describe('web-search world', () => {
  it('passes the dry mount without failures', async () => {
    const report = await dryMountWorld(WebSearch, { scratchDir: scratchDir(), packageDir });
    expect(report.failures).toEqual([]);
  });

  it('pushes web-search-multi.started with origin internal on start', async () => {
    const events: Array<{ type: string; origin?: string; senderKey?: string; text?: string }> = [];
    const host = { pushEvent: async (e: { type: string; origin?: string; senderKey?: string; text?: string }) => { events.push(e); return {}; } };
    const world = WebSearch.create(newCtx());
    await world.start(host as never);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: 'web-search-multi.started', origin: 'internal', senderKey: 'web-search-multi', text: 'web-search-multi 已就绪。' });
    await world.stop();
  });

  it('exposes a callable web_search_multi tool and returns normalized results', async () => {
    stubFetch({ results: [{ title: 'Coopanion', url: 'https://example.test/coopanion', snippet: 'A desktop companion.' }] });
    const world = WebSearch.create(newCtx({ secret: () => 'fake-key' }));
    const tool = world.tools().find((t) => t.name === 'web_search_multi');
    expect(tool).toBeDefined();
    const got = (await tool!.handler({ query: 'Coopanion', max_results: 3 }, TOOL_CTX)) as { failed?: boolean; text?: string };
    expect(got.failed).toBeUndefined();
    expect(typeof got.text).toBe('string');
    expect(got.text).toContain('Coopanion');
    expect(got.text).toContain('https://example.test/coopanion');
  });

  // B1：工具名集合与 Cortico 内建 world 的工具名无交集。内建 world `websearch` 注册了 `web_search`。
  it('B1: tool names do not collide with the built-in websearch world', () => {
    const names = WebSearch.create(newCtx()).tools().map((t) => t.name);
    for (const taken of BUILTIN_WEBSEARCH_TOOL_NAMES) {
      expect(names).not.toContain(taken);
    }
    // 契约裁决的替换名，逐字锁定。
    expect(names).toContain('web_search_multi');
  });

  // B3：默认配置下 fetch 收到的不能是空字符串，必须是官方 anysearch 端点。
  // 这里只锁行为（URL）；默认值本身是 undefined 还是 '' 由下一条 'endpoint config change' 锁定。
  it('B3: the default config still fetches the official anysearch endpoint', async () => {
    const ctx = newCtx({ secret: (name) => (name === 'ANYSEARCH_API_KEY' ? 'fake-key' : '') });
    const calls = stubFetch({ results: [{ title: 'Coopanion', url: 'https://example.test/coopanion', snippet: 'S' }] });
    const world = WebSearch.create(ctx);
    const out = (await world.tools()[0].handler({ query: 'Coopanion' }, TOOL_CTX)) as { failed?: boolean; text: string };

    expect(calls).toHaveLength(1);
    expect(calls[0].input).not.toBe('');
    expect(calls[0].input.startsWith('https://api.anysearch.com')).toBe(true);
    expect(calls[0].input).toBe('https://api.anysearch.com/v1/search');
    expect(out.failed).toBeUndefined();
  });

});

describe('provider param selection (default all / specified one / explicit errors)', () => {
  /** 给所有提供商都配上假 key，让「可用」集合等于全 14 家。 */
  function allKeysCtx() {
    return newCtx({ secret: () => 'fake-key' });
  }

  it('no provider: calls all enabled+keyed providers in parallel', async () => {
    const calls = stubFetch({ results: [] });
    const world = WebSearch.create(allKeysCtx());
    await world.tools()[0].handler({ query: 'hello' }, TOOL_CTX);
    const ids = calledProviderIds(calls);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids).toEqual(expect.arrayContaining(['anysearch', 'tavily', 'kimi', 'mojeek']));
    expect(calls).toHaveLength(PROVIDER_ADAPTERS.length);
  });

  it('specified available provider: calls only that one', async () => {
    const calls = stubFetch({ results: [] });
    const world = WebSearch.create(allKeysCtx());
    const out = (await world.tools()[0].handler({ query: 'hello', provider: 'kimi' }, TOOL_CTX)) as { failed?: boolean };
    expect(out.failed).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calledProviderIds(calls)).toEqual(['kimi']);
  });

  it('unknown provider id: failed:true with available list, no fetch', async () => {
    const calls = stubFetch({ results: [] });
    const world = WebSearch.create(allKeysCtx());
    const out = (await world.tools()[0].handler({ query: 'hello', provider: 'no-such-engine' }, TOOL_CTX)) as { failed?: boolean; text: string };
    expect(out.failed).toBe(true);
    expect(out.text).toContain('no-such-engine');
    expect(out.text).toContain('可用 id');
    for (const id of ['anysearch', 'kimi', 'firecrawl']) expect(out.text).toContain(id);
    expect(calls).toHaveLength(0);
  });

  it('provider switched off in config: explicit error, no silent fallback', async () => {
    const calls = stubFetch({ results: [] });
    const ctx = allKeysCtx();
    (ctx.cfg as WebSearchConfigSection).providers.kimi = false;
    const world = WebSearch.create(ctx);
    const out = (await world.tools()[0].handler({ query: 'hello', provider: 'kimi' }, TOOL_CTX)) as { failed?: boolean; text: string };
    expect(out.failed).toBe(true);
    expect(out.text).toContain('kimi');
    expect(out.text).toContain('关闭');
    expect(calls).toHaveLength(0);
  });

  it('provider missing key: explicit error, no silent fallback', async () => {
    const calls = stubFetch({ results: [] });
    // 只给 kimi / mojeek 之外的家配 key：tavily 无 key。
    const ctx = newCtx({ secret: (name) => (name === 'TAVILY_API_KEY' ? '' : 'fake-key') });
    const world = WebSearch.create(ctx);
    const out = (await world.tools()[0].handler({ query: 'hello', provider: 'tavily' }, TOOL_CTX)) as { failed?: boolean; text: string };
    expect(out.failed).toBe(true);
    expect(out.text).toContain('tavily');
    expect(out.text).toContain('TAVILY_API_KEY');
    expect(calls).toHaveLength(0);
  });

  it('enum is derived from one source: enum === adapter ids === PROVIDER_SECRET keys', () => {
    const properties = (WEB_SEARCH_TOOL_DECLS[0].parameters as unknown as { properties: Record<string, { enum: string[] }> }).properties;
    const enumIds = [...properties.provider.enum].sort();
    const adapterIds = PROVIDER_ADAPTERS.map((a) => a.id).sort();
    const secretIds = Object.keys(PROVIDER_SECRET).sort();
    expect(enumIds).toEqual(adapterIds);
    expect(enumIds).toEqual(secretIds);
    expect(enumIds).toEqual([...SEARCH_PROVIDER_IDS].sort());
  });
});

describe('requirement A regression (endpoint override fully removed)', () => {
  it('config panel properties no longer contain worlds.web-search-multi.endpoint', () => {
    const props = WEB_SEARCH_CONFIG_GROUP.schema.properties as Record<string, unknown>;
    expect(Object.keys(props).some((k) => k.endsWith('.endpoint'))).toBe(false);
    expect(props['worlds.web-search-multi.endpoint']).toBeUndefined();
  });

  it('defaults() carries no endpoint key', () => {
    expect(Object.prototype.hasOwnProperty.call(WEB_SEARCH_DEFAULTS, 'endpoint')).toBe(false);
  });

  it('envPromptVars() no longer returns an endpoint variable', async () => {
    const vars = (await WebSearch.create(newCtx()).envPromptVars()) ?? {};
    expect(Object.keys(vars).some((k) => k.includes('endpoint'))).toBe(false);
    expect(vars['web_search_multi.envFile']).toBeDefined();
  });

  it('webUi promptDocs.vars no longer declares endpoint', () => {
    const vars = WebSearch.create(newCtx()).webUi?.().promptDocs?.[0]?.vars ?? [];
    expect(vars.some((v) => v.name.includes('endpoint'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 环境提示词三变量化 + 搜索模式（implementation-brief §E：T1–T16）
//
// 全组只做纯函数级验证：读模板原文、调 envPromptVars()、stub fetch。
// 不联网、不启宿主、不 mock fs、不 monkeypatch 生产模块内部函数。
// 断言一律用 implementation-brief §C 的稳定子串（T16 例外：那条要逐字相等）。
// 尚未存在的模块（src/prompt-vars.ts）用动态 import，避免整文件收集失败把已有 25 条拖红。
// ---------------------------------------------------------------------------

/** §C 锁定的四个变量名（逐字）；连字符不合法，故 world id 的 `-` 写成 `_`。 */
const VAR_AVAILABLE = 'web_search_multi.availableProviders';
const VAR_PLAN = 'web_search_multi.searchPlan';
const VAR_MODE = 'web_search_multi.searchMode';
const VAR_ENV_FILE = 'web_search_multi.envFile';

/** 读 `src/ENV_PROMPT.md` 原文（T1 / T2 / T16 共用）。 */
function envPromptText(): string {
  return readFileSync(join(packageDir, 'src', 'ENV_PROMPT.md'), 'utf8');
}

/** 调一次 envPromptVars()；缺键以 '' 参与断言，失败信息更直白（不是 TypeError）。 */
async function envVarsOf(ctx = newCtx()): Promise<Record<string, string>> {
  const vars = (await WebSearch.create(ctx).envPromptVars()) ?? {};
  return vars as Record<string, string>;
}

/** 14 家全配假密钥的 ctx：可用集合 = 全部 14 家。 */
function everyProviderKeyed() {
  return newCtx({ secret: () => 'fake-key' });
}

/** 把配置面板上 14 家开关全部关掉（anysearch 也关，才能到 N=0）。 */
function switchOffAll(ctx: ReturnType<typeof newCtx>) {
  const cfg = ctx.cfg as WebSearchConfigSection;
  for (const id of SEARCH_PROVIDER_IDS) cfg.providers[id] = false;
  return ctx;
}

/** 改 searchMode；用 string 形参，好覆盖非法值 'bogus'。 */
function setSearchMode(ctx: ReturnType<typeof newCtx>, mode: string) {
  (ctx.cfg as unknown as { searchMode: string }).searchMode = mode;
  return ctx;
}

describe('env prompt vars（T1–T8）', () => {
  it('T1: 模板显式引用三个新变量，envFile 仍保留', () => {
    const md = envPromptText();
    expect(md).toContain(`{{${VAR_AVAILABLE}}}`);
    expect(md).toContain(`{{${VAR_PLAN}}}`);
    expect(md).toContain(`{{${VAR_MODE}}}`);
    expect(md).toContain(`{{${VAR_ENV_FILE}}}`);
  });

  it('T2: 用平台 renderTemplate 真渲染后无残留 {{，且四个变量值都落进正文', async () => {
    const vars = await envVarsOf(everyProviderKeyed());
    const rendered = renderTemplate(envPromptText(), vars);
    expect(rendered).not.toContain('{{');
    for (const key of [VAR_ENV_FILE, VAR_AVAILABLE, VAR_PLAN, VAR_MODE]) {
      const value = vars[key];
      expect(typeof value, `${key} 未返回字符串`).toBe('string');
      expect(value.trim().length, `${key} 为空串`).toBeGreaterThan(0);
      expect(rendered).toContain(value);
    }
  });

  it('T3: envPromptVars() 恰好四个键，值均非空（防占位符原样泄漏）', async () => {
    const vars = await envVarsOf(everyProviderKeyed());
    expect(Object.keys(vars).sort()).toEqual([VAR_AVAILABLE, VAR_ENV_FILE, VAR_MODE, VAR_PLAN].sort());
    for (const [key, value] of Object.entries(vars)) {
      expect(typeof value, `${key} 应返回字符串`).toBe('string');
      expect(value.trim().length, `${key} 不能为空串`).toBeGreaterThan(0);
    }
  });

  it('T3b (契约 B1): PROMPT_VARS_FALLBACK 三键非空、键名与变量名逐字一致', async () => {
    // §A B1 的落地写法是 `{ [ENV_FILE_VAR]: envFile, ...PROMPT_VARS_FALLBACK }`，
    // 展开进同一个对象 ⇒ 键必须是带 web_search_multi. 前缀的完整变量名。
    const mod = (await import('../src/prompt-vars.ts')) as unknown as Record<string, unknown>;
    const fallback = mod.PROMPT_VARS_FALLBACK as Record<string, string> | undefined;
    expect(fallback, 'src/prompt-vars.ts 应导出 PROMPT_VARS_FALLBACK').toBeDefined();
    expect(Object.keys(fallback!).sort()).toEqual([VAR_AVAILABLE, VAR_MODE, VAR_PLAN].sort());
    for (const [key, value] of Object.entries(fallback!)) {
      expect(typeof value, `${key} 应返回字符串`).toBe('string');
      expect(value.trim().length, `${key} 不能为空串`).toBeGreaterThan(0);
    }
    expect(fallback![VAR_MODE]).toBe('多引擎优先（multi）');
  });

  it('T4: 默认配置（无任何密钥）只列 anysearch', async () => {
    const vars = await envVarsOf();
    const available = vars[VAR_AVAILABLE] ?? '';
    expect(available).toContain('共 1 家可调用');
    expect(available).toContain('- anysearch（匿名可用）');
    expect(available).not.toContain('- tavily');
  });

  it('T5: 可用范围随开关与密钥变化（14 家 → 关 kimi + 去 TAVILY 密钥）', async () => {
    const allKeys = await envVarsOf(everyProviderKeyed());
    expect(allKeys[VAR_AVAILABLE] ?? '').toContain('共 14 家可调用');

    const narrowed = newCtx({ secret: (name) => (name === 'TAVILY_API_KEY' ? '' : 'fake-key') });
    (narrowed.cfg as WebSearchConfigSection).providers.kimi = false;
    const available = (await envVarsOf(narrowed))[VAR_AVAILABLE] ?? '';
    expect(available).not.toContain('- kimi');
    expect(available).not.toContain('- tavily');
    expect(available).toContain('- bocha（已配密钥）');
    expect(available).toContain('共 12 家可调用');
  });

  it('T6: 零可用引擎时两段都给可操作兜底文案', async () => {
    const vars = await envVarsOf(switchOffAll(everyProviderKeyed()));
    expect(vars[VAR_AVAILABLE] ?? '').toContain('当前没有可调用引擎');
    expect(vars[VAR_PLAN] ?? '').toContain('任何调用都会直接报错');
  });

  it('T7: 模式渲染（默认 multi / single / 非法值回落 multi）', async () => {
    expect((await envVarsOf())[VAR_MODE] ?? '').toContain('多引擎优先（multi）');
    expect((await envVarsOf(setSearchMode(everyProviderKeyed(), 'single')))[VAR_MODE] ?? '').toBe('单引擎优先（single）');
    // 旧配置文件可能写入未知值：兼容口径是回落 multi，不是报错。
    expect((await envVarsOf(setSearchMode(everyProviderKeyed(), 'bogus')))[VAR_MODE] ?? '').toContain('多引擎优先（multi）');
  });

  it('T8: 两模式 searchPlan 文案差异（并发去重 vs 串行不换家）', async () => {
    const multi = (await envVarsOf(everyProviderKeyed()))[VAR_PLAN] ?? '';
    expect(multi).toContain('并发，无先后');
    expect(multi).toContain('按 url 去重');

    const single = (await envVarsOf(setSearchMode(everyProviderKeyed(), 'single')))[VAR_PLAN] ?? '';
    expect(single).toContain('串行，只调用一家');
    expect(single).toContain('当前选中 bocha');
    expect(single).toContain('不自动换家');
  });
});

describe('搜索模式运行时行为（T9–T13）', () => {
  it('T9: 默认 multi 不变——不传 provider、不传 max_results 时 14 家各发一次且默认 5 条', async () => {
    const calls = stubFetch({ results: [] });
    const world = WebSearch.create(everyProviderKeyed());
    await world.tools()[0].handler({ query: 'probe' }, TOOL_CTX);
    expect(calls).toHaveLength(SEARCH_PROVIDER_IDS.length);
    expect(calledProviderIds(calls).sort()).toEqual([...SEARCH_PROVIDER_IDS].sort());
    // anysearch 是 adapter 表首家：请求体里的条数就是默认 maxResults=5。
    const first = JSON.parse(String(calls[0].body)) as Record<string, unknown>;
    expect(first.max_results).toBe(5);
  });

  it('T10: single 只发一次，且选中 SINGLE_MODE_PRIORITY 第一家 bocha', async () => {
    const calls = stubFetch({ results: [] });
    const world = WebSearch.create(setSearchMode(everyProviderKeyed(), 'single'));
    await world.tools()[0].handler({ query: 'probe' }, TOOL_CTX);
    expect(calls).toHaveLength(1);
    expect(calledProviderIds(calls)).toEqual(['bocha']);
  });

  it('T11: single 下关掉 bocha 顺延到第二家 tavily，仍只发一次', async () => {
    const calls = stubFetch({ results: [] });
    const ctx = setSearchMode(everyProviderKeyed(), 'single');
    (ctx.cfg as WebSearchConfigSection).providers.bocha = false;
    const world = WebSearch.create(ctx);
    await world.tools()[0].handler({ query: 'probe' }, TOOL_CTX);
    expect(calls).toHaveLength(1);
    expect(calledProviderIds(calls)).toEqual(['tavily']);
  });

  it('T12: single 下无可用引擎 → 明确报错、零请求；single 不自动换家', async () => {
    const calls = stubFetch({ results: [] });
    const world = WebSearch.create(setSearchMode(switchOffAll(everyProviderKeyed()), 'single'));
    const out = (await world.tools()[0].handler({ query: 'probe' }, TOOL_CTX)) as { failed?: boolean; text: string };
    expect(out.failed).toBe(true);
    expect(out.text).toContain('没有可用的搜索提供商');
    expect(calls).toHaveLength(0);
  });

  it('T13: 显式 provider 压过 single 模式，只调指定的 kimi', async () => {
    const calls = stubFetch({ results: [] });
    const world = WebSearch.create(setSearchMode(everyProviderKeyed(), 'single'));
    await world.tools()[0].handler({ query: 'probe', provider: 'kimi' }, TOOL_CTX);
    expect(calls).toHaveLength(1);
    expect(calledProviderIds(calls)).toEqual(['kimi']);
  });
});

describe('搜索模式配置面与自描述（T14–T16）', () => {
  it('T14: SINGLE_MODE_PRIORITY 与 SEARCH_PROVIDER_IDS 互为全排列，首 bocha 末 anysearch', async () => {
    const mod = (await import('../src/prompt-vars.ts')) as unknown as Record<string, unknown>;
    const priority = mod.SINGLE_MODE_PRIORITY as readonly string[] | undefined;
    expect(Array.isArray(priority), 'src/prompt-vars.ts 应导出 SINGLE_MODE_PRIORITY 数组').toBe(true);
    expect(priority).toHaveLength(SEARCH_PROVIDER_IDS.length);
    expect(new Set(priority!).size, 'SINGLE_MODE_PRIORITY 有重复项').toBe(SEARCH_PROVIDER_IDS.length);
    expect([...priority!].sort()).toEqual([...SEARCH_PROVIDER_IDS].sort());
    expect(priority![0]).toBe('bocha');
    expect(priority![priority!.length - 1]).toBe('anysearch');
  });

  it('T15: 默认 multi、面板有 searchMode 枚举项、PROVIDER_NOTE 覆盖 14 家', async () => {
    expect(WEB_SEARCH_DEFAULTS.searchMode).toBe('multi');

    const props = WEB_SEARCH_CONFIG_GROUP.schema.properties as unknown as Record<
      string,
      { type?: string; enum?: string[] }
    >;
    const modeProp = props['worlds.web-search-multi.searchMode'];
    expect(modeProp, '面板缺少 worlds.web-search-multi.searchMode').toBeDefined();
    expect(modeProp.type).toBe('string');
    expect(modeProp.enum).toEqual(['multi', 'single']);

    const config = (await import('../src/config.ts')) as unknown as Record<string, unknown>;
    const note = config.PROVIDER_NOTE as Record<string, string> | undefined;
    expect(note, 'src/config.ts 应导出 PROVIDER_NOTE').toBeDefined();
    expect(Object.keys(note!).sort()).toEqual([...SEARCH_PROVIDER_IDS].sort());
    for (const id of SEARCH_PROVIDER_IDS) {
      expect(typeof note![id], `PROVIDER_NOTE 缺 ${id} 的定位短句`).toBe('string');
      expect(note![id].trim().length, `PROVIDER_NOTE.${id} 为空串`).toBeGreaterThan(0);
    }
    // §C2 定位短句：anysearch 写「限速较低，配密钥后额度更大」——状态段已写「匿名可用」，同句不许重复。
    expect(note!.anysearch).toContain('限速较低，配密钥后额度更大');
    expect(note!.bocha).toContain('中文覆盖广、延迟低');
  });

  it('T16: describe.json 的 prompts[0].content 与 ENV_PROMPT.md 逐字相等（B3 不漂移）', () => {
    const md = envPromptText();
    // 契约 B3：模板必须以 LF 落盘（`.gitattributes` 钉 eol=lf），否则 autocrlf 机器上内嵌模板与文件恒不一致。
    expect(md.includes('\r')).toBe(false);
    const describeJson = JSON.parse(readFileSync(join(packageDir, 'describe.json'), 'utf8')) as {
      prompts: Array<{ content: string }>;
    };
    expect(describeJson.prompts).toHaveLength(1);
    expect(describeJson.prompts[0].content).toBe(md);
  });
});

