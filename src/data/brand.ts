/** The product's name and contact details, shared by the client and the server. */

/**
 * Brand values shown to learners and given to the tutor.
 *
 * Static files that cannot import this module and so carry the name themselves:
 * `index.html` (filled in at build time by the `brand-html` plugin in `vite.config.ts`),
 * `metadata.json` and `public/manifest.webmanifest`.
 *
 * Attributes:
 *   name: Full product name, used in page titles, prompts and the store listing.
 *   shortName: Shown in the header and other tight spaces.
 *   premiumName: Name of the paid plan.
 *   supportEmail: Where learners can reach support.
 */
export const BRAND = {
  name: 'Allora',
  shortName: 'Allora',
  premiumName: 'Allora Premium',
  supportEmail: 'estebangr2711@gmail.com'
} as const;
