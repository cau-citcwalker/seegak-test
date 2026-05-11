import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [
        path.resolve(__dirname, '..'),
      ],
    },
  },
  optimizeDeps: {
    exclude: [
      'parquet-wasm',
      '@seegak/react',
      '@seegak/core',
      '@seegak/bio-charts',
      '@seegak/human-body-map',
      '@seegak/genomics',
      '@seegak/spatial',
      '@seegak/analysis',
      '@seegak/3d',
      '@seegak/coordination',
      '@seegak/data-loaders',
    ],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: process.env.DOCKER_BUILD
      ? {
          '@seegak/core': '/workspace/seegak/packages/core/dist/index.js',
          '@seegak/bio-charts': '/workspace/seegak/packages/bio-charts/dist/index.js',
          '@seegak/react': '/workspace/seegak/packages/react/dist/index.js',
          '@seegak/human-body-map': '/workspace/seegak/packages/human-body-map/dist/index.js',
          '@seegak/genomics': '/workspace/seegak/packages/genomics/dist/index.js',
          '@seegak/spatial': '/workspace/seegak/packages/spatial/dist/index.js',
          '@seegak/analysis': '/workspace/seegak/packages/analysis/dist/index.js',
          '@seegak/3d': '/workspace/seegak/packages/3d/dist/index.js',
          '@seegak/coordination': '/workspace/seegak/packages/coordination/dist/index.js',
          '@seegak/data-loaders': '/workspace/seegak/packages/data-loaders/dist/index.js',
        }
      : {},
  },
  build: {
    rollupOptions: {
      input: {
        main:      path.resolve(__dirname, 'index.html'),
        benchmark: path.resolve(__dirname, 'benchmark.html'),
      },
    },
  },
})
