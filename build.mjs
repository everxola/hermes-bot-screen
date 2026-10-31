#!/usr/bin/env node
/**
 * Build the Bot Screen dashboard plugin into ONE self-contained IIFE at
 * `dashboard/dist/index.js`:
 *
 *   • React/hooks come from the host dashboard at runtime
 *     (`window.__HERMES_PLUGIN_SDK__`) — the bundle must not ship its own copy;
 *     the `react` / `react/jsx-runtime` aliases point at thin shims.
 *   • noVNC's RFB client IS bundled: a plugin directory has no node_modules and
 *     the SDK exposes no RFB client.
 *
 * Vite (and the JSX transform) comes from the Hermes checkout's node_modules —
 * the plugin directory has none of its own. Point `HERMES_REPO` elsewhere if
 * the checkout moved, then re-run:
 *
 *   node build.mjs
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, 'src')

/**
 * Vite (and the `@novnc/novnc` sources) come from a Hermes Agent checkout —
 * this plugin has no node_modules of its own. Resolution order:
 *   1. `HERMES_REPO=/path/to/hermes-agent`
 *   2. auto-detect: this plugin sitting inside a checkout (`<repo>/plugins/...`)
 *   3. the current working directory
 */
function resolveRepo() {
  const fromEnv = (process.env.HERMES_REPO || '').trim()
  const candidates = [fromEnv, path.resolve(HERE, '../..'), path.resolve(HERE, '../../..'), process.cwd()]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (fs.existsSync(path.join(candidate, 'node_modules/vite/package.json'))) return candidate
  }
  throw new Error(
    'No Hermes Agent checkout found. Set HERMES_REPO=/path/to/hermes-agent (with node_modules installed).'
  )
}

const REPO = resolveRepo()

const require = createRequire(path.join(REPO, 'package.json'))
const { build } = await import(require.resolve('vite'))

const novnc = path.join(REPO, 'node_modules/@novnc/novnc/core/rfb.js')

/**
 * noVNC's `core/util/browser.js` ends with a TOP-LEVEL AWAIT
 * (`supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport()`),
 * and rolldown cannot put top-level await inside the IIFE a plugin must be —
 * the bundle would not build at all. The probe only feeds noVNC's WebCodecs
 * H264 decoder, which never runs against Xvnc (Raw/Tight/ZRLE), so the await is
 * replaced with the conservative `false` and the async prober treeshakes away.
 */
function novncWithoutTopLevelAwait() {
  const marker = 'supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();'
  return {
    name: 'bot-screen:novnc-without-tla',
    transform(code, id) {
      if (!id.includes('@novnc/novnc/core/util/browser.js')) return null
      if (!code.includes(marker)) return null
      return { code: code.replace(marker, 'supportsWebCodecsH264Decode = false;'), map: null }
    }
  }
}

await build({
  root: HERE,
  configFile: false,
  logLevel: 'info',
  plugins: [novncWithoutTopLevelAwait()],
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^react\/jsx-runtime$/, replacement: path.join(SRC, 'shims/jsx-runtime.ts') },
      { find: /^react$/, replacement: path.join(SRC, 'shims/react.ts') },
      { find: /^@novnc\/novnc$/, replacement: novnc }
    ]
  },
  build: {
    outDir: path.join(HERE, 'dashboard/dist'),
    emptyOutDir: false,
    minify: true,
    target: 'es2020',
    cssCodeSplit: false,
    lib: {
      entry: path.join(SRC, 'index.tsx'),
      formats: ['iife'],
      name: 'HermesBotScreenPlugin',
      fileName: () => 'index.js'
    },
    rolldownOptions: { output: { inlineDynamicImports: true } }
  }
})

console.log('✓ plugin bundle → dashboard/dist/index.js')
