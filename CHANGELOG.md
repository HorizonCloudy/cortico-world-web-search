# Changelog

## 0.5.1 (2026-11-24)

- 新增 `cortico.icon` 静态头像：`assets/icon.webp`（512×512 WebP，quality 85）。`files` 加入 `assets`，确保 npm 包携带该文件，头像不会指向空路径。
- 无代码与搜索行为改动；头像不进自描述三段，`describe.json` 无需重生成。

## 0.5.0

- **新增「引擎状态」明细表面板**：`webUi()` 声明 `panels: [{ id: 'engines', getMethods: ['state'] }]`，`invoke('state')` 回 `PanelState`（14 行 + 汇总计数 + `updatedAt` + 当前模式）。每行含状态、说明文字、开关、密钥变量名与上次调用时间戳。
- **新增浏览器端产物** `src/webui.ts` → `dist/webui.js`（`cortico.webUiClient`）。它零依赖、零 import，宿主用 `import()` 直接加载。面板按 `ctx.interval` 每 5 秒刷新，卸载即停；文案随 `ctx.language` 取 zh / en 两份。
- **新增构建步骤**：`tsconfig.webui.json`（`types: []`，`include: src/webui.ts`）与 `pnpm build:webui`。`files` 加 `dist`，`.gitignore` 加 `dist/`（`files` 优先，npm 包仍带产物）。
- `Checkpoint` 增列 `switchOn` / `keyed` / `secretName` / `lastTs`，供明细表直接印出密钥变量名。
- 面板 id 两侧对齐由测试锁定：`webUi().panels[0].id` 与 `src/webui.ts` 里 `panels` 的键必须同为 `engines`。
- World id、配置键、工具名、事件与 `describe.json` 不变（新增的 lamps / badges / panels / invoke 都不进自描述三段）。测试 64 条通过。官方 `exportDescribe()` 与 `checkDescribe()` 本机实测：warnings 0，failures 0。

## 0.4.0

- **新增每家引擎的状态检查点**：`src/status.ts` 落 `ProviderLedger`，14 家逐条给出 `可用 / 匿名可用 / 缺密钥 / 已关闭 / 上次失败` 五态之一。静态部分只读面板开关与密钥存在性，不发请求、不花配额，判定口径与 `usableProviders()` 逐字一致。
- **被动记录上一次真实调用**：`searchHandler` 每轮把各家成败、错误文本（折行拉平、裁到 64 字符）与命中数写进台账，只留每家最近一次，存内存，重启即清空。
- **WebUI 露出**：`webUi()` 新增 14 枚徽标（每家一枚，顺序取 `SINGLE_MODE_PRIORITY`）与 3 盏总览灯（`引擎` 可用数与被挡名单、`上次调用` 本轮失败家、`聚合模式` 当前模式）。灯数在宿主 `MODULE_LAMP_MAX`(7) 之内。取配置或读密钥出错时降级成一盏红字提示灯，页面不炸。
- 未引入 `webUiClient` 构建步骤，因此没有可展开的明细表格。宿主要求声明的 `panels` 必须由产物包提供 `mount` 实现，纯数据面板不支持，故本版不声明 `panels`。
- World id、配置键、工具名 `web_search_multi`、事件与 `describe.json` 全部不变（tools / events / prompts 三段无改动，无需重生成）。搜索行为不变，新增测试 17 条。

## 0.3.1

- **显示名改为「聚合搜索」**：新增 `cortico.displayName` 与 `cortico.locales`（zh 聚合搜索 / en Aggregated Search）。`WorldDefinition.label` 与 `webUi().label` 改读新常量 `WEB_SEARCH_LABEL`，此前两处都用 id `web-search-multi`，市场与宿主 World 列表显示的是包名派生的英文 id。
- World id、配置键 `worlds.web-search-multi.*`、工具名 `web_search_multi` 与事件 `web-search-multi.started` 全部不变，已有配置与提示词无需迁移。
- 搜索行为无改动。

## 0.3.0

- **环境提示词三项变量化**：`src/ENV_PROMPT.md` 里「可用引擎范围」「已启用引擎的搜索方案（调用顺序/组合方式/结果汇总/失败回退）」「搜索模式」改为模板变量 `{{web_search_multi.availableProviders}}` / `{{web_search_multi.searchPlan}}` / `{{web_search_multi.searchMode}}`，由 `envPromptVars()` 按当前配置现算。可用范围按面板开关 + 实际密钥判定，不再是与配置脱钩的静态列表。
- **新增 `worlds.web-search-multi.searchMode`（`multi` | `single`，默认 `multi`）**：`multi` 与旧行为逐字一致；`single` 只调用 `SINGLE_MODE_PRIORITY` 里第一个可用引擎，失败不自动换家，换源需显式 `provider` 或切回 `multi`。旧配置缺该键按 `multi` 处理，无需迁移。
- **新增 `SINGLE_MODE_PRIORITY`**（14 家全排列，首 `bocha` 末 `anysearch`），与 `SEARCH_PROVIDER_IDS` 互为全排列由测试锁定。
- **修复既存缺陷**：`describe.json` 内嵌模板用 `\n`、Windows autocrlf 检出把 `src/ENV_PROMPT.md` 转成 `\r\n`，导致 `check:extension` 的自描述检查在任何 autocrlf=true 的机器上恒失败。新增 `.gitattributes`（`* text=auto eol=lf`）钉住检出换行符，并用生成器重新产出 `describe.json`。
- 工具 description 改为模式中性（「并行或单源取决于聚合模式」），`cortico` manifest、工具名、参数 schema、14 家 adapter 均未改动。
- `cortico` devDependency 由 `^0.2.16` 提到 `^0.2.17`（与实际安装版本一致）。

## 0.2.0

- **删除「Anysearch 端点覆盖」**：移除配置面板属性、`WebSearchConfigSection.endpoint` 与 `WEB_SEARCH_DEFAULTS.endpoint`、`envPromptVars()` 的 endpoint 变量与 `ENV_PROMPT.md` 占位符；anysearch 固定走官方端点。不再有端点覆盖旋钮。
- **工具新增可选 `provider` 参数**：不指定时并行所有已开启且已配密钥的引擎；指定且可用时只调用那一家；指定但未知 id / 开关关闭 / 缺密钥时返回明确错误（`failed: true`），区分三种原因，不静默降级、不忽略开关。enum 从 `PROVIDER_SECRET` 派生，与 `SearchProvider` / `PROVIDER_ADAPTERS.id` 同源。

## 0.1.0

首个可用版本。基于模板重写，修掉契约审议列出的 6 条阻断项。

新增 mojeek / youcom / linkup / firecrawl / kimi 五家 provider（由 9 家扩到 14 家）：各有独立 adapter，按官方文档真实形状构造请求与解析；端点/字段来自官方样例级检索（2026-11-20），未经真实密钥 live 验证。

### 改名（首发前的破坏性改名，无历史用户）

- npm 包名：`cortico-world-web-search` → `cortico-world-web-search-multi`
- world id：`web-search` → `web-search-multi`（事件 type、配置键 `worlds.web-search-multi.*`、promptDoc key 同步）
- 工具名：`web_search` → `web_search_multi`（B1：Cortico 内建 world `websearch` 已注册 `web_search`，同名会被装配层拒绝挂载）

### 修复

- **B5 各家解析不到结果**：请求层从「统一 POST + 顶层 results 数组」改为每家一个独立 adapter（9 家），各自按官方文档构造鉴权、端点、请求体与结果路径；exa 改用 `numResults` 并开 `contents.highlights`，brave 改回 GET + query string，perplexity 改用 `/search` 检索接口（Sonar Chat Completions 已于 2026-09-27 停止支持）。
- **编译错误 8 条**：`WorldSection` 改从 `cortico/world.ts` 导入；删配置组里的 `default`（`ConfigProperty` 无此字段，工具 `parameters` 里的保留）；删掉 `definition.ts` 末尾重复导出（esbuild transform 失败根因）；`TOOL_DECLS` 标成 `ReadonlyArray<Omit<ToolDef, 'handler'>>`；`getByPath` 式归一化改为带显式类型的 adapter，消除 `{} 不可迭代`。

### 变化

- 回执瘦身：不再把 10 家提供商的价格/定位/硬约束整表拼进工具回执，只给结果；单家失败记一条 warn 到日志（拿不到 logger 时在回执末尾补一行）。
- 删掉 tencent：腾讯云 WSA 需要 TC3-HMAC-SHA256 签名 + SecretId/SecretKey + region，`ctx.secret(name)` 一名字一值塞不进四件套。留待后续版本。
- 所有 fetch 带 `ToolCallContext.signal`，宿主放弃调用时能中断。
- `package.json` 加 `cortico.tags: ["internet", "requires-key"]`，`files` 加 `CHANGELOG.md`。
