import type { EngineInterface, Register } from 'claude-code'

import { readConfig } from './config'
import { runCommand } from './command'
import { decide } from './submit'
import type { Session } from './submit'
import { addPrompt, saved } from './totals'

export const register: Register = (on, options) => {
  const config = readConfig(options)

  // The session's own settings and memory. Module variables start over on a
  // reload, which only happens while the mod is being edited.
  const session: Session = { mode: config.mode, level: config.level }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clean-voice-prompt',
      description: 'Voice prompt cleaner: status, on/off/review, last before and after, try a sentence',
    })

    return next(e)
  })

  on('command.run', { command: 'clean-voice-prompt' }, async ($, e) => ({ text: await runCommand($, config, session, e.args) }))

  on('prompt.submit', async ($, e, next) => {
    const decision = decide(e, config, session)

    switch (decision.kind) {
      case 'pass':
        return next(e)

      case 'raw':
        return next({ ...e, text: decision.text })

      case 'review': {
        const filled = await $.prompt.fill({ text: decision.cleaned, mode: 'replace' })

        if (filled.isFilled) {
          session.offered = { original: e.text, cleaned: decision.cleaned }
          remember(session, e.text, decision.cleaned, decision.removed)

          return { drop: reviewNote(e.text, decision.cleaned) }
        }

        // No box to put it back in (a dialog is open, or none is drawn): send it cleaned.
        break
      }

      case 'clean':
        break
    }

    remember(session, e.text, decision.cleaned, decision.removed)

    // Side effects come before `next`, so nothing can fail once the prompt is on its way.
    await tally($, e.text, decision.cleaned)

    if (config.receipt) {
      $.ui.toast(receipt(e.text, decision.cleaned, decision.removed.length), { timeoutMs: 6_000 })
    }

    return next({ ...e, text: decision.cleaned })
  }).catch(($, e, next) => next(e)) // fail open: a cleaner that breaks sends the prompt as typed
}

function remember(session: Session, original: string, cleaned: string, removed: readonly string[]): void {
  session.last = { original, cleaned, removed: [...removed] }
}

function receipt(original: string, cleaned: string, cuts: number): string {
  const { chars, tokens } = saved(original, cleaned)

  return `clean-voice-prompt: ${cuts} cut${cuts === 1 ? '' : 's'}, ${chars} chars, about ${tokens} token${tokens === 1 ? '' : 's'} saved. /clean-voice-prompt last shows the before and after.`
}

function reviewNote(original: string, cleaned: string): string {
  const { chars } = saved(original, cleaned)

  return `clean-voice-prompt put a cleaned version back in the box (${chars} chars shorter). Press Enter to send it, or run /clean-voice-prompt original to get back what you said.`
}

async function tally($: EngineInterface, original: string, cleaned: string): Promise<void> {
  try {
    // Spelled out: the engine reads which nouns a hook touches from the source.
    await addPrompt({ get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) }, original, cleaned)
  } catch {
    // A tally that cannot be kept is not worth holding the prompt for.
  }
}
