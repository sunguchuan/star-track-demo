import { PlayHall } from "@/components/play/play-hall";
import { getPlayCatalog } from "@/lib/play/catalog";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.play.title),
    description: t.play.subtitle,
  };
}

export default function PlayHallPage() {
  const { streamers, goods } = getPlayCatalog();
  return <PlayHall streamers={streamers} goods={goods} />;
}
