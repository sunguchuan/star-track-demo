import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-violet-100/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-violet-950"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-sm text-white"
            aria-hidden
          >
            星
          </span>
          <span>星迹 Demo</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/"
            className="text-violet-900/70 transition-colors hover:text-violet-900"
          >
            首页
          </Link>
          <Link
            href="/stars"
            className="text-violet-900/70 transition-colors hover:text-violet-900"
          >
            明星
          </Link>
          <Link
            href="/about"
            className="text-violet-900/70 transition-colors hover:text-violet-900"
          >
            关于
          </Link>
        </nav>
      </div>
    </header>
  );
}
