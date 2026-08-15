/**
 * Mounts the notification watcher. Renders nothing.
 *
 * Lives inside `OSProvider` because it reads the workspace, and is mounted once
 * at the shell level so alerts fire on whichever page the user happens to be on.
 */

import { useNotifier } from "@/lib/notify/use-notifier";

export function Notifier() {
  useNotifier();
  return null;
}
