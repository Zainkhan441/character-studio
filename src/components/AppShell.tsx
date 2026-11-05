import type { ReactNode } from "react";

/**
 * Character Studio — the ONE app shell for all pages.
 *
 * Figma/Linear-like top bar: logo, the five main sections, and the
 * "Add your own character" entry point. Pages pass `active` for the
 * current section (null on the homepage) and optional `actions` for
 * page-specific buttons on the right. Other agents import this exact
 * API — do not change the props.
 */
export type ShellNav = "workspace" | "characters" | "scenes" | "storyboards" | "assets";

const NAV: Array<{ id: ShellNav; label: string; href: string }> = [
  { id: "workspace", label: "Workspace", href: "/creator" },
  { id: "characters", label: "Characters", href: "/cast" },
  { id: "scenes", label: "Scenes", href: "/scenes" },
  { id: "storyboards", label: "Storyboards", href: "/story" },
  { id: "assets", label: "Assets", href: "/thumbs" },
];

export default function AppShell({
  active,
  actions,
  className,
  children,
}: {
  active?: ShellNav | null;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-h-screen flex-col bg-white text-neutral-900${className ? ` ${className}` : ""}`}>
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="/" className="shrink-0 text-lg font-bold tracking-tight">
            Character Studio
          </a>
          <nav className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap" aria-label="Main">
            <ul className="flex items-center gap-4 sm:gap-5">
              {NAV.map((item) => {
                const isActive = active === item.id;
                return (
                  <li key={item.id} className="shrink-0">
                    <a
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={
                        isActive
                          ? "border-b-2 border-neutral-900 pb-0.5 text-sm font-semibold text-neutral-900"
                          : "border-b-2 border-transparent pb-0.5 text-sm text-neutral-500 hover:text-neutral-900"
                      }
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          {/* The action cluster scrolls internally instead of widening
              the page: on a 375px phone the creator toolbar (Undo /
              Redo / zoom / Download …) plus this button is far wider
              than the viewport, and it used to push the whole document
              to 500–633px wide (QA 2026-11-05). */}
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {actions}
            <a
              href="/import"
              className="shrink-0 whitespace-nowrap rounded-md border border-neutral-900 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
            >
              ＋<span className="hidden sm:inline"> Add your own character</span>
            </a>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}
