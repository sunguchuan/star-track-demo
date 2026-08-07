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

1. 本机启动 [Ollama](https://ollama.com)，并拉取模型（默认 `gemma4:latest`）
2. 复制环境变量并按需填写：

```bash
cp .env.example .env.local
```

Gemini 示例：

```env
OPENAI_API_KEY=你的_Gemini_Key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CLOUD_MODEL=gemini-3.1-flash-lite
```

3. 打开 [http://localhost:3000/ai](http://localhost:3000/ai)

### 行为说明

- **自动路由**：总结/润色等走本地；深度分析/重构走云端
- **环境检测**：Vercel 等线上环境默认走云端（`VERCEL=1`）；也可用 `AI_FORCE_CLOUD=1` / `AI_FORCE_LOCAL=1` 强制
- **本地不可用**：连不上 Ollama / 模型缺失时自动改走云端（需已配置 Key）
- **额度用尽 / 限流（429）**：本机自动模式下会提示并降级到本地；也可点「改用仅本地重试」
- **笔记**：保存在浏览器 `localStorage`，刷新不丢

### Vercel 部署

在项目 Environment Variables 中配置 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`CLOUD_MODEL`（与本地 `.env.local` 相同）。线上无法使用本机 Ollama。

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
