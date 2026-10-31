/**
 * `react/jsx-runtime` shim — JSX compiles to this module; it forwards to the
 * host dashboard's React instance (see ./react.ts). The exported `JSX`
 * namespace is what `tsc` reads for element typing when `jsx: react-jsx`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- bridging an untyped host global */

type CreateElement = (type: any, props: any, ...children: any[]) => any

/**
 * The well-known React fragment type. `<>…</>` compiles to `jsx(Fragment, …)`
 * with the Fragment *this module* exports, and a hardcoded `null` there makes
 * every fragment an invalid element type (React error #130 → a blank plugin
 * page). React 18/19 compare against `Symbol.for('react.fragment')`, so
 * exporting the symbol works even before the SDK exists; `jsx()` still swaps in
 * the host's own Fragment when it is available.
 */
const FRAGMENT = Symbol.for('react.fragment')

function hostReact(): { createElement?: CreateElement; Fragment?: unknown } | undefined {
  if (typeof window === 'undefined') return undefined
  const sdk = (window as unknown as { __HERMES_PLUGIN_SDK__?: { React?: unknown } }).__HERMES_PLUGIN_SDK__
  return (sdk?.React as { createElement?: CreateElement; Fragment?: unknown } | undefined) ?? undefined
}

const createElement: CreateElement = (...args) => {
  const host = hostReact()
  return host?.createElement ? host.createElement(...args) : null
}

export const Fragment: any = FRAGMENT

function jsx(type: any, props: Record<string, unknown> | null, key?: unknown): unknown {
  const resolved = type === FRAGMENT ? (hostReact()?.Fragment ?? FRAGMENT) : type
  const { children, ...rest } = props || {}
  return createElement(resolved, key === undefined ? rest : { ...rest, key }, children)
}

export { jsx, jsx as jsxs, jsx as jsxDEV }

export namespace JSX {
  export type Element = any
  export interface ElementChildrenAttribute {
    children: unknown
  }
  export interface IntrinsicAttributes {
    key?: unknown
  }
  export interface IntrinsicElements {
    [elementName: string]: any
  }
}
