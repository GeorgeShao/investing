"use client";

import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { cn } from "@/lib/utils";

const GEIST_FALLBACK =
  '"Geist", "Geist Sans", ui-sans-serif, system-ui, sans-serif';

export interface EChartsWrapperProps {
  option: EChartsOption;
  className?: string;
  height?: number | string;
  loading?: boolean;
  /** Accessibility label for the chart container. */
  ariaLabel?: string;
}

/**
 * Thin client-only ECharts shell. New charts should pass a typed option
 * built in pure helpers (src/lib/series.ts) or view-specific builders.
 */
export function EChartsWrapper({
  option,
  className,
  height = 380,
  loading = false,
  ariaLabel = "Chart",
}: EChartsWrapperProps) {
  const [fontFamily, setFontFamily] = useState(GEIST_FALLBACK);

  useEffect(() => {
    // next/font assigns a hashed family on body; canvas must use that name.
    const bodyFont = getComputedStyle(document.body).fontFamily;
    if (bodyFont) setFontFamily(bodyFont);
  }, []);

  const style = useMemo(
    () => ({
      height: typeof height === "number" ? `${height}px` : height,
      width: "100%",
    }),
    [height],
  );

  const optionWithFont = useMemo(
    () => ({
      ...option,
      textStyle: {
        fontFamily,
        ...(option.textStyle ?? {}),
      },
    }),
    [option, fontFamily],
  );

  return (
    <div
      className={cn("w-full min-w-0 font-sans", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <ReactECharts
        option={optionWithFont}
        style={style}
        notMerge
        lazyUpdate
        showLoading={loading}
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}
