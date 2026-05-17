import { SiteHeader } from "@/components/site-header";
import Link from "next/link";

export const metadata = {
  title: "关于 | 星迹 Demo",
  description: "星迹 Demo 免责声明与内测说明",
};

export default function AboutPage() {
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

        <h1 className="text-2xl font-bold text-violet-950">关于本站</h1>
        <p className="mt-2 text-sm text-violet-700/80">内测 Demo · 非官方粉丝站</p>

        <div className="mt-6 space-y-4 text-sm leading-relaxed text-zinc-700">
          <p>
            「星迹 Demo」用于向周围朋友展示明星基本资料与动态时间线的原型，不代表任何艺人、经纪公司或官方粉丝组织。
          </p>
          <p>
            本站信息由站长从公开、可核实的来源摘编整理，每条动态均标注出处链接。若您认为内容有误或侵犯权益，欢迎联系更正或删除。
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>不收录非公开的住址、行程、家庭隐私等信息</li>
            <li>不组织集资、打榜、代刷等第三方平台操作</li>
            <li>图片与封面尽量使用文字头像或外链，避免未经授权托管</li>
            <li>当前为免费浏览版；未来若上线会员功能，将另行说明</li>
          </ul>
          <p className="rounded-xl bg-violet-50 px-4 py-3 text-violet-900">
            数据维护：编辑 <code>content/stars/*.json</code>{" "}
            后重新构建或刷新开发服务器即可更新页面。
          </p>
        </div>
      </main>
    </>
  );
}
