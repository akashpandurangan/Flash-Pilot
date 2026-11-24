// Proves the demo is purely additive: every changed path in the working tree must be a NEW file under demo/.
// Anything modified, deleted or added elsewhere (production code, config, lockfile, package.json) fails the check.
//   node demo/scripts/check-additive.mjs [base-ref]     (default base: the current HEAD)
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).replace(/\r/g, '')
const base = process.argv[2] || 'HEAD'

const status = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)
const diffNames = git('diff', '--name-status', base).split('\n').filter(Boolean)

let bad = 0
const outside = []
for (const line of status) {
  const code = line.slice(0, 2)
  const file = line.slice(3).replace(/^"|"$/g, '')
  const isNewUnderDemo = code === '??' && file.startsWith('demo/')
  const isStagedNewUnderDemo = code[0] === 'A' && file.startsWith('demo/')
  if (!isNewUnderDemo && !isStagedNewUnderDemo) outside.push(`${code.trim() || '?'} ${file}`)
}
for (const line of diffNames) outside.push(`vs ${base}: ${line}`) // tracked files that differ from the base

if (outside.length) { bad = outside.length; console.error('Changes outside demo/ (or to existing files):\n  ' + [...new Set(outside)].join('\n  ')) }
const added = status.filter((l) => l.slice(3).startsWith('demo/')).length
console.log(`${added} new file(s) under demo/ (git lists untracked files individually)`)
console.log(bad ? `\nFAIL - ${bad} path(s) changed outside demo/` : 'OK - nothing outside demo/ was added, modified or deleted; no existing file was touched')
process.exit(bad ? 1 : 0)
