// Sample dictations: what the cleaner should make of them. Add a case here
// whenever a real prompt comes out wrong.

import type { Level } from './clean'

export type Sample = { name: string; input: string; expected: string; level?: Level }

export const CLEANED: Sample[] = [
  {
    name: 'hesitations, lead-ins, comma fillers and a stutter around a path',
    input: 'Um, so, like, I want you to, uh, fix the the login bug in src/auth/login.ts, you know, the one where it, um, crashes.',
    expected: 'I want you to fix the login bug in src/auth/login.ts, the one where it, crashes.',
  },
  {
    name: 'a lead-in chain and a repeated phrase',
    input: 'Yeah, so basically I think I think we need to add a retry to the fetch call in api.ts.',
    expected: 'I think we need to add a retry to the fetch call in api.ts.',
  },
  {
    name: 'a command with flags and a number',
    input: 'okay so uh run npm test -- --watch and tell me if, like, test 3 fails',
    expected: 'run npm test -- --watch and tell me if test 3 fails',
  },
  {
    name: 'a sentence that is only a hesitation, then "I mean,"',
    input: 'Hmm. I mean, the cache is, like, stale after 10 minutes.',
    expected: 'The cache is stale after 10 minutes.',
  },
  {
    name: 'cuts across sentences, a URL left whole',
    input: 'So, the deploy failed. Um, can you check the logs at https://example.com/logs?id=5, um, and fix it?',
    expected: 'The deploy failed. Can you check the logs at https://example.com/logs?id=5, and fix it?',
  },
  {
    name: 'stuttered pronoun and article',
    input: 'I I need you to look at the the parser and and the lexer.',
    expected: 'I need you to look at the parser and the lexer.',
  },
  {
    name: 'a repeat across a comma',
    input: 'Can you, can you add tests for the config loader please?',
    expected: 'Can you add tests for the config loader please?',
  },
  {
    name: 'a hesitation inside brackets',
    input: 'Update the README (um) so it mentions the new flag.',
    expected: 'Update the README so it mentions the new flag.',
  },
  {
    name: 'okay as a lead-in before a real instruction',
    input: 'Okay, now run the full test suite and fix whatever fails.',
    expected: 'Now run the full test suite and fix whatever fails.',
  },
  {
    name: 'you know at the end of a sentence after a comma',
    input: 'The retry logic is too eager, you know. Make it back off.',
    expected: 'The retry logic is too eager. Make it back off.',
  },
  {
    name: 'several lines, each cleaned on its own',
    input: 'Um, first rename the helper.\nThen, uh, update the the call sites.\nYeah, and run the linter after that.',
    expected: 'First rename the helper.\nThen update the call sites.\nAnd run the linter after that.',
  },
  {
    name: 'Windows line endings are kept',
    input: 'Um, first rename the helper.\r\nThen, uh, update the call sites.',
    expected: 'First rename the helper.\r\nThen update the call sites.',
  },
  {
    name: 'the test dictation: a bare like between a preposition and a question word',
    input: "Let's get a new document for like how this works, and if we can get it done fast, um, that's great.",
    expected: "Let's get a new document for how this works, and if we can get it done fast, that's great.",
  },
  {
    name: 'a bare like between a form of be and an intensifier',
    input: "The dashboard is like super slow and the export, it's like really broken too.",
    expected: "The dashboard is super slow and the export, it's really broken too.",
  },
  {
    name: 'a bare like after about, before what',
    input: 'Tell me about like what the scheduler does when a job fails twice.',
    expected: 'Tell me about what the scheduler does when a job fails twice.',
  },
  {
    name: 'aggressive also cuts comma-bounded actually and honestly',
    input: 'The cache is, actually, never cleared, honestly, so add a TTL to it.',
    expected: 'The cache is never cleared, so add a TTL to it.',
    level: 'aggressive',
  },
  {
    name: 'standard leaves actually and honestly in',
    input: 'The cache is, actually, never cleared, honestly, so add a TTL to it.',
    expected: 'The cache is, actually, never cleared, honestly, so add a TTL to it.',
  },
]

/** Prompts the cleaner must send exactly as given. */
export const UNCHANGED: { name: string; input: string }[] = [
  { name: 'a bare yeah is an answer', input: 'yeah' },
  { name: 'yeah with a short instruction is an answer', input: 'Yeah, do it.' },
  { name: 'okay alone', input: 'Okay.' },
  { name: 'yes and no are never cut', input: 'Yes, and also no, do not delete the migrations folder.' },
  { name: 'like as a verb and comparison', input: 'It looks like the build is broken. I would like you to check it, like you did yesterday.' },
  { name: 'like as a comparison after is', input: 'The API is like a proxy for the auth service, so treat it that way.' },
  { name: 'like before a question word with no preposition', input: 'What is it like when the cache is cold on the first request?' },
  { name: 'like after a noun before what', input: 'Use a tool like what we had before for the release notes.' },
  { name: 'like after a verb before an intensifier', input: 'It feels like really slow progress on the migration this week.' },
  { name: 'inline code', input: 'Can you rename `um` to `uhm` in the file and keep `like` as is?' },
  { name: 'quoted text', input: 'Set the placeholder to "um, like, you know" and the tooltip to \u201cuh oh\u201d, then ship it.' },
  { name: 'single-quoted text', input: "Add a comment that says 'so, like, um' above the function, okay." },
  { name: 'fenced code', input: 'Fix this:\n```js\n// um, like, the the bug\nconst like = uh(um)\n```\nIt throws on load.' },
  { name: 'indented code', input: 'This fails:\n    if like and um: um = um + 1\nWhy does it fail?' },
  { name: 'a quoted line', input: 'The error says:\n> um, like, the the thing failed\nWhat does it mean?' },
  { name: 'well and right as words', input: 'Well tested code is good, so right click the file and open it in the editor.' },
  { name: 'grammatical doubles', input: 'The problem is is that it had had a race condition, and what I mean is that that lock is wrong.' },
  { name: 'repeated numbers', input: 'Set retries to 3 3 times over and use ports 8080 8080 for both services.' },
  { name: 'emphasis repeats', input: 'This is very very slow and no no no, do not cache it.' },
  { name: 'shouted words', input: 'The ER team said UM is a module name, LIKE the other one, so keep it.' },
  { name: 'mm is a unit', input: 'Make the margin 4 mm wider, mm, and the border thinner on the card.' },
  { name: 'uh-huh is one word', input: 'He said uh-huh when I asked about the migration plan for the database.' },
  { name: 'identifiers and paths', input: 'Rename um_count and likeCount in C:\\src\\um\\like.ts and ./uh/so.py to something clearer.' },
  { name: 'flags', input: 'Run it with --like and -um flags, then the --verbose one.' },
  { name: 'mentions and variables', input: 'Ask @um-bot about $LIKE and %UH% and #123 before merging the branch.' },
  { name: 'do you know is a question', input: 'Do you know why the build failed on the main branch last night?' },
  { name: 'I mean mid-sentence is a correction', input: 'Use the staging config, I mean production, for the deploy tonight.' },
  { name: 'you know as a verb phrase', input: 'I hope you know the answer to this one about the scheduler.' },
  { name: 'empty', input: '' },
  { name: 'only whitespace', input: '   \n  ' },
  { name: 'a prompt that is only fillers is not emptied', input: 'Um, uh.' },
]
