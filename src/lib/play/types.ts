/** 星迹点播：商品 / 星尘 / 订单。本 Demo 不含上分代练。 */

export const PLAY_KINDS = ["seed", "challenge", "coop", "onstream"] as const;
export type PlayKind = (typeof PLAY_KINDS)[number];

export const ORDER_STATUSES = [
  "pending_accept",
  "accepted",
  "in_progress",
  "completed",
  "cancelled",
  "rejected",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FUNDS_STATUSES = ["held", "refunded", "released"] as const;
export type FundsStatus = (typeof FUNDS_STATUSES)[number];

export type CancelReason = "viewer" | "streamer" | "timeout" | "offline";

export type PlayRole = "viewer" | "streamer";

export interface GameOffer {
  game: string;
  kindPrices: Partial<Record<PlayKind, number>>;
}

export interface Streamer {
  id: string;
  slug: string;
  name: string;
  bio: string;
  live: boolean;
  acceptsPrivateOrders: boolean;
  offers: GameOffer[];
}

export interface Goods {
  id: string;
  streamerId: string;
  kind: PlayKind;
  title: string;
  game: string;
  priceTickets: number;
  details: string;
  listed: boolean;
}

export interface PlayOrder {
  id: string;
  goodsId: string | null;
  isPrivate: boolean;
  streamerId: string;
  viewerId: string;
  kind: PlayKind;
  title: string;
  game: string;
  seed?: string;
  details: string;
  priceTickets: number;
  status: OrderStatus;
  funds: FundsStatus;
  acceptBy: string;
  startBy?: string;
  cancelReason?: CancelReason;
  createdAt: string;
  updatedAt: string;
}

export interface PlayStore {
  version: 2;
  viewerId: string;
  tickets: number;
  actingStreamerId: string;
  orders: PlayOrder[];
}

export interface PlayCatalog {
  streamers: Streamer[];
  goods: Goods[];
}
