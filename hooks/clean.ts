// The cleaner: a pure function from a dictated prompt to a shorter one.
//
// It works in three steps.
//   1. Protect. Code, quotes, URLs, paths, flags, identifiers and anything with
//      a digit in it are swapped for placeholders, so no rule can touch them.
//   2. Cut. Per line, stuttered repeats are spliced out, then hesitations,
//      lead-ins and comma-bounded fillers are marked, then the line is drawn
//      again with the punctuation around each cut merged.
//   3. Restore. The placeholders get their text back, byte for byte.
// The pass repeats until nothing changes (a cut can expose another), so
// cleaning a cleaned prompt changes nothing.
//
// It leans towards leaving a filler in: a filler left costs a token, a word
// wrongly cut can cost a wrong answer.

export type Level = 'standard' | 'aggressive'

export type CleanOptions = {
  level?: Level
  /** Prompts longer than this are left alone (a long paste is rarely dictation). */
  maxChars?: number
}

export type CleanResult = {
  /** The cleaned prompt, or the input itself when nothing was cut. */
  text: string
  changed: boolean
  /** What was cut, in order, as written (a phrase is one entry). */
  removed: string[]
}

export const MAX_CHARS = 4000

// ---------------------------------------------------------------------------
// Word lists. Everything is compared lowercased, with ’ read as '.

/** Hesitation sounds: cut wherever they stand. `mm` is left out (millimetres). */
const HESITATIONS = new Set(['uh', 'uhh', 'uhhh', 'uhm', 'um', 'umm', 'ummm', 'er', 'erm', 'err', 'hm', 'hmm', 'hmmm', 'ehm'])

/** Sentence-opening lead-ins that are cut alone. */
const LEAD_HARD = new Set(['yeah', 'yep', 'yup', 'okay', 'ok', 'alright', 'anyway', 'anyways'])
/** Cut when a comma follows them, or beside a hard lead-in ("okay so"). */
const LEAD_SOFT = new Set(['so', 'basically'])
/** Cut only when a comma follows them: "well tested", "right click" stay. */
const LEAD_STRICT = new Set(['well', 'right'])

type Phrase = {
  words: string[]
  /** May open a sentence when a comma follows ("Like, the build..."). */
  atStart: boolean
  /** Only ever at a sentence start with a comma after ("I mean, ..."). */
  startOnly?: boolean
  /** May close a sentence when a comma comes before ("..., you know."). */
  atEnd?: boolean
}

const PHRASES_STANDARD: Phrase[] = [
  { words: ['you', 'know'], atStart: true, atEnd: true },
  { words: ['i', 'mean'], atStart: true, startOnly: true },
  { words: ['like'], atStart: true },
  // A yeah that opens a sentence is an answer or a lead-in: the lead-in rule
  // judges it, with its length checks. Here it is only ", yeah,".
  { words: ['yeah'], atStart: false },
  { words: ['yep'], atStart: false },
  { words: ['basically'], atStart: false },
]

const PHRASES_AGGRESSIVE: Phrase[] = [
  ...PHRASES_STANDARD,
  { words: ['actually'], atStart: true },
  { words: ['literally'], atStart: true },
  { words: ['honestly'], atStart: true },
  { words: ['obviously'], atStart: true },
  { words: ['essentially'], atStart: true },
  { words: ['look'], atStart: true, startOnly: true },
  { words: ['listen'], atStart: true, startOnly: true },
]

/**
 * Words whose doubling is a stutter, never grammar. Left out on purpose:
 * "had had", "that that", "is is" / "was was" ("what it is is"), "do do",
 * "no no", "so so", "very very", "can can", "will will".
 */
const REPEATABLE = new Set([
  'i', 'we', 'you', 'he', 'she', 'it', 'they', 'me', 'us', 'them',
  'the', 'a', 'an', 'and', 'but', 'or', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'into', 'about',
  'are', 'were', 'be', 'been', 'this', 'there', 'if', 'as', 'my', 'our', 'your', 'its', 'their',
  'should', 'would', 'could', 'want', 'need', 'think', 'just', 'then', 'when', 'what', 'where', 'how', 'why',
])

/**
 * A "like" with no commas around it is cut in two narrow spots only:
 * between a preposition and a question word ("a doc for like how this works"),
 * and between a form of "be" and an intensifier ("it's like super slow").
 * "The API is like a proxy", "looks like", "would like" and "like you did" stay.
 */
const LIKE_PREPOSITIONS = new Set(['for', 'about', 'of', 'with', 'from', 'into', 'on', 'at', 'in'])
const LIKE_QUESTIONS = new Set(['how', 'what', 'why', 'where', 'when', 'which', 'who', 'whether'])
const LIKE_BE = new Set([
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  "it's", "that's", "there's", "he's", "she's", "they're", "we're", "you're", "i'm",
])
const LIKE_INTENSIFIERS = new Set([
  'super', 'really', 'very', 'so', 'totally', 'kinda', 'kind', 'pretty', 'just', 'literally', 'actually',
  'completely', 'always', 'never', 'extremely', 'insanely', 'way',
])

/** Words fewer than this in the whole prompt: no lead-in or comma filler is cut. */
const MIN_PROMPT_WORDS = 6
/** Words a sentence must still hold after its lead-in is cut. */
const MIN_REST_WORDS = 3

// ---------------------------------------------------------------------------
// 1. Protect

const OPEN = ''
const CLOSE = ''
const HAS_MARKER = /[]/

type Keep = (value: string) => string

const LEAD = /^[("'“‘]+/
const TRAIL = /[,.;:!?"'”’]+$/

const count = (text: string, char: string): number => text.split(char).length - 1

/** True for a word that is code, a path, a number or a name, not prose. */
const isCodeLike = (core: string): boolean =>
  /\d/.test(core) ||
  /[\\/@#$%_=:{}[\]<>|&*~^+`]/.test(core) ||
  /[\p{L}\p{N}]\.[\p{L}\p{N}]/u.test(core) ||
  /^--?\p{L}/u.test(core) ||
  /\p{Ll}\p{Lu}/u.test(core) ||
  /\(\)$/.test(core)

/** Masks the code-like core of one whitespace-separated token, leaving its punctuation outside. */
function protectToken(token: string, keep: Keep): string {
  if (token.includes(OPEN)) {
    return token
  }

  const lead = LEAD.exec(token)?.[0] ?? ''
  let core = token.slice(lead.length)
  let trail = TRAIL.exec(core)?.[0] ?? ''

  core = core.slice(0, core.length - trail.length)

  // "(see foo.ts)": the closing bracket is the sentence's, not the path's.
  while (core.endsWith(')') && count(core, '(') < count(core, ')')) {
    core = core.slice(0, -1)
    trail = `)${trail}`
  }

  return core !== '' && isCodeLike(core) ? lead + keep(core) + trail : token
}

function protect(text: string): { masked: string; spans: string[] } {
  const spans: string[] = []
  const keep: Keep = value => {
    spans.push(value)

    return `${OPEN}${spans.length - 1}${CLOSE}`
  }

  const masked = text
    .replace(/```[\s\S]*?(?:```|$)/g, keep) // fenced code, closed or not
    .replace(/`[^`\n]+`/g, keep) // inline code
    .replace(/“[^”\n]{1,400}”/g, keep) // quoted text
    .replace(/"[^"\n]{1,400}"/g, keep)
    .replace(/(?<![\p{L}\p{N}])'[^'\n]{1,300}'(?![\p{L}\p{N}])/gu, keep)
    .replace(/^(?: {4,}|\t).*$/gm, keep) // indented code, pasted output
    .replace(/^>.*$/gm, keep) // quoted lines
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*[^\s.,;:!?)\]'"]/gi, keep) // URLs
    .replace(/\S+/g, token => protectToken(token, keep))

  return { masked, spans }
}

function restore(text: string, spans: readonly string[]): string {
  let out = text

  // A span can hold an earlier one (a URL around inline code), hence the loop.
  for (let i = 0; i < 4 && HAS_MARKER.test(out); i++) {
    out = out.replace(/(\d+)/g, (whole, n: string) => spans[Number(n)] ?? whole)
  }

  return out
}

// ---------------------------------------------------------------------------
// 2. Cut

type Kind = 'word' | 'ph' | 'punct' | 'space'
type Tok = { kind: Kind; text: string; removed: boolean }

const TOKEN = /\d+|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|\s+|\S/gu

function tokenize(line: string): Tok[] {
  const tokens: Tok[] = []

  for (const [text] of line.matchAll(TOKEN)) {
    const kind: Kind = text.startsWith(OPEN) && text.length > 2
      ? 'ph'
      : /^[\p{L}\p{N}]/u.test(text)
        ? 'word'
        : /^\s/.test(text)
          ? 'space'
          : 'punct'

    tokens.push({ kind, text, removed: false })
  }

  return tokens
}

const COMMAS = ',;'
const TERMINALS = '.!?…'
const OPENERS = '([{“‘'
const CLOSER_OF: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

/**
 * Words a clause cannot end on: a comma after one only ever set off the
 * filler that was cut, so it goes too ("want you to, uh, fix" -> "want you to fix").
 */
const NO_COMMA_AFTER = new Set([
  'to', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'if', 'and', 'but', 'or', 'nor',
  'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'into', 'onto', 'about', 'than', 'because',
  "it's", "that's", "i'm", "you're", "we're", "they're", "there's", "what's",
  'my', 'your', 'our', 'their', 'its', 'his', 'her', 'this', 'these', 'those', 'that', 'which', 'who', 'whose',
  'very', 'not', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'do', 'does', 'did', 'has', 'have', 'had', 'just', 'really', 'also', 'i', 'we', 'they', 'you', 'he', 'she',
  'then', 'now', 'first', 'next',
])

const normal = (text: string): string => text.toLowerCase().replace(/’/g, "'")

/** ALL CAPS is a choice (an acronym, emphasis): such words are never cut. "OK" is the exception. */
const isShouted = (text: string): boolean => text.length > 1 && text !== 'OK' && text === text.toUpperCase() && text !== text.toLowerCase()

const nonSpace = (tokens: readonly Tok[]): number[] => tokens.flatMap((t, i) => (t.kind === 'space' ? [] : [i]))

/**
 * Splices out the second copy of an immediately repeated word or 2-4 word
 * phrase ("the the", "I think I think"), with a comma between allowed.
 */
function dropRepeats(input: Tok[], removed: string[]): Tok[] {
  let tokens = input

  for (let guard = 0; guard < 200; guard++) {
    const sig = nonSpace(tokens)
    const wordAt = (k: number): string | undefined => {
      const t = tokens[sig[k] ?? -1]

      return t?.kind === 'word' && !isShouted(t.text) ? normal(t.text) : undefined
    }

    let cut: { from: number; to: number } | undefined

    search: for (let k = 0; k < sig.length; k++) {
      for (let n = 4; n >= 1; n--) {
        const first: string[] = []

        for (let j = 0; j < n; j++) {
          const word = wordAt(k + j)

          if (word === undefined) {
            break
          }

          first.push(word)
        }

        if (first.length < n) {
          continue
        }

        // "no no no", "very very": a single word over and over is left to the n = 1 rule.
        if (n > 1 && first.every(word => word === first[0])) {
          continue
        }

        if (n === 1 && !REPEATABLE.has(first[0] ?? '') && !(first[0] ?? '').includes("'")) {
          continue
        }

        const between = tokens[sig[k + n] ?? -1]
        const gap = between?.kind === 'punct' && between.text === ',' ? 1 : 0
        const second = Array.from({ length: n }, (_, j) => wordAt(k + n + gap + j))

        if (second.every((word, j) => word === first[j])) {
          const from = (sig[k + n - 1] ?? 0) + 1
          const to = sig[k + n + gap + n - 1] ?? from

          cut = { from, to }
          break search
        }
      }
    }

    if (cut === undefined) {
      return tokens
    }

    removed.push(
      tokens
        .slice(cut.from, cut.to + 1)
        .map(t => t.text)
        .join('')
        .replace(/^[\s,]+/, ''),
    )
    tokens = [...tokens.slice(0, cut.from), ...tokens.slice(cut.to + 1)]
  }

  return tokens
}

type LineContext = { level: Level; promptWords: number; removed: string[] }

/** Marks hesitations, lead-ins and comma-bounded fillers as removed. */
function markFillers(tokens: Tok[], ctx: LineContext): void {
  const sig = nonSpace(tokens)
  const n = sig.length
  const at = (k: number): Tok | undefined => tokens[sig[k] ?? -1]
  const wordAt = (k: number): string | undefined => {
    const t = at(k)

    return t?.kind === 'word' && !t.removed && !isShouted(t.text) ? normal(t.text) : undefined
  }
  const isPunct = (k: number, chars: string): boolean => {
    const t = at(k)

    return t?.kind === 'punct' && chars.includes(t.text)
  }
  const startsSentence = (k: number): boolean => k === 0 || isPunct(k - 1, TERMINALS)
  const cut = (k: number, length: number): void => {
    const words: string[] = []

    for (let j = k; j < k + length; j++) {
      const t = at(j)

      if (t !== undefined) {
        t.removed = true
        words.push(t.text)
      }
    }

    ctx.removed.push(words.join(' '))
  }
  /** Words and placeholders from `k` to the end of its sentence. */
  const wordsToSentenceEnd = (k: number): number => {
    let words = 0

    for (let j = k; j < n && !isPunct(j, TERMINALS); j++) {
      const kind = at(j)?.kind

      if (kind === 'word' || kind === 'ph') {
        words++
      }
    }

    return words
  }

  // Hesitations, wherever they stand.
  for (let k = 0; k < n; k++) {
    const word = wordAt(k)

    if (word !== undefined && HESITATIONS.has(word)) {
      cut(k, 1)
    }
  }

  if (ctx.promptWords < MIN_PROMPT_WORDS) {
    return
  }

  // Lead-ins: a chain like "Yeah, so", "Okay so basically", "Well," opening a sentence.
  for (let k = 0; k < n; k++) {
    if (!startsSentence(k)) {
      continue
    }

    const chain: { k: number; word: string; hasComma: boolean }[] = []
    let j = k

    while (j < n) {
      const word = wordAt(j)
      const hasComma = isPunct(j + 1, COMMAS)

      if (word === undefined || !(LEAD_HARD.has(word) || LEAD_SOFT.has(word) || (LEAD_STRICT.has(word) && hasComma))) {
        break
      }

      chain.push({ k: j, word, hasComma })
      j += hasComma ? 2 : 1
    }

    if (chain.length === 0 || wordsToSentenceEnd(j) < MIN_REST_WORDS) {
      continue
    }

    const hasHard = chain.some(link => LEAD_HARD.has(link.word))

    for (const link of chain) {
      if (LEAD_HARD.has(link.word) || LEAD_STRICT.has(link.word) || link.hasComma || hasHard) {
        cut(link.k, 1)
      }
    }
  }

  // A bare "like" between words that leave it no other job (see LIKE_PREPOSITIONS).
  for (let k = 1; k < n - 1; k++) {
    if (wordAt(k) !== 'like') {
      continue
    }

    const before = wordAt(k - 1)
    const after = wordAt(k + 1)

    if (
      before !== undefined &&
      after !== undefined &&
      ((LIKE_PREPOSITIONS.has(before) && LIKE_QUESTIONS.has(after)) || (LIKE_BE.has(before) && LIKE_INTENSIFIERS.has(after)))
    ) {
      cut(k, 1)
    }
  }

  // Comma-bounded fillers: ", like,", ", you know,", "I mean, ...".
  const phrases = ctx.level === 'aggressive' ? PHRASES_AGGRESSIVE : PHRASES_STANDARD

  for (let k = 0; k < n; k++) {
    for (const phrase of phrases) {
      const length = phrase.words.length

      if (!phrase.words.every((word, j) => wordAt(k + j) === word)) {
        continue
      }

      const commaBefore = isPunct(k - 1, COMMAS)
      const atStart = startsSentence(k)
      const commaAfter = isPunct(k + length, COMMAS)
      const atEnd = k + length >= n || isPunct(k + length, TERMINALS)
      const isFiller = phrase.startOnly
        ? atStart && commaAfter
        : ((commaBefore || (phrase.atStart && atStart)) && commaAfter) || (phrase.atEnd === true && commaBefore && atEnd)

      if (isFiller) {
        cut(k, length)
      }
    }
  }
}

/**
 * Draws a line again, merging what stood around each cut: of the
 * punctuation beside it a sentence end wins over a comma, a comma over
 * nothing, and one space is kept between the words either side.
 */
function render(tokens: Tok[]): string {
  const absorbs = (t: Tok): boolean => t.removed || t.kind === 'space' || (t.kind === 'punct' && (COMMAS + TERMINALS).includes(t.text))
  let out = ''
  let i = 0

  while (i < tokens.length) {
    const t = tokens[i]

    if (t === undefined) {
      break
    }

    if (!absorbs(t)) {
      out += t.text
      i++
      continue
    }

    let j = i

    while (j < tokens.length && absorbs(tokens[j] as Tok)) {
      j++
    }

    const run = tokens.slice(i, j)
    const firstCut = run.find(r => r.removed)

    if (firstCut === undefined) {
      out += run.map(r => r.text).join('')
      i = j
      continue
    }

    const before = tokens[i - 1]
    const after = tokens[j]
    const marks = run.filter(r => !r.removed && r.kind === 'punct').map(r => r.text)
    const end = marks.findIndex(mark => TERMINALS.includes(mark))
    let terminal = ''

    for (let m = end; m >= 0 && m < marks.length && TERMINALS.includes(marks[m] ?? ''); m++) {
      terminal += marks[m]
    }

    const isDangling = before?.kind === 'word' && NO_COMMA_AFTER.has(normal(before.text))
    const comma = isDangling ? '' : (marks.find(mark => COMMAS.includes(mark)) ?? '')
    let joint = before === undefined ? '' : after === undefined ? terminal : terminal || comma
    const afterIsWordLike = after !== undefined && (after.kind === 'word' || after.kind === 'ph' || OPENERS.includes(after.text))
    const beforeIsOpener = before?.kind === 'punct' && OPENERS.includes(before.text)

    // "the README (um) so" -> "the README so": brackets the cut left empty go too.
    if (joint === '' && before !== undefined && after !== undefined && CLOSER_OF[before.text] === after.text) {
      out = out.slice(0, out.length - before.text.length).replace(/[ \t]+$/, '')
      i = j + 1
      continue
    }

    if (before !== undefined && afterIsWordLike && !(joint === '' && beforeIsOpener)) {
      joint += ' '
    }

    // "Um, so the build" -> "The build"; "it broke. Yeah, so the build" -> "it broke. The build".
    const startsSentence = before === undefined || terminal !== ''

    if (after?.kind === 'word' && startsSentence && /^\p{Lu}/u.test(firstCut.text) && /^\p{Ll}/u.test(after.text)) {
      after.text = (after.text[0] ?? '').toUpperCase() + after.text.slice(1)
    }

    out += joint
    i = j
  }

  return out
}

function pass(text: string, level: Level, removed: string[]): string {
  const { masked, spans } = protect(text)
  const parts = masked.split(/(\r?\n)/)
  const lines = parts.map((part, i) => (i % 2 === 0 ? tokenize(part) : []))
  const promptWords = lines.flat().filter(t => t.kind === 'word' || t.kind === 'ph').length

  const cleaned = parts.map((part, i) => {
    if (i % 2 === 1) {
      return part
    }

    const tokens = dropRepeats(lines[i] ?? [], removed)

    markFillers(tokens, { level, promptWords, removed })

    return render(tokens)
  })

  return restore(cleaned.join(''), spans)
}

const unchanged = (text: string): CleanResult => ({ text, changed: false, removed: [] })

/** Cleans a dictated prompt. Returns the input itself when there is nothing safe to cut. */
export function clean(input: string, options: CleanOptions = {}): CleanResult {
  const level = options.level ?? 'standard'
  const maxChars = options.maxChars ?? MAX_CHARS

  if (input.trim() === '' || input.length > maxChars || HAS_MARKER.test(input)) {
    return unchanged(input)
  }

  const removed: string[] = []
  let text = input

  for (let round = 0; round < 6; round++) {
    const next = pass(text, level, removed)

    if (next === text) {
      break
    }

    text = next
  }

  // Never send an empty or longer prompt.
  if (text === input || text.trim() === '' || text.length >= input.length) {
    return unchanged(input)
  }

  return { text, changed: true, removed }
}

/** A rough token count: about four characters a token for English prose. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)
