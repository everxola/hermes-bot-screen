# Third-party notices

`dashboard/dist/index.js` is a single bundled file. It contains the plugin's own
code (MIT — see `LICENSE`) **plus** a minified copy of the noVNC RFB client,
which is distributed under its own license and is **not** relicensed by this
repository.

## noVNC (`@novnc/novnc`) 1.7.0

- Upstream: https://github.com/novnc/noVNC
- License: **MPL-2.0** (Mozilla Public License 2.0) — https://www.mozilla.org/en-US/MPL/2.0/
- Bundled files: `core/rfb.js` and the modules it imports (`core/*`, `core/util/*`,
  `core/decoders/*`, `vendor/pako/*`), reached through the `@novnc/novnc` alias in
  `build.mjs`. The only source transformation applied is replacing one top-level
  `await` in `core/util/browser.js` with `false` (an IIFE bundle cannot contain
  top-level await); the WebCodecs H.264 probe that await guards is never used
  against an Xvnc server.
- noVNC source is available upstream and from the npm package
  `@novnc/novnc@1.7.0`. If you need a build that is MIT-only, remove the
  `@novnc/novnc` alias and supply your own RFB client.

## React

Not bundled. The plugin consumes the host dashboard's React instance through
`window.__HERMES_PLUGIN_SDK__` at runtime; the `react` and `react/jsx-runtime`
aliases in `build.mjs` point at thin shims in `src/shims/`.
