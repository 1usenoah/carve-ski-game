import { defineConfig } from 'vite';

// GitHub Pages serves this repository from `main` / (root), so the production
// bundle is emitted straight into the repository root: index.html + assets/*.
// The editable source lives in ./app, keeping the built files separate from it.
export default defineConfig({
  root: 'app',
  base: '/carve-ski-game/',
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: 5180,
  },
  build: {
    outDir: '../',
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
