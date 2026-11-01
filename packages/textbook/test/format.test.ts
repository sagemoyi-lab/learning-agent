import { describe, expect, it } from 'vitest'
import { withFrontmatter, type CitedChunk } from '@learning-agent/contracts'
import { finalize, halve, indexBlocks, isTable, replyBody, splitPieces, teachingPartOf } from '../src/format.ts'

const KNOWN = 'ck_01K6PQZRB8M3A4T5V6W7X8Y9Z0'
const UNKNOWN = 'ck_01K6PQZRB8M3A4T5V6W7X8Y9ZZ'
const FORMULA = 'ck_01K6PQZRB8M3A4T5V6W7X8Y9Z1'

const chunk = (id: string, kind: CitedChunk['kind'], text: string): CitedChunk => ({ id, sourceId: 'src_x', kind, text, section: ['1.2 节'], locator: { page: 3, block: 0 }, citation: '《示例》p.3' }) as CitedChunk

describe('textbook format', () => {
  it('keeps display math whole when splitting', () => {
    expect(splitPieces('a\n\n$$\nx = 1\n\ny = 2\n$$\n\nb')).toEqual(['a', '$$\nx = 1\n\ny = 2\n$$', 'b'])
  })

  it('assigns block ids and drops citations to chunks it was not given, without marking anything 待核实', () => {
    let n = 0
    const ids = ['aaaaa1', 'bbbbb2', 'ccccc3', 'ddddd4']
    const draft = [
      '```markdown',
      '## 2.1 静止的水',
      '',
      `压强随深度增加。[《示例》p.9](cite:${KNOWN}) ^zzzzzz`,
      '',
      '$$',
      'p = p_0 + \\rho g h',
      '$$',
      '',
      `上式中 h 是深度。[《示例》p.9](cite:${UNKNOWN})`,
      '',
      '这一段没有出处。',
      '```',
    ].join('\n')
    const { body, blocks, dropped } = finalize(draft, { knownChunk: id => id === KNOWN, newBlockId: () => ids[n++]! })
    expect(dropped).toEqual([`出处 ${UNKNOWN} 不在给出的资料里`])
    expect(body).toBe([
      '## 2.1 静止的水',
      `压强随深度增加。[《示例》p.9](cite:${KNOWN}) ^aaaaa1`,
      '$$\np = p_0 + \\rho g h\n$$\n^bbbbb2',
      '上式中 h 是深度。 ^ccccc3',
      '这一段没有出处。 ^ddddd4',
    ].join('\n\n') + '\n')
    expect(blocks.map(block => [block.id, block.citations, block.unverified, block.original])).toEqual([
      ['aaaaa1', [KNOWN], false, false],
      ['bbbbb2', [], false, false],
      ['ccccc3', [], false, false],
      ['ddddd4', [], false, false],
    ])
  })

  it('copies in the chunks an embed names, as a quote box with its own id', () => {
    let n = 0
    const embed = { order: [chunk(KNOWN, 'text', '压强随深度增加。'), chunk(FORMULA, 'formula', '$$\np = \\rho g h\n$$')], extra: [] }
    const { body, blocks, dropped } = finalize(`讲解一句。[x](cite:${KNOWN})\n![[${FORMULA}]]\n然后接着讲。\n\n![[${UNKNOWN}]]`, { knownChunk: id => id === KNOWN, embed, newBlockId: () => `eeeee${n++}` })
    expect(body).toBe([
      `讲解一句。[x](cite:${KNOWN}) ^eeeee0`,
      `> [!quote] 原文 · [《示例》p.3](cite:${FORMULA})\n> $$\n> p = \\rho g h\n> $$\n\n^eeeee1`,
      '然后接着讲。 ^eeeee2',
    ].join('\n\n') + '\n')
    expect(dropped).toEqual([`嵌入：${UNKNOWN} 不在本节资料里`])
    expect(blocks.map(block => [block.id, block.original, block.citations])).toEqual([['eeeee0', false, [KNOWN]], ['eeeee1', true, [FORMULA]], ['eeeee2', false, []]])
  })

  it('turns a quote box the model wrote itself into an ordinary paragraph, and keeps only the web pages it was given', () => {
    let n = 0
    const { body, blocks, dropped } = finalize('> [!quote] 原文 · 这段是模型自己编的。\n\n见[讲义](https://a.example.edu.cn/x)和[别处](https://b.example.com/y)。', {
      knownChunk: () => false, knownUrl: url => url === 'https://a.example.edu.cn/x', newBlockId: () => `wwwww${n++}`,
    })
    expect(body).toBe('原文 · 这段是模型自己编的。 ^wwwww0\n\n见[讲义](https://a.example.edu.cn/x)和别处。 ^wwwww1\n')
    expect(blocks.every(block => !block.original)).toBe(true)
    expect(dropped).toEqual(['网址 https://b.example.com/y 不是给出的网页'])
  })

  it('gives a formula the citations of the paragraph after it', () => {
    let n = 0
    const { blocks } = finalize(`$$p = \\rho g h$$\n\n式中 h 是水深。[x](cite:${KNOWN})\n\n$$p_1 = p_2$$\n\n### 下一节`, { knownChunk: id => id === KNOWN, newBlockId: () => `fffff${n++}` })
    expect(blocks.map(block => [block.citations, block.unverified])).toEqual([[[KNOWN], false], [[KNOWN], false], [[], false]])
  })

  it('keeps the id of a paragraph that reads the same', () => {
    const old = new Map([[`甲。[x](cite:${KNOWN})`, 'olddd1']])
    const { body } = finalize(`甲。[x](cite:${KNOWN})\n\n乙。[x](cite:${KNOWN})`, { knownChunk: () => true, newBlockId: () => 'newww1', reuse: text => old.get(text) })
    expect(body).toBe(`甲。[x](cite:${KNOWN}) ^olddd1\n\n乙。[x](cite:${KNOWN}) ^newww1\n`)
  })

  it('separates text written right under a heading', () => {
    let n = 0
    const { body, blocks } = finalize('### 读完就答\n1. 甲？\n2. 乙？', { knownChunk: () => false, newBlockId: () => `hhhhh${n++}` })
    expect(body).toBe('### 读完就答\n\n1. 甲？\n2. 乙？ ^hhhhh0\n')
    expect(blocks.map(block => block.recall)).toEqual([true])
  })

  it('attaches a citation-only line to the list before it', () => {
    let n = 0
    const { body, blocks } = finalize(`- 甲\n- 乙\n\n[x](cite:${KNOWN})。`, { knownChunk: id => id === KNOWN, newBlockId: () => `lllll${n++}` })
    expect(blocks).toHaveLength(1)
    expect(body).toBe(`- 甲\n- 乙 [x](cite:${KNOWN})。 ^lllll0\n`)
  })

  it('drops the comma between two citations, not the one before a sentence goes on', () => {
    const { body } = finalize(`甲。[x](cite:${KNOWN})、[y](https://a.example.edu.cn/x)，[z](cite:${FORMULA})，乙。`, { knownChunk: () => true, knownUrl: () => true, newBlockId: () => 'ccccc0' })
    expect(body).toBe(`甲。[x](cite:${KNOWN})[y](https://a.example.edu.cn/x)[z](cite:${FORMULA})，乙。 ^ccccc0\n`)
  })

  it('reads a file written before 10-15 with its 待核实 marks', () => {
    const blocks = indexBlocks('段落一。 [待核实](cite:unverified) ^aaaaa1\n\n段落二。 ^bbbbb2\n')
    expect(blocks.map(block => block.unverified)).toEqual([true, false])
  })

  it('writes inline math with dollars, leaves out an embed it cannot read, and puts a link to a page\'s site on the page', () => {
    const page = 'https://a.example.edu.cn/notes/1'
    const { body, dropped } = finalize([
      `压强 \\(p = \\rho g h\\) 随深度增加。[x](cite:${KNOWN})[讲义](https://a.example.edu.cn)`,
      '![[ck_坏的]]',
    ].join('\n\n'), { knownChunk: () => true, knownUrl: url => url === page || (url === 'https://a.example.edu.cn' && page), newBlockId: () => 'mmmmm0' })
    expect(body).toBe(`压强 $p = \\rho g h$ 随深度增加。[x](cite:${KNOWN})[讲义](${page}) ^mmmmm0\n`)
    expect(dropped).toEqual(['嵌入 ![[ck_坏的]] 的写法不对'])
  })

  it('drops a link to a site it was not given with its label when the label only names the site', () => {
    const options = { knownChunk: () => true, knownUrl: () => false, newBlockId: () => 'nnnnn0' }
    expect(finalize(`甲。[x](cite:${KNOWN})、[jxpt.whut.edu.cn](http://jxpt.whut.edu.cn)`, options).body).toBe(`甲。[x](cite:${KNOWN}) ^nnnnn0\n`)
    expect(finalize(`乙。jxpt.whut.edu.cn、[x](cite:${KNOWN})`.replace('jxpt.whut.edu.cn', '[jxpt.whut.edu.cn](http://jxpt.whut.edu.cn)'), options).body).toBe(`乙。[x](cite:${KNOWN}) ^nnnnn0\n`)
    // A label that says something stays as words.
    expect(finalize('丙按[讲义](https://b.example.edu.cn/x)来算。', options).body).toBe('丙按讲义来算。 ^nnnnn0\n')
  })

  it('gives a table its id on a line of its own, keeping a source cited on several rows', () => {
    const table = `| 名词 | 是什么 | 出处 |\n|---|---|---|\n| **压强** | 单位面积上的力 | [x](cite:${KNOWN}) |\n| **表压** | 比大气压高的部分 | [x](cite:${KNOWN}) |`
    expect(isTable(table)).toBe(true)
    expect(isTable('| 只有一行 |')).toBe(false)
    const { body, blocks } = finalize(table, { knownChunk: id => id === KNOWN, newBlockId: () => 'ttttt0' })
    expect(body).toBe(`${table}\n\n^ttttt0\n`)
    expect(blocks.map(block => [block.id, block.citations])).toEqual([['ttttt0', [KNOWN]]])
  })

  it('shows a source cited twice in one paragraph once', () => {
    const { body } = finalize(`甲。[x](cite:${KNOWN}) 乙。[x](cite:${KNOWN})[y](cite:${FORMULA})`, { knownChunk: () => true, newBlockId: () => 'ddddd0' })
    expect(body).toBe(`甲。[x](cite:${KNOWN}) 乙。[y](cite:${FORMULA}) ^ddddd0\n`)
    // The separator the repeat leaves goes with it.
    expect(finalize(`丙。[x](cite:${KNOWN})，[x](cite:${KNOWN})，丁。`, { knownChunk: () => true, newBlockId: () => 'ddddd1' }).body).toBe(`丙。[x](cite:${KNOWN})，丁。 ^ddddd1\n`)
  })

  it('keeps the embeds a section may have and drops the rest', () => {
    let n = 0
    const formulas = [0, 1, 2, 3].map(i => chunk(`ck_01K6PQZRB8M3A4T5V6W7X8Y9F${i}`, 'formula', `$$x_${i} = ${i}$$`))
    const { blocks, dropped } = finalize(formulas.map(item => `![[${item.id}]]`).join('\n\n'), { knownChunk: () => true, embed: { order: formulas, extra: [] }, embedLimit: 3, newBlockId: () => `fffff${n++}` })
    expect(blocks).toHaveLength(3)
    expect(dropped).toEqual([`嵌入 ${formulas[3]!.id} 超过了每节 3 处`])
  })

  it('takes out the headings a writer should not write, and recall questions', () => {
    const reply = '```markdown\n### 1.2 节标题\n\n讲解。\n\n#### 小标题\n\n更多讲解。\n\n### 读完就答\n\n1. 问题？\n```'
    expect(replyBody(reply)).toBe('讲解。\n\n更多讲解。')
    // The types keep theirs (`####`), a deeper one at that level.
    expect(replyBody('### 题型与方法\n\n#### 由一点求另一点\n\n- 步骤\n\n##### 再分一类\n\n- 步骤', 4)).toBe('#### 由一点求另一点\n\n- 步骤\n\n#### 再分一类\n\n- 步骤')
  })

  it('halves a part at the heading nearest the middle', () => {
    const part = ['heading', 'text', 'text', 'heading', 'text', 'text', 'text'].map(kind => ({ kind }))
    expect(halve(part).map(half => half.length)).toEqual([3, 4])
    expect(halve([{ kind: 'text' }, { kind: 'text' }]).map(half => half.length)).toEqual([1, 1])
  })

  it('hides the assessment parts of a stage design from the writer', () => {
    const design = [
      '# 阶段设计书',
      '## 1. 阶段验收',
      '能算静水压强。',
      '## 3. 测试蓝图',
      '- 题 1：水深 4 m',
      '### 题型',
      '数值题',
      '## 4. 节点清单',
      '公式、单位。',
    ].join('\n')
    expect(teachingPartOf(design)).toBe('# 阶段设计书\n## 1. 阶段验收\n能算静水压强。\n## 4. 节点清单\n公式、单位。')
  })

  it('indexes a file with frontmatter, including an id line after a table', () => {
    const file = withFrontmatter({ lesson: 'ls_x', version: 1 }, `## 标题\n\n段落 [x](cite:${KNOWN}) ^abc123\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n^def456\n`)
    expect(indexBlocks(file).map(block => block.id)).toEqual(['abc123', 'def456'])
    expect(indexBlocks(file)[1]!.text).toContain('| 1 | 2 |')
  })
})
