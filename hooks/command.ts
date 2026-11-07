// `/clean-voice-prompt <args>`: status, switching mode and level for this
// session, the last before and after, and a dry run on any text.

import type { EngineInterface } from 'claude-code'

import { clean } from './clean'
import { condense, shouldCondense } from './condense'
import type { Config } from './config'
import type { Last, Session } from './submit'
import { KEY, readTotals } from './totals'

const HELP = [
  'Usage: /clean-voice-prompt [status | on | review | off | standard | aggressive | trim on | trim off | last | original | try <text>]',
  '  status       mode, level and what has been saved',
  '  on | review | off   auto-clean and send / put the cleaned prompt back in the box / leave prompts alone (this session)',
  '  standard | aggressive   how much to cut (this session)',
  '  trim on | trim off   let a small model trim tangents and over-explaining from long prompts (this session)',
  '  last         the last cleaned prompt, before and after',
  '  original     put the last prompt back in the box as you said it',
  '  try <text>   show what would be cut from <text>, without sending anything (trimming it too costs a small model call)',
  'Start a prompt with raw: to send it untouched. Defaults live in the plugin config.',
].join('\n')

export async function runCommand($: EngineInterface, config: Config, session: Session, args: string): Promise<string> {
  const trimmed = args.trim()
  const [verb = 'status', ...restWords] = trimmed.split(/\s+/)
  const rest = trimmed.slice(verb.length).trim()

  switch (verb.toLowerCase()) {
    case '':
    case 'status':
      return status($, config, session)

    case 'on':
    case 'auto':
      session.mode = 'auto'

      return 'clean-voice-prompt: on. Prompts are cleaned and sent, with a receipt.'

    case 'review':
      session.mode = 'review'

      return 'clean-voice-prompt: review. A cleaned prompt goes back in the box; Enter sends it.'

    case 'off':
      session.mode = 'off'
      session.offered = undefined

      return 'clean-voice-prompt: off for this session. /clean-voice-prompt on turns it back on.'

    case 'standard':
    case 'aggressive':
      session.level = verb.toLowerCase() as 'standard' | 'aggressive'

      return `clean-voice-prompt: level ${session.level} for this session.`

    case 'trim': {
      const [setting] = restWords

      if (setting === 'on' || setting === 'off') {
        session.condense = setting === 'on'

        return session.condense
          ? 'clean-voice-prompt: trim on for this session. Prompts of 40 words or more are also trimmed by a small model, and sent as cleaned if its version fails a check.'
          : 'clean-voice-prompt: trim off for this session. Only the word-level clean runs.'
      }

      return `clean-voice-prompt: trim is ${session.condense ? 'on' : 'off'}. Usage: /clean-voice-prompt trim on|off`
    }

    case 'last':
      return session.last === undefined ? 'clean-voice-prompt: nothing cleaned yet this session.' : beforeAfter(session.last)

    case 'original': {
      if (session.last === undefined) {
        return 'clean-voice-prompt: nothing cleaned yet this session.'
      }

      const original = session.last.original
      // Sent back unchanged, it passes untouched (see `offered` in submit.ts).
      session.offered = { original, cleaned: session.last.cleaned }

      const filled = await $.prompt.fill({ text: original, mode: 'replace' })

      return filled.isFilled
        ? 'clean-voice-prompt: your original prompt is back in the box. Enter sends it as is.'
        : `clean-voice-prompt: could not reach the prompt box. Your original prompt was:\n${original}`
    }

    case 'try': {
      if (restWords.length === 0) {
        return 'Usage: /clean-voice-prompt try <text>'
      }

      const result = clean(rest, { level: session.level })
      let last: Last = { original: rest, cleaned: result.text, removed: result.removed }

      if (session.condense && shouldCondense(result.text)) {
        const trimmed = await condense($, result.text)

        last = trimmed.ok ? { ...last, cleaned: trimmed.text, condensed: true } : { ...last, condenseNote: trimmed.reason }
      }

      return last.cleaned !== rest || last.condenseNote !== undefined ? beforeAfter(last) : 'clean-voice-prompt: nothing to cut.'
    }

    default:
      return HELP
  }
}

async function status($: EngineInterface, config: Config, session: Session): Promise<string> {
  let totals = readTotals(undefined)

  try {
    totals = readTotals(await $.store.get(KEY))
  } catch {
    // Shown as zero.
  }

  const lines = [
    `clean-voice-prompt: ${session.mode}, level ${session.level}, trim ${session.condense ? 'on' : 'off'}${session.mode !== config.mode || session.level !== config.level || session.condense !== config.condense ? ` (config default: ${config.mode}, ${config.level}, trim ${config.condense ? 'on' : 'off'})` : ''}.`,
    `Saved so far: ${totals.prompts} prompt${totals.prompts === 1 ? '' : 's'} cleaned (${totals.trimmed} trimmed), ${totals.chars} chars, about ${totals.tokens} tokens.`,
    '',
    HELP,
  ]

  return lines.join('\n')
}

function beforeAfter(last: Last): string {
  const { original, cleaned, removed } = last
  const trim =
    last.condensed === true
      ? 'Trimmed by a small model, after the word-level cuts.'
      : last.condenseNote !== undefined
        ? `Not trimmed: ${last.condenseNote}.`
        : undefined

  return [
    'Before:',
    original,
    '',
    'After:',
    cleaned,
    '',
    `Cut (${removed.length}): ${removed.length === 0 ? 'nothing' : removed.map(r => `"${r}"`).join(', ')}`,
    ...(trim === undefined ? [] : [trim]),
    `${original.length} -> ${cleaned.length} chars.`,
  ].join('\n')
}
