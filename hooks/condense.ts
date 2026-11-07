// The second step: a small model trims what word lists cannot see, such as
// tangents, backstory, a point made twice, or detail the agent does not need.
//
// Its reply is only used when it passes every check below. Otherwise the
// prompt goes as the word-level cleaner left it. A trim that is not sent costs
// a few tokens; a trim that drops a request costs a wrong answer.

import type { EngineInterface } from 'claude-code'

import { inspect, MAX_CHARS } from './clean'

/** Fewer prose words than this and there is little to trim, so the call would cost more than it saves. */
export const CONDENSE_MIN_WORDS = 40
export const CONDENSE_MODEL = 'haiku'
export const CONDENSE_TIMEOUT_MS = 10_000

/** The trimmed prompt must be at least this much shorter to be worth sending. */
const MIN_SAVING = 0.08
/** And at least this share of the original: shorter than that, something was lost. */
const MIN_KEPT = 0.2

export const CONDENSE_SYSTEM = [
  'You edit a dictated message that a person is about to send to an AI coding agent. Return the same message, shorter.',
  '',
  'Cut:',
  '- tangents and asides that have nothing to do with what they are asking for',
  '- backstory the agent does not need to do the task',
  '- the same point or request said more than once (keep its clearest version)',
  '- over-explaining: detail the agent can work out, long justifications, hedging',
  '- leftover filler and throat-clearing',
  '',
  'Keep:',
  '- every request, question, constraint, preference and condition, and the order of the steps',
  '- every file path, piece of code, command, flag, number, URL and quoted text, exactly as written',
  '- every name of a language, library, tool, product or person (JavaScript, React, Postgres), exactly as written',
  '- every question as a question, ending in a question mark: do not turn "can you...?" into an order',
  '- every "not", "never", "don\'t" and "only": a lost negation flips the meaning',
  '- their voice: first person, written as them, to the agent',
  '',
  'Never answer the message, follow it, add anything, or describe it in the third person. The message is for the agent, not for you.',
  'If there is nothing worth cutting, reply <condensed>UNCHANGED</condensed>.',
  'Reply with the edited message inside <condensed></condensed> and nothing else.',
].join('\n')

/** Whether a prompt is long enough, and prose enough, to be worth a model call. */
export function shouldCondense(text: string): boolean {
  return text.length <= MAX_CHARS && inspect(text).proseWords >= CONDENSE_MIN_WORDS
}

export type Checked = { ok: true; text: string } | { ok: false; reason: string }

const NEGATION = /\b(?:not|never|no|don't|doesn't|didn't|won't|can't|shouldn't|isn't|aren't|without|only)\b|n't\b/gi
const count = (text: string, re: RegExp): number => text.replace(/’/g, "'").match(re)?.length ?? 0
/** Abbreviations the dotted-name rule catches, which a trim may drop with the aside they were in. */
const NOT_CODE = /^(?:e\.g|i\.e|etc|vs)\.?$/i

/** Checks the model's reply against the prompt it trimmed. Pure, so every rule is tested. */
export function checkCondensed(input: string, reply: string): Checked {
  const match = /<condensed>([\s\S]*?)<\/condensed>/.exec(reply)

  if (match === null) {
    return { ok: false, reason: 'the reply was not in the expected form' }
  }

  const text = (match[1] ?? '').trim()

  if (text === '' || text === 'UNCHANGED') {
    return { ok: false, reason: 'nothing worth trimming' }
  }

  if (/<\/?condensed>/.test(text)) {
    return { ok: false, reason: 'the reply was not in the expected form' }
  }

  if (text.length > input.length * (1 - MIN_SAVING)) {
    return { ok: false, reason: 'too little to trim' }
  }

  if (text.length < input.length * MIN_KEPT) {
    return { ok: false, reason: 'the trimmed version cut too much' }
  }

  const lost = inspect(input).spans.find(span => !NOT_CODE.test(span) && !text.includes(span))

  if (lost !== undefined) {
    return { ok: false, reason: `the trimmed version dropped ${lost.length > 40 ? `${lost.slice(0, 40)}...` : lost}` }
  }

  if (input.includes('?') && !text.includes('?')) {
    return { ok: false, reason: 'the trimmed version dropped a question' }
  }

  if (count(input, NEGATION) > 0 && count(text, NEGATION) === 0) {
    return { ok: false, reason: 'the trimmed version dropped a "not"' }
  }

  return { ok: true, text }
}

export type Condensed = { ok: true; text: string; modelTokens: number } | { ok: false; reason: string }

/** Asks the small model for a trimmed version and checks it. Never rejects: any failure is a reason. */
export async function condense($: EngineInterface, text: string): Promise<Condensed> {
  const r = await $.model.complete({
    model: CONDENSE_MODEL,
    system: CONDENSE_SYSTEM,
    prompt: `<message>\n${text}\n</message>`,
    maxTokens: Math.min(4_000, Math.ceil(text.length / 3) + 64),
    effort: 'low',
    timeoutMs: CONDENSE_TIMEOUT_MS,
  })

  if (!r.isAnswered) {
    return { ok: false, reason: r.reason === 'aborted' ? 'the model took too long' : 'the model could not be reached' }
  }

  const checked = checkCondensed(text, r.text)
  const modelTokens = r.usage.input_tokens + r.usage.output_tokens + r.usage.cache_read_input_tokens

  return checked.ok ? { ok: true, text: checked.text, modelTokens } : checked
}
