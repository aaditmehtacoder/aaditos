import { createFileRoute } from "@tanstack/react-router";

import { MailApp, type MailSearch } from "@/components/mail/mail-app";
import type { Category, FolderId } from "@/lib/mail/api";

const FOLDERS = new Set<FolderId>([
  "inbox",
  "starred",
  "important",
  "sent",
  "drafts",
  "all",
  "spam",
  "trash",
]);
const CATEGORIES = new Set<Category>(["primary", "promotions", "social", "updates", "forums"]);

export const Route = createFileRoute("/email")({
  head: () => ({ meta: [{ title: "Email" }] }),
  // Folder, tab, search and the open conversation live in the address, so
  // Back closes a conversation and a refresh lands where you were.
  validateSearch: (search: Record<string, unknown>): MailSearch => {
    const out: MailSearch = {};
    const str = (key: string) =>
      typeof search[key] === "string" ? (search[key] as string) : undefined;
    const folder = str("folder");
    if (folder && FOLDERS.has(folder as FolderId)) out.folder = folder as FolderId;
    const cat = str("cat");
    if (cat && CATEGORIES.has(cat as Category)) out.cat = cat as Category;
    const q = str("q");
    if (q) out.q = q.slice(0, 500);
    const thread = str("thread");
    const inAccount = str("in");
    if (thread && inAccount) {
      out.thread = thread;
      out.in = inAccount;
    }
    const account = str("account");
    if (account) out.account = account;
    return out;
  },
  component: EmailPage,
});

function EmailPage() {
  return <MailApp search={Route.useSearch()} />;
}
