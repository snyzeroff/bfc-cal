/**
 * Public origin of the site, used in subscription addresses and feed links.
 * APP_URL wins; on Vercel we fall back to the project's production domain so
 * links are still correct if the variable was not set.
 */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  const raw = explicit || (vercel ? `https://${vercel}` : "http://localhost:3000");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}
