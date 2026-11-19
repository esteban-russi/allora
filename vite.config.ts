import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {BRAND} from './src/data/brand';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // index.html cannot import BRAND, so its %APP_NAME% tokens are filled in here
      {name: 'brand-html', transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', BRAND.name)},
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
