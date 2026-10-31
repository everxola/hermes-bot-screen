/**
 * React shim: the plugin bundle must NOT ship its own React — the host
 * dashboard owns the instance (`window.__HERMES_PLUGIN_SDK__.React`), and two
 * copies break hooks. The build aliases `react` here so plugin sources can be
 * written as ordinary React code.
 *
 * Every member is resolved lazily and falls back to an inert stub, so a
 * dashboard without the plugin SDK still loads the script (the entry point then
 * registers nothing) and a bundle evaluated before the SDK exists still works.
 *
 * The signatures below exist so `tsc -p tsconfig.json` gives real signal on the
 * plugin's own code; the runtime forwards to the host verbatim.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- bridging an untyped host global */

type AnyFn = (...args: any[]) => any

export type ReactNode = any
export type ReactElement = any
export type ReactFragment = any
export type PropsWithChildren<P = unknown> = P & { children?: ReactNode }
export type CSSProperties = Record<string, string | number | undefined>

interface HostReact {
  createElement: (type: any, props?: any, ...children: any[]) => any
  Fragment: any
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void]
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void
  useLayoutEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void
  useCallback: <T extends AnyFn>(fn: T, deps?: readonly unknown[]) => T
  useMemo: <T>(factory: () => T, deps?: readonly unknown[]) => T
  useRef: <T>(initial: T) => { current: T }
  useContext: <T>(context: any) => T
  createContext: (initial: any) => any
  memo: <T>(component: T) => T
  forwardRef: (render: AnyFn) => any
}

const noop = (): null => null

const fallback: HostReact = {
  createElement: noop,
  Fragment: null,
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as AnyFn)() : initial, noop],
  useEffect: noop,
  useLayoutEffect: noop,
  useCallback: ((fn: AnyFn) => fn) as HostReact['useCallback'],
  useMemo: (factory: AnyFn) => factory(),
  useRef: ((value: unknown) => ({ current: value })) as HostReact['useRef'],
  useContext: (() => null) as unknown as HostReact['useContext'],
  createContext: () => ({ Provider: noop, Consumer: noop }),
  memo: ((component: unknown) => component) as HostReact['memo'],
  forwardRef: () => noop
}

function hostReact(): HostReact | undefined {
  if (typeof window === 'undefined') return undefined
  const sdk = (window as unknown as { __HERMES_PLUGIN_SDK__?: { React?: unknown } }).__HERMES_PLUGIN_SDK__
  return (sdk?.React as HostReact | undefined) ?? undefined
}

const member = <K extends keyof HostReact>(key: K): HostReact[K] => (hostReact() ?? fallback)[key]

export const createElement: HostReact['createElement'] = (...args) => member('createElement')(...args)
/** Same well-known symbol the JSX runtime uses (see ./jsx-runtime.ts). */
export const Fragment: any = Symbol.for('react.fragment')
export const useState: HostReact['useState'] = (initial: any) => member('useState')(initial)
export const useEffect: HostReact['useEffect'] = (effect, deps) => member('useEffect')(effect, deps)
export const useLayoutEffect: HostReact['useLayoutEffect'] = (effect, deps) => member('useLayoutEffect')(effect, deps)
export const useCallback: HostReact['useCallback'] = (fn: any, deps?: readonly unknown[]) => member('useCallback')(fn, deps)
export const useMemo: HostReact['useMemo'] = (factory: any, deps?: readonly unknown[]) => member('useMemo')(factory, deps)
export const useRef: HostReact['useRef'] = (initial: any) => member('useRef')(initial)
export const useContext: HostReact['useContext'] = (context: any) => member('useContext')(context)
export const createContext: HostReact['createContext'] = (initial: any) => member('createContext')(initial)
export const memo: HostReact['memo'] = (component: any) => member('memo')(component)
export const forwardRef: HostReact['forwardRef'] = (render: any) => member('forwardRef')(render)

const React = {
  createElement,
  Fragment,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useContext,
  createContext,
  memo,
  forwardRef
}

export default React
