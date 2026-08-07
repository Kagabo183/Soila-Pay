// Browser-side HMAC-SHA256 verification using the Web Crypto API (SubtleCrypto).
// This mirrors the server-side Node.js `crypto.createHmac("sha256", secret)`
// example shown in the Developer Portal - same algorithm, different runtime.
export async function computeHmacSha256Hex(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface VerifySignatureResult {
  valid: boolean;
  computedSignature: string;
  providedSignature: string;
}

export async function verifyWebhookSignature(
  rawPayload: string,
  secret: string,
  providedSignature: string
): Promise<VerifySignatureResult> {
  const normalizedProvided = providedSignature.trim().replace(/^sha256=/i, "");
  const computedSignature = await computeHmacSha256Hex(rawPayload, secret);
  return {
    valid:
      computedSignature.length === normalizedProvided.length &&
      timingSafeEqual(computedSignature, normalizedProvided.toLowerCase()),
    computedSignature,
    providedSignature: normalizedProvided,
  };
}

// Constant-time string comparison so verification timing doesn't leak how many
// leading characters matched.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
