"use client";

import { PlayProvider, usePlay } from "@/lib/play/play-context";
import { heldTickets, REDEEM_AMOUNT } from "@/lib/play/storage";
import type { Streamer } from "@/lib/play/types";
import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function PlayChrome({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const { ready, store, redeemTickets } = usePlay();
  const copy = t.play;

  const held = ready ? heldTickets(store.orders) : 0;

  const links = [
    { href: "/play", label: copy.navHall, match: (p: string) => p === "/play" || p.startsWith("/play/goods") },
    {
      href: "/play/orders",
      label: copy.navOrders,
      match: (p: string) => p.startsWith("/play/orders"),
    },
    {
      href: "/play/studio",
      label: copy.navStudio,
      match: (p: string) => p.startsWith("/play/studio"),
    },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
      <Link
        href="/"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {copy.backHome}
      </Link>

      <h1 className="text-2xl font-bold tracking-tight text-violet-950">
        {copy.title}
      </h1>
      <p className="mt-1 text-sm text-zinc-600">{copy.subtitle}</p>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-violet-100 bg-white px-3 py-2.5">
        <p className="text-sm text-violet-950">
          {copy.ticketsLabel}{" "}
          <span className="font-semibold">
            {ready ? store.tickets : "—"}
          </span>
          {held > 0 && (
            <span className="ml-2 text-xs font-normal text-amber-800">
              {copy.heldLabel} {held}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => redeemTickets()}
          disabled={!ready}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {copy.redeem} +{REDEEM_AMOUNT}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
        {copy.ticketHint}
      </p>

      <nav className="mt-4 flex gap-1 rounded-xl bg-violet-50 p-1 text-sm">
        {links.map((link) => {
          const active = link.match(pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex-1 rounded-lg px-2 py-1.5 text-center ${
                active
                  ? "bg-white font-medium text-violet-950"
                  : "text-violet-800/70 hover:text-violet-950"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">{ready ? children : (
        <p className="text-sm text-zinc-500">{copy.loading}</p>
      )}</div>
    </main>
  );
}

export function PlayShell({
  streamers,
  children,
}: {
  streamers: Streamer[];
  children: ReactNode;
}) {
  return (
    <PlayProvider streamers={streamers}>
      <PlayChrome>{children}</PlayChrome>
    </PlayProvider>
  );
}
