import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    https: false,
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
