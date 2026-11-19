/** Tests for the web manifest, app icons, and index.html metadata links. */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/data/brand';

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

/** Read width and height from a PNG IHDR chunk. */
function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  // PNG signature is 8 bytes, IHDR length (4) + type (4), then 4-byte width + 4-byte height
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('web manifest and icons', () => {
  it('defines a valid manifest with Allora branding and existing icons', () => {
    const raw = fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8');
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe(BRAND.name);
    expect(manifest.short_name).toBe(BRAND.shortName);
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#FCFCFC');
    expect(manifest.theme_color).toBe('#FCFCFC');
    expect(manifest.icons).toEqual([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);

    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(publicDir, icon.src.replace(/^\//, '')))).toBe(true);
    }
  });

  it('ships placeholder SVG and PNG icons with the expected dimensions', () => {
    const svg = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');
    expect(svg).toContain('#256EFF');
    expect(svg).toContain('#FCFCFC');

    expect(readPngDimensions(path.join(publicDir, 'icon-192.png'))).toEqual({ width: 192, height: 192 });
    expect(readPngDimensions(path.join(publicDir, 'icon-512.png'))).toEqual({ width: 512, height: 512 });
    expect(readPngDimensions(path.join(publicDir, 'icon-maskable-512.png'))).toEqual({ width: 512, height: 512 });
    expect(readPngDimensions(path.join(publicDir, 'apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
    expect(readPngDimensions(path.join(publicDir, 'og-image.png'))).toEqual({ width: 1200, height: 630 });
  });

  it('links favicon, apple-touch-icon, manifest, and og:image in index.html', () => {
    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<meta property="og:image" content="/og-image.png" />');
  });
});
