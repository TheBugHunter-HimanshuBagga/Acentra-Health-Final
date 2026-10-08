// Translate a flat or nested JSON of English strings into the 10 other supported languages with Sarvam-Translate.
// Used at BUILD time (never at runtime) for the fixed chat messages and the UI strings; a person spot-checks the output.
//
//   node scripts/translate-json.mjs <in.en.json> <out.json> [--langs hi,bn,...]
//
// Output: { "<lang>": <same shape as the input, strings translated> }. Placeholders such as {name} or {{x}} are
// protected with numbered tokens and verified; a string whose tokens do not come back exactly once stays English.
// The API key is read from SARVAM_API_KEY (the repo .env); it is never written anywhere.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LANGS = { hi: 'hi-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN', gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN', pa: 'pa-IN', od: 'od-IN' }

function loadKey() {
  if (process.env.SARVAM_API_KEY) return process.env.SARVAM_API_KEY
  try {
    const env = readFileSync(resolve(import.meta.dirname, '..', '.env'), 'utf8')
    const m = env.match(/^SARVAM_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  } catch { /* no .env */ }
  throw new Error('SARVAM_API_KEY is not set')
}

const [, , inFile, outFile, ...rest] = process.argv
if (!inFile || !outFile) {
  console.error('usage: node scripts/translate-json.mjs <in.en.json> <out.json> [--langs hi,bn]')
  process.exit(2)
}
const langs = rest.includes('--langs') ? rest[rest.indexOf('--langs') + 1].split(',') : Object.keys(LANGS)
const key = loadKey()
const source = JSON.parse(readFileSync(inFile, 'utf8'))

function protect(text) {
  const kept = []
  const out = text.replace(/\{\{[^}]+\}\}|\{[A-Za-z0-9_.]+\}|\b(?:CASE|PRC|EXC|INV|POL|DME-POL)-[A-Za-z0-9.-]+|\b[PMCFO]-\d{3,}\b/g, (m) => {
    kept.push(m)
    return `{{${kept.length - 1}}}`
  })
  return { out, kept }
}

async function translate(text, target, attempt = 1) {
  const { out, kept } = protect(text)
  const r = await fetch('https://api.sarvam.ai/translate', {
    method: 'POST',
    headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: out, source_language_code: 'en-IN', target_language_code: target, model: 'sarvam-translate:v1',
      mode: 'formal', numerals_format: 'international',
    }),
  })
  if (r.status === 429 && attempt < 4) {
    await new Promise((res) => setTimeout(res, 1500 * attempt))
    return translate(text, target, attempt + 1)
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${target}`)
  let t = (await r.json()).translated_text
  for (let i = 0; i < kept.length; i++) {
    const tok = `{{${i}}}`
    const at = t.indexOf(tok)
    if (at < 0 || t.indexOf(tok, at + 1) >= 0) return null
    t = t.replace(tok, kept[i])
  }
  return t
}

async function walk(node, target, stats) {
  if (typeof node === 'string') {
    const t = await translate(node, target)
    if (t === null) { stats.kept++; return node }
    stats.ok++
    return t
  }
  if (Array.isArray(node)) return Promise.all(node.map((n) => walk(n, target, stats)))
  const out = {}
  for (const [k, v] of Object.entries(node)) out[k] = await walk(v, target, stats)
  return out
}

const result = {}
for (const lang of langs) {
  const stats = { ok: 0, kept: 0 }
  result[lang] = await walk(source, LANGS[lang], stats)
  console.log(`${lang}: ${stats.ok} translated, ${stats.kept} left in English (placeholder check)`)
}
writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', 'utf8')
console.log(`wrote ${outFile}`)
