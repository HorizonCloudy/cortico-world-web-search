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
import { mkdtempSync, rmSync } from 'node:fs';
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
