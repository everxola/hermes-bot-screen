/**
 * noVNC ships plain JS without type declarations, and the plugin's bundle only
 * consumes its RFB client constructor (the same client the Desktop app uses).
 * The runtime path is aliased to `<hermes-repo>/node_modules/@novnc/novnc/core/rfb.js`
 * by build.mjs, so only the constructor surface is described here.
 */

declare module '@novnc/novnc' {
  export default class Rfb {
    constructor(target: HTMLElement, urlOrSocket: string | WebSocket, options?: Record<string, unknown>)
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    clipViewport: boolean
    background: string
    qualityLevel: number
    compressionLevel: number
    addEventListener(type: string, handler: (event: { detail?: { clean?: boolean; reason?: string } }) => void): void
    removeEventListener(type: string, handler: (event: { detail?: { clean?: boolean; reason?: string } }) => void): void
    disconnect(): void
    focus(): void
    blur(): void
    clipboardPasteFrom(text: string): void
  }
}
