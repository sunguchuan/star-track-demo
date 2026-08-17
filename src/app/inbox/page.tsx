import { InboxPageContent } from "@/components/inbox-page-content";
import { SiteHeader } from "@/components/site-header";
import { getInbox, getPendingInboxItems } from "@/lib/inbox";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.inboxPage.title),
    description: t.inboxPage.workflowTitle,
  };
}

export default function InboxPage() {
  const inbox = getInbox();
  const pending = getPendingInboxItems();

  return (
    <>
      <SiteHeader />
      <InboxPageContent inbox={inbox} pending={pending} />
    </>
  );
}
