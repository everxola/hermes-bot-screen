/**
 * Bot Screen plugin — settings storage.
 *
 * Preferences live in localStorage scoped to the profile the pane speaks for
 * (`hermes-bot-screen:<key>:<profile>`), so two profiles watching their own
 * desktops in the same browser do not overwrite each other's quality, fit or
 * dock state. Keys written by the unscoped versions of the plugin are read as
 * a one-time fallback and re-written scoped on the next change.
 */

import { profileScope } from './display'

const PREFIX = 'hermes-bot-screen'

function scopedKey(key: string): string {
  return `${PREFIX}:${key}:${profileScope() || 'default'}`
}

export function readSetting(key: string): string | null {
  try {
    const value = localStorage.getItem(scopedKey(key))
    if (value !== null) return value
    // Legacy unscoped key (`hermes-bot-screen-quality`, `...-dock-open`).
    return localStorage.getItem(`${PREFIX}-${key}`)
  } catch {
    return null /* privacy mode / storage blocked */
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(scopedKey(key), value)
  } catch {
    /* privacy mode: the choice simply does not persist */
  }
}
