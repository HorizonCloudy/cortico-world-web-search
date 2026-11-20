# Web 搜索环境

你可调用 `web_search_multi` 在多个搜索提供商上并行搜索，返回去重后的标题、网址和简介；每条结果带提供商名（如 `[bocha]`），供 bot 在回答里引用。

与内建 `web_search` 的区别：内建的 `web_search` 走官方 Brave/DeepSeek 两栈、单源返回；本工具是**多 provider 聚合**，同时问多家、跨源按 url 去重、逐家可在配置面板开关。问最新事实、或需要交叉验证同一件事时用它；只查一个网页时用内建的即可。

## 什么时候调用

- 使用者问的事你本身不知道，或需要按最新信息回答（新闻、价格、文档、技术细节）。
- 需要核实某个事实，或给出的答案要附来源。
- 需要两个以上独立来源交叉验证时（多源头返回天然带比较）。

## 如何引用

每条结果自带标题、网址和提供商名。回答时，在引用的句子后紧跟网址，或列出来源清单，让人能按网址打开看原文。不要编造网址，也不要把搜索结果当成你自己的知识概括而不标来源。

## 不要滥用

- 不要为已知的常识、不需要时效性的事实，或已在对话里给出的答案再搜一次。
- 一次搜索最多返回 10 条，取够用的即可，不要反复搜同一个关键词。

密钥由宿主的 secrets 注入，不要把密钥写入配置文件明文。

## 选哪家引擎（provider 参数）

`web_search_multi` 有可选的 `provider` 参数：不指定时并行调用所有已开启且已配密钥的引擎；指定某家（如 `provider: "tavily"`）时只用那家；指定但那家没在面板开启、或缺密钥时，工具会明确报错，不会偷偷改用其他家。可用的 id 见配置面板的提供商列表。

## 参与聚合的提供商

按配置面板的逐家开关生效；没配密钥的提供商在运行时自动跳过。

- anysearch：匿名可用（限速较低），配 `ANYSEARCH_API_KEY` 后额度更大。
- tavily：`TAVILY_API_KEY`，Agent 原生，含 extract/crawl/map。
- exa：`EXA_API_KEY`，向量语义检索，擅长探索式查询。
- bocha：`BOCHA_API_KEY`，中文场景覆盖广、延迟低。
- ali（阿里 IQS）：`ALI_IQS_API_KEY`，国内访问稳定。
- zhipu：`ZHIPU_API_KEY`，聚合多家引擎，随模型账单计费。
- perplexity：`PERPLEXITY_API_KEY`，索引新，摘要可能为空串。
- serper：`SERPER_API_KEY`，最便宜的 Google SERP，无正文提取。
- brave：`BRAVE_API_KEY`，自有索引，不依赖 Google/Bing。
- mojeek：`MOJEEK_API_KEY`，独立欧洲索引，可作为非 Google/Bing 系的补充源。
- youcom：`YDC_API_KEY`，Web + News 双源（YDC / You.com 索引）。
- linkup：`LINKUP_API_KEY`，agentic search，适合需要推理式检索的查询。
- firecrawl：`FIRECRAWL_API_KEY`，垂类索引（research/pdf/developer/gov）。
- kimi：`MOONSHOT_API_KEY`，国内直连，Moonshot 工具搜索。

价格、定位与硬约束见包内 README 的表；它们不进模型上下文。

## 硬约束

- Bing Search API 已关停，替代品 Grounding with Bing 只返回模型答案，不给原始结果。
- Google Custom Search JSON API 已停止接受新客户，存量客户 2027-01-01 过渡截止。
- SERP 抓取类存在法律尾部风险（如 SerpApi、Reddit 相关诉讼，未结案），合规风险自评。
- 只用一个供应商是架构缺陷：本插件已对各提供商并行调用并按 url 去重，单家失败只跳过该家。

## 用户问"怎么配密钥"时

直接按下文回答用户，**不要为此搜索代码、不要调用 grep_files 或任何文件/搜索工具、不要尝试自己查证路径**——路径已经在这里给出，照抄即可：

密钥文件路径：`{{web_search_multi.envFile}}`。告诉用户：为想启用的提供商在这个文件里各加一行，例如 `TAVILY_API_KEY=你的密钥`、`EXA_API_KEY=你的密钥`。一行一个，等号后不要有空格、不要加引号；保存后下一次调用就生效，不用重启。十四家的键名是 ANYSEARCH_API_KEY / TAVILY_API_KEY / EXA_API_KEY / BOCHA_API_KEY / ALI_IQS_API_KEY / ZHIPU_API_KEY / PERPLEXITY_API_KEY / SERPER_API_KEY / BRAVE_API_KEY / MOJEEK_API_KEY / YDC_API_KEY / LINKUP_API_KEY / FIRECRAWL_API_KEY / MOONSHOT_API_KEY。密钥不要发给你，也不要填进配置面板；anysearch 可不填（匿名限速）。
