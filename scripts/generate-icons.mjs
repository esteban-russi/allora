/** Generate PNG app icons and Open Graph image from public/favicon.svg. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const faviconPath = path.join(publicDir, 'favicon.svg');

const CANVAS = '#FCFCFC';
const COBALT = '#256EFF';
const INK = '#1B1725';
const LINE = '#E8E8EE';

const faviconSvg = fs.readFileSync(faviconPath);

async function generateIcons() {
  await sharp(faviconSvg, { density: 300 })
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'));

  await sharp(faviconSvg, { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'));

  await sharp(faviconSvg, { density: 300 })
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  // Maskable icons need the artwork inside the central 80% safe circle
  await sharp(faviconSvg, { density: 300 })
    .resize(340, 340)
    .extend({ top: 86, bottom: 86, left: 86, right: 86, background: CANVAS })
    .png()
    .toFile(path.join(publicDir, 'icon-maskable-512.png'));

  // 1200x630 Open Graph card: monogram badge + "Allora" wordmark
  const monogramBuf = await sharp(faviconSvg, { density: 300 })
    .resize(180, 180)
    .png()
    .toBuffer();

  const ogBaseSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="${CANVAS}" />
    <rect x="235" y="210" width="210" height="210" rx="44" fill="${CANVAS}" stroke="${LINE}" stroke-width="4" />
    <text
      x="491"
      y="366"
      font-family="Georgia, 'Times New Roman', serif"
      font-size="148"
      font-weight="600"
      letter-spacing="-2"
      fill="${COBALT}"
    >Allora</text>
    <text
      x="495"
      y="418"
      font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
      font-size="28"
      fill="${INK}"
      fill-opacity="0.6"
    >Conversational Italian tutor</text>
  </svg>`);

  await sharp(ogBaseSvg)
    .composite([{ input: monogramBuf, left: 250, top: 225 }])
    .png()
    .toFile(path.join(publicDir, 'og-image.png'));
}

generateIcons().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
