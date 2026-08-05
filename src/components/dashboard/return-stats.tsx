import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatPercent,
  type ReturnStats,
  type YearlyReturnRow,
} from "@/lib/performance";

export interface ReturnStatsPanelProps {
  stats: ReturnStats;
  yearly: YearlyReturnRow[];
}

export function ReturnStatsPanel({ stats, yearly }: ReturnStatsPanelProps) {
  const items: Array<{
    title: string;
    value: string;
    blurb: string;
  }> = [
    {
      title: "TWRR (total)",
      value: formatPercent(stats.twrrTotal),
      blurb: "Time-weighted: product of monthly (1+r). Skill-style, less timing bias.",
    },
    {
      title: "CAGR (ann.)",
      value: formatPercent(stats.cagr),
      blurb: `Annualized from linked TWRR over ${stats.monthCount} months with returns.`,
    },
    {
      title: "MWRR (total)",
      value: formatPercent(stats.mwrrTotal),
      blurb: "Money-weighted IRR of external flows + start/end value (timing matters).",
    },
    {
      title: "MWRR (ann.)",
      value: formatPercent(stats.mwrrAnnualized),
      blurb: "Monthly IRR annualized as (1+r_m)¹² − 1.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          External deposits/withdrawals only (internal transfers excluded).
          Monthly granularity.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <Card key={item.title}>
              <CardHeader className="pb-2">
                <CardDescription>{item.title}</CardDescription>
                <CardTitle className="text-2xl tabular-nums tracking-tight">
                  {item.value}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {item.blurb}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {yearly.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">By calendar year</p>
          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="bg-muted/50 border-b text-left">
                  <th className="text-muted-foreground px-3 py-2 font-medium">
                    Year
                  </th>
                  <th className="text-muted-foreground px-3 py-2 font-medium">
                    TWRR
                  </th>
                  <th className="text-muted-foreground px-3 py-2 font-medium">
                    MWRR
                  </th>
                  <th className="text-muted-foreground px-3 py-2 font-medium">
                    Months
                  </th>
                </tr>
              </thead>
              <tbody>
                {yearly.map((row) => (
                  <tr
                    key={row.year}
                    className="border-border border-b last:border-0"
                  >
                    <td className="px-3 py-2 tabular-nums">
                      {row.year}
                      {row.isPartial ? (
                        <span className="text-muted-foreground ml-1 text-xs">
                          (partial)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatPercent(row.twrr)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatPercent(row.mwrr)}
                    </td>
                    <td className="text-muted-foreground px-3 py-2 tabular-nums">
                      {row.monthCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
