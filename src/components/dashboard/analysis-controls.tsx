"use client";

import { StartWindowToggle } from "@/components/dashboard/start-window-toggle";
import { Button } from "@/components/ui/button";
import type { ChartStartWindow } from "@/lib/config";
import type { SleeveOption } from "@/lib/sleeves";
import { cn } from "@/lib/utils";

export interface AnalysisControlsProps {
  windows: ChartStartWindow[];
  start: string;
  onStartChange: (start: string) => void;
  sleeves?: SleeveOption[];
  sleeveId?: string;
  onSleeveChange?: (id: string) => void;
}

/**
 * Single analysis-start (and sleeve) control for You vs opponent, value,
 * flows, P&L, weights, and the forecast historical-rate chip.
 */
export function AnalysisControls({
  windows,
  start,
  onStartChange,
  sleeves = [],
  sleeveId,
  onSleeveChange,
}: AnalysisControlsProps) {
  if (windows.length === 0 && sleeves.length <= 1) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Analysis window
          </p>
          <p className="text-muted-foreground max-w-xl text-sm">
            One start for You vs opponent, portfolio value, cash flows, monthly
            P&amp;L, position weights, and the forecast rate.
          </p>
        </div>
        {windows.length > 0 ? (
          <StartWindowToggle
            windows={windows}
            value={start}
            onChange={onStartChange}
          />
        ) : null}
      </div>
      {sleeves.length > 1 && onSleeveChange ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Sleeve
          </span>
          <div
            className="bg-muted inline-flex flex-wrap rounded-lg p-0.5"
            role="group"
            aria-label="Account sleeve"
          >
            {sleeves.map((s) => (
              <Button
                key={s.id}
                type="button"
                size="sm"
                variant={s.id === sleeveId ? "default" : "ghost"}
                className={cn(
                  "h-7 px-2.5 text-xs",
                  s.id !== sleeveId && "text-muted-foreground",
                )}
                onClick={() => onSleeveChange(s.id)}
                aria-pressed={s.id === sleeveId}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
