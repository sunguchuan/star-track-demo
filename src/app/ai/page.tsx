import { AiChatPanel } from "@/components/ai-chat-panel";
import { SiteHeader } from "@/components/site-header";
import Link from "next/link";

export const metadata = {
  title: "混合 AI 助手 | 星迹 Demo",
  description: "本地 Ollama + 云端路由的流式笔记助手 Demo",
};

export default function AiPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
        <Link
          href="/"
          className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
        >
          ← 返回首页
        </Link>

        <h1 className="text-2xl font-bold text-violet-950">混合 AI 助手</h1>
        <p className="mt-1 text-sm text-zinc-600">
          笔记保存在本机浏览器。本机开发默认走{" "}
          <code className="rounded bg-violet-50 px-1 text-xs">gemma4</code>
          ；线上或 Ollama 不可用时自动改走云端。
        </p>

        <div className="mt-6">
          <AiChatPanel />
        </div>
      </main>
    </>
  );
}
