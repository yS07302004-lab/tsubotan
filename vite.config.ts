import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'draco/*'],
      manifest: {
        name: 'ツボ単（肺経デモ）',
        short_name: 'ツボ単',
        description: '経穴を3Dで見て覚える図鑑アプリ',
        lang: 'ja',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f3ee',
        theme_color: '#2f5d50',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,glb,json,wasm}'],
        // 大きい層（全身の筋・動脈、目印の強調）はインストール時には入れず、初めて表示したときにキャッシュする
        globIgnores: ['**/models/muscles.glb', '**/models/arteries.glb', '**/models/structures.glb'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*\.glb$/,
            handler: 'CacheFirst',
            options: { cacheName: 'models', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
});
