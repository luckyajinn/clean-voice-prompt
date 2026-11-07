import type { EngineInterface, Register } from 'claude-code'

import { readConfig } from './config'
import { runCommand } from './command'
import { condense, shouldCondense } from './condense'
import { decide } from './submit'
import type { Last, Session } from './submit'
import { addPrompt, saved } from './totals'

export const register: Register = (on, options) => {
  const config = readConfig(options)

  // The session's own settings and memory. Module variables start over on a
  // reload, which only happens while the mod is being edited.
  const session: Session = { mode: config.mode, level: config.level, condense: config.condense }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clean-voice-prompt',
      description: 'Voice prompt cleaner: status, on/off/review, trim on/off, last before and after, try a sentence',
    })

    return next(e)
  })

  on('command.run', { command: 'clean-voice-prompt' }, async ($, e) => ({ text: await runCommand($, config, session, e.args) }))

  on('prompt.submit', async ($, e, next) => {
    const decision = decide(e, config, session)

    if (decision.kind === 'pass') {
      return next(e)
    }

    if (decision.kind === 'raw') {
      return next({ ...e, text: decision.text })
    }

    const last = await trimmed($, session, e.text, decision.cleaned, decision.removed)

    if (!decision.changed && last.condensed !== true) {
      // Nothing cut. A trim that was tried and not used is still worth a look later.
      if (last.condenseNote !== undefined) {
        session.last = { ...last, cleaned: e.text }
      }

      return next(e)
    }

    if (decision.kind === 'review') {
      const filled = await $.prompt.fill({ text: last.cleaned, mode: 'replace' })

      if (filled.isFilled) {
        session.offered = { original: e.text, cleaned: last.cleaned }
        session.last = last

        return { drop: reviewNote(last) }
      }

      // No box to put it back in (a dialog is open, or none is drawn): send it cleaned.
    }

    session.last = last

    // Side effects come before `next`, so nothing can fail once the prompt is on its way.
    await tally($, e.text, last.cleaned, last.condensed === true)

    if (config.receipt) {
      $.ui.toast(receipt(last), { timeoutMs: 6_000 })
    }

    return next({ ...e, text: last.cleaned })
  }).catch(($, e, next) => next(e)) // fail open: a cleaner that breaks sends the prompt as typed
}

/** Runs the small-model trim over the word-level result when it is on and the prompt is long enough. */
async function trimmed($: EngineInterface, session: Session, original: string, cleaned: string, removed: readonly string[]): Promise<Last> {
  const last: Last = { original, cleaned, removed: [...removed] }

  if (!session.condense || !shouldCondense(cleaned)) {
    return last
  }

  $.ui.status('clean-voice-prompt: trimming the prompt...')

  try {
    const result = await condense($, cleaned)

    if (result.ok) {
      return { ...last, cleaned: result.text, condensed: true }
    }

    return { ...last, condenseNote: result.reason }
  } catch {
    return { ...last, condenseNote: 'the model call failed' }
  } finally {
    $.ui.status(undefined)
  }
}

function receipt(last: Last): string {
  const { chars, tokens } = saved(last.original, last.cleaned)
  const cuts = last.removed.length
  const what = [cuts > 0 ? `${cuts} cut${cuts === 1 ? '' : 's'}` : '', last.condensed === true ? 'trimmed' : ''].filter(Boolean).join(' and ')

  return `clean-voice-prompt: ${what}, ${chars} chars, about ${tokens} token${tokens === 1 ? '' : 's'} saved. /clean-voice-prompt last shows the before and after.`
}

function reviewNote(last: Last): string {
  const { chars } = saved(last.original, last.cleaned)
  const what = last.condensed === true ? 'a cleaned and trimmed' : 'a cleaned'

  return `clean-voice-prompt put ${what} version back in the box (${chars} chars shorter). Press Enter to send it, or run /clean-voice-prompt original to get back what you said.`
}

async function tally($: EngineInterface, original: string, cleaned: string, condensed: boolean): Promise<void> {
  try {
    // Spelled out: the engine reads which nouns a hook touches from the source.
    await addPrompt({ get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) }, original, cleaned, condensed)
  } catch {
    // A tally that cannot be kept is not worth holding the prompt for.
  }
}
