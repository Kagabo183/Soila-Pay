export function buildCurlCommand(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): string {
  const parts = [`curl -X ${method} \\`, `  "${url}" \\`];
  for (const [key, value] of Object.entries(headers)) {
    parts.push(`  -H "${key}: ${value}" \\`);
  }
  if (body && method !== "GET") {
    const json = JSON.stringify(body).replace(/'/g, "'\\''");
    parts.push(`  -d '${json}'`);
  } else {
    parts[parts.length - 1] = parts[parts.length - 1].replace(/ \\$/, "");
  }
  return parts.join("\n");
}

export function buildRequestSummary(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): string {
  return JSON.stringify({ method, url, headers, body }, null, 2);
}
