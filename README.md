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
2. 本机启动 [Ollama](https://ollama.com)，并拉取模型（默认 `gemma4:latest`）
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

4. 打开 [http://localhost:3000/ai](http://localhost:3000/ai)

### 行为说明

- **自动路由**：总结/润色等走本地；深度分析/重构/产线排查走云端
- **环境检测**：Vercel 等线上环境默认走云端（`VERCEL=1`）；也可用 `AI_FORCE_CLOUD=1` / `AI_FORCE_LOCAL=1` 强制
- **本地不可用**：连不上 Ollama / 模型缺失时自动改走云端（需已配置 Key）
- **额度用尽 / 限流（429）/ 云端繁忙（503）**：503 先自动重试一次；仍失败时本机自动模式下提示并降级到本地；也可点「改用仅本地重试」
- **安全护栏**：拦截提示词注入和超长输入；含密码、API Key、手机号等敏感信息时改走本地，必须上云时先脱敏；按 IP 限流、整次运行超时、输出长度上限；产线排查的结论会核对是否引用了真实数据
- **笔记**：保存在浏览器 `localStorage`，刷新不丢
- **运行记录**：每次生成都会记录到 [`/ai/runs`](http://localhost:3000/ai/runs)，生成后可点「有帮助 / 没帮助」反馈
- **Token 与费用**：每次结果下方显示 Token 用量和云端费用估算（本地运行显示按云端价折算的节省）；默认按 `gemini-3.1-flash-lite` 官方价，可用 `CLOUD_PRICE_INPUT_PER_M` / `CLOUD_PRICE_OUTPUT_PER_M` 覆盖
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
- **Step 4**：质量评估 — 17 道标准测试题 + 规则 / 模型打分 + 回归门槛，接入 GitHub Actions CI
- **Step 4+**：结构化 Action Plan — 模型按 JSON Schema 输出（zod 校验，失败修复一次后退回文本），界面渲染成卡片：结论、现象（引用编号可核对）、原因可能性、带优先级和负责角色的动作、待确认数据；回答语言跟随提问（英文提问得到英文 Action Plan）

```bash
npm run seed:fab   # 可选；首次访问也会自动写入 data/fab.db
npm run dev
```

打开 [http://localhost:3000/fab](http://localhost:3000/fab)，或调用：

- `GET /api/fab/summary`
- `GET /api/fab/batches`
- `GET /api/fab/alerts?openOnly=1`

AI 排查：在 `/fab` 页的「AI 产线排查」输入框描述问题（或点示例），Ctrl + Enter 生成。

运行看板 API：

- `GET /api/ai/runs?limit=`
- `POST /api/ai/runs/:id/feedback`，body `{ "score": 1 | -1 | 0 }`

## 测试与评估

```bash
npm test                     # 单元测试：路由、错误分类、护栏规则、Action Plan schema、计价（Node ≥ 22.18，无需模型）
npm run eval                 # 17 道产线排查标准测试题，规则打分（先启动应用）
npm run eval -- --judge      # 再加模型打分（忠实度、要点覆盖等，需云端 Key）
npm run eval -- --guards-only  # 只跑必须被拦截的题，不调用模型
```

报告写到 `evals/results/latest.md`（含每题 Token 与费用估算）；`--save-baseline` 更新 `evals/baseline.json`。CI（`.github/workflows/ci.yml`）每次提交跑 lint、单元测试、构建和护栏冒烟；每晚 / 手动跑完整评测，需在仓库 Secrets 配置 `OPENAI_API_KEY`。

## 设计文档

- [`docs/ai-design.md`](docs/ai-design.md)：产品与功能（笔记助手、产线排查、运行看板），路线图在 §9
- [`docs/ai-gateway.md`](docs/ai-gateway.md)：共用 AI 调用层（路由、降级、安全护栏、SSE 协议、运行记录、前端接入）
- [`docs/ai-eval.md`](docs/ai-eval.md)：质量评估（标准测试题、规则 / 模型打分、回归门槛、CI）

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
