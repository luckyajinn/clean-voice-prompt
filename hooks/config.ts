// The mod's options, from the fields plugin.json's `userConfig` declares.

import type { Level } from './clean'

export type Mode = 'auto' | 'review' | 'off'

export type Config = {
  mode: Mode
  level: Level
  receipt: boolean
  bridge: boolean
}

type Options = Readonly<Record<string, unknown>>

/** Reads the options, falling back to the manifest's defaults where a value is missing or not what was declared. */
export const readConfig = (options: Options): Config => ({
  mode: options.mode === 'review' || options.mode === 'off' ? options.mode : 'auto',
  level: options.level === 'aggressive' ? 'aggressive' : 'standard',
  receipt: options.receipt !== false,
  bridge: options.bridge !== false,
})
