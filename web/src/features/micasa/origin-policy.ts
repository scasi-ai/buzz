const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isAllowedMiCasaOrigin(
  origin: URL,
  production: boolean,
): boolean {
  if (!production) return true;
  if (origin.protocol === "https:") return true;
  return origin.protocol === "http:" && LOOPBACK_HOSTNAMES.has(origin.hostname);
}
