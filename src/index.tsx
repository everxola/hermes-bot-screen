/**
 * Bot Screen — dashboard plugin entry.
 *
 * Registers:
 *   • the `/screen` tab  — the viewer page (manifest declares the path/icon);
 *   • the `chat:bottom` slot — a collapsible desktop strip under the chat
 *     terminal, so the conversation and the agent's screen sit together.
 *
 * The bundle ships no React: everything comes from the host dashboard's plugin
 * SDK. `register()` must run within ~2s of the script loading.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { screenCopy } from './copy'
import { screenHref, type DisplayStatus } from './display'
import { readSetting, writeSetting } from './storage'
import { BotScreenPane, DOCK_DEFAULT_PX } from './viewer'

/* eslint-disable @typescript-eslint/no-explicit-any -- host SDK is untyped */

interface PluginSdk {
  components: Record<string, any>
  utils: { cn: (...args: any[]) => string }
  useI18n?: () => { locale?: string }
}

interface PluginRegistry {
  register: (name: string, component: unknown) => void
  registerSlot: (name: string, slot: string, component: unknown) => void
}

const SDK = (window as unknown as { __HERMES_PLUGIN_SDK__?: PluginSdk }).__HERMES_PLUGIN_SDK__
const REGISTRY = (window as unknown as { __HERMES_PLUGINS__?: PluginRegistry }).__HERMES_PLUGINS__

const PLUGIN = 'bot-screen'

function useCopy() {
  const i18n = SDK?.useI18n ? SDK.useI18n() : undefined
  return useMemo(() => screenCopy(i18n?.locale), [i18n?.locale])
}

/** `/screen` — the full viewer page. */
function ScreenPage() {
  const s = useCopy()
  // The pane owns the polling, so it reports the status up for this header.
  const [status, setStatus] = useState<DisplayStatus | null>(null)
  const onStatus = useCallback((next: DisplayStatus | null) => setStatus(next), [])

  return (
    <div className="hermes-bot-screen-page">
      <div className="hermes-bot-screen-head">
        <div className="hermes-bot-screen-head__row">
          <span className="hermes-bot-screen-title">{s.title}</span>
          <span className="hermes-bot-screen-subtitle">{s.subtitle}</span>
        </div>

        <p className="hermes-bot-screen-lead">{s.intro}</p>

        <div className="hermes-bot-screen-meta">
          <span>
            {s.profile}: {status?.profile ?? '—'}
          </span>
          <span>
            {s.display}: {status?.display ?? '—'}
          </span>
          <span>
            {s.geometry}: {status?.geometry ?? '—'}
          </span>
        </div>
      </div>

      <div className="hermes-bot-screen-board">
        <BotScreenPane variant="page" onStatus={onStatus} />
      </div>
    </div>
  )
}

function readDockOpen(): boolean {
  return readSetting('dock-open') !== '0'
}

/** Keep the strip usable but never taller than most of the window. */
function clampDockHeight(px: number): number {
  const viewport = typeof window === 'undefined' ? 900 : window.innerHeight
  return Math.min(Math.max(Math.round(px), 140), Math.max(140, Math.round(viewport * 0.8)))
}

function readDockHeight(): number | null {
  const raw = readSetting('dock-height')
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) ? clampDockHeight(parsed) : null
}

/** `chat:bottom` — collapsible desktop strip under the chat terminal. */
function ChatDesktopStrip() {
  const s = useCopy()
  const { Button } = SDK?.components ?? {}
  const [open, setOpen] = useState(readDockOpen)
  const [mounted, setMounted] = useState(readDockOpen)
  const [height, setHeight] = useState<number | null>(readDockHeight)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev
      writeSetting('dock-open', next ? '1' : '0')
      if (next) setMounted(true)
      return next
    })
  }, [])

  // The viewer holds an RFB socket and the lease; keep it unmounted while closed.
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => setMounted(false), 250)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open])

  // Drag-to-resize: pointer capture spans the window so the strip follows the
  // cursor even when it leaves the grip.
  useEffect(() => {
    if (!dragging) return undefined
    const onMove = (event: PointerEvent) => {
      const start = dragStartRef.current
      if (!start) return
      setHeight(clampDockHeight(start.h + (event.clientY - start.y)))
    }
    const onUp = () => {
      setDragging(false)
      setHeight(current => {
        if (current != null) writeSetting('dock-height', String(current))
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging])

  const startDrag = useCallback(
    (event: { clientY: number; preventDefault: () => void }) => {
      if (!open) return
      event.preventDefault()
      dragStartRef.current = { y: event.clientY, h: height ?? DOCK_DEFAULT_PX }
      setDragging(true)
    },
    [height, open]
  )

  const resetHeight = useCallback(() => {
    setHeight(null)
    writeSetting('dock-height', '')
  }, [])

  return (
    <div className={`hermes-bot-screen-dock${open ? '' : ' hermes-bot-screen-dock--collapsed'}`}>
      <div className="hermes-bot-screen-dock__bar">
        <a className="hermes-bot-screen-dock__bar-title" href={screenHref()} title={s.openInPage}>
          {s.title}
        </a>
        <span className="hermes-bot-screen-dock__bar-meta">{s.subtitle}</span>
        <span className="hermes-bot-screen-dock__bar-spacer" />
        <Button size="sm" outlined onClick={toggle}>
          {open ? s.dockHide : s.dockShow}
        </Button>
      </div>

      {open ? (
        <div
          className="hermes-bot-screen-dock__grip"
          role="separator"
          aria-orientation="horizontal"
          title={s.resizeDock}
          onPointerDown={startDrag}
          onDoubleClick={resetHeight}
        />
      ) : null}

      {mounted ? (
        <div className="hermes-bot-screen-dock__body">
          <BotScreenPane variant="dock" stageHeight={height ?? undefined} />
        </div>
      ) : null}
    </div>
  )
}

if (REGISTRY && SDK) {
  REGISTRY.register(PLUGIN, ScreenPage)
  REGISTRY.registerSlot(PLUGIN, 'chat:bottom', ChatDesktopStrip)
} else if (typeof console !== 'undefined') {
  console.warn('[bot-screen] dashboard plugin SDK missing — nothing registered')
}
