# Changelog

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
