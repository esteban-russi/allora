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
  };
});
