import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const DICTATED = 'Um, so, like, I want you to, uh, fix the the login bug in src/auth/login.ts please.'
const CLEANED = 'I want you to fix the login bug in src/auth/login.ts please.'

// The test kit's types still ask for fields the engine stamps, hence the casts.
const said = ($: Engine, text: string, kind = 'composer') => $.prompt.submit({ text, origin: { kind } } as never)
const slash = ($: Engine, args: string) => $.command.run({ command: 'clean-voice-prompt', args } as never)

type Box = { refuses?: boolean }

const USAGE = { input_tokens: 300, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** What the stand-in small model does with a trim request: reply with text, or fail for a reason. */
type Model = (prompt: string) => string | 'aborted' | 'api-error' | 'deny'

// What the engine beneath the mod does in every test: a prompt that gets
// through enters as given, the box takes what is put in it, the store is in memory.
function engine(on: On, box: Box = {}, store: Record<string, unknown> = {}, model: Model = () => 'api-error') {
  const toasts: string[] = []
  const filled: string[] = []
  const registered: string[] = []
  const asked: { model: string; prompt: string; system?: string }[] = []
  const statuses: (string | undefined)[] = []

  mock.store(on, store)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.fill', (_, e) => {
    if (box.refuses === true) {
      return { isFilled: false, refusal: 'dialog' as const }
    }

    filled.push(e.text)

    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('model.complete', (_, e) => {
    asked.push({ model: e.model, prompt: e.prompt, system: e.system })

    const reply = model(e.prompt)

    if (reply === 'deny') {
      return { deny: 'no model here' }
    }

    if (reply === 'aborted') {
      return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE } }
    }

    if (reply === 'api-error') {
      return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: USAGE } }
    }

    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return { toasts, filled, registered, asked, statuses }
}

test('the command is registered when the session starts', async ($, on) => {
  const { registered } = engine(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(registered).toEqual(['clean-voice-prompt'])
})

test('a dictated prompt is cleaned before it is sent, with a receipt', async ($, on) => {
  const { toasts } = engine(on)
  const result = await said($, DICTATED)

  expect(result.text).toBe(CLEANED)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('clean-voice-prompt:')
  expect(toasts[0]).toContain(`${DICTATED.length - CLEANED.length} chars`)
})

test('a clean prompt goes through untouched and quietly', async ($, on) => {
  const { toasts } = engine(on)
  const text = 'Fix the login bug in src/auth/login.ts please.'

  expect((await said($, text)).text).toBe(text)
  expect(toasts).toEqual([])
})

test('the receipt can be turned off', { options: { receipt: false } }, async ($, on) => {
  const { toasts } = engine(on)

  expect((await said($, DICTATED)).text).toBe(CLEANED)
  expect(toasts).toEqual([])
})

test('raw: sends the rest untouched, without the prefix', async ($, on) => {
  const { toasts } = engine(on)

  expect((await said($, `raw: ${DICTATED}`)).text).toBe(DICTATED)
  expect((await said($, `RAW:${DICTATED}`)).text).toBe(DICTATED)
  expect(toasts).toEqual([])
})

test('prompts a machine sent are never cleaned', async ($, on) => {
  engine(on)

  for (const kind of ['task-notification', 'peer', 'peer-send-message', 'scheduled-trigger', 'sdk', 'plugin']) {
    expect((await said($, DICTATED, kind)).text).toBe(DICTATED)
  }
})

test('Remote Control prompts are cleaned unless that is switched off', async ($, on) => {
  engine(on)

  expect((await said($, DICTATED, 'bridge')).text).toBe(CLEANED)
})

test('Remote Control prompts are left alone when switched off', { options: { bridge: false } }, async ($, on) => {
  engine(on)

  expect((await said($, DICTATED, 'bridge')).text).toBe(DICTATED)
})

test('a slash command line is not touched', async ($, on) => {
  engine(on)

  const result = await $.prompt.submit({ text: '/review um the the diff', command: { name: 'review', args: 'um the the diff' }, origin: { kind: 'composer' } } as never)

  expect(result.text).toBe('/review um the the diff')
})

test('off in the config leaves every prompt alone', { options: { mode: 'off' } }, async ($, on) => {
  engine(on)

  expect((await said($, DICTATED)).text).toBe(DICTATED)
})

test('review mode puts the cleaned prompt back in the box, and sending it goes through', { options: { mode: 'review' } }, async ($, on) => {
  const { filled } = engine(on)
  const first = await said($, DICTATED)

  expect(first.drop).toContain('put a cleaned version back in the box')
  expect(filled).toEqual([CLEANED])

  expect((await said($, CLEANED)).text).toBe(CLEANED)
})

test('review mode: sending the original back sends it as said', { options: { mode: 'review' } }, async ($, on) => {
  engine(on)

  await said($, DICTATED)

  expect((await said($, DICTATED)).text).toBe(DICTATED)
  // Only once: the next time it is offered for review again.
  expect((await said($, DICTATED)).drop).toBeDefined()
})

test('review mode falls back to cleaning and sending when the box cannot take it', { options: { mode: 'review' } }, async ($, on) => {
  engine(on, { refuses: true })

  expect((await said($, DICTATED)).text).toBe(CLEANED)
})

test('review mode cleans Remote Control prompts straight away', { options: { mode: 'review' } }, async ($, on) => {
  const { filled } = engine(on)

  expect((await said($, DICTATED, 'bridge')).text).toBe(CLEANED)
  expect(filled).toEqual([])
})

test('/clean-voice-prompt off, review and on switch the mode for the session', async ($, on) => {
  const { filled } = engine(on)

  expect((await slash($, 'off')).text).toContain('off for this session')
  expect((await said($, DICTATED)).text).toBe(DICTATED)

  expect((await slash($, 'review')).text).toContain('review')
  expect((await said($, DICTATED)).drop).toBeDefined()
  expect(filled).toEqual([CLEANED])

  expect((await slash($, 'on')).text).toContain('on.')
  expect((await said($, 'Um, please run the tests in the api folder now.')).text).toBe('Please run the tests in the api folder now.')
})

test('/clean-voice-prompt aggressive cuts more for the session', async ($, on) => {
  engine(on)

  const text = 'The cache is, actually, never cleared, so add a TTL to it.'

  expect((await said($, text)).text).toBe(text)
  await slash($, 'aggressive')
  expect((await said($, text)).text).toBe('The cache is never cleared, so add a TTL to it.')
})

test('/clean-voice-prompt last shows the before and after', async ($, on) => {
  engine(on)

  expect((await slash($, 'last')).text).toContain('nothing cleaned yet')

  await said($, DICTATED)

  const shown = (await slash($, 'last')).text ?? ''

  expect(shown).toContain(DICTATED)
  expect(shown).toContain(CLEANED)
  expect(shown).toContain('"Um"')
})

test('/clean-voice-prompt original puts what was said back in the box, and it then goes through as is', async ($, on) => {
  const { filled } = engine(on)

  await said($, DICTATED)

  expect((await slash($, 'original')).text).toContain('back in the box')
  expect(filled).toEqual([DICTATED])
  expect((await said($, DICTATED)).text).toBe(DICTATED)
})

test('/clean-voice-prompt try shows a dry run and sends nothing', async ($, on) => {
  const { toasts } = engine(on)
  const shown = (await slash($, 'try Um, so, like, fix the the bug in the parser please')).text ?? ''

  expect(shown).toContain('After:\nFix the bug in the parser please')
  expect((await slash($, 'try fix the bug')).text).toContain('nothing to cut')
  expect(toasts).toEqual([])
})

test('status counts what was saved, across sessions', async ($, on) => {
  engine(on, {}, { totals: { prompts: 2, chars: 40, tokens: 10 } })

  await said($, DICTATED)

  const shown = (await slash($, 'status')).text ?? ''
  const chars = DICTATED.length - CLEANED.length

  expect(shown).toContain('auto, level standard')
  expect(shown).toContain(`3 prompts cleaned (0 trimmed), ${40 + chars} chars`)
})

test('a broken store never holds a prompt back', async ($, on) => {
  on('store.get', () => ({ deny: 'the store is broken' }))
  on('store.set', () => ({ deny: 'the store is broken' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))

  expect((await said($, DICTATED)).text).toBe(CLEANED)
})

test('an unknown argument shows the usage', async ($, on) => {
  engine(on)

  expect((await slash($, 'frobnicate')).text).toContain('Usage: /clean-voice-prompt')
})

// ---------------------------------------------------------------------------
// The small-model trim

const LONG =
  'Um, so, I want you to add a retry with backoff to the fetch call in src/api/client.ts. I was reading a blog post about this last week ' +
  'while my cat was sitting on the keyboard, which was funny, anyway. Basically the retries should stop after 3 tries and they should ' +
  'not retry on a 404. Like I said, it should stop after 3 tries and not retry on a 404, you know, because that just wastes time.'

const RAMBLE =
  'I want you to add a retry with backoff to the fetch call in src/api/client.ts. I was reading a blog post about this last week ' +
  'while my cat was sitting on the keyboard, which was funny. The retries should stop after 3 tries and they should not retry ' +
  'on a 404. As I said before, it should stop after 3 tries and not retry on a 404 because that wastes time.'

const TRIMMED = 'I want you to add a retry with backoff to the fetch call in src/api/client.ts. Stop after 3 tries, and do not retry on a 404.'

const trims: Model = () => `<condensed>${TRIMMED}</condensed>`

test('a long prompt is cleaned, then trimmed by the small model, with a receipt', async ($, on) => {
  const { toasts, asked, statuses } = engine(on, {}, {}, trims)
  const result = await said($, LONG)

  expect(result.text).toBe(TRIMMED)
  expect(asked).toHaveLength(1)
  expect(asked[0]?.model).toBe('haiku')
  // The model is sent the word-level result, not what was said.
  expect(asked[0]?.prompt).toContain('<message>\nI want you to add a retry')
  expect(asked[0]?.prompt).not.toContain('Um,')
  expect(asked[0]?.system).toContain('Never answer the message')
  expect(statuses).toEqual(['clean-voice-prompt: trimming the prompt...', undefined])
  expect(toasts[0]).toContain('trimmed')
})

test('a long prompt with nothing for the word lists can still be trimmed', async ($, on) => {
  const { toasts } = engine(on, {}, {}, trims)

  expect((await said($, RAMBLE)).text).toBe(TRIMMED)
  expect(toasts[0]).toContain('clean-voice-prompt: trimmed,')
})

test('a trim that drops a path is not used: the word-level clean is sent', async ($, on) => {
  engine(on, {}, {}, () => '<condensed>Add a retry with backoff to the fetch call. Stop after 3 tries, and do not retry on a 404.</condensed>')

  const result = (await said($, LONG)).text ?? ''

  expect(result).toContain('src/api/client.ts')
  expect(result).toContain('my cat was sitting on the keyboard')
  expect(result.startsWith('I want you to')).toBe(true)
  expect((await slash($, 'last')).text).toContain('Not trimmed: the trimmed version dropped src/api/client.ts.')
})

test('a model that times out, errors or is refused leaves the word-level clean', async ($, on) => {
  let reply: ReturnType<Model> = 'aborted'
  const { statuses } = engine(on, {}, {}, () => reply)

  const cleanedOnly = (await said($, LONG)).text ?? ''

  expect(cleanedOnly).toContain('my cat was sitting')
  expect(cleanedOnly.startsWith('I want you to')).toBe(true)
  expect((await slash($, 'last')).text).toContain('Not trimmed: the model took too long.')

  reply = 'api-error'
  expect((await said($, LONG)).text).toBe(cleanedOnly)

  reply = 'deny'
  expect((await said($, LONG)).text).toBe(cleanedOnly)
  expect((await slash($, 'last')).text).toContain('Not trimmed: the model call failed.')
  // The status line is cleared every time.
  expect(statuses.at(-1)).toBeUndefined()
})

test('a rambling prompt whose trim fails goes through untouched and quietly', async ($, on) => {
  const { toasts } = engine(on, {}, {}, () => '<condensed>UNCHANGED</condensed>')

  expect((await said($, RAMBLE)).text).toBe(RAMBLE)
  expect(toasts).toEqual([])
  expect((await slash($, 'last')).text).toContain('Not trimmed: nothing worth trimming.')
})

test('short prompts never call the model', async ($, on) => {
  const { asked } = engine(on, {}, {}, trims)

  expect((await said($, DICTATED)).text).toBe(CLEANED)
  expect(asked).toEqual([])
})

test('trim off in the config never calls the model', { options: { condense: false } }, async ($, on) => {
  const { asked } = engine(on, {}, {}, trims)

  expect((await said($, RAMBLE)).text).toBe(RAMBLE)
  expect(asked).toEqual([])
})

test('/clean-voice-prompt trim off and trim on switch it for the session', async ($, on) => {
  const { asked } = engine(on, {}, {}, trims)

  expect((await slash($, 'trim off')).text).toContain('trim off')
  expect((await said($, RAMBLE)).text).toBe(RAMBLE)
  expect(asked).toEqual([])
  expect((await slash($, 'status')).text).toContain('trim off (config default: auto, standard, trim on)')

  expect((await slash($, 'trim on')).text).toContain('trim on')
  expect((await said($, RAMBLE)).text).toBe(TRIMMED)
  expect((await slash($, 'trim')).text).toContain('trim is on')
})

test('raw: is never trimmed', async ($, on) => {
  const { asked } = engine(on, {}, {}, trims)

  expect((await said($, `raw: ${RAMBLE}`)).text).toBe(RAMBLE)
  expect(asked).toEqual([])
})

test('review mode puts the trimmed version in the box', { options: { mode: 'review' } }, async ($, on) => {
  const { filled } = engine(on, {}, {}, trims)
  const result = await said($, LONG)

  expect(result).toEqual({ drop: expect.stringContaining('a cleaned and trimmed version back in the box') })
  expect(filled).toEqual([TRIMMED])
  // Sending it goes through untouched, without a second model call.
  expect((await said($, TRIMMED)).text).toBe(TRIMMED)
})

test('status counts trimmed prompts', async ($, on) => {
  engine(on, {}, {}, trims)

  await said($, LONG)
  await said($, DICTATED)

  expect((await slash($, 'status')).text).toContain('2 prompts cleaned (1 trimmed)')
})

test('/clean-voice-prompt try trims too', async ($, on) => {
  const { asked, toasts } = engine(on, {}, {}, trims)
  const shown = (await slash($, `try ${LONG}`)).text ?? ''

  expect(shown).toContain(`After:\n${TRIMMED}`)
  expect(shown).toContain('Trimmed by a small model')
  expect(asked).toHaveLength(1)
  expect(toasts).toEqual([])
})
