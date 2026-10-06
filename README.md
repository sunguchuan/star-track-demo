This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Hybrid AI 助手 (`/ai`)

离线优先的笔记 + 流式对话 Demo：简单任务走本地 Ollama，复杂任务可路由到云端（Gemini / OpenAI 兼容接口）。

### 前置

1. Node.js ≥ 22.13（产线数据与运行记录使用内置 `node:sqlite`）
2. 本机启动 [Ollama](https://ollama.com)，并拉取模型（默认 `gemma4:latest`）；可选 `ollama pull embeddinggemma`，用于答案缓存和本地运行时的知识库向量检索（没有它时：配了云端 Key 的话缓存改用云端向量；产线排查走本地模型时知识库检索只用 BM25）
3. 复制环境变量并按需填写：

```bash
cp .env.example .env.local
```

Gemini 示例：

```env
OPENAI_API_KEY=你的_Gemini_Key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CLOUD_MODEL=gemini-3.1-flash-lite
```

4. 打开 [http://localhost:3000/ai](http://localhost:3000/ai)（产线排查在 [`/fab`](http://localhost:3000/fab)，检索实验室在 [`/fab/knowledge`](http://localhost:3000/fab/knowledge)）

### 行为说明

- **自动路由**：总结/润色等走本地；深度分析/重构/产线排查走云端
- **环境检测**：Vercel 等线上环境默认走云端（`VERCEL=1`）；也可用 `AI_FORCE_CLOUD=1` / `AI_FORCE_LOCAL=1` 强制
- **本地不可用**：连不上 Ollama / 模型缺失时自动改走云端（需已配置 Key）
- **额度用尽 / 限流（429）/ 云端繁忙（503）**：503 先自动重试一次；仍失败时本机自动模式下提示并降级到本地；也可点「改用仅本地重试」
- **安全护栏**：拦截提示词注入和超长输入；含密码、API Key、手机号等敏感信息时改走本地，必须上云时先脱敏；按 IP 限流、整次运行超时、输出长度上限；产线排查的结论会核对是否引用了真实数据
- **笔记**：保存在浏览器 `localStorage`，刷新不丢
- **运行记录**：每次生成都会记录到 [`/ai/runs`](http://localhost:3000/ai/runs)，生成后可点「有帮助 / 没帮助」反馈
- **调用链追踪**：每次回答下方点「调用链 →」，看这次运行每一步（护栏、路由、每次模型调用、每次工具调用）的耗时、首字时间、Token 和费用；配置 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 后同时导出到 [Langfuse](https://langfuse.com)（内容已脱敏，`LANGFUSE_EXPORT_CONTENT=false` 只发指标）
- **答案缓存**：同一段文字重复总结 / 翻译直接返回上次结果；产线排查和对话里换个问法问同一件事（"B7 良率为什么下降" ≈ "B7 刻蚀腔良率下滑的原因是什么"）也直接命中，几十秒变成 1 秒内。向量跟随路由（本机 `ollama pull embeddinggemma`，线上用 `gemini-embedding-001`），并要求设备 / 批次编号、数字、变化方向、问题类型一致，B7 不会拿到 B9 的答案。结果上方有"来自缓存"标记和「重新生成」按钮；`AI_CACHE=off` 关闭
- **按难度选模型**：走云端时，多实体对比、因果关联、长输入等复杂问题的 Action Plan 交给强模型（`CLOUD_MODEL_STRONG`，Gemini 部署默认 `gemini-3.8-flash`），其余用便宜的 `CLOUD_MODEL`；便宜模型的 Action Plan 不过关（校验失败、引用不存在的编号）时自动升级强模型重写；强模型不可用时改回便宜模型并冷却 5 分钟。看板「模型分级」统计各档次数、耗时和费用
- **Prompt 压缩**：工具结果从 JSON 压成表格、按阶段裁剪 prompt，Action Plan 调用的输入 Token 约 −32%，评测质量不降（`npm run eval:prompt`；`AI_PROMPT_COMPRESSION=off` 关闭）
- **知识库检索**：产线排查可以查 `data/kb/` 里的告警手册、SOP、事故报告和设备规格，回答和 Action Plan 引用文档编号（`RB-ETCH-PARTICLE`），结果下方列出检索到的段落；段落语言跟随提问（译文在 `data/kb/i18n/`，检索仍在原文上做）。检索是 BM25 + 向量混合、RRF 融合，再由云端模型重排序并丢掉不相关的段落；本地运行只用本机向量，不调用云端。[`/fab/knowledge`](http://localhost:3000/fab/knowledge) 并排展示每个阶段的排名；`AI_RAG=off` 关闭，`AI_RAG_RERANK=off` 只关重排序
- **Token 与费用**：每次结果下方显示 Token 用量和云端费用估算（本地运行显示按云端价折算的节省）；按每次调用的模型单价计算，内置常见 Gemini 型号价格，可用 `CLOUD_PRICE_*` / `CLOUD_STRONG_PRICE_*` 覆盖
- **冷启动**：Ollama 重启后首次本地请求要加载模型，可能很慢，演示前先生成一次预热

### Vercel 部署

在项目 **Settings → Environment Variables**（Production）中配置与本地 `.env.local` 相同的：

```env
OPENAI_API_KEY=你的_Key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CLOUD_MODEL=gemini-3.1-flash-lite
```

保存后需 **Redeploy**。线上无法使用本机 Ollama；未配置 Key 时会明确报错，而不会再尝试本地模型。

线上项目目录只读，SQLite 会自动写到临时目录：产线数据每次冷启动重新生成，运行记录在冷启动后清空，线上看板仅作演示。

## FAB Ops Demo (`/fab`)

制造业 Co-pilot 路线：

- **Step 1**：SQLite 假产线数据 + `/api/fab/*` + `/fab` 页
- **Step 2**：`/fab` 页「AI 产线排查」输入框 (`investigate`) — tool-calling Agent 查批次/告警并输出 Action Plan
- **Step 3**：运行观测看板 [`/ai/runs`](http://localhost:3000/ai/runs) — 每次 AI 调用的路由、降级、首字延迟、耗时、Token 与费用、工具调用、护栏命中与用户反馈
- **Step 4**：质量评估 — 标准测试题（现 21 道）+ 规则 / 模型打分 + 回归门槛，接入 GitHub Actions CI
- **Step 4+**：结构化 Action Plan — 模型按 JSON Schema 输出（zod 校验，失败修复一次后退回文本），界面渲染成卡片：结论、现象（引用编号可核对）、原因可能性、带优先级和负责角色的动作、待确认数据；回答语言跟随提问（英文提问得到英文 Action Plan）
- **Step 5**：调用链追踪 — `/ai/runs/[id]` 瀑布图展示一次运行的完整 span 树，可选通过官方 OpenTelemetry SDK 导出到 Langfuse
- **Step 6**：答案缓存 — 相同输入 / 语义相似 + 关键词校验，阈值按向量模型校准（`npm run eval:cache`），看板显示命中率和省下的时间与费用
- **Step 6+**：按难度选模型（标准 / 强模型 + 级联升级）+ Prompt 压缩 — 输入 Token −20%，评测 17/17
- **Step 6++**：知识库检索（Advanced RAG）— 父子分块、BM25 + 向量混合、RRF、模型重排序 + 拒答；检索评测 Hit@1 96% / Recall@3 100%，知识库题开检索 4/4、关检索 0/4（[`/fab/knowledge`](http://localhost:3000/fab/knowledge)、`npm run eval:rag`）
- **Step 7**：MCP Server — 产线工具和知识库检索按 MCP 协议开放，Cursor / Claude Desktop 等客户端可以直接调用（见下方「MCP Server」）

```bash
npm run seed:fab   # 可选；首次访问也会自动写入 data/fab.db
npm run dev
```

打开 [http://localhost:3000/fab](http://localhost:3000/fab)，或调用：

- `GET /api/fab/summary`
- `GET /api/fab/batches`
- `GET /api/fab/alerts?openOnly=1`
- `GET /api/fab/knowledge`（知识库概况）、`POST /api/fab/knowledge`，body `{ "query": "...", "docType"?, "alertCode"?, "rerank"?, "language"? }`（返回每个检索阶段的排名；`language` 不填时按提问自动判断，决定段落用中文还是英文展示）

AI 排查：在 `/fab` 页的「AI 产线排查」输入框描述问题（或点示例），Ctrl + Enter 生成。

运行看板 API：

- `GET /api/ai/runs?limit=`
- `GET /api/ai/runs/:id`（运行记录 + 调用链 span）
- `POST /api/ai/runs/:id/feedback`，body `{ "score": 1 | -1 | 0 }`

### MCP Server

产线排查 Agent 用的 5 个工具（`get_fab_summary`、`list_fab_batches`、`list_fab_alerts`、`get_fab_batch`、`search_fab_knowledge`）同时作为本地 MCP Server（stdio）提供，定义、参数校验和执行都是同一份代码；全部只读。知识库的 13 篇文档另外作为资源 `kb://docs/<文档编号>` 提供（Markdown 原文）。

- **Cursor**：仓库自带 `.cursor/mcp.json`，打开项目后在 Customize 侧栏的 MCP 列表里启用 `star-track-fab`（改了服务代码后在这里关掉再打开即可重启），然后在对话里直接问（如"ETCH-RF-DRIFT 告警已经确认了，还需要处理吗"）
- **其他客户端**（Claude Desktop 等）：命令 `node --no-warnings <项目路径>/scripts/mcp/server.ts`；服务会自己切到项目目录并读取 `.env.local`
- **手动启动**：`npm run mcp`（stdout 是协议通道，日志在 stderr；Cursor 里看 Output → MCP Logs，每次调用一行：工具、耗时、引用的文档、检索各阶段耗时）
- **知识库检索走本地**：默认只用本机向量（没有 `embeddinggemma` 时只用 BM25），查询不出本机、不做重排序；`MCP_TARGET=cloud` 且配置了云端 Key 时改用云端向量 + 模型重排序
- 不需要先启动 `npm run dev`；不经过 Gateway，所以不记入 `/ai/runs`

## 测试与评估

```bash
npm test                     # 单元测试：路由、错误分类、护栏规则、Action Plan schema、计价、调用链与 Langfuse 映射、缓存、难度打分、压缩、模型分级、知识库检索、MCP Server（Node ≥ 22.18，无需模型）
npm run eval:rag             # 检索分阶段评测：28 个标注问题的 Hit@1 / Recall@k / MRR / nDCG / 拒答（--embed local|cloud，--no-rerank）
npm run eval:cache           # 缓存阈值校准（本机 Ollama embeddinggemma 和 / 或云端 Key）
npm run eval:prompt          # Prompt 压缩前后 Action Plan 调用的 prompt_tokens（需云端 Key）
npm run eval                 # 21 道标准测试题（产线排查、知识库、护栏），规则打分（先启动应用）
npm run eval -- --judge      # 再加模型打分（忠实度、要点覆盖等，需云端 Key）
npm run eval -- --guards-only  # 只跑必须被拦截的题，不调用模型
```

报告写到 `evals/results/latest.md`（含每题 Token 与费用估算）；`--save-baseline` 更新 `evals/baseline.json`。CI（`.github/workflows/ci.yml`）每次提交跑 lint、单元测试、构建和护栏冒烟；每晚 / 手动跑完整评测，需在仓库 Secrets 配置 `OPENAI_API_KEY`。

## 设计文档

- [`docs/fab-demo.md`](docs/fab-demo.md)：**从这里开始**——FAB Demo 回顾手册（数据故事、一次请求的完整流程、演示脚本、关键数字、设计取舍、代码导览）
- [`docs/ai-design.md`](docs/ai-design.md)：产品与功能（笔记助手、产线排查、运行看板），路线图在 §9
- [`docs/ai-gateway.md`](docs/ai-gateway.md)：共用 AI 调用层（路由与模型分级、降级、安全护栏、SSE 协议、运行记录与调用链追踪、答案缓存、Prompt 压缩、知识库检索、前端接入）
- [`docs/ai-eval.md`](docs/ai-eval.md)：质量评估（标准测试题、规则 / 模型打分、检索评测、回归门槛、CI）

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
