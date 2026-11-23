/**
 * 每家引擎状态检查点的测试，分两层。
 * 第一层直接测 `ProviderLedger` 与 `summarize`，纯函数，不建 World。
 * 第二层测 `webUi()` 暴露的 lamps 与 badges，并确认新字段不影响干装载。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { MODULE_LAMP_MAX } from 'cortico/core/types.ts';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { WebSearch } from '../src/definition.ts';
import { SEARCH_PROVIDER_IDS, WEB_SEARCH_DEFAULTS } from '../src/config.ts';
import type { WebSearchConfigSection } from '../src/config.ts';
import { ProviderLedger, blockedIds, failedIds, summarize } from '../src/status.ts';
import type { CheckState } from '../src/status.ts';
import { SINGLE_MODE_PRIORITY } from '../src/prompt-vars.ts';

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const TOOL_CTX = { role: 'test', log: {} } as unknown as ToolCallContext;
const NO_KEY = () => '';
const ALL_KEYS = () => 'fake-key';

const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-search-status-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (scratchDirs.length) {
    rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
  }
});

/** 取一家的状态；缺行直接失败，避免拼错 id 时静默通过。 */
function stateOf(ledger: ProviderLedger, cfg: Partial<WebSearchConfigSection>, keyOf: (n: string) => string | undefined, id: string): CheckState {
  const row = ledger.checkpoints(cfg, keyOf).find((r) => r.id === id);
  if (!row) throw new Error(`missing checkpoint: ${id}`);
  return row.state;
}

describe('ProviderLedger static checks', () => {
  const cfg = WEB_SEARCH_DEFAULTS;

  it('marks every keyed engine ready and anysearch anonymous when no key exists', () => {
    const ledger = new ProviderLedger();
    expect(stateOf(ledger, cfg, NO_KEY, 'anysearch')).toBe('anonymous');
    expect(stateOf(ledger, cfg, NO_KEY, 'bocha')).toBe('no-key');
    const sum = summarize(ledger.checkpoints(cfg, NO_KEY));
    expect(sum).toEqual({ total: 14, ready: 1, blocked: 13, failed: 0 });
  });

  it('marks all 14 ready once every secret is present', () => {
    const sum = summarize(new ProviderLedger().checkpoints(cfg, ALL_KEYS));
    expect(sum).toEqual({ total: 14, ready: 14, blocked: 0, failed: 0 });
  });

  it('reports a closed switch as off even when the key exists', () => {
    const ledger = new ProviderLedger();
    const closed: WebSearchConfigSection = {
      ...cfg,
      providers: { ...WEB_SEARCH_DEFAULTS.providers, bocha: false },
    };
    expect(stateOf(ledger, closed, ALL_KEYS, 'bocha')).toBe('off');
    expect(blockedIds(ledger.checkpoints(closed, ALL_KEYS))).toEqual(['bocha']);
  });

  it('falls back to the default switches when the config has no providers key', () => {
    const ledger = new ProviderLedger();
    expect(stateOf(ledger, {}, ALL_KEYS, 'tavily')).toBe('ready');
  });
});

describe('ProviderLedger passive records', () => {
  const cfg = WEB_SEARCH_DEFAULTS;

  it('lets the last real call outrank a ready static check', () => {
    const ledger = new ProviderLedger();
    ledger.record([{ id: 'tavily', ok: false, error: 'HTTP 429', hits: 0 }], '2026-11-23T06:00:00+08:00');
    expect(stateOf(ledger, cfg, ALL_KEYS, 'tavily')).toBe('last-error');
    expect(failedIds(ledger.checkpoints(cfg, ALL_KEYS))).toEqual(['tavily']);
    expect(ledger.last('tavily')?.error).toBe('HTTP 429');
    expect(ledger.size).toBe(1);
  });

  it('keeps a closed switch off after a failed call', () => {
    const ledger = new ProviderLedger();
    ledger.record([{ id: 'bocha', ok: false, error: 'HTTP 500', hits: 0 }], '2026-11-23T06:00:00+08:00');
    const closed: WebSearchConfigSection = {
      ...cfg,
      providers: { ...WEB_SEARCH_DEFAULTS.providers, bocha: false },
    };
    expect(stateOf(ledger, closed, ALL_KEYS, 'bocha')).toBe('off');
  });

  it('shows the hit count of the last successful call', () => {
    const ledger = new ProviderLedger();
    ledger.record([{ id: 'exa', ok: true, hits: 3 }], '2026-11-23T06:00:00+08:00');
    const row = ledger.checkpoints(cfg, ALL_KEYS).find((r) => r.id === 'exa');
    expect(row?.state).toBe('ready');
    expect(row?.detail).toContain('3');
  });

  it('overwrites the older record of the same engine', () => {
    const ledger = new ProviderLedger();
    ledger.record([{ id: 'serper', ok: false, error: 'HTTP 500', hits: 0 }], '2026-11-23T06:00:00+08:00');
    ledger.record([{ id: 'serper', ok: true, hits: 5 }], '2026-11-23T06:01:00+08:00');
    expect(stateOf(ledger, cfg, ALL_KEYS, 'serper')).toBe('ready');
    expect(ledger.last('serper')?.ts).toBe('2026-11-23T06:01:00+08:00');
    expect(ledger.size).toBe(1);
  });

  it('flattens whitespace and clips a long error to one short line', () => {
    const ledger = new ProviderLedger();
    ledger.record([{ id: 'brave', ok: false, error: `boom\n${'x'.repeat(200)}`, hits: 0 }], '2026-11-23T06:00:00+08:00');
    const detail = ledger.last('brave')?.error ?? '';
    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(64);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('drops every record on clear', () => {
    const ledger = new ProviderLedger();
    ledger.record([{ id: 'kimi', ok: false, error: 'HTTP 500', hits: 0 }], '2026-11-23T06:00:00+08:00');
    ledger.clear();
    expect(ledger.size).toBe(0);
    expect(stateOf(ledger, cfg, ALL_KEYS, 'kimi')).toBe('ready');
  });
});

describe('webUi status surface', () => {
  function newWorld(secret: (name: string) => string = NO_KEY) {
    const ctx = fakeWorldContext(WebSearch, { scratchDir: scratchDir(), packageDir });
    Object.assign(ctx.cfg, { enabled: true });
    (ctx.cfg as WebSearchConfigSection).maxResults = 5;
    ctx.secret = secret;
    return WebSearch.create(ctx);
  }

  it('draws one badge per engine, in the priority order the prompt uses', () => {
    const badges = newWorld().webUi?.().badges ?? [];
    expect(badges.map((b) => b.label)).toEqual([...SINGLE_MODE_PRIORITY]);
    expect([...badges.map((b) => b.label)].sort()).toEqual([...SEARCH_PROVIDER_IDS].sort());
    expect(badges.every((b) => b.value && b.tone)).toBe(true);
  });

  it('keeps the lamp count inside the host cap', () => {
    const lamps = newWorld().webUi?.().lamps ?? [];
    expect(lamps).toHaveLength(3);
    expect(lamps.length).toBeLessThanOrEqual(MODULE_LAMP_MAX);
    expect(lamps.map((l) => l.label)).toEqual(['引擎', '上次调用', '聚合模式']);
  });

  it('shows the offline lamp before this process has called any engine', () => {
    const lamps = newWorld(ALL_KEYS).webUi?.().lamps ?? [];
    const run = lamps.find((l) => l.label === '上次调用');
    expect(run?.state).toBe('offline');
    expect(run?.hint).toContain('还没有调用');
  });

  it('turns one failing engine into an error lamp and a failed badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('tavily')) throw new Error('HTTP 429 rate limited');
      return { ok: true, status: 200, json: async () => ({ results: [] }) } as unknown as Response;
    }));
    const world = newWorld(ALL_KEYS);
    await world.tools()[0].handler({ query: 'hello' }, TOOL_CTX);

    const lamps = world.webUi?.().lamps ?? [];
    const run = lamps.find((l) => l.label === '上次调用');
    expect(run?.state).toBe('error');
    expect(run?.hint).toContain('tavily');

    const badge = (world.webUi?.().badges ?? []).find((b) => b.label === 'tavily');
    expect(badge?.value).toBe('上次失败');
    expect(badge?.tone).toBe('off');
  });

  it('reports every engine blocked when no switch is on', () => {
    const ctx = fakeWorldContext(WebSearch, { scratchDir: scratchDir(), packageDir });
    Object.assign(ctx.cfg, {
      enabled: true,
      providers: Object.fromEntries(SEARCH_PROVIDER_IDS.map((id) => [id, false])),
    });
    const lamps = WebSearch.create(ctx).webUi?.().lamps ?? [];
    const cover = lamps.find((l) => l.label === '引擎');
    expect(cover?.state).toBe('offline');
    expect(cover?.hint).toContain('0/14');
  });

  it('survives a throwing secret reader without breaking the page', () => {
    const ctx = fakeWorldContext(WebSearch, { scratchDir: scratchDir(), packageDir });
    Object.assign(ctx.cfg, { enabled: true });
    ctx.secret = () => {
      throw new Error('secret store locked');
    };
    const lamps = WebSearch.create(ctx).webUi?.().lamps ?? [];
    expect(lamps).toHaveLength(1);
    expect(lamps[0]?.state).toBe('error');
    expect(WebSearch.create(ctx).webUi?.().badges ?? []).toEqual([]);
  });

  it('still mounts clean with the new lamps and badges', async () => {
    const report = await dryMountWorld(WebSearch, { scratchDir: scratchDir(), packageDir });
    expect(report.failures).toEqual([]);
  });
});

describe('engines panel data plane', () => {
  function newWorld(secret: (name: string) => string = NO_KEY) {
    const ctx = fakeWorldContext(WebSearch, { scratchDir: scratchDir(), packageDir });
    Object.assign(ctx.cfg, { enabled: true });
    (ctx.cfg as WebSearchConfigSection).maxResults = 5;
    ctx.secret = secret;
    return WebSearch.create(ctx);
  }

  /** 宿主按这个键去产物里取面板实现，两侧写死成一个字面量，靠这条测试锁住不漂。 */
  const PANEL_ID = 'engines';

  it('declares exactly one read-only panel', () => {
    const panels = newWorld().webUi?.().panels ?? [];
    expect(panels).toHaveLength(1);
    expect(panels[0]?.id).toBe(PANEL_ID);
    expect(panels[0]?.getMethods).toEqual(['state']);
  });

  it('keeps the browser bundle panel key equal to the declared panel id', () => {
    const source = readFileSync(join(packageDir, 'src', 'webui.ts'), 'utf8');
    const match = source.match(/panels:\s*\{\s*([A-Za-z0-9_-]+):/);
    expect(match?.[1]).toBe(PANEL_ID);
  });

  it('answers state with 14 rows and the summary counts', async () => {
    const world = newWorld((name) => (name === 'TAVILY_API_KEY' ? 'fake-key' : ''));
    const state = await world.webUi?.().invoke?.(PANEL_ID, 'state', []) as {
      total: number; ready: number; blocked: number; failed: number; updatedAt: string; mode: string;
      rows: Array<{ id: string; state: string; keyed: boolean; switchOn: boolean; secretName: string; lastTs: string }>;
    };
    expect(state.rows).toHaveLength(14);
    // ready 含匿名可用的 anysearch，所以只配一家密钥时是 2 家。
    expect(state.total).toBe(14);
    expect(state.ready).toBe(2);
    expect(state.blocked).toBe(12);
    expect(state.failed).toBe(0);
    expect(state.updatedAt).toMatch(/T/);
    expect(state.mode).toContain('multi');
    const tavily = state.rows.find((r) => r.id === 'tavily');
    expect(tavily?.state).toBe('ready');
    expect(tavily?.keyed).toBe(true);
    expect(tavily?.switchOn).toBe(true);
    expect(tavily?.secretName).toBe('TAVILY_API_KEY');
    expect(tavily?.lastTs).toBe('');
  });

  it('rejects an unknown panel or method by name', async () => {
    const invoke = newWorld().webUi?.().invoke;
    await expect(invoke?.('nope', 'state', [])).rejects.toThrow('nope');
    await expect(invoke?.(PANEL_ID, 'reset', [])).rejects.toThrow('reset');
  });

  it('shows the error text and the timestamp of the last failed call', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('exa')) throw new Error('HTTP 402 quota exceeded');
      return { ok: true, status: 200, json: async () => ({ results: [] }) } as unknown as Response;
    }));
    const world = newWorld(ALL_KEYS);
    await world.tools()[0].handler({ query: 'hello' }, TOOL_CTX);

    const state = await world.webUi?.().invoke?.(PANEL_ID, 'state', []) as {
      failed: number; rows: Array<{ id: string; state: string; detail: string; lastTs: string }>;
    };
    const exa = state.rows.find((r) => r.id === 'exa');
    expect(exa?.state).toBe('last-error');
    expect(exa?.detail).toContain('402');
    expect(exa?.lastTs).toMatch(/T/);
    expect(state.failed).toBe(1);
  });
});
