export const LINKS = {
  github: "https://github.com/AntoineGaton/zerobox-cli",
  npm: "https://www.npmjs.com/package/zerobox-cli",
  docs: "https://github.com/AntoineGaton/zerobox-cli#readme",
  changelog: "https://github.com/AntoineGaton/zerobox-cli/blob/main/CHANGELOG.md",
  sponsor: "https://github.com/sponsors/AntoineGaton",
  // The buymeacoffee.com/codemonkeystudios handle is still pending; the page may 404 until it is claimed.
  coffee: "https://buymeacoffee.com/codemonkeystudios",
} as const;

/** Absolute site origin, used for Open Graph URLs. Set NEXT_PUBLIC_SITE_URL once a domain exists. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
