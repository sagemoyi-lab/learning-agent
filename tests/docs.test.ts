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
  'docs/PLAN.md': 10500,
  'docs/contracts.md': 11800,
}

/** PLAN's "现在" says what is in progress and what waits for the learner, nothing about what is done. */
const NOW_BUDGET = 800

/** A design document says how the unit works now: these sections, in this order, and no batches, acceptance criteria or progress labels. */
const DESIGN_SECTIONS = ['## 概要', '## 数据与接口', '## 关键决定', '## 已知限制与以后再做']
const DESIGN_BUDGET = 10_000
const STALE_HEADING = /^#{2,4} .*(?:[A-D] ?批|验收标准|改版)/m
const PROGRESS = /已技术验收|技术验收|待你试用|待用户试用|待试用|已验收/
const PROPOSAL_SECTIONS = ['## 问题', '## 方案', '## 放弃的方案', '## 验收标准', '## 风险']

function units(): string[] {
  return readdirSync(join(ROOT, 'docs'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(ROOT, 'docs', entry.name, 'design.md')))
    .map(entry => entry.name)
}

/** The positions of `headings` in `text`, -1 for a missing one. */
function positions(text: string, headings: readonly string[]): number[] {
  return headings.map(heading => text.search(new RegExp(`^${heading}\\s*$`, 'm')))
}

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

  it('design documents describe the unit as it is now', () => {
    for (const unit of units()) {
      const path = `docs/${unit}/design.md`
      const text = read(path)
      const found = positions(text, DESIGN_SECTIONS)
      expect(found.every(at => at >= 0), `${path} has ${DESIGN_SECTIONS.join(', ')}`).toBe(true)
      expect([...found].sort((a, b) => a - b), `${path} keeps the section order`).toEqual(found)
      expect(text, path).not.toMatch(STALE_HEADING)
      expect(text, path).not.toMatch(PROGRESS)
      expect([...text].length, path).toBeLessThanOrEqual(DESIGN_BUDGET)
    }
  })

  it('proposals carry the proposal sections', () => {
    for (const unit of units()) {
      const dir = join(ROOT, 'docs', unit, 'proposals')
      if (!existsSync(dir)) continue
      for (const name of readdirSync(dir).filter(file => file.endsWith('.md'))) {
        const found = positions(readFileSync(join(dir, name), 'utf8'), PROPOSAL_SECTIONS)
        expect(found.every(at => at >= 0) && found.every((at, i) => i === 0 || at > found[i - 1]!), `docs/${unit}/proposals/${name}`).toBe(true)
      }
    }
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
