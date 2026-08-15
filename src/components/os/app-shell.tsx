import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  CloudOff,
  FolderGit2,
  Inbox,
  Layers,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeft,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Target,
  Timer,
  Wifi,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { CommandPalette } from "@/components/os/command-palette";
import { Kbd } from "@/components/os/kbd";
import { Logo } from "@/components/os/logo";
import { CompassDock } from "@/components/os/compass-dock";
import { QuickAdd } from "@/components/os/quick-add";
import { Pill } from "@/components/os/primitives";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth/context";
import { relativeTimeLabel } from "@/lib/core/time";
import { useOS, useUnreadNotifications } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Four screens, not eleven.
 *
 * Everything still exists and every old URL still resolves — Projects,
 * Opportunities and Inbox simply live *inside* their parent screen now, reached
 * by the sub-tabs in `SUB_NAV`. Eleven top-level destinations meant scanning a
 * list to find anything; four means you already know where to look.
 *
 * Focus, Notifications, Integrations and Settings moved to the profile menu:
 * they are places you go occasionally and on purpose, not part of the daily loop.
 */
const NAV = [
  { to: "/", label: "Today", icon: Layers, mobile: true },
  { to: "/school", label: "School", icon: CalendarDays, mobile: true },
  { to: "/tasks", label: "Work", icon: CheckSquare, mobile: true },
  { to: "/compass", label: "Compass", icon: Sparkles, mobile: true },
] as const;

/**
 * The routes grouped under each screen. The first entry is the screen itself,
 * so a sub-tab bar only appears where there is genuinely more than one place to
 * be — Today and School render none.
 */
const SUB_NAV: Record<string, ReadonlyArray<{ to: string; label: string }>> = {
  "/tasks": [
    { to: "/tasks", label: "Tasks" },
    { to: "/projects", label: "Projects" },
    { to: "/opportunities", label: "Opportunities" },
  ],
  "/compass": [
    { to: "/compass", label: "Ask" },
    { to: "/inbox", label: "Inbox" },
  ],
};

/** Which top-level screen a path belongs to, for highlighting the sidebar. */
function screenFor(pathname: string): string {
  for (const [screen, items] of Object.entries(SUB_NAV)) {
    if (items.some((i) => i.to === pathname || pathname.startsWith(`${i.to}/`))) return screen;
  }
  return pathname;
}

const TITLES: Record<string, string> = {
  ...Object.fromEntries(NAV.map((n) => [n.to, n.label])),
  // Reached from the profile menu or a sub-tab; each still needs a header title.
  "/projects": "Projects",
  "/opportunities": "Opportunities",
  "/inbox": "Inbox",
  "/focus": "Focus",
  "/notifications": "Notifications",
  "/integrations": "Integrations",
  "/settings": "Settings",
};

const SIDEBAR_KEY = "aaditos:sidebar-collapsed";

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // A sub-route like /projects has to light up its parent screen, which
  // `activeProps` cannot express — it only ever matches the link's own path.
  const active = screenFor(pathname);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const isActive = active === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-[13px] transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground",
              collapsed && "justify-center px-0",
              isActive ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-[15px] shrink-0" strokeWidth={1.8} aria-hidden />
            {/*
              Collapsed, the label still has to exist for anything that is not a
              hovering mouse: `title` alone never appears on a touchscreen and is
              not a reliable accessible name. Matches how SyncButton does it.
            */}
            {collapsed ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span className="truncate">{item.label}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Sub-tabs for a screen that contains more than one page. Rendered directly
 * under the header so the grouped pages read as one destination rather than
 * three separate ones hidden in a sidebar.
 */
function SubNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = SUB_NAV[screenFor(pathname)];
  if (!items) return null;

  return (
    <nav aria-label="Section" className="flex gap-1 border-b border-border px-4 pb-2 pt-1 lg:px-6">
      {items.map((item) => {
        const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-[8px] px-2.5 py-1.5 text-[12.5px] transition-colors duration-150",
              isActive
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SyncButton({ collapsed }: { collapsed: boolean }) {
  const { connection, syncing, pendingWrites, workspace } = useOS();
  const lastRun = workspace.syncRuns[0];

  const label = syncing
    ? "Syncing…"
    : connection === "offline"
      ? pendingWrites > 0
        ? `Offline · ${pendingWrites} queued`
        : "Offline — saved on this device"
      : lastRun?.finishedAt
        ? `Synced ${relativeTimeLabel(lastRun.finishedAt)}`
        : "Not synced yet";

  return (
    <Link
      to="/integrations"
      title={collapsed ? label : undefined}
      className={cn(
        "mb-1 flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {connection === "offline" ? (
        <CloudOff className="size-[13px] shrink-0 text-warning" aria-hidden />
      ) : syncing ? (
        <RefreshCw className="size-[13px] shrink-0 animate-spin" aria-hidden />
      ) : (
        <Wifi className="size-[13px] shrink-0 text-success" aria-hidden />
      )}
      {!collapsed ? (
        <span className="truncate">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </Link>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { profile, isDemo } = useOS();

  return (
    <div className="mt-auto border-t border-sidebar-border px-2 py-2.5">
      <SyncButton collapsed={collapsed} />
      <div
        className={cn(
          "flex items-center gap-2 rounded-[9px] px-2.5 py-1.5",
          collapsed && "justify-center px-0",
        )}
      >
        <Avatar name={profile.name} url={profile.avatarUrl} />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium">{profile.name || "Signed in"}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {isDemo ? "Demo mode" : profile.email}
            </p>
          </div>
        ) : null}
      </div>
    </div>
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
        width={24}
        height={24}
        className="size-6 shrink-0 rounded-full border border-sidebar-border object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-full border border-sidebar-border bg-card text-[10.5px] font-semibold"
    >
      {initials || "A"}
    </span>
  );
}

function ThemeMenuItems() {
  const { theme, setTheme } = useOS();
  const options = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "System", icon: Monitor },
  ];
  return (
    <>
      {options.map((option) => (
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
    </>
  );
}

function ProfileMenu() {
  const { profile, isDemo } = useOS();
  const { signOut } = useAuth();
  const unreadCount = useUnreadNotifications().length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Profile and preferences"
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
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-[12.5px]">
          <Link to="/focus">
            <Timer className="size-[14px]" />
            Focus
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-[12.5px]">
          <Link to="/notifications">
            <Bell className="size-[14px]" />
            Notifications
            {unreadCount > 0 ? (
              <span className="ml-auto rounded-md bg-urgent-soft px-1.5 text-[10.5px] font-medium tabular-nums text-urgent">
                {unreadCount}
              </span>
            ) : null}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-[12.5px]">
          <Link to="/settings">
            <Settings className="size-[14px]" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-[12.5px]">
          <Link to="/integrations">
            <Plug className="size-[14px]" />
            Integrations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="text-[12.5px]">
          <LogOut className="size-[14px]" />
          {isDemo ? "Leave demo mode" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TopBar({ title }: { title: string }) {
  const { setPaletteOpen, setQuickAddOpen, isDemo } = useOS();
  const unread = useUnreadNotifications().length;

  return (
    <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav />
        {/* A location label, not a section heading — the page owns its h1. */}
        <span className="truncate text-[13px] font-medium">{title}</span>
        {isDemo ? (
          <Pill
            tone="primary"
            className="hidden sm:inline-flex"
            title="Sample data — no provider is connected"
          >
            Demo data
          </Pill>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden h-8 w-52 items-center gap-2 rounded-[9px] border border-border bg-card px-2.5 text-left text-[12.5px] text-muted-foreground transition-colors duration-150 hover:border-foreground/20 md:flex xl:w-64"
        >
          <Search className="size-[14px]" aria-hidden />
          <span className="truncate">Search everything</span>
          <Kbd className="ml-auto">K</Kbd>
        </button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 md:hidden"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search"
        >
          <Search className="size-[15px]" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12.5px]" asChild>
          <Link to="/compass">
            <Sparkles className="size-[14px]" aria-hidden />
            <span className="hidden sm:inline">Ask Compass</span>
            <span className="sr-only sm:hidden">Ask Compass</span>
          </Link>
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[12.5px]"
          onClick={() => setQuickAddOpen(true)}
        >
          <Plus className="size-[14px]" aria-hidden />
          <span className="hidden sm:inline">Quick add</span>
          <span className="sr-only sm:hidden">Quick add</span>
        </Button>
        <Button size="icon" variant="ghost" className="relative size-8" asChild>
          <Link
            to="/notifications"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          >
            <Bell className="size-[15px]" />
            {unread > 0 ? (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-urgent"
              />
            ) : null}
          </Link>
        </Button>
        <ProfileMenu />
      </div>
    </header>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8 lg:hidden" aria-label="Open menu">
          <Menu className="size-[16px]" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[250px] bg-sidebar p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-full flex-col">
          <div className="px-4 py-3.5">
            <Logo />
          </div>
          <NavList collapsed={false} onNavigate={() => setOpen(false)} />
          <SidebarFooter collapsed={false} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BottomNav() {
  const unread = useUnreadNotifications().length;
  return (
    <nav
      aria-label="Primary mobile"
      className="sticky bottom-0 z-20 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {NAV.filter((n) => n.mobile).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.to === "/" }}
          className="flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground transition-colors duration-150"
          activeProps={{ className: "text-foreground font-medium", "aria-current": "page" }}
        >
          <span className="relative">
            <item.icon className="size-[17px]" strokeWidth={1.8} aria-hidden />
            {item.label === "Compass" && unread > 0 ? null : null}
          </span>
          {item.label}
        </Link>
      ))}
    </nav>
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
        You are offline. Changes are saved on this device
        {pendingWrites > 0 ? ` · ${pendingWrites} queued to sync` : ""}.
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = TITLES[pathname] ?? (pathname.startsWith("/projects/") ? "Project" : "AaditOS");
  const { workspace } = useOS();

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", workspace.preferences.reducedMotion);
  }, [workspace.preferences.reducedMotion]);

  const toggleSidebar = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  // Heights are dvh, not vh: in tablet mode a Chromebook's on-screen keyboard
  // shrinks the viewport, and vh keeps reporting the taller pre-keyboard value.
  return (
    <div className="flex min-h-dvh w-full bg-background">
      <a
        href="#main"
        className="sr-only-focusable focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:h-auto focus:w-auto focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-[12.5px] focus:shadow"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-[60px]" : "w-[216px]",
        )}
      >
        <div
          className={cn("flex items-center gap-2 px-4 py-3.5", collapsed && "justify-center px-0")}
        >
          <Logo compact={collapsed} />
          {!collapsed ? (
            <button
              type="button"
              aria-label="Collapse sidebar"
              onClick={() => toggleSidebar(true)}
              className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground"
            >
              <ChevronLeft className="size-[14px]" />
            </button>
          ) : null}
        </div>
        {collapsed ? (
          <button
            type="button"
            aria-label="Expand sidebar"
            onClick={() => toggleSidebar(false)}
            className="mx-auto mb-1 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeft className="size-[14px]" />
          </button>
        ) : null}
        <NavList collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <SubNav />
        <OfflineBanner />
        {/*
          The bottom padding clears the floating Compass button, which would
          otherwise sit on top of the last row of whatever page is open. It is
          skipped on /compass, where the dock renders nothing — reserving space
          for an absent button there would push that page's fixed-height
          composer off the bottom of the screen.
        */}
        <main
          id="main"
          className={cn(
            "min-w-0 flex-1 px-4 pt-5 lg:px-6",
            pathname === "/compass" ? "pb-5" : "pb-20",
          )}
        >
          {children}
        </main>
        <BottomNav />
      </div>

      <CommandPalette />
      <QuickAdd />
      <CompassDock />
    </div>
  );
}
