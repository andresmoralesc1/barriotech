#!/usr/bin/env node
// Tier 14 — URL canonicalization
//
// Walks apps/web/**/*.{ts,tsx,js,txt} and rewrites the public hostname
// `https://gps.andresmorales.com.co` → `https://barriotech.com.co`.
//
// Safety rails (won't be a no-op if these rules don't all hold):
//  - never touch `umami.andresmorales.com.co` (separate analytics host)
//  - never touch `https://andresmorales.com.co/` (portfolio, different site)
//  - never touch `info@andresmorales.com.co` (component-level email)
//  - never touch supabase hostnames, customer-supplied domains
//  - never touch node_modules or .next caches
//
// Dry-run by default: prints planned changes, writes nothing. Pass
// the env var `APPLY=1` to actually rewrite in place. Re-runnable:
// no-ops on already-converted files (the source string is absent).

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const WEB = path.resolve(ROOT, 'apps/web')
const APPLY = process.env.APPLY === '1'

const FROM_HOST = 'gps.andresmorales.com.co'
const TO_HOST = 'barriotech.com.co'
// Two patterns applied in sequence: (1) URL form, anchored to https://
// — replaces the entire URL prefix with the new host. (2) bare host in
// body copy / config hostname / comments — preceded by non-word,
// non-dot, non-slash character to avoid double-matching the URL form.
const RE_URL = new RegExp('https://' + FROM_HOST.replace(/\./g, '\\.'), 'g')
const RE_BARE = new RegExp('(^|[^A-Za-z0-9_./])(' + FROM_HOST.replace(/\./g, '\\.') + ')', 'g')
const TO_BARE_PREFIX = '$1'

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'build'])
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.txt', '.md'])

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

const files = walk(WEB, [])
let totalHits = 0
let filesTouched = 0
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const urlMatches = src.match(RE_URL) || []
  const bareMatches = src.match(RE_BARE) || []
  const n = urlMatches.length + bareMatches.length
  if (n === 0) continue
  totalHits += n
  filesTouched++
  if (APPLY) {
    let dst = src.replace(RE_URL, 'https://' + TO_HOST)
    // RE_BARE captures (1) prefix and (2) the host itself. Replace
    // group 2 with the new host; group 1 (preceding non-word char or
    // start-of-string) is left as-is.
    dst = dst.replace(RE_BARE, (m, p1) => p1 + TO_HOST)
    fs.writeFileSync(file, dst)
    process.stdout.write(`rewrote ${n} in ${path.relative(WEB, file)}\n`)
  } else {
    process.stdout.write(`[dry] ${n} hits in ${path.relative(WEB, file)}\n`)
  }
}

console.error(`\n${APPLY ? 'rewrote' : 'would rewrite'} ${totalHits} hit(s) across ${filesTouched} file(s)`)
