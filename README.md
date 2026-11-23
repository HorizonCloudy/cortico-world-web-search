# cortico-world-web-search-multi

Cortico World 插件：世界 id `web-search-multi`，暴露一个**多 provider 聚合**搜索工具 `web_search_multi`。同时对多家搜索 API 并行取结果，跨源按 url 去重，逐家可在配置面板开关。

## 与官方 `cortico-world-websearch` 的分工

官方包（`cortico-world-websearch`，内建 world id `websearch`）走 Brave + DeepSeek 两栈、单源优先、带 `mode` / `fresh` / `n` 等检索语义，适合「照着说的去搜一次」。

本包是**多源聚合**：一次调用同时问多家、跨源去重、逐家开关，适合需要交叉验证或某一家被限流时自动由其余家兜底。两者工具名不冲突（`web_search` vs `web_search_multi`），可以同时装。

## 用途

调用 `web_search_multi` 按关键词在网上搜索，返回标题、网址和简介；可用 `max_results` 限制返回条数，最多 10 条。世界挂载时会推送 `web-search-multi.started` 事件。

聚合行为：

- **多引擎优先模式（默认）**：只调用「开关打开 且（不需要密钥 或 密钥已配置）」的提供商，`Promise.all` 并行；`single` 模式只调用其中优先级最高的一个。
- 每家的请求形状与结果路径按各自官方文档解析（见下表），不做「统一 POST + 顶层 results 数组」的猜测。
- 按 `url` 去重（忽略大小写），再截断到 `maxResults`。
- **单家失败不影响其他家**：失败只记一条 warn 到运行日志；拿不到 logger 时在回执末尾附一行「n 家提供商调用失败」。
- 所有 fetch 带 `ToolCallContext.signal`，宿主放弃本次调用时立即中断。

## API key 怎么配置

搜索密钥由宿主的 secrets 注入，不写入配置文件明文。handler 按提供商读取以下环境变量名：

| 提供商 | 环境变量 | 是否必需 |
| --- | --- | --- |
| anysearch | `ANYSEARCH_API_KEY` | 可选（匿名可用，限速较低） |
| tavily | `TAVILY_API_KEY` | 必需 |
| exa | `EXA_API_KEY` | 必需 |
| bocha | `BOCHA_API_KEY` | 必需 |
| ali（阿里 IQS） | `ALI_IQS_API_KEY` | 必需 |
| zhipu | `ZHIPU_API_KEY` | 必需 |
| perplexity | `PERPLEXITY_API_KEY` | 必需 |
| serper | `SERPER_API_KEY` | 必需 |
| brave | `BRAVE_API_KEY` | 必需 |
| mojeek | `MOJEEK_API_KEY` | 必需 |
| youcom | `YDC_API_KEY` | 必需 |
| linkup | `LINKUP_API_KEY` | 必需 |
| firecrawl | `FIRECRAWL_API_KEY` | 必需 |
| kimi | `MOONSHOT_API_KEY` | 必需 |

在宿主中设置 secret（具体名随宿主而定，示例）：

```
ANYSEARCH_API_KEY=你的密钥
BOCHA_API_KEY=你的密钥
PERPLEXITY_API_KEY=你的密钥
```

**tencent 未纳入**：腾讯云 WSA 需要 TC3-HMAC-SHA256 签名 + SecretId/SecretKey + region 四件套，`ctx.secret(name)` 是一名字一值，塞不进签名材料，也无法用 fixture 单测覆盖。留待后续版本。

## 各家的请求与解析（按官方文档）

| id | 方法 | URL | 鉴权 | 请求体/参数 | 结果路径 |
| --- | --- | --- | --- | --- | --- |
| `anysearch` | POST | `https://api.anysearch.com/v1/search`（官方固定端点） | `Authorization: Bearer`（可选） | `{query, max_results}` | `data.results[]` → `results[]` → `items[]`；`code` 非 0 视为失败 |
| `tavily` | POST | `https://api.tavily.com/search` | body 内 `api_key` | `{query, max_results, api_key}` | `results[]` |
| `exa` | POST | `https://api.exa.ai/search` | `x-api-key` 头 | `{query, numResults, contents:{highlights:true}}` | `results[]`（摘要取 `highlights[0]`） |
| `bocha` | POST | `https://api.bochaai.com/v1/web-search` | `Authorization: Bearer` | `{query, count, summary:true}` | `data.webPages.value[]`（Bing 兼容，标题字段 `name`） |
| `ali` | POST | `https://cloud-iqs.aliyuncs.com/search/unified` | `Authorization: Bearer` | `{query, engineType:'LiteAdvanced', contents:{summary:true}, advancedParams:{numResults}}` | `pageItems[]`（链接字段 `link`） |
| `zhipu` | POST | `https://open.bigmodel.cn/api/paas/v4/web_search` | `Authorization: Bearer` | `{search_query, search_engine:'search_pro', count}` | `search_result[]`（链接字段 `link`） |
| `perplexity` | POST | `https://api.perplexity.ai/search` | `Authorization: Bearer` | `{query, max_results}` | `results[]`（`snippet` 可能为空串） |
| `serper` | POST | `https://google.serper.dev/search` | `X-API-KEY` 头 | `{q, num}` | `organic[]`，`answerBox` 有链接时排第一 |
| `brave` | **GET** | `https://api.search.brave.com/res/v1/web/search?q=…&count=…` | `X-Subscription-Token` 头 | query string | `web.results[]`（摘要字段 `description`） |
| `mojeek` | **GET** | `https://api.mojeek.com/search?q=…&t=…&fmt=json&api_key=…` | `api_key` 在 query string | GET query string | `response.results[]` → `results[]` 兜底；摘要字段 `desc` → `snippet`/`content` 兜底，条数参数 `t` |
| `youcom` | POST | `https://ydc-index.io/v1/search` | `X-API-Key` 头 | `{query, count}` | `results.web[]`（**results 是对象不是数组**）；摘要 `description` → `snippets[0]` 兜底 |
| `linkup` | POST | `https://api.linkup.so/v1/search` | `Authorization: Bearer` | `{q, depth:'fast', outputType:'searchResults', maxResults}` | `results[]`（标题字段 `name`、摘要字段 `content`） |
| `firecrawl` | POST | `https://api.firecrawl.dev/v2/search` | `Authorization: Bearer` | `{query, limit}` | `data.web[]`（摘要字段 `description`） |
| `kimi` | POST | `https://api.moonshot.cn/v1/tools/search` | `Authorization: Bearer` | `{text_query, limit, include_content:true}` | `search_results[]`（标题/链接/摘要 `title`/`url`/`snippet`） |

perplexity 用的是检索接口 `/search`，不是 `chat/completions`：Sonar Chat Completions 已于 2026-09-27 停止支持。

本包现聚合 **14 家**提供商（原 9 家 + mojeek / youcom / linkup / firecrawl / kimi）：mojeek 是独立欧洲索引，youcom 带 Web + News 双源，linkup 是 agentic search，firecrawl 覆盖 research/pdf/developer/gov 垂类，kimi 国内直连。新增 5 家的端点/字段来自官方文档样例级检索（抓取 2026-11-20），**未经真实密钥 live 验证**，官方改版后需同步。

## 配置

配置节 `worlds.web-search-multi`：

```
{
  "enabled": true,
  "providers": { "anysearch": true, "tavily": true, "exa": false, "...": true },
  "maxResults": 5,
  "searchMode": "multi"
}
```

- `enabled`、`maxResults`、`searchMode` 在配置面板里可改。
- `providers` 是逐家开关，缺键视为打开。
- `searchMode` 缺键视为 `multi`（旧配置不需要迁移）。

## 选哪家引擎：`provider` 参数

`web_search_multi` 接受可选的 `provider` 参数（enum 为 14 家 id，与 `SearchProvider` / `PROVIDER_ADAPTERS` / `PROVIDER_SECRET` 同源）：

- 不填：并行调用所有「开关打开 且（无需密钥或已配密钥）」的引擎，按 url 去重后截断（默认行为）。
- 填一家 id：只调用那一家。
- 填的 id 未知 / 那家开关关闭 / 那家缺密钥：返回 `failed: true` 的明确错误，区分三种原因；**不会静默降级到全部，也不会忽略开关强制调用**。

## 搜索模式与引擎优先级

`searchMode` 决定「不指定 `provider` 时怎么搜」，两种模式都把结果按 `url` 去重（忽略大小写）后截断到 `maxResults`：

| 模式 | 调用顺序 | 组合与汇总 | 失败回退 | 适用 |
| --- | --- | --- | --- | --- |
| `multi`（多引擎优先，默认） | 并发，无先后 | 全部可用引擎各发一次；按内置 adapter 表顺序拼接、跨源去重 | 单家失败只跳过该家，回执末尾列失败家；全部失败或无命中报「未找到结果」 | 交叉验证、抗单家限流 |
| `single`（单引擎优先） | 串行，只调一家 | 只取优先级最高的一个可用引擎；单源、不跨源合并 | **不自动换家**：该家失败或无命中就明确报原因，换源请显式传 `provider` 或切回 `multi` | 省钱、降延迟、要单源可追溯 |

单引擎优先的选取顺序（也是提示词里「可用引擎范围」的展示顺序）：

```
bocha → tavily → brave → exa → ali → zhipu → serper
      → mojeek → youcom → linkup → firecrawl → kimi → perplexity → anysearch
```

排序理由：中文场景（bocha）与 Agent 原生通用（tavily）优先，自有索引（brave）次之，垂直与国内补充源居中，匿名限速的 anysearch 垫底。`SINGLE_MODE_PRIORITY` 必须与 `SEARCH_PROVIDER_IDS` 互为全排列，加第 15 家时测试会红，提醒你把它排进顺序。

`provider` 参数在两种模式下都优先于模式：显式指定就用那一家，未知 id / 开关关闭 / 缺密钥照旧明确报错。

## 引擎状态检查点

World 页面上每家常驻引擎都有一枚徽标，共 14 枚。徽标取五个状态之一，判定顺序固定：

| 状态 | 判据 | 徽标色 |
| --- | --- | --- |
| `已关闭` | 配置面板里该家开关为 false | 灰 |
| `缺密钥` | 开关打开，但该家需要密钥而密钥未配 | 灰 |
| `上次失败` | 本进程最近一次真实调用返回错误 | 灰 |
| `匿名可用` | 仅 anysearch，未配密钥 | 中性 |
| `可用` | 开关打开且密钥在手，上一次调用没报错 | 亮 |

前三条按顺序判定，所以「已关闭」压过「上次失败」，「缺密钥」压过「上次失败」。判定不发请求，不花配额。

徽标之外另有三盏总览灯。`引擎` 报可用家数与被挡名单，`上次调用` 在本轮有失败时转红并列出失败家，`聚合模式` 显示当前 `multi` 或 `single`。灯数上限是宿主的 `MODULE_LAMP_MAX`（7 盏），本 World 固定用 3 盏。

「上次失败」与命中数只记本进程最近一次，存在内存里，重启即清空。跨重启的历史属于运行日志，不在这个面板。

要看得更细就开「引擎状态」页签。它是一张 14 行的明细表，逐行报状态、说明文字、开关、密钥变量名与上一次调用的时间戳。表每 5 秒自动刷新，也可以手点刷新。数据走 `webUi().panels[id='engines']` 的 `invoke('state')`，面板实现打包在 `dist/webui.js`。

发布前要先生成产物：

```
pnpm build:webui   # tsc -p tsconfig.webui.json，产出 dist/webui.js
```

`dist/` 已进 `.gitignore`，但列在 `package.json` 的 `files` 里，`files` 优先，所以 npm 包里带着它。改过 `src/webui.ts` 记得重跑 `build:webui`，否则 npm 上的产物与源码不一致。

## 各提供商价格与约束（官方量级参考，随官方变动）

| 提供商 | 价格 | 定位 | 硬约束 |
| --- | --- | --- | --- |
| Anysearch | 免费 1000 次/天 | API + MCP + Skill，个人项目与原型首选 | 匿名访问受较低限速，建议配 API key |
| Tavily | $8/千次（1000 credits/月免费） | Agent 默认项，含 extract/crawl/map | 密钥必填 |
| Exa | $7/千次（快速模式 $4） | 向量语义检索，擅长探索式查询 | 密钥必填，以 x-api-key 头传递 |
| Bocha | 约 ¥20/千次 | 中文场景综合最强，自带 reranker | 密钥必填，中文搜索为主 |
| 阿里 IQS | 约 ¥12/千次 Lite，Standard ¥30–42，Deep ¥50 | 国内主力，阿里云联网搜索 | 密钥必填，后付费 |
| 智谱 | 含在 token 费用内 | Tool Calling + MCP，聚合 5 家引擎 | 密钥必填，随模型账单计费 |
| Perplexity | $5/千次 | 原始结果，索引新、覆盖广 | 密钥必填，摘要可能为空 |
| Serper | $0.3–1/千次 | 最便宜的 Google SERP，无正文提取 | 密钥必填，合规风险自评 |
| Brave | $5/月免费额度 | 自有索引约 300 亿页，不依赖 Google/Bing | 密钥必填，免费额度有限 |
| Mojeek | 按套餐，有免费额度 | 独立欧洲索引，非 Google/Bing 系补充源 | 密钥必填，GET + query string 传 api_key |
| You.com (YDC) | 按套餐 | Web + News 双源，YDC 索引 | 密钥必填（键名 `YDC_API_KEY`），results 为对象 |
| Linkup | 按套餐/按量 | agentic search，适合推理式检索 | 密钥必填，需传 depth/outputType |
| Firecrawl | 按量 | 垂类索引（research/pdf/developer/gov） | 密钥必填，v2 端点 |
| Kimi (Moonshot) | 按量 | 国内直连，Moonshot 工具搜索 | 密钥必填（键名 `MOONSHOT_API_KEY`），查询字段 `text_query` |

新增 5 家的价格仅作定性参考（[未核验]，随官方变动），以官网为准。

## 硬约束

- Bing Search API 已关停，替代品 Grounding with Bing 只返回模型答案，不给原始结果。
- Google Custom Search JSON API 已停止接受新客户，存量客户 2027-01-01 过渡截止。
- SERP 抓取类存在法律尾部风险（如 SerpApi、Reddit 相关诉讼，未结案），合规风险自评。
- 只用一个供应商是架构缺陷：本插件已对各提供商并行调用并按 url 去重，单家失败只跳过该家。

## 如何运行

SDK 来自 `cortico` devDependency（`^0.2.17`），不需要 vendor submodule。在包目录下：

```
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build:webui   # tsc -p tsconfig.webui.json，产出 dist/webui.js
pnpm test          # vitest run：干装载 + fetch stub，不联网、不启宿主
```

`src/webui.ts` 走独立的 `tsconfig.webui.json`。那份配置 `types: []`，禁掉 node 类型，产物又必须零依赖，所以这个文件不许 import 任何东西。宿主用 `import()` 直接加载 `dist/webui.js`，产物里出现裸导入会在浏览器侧解析失败。

在 Cortico 检出根验证装载：

```
pnpm describe:extension <本包目录>   # 生成 describe.json（不要手改）
pnpm check:extension <本包目录>      # 应打 Extension check passed.
```

本包不内置 `describe:extension` / `check:extension` 脚本（它们在 Cortico 检出根）；`describe.json` 必须由生成器产出，不要手改。本机无检出时可用 `cortico/extensions/describe-export.ts` 的 `exportDescribe()` / `checkDescribe()` 直接跑同一套生成与校验逻辑。

## 限制

- 各家的 REST 端点是按官方文档实现的，官方改版后需同步；单测用的是 fixture，**没有实机打过**。
- 验证到「构建 + 干装载」两级；真搜出结果属行为级，只能在真宿主里目击。
- 回执只给结果，不带各家的价格与约束（那些是配置期信息，不进模型上下文）。
