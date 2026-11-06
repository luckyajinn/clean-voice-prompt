import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const DICTATED = 'Um, so, like, I want you to, uh, fix the the login bug in src/auth/login.ts please.'
const CLEANED = 'I want you to fix the login bug in src/auth/login.ts please.'

// The test kit's types still ask for fields the engine stamps, hence the casts.
const said = ($: Engine, text: string, kind = 'composer') => $.prompt.submit({ text, origin: { kind } } as never)
const slash = ($: Engine, args: string) => $.command.run({ command: 'clean-voice-prompt', args } as never)

type Box = { refuses?: boolean }

// What the engine beneath the mod does in every test: a prompt that gets
// through enters as given, the box takes what is put in it, the store is in memory.
function engine(on: On, box: Box = {}, store: Record<string, unknown> = {}) {
  const toasts: string[] = []
  const filled: string[] = []
  const registered: string[] = []

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
  on('command.register', (_, e) => {
    registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return { toasts, filled, registered }
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
  expect(shown).toContain(`3 prompts cleaned, ${40 + chars} chars`)
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
