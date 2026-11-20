# cortico-world-web-search

Cortico World 插件：世界 id `web-search`，暴露一个网络搜索工具 `web_search`，基于 Anysearch / Tavily / Exa / Bocha / 阿里 IQS / 腾讯云 / 智谱 / Perplexity / Serper / Brave 聚合。

## 用途

调用 `web_search` 按关键词在网上搜索，返回标题、网址和简介；可用 `max_results` 限制返回条数，最多 10 条。世界挂载时会推送 `web-search.started` 事件。

聚合行为：对所有开启且配有密钥的提供商并行调用，各自使用对应的宿主 secret，按 `url` 去重，截断到 `maxResults` 后返回；任一提供商失败自动跳过，不阻断其余提供商。

## API key 怎么配置

搜索密钥由宿主的 secrets 注入，不写入配置文件明文。handler 在 `getApiKey(name)` 中按提供商读取以下名之一：

- `ANYSEARCH_API_KEY` — Anysearch（可选，缺失时匿名访问，受较低限速）
- `TAVILY_API_KEY` — Tavily
- `EXA_API_KEY` — Exa
- `BOCHA_API_KEY` — Bocha
- `ALI_IQS_API_KEY` — 阿里 IQS
- `TENCENT_SEARCH_API_KEY` — 腾讯云联网搜索
- `ZHIPU_API_KEY` — 智谱
- `PERPLEXITY_API_KEY` — Perplexity
- `SERPER_API_KEY` — Serper
- `BRAVE_API_KEY` — Brave

按提供商选用：Anysearch 端点可用配置 `worlds.web-search.endpoint` 覆盖；其余用固定官方端点。缺失全部密钥时，handler 抛出错误并提示配置。

在宿主中设置 secret（具体名随宿主而定，示例）：

```
ANYSEARCH_API_KEY=你的密钥
BOCHA_API_KEY=你的密钥
PERPLEXITY_API_KEY=你的密钥
```

## 各提供商价格与约束（官方量级参考，随官方变动）

| 提供商 | 价格 | 定位 | 优势 | 硬约束 |
| --- | --- | --- | --- | --- |
| Anysearch | 免费 1000 次/天 | API + MCP + Skill，个人项目与原型首选 | 免费额度大，多协议可用 | 匿名访问受较低限速，建议配 API key |
| Tavily | $8/千次（1000 credits/月免费） | Agent 默认项，含 extract/crawl/map | 2026 年并入 Nebius，Agent 原生 | 密钥必填，无匿名访问 |
| Exa | $7/千次（快速模式 $4） | 向量语义检索，擅长探索式查询 | 索引新，适合“找不到关键词”的场景 | 密钥必填，以 x-api-key 头传递 |
| Bocha | 约 ¥20/千次 | 中文场景综合最强，自带 reranker | 0.15s 延迟，支持 MCP，中文覆盖广 | 密钥必填，中文搜索为主 |
| 阿里 IQS | 约 ¥12/千次 Lite，Standard ¥30–42，Deep ¥50 | 有 OpenAI 兼容格式的国内主力 | 阿里云联网搜索，国内访问稳定 | 密钥必填，付费后付费 |
| 腾讯云 | 约 ¥18–22/千次轻量版后付费 | 腾讯云联网搜索轻量版 | 国内主流引擎，后付费计费 | 密钥必填，需腾讯云账号 |
| 智谱 | 含在 token 费用内 | Tool Calling + MCP，聚合 5 家引擎 | 聚合多引擎，调用简单 | 密钥必填，随模型账单计费 |
| Perplexity | $5/千次 | 原始结果，索引新、覆盖广 | 答案带引用，适合深度研究 | 密钥必填，Sonar 异步接口已停止支持 |
| Serper | $0.3–1/千次 | 最便宜的 Google SERP，无正文提取 | 价格最低，适合排名追踪 | 密钥必填，不含正文，合规风险自评 |
| Brave | $5/月免费额度 | 自有索引约 300 亿页，不依赖 Google/Bing | 自建索引，避免单一供应商 | 密钥必填，免费额度有限 |

## 硬约束

- Bing Search API 已关停，替代品 Grounding with Bing 只返回模型答案，不给原始结果。
- Google Custom Search JSON API 已停止接受新客户，存量客户 2027-01-01 过渡截止。
- SERP 抓取类存在法律尾部风险（如 SerpApi、Reddit 相关诉讼，未结案），合规风险自评。
- 只用一个供应商是架构缺陷：保留第二套备用检索方案，并编写降级逻辑。本插件已对各提供商并行调用并按 url 去重，任一失败自动跳过。

## 如何安装 cortico SDK

本插件不 vendored Cortico SDK（`vendor/cortico` 为空 submodule）。按模板规范编写，`tsconfig.json` 中 `cortico/*` 映射到 `../../vendor/cortico/src`，待宿主或 submodule 提供 SDK 后可直接编译运行：

```
git submodule update --init vendor/cortico
```

或按宿主指南安装 Cortico SDK。

## 如何运行

在包目录下：

```
pnpm install
pnpm test        # vitest run
pnpm typecheck   # tsc --noEmit
```

## 限制

Web 的 REST 端点按文档推断，若 Anysearch / Tavily / Exa / Bocha / 阿里 IQS / 腾讯云 / 智谱 / Perplexity / Serper / Brave 官方 REST 规范有变更，以官方为准。本插件按并行调用、按 url 去重、截断到 max_results 聚合，不保证特定提供商始终可用。
