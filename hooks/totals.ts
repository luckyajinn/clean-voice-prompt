// Running totals kept across sessions in the mod's `$.store` under `totals`.

export type Totals = { prompts: number; chars: number; tokens: number; trimmed: number }

export type KV = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

export const KEY = 'totals'

/** Reads a stored value, counting anything missing or malformed as zero. */
export function readTotals(value: unknown): Totals {
  const r = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

  return { prompts: num(r.prompts), chars: num(r.chars), tokens: num(r.tokens), trimmed: num(r.trimmed) }
}

/** Saved characters, and a rough token count of them (about four characters a token). */
export function saved(original: string, cleaned: string): { chars: number; tokens: number } {
  const chars = Math.max(0, original.length - cleaned.length)

  return { chars, tokens: Math.max(1, Math.round(chars / 4)) }
}

export async function addPrompt(kv: KV, original: string, cleaned: string, trimmed = false): Promise<void> {
  const { chars, tokens } = saved(original, cleaned)
  const totals = readTotals(await kv.get(KEY))

  await kv.set(KEY, {
    prompts: totals.prompts + 1,
    chars: totals.chars + chars,
    tokens: totals.tokens + tokens,
    trimmed: totals.trimmed + (trimmed ? 1 : 0),
  })
}
