/**
 * Bot Screen plugin — the two legs of the official display plumbing, with no
 * imports from dashboard internals:
 *
 *   1. JSON-RPC `display.*` over the dashboard's authenticated `/api/ws`
 *      (its own tiny client — plugins cannot import the SPA's GatewayClient).
 *   2. The raw RFB stream over the sibling WebSocket `/api/display/ws`, opened
 *      with the single-use ticket `display.observe` mints.
 *
 * Wire shapes mirror the host's display RPC contract; input authority stays
 * the backend lease, so noVNC's `viewOnly` is UX only.
 */

import { sha256Hex } from './sha256'

/* eslint-disable @typescript-eslint/no-explicit-any -- the plugin bundle talks to a host it cannot import types from */

interface HermesWindow {
  __HERMES_BASE_PATH__?: string
  __HERMES_SESSION_TOKEN__?: string
  __HERMES_AUTH_REQUIRED__?: boolean
  __HERMES_DASHBOARD_PROFILE__?: string
  __HERMES_INITIAL_PROFILE__?: string
}

const win = (): HermesWindow => window as unknown as HermesWindow
const BASE = (win().__HERMES_BASE_PATH__ || '').replace(/\/+$/, '')

export interface DisplayLease {
  holder: 'agent' | 'human'
  viewer_id?: null
  viewer_hash?: string | null
  since: number
  epoch: number
  reason?: string
}

export interface DisplayStatus {
  profile?: string
  supported: boolean
  installed: boolean
  missing?: string[]
  running: boolean
  pid?: number | null
  display?: string | null
  geometry: string
  blocker?: string | null
  install_command?: string | null
  placement?: string
  lease: DisplayLease
  profile_key: string
}

export interface DisplayObserveResult extends DisplayStatus {
  ticket: string
  path: string
  viewer_id: string
}

export interface DisplayStopResult extends DisplayStatus {
  stopped: boolean
}

/** This window's identity for one attach: the minted id plus its lease hash. */
export interface ScreenViewer {
  id: string
  hash: string
}

// ── bridge close codes (the dashboard's display WebSocket router) ─────────────

/** Another viewer took the lease; the bridge evicted this socket. */
export const CLOSE_CONTROL_TAKEN = 4000
/** The profile's Bot Desktop is not running. */
export const CLOSE_DESKTOP_GONE = 4001
/** Ticket missing, expired or already spent — re-observe and reattach. */
export const CLOSE_BAD_TICKET = 4401
/** Host/Origin/client-IP policy refused the upgrade before accept. */
export const CLOSE_NOT_ALLOWED = 4403

const VIEWER_HASH_HEX = 12

/** `viewer_hash` as the lease broadcasts it: sha256(viewer_id)[:12], in JS. */
export function viewerHashFor(viewerId: string): string {
  return sha256Hex(viewerId).slice(0, VIEWER_HASH_HEX)
}

/** Does `viewer` (this window's attach) hold `lease`? */
export function leaseHeldBy(
  lease: DisplayLease | null | undefined,
  viewer: ScreenViewer | null | undefined
): boolean {
  if (!lease || !viewer || lease.holder !== 'human') return false
  return lease.viewer_hash === viewer.hash
}

/** A lease whose epoch is below the one we hold is a slower answer about the past. */
export function isOlderLease(prev: DisplayLease | null | undefined, next: DisplayLease): boolean {
  return prev != null && next.epoch < prev.epoch
}

/** JSON-RPC method-not-found: this Hermes predates the `display.*` surface. */
export function isDisplayUnavailable(error: unknown): boolean {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }) : null
  if (record?.code === -32601) return true
  const message = typeof record?.message === 'string' ? record.message.toLowerCase() : ''
  return message.includes('method not found') || message.includes('method-not-found')
}

/**
 * The profile this pane speaks for.
 *
 * The host dashboard resolves its own scope in this order
 * (the dashboard's profile bootstrap): the URL's
 * `?profile=`, else the launcher-preselected profile (`--open-profile`), else
 * the profile this dashboard serves. The pane must resolve the SAME scope, or
 * it would show one profile's desktop while the rest of the dashboard edits
 * another.
 */
export function profileScope(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('profile')
    if (fromUrl) return fromUrl.trim()
  } catch {
    /* no URL (should not happen in a browser) */
  }
  const initial = (win().__HERMES_INITIAL_PROFILE__ || '').trim()
  if (initial) return initial
  return (win().__HERMES_DASHBOARD_PROFILE__ || '').trim()
}

/** The dashboard route for the Screen page, carrying this window's profile scope. */
export function screenHref(): string {
  const scope = profileScope()
  return `${BASE}/screen${scope ? `?profile=${encodeURIComponent(scope)}` : ''}`
}

/** `ws(s)://<dashboard><base>/api/display/ws?display_ticket=<ticket>`. */
export function buildDisplayWsUrl(ticket: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${BASE}/api/display/ws?display_ticket=${encodeURIComponent(ticket)}`
}

async function wsAuthParam(): Promise<[string, string]> {
  if (win().__HERMES_AUTH_REQUIRED__) {
    const res = await fetch(`${BASE}/api/auth/ws-ticket`, { method: 'POST', credentials: 'include' })
    if (!res.ok) throw new Error(`ws-ticket refused (HTTP ${res.status})`)
    const body = (await res.json()) as { ticket?: string }
    return ['ticket', String(body.ticket || '')]
  }
  return ['token', String(win().__HERMES_SESSION_TOKEN__ || '')]
}

export type RpcState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

/**
 * The plugin's JSON-RPC client: newline-free JSON frames, one request per id,
 * server → client `event` notifications fanned out by type. Small on purpose —
 * the dashboard's own client is app-internal and not importable from a plugin.
 */
export class DisplayRpc {
  state: RpcState = 'idle'

  private ws: WebSocket | null = null
  private nextId = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private events = new Map<string, Set<(payload: any) => void>>()
  private states = new Set<(state: RpcState) => void>()

  onState(handler: (state: RpcState) => void): () => void {
    this.states.add(handler)
    return () => this.states.delete(handler)
  }

  on(type: string, handler: (payload: any) => void): () => void {
    const set = this.events.get(type) ?? new Set()
    set.add(handler)
    this.events.set(type, set)
    return () => set.delete(handler)
  }

  private setState(state: RpcState): void {
    this.state = state
    for (const handler of [...this.states]) {
      try {
        handler(state)
      } catch {
        /* a broken subscriber must not break the client */
      }
    }
  }

  async connect(): Promise<void> {
    if (this.state === 'open' || this.state === 'connecting') return

    this.setState('connecting')
    const [name, value] = await wsAuthParam()
    const url = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${BASE}/api/ws?${name}=${encodeURIComponent(value)}`

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      const timer = setTimeout(() => {
        try {
          ws.close()
        } catch {
          /* already closing */
        }
        reject(new Error('gateway connect timed out'))
      }, 15000)

      ws.onopen = () => {
        clearTimeout(timer)
        this.setState('open')
        resolve()
      }
      ws.onerror = () => {
        /* the close frame carries the reason */
      }
      ws.onclose = event => {
        clearTimeout(timer)
        if (this.ws === ws) this.ws = null
        this.setState(event.code === 4401 || event.code === 4403 ? 'error' : 'closed')
        reject(new Error(`gateway socket closed (${event.code || 'no code'})`))
      }
      ws.onmessage = event => this.handle(String(event.data))
    })
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('gateway not connected'))
    }

    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, 20000)
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timeout)
          resolve(value as T)
        },
        reject: error => {
          clearTimeout(timeout)
          reject(error)
        }
      })
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /** One `display.*` call, scoped to the profile this pane speaks for. */
  display<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const scope = profileScope()
    return this.request<T>(method, scope ? { ...params, profile: scope } : params)
  }

  close(): void {
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close()
      } catch {
        /* already closing */
      }
    }
    for (const [, entry] of this.pending) entry.reject(new Error('gateway closed'))
    this.pending.clear()
    this.setState('closed')
  }

  private handle(raw: string): void {
    let frame: any
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    if (!frame) return

    if (frame.id != null && (frame.result !== undefined || frame.error !== undefined)) {
      const entry = this.pending.get(frame.id)
      if (!entry) return
      this.pending.delete(frame.id)
      if (frame.error) {
        const error = new Error(String(frame.error.message || 'rpc error'))
        ;(error as Error & { code?: unknown }).code = frame.error.code
        entry.reject(error)
      } else {
        entry.resolve(frame.result)
      }
      return
    }

    if (frame.method === 'event') {
      const params = frame.params || {}
      const type = String(params.type || '')
      const set = this.events.get(type)
      if (!set) return
      for (const handler of [...set]) {
        try {
          handler(params.payload)
        } catch {
          /* one broken listener must not stop the others */
        }
      }
    }
  }
}
