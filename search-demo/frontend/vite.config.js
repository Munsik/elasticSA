import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // .env 파일을 프로젝트 루트(frontend/)가 아닌 상위 디렉터리(search-demo/)에서 읽음
  envDir: resolve(__dirname, '..'),
})
