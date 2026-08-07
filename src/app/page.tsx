import { HomePageContent } from "@/components/home-page-content";
import { getAllStars, getRecentFeed } from "@/lib/stars";

export default function HomePage() {
  const stars = getAllStars();
  const feed = getRecentFeed(10);

  return <HomePageContent stars={stars} feed={feed} />;
}
