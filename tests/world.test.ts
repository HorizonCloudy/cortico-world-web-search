import { describe, expect, it, vi } from 'vitest';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { WebSearch } from '../src/definition.ts';
import { WEB_SEARCH_DEFAULTS, type WebSearchConfigSection } from '../src/config.ts';

const ctx = fakeWorldContext(WebSearch, { scratchDir: 'scratch' });
Object.assign(ctx.cfg, { enabled: true });
(ctx.cfg as WebSearchConfigSection).maxResults = 5;

describe('web-search world', () => {
  it('passes the dry mount without failures', async () => {
    const report = await dryMountWorld(WebSearch as never, { scratchDir: 'scratch', packageDir: './' });
    expect(report.failures).toEqual([]);
  });

  it('pushes web-search.started with origin internal on start', async () => {
    const events: Array<{ type: string; origin?: string; senderKey?: string; text?: string }> = [];
    const host = { pushEvent: async (e: { type: string; origin?: string; senderKey?: string; text?: string }) => { events.push(e); return {}; } };
    const world = WebSearch.create(ctx as never);
    await world.start(host as never);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: 'web-search.started', origin: 'internal', senderKey: 'web-search', text: 'web-search 已就绪。' });
    await world.stop();
  });

  it('exposes a callable web_search tool and returns normalized results', async () => {
    (ctx as { secret: (name: string) => string }).secret = () => 'fake-key';
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: 'Coopanion', url: 'https://example.test/coopanion', snippet: 'A desktop companion.' }] }),
    }) as unknown as Response));
    const world = WebSearch.create(ctx as never);
    const tool = world.tools().find((t) => t.name === 'web_search');
    expect(tool).toBeDefined();
    const got = (await tool!.handler!({ query: 'Coopanion', max_results: 3 } as never, {} as never)) as { failed?: boolean; text?: string };
    expect(got.failed).toBeUndefined();
    expect(typeof got.text).toBe('string');
    expect(got.text).toContain('Coopanion');
    expect(got.text).toContain('https://example.test/coopanion');
    vi.unstubAllGlobals();
  });

  it('endpoint config change takes effect immediately', async () => {
    const world = WebSearch.create(ctx as never);
    expect((ctx.cfg as WebSearchConfigSection).endpoint).toBeUndefined();
    ctx.persist({ endpoint: 'https://example.test/search' });
    expect((ctx.cfg as WebSearchConfigSection).endpoint).toBe('https://example.test/search');
    const vars = (await world.envPromptVars()) ?? {};
    expect(vars['web-search.endpoint']).toBe('https://example.test/search');
  });
});
