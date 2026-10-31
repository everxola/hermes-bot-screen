# Bot Screen — Hermes dashboard plugin

**See and drive your agent's headless desktop without leaving Hermes.** No extra
port, no second login: a **Screen tab** and a **dock under the chat** both ride
the official `display.*` RPC and the authenticated `/api/display/ws` RFB bridge.

It is the same screen the agent's `computer_use` tools drive — so you can watch
it work, grab the mouse when it stalls, and hand control straight back.

Watching is **read-only**. **Take over** hands you the mouse, keyboard and
clipboard while the agent's own screen actions stay paused; **Hand back**
returns control to the agent. Control is arbitrated by the backend lease — the
same one the Desktop app uses — so two viewers (or a viewer and the agent)
never type at the same time.

Nothing runs in the agent runtime: `provides_hooks` and `provides_tools` are
empty, and the plugin registers **no backend route**. It only calls the
dashboard's existing auth-gated endpoints, so the login gate, the lease
arbitration and the agent fence stay exactly the official ones.

## Features

| | |
|---|---|
| Watch | live RFB stream, fit-to-window or 1:1 with drag-to-pan |
| Control | Take over / Hand back (force hand-back for a stuck lease) |
| Input | pointer, wheel, keyboard, Esc/Tab/Enter/Backspace/Super/arrow key row |
| Clipboard | desktop → browser chip with one-click copy; browser → desktop text box (CJK safe, 256 KB cap) |
| Quality | Auto (adaptive), Low bandwidth, Balanced, Sharp |
| HUD | approximate update rate (frame starts/s) and bandwidth |
| Extras | PNG screenshot, fullscreen, reconnect, start/stop the desktop |
| i18n | English + 简体中文, following the dashboard locale |

The pane stops its RFB stream when it is not visible (unless it holds the
lease, so navigation never silently drops control) and re-attaches with the
same viewer identity when it comes back.

## Requirements

- A Hermes Agent build that exposes the `display.*` methods and the
  `/api/display/ws` bridge.
- A Linux gateway host with the headless desktop stack installed (Xvnc + a
  desktop session). On other hosts the tab renders a "not supported" state.
- **Desktop clipboard round trip:** the VNC server must run with
  `-SendCutText=1`. Upstream defaults to `0`; with the default, the desktop
  clipboard chip never appears (watching and control still work).

## Install

```bash
git clone https://github.com/everxola/hermes-bot-screen.git \
  "$HERMES_HOME/plugins/bot-screen"
hermes plugins enable bot-screen      # user plugins only load when listed
```

Restart the dashboard, then open **Screen** in the tab bar (or expand the strip
under the chat terminal).

`dashboard/dist/index.js` and `dashboard/dist/style.css` are committed, so the
plugin works without a build step.

## Build from source

The bundle is built by Vite **from a Hermes Agent checkout** — the plugin has no
`node_modules` of its own, and React comes from the host at runtime
(`window.__HERMES_PLUGIN_SDK__`) rather than being bundled.

```bash
HERMES_REPO=/path/to/hermes-agent node build.mjs
# or, with the plugin inside the checkout, just: node build.mjs
```

`build.mjs` resolves the checkout in this order: `$HERMES_REPO` →
`<plugin>/../..` → `../../..` → the current directory. It bundles
`@novnc/novnc`'s RFB client (a plugin directory cannot `import` from the app's
`node_modules` at runtime) and rewrites one noVNC top-level `await` that an
IIFE bundle cannot contain.

## Layout

```
plugin.yaml                 CLI identity (name / version / description / license)
build.mjs                   node build.mjs → dashboard/dist/index.js (single IIFE)
src/index.tsx               registers the /screen tab and the chat:bottom slot
src/viewer.tsx              watch / take over / hand back / fit / fullscreen / reconnect
src/display.ts              display.* over /api/ws + ticket + /api/display/ws + close codes
src/sha256.ts               pure-JS SHA-256 (no crypto.subtle outside secure contexts)
src/copy.ts                 zh + en copy (SDK locale)
src/shims/react.ts          forwards to the host SDK's React (never bundle a second copy)
src/shims/jsx-runtime.ts    jsx/jsxs/jsDEV → SDK React.createElement
dashboard/manifest.json     tab path /screen (after:chat), slots ["chat:bottom"], entry + css
dashboard/dist/             built bundle + plugin CSS
```

## Notes for future edits

- **Layout lives in `dashboard/dist/style.css`**, not in utility classes: the
  dashboard's compiled Tailwind only contains the classes its own source uses.
  Theme via the host's `--color-*` variables (with fallbacks).
- **React comes from `window.__HERMES_PLUGIN_SDK__`**; the build aliases
  `react` / `react/jsx-runtime` to the shims. Bundling React would break hooks.
- **Input authority is the backend lease**, never `viewOnly` alone; the viewer
  still sets `viewOnly` to suppress stray local input. Consequence worth
  remembering: noVNC drops `ServerCutText` while view-only, so the desktop
  clipboard only surfaces to the viewer that **holds** the lease.
- `showDotCursor` plus the fullscreen `cursor: none` fallback keep a pointer on
  screen — noVNC hides the local cursor whenever it has no remote cursor image.
- Bridge close codes are meaningful: `4000` another viewer took the lease,
  `4001` desktop gone, `4401` stale ticket (re-observe and reattach), `4403`
  host/origin policy refused the upgrade.

## Security model

- The plugin adds no route, no port and no server code. Every call goes through
  the dashboard's existing authenticated surfaces (`/api/ws` JSON-RPC and a
  single-use `/api/display/ws` ticket minted by `display.observe`).
- The profile scope it speaks for is resolved the same way the dashboard
  resolves its own (`?profile=` → launcher-selected profile → served profile),
  so the pane can never show one profile's desktop while the rest of the UI
  edits another.
- `viewer_id` is minted per attach; the lease only compares
  `sha256(viewer_id)[:12]`, so the raw id never travels on lease broadcasts.
- No telemetry, no third-party network calls. The only outbound traffic is to
  the dashboard origin that served the page.

## Sanitization note

This repository is the published, de-identified copy of a locally developed
plugin. Before publishing:

- the hard-coded local Hermes checkout path in `build.mjs` was replaced by
  `$HERMES_REPO` with auto-detection;
- internal file/symbol pointers in comments (private module paths and line
  references) were generalised to their public equivalents;
- author metadata in `plugin.yaml` was replaced with the public profile;
- the tree was scanned for credentials, tokens, hostnames, LAN addresses and
  personal paths — none are present, and none were removed silently.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 everxola.

`dashboard/dist/index.js` bundles [noVNC](https://github.com/novnc/noVNC)
(`@novnc/novnc`, MPL-2.0). That bundled code is **not** covered by the MIT
grant; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## 中文

**Bot Screen** 是 Hermes Dashboard 的插件：把当前 profile 的无头 Bot Desktop
（也就是 Agent 的 `computer_use` 工具操作的那块屏幕）直接搬到网页里。

- 两个入口：`/screen` 独立页面，以及聊天终端下方的可折叠桌面条（`chat:bottom`）。
- 默认**只读观看**；点「接管」后鼠标、键盘、剪贴板归你，Agent 的屏幕操作暂停；
  点「交还」还给 Agent。控制权由后端 lease 仲裁，不会两边同时输入。
- 数据面完全复用官方的 `display.*` RPC 和鉴权的 `/api/display/ws`（单次 ticket），
  插件不新增任何路由、端口或服务端代码。
- 需要：暴露 `display.*` 的 Hermes 版本 + Linux 网关主机上的 Xvnc 桌面栈。
  桌面剪贴板互通需要 VNC 启动参数 `-SendCutText=1`。

安装：

```bash
git clone https://github.com/everxola/hermes-bot-screen.git "$HERMES_HOME/plugins/bot-screen"
hermes plugins enable bot-screen
```

`dashboard/dist/` 已随仓库提供，无需构建即可使用；改动源码后
`HERMES_REPO=/path/to/hermes-agent node build.mjs` 重新打包。

许可证：MIT（见 `LICENSE`）；打包进 `dist/index.js` 的 noVNC 仍属 MPL-2.0
（见 `THIRD_PARTY_NOTICES.md`）。
