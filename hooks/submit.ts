// What to do with one submitted prompt, decided without touching the engine,
// so the whole policy can be tested as a plain function.

import { clean } from './clean'
import type { Level } from './clean'
import type { Config, Mode } from './config'

export type Session = {
  mode: Mode
  level: Level
  /** Whether the small-model trim runs (see condense.ts). */
  condense: boolean
  /** The last prompt that was cleaned, for `/clean-voice-prompt last` and `original`. */
  last?: Last
  /** In review mode: the cleaned text put back in the box, and what it replaced. */
  offered?: { original: string; cleaned: string }
}

export type Last = {
  original: string
  cleaned: string
  removed: string[]
  /** True when the small model trimmed it. */
  condensed?: boolean
  /** Why the small model's trim was not used, when one was asked for. */
  condenseNote?: string
}

type Submitted = {
  text: string
  command?: unknown
  isMeta?: true
  origin?: { kind: string }
}

export type Decision =
  | { kind: 'pass' }
  | { kind: 'raw'; text: string }
  /** `changed` is false when the word-level clean cut nothing; the trim may still cut something. */
  | { kind: 'clean' | 'review'; cleaned: string; removed: string[]; changed: boolean }

/** Typed (or said) first, it sends the rest of the prompt untouched. */
const RAW = /^\s*raw:[ \t]?/i

export function decide(e: Submitted, config: Config, session: Session): Decision {
  const origin = e.origin?.kind
  const isPerson = origin === 'composer' || (origin === 'bridge' && config.bridge)

  // Slash commands, prompts the person does not see, and everything a
  // machine sent (notifications, peers, schedules, other plugins) pass as is.
  if (e.command !== undefined || e.isMeta === true || !isPerson) {
    return { kind: 'pass' }
  }

  if (RAW.test(e.text)) {
    const rest = e.text.replace(RAW, '')

    return rest.trim() === '' ? { kind: 'pass' } : { kind: 'raw', text: rest }
  }

  if (session.mode === 'off') {
    return { kind: 'pass' }
  }

  // In review mode, sending back what was offered, or what it replaced, is the person's choice.
  const offered = session.offered

  if (offered !== undefined && (e.text === offered.cleaned || e.text === offered.original)) {
    session.offered = undefined

    return { kind: 'pass' }
  }

  const result = clean(e.text, { level: session.level })

  if (!result.changed && !session.condense) {
    return { kind: 'pass' }
  }

  // There is no box to review in from the phone.
  const kind = session.mode === 'review' && origin === 'composer' ? 'review' : 'clean'

  return { kind, cleaned: result.text, removed: result.removed, changed: result.changed }
}
