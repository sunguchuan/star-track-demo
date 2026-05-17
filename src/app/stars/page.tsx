import { SiteHeader } from "@/components/site-header";
import { StarCard } from "@/components/star-card";
import { getAllStars } from "@/lib/stars";
import Link from "next/link";

export const metadata = {
  title: "全部明星 | 星迹 Demo",
  description: "浏览已收录的内娱艺人资料与动态",
};

export default function StarsIndexPage() {
  const stars = getAllStars();

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

        <h1 className="text-2xl font-bold tracking-tight text-violet-950">
          全部明星
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          共收录 {stars.length} 位艺人
        </p>

        <ul className="mt-6 space-y-3">
          {stars.map((star) => (
            <li key={star.id}>
              <StarCard star={star} />
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
