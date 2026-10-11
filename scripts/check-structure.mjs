// Checks the boundaries that keep the three looks in step, which no type check or test reads:
// - A shared module imports only other shared modules and `types/`, so both hosts can bundle it.
// - The Codex plugin imports only shared modules from `hooks/`.
// - Every plan says whether it is proposed, building, built or superseded.
// - Every repo path and relative link in the docs names a file that exists.
// - Every `file:symbol` in docs/looks.md names a file that has that symbol.
//
// Usage: node scripts/check-structure.mjs. Exits 1 on any failure.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The shared modules: the files in hooks/ that both hosts import. GLOSSARY.md defines them. */
const SHARED = ['arrivals', 'demo', 'layout', 'ledger', 'presses', 'prs', 'tools', 'view']
// hooks/ledger.ts imports a type from the engine. It is erased from the bundle, but the Codex type check then
// needs the types only an interactive Claude session writes. Step 5 of docs/plans/three-looks.md moves it out.
const ENGINE_TYPE_IMPORTS = ['ledger']
const PLAN_STATUS = /^Status: (proposed|building|built|superseded by \S+)/m

const errors = []
const read = path => readFileSync(join(ROOT, path), 'utf8')
const exists = path => existsSync(join(ROOT, path))

/** Each import or re-export in a source file: where it is from, and whether it imports only types. */
function importsOf(source) {
  const found = []
  for (const m of source.matchAll(/\b(import|export)(\s+type)?\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g))
    found.push({ from: m[3], isType: Boolean(m[2]) })
  for (const m of source.matchAll(/^import\s+['"]([^'"]+)['"]/gm)) found.push({ from: m[1], isType: false })

  return found
}

function checkShared() {
  for (const name of SHARED) {
    const path = `hooks/${name}.ts`
    for (const { from, isType } of importsOf(read(path))) {
      const shared = from.match(/^\.\/([\w-]+)$/)?.[1]
      if (shared && SHARED.includes(shared)) continue
      if (from === '../types') continue
      if (from === 'claude-code' && isType && ENGINE_TYPE_IMPORTS.includes(name)) continue
      errors.push(`${path} imports '${from}'. A shared module imports only other shared modules and ../types.`)
    }
  }
}

function checkCodex() {
  const dirs = ['codex/src', 'codex/tests']
  for (const dir of dirs)
    for (const file of readdirSync(join(ROOT, dir)).filter(f => /\.tsx?$/.test(f))) {
      const path = `${dir}/${file}`
      for (const { from } of importsOf(read(path))) {
        const hook = from.match(/^\.\.\/\.\.\/hooks\/([\w-]+)$/)?.[1]
        if (hook && !SHARED.includes(hook))
          errors.push(
            `${path} imports hooks/${hook}, which is not a shared module. Codex can only bundle shared modules.`,
          )
      }
    }
}

/** The markdown files whose links and paths must resolve. docs/archive/ describes old code and is skipped. */
function docFiles() {
  const files = ['README.md', 'AGENTS.md', 'GLOSSARY.md', 'ROADMAP.md', 'codex/README.md'].filter(exists)
  const walk = dir => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const path = `${dir}/${entry}`
      if (path === 'docs/archive') continue
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (path.endsWith('.md')) files.push(path)
    }
  }
  walk('docs')

  return files
}

// Only a path that starts in one of this repo's top-level entries is checked, so paths in other repos,
// in the home folder or in a host's install folder are left alone.
const TOP_LEVEL = new Set(readdirSync(ROOT).filter(entry => entry !== 'node_modules'))

/** Whether Git ignores the path, as it does build output such as the dev build's, which exists only while it runs. */
function isIgnored(path) {
  try {
    execFileSync('git', ['-C', ROOT, 'check-ignore', '-q', '--no-index', path])
    return true
  } catch {
    return false
  }
}

function checkDocs() {
  for (const doc of docFiles()) {
    const text = read(doc)
    if (doc.startsWith('docs/plans/') && !PLAN_STATUS.test(text))
      errors.push(`${doc} has no status line: "Status: proposed", "building", "built" or "superseded by <plan>".`)
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0]
      if (!target || /^[a-z]+:/.test(target)) continue
      if (!existsSync(join(ROOT, dirname(doc), target))) errors.push(`${doc} links to ${target}, which does not exist.`)
    }
    // A reference doc's paths name files in the product it describes, and a plan not yet built names files it
    // will add, so only their links are checked.
    const isUnbuilt = /^Status: (proposed|building)/m.test(text)
    if (doc.startsWith('docs/reference/') || (doc.startsWith('docs/plans/') && isUnbuilt)) continue
    for (const m of text.matchAll(/`([\w.-]+\/[\w./-]+\.[a-z]+)(?::[\w.]+)?`/g)) {
      const path = m[1]
      if (!TOP_LEVEL.has(path.split('/')[0])) continue
      if (!exists(path) && !existsSync(join(ROOT, dirname(doc), path)) && !isIgnored(path))
        errors.push(`${doc} names ${path}, which does not exist.`)
    }
  }
}

function checkLookMap() {
  const map = 'docs/looks.md'
  for (const m of read(map).matchAll(/`([\w./-]+\.[a-z]+):([\w.]+)`/g)) {
    const [, path, symbol] = m
    if (!exists(path)) continue
    if (!new RegExp(`\\b${symbol.replaceAll('.', '\\.')}\\b`).test(read(path)))
      errors.push(`${map} names ${path}:${symbol}, and ${path} has no ${symbol}.`)
  }
}

checkShared()
checkCodex()
checkDocs()
checkLookMap()

for (const e of errors) console.log(`  x ${e}`)
process.exit(errors.length ? 1 : 0)
