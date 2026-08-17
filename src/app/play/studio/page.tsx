import { StudioBoard } from "@/components/play/studio-board";
import { getPlayCatalog } from "@/lib/play/catalog";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.play.navStudio),
    description: t.play.subtitle,
  };
}

export default function PlayStudioPage() {
  const { streamers, goods } = getPlayCatalog();
  return <StudioBoard streamers={streamers} goods={goods} />;
}
