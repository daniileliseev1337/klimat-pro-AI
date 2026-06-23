/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Идентификатор сборки — дата/время по МСК. Меняется при каждом build, поэтому
// видимая в шапке метка позволяет мгновенно понять, актуальна ли загруженная версия.
const BUILD_ID = (() => {
  const d = new Date(Date.now() + 3 * 3600 * 1000); // UTC+3 (МСК)
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
})();

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      injectManifest: { swSrc: 'src/sw.js', swDest: 'dist/sw.js' },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
