"use client";

import * as React from "react";
import { ChevronRight, ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function valueColor(value: JsonValue): string {
  if (value === null) return "text-muted-foreground";
  switch (typeof value) {
    case "string":
      return "text-success";
    case "number":
      return "text-primary";
    case "boolean":
      return "text-warning";
    default:
      return "text-foreground";
  }
}

function formatPrimitive(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

function JsonNode({
  keyName,
  value,
  depth,
  defaultCollapsed,
}: {
  keyName?: string;
  value: JsonValue;
  depth: number;
  defaultCollapsed: boolean;
}) {
  const isObject = value !== null && typeof value === "object";
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed && depth > 0);

  if (!isObject) {
    return (
      <div className="flex" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && <span className="text-foreground/70">&quot;{keyName}&quot;: </span>}
        <span className={valueColor(value)}>{formatPrimitive(value)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, JsonValue>);
  const bracket = isArray ? ["[", "]"] : ["{", "}"];

  return (
    <div>
      <div className="flex cursor-pointer items-center" style={{ paddingLeft: depth * 16 }} onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {keyName !== undefined && <span className="text-foreground/70">&quot;{keyName}&quot;: </span>}
        <span className="text-muted-foreground">
          {bracket[0]}
          {collapsed && (
            <span className="italic"> {entries.length} {entries.length === 1 ? "item" : "items"} </span>
          )}
          {collapsed && bracket[1]}
        </span>
      </div>
      {!collapsed && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode key={k} keyName={isArray ? undefined : k} value={v} depth={depth + 1} defaultCollapsed={defaultCollapsed} />
          ))}
          <div className="text-muted-foreground" style={{ paddingLeft: depth * 16 }}>
            {bracket[1]}
          </div>
        </>
      )}
    </div>
  );
}

export interface JsonViewerProps {
  data: unknown;
  className?: string;
  collapsed?: boolean;
  showCopy?: boolean;
}

export function JsonViewer({ data, className, collapsed = false, showCopy = true }: JsonViewerProps) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={cn(
        "relative rounded-md border border-border bg-code-bg p-3 font-mono text-xs leading-relaxed text-code-foreground",
        className
      )}
    >
      {showCopy && (
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-code-foreground hover:bg-white/10"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      <div className="overflow-x-auto scrollbar-thin">
        <JsonNode value={data as JsonValue} depth={0} defaultCollapsed={collapsed} />
      </div>
    </div>
  );
}
