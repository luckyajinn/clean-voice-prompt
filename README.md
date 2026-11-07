# clean-voice-prompt

A Claude Code mod that cleans voice-dictated prompts before they are sent. It cuts hesitations (`um`, `uh`, `hmm`), filler `like` and `you know`, sentence lead-ins (`Yeah, so`, `Okay so basically`) and stuttered repeats (`the the`, `I think I think`). Then, for longer prompts, a small model trims tangents, points made twice and over-explaining (see [Trimming long prompts](#trimming-long-prompts)). It never touches code, paths, URLs, quoted text, commands, flags or numbers.

```
Um, so, like, I want you to, uh, fix the the login bug in src/auth/login.ts, you know, the one where it, um, crashes.
I want you to fix the login bug in src/auth/login.ts, the one where it, crashes.
```

It is deliberately cautious: when a word might mean something it stays. A filler left in costs a token; a word wrongly cut can cost a wrong answer. Expect savings of a few percent to about a fifth of a rambling prompt, and a cleaner prompt for the model to read.

It uses Claude Code's early-access mod API, which can change between releases.

## Install

At the prompt of a terminal session:

```
/plugin install clean-voice-prompt --marketplace luckyajinn/clean-voice-prompt
```

Answer `y` to add the marketplace, then pick a scope (user scope cleans prompts in every session).

From a shell, the same thing is:

```
claude plugin marketplace add luckyajinn/clean-voice-prompt
claude plugin install clean-voice-prompt@clean-voice-prompt --scope user
```

To run it from a local checkout while working on it: `claude --plugin-dir <path to this folder>`.

## What happens when you send a prompt

In the default **auto** mode the prompt is cleaned and sent, and a pop-up says how much was cut (`clean-voice-prompt: 7 cuts, 46 chars, about 12 tokens saved`). `/clean-voice-prompt last` shows the before and after.

In **review** mode the cleaned prompt goes back in the prompt box instead of being sent. Press Enter to send it. `/clean-voice-prompt original` puts what you said back in the box, and sending that unchanged sends it as said.

Start a prompt with `raw:` to send it untouched (the prefix is removed).

Only prompts you send are cleaned: from the prompt box, and from the phone or web through Remote Control (always in auto mode, as there is no box to review in). Slash commands, notifications, other sessions' messages, scheduled prompts and other plugins' prompts are left alone, and so is any prompt over 4,000 characters (a long paste is rarely dictation).

## What it cuts

| Kind | Cut | Left alone |
| --- | --- | --- |
| Hesitations | `um`, `uh`, `er`, `erm`, `hm`, `hmm`, anywhere | `mm` (millimetres), `uh-huh`, anything in ALL CAPS (`UM`, `ER`) |
| Lead-ins at the start of a sentence | `Yeah,` `Okay,` `Alright,` `Anyway,` `So,` `Basically,` `Well,` `Right,` and chains like `yeah so` or `okay so basically` | an answer: `yeah`, `Yeah, do it.`, `Okay.`, anything with fewer than 3 words after the lead-in or in a prompt under 6 words; `So the...` and `Well tested`, `Right click` without a comma; `yes` and `no` always |
| Fillers set off by commas | `, like,` `, you know,` `, yeah,` `, basically,`, `Like,` and `You know,` opening a sentence, `I mean,` opening a sentence, `..., you know.` closing one | `looks like`, `would like`, `like you did`, `do you know`, `I hope you know`, `use staging, I mean production` |
| A bare `like` (no commas) | only between a preposition and a question word (`for like how`, `about like what`) or between `is`/`it's`/`was`... and an intensifier (`is like super slow`, `it's like really broken`) | `is like a proxy`, `feels like really slow`, `a tool like what we had`, `what is it like when` |
| Repeats | a doubled pronoun, article, preposition or helper word (`I I`, `the the`, `to to`), and any repeated 2-4 word phrase (`can you, can you`) | `had had`, `that that`, `is is`, `very very`, `no no no`, and repeated numbers (`3 3`) |

The **aggressive** level also cuts `actually`, `literally`, `honestly`, `obviously` and `essentially` when set off by commas, and `Look,` and `Listen,` opening a sentence.

Commas left dangling by a cut are merged (`want you to, uh, fix` becomes `want you to fix`), a sentence that now starts with a lowercase word is capitalised if the cut word was, and brackets a cut leaves empty go too.

## Trimming long prompts

Word lists can't tell a tangent from a request. So once the word-level clean is done, a prompt with 40 or more words of prose (code, paths and numbers don't count) goes to a small, fast model (Haiku, through your session's own account). It is asked to return the same prompt, shorter:

- **Cut:** asides unrelated to the request, backstory the agent doesn't need, the same point made twice, over-explaining and hedging.
- **Kept:** every request, constraint and step in order; every question as a question; your voice; and every path, piece of code, command, number, quote and name (`JavaScript`, `Postgres`) exactly as written.

Its version is only sent if it passes every check below. Otherwise the prompt goes as the word-level clean left it.

- every path, piece of code, number, URL and quoted text from the prompt is still there, character for character
- a prompt with a question mark still has one, and a prompt with a `not`, `never`, `don't` or `only` still has one
- it is at least 8% shorter (less isn't worth it) and keeps at least a fifth of the prompt (less means something was lost)
- the model answered in the expected form, and didn't say there was nothing to trim

If the model takes more than 10 seconds or can't be reached, the word-level clean is sent. The status line shows `trimming the prompt...` while it works, the receipt says `trimmed` when its version was used, and `/clean-voice-prompt last` says why when it wasn't. In review mode the trimmed version goes back in the box like any other.

Each trim is one small-model call over the prompt, so it costs a few hundred Haiku tokens. That pays off because the shorter prompt is what the main model reads, every turn, for the rest of the session. `/clean-voice-prompt trim off` or the **Trim long prompts** setting turns it off.

## What it never touches

Before any rule runs, these are swapped out and put back byte for byte afterwards:

- fenced code blocks, inline `code`, indented lines (pasted code or output), lines starting with `>`
- text in "double", “curly” or 'single' quotes
- URLs, and any word holding a digit, a slash or backslash, `@`, `#`, `$`, `%`, `_`, `=`, `:`, brackets or other code characters
- dotted names (`api.ts`, `v1.2.3`), flags (`--force`, `-rf`), camelCase names, calls (`run()`)

## Command

`/clean-voice-prompt` with no argument shows the mode, the level and what has been saved so far.

| Argument | Does |
| --- | --- |
| `on`, `review`, `off` | switch the mode for this session |
| `standard`, `aggressive` | switch the level for this session |
| `trim on`, `trim off` | switch the small-model trim for this session |
| `last` | the last cleaned prompt, before and after, what was cut, and whether it was trimmed (or why not) |
| `original` | put the last prompt back in the box as you said it |
| `try <text>` | a dry run: what would be cut from `<text>`, sending nothing (a long one is trimmed too, which is a small-model call) |

## Settings

In the plugin's config: **Mode** (`auto`, `review`, `off`), **How much to cut** (`standard`, `aggressive`), **Trim long prompts** (on), **Show a receipt** (on), **Clean Remote Control prompts** (on).

## Limits

- **Commas matter.** `like` and `you know` are mostly cut only when commas set them off (the bare-`like` row above is the narrow exception), so `it's like broken` stays. Most dictation tools add commas; one that adds none gets fewer cuts.
- **False starts and corrections are left in** by the word-level clean: `add a button, no wait, a link` changes meaning if cut wrongly. The trim may tidy one, and its checks guard paths, numbers, questions and negations, but not every word, so in auto mode it is worth a glance at `/clean-voice-prompt last` when a trimmed prompt gets an odd answer.
- **The trim adds a pause** of a second or two before a long prompt is sent (10 at most).
- **English only.**
- The token figure in the receipt is an estimate (about four characters a token).
- Totals are kept in the mod's own store on this machine. The only thing sent anywhere is the trim request, which goes to the same API your session already uses.

## Development

```
claude plugin validate .
claude plugin test .
```

`hooks/clean.ts` is the cleaner, a pure function. `hooks/condense.ts` holds the trim: the instructions the small model gets, and `checkCondensed`, the pure function that decides whether its reply is used. `hooks/samples.ts` holds the sample dictations with their expected output and the prompts that must come through unchanged; add one whenever a real prompt comes out wrong. `hooks/clean.test.ts` also checks, over the samples and 400 generated prompts, that cleaning twice changes nothing, that a cleaned prompt is never longer or empty, and that every digit, line break and protected span survives.

## License

MIT
