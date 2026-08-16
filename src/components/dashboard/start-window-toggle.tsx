"use client";

import { Button } from "@/components/ui/button";
import type { ChartStartWindow } from "@/lib/config";
import { cn } from "@/lib/utils";

export interface StartWindowToggleProps {
  windows: ChartStartWindow[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Shared analysis start date. Windows come from app config
 * (config.example.json / config.local.json), not hard-coded dates.
 */
export function StartWindowToggle({
  windows,
  value,
  onChange,
  className,
}: StartWindowToggleProps) {
  if (windows.length === 0) return null;

  return (
    <div
      className={cn("bg-muted inline-flex rounded-lg p-0.5", className)}
      role="group"
      aria-label="Calculation start date"
    >
      {windows.map((w) => (
        <Button
          key={w.id}
          type="button"
          size="sm"
          variant={value === w.id ? "default" : "ghost"}
          className={cn(
            "h-7 px-2.5 text-xs sm:px-3",
            value !== w.id && "text-muted-foreground",
          )}
          onClick={() => onChange(w.id)}
          aria-pressed={value === w.id}
        >
          From {w.label}
        </Button>
      ))}
    </div>
  );
}
