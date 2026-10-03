import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Inject package.json version into the bundle at build time so the SPA can
// show it in the footer / about / system-info screens without an extra API
// round-trip. Defined as a global `__APP_VERSION__`.
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'))

export default defineConfig({
  plugins: [
    vue(),
    // On-demand auto-import for <a-*> components (ant-design-vue 4) and
    // <XxxOutlined/> icons used in templates. ant-design-vue 4 ships CSS-in-JS,
    // so no per-component style import is needed. JS APIs (message, Modal,
    // theme…) are still imported explicitly from 'ant-design-vue'.
    Components({
      dts: false,
      dirs: [],
      resolvers: [AntDesignVueResolver({ importStyle: false, resolveIcons: true })]
    })
  ],
  resolve: {
    alias: { '@': join(__dirname, 'src') }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10))
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splits — keep heavy libs in dedicated cacheable chunks
          if (id.includes('node_modules')) {
            if (id.includes('apexcharts')) return 'vendor-apexcharts'
            if (id.includes('vue3-apexcharts')) return 'vendor-apexcharts'
            if (id.includes('lucide-vue-next')) return 'vendor-icons'
            if (id.includes('@ant-design/icons')) return 'vendor-icons'
            if (id.includes('ant-design-vue') || id.includes('@ant-design') || id.includes('dayjs') || id.includes('@ctrl') || id.includes('@emotion') || id.includes('stylis')) return 'vendor-antd'
            if (id.includes('vue-router')) return 'vendor-vue'
            if (id.includes('@vue') || /\/vue\//.test(id)) return 'vendor-vue'
            return 'vendor'
          }
          // App splits — admin vs customer
          if (id.includes('/views/admin/')) return 'admin'
          if (id.includes('/views/customer/')) return 'customer'
        }
      }
    }
  }
})
