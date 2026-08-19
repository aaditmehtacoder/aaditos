import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  CloudOff,
  Home,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Logo } from "@/components/os/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/context";
import { relativeTimeLabel } from "@/lib/core/time";
import { useSync } from "@/lib/integrations/use-integrations";
import { useOS } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Three places, and that is the whole app.
 *
 * The previous shell had eleven destinations, a collapsible sidebar, a command
 * palette, a quick-add dialog, a notification bell and a floating assistant
 * button. Every one of them was a decision to make before doing anything, and
 * the cost showed: the pages behind most of them held no data at all.
 *
 * What is left is what gets used daily — the day, the classes, and the thing
 * that answers questions. Settings lives behind the avatar because it is
 * somewhere you go on purpose, twice a year.
 */
const NAV = [
  { to: "/", label: "Today", icon: Home },
  { to: "/classes", label: "Classes", icon: BookOpen },
  { to: "/ask", label: "Ask", icon: Sparkles },
] as const;

const TITLES: Record<string, string> = {
  "/": "Today",
  "/classes": "Classes",
  "/ask": "Ask",
  "/settings": "Settings",
};

function isActive(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Sync state, and a way to force one.
 *
 * It reads as a label rather than a button until you hover it, because the
 * honest answer is almost always "a minute ago" and nothing needs doing. The
 * button matters on the day it says something else.
 */
function SyncButton() {
  const { workspace, syncing, connection } = useOS();
  const { sync, running } = useSync();
  const lastRun = workspace.syncRuns[0];
  const busy = syncing || running;

  const label = busy
    ? "Syncing…"
    : connection === "offline"
      ? "Offline"
      : lastRun?.finishedAt
        ? `Synced ${relativeTimeLabel(lastRun.finishedAt)}`
        : "Sync now";

  return (
    <button
      type="button"
      onClick={() => void sync(["wilcox", "weather", "google"])}
      disabled={busy || connection === "offline"}
      title="Refresh classes, calendars and weather"
      className="flex items-center gap-1.5 rounded-[9px] px-2 py-1.5 text-[11.5px] text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:opacity-60"
    >
      {connection === "offline" ? (
        <CloudOff className="size-[13px] shrink-0 text-warning" aria-hidden />
      ) : (
        <RefreshCw className={cn("size-[13px] shrink-0", busy && "animate-spin")} aria-hidden />
      )}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );
}

function Avatar({ name, url }: { name: string; url?: string | undefined }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={26}
        height={26}
        className="size-[26px] shrink-0 rounded-full border border-border object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-[26px] shrink-0 place-items-center rounded-full border border-border bg-card text-[10.5px] font-semibold"
    >
      {initials || "A"}
    </span>
  );
}

function ProfileMenu() {
  const { profile, isDemo, theme, setTheme } = useOS();
  const { signOut } = useAuth();
  const themes = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "System", icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account and preferences"
          className="grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors duration-150 hover:bg-secondary"
        >
          <Avatar name={profile.name} url={profile.avatarUrl} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[12.5px]">
          <span className="block truncate font-medium">{profile.name || "Signed in"}</span>
          <span className="block truncate text-[11.5px] font-normal text-muted-foreground">
            {isDemo ? "Demo mode · sample data" : profile.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themes.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setTheme(option.value)}
            className="text-[12.5px]"
          >
            <option.icon className="size-[14px]" />
            {option.label}
            {theme === option.value ? (
              <span className="ml-auto text-[11px] text-muted-foreground">Active</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-[12.5px]">
          <Link to="/settings">
            <Settings className="size-[14px]" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()} className="text-[12.5px]">
          <LogOut className="size-[14px]" />
          {isDemo ? "Leave demo mode" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OfflineBanner() {
  const { connection, pendingWrites } = useOS();
  if (connection === "online") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-[12px] text-warning-strong"
    >
      <CloudOff className="size-3.5 shrink-0" aria-hidden />
      <span>
        Offline. Changes are saved on this device
        {pendingWrites > 0 ? ` · ${pendingWrites} waiting to sync` : ""}.
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { workspace } = useOS();
  const title = TITLES[pathname] ?? (pathname.startsWith("/classes/") ? "Class" : "AaditOS");

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", workspace.preferences.reducedMotion);
  }, [workspace.preferences.reducedMotion]);

  useEffect(() => {
    document.title = `${title} · AaditOS`;
  }, [title]);

  // Heights are dvh, not vh: in tablet mode a Chromebook's on-screen keyboard
  // shrinks the viewport, and vh keeps reporting the taller pre-keyboard value.
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      <a
        href="#main"
        className="sr-only-focusable focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:h-auto focus:w-auto focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-[12.5px] focus:shadow"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur lg:px-6">
        <Logo />

        {/* The tabs live up here on a wide screen and along the bottom on a
            phone, where the thumb is. Same three destinations either way. */}
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-[9px] px-3 py-1.5 text-[13px] transition-colors duration-150",
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <item.icon className="size-[15px]" strokeWidth={1.8} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <SyncButton />
          <ProfileMenu />
        </div>
      </header>

      <OfflineBanner />

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 sm:pb-10 lg:px-6">
        {children}
      </main>

      <nav
        aria-label="Primary"
        className="sticky bottom-0 z-20 grid grid-cols-3 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        {NAV.map((item) => {
          const active = isActive(pathname, item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[10.5px] transition-colors duration-150",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
