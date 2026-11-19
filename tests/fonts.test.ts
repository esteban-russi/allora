/** Tests verifying self-hosted Fontsource fonts and removal of Google Fonts links. */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

describe('self-hosted fonts', () => {
  it('removes third-party Google Fonts requests from index.html', () => {
    const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('imports self-hosted Fontsource packages in src/main.tsx', () => {
    const main = fs.readFileSync(path.join(rootDir, 'src', 'main.tsx'), 'utf8');
    expect(main).toContain("'@fontsource-variable/fraunces/opsz.css'");
    expect(main).toContain("'@fontsource-variable/inter'");
    expect(main).toContain("'@fontsource/jetbrains-mono/400.css'");
    expect(main).toContain("'@fontsource/jetbrains-mono/500.css'");
  });

  it('matches Fontsource font-family names in src/index.css', () => {
    const css = fs.readFileSync(path.join(rootDir, 'src', 'index.css'), 'utf8');
    expect(css).toContain("--font-sans: 'Inter Variable'");
    expect(css).toContain("--font-serif: 'Fraunces Variable'");
    expect(css).toContain("--font-mono: 'JetBrains Mono'");
  });
});
