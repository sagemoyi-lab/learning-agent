// A fake model for writing a handout (docs/textbook/design.md): it reads the prompts the way the real one would —
// the plan's numbered outline and exercise stems, the terms and formulas asked for, a section's material, the pairs
// and the types — and answers in the formats the program asks for. Tests override one call kind at a time.
// `handoutCourse` sets up a course on the synthetic long section with a stage of the lessons given.
import { join } from 'node:path'
import type { CitedChunk, Lesson, Stage, WebCandidate } from '@learning-agent/contracts'
import { FIXTURES, createHarness, textbookSettled, type Harness, type ModelCall } from '../harness.ts'

export type Reply = (call: ModelCall) => string | { finish: 'max-tokens' }

export const isPlan = (call: ModelCall) => call.purpose === 'learning-textbook-plan'
const writes = (start: string) => (call: ModelCall) => call.purpose === 'learning-textbook' && call.system.startsWith(start)
export const isOverview = writes('你为一章讲义写"本章速览"')
export const isSection = writes('你为一位具体的学习者写一章讲义里的一个小节')
export const isConfusions = writes('你为一章讲义写"易混点"')
export const isTypes = writes('你为一章讲义写"题型与方法"')
export const isReviser = writes('你修改一份讲义')

/** The plan prompt's outline: `[n] kind · text`, with the section (from 1) each line is under. */
export function outline(call: ModelCall): { readonly n: number; readonly kind: string; readonly text: string; readonly section: number }[] {
  const part = call.prompt.split('# 本章资料提纲').at(-1)!.split('\n# ')[0]!
  let section = 0
  return part.split('\n').flatMap(line => {
    const heading = /^## 小节 (\d+)：/.exec(line)
    if (heading) section = Number(heading[1])
    const match = /^\[(\d+)\] (\S+) · (.*)$/.exec(line)
    return match ? [{ n: Number(match[1]), kind: match[2]!, text: match[3]!, section }] : []
  })
}

/** The exercise stems the plan was shown. */
export function stemsIn(call: ModelCall): string[] {
  const part = call.prompt.split('# 本章课后习题（只有题干）').at(-1)!
  return [...part.matchAll(/^\d+\. (.*)$/gm)].map(match => match[1]!)
}

/**
 * The usual plan: one sentence, 压强 at the first text chunk, every formula, one type taking every exercise with
 * the first worked example; `parts` replaces any of these.
 */
export function planReply(call: ModelCall, parts: Record<string, unknown> = {}): string {
  const lines = outline(call)
  const first = lines.find(line => line.kind === '正文')
  const example = lines.find(line => line.kind === '例题')
  const stems = stemsIn(call)
  return JSON.stringify({
    overview: '这一章讲静止流体里的压强怎么表示、怎么算。',
    terms: first ? [{ name: '压强', chunk: first.n }] : [],
    formulas: lines.filter(line => line.kind === '公式').map(line => line.n),
    needs: [],
    confusions: [],
    types: stems.length ? [{ name: '由一点压强求另一点压强', exercises: stems.map((_, index) => index + 1), sections: [1], example: example?.n ?? 0 }] : [],
    ...parts,
  })
}

/** 名词 and 公式: each term in a sentence citing the chunk it is at, each formula named. */
export function overviewReply(call: ModelCall, words = '单位面积上受到的力'): string {
  const terms = [...call.prompt.matchAll(/^\d+\. (.+?)（见 (ck_[0-9A-Z]{26})）$/gm)].map(match => ({ name: match[1], text: words, cite: match[2] }))
  const formulas = [...call.prompt.matchAll(/^- (ck_[0-9A-Z]{26})：/gm)].map((match, index) => ({ id: match[1], name: `第${'一二三四五六七八九十'[index] ?? index + 1}个式子`, use: '静止、连通的同一种液体' }))
  return JSON.stringify({ terms, formulas })
}

/** The chunks a writer prompt lists, in order: its own material, then the supplementary one. */
export function materialOf(call: ModelCall): { readonly id: string; readonly kind: string; readonly text: string }[] {
  return [...call.prompt.matchAll(/^\[(ck_[0-9A-Z]{26})\] .+? · (\S+) · .*\n(.*)$/gm)].map(match => ({ id: match[1]!, kind: match[2]!, text: match[3]! }))
}

/** The section a writer is asked for: `1.2.3 静力学基本方程`. */
export function sectionOf(call: ModelCall): string {
  return /# 这次写：(.+)/.exec(call.prompt)![1]!
}

/** A section: a paragraph in its own words citing its first text chunk, and its first formula embedded. */
export function sectionReply(call: ModelCall, words = '这一节用自己的话讲'): string {
  const material = materialOf(call)
  const text = material.find(chunk => chunk.kind === '正文') ?? material[0]!
  const formula = material.find(chunk => chunk.kind === '公式')
  return [`${words}。[合成资料 p.1](cite:${text.id})`, formula ? `![[${formula.id}]]` : ''].filter(Boolean).join('\n\n')
}

/** 易混点: each pair told apart, citing the first chunk given. */
export function confusionsReply(call: ModelCall): string {
  const pairs = [...call.prompt.split('# 资料片段')[0]!.matchAll(/^\d+\. (.+?) 与 (.+)$/gm)]
  const first = materialOf(call)[0]
  return JSON.stringify({ rows: pairs.map(match => ({ a: match[1], b: match[2], diff: '看零点取在哪里', cites: first ? [first.id] : [] })) })
}

/** 题型与方法: each type in the order asked, citing its worked example when it has one. */
export function typesReply(call: ModelCall): string {
  const part = call.prompt.split('# 题型（按这个顺序写）\n').at(-1)!.split('\n# ')[0]!
  return part.split('\n\n').map(block => {
    const example = /^原书例题：(ck_[0-9A-Z]{26})$/m.exec(block)?.[1]
    return [
      `#### ${/^\d+\. (.+)$/m.exec(block)![1]}`,
      '- **怎么认出：** 给了一点的压强，要求另一点的。',
      '- **步骤：** 1. 选等压面：把两点连起来。2. 列静力学基本方程。',
      '- **容易错：** 表压和绝压混用。',
      example ? `- **原书例题：** [合成资料 p.2](cite:${example})` : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

/** The paragraphs a revision asks for: `[[段落 id]]` and the text under it. */
export function targetsOf(call: ModelCall): { readonly id: string; readonly text: string }[] {
  const part = call.prompt.split('# 要改的段落\n').at(-1)!.split('\n# ')[0]!
  return part.split(/\n\n(?=\[\[段落 )/).flatMap(piece => {
    const match = /^\[\[段落 ([0-9a-z]{6})\]\]\n([\s\S]*)$/.exec(piece.trim())
    return match ? [{ id: match[1]!, text: match[2]!.trim() }] : []
  })
}

/** A revision that rewrites every paragraph asked for by `rewrite`. */
export function reviseReply(call: ModelCall, rewrite: (text: string) => string): string {
  return targetsOf(call).map(target => `[[段落 ${target.id}]]\n${rewrite(target.text)}`).join('\n\n')
}

/** The usual fake: plan, write the overview, each section, the confusions and the types. */
export function handoutReply(call: ModelCall): string | undefined {
  if (isPlan(call)) return planReply(call)
  if (isOverview(call)) return overviewReply(call)
  if (isSection(call)) return sectionReply(call)
  if (isConfusions(call)) return confusionsReply(call)
  if (isTypes(call)) return typesReply(call)
  return undefined
}

/** The usual fake, failing on a call it does not know. */
export const usual: Reply = call => handoutReply(call) ?? (() => { throw new Error(`unexpected model call: ${call.purpose}`) })()

export const WEB = { url: 'https://hg.example.edu.cn/notes/incline', title: '倾斜液柱压差计（合成网页）' }

export interface HandoutCourse {
  readonly h: Harness
  readonly courseId: string
  readonly stage: Stage
  readonly lessons: readonly Lesson[]
  /** The skeleton source's chunks of section 1.2. */
  readonly chunks: readonly CitedChunk[]
  /** Knowledge node ids by title. */
  readonly ids: Readonly<Record<string, string>>
  /** The questions the web was searched for. */
  readonly searched: string[][]
}

export interface HandoutOptions {
  readonly lessons?: readonly { number: string; title: string }[]
  /** Knowledge nodes besides the diagnostic's: sourced in the first chunk `source` takes, core nodes of the stage. */
  readonly nodes?: readonly { readonly title: string; readonly source?: (chunk: CitedChunk) => boolean; readonly core?: boolean }[]
  readonly web?: boolean
  readonly reference?: boolean
}

/**
 * A course on the synthetic long section (1.2 静止流体的压强), with a stage of `lessons` (by default 1.2 alone),
 * designed but not confirmed. A fake web: one university page, which must never be added to the library.
 */
export async function handoutCourse(reply: Reply, options: HandoutOptions = {}): Promise<HandoutCourse> {
  const h = createHarness(reply, { textbook: { webCheck: options.web ?? false } })
  const { ctx, endpoint } = h
  const meta = { actor: 'teacher' as const, reason: '讲义测试（合成）' }
  const course = await endpoint('core', 'createCourse', { title: '讲义（合成资料）' })
  const fixture = (name: string) => ({ file: join(FIXTURES, name, 'source.md'), parsed: [join(FIXTURES, name, 'middle.json')] })
  const skeleton = await endpoint('library', 'import', { title: '合成长小节', kind: 'textbook', authority: '1', courseId: course.id, role: 'skeleton', ...fixture('synthetic-long-section') })
  if (options.reference) await endpoint('library', 'import', { title: '合成参考书', kind: 'textbook', authority: '1', courseId: course.id, role: 'reference', ...fixture('synthetic-reference') })
  const searched: string[][] = []
  ctx.learnLibrary.searchWeb = async questions => {
    searched.push([...questions])
    const candidates = questions.map((question): WebCandidate => ({
      url: WEB.url, title: WEB.title, snippet: '', site: 'hg.example.edu.cn', organization: 'example.edu.cn', authority: '2', rule: '国内高校', format: 'html', provider: 'Exa', question,
    }))
    return { candidates, clues: [], notes: [] }
  }
  ctx.learnLibrary.readWeb = async url => ({
    status: 'read', url, title: WEB.title, site: 'hg.example.edu.cn', authority: '2', rule: '国内高校',
    passages: ['课程介绍与考核方式。', '倾斜液柱压差计把 U 形管的一支斜放，读数沿斜管读，倾斜让读数放大，适合测很小的压差。'],
  })
  ctx.learnLibrary.addWeb = async () => { throw new Error('the handout must not add web pages to the library') }
  // The steps before the stage (goal, graph, diagnostic), so the planner reaches the lesson.
  await ctx.learnGoal.saveDraft(course.id, {
    purpose: '验证讲义', scenario: '合成资料', canDo: ['用静力学基本方程算压强'], level: '能独立完成', verification: '小测',
    boundaries: { exclude: [], defaultConditions: { book: 'closed', calculator: true, formulaSheet: false } },
  }, '# 目标说明\n', meta)
  await ctx.learnGoal.confirm(course.id)
  const chunks = ctx.learnLibrary.section(skeleton.id, '1.2')
  const nodes = options.nodes ?? []
  const graph = await ctx.learnKnowledge.add(course.id, { nodes: [{ title: '诊断', kind: 'skill' as const }, ...nodes.map(node => ({ title: node.title, kind: 'knowledge' as const, ...(node.source ? { sources: [chunks.find(node.source)!.id] } : {}) }))] }, meta)
  const ids = Object.fromEntries(graph.nodes.map(node => [node.title, node.id as string]))
  const exercise = ctx.learnLibrary.section(skeleton.id, '习题').find(chunk => chunk.kind === 'exercise')!
  const [problem] = ctx.learnAssess.addProblems([{
    stem: exercise.text, answer: { kind: 'numeric', value: 30, unit: 'kPa', tolerance: { absolute: 0.1 } }, answerSource: 'book', tier: 1,
    origin: { kind: 'chunk', chunkId: exercise.id, label: exercise.citation }, nodeIds: [ids['诊断'] as never], pool: 'practice',
  }])
  const diagnostic = ctx.learnAssess.startTest({ courseId: course.id, kind: 'diagnostic', problemIds: [problem!.id] })
  await ctx.learnAssess.submit(diagnostic.id, [{ problemId: problem!.id, text: '30 kPa' }])
  const { stages: [stage] } = await ctx.learnCurriculum.saveRoadmap(course.id, [{ title: '静止流体', objective: '会用静力学基本方程' }], meta)
  const wanted = options.lessons ?? [{ number: '1.2', title: '静止流体的压强' }]
  const { lessons } = await ctx.learnCurriculum.saveDesign(stage!.id, {
    markdown: `# 阶段设计\n\n## 课时\n\n${wanted.map(lesson => `${lesson.number} ${lesson.title}。`).join('\n')}`, lessons: [...wanted],
    nodeIds: nodes.filter(node => node.core).map(node => ids[node.title]! as never),
  }, meta)
  await h.settle()
  return { h, courseId: course.id, stage: stage!, lessons, chunks, ids, searched }
}

/** Confirm the stage's design, which writes its handout; resolves when it settles. */
export async function confirm(course: HandoutCourse): Promise<'ready' | 'failed'> {
  const settled = textbookSettled(course.h.ctx, course.lessons[0]!.id)
  await course.h.endpoint('curriculum', 'confirmDesign', { stageId: course.stage.id })
  return settled
}

/** The published handout. */
export async function handoutText(course: HandoutCourse): Promise<string> {
  const lesson = course.h.ctx.learnCurriculum.lesson(course.lessons[0]!.id)!
  return (await course.h.ctx.learnCore.files.read(course.courseId, lesson.textbookFile!))!.text
}

/** The block whose text starts with `start`, from the published file. */
export async function blockOf(course: HandoutCourse, start: string) {
  const textbook = course.h.ctx.learnTextbook
  for (const block of textbook.blocks(course.courseId)) {
    const text = (await textbook.block(course.courseId, block.id))!.text
    if (text.startsWith(start)) return { ...block, text }
  }
  throw new Error(`no block starting with ${start}`)
}
