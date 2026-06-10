/**
 * Parses CORS origins from env:
 * - CORS_ORIGINS: comma-separated list (e.g. http://localhost:5173,https://app.vercel.app)
 * - CLIENT_ORIGIN: single dev origin fallback
 * - VERCEL_ORIGIN | VERCEL_URL: production Vercel app origin (scheme required)
 */
export function resolveCorsOrigins() {
  const fromList = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);

  /** @type {Set<string>} */
  const origins = new Set(fromList ?? []);

  if (process.env.CLIENT_ORIGIN?.trim()) {
    origins.add(process.env.CLIENT_ORIGIN.trim());
  }
  if (!origins.has('http://localhost:5173')) {
    origins.add('http://localhost:5173');
  }

  const vercelOrigin = normalizeUrl(
    process.env.VERCEL_ORIGIN || process.env.VERCEL_URL
  );
  if (vercelOrigin) origins.add(vercelOrigin);

  const list = [...origins];
  return list.length ? list : ['http://localhost:5173'];
}

function normalizeUrl(value) {
  if (!value || !String(value).trim()) return '';
  const v = String(value).trim();
  if (/^https?:\/\//i.test(v)) return v.replace(/\/$/, '');
  return `https://${v.replace(/^\/*/, '').replace(/\/$/, '')}`;
}
