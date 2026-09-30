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
- **额度用尽 / 限流（429）**：本机自动模式下会提示并降级到本地；也可点「改用仅本地重试」
- **笔记**：保存在浏览器 `localStorage`，刷新不丢
- **运行记录**：每次生成都会记录到 [`/ai/runs`](http://localhost:3000/ai/runs)，生成后可点「有帮助 / 没帮助」反馈
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
- **Step 2**：AI 页任务「产线排查」(`investigate`) — tool-calling Agent 查批次/告警并输出 Action Plan
- **Step 3**：运行观测看板 [`/ai/runs`](http://localhost:3000/ai/runs) — 每次 AI 调用的路由、降级、首字延迟、耗时、工具调用与用户反馈

```bash
npm run seed:fab   # 可选；首次访问也会自动写入 data/fab.db
npm run dev
```

打开 [http://localhost:3000/fab](http://localhost:3000/fab)，或调用：

- `GET /api/fab/summary`
- `GET /api/fab/batches`
- `GET /api/fab/alerts?openOnly=1`

AI 排查：打开 [http://localhost:3000/ai](http://localhost:3000/ai)，选 **产线排查**，描述问题后生成。

运行看板 API：

- `GET /api/ai/runs?limit=`
- `POST /api/ai/runs/:id/feedback`，body `{ "score": 1 | -1 | 0 }`

完整设计见 [`docs/ai-design.md`](docs/ai-design.md)（路线图在 §10）。

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
