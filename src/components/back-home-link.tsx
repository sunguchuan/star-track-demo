"use client";

import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";

export function BackHomeLink() {
  const { t } = useLocale();
  return (
    <Link href="/" className="mb-4 inline-flex text-sm text-violet-700 hover:underline">
      {t.common.backHome}
    </Link>
  );
}
