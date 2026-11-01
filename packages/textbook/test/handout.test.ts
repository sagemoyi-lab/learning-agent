import { describe, expect, it } from 'vitest'
import type { CitedChunk } from '@learning-agent/contracts'
import {
  confusionsTable, copiesStem, exampleWithSolution, formulaCell, formulasTable, hanCount, outlineOf, readConfusions, readOverview, readPlan,
  sectionHeading, sectionNumberOf, termsTable, type Section,
} from '../src/handout.ts'

let n = 0
const chunk = (kind: CitedChunk['kind'], text: string, page = 1): CitedChunk => ({ id: `ck_01K6PQZRB8M3A4T5V6W7X8Y${String(n++).padStart(3, '0')}`, sourceId: 'src_x', kind, text, section: ['第1章', '1.2 节'], locator: { page, block: 0 }, citation: `《示例》p.${page}` }) as CitedChunk

// Section 1 (1.1): chunks 1–3; section 2 (1.2): chunks 4–9 with a worked example (6) and its solution (7, 8).
const first = [chunk('heading', '1.1 压强'), chunk('text', '压强指单位面积上的垂直作用力。'), chunk('text', '静止流体中压强各向相同，这一点作为已知结论使用。')]
const second = [
  chunk('heading', '1.2 基本方程', 2), chunk('formula', '$$\np_2 = p_1 + \\rho g h \\tag{1-3}\n$$', 2), chunk('example', '例 1-1 水深 2 m，求槽底表压。', 2),
  chunk('text', '解 槽底比液面低 2 m。', 2), chunk('formula', '$$p = 20\\,kPa$$', 2), chunk('text', '基本方程成立需要三个条件：流体静止；两点之间由同一种流体连通；流体密度不随位置变化，缺一不可。', 2),
]
const sections: Section[] = [
  { lessonId: 'ls_1', number: '1.1', title: '压强', chunks: first },
  { lessonId: 'ls_2', number: '1.2', title: '基本方程', chunks: second },
]
const flat = [...first, ...second]
const stems = ['1-6 敞口水槽中水深 3 m，取大气压 100 kPa，求槽底的表压强。', '1-7 U 形管两侧读数差 0.2 m，求压差。']
const at = (item: CitedChunk | undefined) => (item ? flat.indexOf(item) + 1 : 0)

describe('the plan of a handout', () => {
  it('outlines the chapter by section, numbering the chunks right through', () => {
    expect(outlineOf(sections)).toBe([
      '## 小节 1：1.1 压强\n[1] 小标题 · 1.1 压强\n[2] 正文 · 压强指单位面积上的垂直作用力。\n[3] 正文 · 静止流体中压强各向相同，这一点作为已知结论使用。',
      `## 小节 2：1.2 基本方程\n[4] 小标题 · 1.2 基本方程\n[5] 公式 · $$ p_2 = p_1 + \\rho g h \\tag{1-3} $$\n[6] 例题 · 例 1-1 水深 2 m，求槽底表压。\n[7] 正文 · 解 槽底比液面低 2 m。\n[8] 公式 · $$p = 20\\,kPa$$\n[9] 正文 · 基本方程成立需要三个条件：流体静止；两点之间由同一种流体连通；流体密度不随位置变化，缺一不可。`,
    ].join('\n\n'))
  })

  it('reads the terms in the book\'s order, a formula only where the reply names a formula, and what the exercises need by section', () => {
    const plan = readPlan({
      overview: '先讲压强，再讲基本方程。',
      terms: [{ name: '等压面', chunk: 9 }, { name: '**压强**', chunk: 1 }, { name: '基本方程', chunk: 40 }, { name: '扩大室', chunk: 0 }, { name: '压强', chunk: 2 }, { name: '敞口水槽中水深 3 m，取大气压', chunk: 6 }],
      formulas: [8, 5, 2, 5],
      needs: [
        { text: '表压和绝压的换算', section: 1, covered: true },
        { text: '扩大室的作用', section: 2, covered: false },
        { text: '敞口水槽中水深 3 m，取大气压时的表压', section: 2 },
        { text: '习题 1-6 的解法', section: 2 },
      ],
    }, sections, stems)!
    expect(plan.overview).toBe('先讲压强，再讲基本方程。')
    // 压强 names a heading: the text under it. 基本方程 is found by name; 扩大室 is in no chunk; repeats and copies go.
    expect(plan.terms.map(term => [term.name, at(term.chunk)])).toEqual([['压强', 2], ['等压面', 9], ['基本方程', 9], ['扩大室', 0]])
    expect(plan.formulas.map(at)).toEqual([5, 8])
    expect(plan.needs).toEqual([[{ text: '表压和绝压的换算', covered: true }], [{ text: '扩大室的作用', covered: false }]])
  })

  it('reads confusions as pairs and types by method, telling which exercises no type takes', () => {
    const plan = readPlan({
      confusions: [{ a: '表压', b: '绝压' }, { a: '绝压', b: '表压' }, { a: '压强', b: '压强' }],
      types: [
        { name: '由一点压强求另一点压强', exercises: [1], sections: [2, 9], example: 6 },
        { name: '习题 1-7 类', exercises: [2] },
        { name: '用等压面列方程', exercises: [], sections: [1], example: 2 },
      ],
    }, sections, stems)!
    expect(plan.confusions).toEqual([{ a: '表压', b: '绝压' }])
    expect(plan.types.map(type => [type.name, type.sections, at(type.example)])).toEqual([['由一点压强求另一点压强', [1], 6], ['用等压面列方程', [0], 0]])
    // 1-7 went with the type that named it; no other type takes it.
    expect(plan.untyped).toEqual([2])
    expect(readPlan({ types: [] }, sections, stems)!.untyped).toEqual([])
  })

  it('gives up on a reply that is not a plan', () => {
    expect(readPlan(null, sections, stems)).toBeUndefined()
    expect(readPlan([1, 2], sections, stems)).toBeUndefined()
    expect(copiesStem('水深 3 m，取大气压 100 kPa 时', stems)).toBe(true)
    expect(copiesStem('静力学基本方程的适用条件', stems)).toBe(false)
  })
})

describe('the tables and sections of a handout', () => {
  const known = (id: string) => flat.find(item => item.id === id) && { label: flat.find(item => item.id === id)!.citation, target: id }

  it('takes the rows a writer gives for the terms and formulas asked, in the book\'s order', () => {
    const terms = [{ name: '压强', chunk: first[1]! }, { name: '基本方程', chunk: second[0]! }]
    const rows = readOverview({
      terms: [{ name: '基本方程', text: '两点压强的关系。', cite: second[1]!.id }, { name: '压强', text: '单位面积上的垂直力。', cite: 'ck_made_up' }, { name: '甲', text: '不是要的' }],
      formulas: [{ id: second[1]!.id, name: '静力学基本方程', use: '静止、连通的同种流体' }, { id: first[1]!.id, name: '不是公式' }],
    }, { terms, formulas: [second[1]!], known })
    expect(rows.terms).toEqual([
      { name: '压强', text: '单位面积上的垂直力。', cite: { label: '《示例》p.1', target: first[1]!.id } },
      { name: '基本方程', text: '两点压强的关系。', cite: { label: '《示例》p.2', target: second[1]!.id } },
    ])
    expect(rows.formulas).toEqual([{ chunk: second[1]!, name: '静力学基本方程', use: '静止、连通的同种流体' }])
  })

  it('lays the tables out with the formula copied from the source on one line', () => {
    expect(formulaCell(second[1]!)).toEqual({ tex: '$p_2 = p_1 + \\rho g h$', tag: '1-3' })
    expect(formulaCell(chunk('formula', '$$\n\\left| a \\right| = b\n$$')).tex).toBe('$\\left\\vert  a \\right\\vert  = b$')
    expect(formulasTable([{ chunk: second[1]!, name: '静力学基本方程', use: '静止、连通的同种流体' }])).toBe([
      '| 公式 | 名称 | 什么时候用 | 出处 |',
      '|---|---|---|---|',
      `| $p_2 = p_1 + \\rho g h$ | 静力学基本方程（式 1-3） | 静止、连通的同种流体 | [《示例》p.2](cite:${second[1]!.id}) |`,
    ].join('\n'))
    expect(termsTable([{ name: '压强', text: '力 | 面积\n之比', cite: { label: '网页', target: 'https://a.edu.cn/x' } }])).toContain('| **压强** | 力 \\| 面积 之比 | [网页](https://a.edu.cn/x) |')
    const confusions = readConfusions({ rows: [{ a: '表压', b: '绝压', diff: '零点不同。', cites: [first[1]!.id, 'ck_made_up'] }, { a: '甲', b: '乙', diff: '没有出处。', cites: [] }] }, known)
    expect(confusionsTable(confusions)).toBe(`| 容易混的 | 区别在哪 | 出处 |\n|---|---|---|\n| **表压** 与 **绝压** | 零点不同。 | [《示例》p.1](cite:${first[1]!.id}) |`)
  })

  it('heads a section with its lesson and where it starts in the book, and reads the lesson back', () => {
    expect(sectionHeading(sections[1]!)).toBe(`### 1.2 基本方程 [《示例》p.2](cite:${second[1]!.id})`)
    expect(sectionNumberOf(sectionHeading(sections[1]!))).toBe('1.2')
    expect(sectionNumberOf('### 易混点')).toBeUndefined()
  })

  it('counts a section\'s length in Chinese characters, without source text, math or links', () => {
    expect(hanCount(`压强随深度增加 $p = \\rho g h$。[《示例》p.2](cite:${first[1]!.id})\n\n> [!quote] 原文 · x\n> 很长的原文`)).toBe(7)
  })

  it('finds a worked example\'s solution after it', () => {
    expect(exampleWithSolution(second[2]!, flat).map(at)).toEqual([6, 7, 8])
  })
})
