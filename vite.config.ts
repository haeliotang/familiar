import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local-assets/**', '**/.local-db/**', '**/.models/**'] },
    proxy: { '/v1': 'http://127.0.0.1:3001' },
  },
})
