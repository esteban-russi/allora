/** URLs for the static legal pages across Vite dev and production Express builds. */

export type LegalPage = 'privacy' | 'terms' | 'delete-account';

/**
 * Return the path to a static legal page.
 *
 * Production serves extensionless routes via Express; Vite dev serves the
 * `.html` files directly from `public/` so the SPA fallback does not intercept them.
 *
 * Args:
 *   name: Legal page identifier.
 *   isDev: Override for dev-mode detection (defaults to `import.meta.env.DEV`).
 *
 * Returns:
 *   `/<name>` in production builds, or `/<name>.html` in development.
 */
export function legalUrl(name: LegalPage, isDev: boolean = Boolean(import.meta.env.DEV)): string {
  return isDev ? `/${name}.html` : `/${name}`;
}
