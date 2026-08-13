import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'

// difflib (a dependency of react-gh-like-diff, coffee-script era) assigns to
// function.name, which is a read-only property. Under webpack/CJS sloppy mode
// that assignment was silently ignored; under Vite's strict-mode ESM wrapping it
// throws. Stripping the assignments is behavior-identical.
// Throws rather than silently no-opping: if a difflib bump ever changes the
// wording, the build must fail loudly instead of reintroducing the crash.
const stripDifflibNameAssignments = (code) => {
  const patched = code.replace(/\b\w+\.name\s*=\s*'\w+';?/g, ';')
  if (patched === code) {
    throw new Error(
      'patch-difflib-strict-mode: no function.name assignment found - difflib changed, re-check the patch'
    )
  }
  return patched
}

// dev: patch during esbuild dep prebundling
const esbuildPatchDifflib = {
  name: 'patch-difflib-strict-mode',
  setup(build) {
    build.onLoad({ filter: /difflib[\\/]lib[\\/]difflib\.js$/ }, async (args) => {
      const code = await fs.readFile(args.path, 'utf8')
      return { contents: stripDifflibNameAssignments(code), loader: 'js' }
    })
  }
}

// build: patch during rollup transform (enforce pre so it runs before the
// CommonJS conversion; id may carry a ?query suffix)
const rollupPatchDifflib = {
  name: 'patch-difflib-strict-mode',
  enforce: 'pre',
  transform(code, id) {
    if (/difflib[\\/]lib[\\/]difflib\.js(\?(?!commonjs-)|$)/.test(id)) {
      return { code: stripDifflibNameAssignments(code), map: null }
    }
  }
}

// The example app keeps CRA-era .js files containing JSX, so JSX parsing is
// enabled for .js below. config-editor-base is consumed through the file:..
// symlink; resolve.dedupe prevents duplicate React copies across it.
export default defineConfig({
  base: './',
  plugins: [rollupPatchDifflib, react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-redux', 'react-select']
  },
  server: {
    port: 3000,
    fs: { allow: ['..'] }
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
      plugins: [esbuildPatchDifflib]
    }
  },
  // CRA-era JSX inside .js files. Scoped to the app's own sources - the linked
  // config-editor-base/dist is plain microbundle output (no JSX), and applying
  // the jsx loader across all of node_modules risks mis-parsing dependencies.
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
    exclude: []
  }
})
