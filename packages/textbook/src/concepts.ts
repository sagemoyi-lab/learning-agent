// 本节概念 (docs/textbook/design.md, 一节教材): the lesson opens with the concepts the section needs, each
// explained in a few sentences in the writer's words, at the learner's level, citing where the material
// explains it (10-31). One model call writes them all, beside the points; the program owns the order and
// says which concepts the material does not explain. Pure helpers; the call is in index.ts.
import type { CitedChunk } from '@learning-agent/contracts'
import type { Concept } from './plan.ts'

/** Chunks after a concept's own that its writer also sees: the rest of a definition, its formula. */
const FOLLOWING = 2

export const CONCEPTS_SYSTEM = `你为一节教材写开头的"本节概念"：把读这一节要知道的概念逐个解释清楚，让学习者读后面的知识点时不卡在名词上。规则：
1. 每个概念单独一段，按清单顺序，格式："**概念名**：解释。"解释一到三句：它是什么，在本节里用来做什么，和容易混的概念怎么区分。简洁，但必须讲清楚，读完能说出它的意思；不写推导，不举长例子。
2. 用你自己的话讲，不照抄资料原句：资料原文学习者点出处就能看。
3. 事实只来自给出的资料片段和网页摘录，不用你自己的知识。每段末尾标出处 [《书名》p.页码](cite:片段ID)；网页摘录写成 [网页标题](网址)。正文里不写资料名、网站名或网址。
4. 公式和资料保持一致：概念由式子定义时，用行内公式（写成 $…$）写出资料里原样的式子，符号和写法都不改，不变形、不合并；资料里没有的式子不写。不嵌入原文。
5. 按学习者的水平讲：已经会的一句带过；还没答对、证据冲突、反复问过的，多一句点明最容易混的地方。可以借"学习者已经会的"来类比或衔接，但只点名，不讲它们的内容。不要在正文里复述学习者的掌握情况。
6. 不写习题、小测题或测试安排；不写标题、前言和总结；不加清单以外的概念。除了出处里的片段 ID，正文不出现内部编号（kn_、ck_ 等）。
7. 这些是写法要求，正文里不要提到它们（比如不写"照原样""不作变形"）。
8. 中文。直接输出 Markdown，不要代码块包裹。`

/**
 * What the concepts are explained from: each concept's chunk and the next few of its subsection, once each,
 * in reading order.
 */
export function conceptMaterial(concepts: readonly Concept[], material: readonly CitedChunk[]): CitedChunk[] {
  const keep = new Set<number>()
  for (const concept of concepts) {
    const at = concept.chunk ? material.indexOf(concept.chunk) : -1
    if (at < 0) continue
    keep.add(at)
    for (let i = at + 1; i <= at + FOLLOWING && material[i] && material[i]!.kind !== 'heading'; i += 1) keep.add(i)
  }
  return [...keep].sort((a, b) => a - b).map(index => material[index]!)
}

/** The concept list as the writer sees it: where each is explained, or that the supplement explains it. */
export function conceptList(concepts: readonly Concept[]): string {
  return concepts.map((concept, index) => `${index + 1}. ${concept.name}${concept.chunk ? `（见 ${concept.chunk.id}）` : '（本节资料没讲，见补充资料或网页摘录）'}`).join('\n')
}
