import { defineConfig } from 'vite'

// Bundles the shared rules (src/lib/core.ts) into one ES module the Node
// server can import, so browser and server run identical code.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'src/lib/core.ts',
    outDir: 'server/build',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'core.mjs', format: 'es' } },
  },
})
