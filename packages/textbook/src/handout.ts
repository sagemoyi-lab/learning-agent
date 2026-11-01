// The handout (讲义) of a stage (docs/textbook/design.md): one file its lessons share, read beside the book. It
// opens with 本章速览 (a few sentences, a table of terms, a table of formulas), gives each lesson's section in a
// few short paragraphs, and ends with 易混点 and 题型与方法. One call plans it from the chapter's outline and its
// exercise stems; the writers never see the exercises. The tables are the program's: writers give their rows as
// JSON, and formulas are copied from the source as they are. Pure helpers; the calls are in index.ts.
import type { CitedChunk } from '@learning-agent/contracts'

/** A lesson's part of the handout: its number and title, and the material it is written from. */
export interface Section {
  readonly lessonId: string
  readonly number: string
  readonly title: string
  readonly chunks: readonly CitedChunk[]
}

export interface Need {
  /** What doing the exercises needs, as something to learn. */
  readonly text: string
  /** The material says nothing about it: the gap is looked for elsewhere. */
  readonly covered: boolean
}

/** A term of 本章速览: the chunk where the material explains it, none when it does not (looked for elsewhere). */
export interface Term {
  readonly name: string
  readonly chunk?: CitedChunk
}

/** A kind of exercise, by the method that solves it. */
export interface ProblemType {
  readonly name: string
  /** The sections (0-based) whose material it uses. */
  readonly sections: readonly number[]
  /** A worked example of the book that shows the method. */
  readonly example?: CitedChunk
}

export interface HandoutPlan {
  readonly overview: string
  readonly terms: readonly Term[]
  readonly formulas: readonly CitedChunk[]
  /** What the exercises need, by section. */
  readonly needs: readonly (readonly Need[])[]
  readonly confusions: readonly { readonly a: string; readonly b: string }[]
  readonly types: readonly ProblemType[]
  /** Exercises (1-based, as the plan saw them) no type takes: told in the notes. */
  readonly untyped: readonly number[]
}

const MAX_TERMS = 25
const MAX_FORMULAS = 20
const MAX_CONFUSIONS = 8
const MAX_TYPES = 6
/** Exercise stems shown when planning, and how much of each. */
const MAX_STEMS = 40
const STEM_CHARS = 200
/** The outline's characters in all, shared by its chunks, and the most and fewest one chunk shows. */
const OUTLINE_BUDGET = 30_000
const OUTLINE_MOST = 110
const OUTLINE_FEWEST = 40

/** How long a section's explanation may be, in Chinese characters, by what the learner can already do. */
export const SECTION_CAP = { known: 150, usual: 400, weak: 700 } as const
/** A section this far over its cap is shortened once. */
export const OVER_CAP = 1.2
/** Source text one section may copy in: the key formulas and figures. */
export const SECTION_EMBEDS = 3

const KIND: Record<string, string> = { heading: '小标题', text: '正文', formula: '公式', table: '表', figure: '图', example: '例题' }

export const PLAN_SYSTEM = `你为一位学习者规划一章讲义怎么写。讲义配合原书读，要简洁：开头是"本章速览"（一到三句概览、名词表、公式表），然后按小节简短地讲，最后是"易混点"和"题型与方法"。给你本章资料的提纲（按小节分组、按顺序编号的片段，每段只列开头）、学习目标、阶段设计书的教学部分、学习者的掌握情况，以及本章的课后习题（只有题干，没有答案）。
1. overview：一到三句，说这一章解决什么问题、按什么顺序讲；不写数值和公式。
2. terms：读这一章要知道的名词（物理量、术语、装置、方法、定律），以及做习题要用、资料却没讲的。name 用资料里的叫法；chunk 是资料里定义或第一次讲它的片段编号，资料里没讲的写 0。按在资料里出现的顺序，最多 25 个；单个符号和单位不单列。
3. formulas：本章最重要的公式片段的编号（只选"公式"片段），按出现顺序，最多 20 个。
4. needs：做这些习题要会的方法、关系、条件或步骤，每条一句，写成要学的内容，不抄题目、不写题目里的数字；已经列为名词的不再写。section 是它属于第几个小节（提纲里"小节"后面的序号）；covered 表示资料有没有讲到。
5. confusions：本章最容易混的成对概念，最多 8 对，a、b 各是一个名词。
6. types：按解题用到的方法把习题分成题型，最多 6 类。name 按方法起名（如"由一点压强求另一点压强"），不按题目里的设备起名，不写题号；exercises 是属于这一类的习题序号，每道习题都要归进一类；sections 是要用到的小节序号；example 是演示这种方法的原书例题片段编号，没有写 0。
没有习题时 needs 和 types 给空数组。只输出 JSON：{"overview":"…","terms":[{"name":"…","chunk":3}],"formulas":[5],"needs":[{"text":"…","section":1,"covered":true}],"confusions":[{"a":"…","b":"…"}],"types":[{"name":"…","exercises":[1,2],"sections":[1],"example":12}]}`

export const REMEDIAL_PLAN = '这是补课阶段：只为复盘里没过的地方规划。名词只列没过的地方用到的；易混点和题型只要和没过的地方有关的。'

export const OVERVIEW_SYSTEM = `你为一章讲义写"本章速览"里的名词表和公式表。讲义是配合原书读的笔记，要简洁。规则：
1. 名词：每个一句话（50 字以内）说清它是什么；容易和别的混的，半句点明区别。已经会的更短；还没答对、反复问过的点明最容易混的地方。用你自己的话，不照抄资料原句。可以借"学习者已经会的"来类比，只点名。
2. 公式：只写名称（如"静力学基本方程"）和什么时候用（适用条件，一句话）；式子由程序从资料里原样放进去，你不写式子。
3. 事实只来自给出的资料片段和网页摘录，不用你自己的知识。cite 写这个名词出自的片段 ID，网页摘录写它的网址；资料和网页都没讲的名词不写。行内公式只写资料里原样出现的式子。
4. 不写习题、小测题或测试安排；不在正文里复述学习者的掌握情况；不出现内部编号。
只输出 JSON：{"terms":[{"name":"…","text":"…","cite":"ck_…"}],"formulas":[{"id":"ck_…","name":"…","use":"…"}]}`

export const SECTION_SYSTEM = `你为一位具体的学习者写一章讲义里的一个小节。讲义配合原书读，是简洁的笔记：开头的"本章速览"已经解释了名词、列出了公式，末尾另有"易混点"和"题型与方法"。规则：
1. 写两到五段：这一节解决什么问题，结论是什么，怎么来的（只讲思路，不逐步推导），什么条件下成立、怎么用。名词表里的名词直接用，不再定义；不逐段复述资料，不写总结。
2. 不超过给出的字数上限（公式和嵌入的原文不算）。已经会的一两句带过；薄弱的多讲一步、点明常见错误。不要在正文里复述学习者的掌握情况。
3. 事实只来自给出的资料片段和网页摘录，不用你自己的知识；资料里没有的不写。每段末尾标出处：[《书名》p.页码](cite:片段ID)，用到几个片段就写几个，段中不再标；网页摘录写成 [网页标题](网址)。正文里不写资料名、网站名或网址。
4. 公式和资料保持一致：行内公式只写资料里原样出现的式子或单个符号，不变形、不推导新式子。讲解离不开的关键公式或原图，单独一行写 ![[片段ID]] 放原文，全节最多 3 处；正文段落和例题不嵌入（例题由"题型与方法"引用）。
5. "做练习要会的"每一条都讲到怎么用；只讲道理，不出题、不提习题。
6. 不写标题，不用小标题，不用单独一行加粗字当小标题。除了出处和嵌入里的片段 ID，正文不出现内部编号（kn_、ck_ 等）。
7. 中文。直接输出 Markdown，不要前言后语，不要代码块包裹。`

export const CONFUSIONS_SYSTEM = `你为一章讲义写"易混点"表：每行一对容易混的概念，用一句话写清区别在哪（看什么来分，混了会错在哪）。规则：
1. 区别只来自给出的资料片段，不用你自己的知识；用你自己的话，不照抄资料原句；式子只写资料里原样出现的。
2. cites 写这一行用到的片段 ID，最多 3 个；资料里分不清的那一对不写。
3. 不写习题、小测题或测试安排，不出现内部编号。
只输出 JSON：{"rows":[{"a":"…","b":"…","diff":"…","cites":["ck_…"]}]}`

export const TYPES_SYSTEM = `你为一章讲义写"题型与方法"：每类题怎么认出、怎么做、容易错在哪。规则：
1. 每类题用 "#### 题型名" 开头，下面是一个列表：
   - **怎么认出：** 一句话，看题目给了什么、要求什么。
   - **步骤：** 编号的几步，每步写做什么、为什么这样做（如"1. 选等压面：把两点的压强连起来"）。
   - **容易错：** 一两条。
   - **原书例题：** 写出处标签 [《书名》p.页码](cite:例题片段ID)；没有给例题就不写这一条。
2. 方法和事实只来自给出的资料片段（含原书例题和解答），不用你自己的知识；式子只写资料里原样出现的。
3. 不出题，不写习题的题号、题目和数字；除了出处里的片段 ID，不出现内部编号。
4. 中文。直接输出 Markdown，不要前言后语，不要代码块包裹。`

const squeeze = (text: string) => text.replace(/[\s$\\{}_^]/g, '')

/** Whether `text` repeats a stretch of an exercise: what is needed is said in the writer's words, not the problem's. */
export function copiesStem(text: string, stems: readonly string[], run = 10): boolean {
  const own = squeeze(text)
  if (own.length < run) return false
  return stems.some(stem => {
    const other = squeeze(stem)
    for (let i = 0; i + run <= own.length; i += 1) if (other.includes(own.slice(i, i + run))) return true
    return false
  })
}

/** Text that names an exercise by its number: the handout says how to solve a kind of problem, never which one (11-01). */
export const NAMES_EXERCISE = /(?:习题|练习题|课后题)\s*[（(]?\s*[0-9０-９一二三四五六七八九十]|第\s*[0-9０-９]+\s*题/

/** Exercise stems for planning: numbered, cut short, no answers. */
export function stemsOf(exercises: readonly CitedChunk[]): string[] {
  return exercises.slice(0, MAX_STEMS).map(chunk => {
    const text = chunk.text.replace(/\s+/g, ' ').trim()
    return [...text].length > STEM_CHARS ? `${[...text].slice(0, STEM_CHARS).join('')}…` : text
  })
}

/** The chapter's material as numbered lines under each section: kind and the first words of each chunk. */
export function outlineOf(sections: readonly Section[]): string {
  const total = sections.reduce((sum, section) => sum + section.chunks.length, 0)
  const each = Math.max(OUTLINE_FEWEST, Math.min(OUTLINE_MOST, Math.floor(OUTLINE_BUDGET / Math.max(1, total))))
  let n = 0
  return sections.map((section, index) => [
    `## 小节 ${index + 1}：${section.number} ${section.title}`,
    ...section.chunks.map(chunk => {
      n += 1
      const text = chunk.text.replace(/\s+/g, ' ').trim()
      const head = chunk.kind === 'heading' ? text : `${[...text].slice(0, each).join('')}${[...text].length > each ? '…' : ''}`
      return `[${n}] ${KIND[chunk.kind] ?? chunk.kind} · ${head}`
    }),
  ].join('\n')).join('\n\n')
}

export function planPrompt(input: { readonly context: string; readonly sections: readonly Section[]; readonly stems: readonly string[]; readonly remedial: boolean }): string {
  const total = input.sections.reduce((sum, section) => sum + section.chunks.length, 0)
  return [
    input.context,
    input.remedial ? `# 补课\n${REMEDIAL_PLAN}` : '',
    `# 本章资料提纲（${input.sections.length} 个小节，${total} 段）\n${outlineOf(input.sections)}`,
    `# 本章课后习题（只有题干）\n${input.stems.length ? input.stems.map((stem, index) => `${index + 1}. ${stem}`).join('\n') : '（没有）'}`,
  ].filter(Boolean).join('\n\n')
}

const text = (value: unknown, most: number) => (typeof value === 'string' ? value.replace(/^#+\s*/, '').replaceAll('*', '').trim() : '').slice(0, most * 2)
const lengthOf = (value: string) => [...value].length

/**
 * The plan of a reply, shaped by the program; undefined when the reply is not a plan at all. Chunk numbers in the
 * reply count through the whole outline from 1, section numbers from 1.
 */
export function readPlan(reply: unknown, sections: readonly Section[], stems: readonly string[]): HandoutPlan | undefined {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return undefined
  const raw = reply as Record<string, unknown>
  const flat = sections.flatMap(section => section.chunks)
  const at = (value: unknown) => flat[Number(value) - 1]
  const list = (value: unknown) => (Array.isArray(value) ? value as Record<string, unknown>[] : []).filter(item => item && typeof item === 'object')
  const sectionIndex = (value: unknown) => {
    const n = Number(value)
    return Number.isInteger(n) && n >= 1 && n <= sections.length ? n - 1 : undefined
  }
  const fine = (value: string, most: number) => lengthOf(value) >= 2 && lengthOf(value) <= most && !copiesStem(value, stems) && !NAMES_EXERCISE.test(value)

  const overview = text(raw.overview, 200)
  const needs: Need[][] = sections.map(() => [])
  for (const item of list(raw.needs)) {
    const need = text(item.text, 80)
    if (!fine(need, 80)) continue
    const into = needs[sectionIndex(item.section) ?? 0]!
    if (!into.some(other => other.text === need)) into.push({ text: need, covered: item.covered !== false })
  }
  const confusions: { a: string; b: string }[] = []
  for (const item of list(raw.confusions)) {
    const a = text(item.a, 20), b = text(item.b, 20)
    if (!fine(a, 20) || !fine(b, 20) || squeeze(a) === squeeze(b)) continue
    if (!confusions.some(pair => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a))) confusions.push({ a, b })
  }
  const types: ProblemType[] = []
  const typed = new Set<number>()
  for (const item of list(raw.types)) {
    const name = text(item.name, 30)
    if (!fine(name, 30) || types.some(type => type.name === name) || types.length >= MAX_TYPES) continue
    for (const n of Array.isArray(item.exercises) ? item.exercises : []) if (Number.isInteger(Number(n))) typed.add(Number(n))
    const used = [...new Set((Array.isArray(item.sections) ? item.sections : []).map(sectionIndex).filter((index): index is number => index !== undefined))].sort((a, b) => a - b)
    const example = at(item.example)
    types.push({ name, sections: used, ...(example?.kind === 'example' ? { example } : {}) })
  }
  const formulas = [...new Set((Array.isArray(raw.formulas) ? raw.formulas : []).map(at).filter((chunk): chunk is CitedChunk => chunk?.kind === 'formula'))]
    .sort((a, b) => flat.indexOf(a) - flat.indexOf(b)).slice(0, MAX_FORMULAS)
  return {
    overview: copiesStem(overview, stems) || NAMES_EXERCISE.test(overview) ? '' : overview,
    terms: termsOf(raw.terms, flat, stems),
    formulas,
    needs,
    confusions: confusions.slice(0, MAX_CONFUSIONS),
    types,
    untyped: types.length ? stems.map((_, index) => index + 1).filter(n => !typed.has(n)) : [],
  }
}

/**
 * The terms of a reply in reading order, those the material does not explain last: each at the chunk the reply
 * named, or else at the first chunk that has its name. Repeats and names copied from an exercise go.
 */
function termsOf(raw: unknown, material: readonly CitedChunk[], stems: readonly string[]): Term[] {
  const seen = new Set<string>()
  const found: { name: string; at: number }[] = []
  for (const item of Array.isArray(raw) ? raw as { name?: unknown; chunk?: unknown }[] : []) {
    const name = text(item?.name, 20)
    const key = squeeze(name)
    if (lengthOf(name) < 2 || lengthOf(name) > 20 || seen.has(key) || copiesStem(name, stems)) continue
    seen.add(key)
    let at = Number(item.chunk) - 1
    // A heading names a part: the term is explained in the text under it.
    while (material[at]?.kind === 'heading') at += 1
    if (!material[at]) at = material.findIndex(chunk => chunk.kind !== 'heading' && squeeze(chunk.text).includes(key))
    found.push({ name, at })
  }
  const order = (at: number) => (at < 0 ? material.length : at)
  return found.sort((a, b) => order(a.at) - order(b.at)).slice(0, MAX_TERMS).map(({ name, at }) => (at < 0 ? { name } : { name, chunk: material[at]! }))
}

/** Chunks after a term's own that its writer also sees: the rest of a definition, its formula. */
const FOLLOWING = 2

/** What some terms are explained from: each one's chunk and the next few of its subsection, once each, in reading order. */
export function termMaterial(terms: readonly Term[], material: readonly CitedChunk[]): CitedChunk[] {
  const keep = new Set<number>()
  for (const term of terms) {
    const at = term.chunk ? material.indexOf(term.chunk) : -1
    if (at < 0) continue
    keep.add(at)
    for (let i = at + 1; i <= at + FOLLOWING && material[i] && material[i]!.kind !== 'heading'; i += 1) keep.add(i)
  }
  return [...keep].sort((a, b) => a - b).map(index => material[index]!)
}

/** What a formula's name and use are written from: the formula and the chunk before and after it. */
export function formulaMaterial(formulas: readonly CitedChunk[], material: readonly CitedChunk[]): CitedChunk[] {
  const keep = new Set<number>()
  for (const formula of formulas) {
    const at = material.indexOf(formula)
    for (const index of [at - 1, at, at + 1]) if (at >= 0 && material[index] && material[index]!.kind !== 'heading') keep.add(index)
  }
  return [...keep].sort((a, b) => a - b).map(index => material[index]!)
}

/** Chunks that read as part of a solution: formulas, figures and the short steps between them. */
const STEP = /^\s*[（(]?\s*\d?\s*[）)]?\s*(?:解|所以|即|故|则|得|由|将|代入|因为|因|于是|边界条件|式中|其中)/

function inSolution(chunk: CitedChunk): boolean {
  if (chunk.kind === 'formula' || chunk.kind === 'figure' || chunk.kind === 'table') return true
  return chunk.kind === 'text' && (STEP.test(chunk.text) || [...chunk.text.trim()].length <= 40)
}

/** A worked example and its solution: the example and the chunks after it that read as its steps. */
export function exampleWithSolution(example: CitedChunk, material: readonly CitedChunk[]): CitedChunk[] {
  const at = material.indexOf(example)
  if (at < 0) return [example]
  let end = at
  while (end + 1 < material.length && end - at < 12 && inSolution(material[end + 1]!)) end += 1
  return material.slice(at, end + 1)
}

/** Chunks of the material that name `name`, at most `most`: what a confusion is told from. */
export function chunksNaming(name: string, material: readonly CitedChunk[], most = 3): CitedChunk[] {
  const key = squeeze(name)
  return material.filter(chunk => chunk.kind !== 'heading' && squeeze(chunk.text).includes(key)).slice(0, most)
}

/** Chinese characters of an explanation, without source text copied in, math, links or markup: what a cap counts. */
export function hanCount(markdown: string): number {
  const prose = markdown
    .split(/\n{2,}/).filter(piece => !/^>\s*\[!/.test(piece.trim())).join('\n')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, '')
    .replace(/\[([^\]]*)\]\((?:cite:|https?:\/\/)[^)\s]+\)/g, '')
  return (prose.match(/[一-鿿]/g) ?? []).length
}

/** A table cell: one line, pipes escaped. */
function cell(value: string): string {
  return value.replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim()
}

export interface Cite {
  readonly label: string
  readonly target: string
}

const link = (cite: Cite | undefined) => (cite ? `[${cite.label}](${cite.target.startsWith('http') ? cite.target : `cite:${cite.target}`})` : '')

/** A formula chunk as one table cell: its display math inline on one line, its equation number apart. */
export function formulaCell(chunk: CitedChunk): { readonly tex: string; readonly tag?: string } {
  const body = chunk.text.trim()
  const math = /\$\$([\s\S]+?)\$\$/.exec(body)?.[1] ?? /^\$([^$]+)\$$/.exec(body)?.[1]
  if (!math) return { tex: cell(body) }
  const tag = /\\tag\*?\{([^}]*)\}/.exec(math)?.[1]
  const tex = math.replace(/\\tag\*?\{[^}]*\}/g, '').replace(/\s+/g, ' ').replace(/\|/g, '\\vert ').trim()
  return { tex: `$${tex}$`, ...(tag ? { tag: tag.trim() } : {}) }
}

export function termsTable(rows: readonly { readonly name: string; readonly text: string; readonly cite?: Cite }[]): string {
  return ['| 名词 | 是什么 | 出处 |', '|---|---|---|', ...rows.map(row => `| **${cell(row.name)}** | ${cell(row.text)} | ${link(row.cite)} |`)].join('\n')
}

export function formulasTable(rows: readonly { readonly chunk: CitedChunk; readonly name: string; readonly use: string }[]): string {
  return ['| 公式 | 名称 | 什么时候用 | 出处 |', '|---|---|---|---|', ...rows.map(row => {
    const { tex, tag } = formulaCell(row.chunk)
    return `| ${tex} | ${cell(row.name)}${tag ? `（式 ${cell(tag)}）` : ''} | ${cell(row.use)} | ${link({ label: row.chunk.citation, target: row.chunk.id })} |`
  })].join('\n')
}

export function confusionsTable(rows: readonly { readonly a: string; readonly b: string; readonly diff: string; readonly cites: readonly Cite[] }[]): string {
  return ['| 容易混的 | 区别在哪 | 出处 |', '|---|---|---|', ...rows.map(row => `| **${cell(row.a)}** 与 **${cell(row.b)}** | ${cell(row.diff)} | ${row.cites.map(link).join('')} |`)].join('\n')
}

/** `### 1.2 静止流体的压强` and a badge for where the section starts in the book. */
export function sectionHeading(section: Section): string {
  const first = section.chunks.find(chunk => chunk.kind !== 'heading') ?? section.chunks[0]
  return `### ${section.number} ${section.title}${first ? ` [${first.citation}](cite:${first.id})` : ''}`
}

/** The heading a section of the handout opens with: its lesson's number at the start. */
export function sectionNumberOf(heading: string): string | undefined {
  return /^###\s+([0-9]+(?:\.[0-9]+)*)\s/.exec(heading.trim())?.[1]
}

/** How a writer's JSON names a chunk it cites: an id it was given, or a web page's address. */
export function citeOf(value: unknown, known: (id: string) => Cite | undefined): Cite | undefined {
  return typeof value === 'string' ? known(value.trim()) : undefined
}

/**
 * The rows of 名词 and 公式 a writer's reply gives, kept to the terms and formulas it was asked for. A term row needs a
 * source: one the material does not explain and the writer cited nothing it was given for goes (the caller names it).
 */
export function readOverview(reply: unknown, input: { readonly terms: readonly Term[]; readonly formulas: readonly CitedChunk[]; readonly known: (id: string) => Cite | undefined }) {
  const raw = (reply && typeof reply === 'object' ? reply : {}) as { terms?: unknown; formulas?: unknown }
  const asked = new Map(input.terms.map(term => [squeeze(term.name), term]))
  const terms: { name: string; text: string; cite?: Cite }[] = []
  for (const item of Array.isArray(raw.terms) ? raw.terms as Record<string, unknown>[] : []) {
    const term = asked.get(squeeze(text(item?.name, 20)))
    const said = text(item?.text, 120)
    if (!term || !said || terms.some(row => row.name === term.name)) continue
    const cite = citeOf(item.cite, input.known) ?? (term.chunk ? input.known(term.chunk.id) : undefined)
    if (cite) terms.push({ name: term.name, text: said, cite })
  }
  // In the plan's order, which is the book's.
  terms.sort((a, b) => input.terms.findIndex(term => term.name === a.name) - input.terms.findIndex(term => term.name === b.name))
  const formulas: { chunk: CitedChunk; name: string; use: string }[] = []
  for (const item of Array.isArray(raw.formulas) ? raw.formulas as Record<string, unknown>[] : []) {
    const chunk = input.formulas.find(formula => formula.id === (typeof item?.id === 'string' ? item.id.trim() : ''))
    const name = text(item?.name, 30)
    if (!chunk || !name || formulas.some(row => row.chunk === chunk)) continue
    formulas.push({ chunk, name, use: text(item.use, 80) })
  }
  formulas.sort((a, b) => input.formulas.indexOf(a.chunk) - input.formulas.indexOf(b.chunk))
  return { terms, formulas }
}

/** The rows of 易混点 a writer's reply gives, each with the citations it may keep. */
export function readConfusions(reply: unknown, known: (id: string) => Cite | undefined) {
  const raw = (reply && typeof reply === 'object' ? reply : {}) as { rows?: unknown }
  const rows: { a: string; b: string; diff: string; cites: Cite[] }[] = []
  for (const item of Array.isArray(raw.rows) ? raw.rows as Record<string, unknown>[] : []) {
    const a = text(item?.a, 20), b = text(item?.b, 20), diff = text(item?.diff, 120)
    if (!a || !b || !diff) continue
    const cites = [...new Set(Array.isArray(item.cites) ? item.cites : [])].flatMap(id => citeOf(id, known) ?? []).slice(0, 3)
    if (cites.length) rows.push({ a, b, diff, cites })
  }
  return rows.slice(0, MAX_CONFUSIONS)
}
