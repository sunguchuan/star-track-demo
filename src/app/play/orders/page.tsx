import { ViewerOrders } from "@/components/play/viewer-orders";
import { getPlayStreamers } from "@/lib/play/catalog";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.play.navOrders),
    description: t.play.emptyOrders,
  };
}

export default function PlayOrdersPage() {
  const streamers = getPlayStreamers();
  return <ViewerOrders streamers={streamers} />;
}
