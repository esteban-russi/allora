/** Footer links to the Privacy Policy and Terms of Service, opening in a new tab. */
import React from 'react';
import { legalUrl } from '../utils/legalUrl';

export interface LegalLinksProps {
  className?: string;
}

/**
 * Render "Privacy" and "Terms" links that open in a new browser tab.
 *
 * Args:
 *   className: Optional extra classes for the container.
 */
export const LegalLinks: React.FC<LegalLinksProps> = ({ className = '' }) => (
  <nav
    aria-label="Legal"
    className={`flex items-center justify-center gap-2 text-xs text-ink-muted ${className}`.trim()}
  >
    <a
      href={legalUrl('privacy')}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-ink transition-colors"
    >
      Privacy
    </a>
    <span aria-hidden="true">·</span>
    <a
      href={legalUrl('terms')}
      target="_blank"
      rel="noopener noreferrer"
      className="underline hover:text-ink transition-colors"
    >
      Terms
    </a>
  </nav>
);
