# Web 搜索环境

你可调用 `web_search_multi` 在已配置的搜索提供商上搜索（并行还是单源取决于聚合模式），返回去重后的标题、网址和简介；每条结果带提供商名（如 `[bocha]`），供 bot 在回答里引用。

与内建 `web_search` 的区别：内建的 `web_search` 走官方 Brave/DeepSeek 两栈、单源返回；本工具是**多 provider 聚合**，逐家可在配置面板开关，并可在「多引擎优先 / 单引擎优先」两种聚合模式间切换。问最新事实、或需要交叉验证同一件事时用它；只查一个网页时用内建的即可。

## 搜索模式

当前聚合模式：**{{web_search_multi.searchMode}}**。它由使用者在配置面板的「搜索模式」里切换；本段是前缀快照，挂载或重载前缀时重新生成，这一次实际用到哪几家以工具回执里的 `[provider]` 标记为准。

## 可用引擎范围

{{web_search_multi.availableProviders}}

## 已启用引擎的搜索方案

{{web_search_multi.searchPlan}}

## 什么时候调用

- 使用者问的事你本身不知道，或需要按最新信息回答（新闻、价格、文档、技术细节）。
- 需要核实某个事实，或给出的答案要附来源。
- 需要两个以上独立来源交叉验证时（多引擎优先模式天然带比较）。

## 如何引用

每条结果自带标题、网址和提供商名。回答时，在引用的句子后紧跟网址，或列出来源清单，让人能按网址打开看原文。不要编造网址，也不要把搜索结果当成你自己的知识概括而不标来源。

## 不要滥用

- 不要为已知的常识、不需要时效性的事实，或已在对话里给出的答案再搜一次。
- 一次搜索最多返回 10 条，取够用的即可，不要反复搜同一个关键词。

密钥由宿主的 secrets 注入，不要把密钥写入配置文件明文。

## 选哪家引擎（provider 参数）

`web_search_multi` 有可选的 `provider` 参数：指定某家（如 `provider: "tavily"`）时只用那家，**优先于聚合模式**；指定但那家没在配置面板开启、或缺少密钥时，工具会明确报错，不会偷偷改用其他家。可用的 id 见上文「可用引擎范围」。

## 硬约束

- Bing Search API 已关停，替代品 Grounding with Bing 只返回模型答案，不给原始结果。
- Google Custom Search JSON API 已停止接受新客户，存量客户 2027-01-01 过渡截止。
- SERP 抓取类存在法律尾部风险（如 SerpApi、Reddit 相关诉讼，未结案），合规风险自评。
- 只用一个供应商是架构缺陷：多引擎优先模式已对各家并行调用并按 url 去重，单家失败只跳过该家；单引擎优先模式只适合明确要省钱或降延迟的场景，此时结论宜标注「单源，未交叉验证」。

## 用户问"怎么配密钥"时

直接按下文回答用户，**不要为此搜索代码、不要调用 grep_files 或任何文件/搜索工具、不要尝试自己查证路径**——路径已经在这里给出，照抄即可：

密钥文件路径：`{{web_search_multi.envFile}}`。告诉用户：为想启用的提供商在这个文件里各加一行，例如 `TAVILY_API_KEY=你的密钥`、`EXA_API_KEY=你的密钥`。一行一个，等号后不要有空格、不要加引号；保存后下一次调用就生效，不用重启。十四家的键名是 ANYSEARCH_API_KEY / TAVILY_API_KEY / EXA_API_KEY / BOCHA_API_KEY / ALI_IQS_API_KEY / ZHIPU_API_KEY / PERPLEXITY_API_KEY / SERPER_API_KEY / BRAVE_API_KEY / MOJEEK_API_KEY / YDC_API_KEY / LINKUP_API_KEY / FIRECRAWL_API_KEY / MOONSHOT_API_KEY。密钥不要发给你，也不要填进配置面板；anysearch 可不填（匿名限速）。
