"use client";

import * as React from "react";
import { Copy, ScrollText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/store/toast-store";
import { formatTime } from "@/lib/utils";
import type { DdinDiagnosticsResult } from "@/services/ddin-diagnostics.service";

export interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  operation: string;
  durationMs: number | null;
  correlationId: string;
  result: string;
}

export function resultToLogEntries(result: DdinDiagnosticsResult): LogEntry[] {
  return result.steps.map((step) => ({
    timestamp: step.startedAt,
    level: step.status === "FAIL" ? "ERROR" : step.status === "SKIPPED" ? "WARN" : "INFO",
    operation: step.step,
    durationMs: step.latencyMs,
    correlationId: step.correlationId,
    result: step.status,
  }));
}

function formatLogsAsText(entries: LogEntry[]): string {
  return entries
    .map(
      (e) =>
        `${e.timestamp}\t${e.level}\t${e.operation}\t${e.durationMs !== null ? `${Math.round(e.durationMs)}ms` : "-"}\t${e.correlationId}\t${e.result}`
    )
    .join("\n");
}

export function LogViewer({ runs }: { runs: DdinDiagnosticsResult[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const allEntries = runs.flatMap(resultToLogEntries);
  const visible = expanded ? allEntries : allEntries.slice(0, 8);

  function copyAll() {
    navigator.clipboard?.writeText(formatLogsAsText(allEntries));
    toast({ title: "Logs copied to clipboard", description: `${allEntries.length} entries`, variant: "default" });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Run Log
          </CardTitle>
          <Button variant="outline" size="sm" onClick={copyAll} disabled={allEntries.length === 0}>
            <Copy className="h-3.5 w-3.5" /> Copy Logs
          </Button>
        </div>
        <CardDescription>Every step from every run this session - for pasting into a support ticket.</CardDescription>
      </CardHeader>
      <CardContent>
        {allEntries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No runs yet this session.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Time</th>
                  <th className="py-1.5 pr-3 font-medium">Level</th>
                  <th className="py-1.5 pr-3 font-medium">Operation</th>
                  <th className="py-1.5 pr-3 font-medium">Duration</th>
                  <th className="py-1.5 pr-3 font-medium">Correlation ID</th>
                  <th className="py-1.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-muted-foreground">
                      {formatTime(e.timestamp)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge
                        variant={e.level === "ERROR" ? "destructive" : e.level === "WARN" ? "warning" : "info"}
                        dot={false}
                      >
                        {e.level}
                      </StatusBadge>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-foreground">{e.operation}</td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground">
                      {e.durationMs !== null ? `${Math.round(e.durationMs)}ms` : "-"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground">{e.correlationId}</td>
                    <td className="py-1.5 font-mono text-foreground">{e.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allEntries.length > 8 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                {expanded ? "Show less" : `Show all ${allEntries.length} entries`}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
