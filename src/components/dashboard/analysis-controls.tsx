"use client";

import { StartWindowToggle } from "@/components/dashboard/start-window-toggle";
import type { ChartStartWindow } from "@/lib/config";

export interface AnalysisControlsProps {
  windows: ChartStartWindow[];
  start: string;
  onStartChange: (start: string) => void;
}

/**
 * Single analysis-start control for You vs opponent, value, flows, P&L,
 * weights, and the forecast historical-rate chip.
 */
export function AnalysisControls({
  windows,
  start,
  onStartChange,
}: AnalysisControlsProps) {
  if (windows.length === 0) return null;
  return (
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
      <StartWindowToggle
        windows={windows}
        value={start}
        onChange={onStartChange}
      />
    </div>
  );
}
