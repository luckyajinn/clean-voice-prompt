import { expect, test } from 'claude-code/testing'

import { clean, MAX_CHARS } from './clean'
import { CLEANED, UNCHANGED } from './samples'

for (const sample of CLEANED) {
  test(`cleans: ${sample.name}`, () => {
    const result = clean(sample.input, { level: sample.level })

    expect(result.text).toBe(sample.expected)
    expect(result.changed).toBe(sample.input !== sample.expected)
  })
}

for (const sample of UNCHANGED) {
  test(`leaves alone: ${sample.name}`, () => {
    const result = clean(sample.input)

    expect(result.text).toBe(sample.input)
    expect(result.changed).toBe(false)
    expect(result.removed).toEqual([])
  })
}

test('a prompt over the length limit is left alone', () => {
  const long = `Um, ${'fix the parser please. '.repeat(Math.ceil(MAX_CHARS / 20))}`

  expect(long.length > MAX_CHARS).toBe(true)
  expect(clean(long).changed).toBe(false)
  expect(clean(long, { maxChars: long.length }).changed).toBe(true)
})

test('text holding the placeholder characters is left alone', () => {
  const odd = 'Um, keep \uE000 this \uE001 as it is please.'

  expect(clean(odd).text).toBe(odd)
})

test('what was cut is reported, a phrase as one entry', () => {
  const result = clean('So, like, the build is, you know, slow, um, on CI.')

  expect(result.text).toBe('The build is slow, on CI.')
  expect([...result.removed].sort()).toEqual(['So', 'like', 'um', 'you know'].sort())
})

// ---------------------------------------------------------------------------
// Properties, over every sample and a deterministic batch of generated prompts.

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function random(seed: number): () => number {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PIECES = [
  'um', 'uh,', 'Um,', 'so', 'So,', 'yeah', 'Yeah,', 'okay', 'like', ', like,', 'you know', ', you know,', 'I mean,',
  'the', 'the the', 'I', 'I I', 'and', 'fix', 'the bug', 'in', 'src/app.ts', '`npm test`', '"quoted like um"', 'https://x.io/a?b=1',
  '--force', '42', '3.14', 'v1.2.3', 'snake_case', 'camelCase', 'please', 'it', 'crashes.', 'works?', 'now.', '(um)', '\n', 'right', 'well',
  'had had', 'is is', 'no no', '\u201cuh\u201d', "'so like'", 'look,', 'actually,', 'C:\\temp\\um.txt', '$HOME', '@me', '…',
]

function generated(count: number): string[] {
  const next = random(20261106)

  return Array.from({ length: count }, () => {
    const words = Array.from({ length: 4 + Math.floor(next() * 22) }, () => PIECES[Math.floor(next() * PIECES.length)] ?? '')

    return words.join(' ')
  })
}

const PROTECTED = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /"[^"\n]+"/g,
  /\u201c[^\u201d\n]+\u201d/g,
  /https?:\/\/\S*[^\s.,;:!?)]/g,
  /\S*\d\S*/g,
  /\S*[\\/_$@]\S*/g,
]

/** Every code-like or numeric span, as it appears, in order. */
const spansOf = (text: string): string[] => PROTECTED.flatMap(re => text.match(re) ?? []).map(s => s.replace(/[,.;:!?)]+$/, ''))

const digitsOf = (text: string): string => [...text.replace(/[^0-9]/g, '')].sort().join('')

const inputs = [...CLEANED.map(s => s.input), ...UNCHANGED.map(s => s.input), ...generated(400)]

test('cleaning a cleaned prompt changes nothing', () => {
  for (const input of inputs) {
    for (const level of ['standard', 'aggressive'] as const) {
      const once = clean(input, { level }).text

      expect({ input, level, twice: clean(once, { level }).text }).toEqual({ input, level, twice: once })
    }
  }
})

test('a cleaned prompt is never longer, never empty, and keeps every digit', () => {
  for (const input of inputs) {
    const { text, changed } = clean(input, { level: 'aggressive' })

    if (changed) {
      expect(text.length < input.length).toBe(true)
      expect(text.trim() === '').toBe(false)
    }

    expect({ input, digits: digitsOf(text) }).toEqual({ input, digits: digitsOf(input) })
  }
})

test('code, quotes, URLs, paths and numbers come through byte for byte', () => {
  for (const input of inputs) {
    const { text } = clean(input, { level: 'aggressive' })

    for (const span of spansOf(input)) {
      expect({ input, span, kept: text.includes(span) }).toEqual({ input, span, kept: true })
    }
  }
})

test('every line break is kept', () => {
  for (const input of inputs) {
    const { text } = clean(input)

    expect({ input, breaks: text.split('\n').length }).toEqual({ input, breaks: input.split('\n').length })
  }
})
