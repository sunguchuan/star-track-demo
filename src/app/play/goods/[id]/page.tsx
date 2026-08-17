import { GoodsOrderForm } from "@/components/play/goods-order-form";
import {
  getGoodsById,
  getListedGoods,
  getStreamerById,
} from "@/lib/play/catalog";
import { goodsDetails, goodsTitle } from "@/lib/play/labels";
import { brandTitle, getRequestDictionary, getRequestLocale } from "@/lib/i18n/request-locale";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return getListedGoods().map((item) => ({ id: item.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getRequestLocale();
  const t = await getRequestDictionary();
  const goods = getGoodsById(id);
  if (!goods) return { title: brandTitle(t, t.play.emptyGoods) };
  return {
    title: brandTitle(t, goodsTitle(goods.id, locale, goods.title)),
    description: goodsDetails(goods.id, locale, goods.details).slice(0, 120),
  };
}

export default async function GoodsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const goods = getGoodsById(id);
  if (!goods) notFound();
  const streamer = getStreamerById(goods.streamerId);
  if (!streamer) notFound();

  return <GoodsOrderForm goods={goods} streamer={streamer} />;
}
