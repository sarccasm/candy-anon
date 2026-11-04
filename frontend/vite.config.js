import {fileURLToPath} from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: { rollupOptions: { input: { main: "index.html", admin: "admin.html" } } },
  server: {
    fs: {strict:true,allow:[fileURLToPath(new URL('.',import.meta.url))],deny:['.env','.env.*','**/.git/**','**/.local/**','**/*.pem','**/*.key','**/*.pfx']},
    port: 5173,
    https: false,
    proxy: {
      '/api': {
        target: process.env.LOCAL_API_TARGET || 'http://localhost:7071',
        changeOrigin: true,
        secure: true,
        ...(process.env.LOCAL_API_KEY?{headers:{'x-local-api-key':process.env.LOCAL_API_KEY}}:{})
      }
    }
  }
});
