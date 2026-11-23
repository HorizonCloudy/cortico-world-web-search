/**
 * 浏览器端面板产物：14 家引擎的状态明细表。
 *
 * 本文件由 `dist/webui.js` 单独编译（`tsconfig.webui.json`）。它不能 import 任何东西：
 * 宿主用 `import()` 直接加载这一个文件，产物里出现裸导入会在浏览器侧解析失败。
 * 下面两个 interface 是按 `cortico/src/web/shared/client-panel.ts:593-603`（读于 2026-11-23）
 * 手写的结构副本，只声明本文件用到的成员。宿主运行时不校验来源，只按 `panels[panelId].mount` 取。
 *
 * 数据来自服务端 `webUi().panels[id='engines']` 的 `invoke('state')`，见 `src/world.ts`。
 * 本文件不碰 `document.body`，只写 `ctx.root`；定时器与 fetch 都挂在 `ctx` 上，卸载即停。
 */

/** 宿主给面板的运行时上下文的最小面。 */
interface PanelContext {
  readonly language: string;
  readonly root: HTMLElement;
  readonly signal: AbortSignal;
  invoke<T = unknown>(method: string, args?: unknown[]): Promise<T>;
  interval(fn: () => void, ms: number): { dispose(): void };
}

/** 服务端 `invoke('state')` 的回执。与 `src/status.ts` 的 `PanelState` 逐字对齐。 */
interface PanelState {
  updatedAt: string;
  mode: string;
  total: number;
  ready: number;
  blocked: number;
  failed: number;
  rows: Array<{
    id: string;
    state: string;
    detail: string;
    switchOn: boolean;
    keyed: boolean;
    secretName: string;
    lastTs: string;
  }>;
}

/** 面板文案表。`summary` 是唯一带参数的条目。 */
interface PanelStrings {
  title: string;
  refresh: string;
  autoOn: string;
  headEngine: string;
  headState: string;
  headDetail: string;
  headLast: string;
  loading: string;
  error: string;
  never: string;
  mode: string;
  summary(ready: number, total: number, blocked: number, failed: number): string;
}

const STRINGS: Record<'zh' | 'en', PanelStrings> = {
  zh: {
    title: '引擎状态',
    refresh: '刷新',
    autoOn: '每 5 秒自动刷新',
    headEngine: '引擎',
    headState: '状态',
    headDetail: '说明',
    headLast: '上次调用',
    summary: (ready: number, total: number, blocked: number, failed: number) =>
      `可调用 ${ready}/${total} 家。被挡 ${blocked} 家。本轮失败 ${failed} 家。`,
    loading: '读取中…',
    error: '读取失败：',
    never: '—',
    mode: '聚合模式',
  },
  en: {
    title: 'Engine status',
    refresh: 'Refresh',
    autoOn: 'Auto refresh every 5 s',
    headEngine: 'Engine',
    headState: 'State',
    headDetail: 'Detail',
    headLast: 'Last call',
    summary: (ready: number, total: number, blocked: number, failed: number) =>
      `${ready}/${total} callable. ${blocked} blocked. ${failed} failed this round.`,
    loading: 'Loading…',
    error: 'Load failed: ',
    never: '—',
    mode: 'Aggregation mode',
  },
};

const pick = (language: string): PanelStrings => STRINGS[language === 'zh' ? 'zh' : 'en'];

/** 状态色。与后端五个 state 一一对应，未知值按中性处理。 */
const COLOR: Record<string, string> = {
  ready: '#1a7f37',
  anonymous: '#6b7280',
  'no-key': '#9a6700',
  off: '#6b7280',
  'last-error': '#b42318',
};

const TEXT: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    ready: '可用', anonymous: '匿名可用', 'no-key': '缺密钥', off: '已关闭', 'last-error': '上次失败',
  },
  en: {
    ready: 'ready', anonymous: 'anonymous', 'no-key': 'missing key', off: 'switched off',
    'last-error': 'last call failed',
  },
};

export default {
  panels: {
    engines: {
      mount(ctx: PanelContext): void {
        const s = pick(ctx.language);
        const lang = ctx.language === 'zh' ? 'zh' : 'en';
        const root = ctx.root;
        root.style.cssText = 'font:13px/1.5 system-ui,sans-serif;color:currentColor';

        const head = document.createElement('div');
        head.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap';
        const summary = document.createElement('span');
        const mode = document.createElement('span');
        mode.style.cssText = 'opacity:.7';
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = s.refresh;
        const note = document.createElement('span');
        note.style.cssText = 'opacity:.6';
        note.textContent = s.autoOn;
        head.append(summary, mode, refresh, note);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse';
        table.innerHTML = `<thead><tr>`
          + `<th style="text-align:left;padding:4px 8px">${s.headEngine}</th>`
          + `<th style="text-align:left;padding:4px 8px">${s.headState}</th>`
          + `<th style="text-align:left;padding:4px 8px">${s.headDetail}</th>`
          + `<th style="text-align:left;padding:4px 8px">${s.headLast}</th>`
          + `</tr></thead><tbody></tbody>`;
        const body = table.querySelector('tbody') as HTMLTableSectionElement;
        root.append(head, table);

        const cell = (text: string, color?: string): HTMLTableCellElement => {
          const td = document.createElement('td');
          td.style.cssText = `padding:4px 8px;border-top:1px solid rgba(127,127,127,.25);${color ? `color:${color}` : ''}`;
          td.textContent = text;
          return td;
        };

        let busy = false;
        const load = async (): Promise<void> => {
          if (busy) return;
          busy = true;
          try {
            const state = await ctx.invoke<PanelState>('state');
            body.replaceChildren(...state.rows.map((row) => {
              const tr = document.createElement('tr');
              const label = (TEXT[lang] as Record<string, string>)[row.state] ?? row.state;
              tr.append(
                cell(row.id),
                cell(label, COLOR[row.state] ?? ''),
                cell(row.detail),
                cell(row.lastTs || s.never),
              );
              return tr;
            }));
            summary.textContent = s.summary(state.ready, state.total, state.blocked, state.failed);
            mode.textContent = `${s.mode}: ${state.mode}`;
            refresh.disabled = false;
          } catch (error) {
            summary.textContent = `${s.error}${error instanceof Error ? error.message : String(error)}`;
          } finally {
            busy = false;
          }
        };

        refresh.addEventListener('click', () => { void load(); }, { signal: ctx.signal });
        ctx.interval(() => { void load(); }, 5_000);
        summary.textContent = s.loading;
        void load();
      },
    },
  },
};
