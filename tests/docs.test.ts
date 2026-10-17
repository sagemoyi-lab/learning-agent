// Documentation rules that a script can check (AGENTS.md "文档：一件事一个家", the learning-docs skill):
// word budgets for the documents every session reads, current-state design documents, proposal headings,
// and relative links. docs/history/ is frozen and skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', '.git', '.scratch', '.tools', '.data', '.dsh-home', 'dist', 'lib', 'materials', 'history'])

/** Character ceilings (Chinese text, so characters rather than words). Raise one only when the content needs it. */
const BUDGETS: Record<string, number> = {
  'AGENTS.md': 3800,
  'packages/AGENTS.md': 3600,
  'docs/development.md': 3300,
  'docs/PLAN.md': 9800,
}

/** PLAN's "现在" says what is in progress and what waits for the learner, nothing about what is done. */
const NOW_BUDGET = 800

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function markdownFiles(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (SKIP.has(entry.name)) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

/** Text outside fenced and inline code, which show link syntax without linking. */
function prose(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
}

describe('documentation', () => {
  it('keeps the always-read documents within their budgets', () => {
    for (const [path, ceiling] of Object.entries(BUDGETS)) expect([...read(path)].length, path).toBeLessThanOrEqual(ceiling)
  })

  it("keeps PLAN's 现在 short", () => {
    const plan = read('docs/PLAN.md')
    const start = plan.indexOf('## 7. 现在')
    expect(start).toBeGreaterThan(0)
    const end = plan.indexOf('\n## ', start + 1)
    expect([...plan.slice(start, end)].length).toBeLessThanOrEqual(NOW_BUDGET)
  })

  it('relative links in active documents point at existing files', () => {
    const broken: string[] = []
    for (const file of markdownFiles()) {
      for (const [, target] of prose(readFileSync(file, 'utf8')).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^([a-z][a-z0-9+.-]*:|#)/i.test(target!)) continue
        const path = resolve(dirname(file), decodeURIComponent(target!.split('#')[0]!))
        if (!existsSync(path)) broken.push(`${relative(ROOT, file)} → ${target}`)
      }
    }
    expect(broken).toEqual([])
  })
})
