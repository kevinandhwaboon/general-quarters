import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { entryFileNames: 'assets/game.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } },
  },
});
