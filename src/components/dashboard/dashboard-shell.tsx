import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

export interface DashboardShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Top-level layout shell for the investing dashboard.
 * New pages/views can reuse this without reworking chart modules.
 */
export function DashboardShell({
  title,
  subtitle,
  children,
}: DashboardShellProps) {
  return (
    <div className="bg-background min-h-full">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
            investing
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>
      <Separator />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
