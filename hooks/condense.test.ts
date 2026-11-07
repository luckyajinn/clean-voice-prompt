import { expect, test } from 'claude-code/testing'

import { checkCondensed, shouldCondense } from './condense'

const INPUT =
  'I want you to add a retry with backoff to the fetch call in src/api/client.ts. I was reading a blog post about this last week ' +
  'while my cat was sitting on the keyboard. Make it stop after 3 tries and do not retry on a 404. Can you also log each retry?'

const GOOD = 'Add a retry with backoff to the fetch call in src/api/client.ts. Stop after 3 tries and do not retry on a 404. Can you log each retry?'

const reply = (text: string) => `<condensed>${text}</condensed>`
const reason = (input: string, r: string) => {
  const checked = checkCondensed(input, r)

  return checked.ok ? 'ok' : checked.reason
}

test('a trim that keeps everything that matters is used', () => {
  expect(checkCondensed(INPUT, reply(GOOD))).toEqual({ ok: true, text: GOOD })
  // Whitespace around it inside the tags is dropped; text outside them is ignored.
  expect(checkCondensed(INPUT, `Here you go:\n<condensed>\n${GOOD}\n</condensed>`)).toEqual({ ok: true, text: GOOD })
})

test('a reply not in the expected form is not used', () => {
  expect(reason(INPUT, GOOD)).toBe('the reply was not in the expected form')
  expect(reason(INPUT, reply(`${GOOD} <condensed>`))).toBe('the reply was not in the expected form')
})

test('UNCHANGED or an empty reply means nothing to trim', () => {
  expect(reason(INPUT, reply('UNCHANGED'))).toBe('nothing worth trimming')
  expect(reason(INPUT, reply('  '))).toBe('nothing worth trimming')
})

test('a trim that saves too little, or cuts too much, is not used', () => {
  expect(reason(INPUT, reply(INPUT.slice(0, -3)))).toBe('too little to trim')
  expect(reason(INPUT, reply('Add retries in src/api/client.ts: 3, not 404?'))).toBe('the trimmed version cut too much')
})

test('a trim that drops a path, a number or quoted text is not used', () => {
  expect(reason(INPUT, reply(GOOD.replace('src/api/client.ts', 'the client')))).toBe('the trimmed version dropped src/api/client.ts')
  expect(reason(INPUT, reply(GOOD.replace('3 tries', 'three tries')))).toBe('the trimmed version dropped 3')

  const quoted = `${INPUT} Set the message to "Retrying, please wait" when it happens.`

  expect(reason(quoted, reply(`${GOOD} Show a retry message.`))).toBe('the trimmed version dropped "Retrying, please wait"')
  expect(reason(quoted, reply(`${GOOD} Show "Retrying, please wait".`))).toBe('ok')
})

test('a trim that drops a question or a "not" is not used', () => {
  expect(reason(INPUT, reply(GOOD.replace('Can you log each retry?', 'Log each retry.')))).toBe('the trimmed version dropped a question')

  const noNegation = 'Add a retry with backoff to the fetch call in src/api/client.ts. Stop after 3 tries, skipping a 404. Can you log each retry?'

  expect(reason(INPUT, reply(noNegation))).toBe('the trimmed version dropped a "not"')
  // "don't" stands in for "do not".
  expect(reason(INPUT, reply(GOOD.replace('do not', "don't")))).toBe('ok')
})

test('an aside holding e.g. may be cut', () => {
  const withAside = `${INPUT} I like small helpers, e.g. the ones in the old project, but whatever.`

  expect(reason(withAside, reply(GOOD))).toBe('ok')
})

test('only prompts of 40 prose words or more are sent to the model', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

  expect(shouldCondense(words(39))).toBe(false)
  expect(shouldCondense(words(40))).toBe(true)
  // Code, paths and numbers are not prose.
  expect(shouldCondense(`${words(30)} ${Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`).join(' ')}`)).toBe(false)
  expect(shouldCondense(`${words(30)}\n\`\`\`\n${words(50)}\n\`\`\``)).toBe(false)
  // Over the length limit, nothing is touched.
  expect(shouldCondense(words(900))).toBe(false)
})
