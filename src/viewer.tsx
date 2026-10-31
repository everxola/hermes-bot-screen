/**
 * Bot Screen plugin — the viewer pane.
 *
 * Everything visual comes from the host dashboard's plugin SDK
 * (`window.__HERMES_PLUGIN_SDK__`), so the pane inherits the active theme and
 * the host's React instance — the bundle ships no React of its own.
 *
 * Layout, though, is the plugin's own CSS (`dashboard/dist/style.css`): the
 * dashboard's compiled Tailwind sheet contains only the classes its own source
 * uses, so plugin markup cannot lean on utility classes for anything that
 * matters.
 *
 * Behaviour is the ported Desktop-app pane: read-only watch by default,
 * Take over / Hand back bound to the backend lease, fit/actual size,
 * fullscreen, clipboard paste forwarding, a bounded reconnect ladder, and the
 * bridge's close codes (4000 evicted, 4001 desktop gone, 4401 stale ticket,
 * 4403 refused).
 *
 * Local additions on top of the port:
 *   • Visibility gating — the chat dock lives inside a persistently-mounted,
 *     CSS-hidden ChatPage on every dashboard route, and the /screen page can be
 *     mounted at the same time. A pane nobody can see stops its RFB stream
 *     (unless it holds the lease, so navigation never silently drops control)
 *     and re-attaches through the one dialer when it is shown again, keeping
 *     its viewer identity.
 *   • A stream HUD (approximate updates/s and bandwidth, sampled off the raw
 *     WebSocket) plus an adaptive "auto" quality mode on top of the presets.
 *   • An on-screen key row and a "send text to the desktop clipboard" box —
 *     the practical way to type CJK, which noVNC key events cannot carry —
 *     and a PNG screenshot button.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { screenCopy, type ScreenCopy } from './copy'
import { readSetting, writeSetting } from './storage'
import {
  buildDisplayWsUrl,
  CLOSE_BAD_TICKET,
  CLOSE_CONTROL_TAKEN,
  CLOSE_DESKTOP_GONE,
  CLOSE_NOT_ALLOWED,
  DisplayRpc,
  isDisplayUnavailable,
  isOlderLease,
  leaseHeldBy,
  viewerHashFor,
  type DisplayLease,
  type DisplayObserveResult,
  type DisplayStatus,
  type ScreenViewer
} from './display'

/* eslint-disable @typescript-eslint/no-explicit-any -- host SDK + noVNC are untyped here */

interface RfbLike {
  viewOnly: boolean
  scaleViewport: boolean
  /** Bounds the canvas to the stage and enables a movable viewport (actual size). */
  clipViewport: boolean
  resizeSession: boolean
  focusOnClick: boolean
  /**
   * While true, a pointer drag pans the display instead of reaching the
   * remote. Enabled only in actual-size mode and only while not holding
   * control (a controller's drags belong to the desktop).
   */
  dragViewport: boolean
  /**
   * When the server's cursor image is fully transparent, noVNC otherwise hides
   * the pointer entirely (`cursor: none`) — which is how a fullscreen viewer
   * ends up with no findable mouse. The dot keeps a pointer on screen.
   */
  showDotCursor: boolean
  background: string
  qualityLevel: number
  compressionLevel: number
  addEventListener: (
    type: string,
    handler: (event: { detail?: { clean?: boolean; reason?: string; text?: string } }) => void
  ) => void
  disconnect: () => void
  focus: () => void
  clipboardPasteFrom: (text: string) => void
  /** noVNC's public key injector; `down` omitted = press + release. */
  sendKey: (keysym: number, code?: string, down?: boolean) => void
}

interface RfbCtor {
  new (target: HTMLElement, socket: WebSocket, options?: Record<string, unknown>): RfbLike
}

interface PluginSdk {
  components: Record<string, any>
  utils: { cn: (...args: any[]) => string }
  useI18n?: () => { locale?: string }
}

function pluginSdk(): PluginSdk | undefined {
  return (window as unknown as { __HERMES_PLUGIN_SDK__?: PluginSdk }).__HERMES_PLUGIN_SDK__
}

async function loadRfb(): Promise<RfbCtor> {
  const mod = (await import('@novnc/novnc')) as unknown as { default: RfbCtor }
  return mod.default
}

type ConnState = 'idle' | 'attaching' | 'live' | 'error'

const EVICTION_LOOP_WINDOW_MS = 10_000
const MAX_RAPID_EVICTIONS = 3
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_BASE_MS = 1_000
const RECONNECT_CAP_MS = 8_000
const STATUS_POLL_MS = 15_000
/** Mirrors tools/bot_desktop/rfb_filter.py's _MAX_CUT_TEXT. */
const MAX_PASTE_CUT_TEXT = 256 * 1024
/** Cool-off before an errored pane re-arms itself after the desktop returns. */
const RECOVER_COOLOFF_MS = 5_000
/** Stream presets: qualityLevel (0-9, sharper) vs compressionLevel (0-9, smaller). */
const QUALITY_PRESETS = {
  saver: { quality: 4, compression: 6 },
  balanced: { quality: 7, compression: 2 },
  sharp: { quality: 9, compression: 0 }
} as const
type ManualQuality = keyof typeof QUALITY_PRESETS
/** The ladder the auto mode steps through (~1 s samples, own hysteresis). */
const AUTO_LEVELS: readonly ManualQuality[] = ['saver', 'balanced', 'sharp']
const AUTO_DEFAULT_LEVEL = 1
/** Step down above this, step back up below that; consecutive ticks required. */
const AUTO_HIGH_KBPS = 5_000
const AUTO_LOW_KBPS = 1_200
const AUTO_DOWN_TICKS = 2
const AUTO_UP_TICKS = 3
const HUD_TICK_MS = 1_000
type QualityKey = 'auto' | ManualQuality
const QUALITY_KEYS: readonly QualityKey[] = ['auto', 'saver', 'balanced', 'sharp']
/** Only auto-copy small payloads: a huge desktop clipboard write is a surprise. */
const CLIPBOARD_AUTOCOPY_MAX = 8 * 1024
/** Dock default height in px — mirrors `.hermes-bot-screen-dock__stage`'s 15rem. */
export const DOCK_DEFAULT_PX = 240

/** The keysyms the on-screen key row sends (X11 keysym values). */
const KEY_ROW: ReadonlyArray<{ keysym: number; glyph: string; titleKey: keyof ScreenCopy }> = [
  { keysym: 0xff1b, glyph: 'Esc', titleKey: 'keyEsc' },
  { keysym: 0xff09, glyph: 'Tab', titleKey: 'keyTab' },
  { keysym: 0xff0d, glyph: '⏎', titleKey: 'keyEnter' },
  { keysym: 0xff08, glyph: '⌫', titleKey: 'keyBackspace' },
  { keysym: 0xffeb, glyph: '❖', titleKey: 'keySuper' },
  { keysym: 0xff51, glyph: '←', titleKey: 'keyLeft' },
  { keysym: 0xff52, glyph: '↑', titleKey: 'keyUp' },
  { keysym: 0xff53, glyph: '→', titleKey: 'keyRight' },
  { keysym: 0xff54, glyph: '↓', titleKey: 'keyDown' }
]

function readQuality(): QualityKey {
  const stored = readSetting('quality')
  return stored && (QUALITY_KEYS as readonly string[]).includes(stored) ? (stored as QualityKey) : 'balanced'
}

function reconnectDelayMs(attempt: number): number {
  const capped = Math.min(RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1), RECONNECT_CAP_MS)
  // Jitter so a gateway restart with several panes cannot stack every redial.
  return Math.round(capped * (0.8 + Math.random() * 0.4))
}

function byteLengthOf(data: unknown): number {
  if (typeof data === 'string') return data.length
  if (data instanceof ArrayBuffer) return data.byteLength
  if (ArrayBuffer.isView(data)) return data.byteLength
  return 0
}

/**
 * A raw WebSocket chunk whose first byte is 0 is the head of an RFB
 * FramebufferUpdate (there is no per-message framing on the wire, so the HUD's
 * updates/s is deliberately approximate — bandwidth is exact).
 */
function isFramebufferChunk(data: unknown): boolean {
  if (data instanceof ArrayBuffer) return data.byteLength > 0 && new Uint8Array(data)[0] === 0
  if (ArrayBuffer.isView(data)) return data.byteLength > 0 && (data as Uint8Array)[0] === 0
  return false
}

function formatRate(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${Math.max(0, Math.round(kbps))} kb/s`
}

function screenshotName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `hermes-bot-screen-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`
}

/** Byte counters behind the HUD and the auto-quality mode, per attach. */
interface StreamStats {
  bytesIn: number
  bytesOut: number
  updates: number
  prevBytes: number
  prevUpdates: number
  sampledAt: number
}

export interface BotScreenPaneProps {
  /** Docked strip (chat) sizes the stage; the page lets it fill. */
  variant?: 'page' | 'dock'
  className?: string
  /** Docked variant only: user-chosen stage height in px (undefined = CSS default). */
  stageHeight?: number
  /** Report the live status upward — the page header names the profile/display it shows. */
  onStatus?: (status: DisplayStatus | null) => void
}

export function BotScreenPane({ variant = 'page', className, stageHeight, onStatus }: BotScreenPaneProps) {
  const sdk = pluginSdk()
  const i18n = sdk?.useI18n ? sdk.useI18n() : undefined
  const s: ScreenCopy = useMemo(() => screenCopy(i18n?.locale), [i18n?.locale])
  const UI = sdk?.components ?? {}
  const { Button, Badge } = UI
  const compact = variant === 'dock'

  const rpc = useMemo(() => new DisplayRpc(), [])
  const [version, setVersion] = useState(0)

  const [status, setStatus] = useState<DisplayStatus | null>(null)
  const [lease, setLease] = useState<DisplayLease | null>(null)
  const [viewer, setViewer] = useState<ScreenViewer | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [conn, setConn] = useState<ConnState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Which lease/desktop action is in flight — labels must not lie ("Starting…" during a stop). */
  const [pending, setPending] = useState<null | 'start' | 'stop' | 'lease'>(null)
  const [fitted, setFitted] = useState(() => readSetting('fit') !== '0')
  const [fullscreen, setFullscreen] = useState(false)
  const [quality, setQuality] = useState<QualityKey>(readQuality)
  /** Latest text the *desktop* put on its clipboard (noVNC's `clipboard` event). */
  const [remoteClip, setRemoteClip] = useState<string | null>(null)
  const [copiedAt, setCopiedAt] = useState(0)
  /** Approximate stream HUD, refreshed once a second while live. */
  const [hud, setHud] = useState<{ ups: number; kbps: number } | null>(null)
  /** This pane's stage is on screen (IntersectionObserver; assumed if unavailable). */
  const [paneVisible, setPaneVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [docVisible, setDocVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  )
  /** Text staged for the desktop clipboard, and the "sent" flash. */
  const [textOut, setTextOut] = useState('')
  const [sentAt, setSentAt] = useState(0)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  /**
   * The stage element as STATE, not only as a ref: the pane's stage is
   * unmounted while the desktop is stopped (the "stopped" box replaces the
   * whole tree) and remounted as a NEW node when it starts again. A
   * visibility observer bound to the old, detached node never fires for the
   * new one, so the pane would stay invisible and never re-attach.
   */
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const setStage = useCallback((node: HTMLDivElement | null) => {
    wrapRef.current = node
    setStageEl(node)
  }, [])
  const rfbRef = useRef<RfbLike | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const pasteCleanupRef = useRef<(() => void) | null>(null)
  const generationRef = useRef(0)
  const dialedAtRef = useRef(0)
  const rapidEvictionsRef = useRef(0)
  const reconnectsRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gaveUpRef = useRef(false)
  const viewerRef = useRef<ScreenViewer | null>(null)
  const statusRef = useRef<DisplayStatus | null>(null)
  const connRef = useRef<ConnState>('idle')
  connRef.current = conn
  const holdRef = useRef(false)
  const qualityRef = useRef<QualityKey>(quality)
  qualityRef.current = quality
  const statsRef = useRef<StreamStats | null>(null)
  const autoRef = useRef({ level: AUTO_DEFAULT_LEVEL, down: 0, up: 0 })
  const visible = paneVisible && docVisible
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const iHold = leaseHeldBy(lease, viewer)
  holdRef.current = iHold
  const humanOther = lease?.holder === 'human' && !iHold

  const applyLease = useCallback((next: DisplayLease) => {
    setLease(prev => (isOlderLease(prev, next) ? prev : next))
  }, [])

  const applyStatus = useCallback(
    (next: DisplayStatus) => {
      setStatus(next)
      statusRef.current = next
      if (next.lease) applyLease(next.lease)
    },
    [applyLease]
  )

  // Report the status upward so the page header can name the profile and the
  // display it is showing (the pane owns the polling, the page owns the chrome).
  useEffect(() => {
    onStatus?.(status)
  }, [onStatus, status])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await rpc.display<DisplayStatus>('display.status')
      applyStatus(next)
      setUnavailable(false)
      setError(null)
      // A desktop that comes back (the gateway supervises it, so a stopped
      // screen usually returns on its own) must be re-attached without the user
      // having to click anything: an earlier observe failed with "not running",
      // which parked the pane in `error`.
      if (next.running && connRef.current === 'error' && !rfbRef.current && !gaveUpRef.current) {
        // Only re-arm after a cool-off: a fast observe-fail -> refresh -> attach
        // cycle must not spin while the desktop is still coming up.
        if (Date.now() - dialedAtRef.current > RECOVER_COOLOFF_MS) setConn('idle')
      }
    } catch (err) {
      if (isDisplayUnavailable(err)) {
        setUnavailable(true)
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [applyStatus, rpc])

  // Lease/status pushes keep every surface in sync (another tab, the CLI, the
  // Desktop app) — the event envelope is {method:'event', params:{type,payload}}.
  useEffect(() => {
    const offLease = rpc.on('display.lease', (payload: { lease?: DisplayLease; profile_key?: string }) => {
      if (!payload?.lease) return
      const key = statusRef.current?.profile_key
      if (key && payload.profile_key && payload.profile_key !== key) return
      applyLease(payload.lease)
    })
    const offStatus = rpc.on('display.status', (payload: DisplayStatus) => {
      if (!payload?.profile_key) return
      const key = statusRef.current?.profile_key
      if (key && payload.profile_key !== key) return
      applyStatus(payload)
    })
    return () => {
      offLease()
      offStatus()
    }
  }, [applyLease, applyStatus, rpc])

  // Pane-level visibility. The chat dock is mounted inside a persistently
  // rendered ChatPage that is only hidden with CSS on other routes, so a pane
  // must ask whether it can actually be seen — otherwise the dock keeps a live
  // RFB stream (a second Xvnc encode) running beside the /screen page.
  //
  // The observer follows the CURRENT stage node (`stageEl`), not the one that
  // existed at mount: the stage is unmounted while the desktop is stopped and
  // a NEW node is mounted when it starts again, so a mount-time observer would
  // keep reporting the detached node and the pane would never come back.
  useEffect(() => {
    if (!stageEl || typeof IntersectionObserver === 'undefined') {
      // No stage (desktop stopped) — nothing can be seen here.
      setPaneVisible(false)
      return undefined
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) setPaneVisible(entry.isIntersecting)
      },
      { threshold: 0 }
    )
    observer.observe(stageEl)
    return () => observer.disconnect()
  }, [stageEl])

  // Document-level resume: a hidden browser tab (or a phone that slept)
  // suspends the stream with the pane, and returning re-arms the reconnect
  // ladder at once instead of waiting the backoff out.
  useEffect(() => {
    const onDocState = () => setDocVisible(document.visibilityState !== 'hidden')
    const onResume = () => {
      if (connRef.current === 'live' || connRef.current === 'attaching') return
      reconnectsRef.current = 0
      gaveUpRef.current = false
      clearTimer()
      setConn('idle')
    }
    const onVisibility = () => {
      onDocState()
      if (document.visibilityState !== 'hidden') onResume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onResume)
    window.addEventListener('pageshow', onResume)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [clearTimer])

  // Connect the RPC leg, then seed from the backend; bounded redial after a drop.
  useEffect(() => {
    let cancelled = false
    reconnectsRef.current = 0
    gaveUpRef.current = false

    void rpc
      .connect()
      .then(() => (cancelled ? undefined : refresh()))
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    const offState = rpc.onState(state => {
      if (cancelled || state === 'open' || state === 'connecting' || state === 'idle') return
      if (gaveUpRef.current || timerRef.current) return
      if (reconnectsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        gaveUpRef.current = true
        setError(s.reconnectGaveUp)
        return
      }
      reconnectsRef.current += 1
      const attempt = reconnectsRef.current
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (!cancelled) setVersion(v => v + 1)
      }, reconnectDelayMs(attempt))
    })

    return () => {
      cancelled = true
      clearTimer()
      offState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `s` only supplies copy
  }, [rpc, refresh, version, clearTimer])

  useEffect(() => () => rpc.close(), [rpc])

  const detach = useCallback(
    (handBack = false) => {
      generationRef.current += 1
      clearTimer()
      if (handBack) {
        const socket = socketRef.current
        if (socket) {
          // 1000 first: the bridge releases this viewer's lease on a clean close.
          try {
            socket.close(1000)
          } catch {
            /* already closing */
          }
        }
      }
      rfbRef.current?.disconnect()
      rfbRef.current = null
      const socket = socketRef.current
      if (socket) {
        try {
          socket.close()
        } catch {
          /* already closing */
        }
      }
      socketRef.current = null
      statsRef.current = null
      pasteCleanupRef.current?.()
      pasteCleanupRef.current = null
    },
    [clearTimer]
  )

  const scheduleReconnect = useCallback(
    (reason: string) => {
      const attempt = reconnectsRef.current + 1
      reconnectsRef.current = attempt
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        gaveUpRef.current = true
        setConn('error')
        setError(s.reconnectGaveUp)
        return
      }
      setConn('attaching')
      setError(null)
      setNotice(reason)
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        // Hand the retry back to the single attach path below.
        setConn('idle')
      }, reconnectDelayMs(attempt))
    },
    [clearTimer, s.reconnectGaveUp]
  )

  const presetFor = useCallback((key: QualityKey) => {
    const manual: ManualQuality = key === 'auto' ? AUTO_LEVELS[autoRef.current.level] : key
    return QUALITY_PRESETS[manual]
  }, [])

  const attach = useCallback(
    async (auto = false) => {
      const host = stageRef.current
      if (!host) return
      if (!auto) {
        rapidEvictionsRef.current = 0
        reconnectsRef.current = 0
        gaveUpRef.current = false
      }

      detach()
      dialedAtRef.current = Date.now()
      const generation = generationRef.current
      setConn('attaching')
      setError(null)

      try {
        // Load the client BEFORE dialing: noVNC installs its own onopen.
        const Rfb = await loadRfb()
        if (generation !== generationRef.current) return

        const priorViewer = viewerRef.current?.id
        const observe = await rpc.display<DisplayObserveResult>(
          'display.observe',
          priorViewer ? { viewer_id: priorViewer } : {}
        )
        if (generation !== generationRef.current) return

        const minted: ScreenViewer = { id: observe.viewer_id, hash: viewerHashFor(observe.viewer_id) }
        applyStatus(observe)
        setViewer(minted)
        viewerRef.current = minted

        const ws = new WebSocket(buildDisplayWsUrl(observe.ticket))
        ws.binaryType = 'arraybuffer'
        socketRef.current = ws
        dialedAtRef.current = Date.now()

        // Stream counters for the HUD / auto quality. Both ride the same socket
        // noVNC uses; a `message` listener coexists with its `onmessage` property.
        statsRef.current = {
          bytesIn: 0,
          bytesOut: 0,
          updates: 0,
          prevBytes: 0,
          prevUpdates: 0,
          sampledAt: performance.now()
        }
        const originalSend = ws.send.bind(ws)
        const sendWithStats = ((data: Parameters<typeof originalSend>[0]) => {
          const stats = statsRef.current
          if (stats) stats.bytesOut += byteLengthOf(data)
          originalSend(data)
        }) as WebSocket['send']
        ws.send = sendWithStats
        ws.addEventListener('message', event => {
          const stats = statsRef.current
          if (!stats) return
          stats.bytesIn += byteLengthOf(event.data)
          if (isFramebufferChunk(event.data)) stats.updates += 1
        })

        // The bridge's verdict lives in the raw close frame, so read it before
        // noVNC installs its own onclose.
        let closeCode = 0
        ws.addEventListener('close', event => {
          closeCode = event.code
        })

        const client = new Rfb(host, ws, { shared: true })
        const preset = presetFor(qualityRef.current)
        const holding = leaseHeldBy(observe.lease, minted)
        // Clip first, then scale: the scale setter re-runs the clip update, so
        // this order survives both directions of the fit/1:1 toggle. Clipping is
        // what gives the actual-size view a draggable viewport at all.
        client.clipViewport = !fitted
        client.scaleViewport = fitted
        client.resizeSession = false
        client.focusOnClick = true
        client.showDotCursor = true
        client.background = 'transparent'
        client.qualityLevel = preset.quality
        client.compressionLevel = preset.compression
        client.viewOnly = !holding
        client.dragViewport = !fitted && !holding

        // The desktop's own clipboard (ServerCutText) — the reverse of the paste
        // handler below. Surfaced as a chip, and copied straight into the real
        // clipboard while this viewer holds control (secure contexts only;
        // `navigator.clipboard` does not exist on an http:// LAN origin).
        client.addEventListener('clipboard', event => {
          const text = event.detail?.text
          if (typeof text !== 'string' || !text) return
          if (generation !== generationRef.current) return
          setRemoteClip(text)
          setCopiedAt(0)
          if (holdRef.current && text.length <= CLIPBOARD_AUTOCOPY_MAX && document.hasFocus()) {
            try {
              const write = navigator.clipboard?.writeText?.(text)
              if (write) void write.then(() => setCopiedAt(Date.now())).catch(() => undefined)
            } catch {
              /* blocked or insecure context: the chip's Copy button still works */
            }
          }
        })

        client.addEventListener('connect', () => {
          if (generation === generationRef.current) {
            setConn('live')
            setNotice(null)
            setError(null)
          }
        })

        client.addEventListener('disconnect', event => {
          if (rfbRef.current === client) rfbRef.current = null
          if (generation !== generationRef.current) return

          const reason = event.detail?.reason ?? ''
          if (closeCode === CLOSE_CONTROL_TAKEN || reason.includes('control-taken')) {
            rapidEvictionsRef.current =
              Date.now() - dialedAtRef.current < EVICTION_LOOP_WINDOW_MS ? rapidEvictionsRef.current + 1 : 1
            if (rapidEvictionsRef.current > MAX_RAPID_EVICTIONS) {
              gaveUpRef.current = true
              setConn('error')
              setError(s.controlTaken)
            } else {
              setConn('idle')
              setNotice(s.controlTaken)
            }
          } else if (closeCode === CLOSE_DESKTOP_GONE) {
            setConn('idle')
            setNotice(s.desktopGone)
          } else if (closeCode === CLOSE_BAD_TICKET) {
            setConn('idle')
            scheduleReconnect(s.badTicket)
          } else if (closeCode === CLOSE_NOT_ALLOWED) {
            gaveUpRef.current = true
            setConn('error')
            setError(s.notAllowed)
          } else if (event.detail?.clean) {
            setConn('idle')
          } else {
            scheduleReconnect(s.streamLost)
          }
          void refresh()
        })

        rfbRef.current = client

        // Explicit user paste only, forwarded as noVNC ClientCutText while the
        // client is not view-only (the gateway's filter would drop it anyway).
        const handlePaste = (event: ClipboardEvent) => {
          if (client.viewOnly) return
          const text = event.clipboardData?.getData('text')
          if (text && text.length <= MAX_PASTE_CUT_TEXT) {
            event.preventDefault()
            client.clipboardPasteFrom(text)
          }
        }
        host.addEventListener('paste', handlePaste)
        pasteCleanupRef.current = () => host.removeEventListener('paste', handlePaste)
      } catch (err) {
        if (generation !== generationRef.current) return
        if (isDisplayUnavailable(err)) {
          setUnavailable(true)
          return
        }
        setConn('error')
        setError(err instanceof Error ? err.message : String(err))
        // The desktop may just be starting/stopping: refresh so the pane can
        // recover on its own as soon as the status says it is running again.
        void refresh()
      }
    },
    [applyStatus, detach, fitted, presetFor, refresh, rpc, s.badTicket, s.controlTaken, s.desktopGone, s.notAllowed, s.streamLost, scheduleReconnect]
  )

  // A running-and-idle pane attaches itself: fresh mount, stop→start, eviction
  // recovery, a scheduled reconnect. This is the ONE dialer.
  useEffect(() => {
    if (!visible) return
    if (status?.running && conn === 'idle' && !gaveUpRef.current) void attach(true)
  }, [attach, conn, status?.running, visible])

  // Nobody can see the pane (hidden route/dock, or a hidden tab): stop the
  // stream — unless this viewer HOLDS the lease, so a navigation never
  // silently drops the user's control. Shown panes re-attach through the
  // dialer, reusing the viewer id so the lease identity survives.
  useEffect(() => {
    if (visible || holdRef.current) return
    if (conn === 'live' || conn === 'attaching') {
      detach()
      setConn('idle')
      setNotice(null)
    }
  }, [conn, detach, visible])

  // Unmount hands control back server-side (clean close).
  useEffect(() => () => detach(true), [detach])

  // Control changes flip both input authority and the drag semantics: a
  // controller's drags belong to the desktop, a watcher's drags pan it.
  // (Viewport clipping stays on whenever actual size is active — it is what
  // bounds the canvas to the stage and makes panning meaningful.)
  useEffect(() => {
    const client = rfbRef.current
    if (!client) return
    client.viewOnly = !iHold
    client.clipViewport = !fitted
    client.dragViewport = !fitted && !iHold
    if (iHold) client.focus()
  }, [fitted, iHold])

  useEffect(() => {
    if (rfbRef.current) rfbRef.current.scaleViewport = fitted
  }, [fitted])

  useEffect(() => {
    const poll = setInterval(() => {
      if (visibleRef.current) void refresh()
    }, STATUS_POLL_MS)
    return () => clearInterval(poll)
  }, [refresh])

  // The stream HUD (1 s samples off the socket counters) and the adaptive
  // quality stepper. Manual presets never move on their own.
  useEffect(() => {
    if (conn !== 'live') {
      setHud(null)
      return undefined
    }
    const stats = statsRef.current
    if (stats) {
      stats.sampledAt = performance.now()
      stats.prevBytes = stats.bytesIn
      stats.prevUpdates = stats.updates
    }
    const tick = setInterval(() => {
      const current = statsRef.current
      if (!current) return
      const now = performance.now()
      const dt = Math.max(0.25, (now - current.sampledAt) / 1000)
      current.sampledAt = now
      const kbps = ((current.bytesIn - current.prevBytes) * 8) / dt / 1000
      const ups = Math.max(0, current.updates - current.prevUpdates)
      current.prevBytes = current.bytesIn
      current.prevUpdates = current.updates
      setHud({ kbps, ups })

      if (qualityRef.current !== 'auto') return
      const auto = autoRef.current
      if (kbps > AUTO_HIGH_KBPS) {
        auto.down += 1
        auto.up = 0
      } else if (kbps < AUTO_LOW_KBPS) {
        auto.up += 1
        auto.down = 0
      } else {
        auto.down = 0
        auto.up = 0
      }
      const client = rfbRef.current
      if (auto.down >= AUTO_DOWN_TICKS && auto.level > 0) {
        auto.level -= 1
        auto.down = 0
        if (client) {
          const preset = QUALITY_PRESETS[AUTO_LEVELS[auto.level]]
          client.qualityLevel = preset.quality
          client.compressionLevel = preset.compression
        }
      } else if (auto.up >= AUTO_UP_TICKS && auto.level < AUTO_LEVELS.length - 1) {
        auto.level += 1
        auto.up = 0
        if (client) {
          const preset = QUALITY_PRESETS[AUTO_LEVELS[auto.level]]
          client.qualityLevel = preset.quality
          client.compressionLevel = preset.compression
        }
      }
    }, HUD_TICK_MS)
    return () => clearInterval(tick)
  }, [conn])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Let the "Copied" / "Sent" confirmations fade on their own.
  useEffect(() => {
    if (!copiedAt) return undefined
    const timer = setTimeout(() => setCopiedAt(0), 2_500)
    return () => clearTimeout(timer)
  }, [copiedAt])

  useEffect(() => {
    if (!sentAt) return undefined
    const timer = setTimeout(() => setSentAt(0), 2_500)
    return () => clearTimeout(timer)
  }, [sentAt])

  const takeOver = useCallback(async () => {
    const current = viewerRef.current
    if (!current) return
    setBusy(true)
    try {
      const result = await rpc.display<{ lease: DisplayLease }>('display.lease.acquire', { viewer_id: current.id })
      applyLease(result.lease)
      if (rfbRef.current) {
        rfbRef.current.viewOnly = false
        // Control mode: a drag now acts on the desktop, not the viewport.
        rfbRef.current.dragViewport = false
        rfbRef.current.focus()
      } else if (conn !== 'live') {
        void attach()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [applyLease, attach, conn, rpc])

  const handBack = useCallback(
    async (force = false) => {
      setBusy(true)
      try {
        const params = force ? { force: true } : { viewer_id: viewerRef.current?.id }
        const result = await rpc.display<{ lease: DisplayLease }>('display.lease.release', params)
        applyLease(result.lease)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [applyLease, rpc]
  )

  const start = useCallback(async () => {
    setBusy(true)
    setPending('start')
    setError(null)
    setNotice(null)
    try {
      const next = await rpc.display<DisplayStatus>('display.start')
      applyStatus(next)
      reconnectsRef.current = 0
      gaveUpRef.current = false
      setConn('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }, [applyStatus, rpc])

  const stop = useCallback(async () => {
    setBusy(true)
    setPending('stop')
    try {
      const next = await rpc.display<DisplayStatus>('display.stop', iHold ? { force: true } : {})
      applyStatus(next)
      detach(true)
      setConn('idle')
      setNotice(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setPending(null)
    }
  }, [applyStatus, detach, iHold, rpc])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }, [])

  /** Persist the fit/actual-size choice (quality and dock state live in storage too). */
  const toggleFit = useCallback(() => {
    setFitted(prev => {
      const next = !prev
      writeSetting('fit', next ? '1' : '0')
      return next
    })
  }, [])

  /** Put the desktop clipboard into the browser's clipboard, gesture or not. */
  const copyRemote = useCallback(async () => {
    if (!remoteClip) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(remoteClip)
        setCopiedAt(Date.now())
        return
      }
    } catch {
      /* fall through: insecure contexts have no navigator.clipboard */
    }
    try {
      const area = document.createElement('textarea')
      area.value = remoteClip
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      if (ok) setCopiedAt(Date.now())
      else setError(s.copyFailed)
    } catch {
      setError(s.copyFailed)
    }
  }, [remoteClip, s.copyFailed])

  const changeQuality = useCallback(
    (next: QualityKey) => {
      setQuality(next)
      qualityRef.current = next
      writeSetting('quality', next)
      const preset = presetFor(next)
      if (rfbRef.current) {
        rfbRef.current.qualityLevel = preset.quality
        rfbRef.current.compressionLevel = preset.compression
      }
      if (next === 'auto') {
        autoRef.current.down = 0
        autoRef.current.up = 0
      }
    },
    [presetFor]
  )

  /** Browser → desktop clipboard: the practical path for CJK text. */
  const sendText = useCallback(() => {
    const client = rfbRef.current
    const text = textOut
    if (!client || !text || client.viewOnly) return
    if (text.length > MAX_PASTE_CUT_TEXT) {
      setError(s.textTooLong)
      return
    }
    client.clipboardPasteFrom(text)
    setTextOut('')
    setSentAt(Date.now())
  }, [s.textTooLong, textOut])

  /** One-shot key press from the on-screen key row. */
  const pressKey = useCallback((keysym: number) => {
    const client = rfbRef.current
    if (client && !client.viewOnly) client.sendKey(keysym)
  }, [])

  const screenshot = useCallback(() => {
    const canvas = stageRef.current?.querySelector('canvas')
    if (!canvas || typeof canvas.toBlob !== 'function') return
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = screenshotName()
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5_000)
    }, 'image/png')
  }, [])

  // ── render ─────────────────────────────────────────────────────────────────

  const paneClass = ['hermes-bot-screen-pane', className].filter(Boolean).join(' ')

  const stateBox = (title: string, bodyText?: string | null, action?: ReactNode) => (
    <div className={paneClass}>
      <div className="hermes-bot-screen-empty">
        <div className="hermes-bot-screen-empty__title">{title}</div>
        {bodyText ? <div className="hermes-bot-screen-empty__body">{bodyText}</div> : null}
        {action}
        {error ? <div className="hermes-bot-screen-error">{error}</div> : null}
      </div>
    </div>
  )

  if (unavailable) return stateBox(s.unavailableTitle, s.unavailableBody)
  if (status && !status.supported) return stateBox(s.unsupportedTitle, s.unsupportedBody)
  if (status && !status.installed) return stateBox(s.notInstalledTitle, s.notInstalledBody)

  if (status && !status.running) {
    return stateBox(
      s.stoppedTitle,
      status.blocker ?? s.stoppedBody,
      <Button size="sm" disabled={busy} onClick={() => void start()}>
        {pending === 'start' ? s.starting : pending === 'stop' ? s.stopping : s.start}
      </Button>
    )
  }

  const controlLabel = iHold ? s.youControl : humanOther ? s.otherControls : s.agentControls

  return (
    <div className={paneClass}>
      <div className={`hermes-bot-screen-toolbar${compact ? ' hermes-bot-screen-toolbar--compact' : ''}`}>
        {!compact ? <span className="hermes-bot-screen-toolbar__title">{s.title}</span> : null}
        <span className="hermes-bot-screen-toolbar__meta">
          {status?.display ?? '—'}
          {status?.geometry ? ` · ${status.geometry}` : ''}
        </span>
        {conn === 'live' && hud ? (
          <span className="hermes-bot-screen-hud" title={s.hudTitle}>
            ≈{hud.ups}/s · {formatRate(hud.kbps)}
          </span>
        ) : null}
        <Badge tone={status?.running ? 'default' : 'outline'}>{status?.running ? s.running : s.stopped}</Badge>

        <span className="hermes-bot-screen-toolbar__spacer" />

        {lease?.holder === 'human' && lease.reason ? (
          <span className="hermes-bot-screen-reason" title={lease.reason}>
            {s.reason}: {lease.reason}
          </span>
        ) : null}

        <Badge tone={iHold ? 'destructive' : 'outline'}>{controlLabel}</Badge>

        {iHold ? (
          <Button size="sm" outlined disabled={busy} onClick={() => void handBack()}>
            {s.handBack}
          </Button>
        ) : (
          <>
            {humanOther ? (
              <Button size="sm" outlined disabled={busy} onClick={() => void handBack(true)}>
                {s.handBackForce}
              </Button>
            ) : null}
            <Button size="sm" disabled={busy || conn === 'attaching' || !viewer} onClick={() => void takeOver()}>
              {s.takeOver}
            </Button>
          </>
        )}

        <Button size="sm" outlined title={fitted ? s.actual : s.fit} onClick={toggleFit}>
          {fitted ? '1:1' : '⤢'}
        </Button>
        <Button size="sm" outlined title={fullscreen ? s.exitFullscreen : s.fullscreen} onClick={toggleFullscreen}>
          {fullscreen ? '🡼' : '⛶'}
        </Button>
        <Button size="sm" outlined title={s.screenshot} disabled={conn !== 'live'} onClick={screenshot}>
          📷
        </Button>
        <select
          className="hermes-bot-screen-select"
          title={s.quality}
          value={quality}
          onChange={(event: { target: { value: string } }) => changeQuality(event.target.value as QualityKey)}
        >
          <option value="auto">{s.qualityAuto}</option>
          <option value="saver">{s.qualitySaver}</option>
          <option value="balanced">{s.qualityBalanced}</option>
          <option value="sharp">{s.qualitySharp}</option>
        </select>
        <Button
          size="sm"
          outlined
          title={s.reconnect}
          disabled={conn === 'attaching'}
          onClick={() => {
            reconnectsRef.current = 0
            gaveUpRef.current = false
            void attach()
          }}
        >
          ↻
        </Button>
        <Button size="sm" outlined title={pending === 'stop' ? s.stopping : s.stop} disabled={busy || !status?.running} onClick={() => void stop()}>
          ■
        </Button>
      </div>

      {iHold && conn === 'live' ? (
        <div className="hermes-bot-screen-controls">
          {KEY_ROW.map(key => (
            <button
              key={key.keysym}
              type="button"
              className="hermes-bot-screen-key"
              title={s[key.titleKey]}
              onClick={() => pressKey(key.keysym)}
            >
              {key.glyph}
            </button>
          ))}
          <input
            className="hermes-bot-screen-text"
            type="text"
            value={textOut}
            placeholder={s.sendTextPlaceholder}
            title={s.sendToDesktop}
            onChange={(event: { target: { value: string } }) => setTextOut(event.target.value)}
            onKeyDown={(event: { key: string; nativeEvent: { isComposing?: boolean }; preventDefault: () => void }) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                sendText()
              }
            }}
          />
          <Button size="sm" outlined disabled={!textOut} onClick={sendText}>
            {s.send}
          </Button>
          {sentAt ? <span className="hermes-bot-screen-sent">{s.sent}</span> : null}
        </div>
      ) : null}

      {remoteClip ? (
        <div className="hermes-bot-screen-clip">
          <span className="hermes-bot-screen-clip__label">{s.clipboardFromDesktop}</span>
          <span className="hermes-bot-screen-clip__text" title={remoteClip}>
            {remoteClip.replace(/\s+/g, ' ').slice(0, 160)}
          </span>
          <span className="hermes-bot-screen-clip__spacer" />
          {copiedAt ? <span className="hermes-bot-screen-clip__ok">{s.copied}</span> : null}
          <Button size="sm" outlined onClick={() => void copyRemote()}>
            {s.copy}
          </Button>
          <Button size="sm" outlined title={s.dismiss} onClick={() => setRemoteClip(null)}>
            ✕
          </Button>
        </div>
      ) : null}

      {/* A refused ACTION (take over / hand back / stop / paste / copy) sets
          `error` without changing `conn`, so the stage overlay never fires and
          the click looked like it did nothing. The stream is fine here, so the
          message belongs in the flow, not over the picture. The `conn === 'error'`
          case (the stream itself died) keeps the stage overlay below. */}
      {error && conn !== 'error' ? (
        <div className="hermes-bot-screen-error hermes-bot-screen-error--bar">{error}</div>
      ) : null}

      <div
        ref={setStage}
        className={`hermes-bot-screen-stage${iHold ? ' hermes-bot-screen-stage--mine' : ''}${
          compact ? ' hermes-bot-screen-dock__stage' : ''
        }`}
        style={stageHeight ? { height: `${stageHeight}px` } : undefined}
      >
        <div ref={stageRef} className="hermes-bot-screen-stage__host" />

        {conn === 'attaching' ? (
          <div className="hermes-bot-screen-overlay hermes-bot-screen-overlay--attaching">{s.attaching}</div>
        ) : null}

        {notice ? <div className="hermes-bot-screen-overlay hermes-bot-screen-overlay--notice">{notice}</div> : null}

        {conn === 'error' && error ? (
          <div className="hermes-bot-screen-overlay hermes-bot-screen-overlay--error">
            <span className="hermes-bot-screen-overlay__msg">{error}</span>
          </div>
        ) : null}
      </div>

      {!compact ? (
        <div className="hermes-bot-screen-hints">
          <span className="hermes-bot-screen-hints__grow">{iHold ? s.keyboardHint : s.readonlyHint}</span>
          {!fitted ? <span>{s.panHint}</span> : null}
          {iHold ? <span className="hermes-bot-screen-hints__warn">{s.pausedNote}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
