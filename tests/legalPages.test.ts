/** Tests for static legal pages and the legalUrl helper. */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/data/brand';
import { legalUrl, type LegalPage } from '../src/utils/legalUrl';

const publicDir = path.resolve(__dirname, '..', 'public');
const LEGAL_PAGES: LegalPage[] = ['privacy', 'terms', 'delete-account'];

describe('legalUrl', () => {
  it('returns extensionless paths in production and .html paths in dev', () => {
    for (const page of LEGAL_PAGES) {
      expect(legalUrl(page, false)).toBe(`/${page}`);
      expect(legalUrl(page, true)).toBe(`/${page}.html`);
    }
  });
});

describe('static legal pages', () => {
  it.each(LEGAL_PAGES)('ships public/%s.html with draft banner, brand details, and back link', (page) => {
    const html = fs.readFileSync(path.join(publicDir, `${page}.html`), 'utf8');

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('DRAFT – not yet reviewed');
    expect(html).toContain('href="/"');
    expect(html).toContain(BRAND.name);
    expect(html).toContain(BRAND.supportEmail);
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });
});
