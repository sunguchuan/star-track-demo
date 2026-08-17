import { PlayShell } from "@/components/play/play-shell";
import { SiteHeader } from "@/components/site-header";
import { getPlayStreamers } from "@/lib/play/catalog";

export default function PlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const streamers = getPlayStreamers();

  return (
    <>
      <SiteHeader />
      <PlayShell streamers={streamers}>{children}</PlayShell>
    </>
  );
}
