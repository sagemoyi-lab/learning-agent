// textbook (docs/textbook/design.md): a stage's handout is planned once from the chapter's outline and exercise
// stems; 本章速览's terms and formulas, each lesson's section, 易混点 and 题型与方法 are written apart and joined in
// the book's order, the tables laid out by the program. The lessons share the file, each block knowing its lesson. A
// section cut off at the output limit is written again as two halves; a handout that still fails is reported to the
// teacher, who retries once before handing it back. Synthetic material; fake model.
import { expect, afterEach, it } from 'vitest'
import { handoutFile } from '@learning-agent/contracts'
import type { ModelCall } from '../harness.ts'
import {
  confirm, handoutCourse, handoutText, isOverview, isPlan, isSection, isTypes, outline, planReply, sectionOf, sectionReply, usual,
  type HandoutCourse, type Reply,
} from './fakes.ts'

let course: HandoutCourse | undefined
afterEach(() => course?.h.dispose())

const THREE = [{ number: '1.2.2', title: '压强的几种表示' }, { number: '1.2.3', title: '静力学基本方程' }, { number: '1.2.4', title: '基本方程的应用' }]

/** `usual`, with the plan's `parts` replaced. */
const planning = (parts: Record<string, unknown>, other: Reply = usual): Reply => call => (isPlan(call) ? planReply(call, parts) : other(call))

const headings = (text: string, level: string) => text.split('\n').filter(line => line.startsWith(`${level} `)).map(line => line.replace(/ \[[^\]]*\]\(cite:[^)]*\)$/, ''))

it('plans the chapter once, writes 本章速览, each section, 易混点 and 题型与方法 apart, and joins them in the book\'s order', async () => {
  const seen: { state: string; draft?: string; stage?: string }[] = []
  course = await handoutCourse(planning({ confusions: [{ a: '表压强', b: '绝对压强' }] }, call => {
    // While the last part is written: the stage still designing, the parts so far readable as a draft.
    if (isTypes(call)) seen.push({ ...course!.h.ctx.learnTextbook.status(course!.lessons[0]!.id), stage: course!.h.ctx.learnCurriculum.stage(course!.stage.id)?.status })
    return usual(call)
  }), { lessons: THREE })
  const { h, courseId, lessons, chunks } = course
  expect(await confirm(course)).toBe('ready')

  // One plan over the chapter, which sees the exercises' stems and never their answers.
  const [plan, ...others] = h.calls.filter(isPlan)
  expect(others).toEqual([])
  expect(plan!.prompt).toContain('## 小节 1：1.2.2 压强的几种表示')
  expect(plan!.prompt).toContain('## 小节 3：1.2.4 基本方程的应用')
  expect(plan!.prompt).toContain('敞口水槽中水深 3 m')
  expect(plan!.prompt).not.toContain('[30 kPa]')
  // The writers never see an exercise; each section's writer sees its own material, the terms and the formula table.
  for (const call of h.calls.filter(call => call.purpose === 'learning-textbook')) {
    expect(call.prompt).not.toContain('敞口水槽中水深 3 m')
    expect(call.prompt).not.toContain('[30 kPa]')
  }
  const sections = h.calls.filter(isSection)
  expect(sections.map(sectionOf).sort()).toEqual(THREE.map(lesson => `${lesson.number} ${lesson.title}`))
  const equation = sections.find(call => sectionOf(call) === '1.2.3 静力学基本方程')!
  expect(equation.prompt).toContain('任取两点 1 和 2')
  expect(equation.prompt).not.toContain('以绝对真空为零点')
  expect(equation.prompt).toContain('# 本章速览里已经解释的名词（直接用，不再定义）\n压强')
  expect(equation.prompt).toContain('$p_2 = p_1 + \\rho g h$')
  expect(equation.prompt).toContain('字数上限：')
  expect(h.calls.filter(isOverview)).toHaveLength(1)

  const text = await handoutText(course)
  expect(headings(text, '##')).toEqual(['## 静止流体'])
  expect(headings(text, '###')).toEqual(['### 本章速览', ...THREE.map(lesson => `### ${lesson.number} ${lesson.title}`), '### 易混点', '### 题型与方法'])
  expect(headings(text, '####')).toEqual(['#### 名词', '#### 公式', '#### 由一点压强求另一点压强'])
  // Each section's heading opens the book where it starts.
  const start = chunks.find(chunk => chunk.section.at(-1)?.startsWith('1.2.3') && chunk.kind !== 'heading')!
  expect(text).toContain(`### 1.2.3 静力学基本方程 [${start.citation}](cite:${start.id})`)
  // The formula table: the program's, each formula as the source writes it.
  for (const formula of chunks.filter(chunk => chunk.kind === 'formula')) {
    expect(text).toContain(`| $${formula.text.replace(/\$\$/g, '').trim()}$ |`)
  }
  expect(text).toContain('| **压强** | 单位面积上受到的力 |')
  expect(text).toContain('| **表压强** 与 **绝对压强** | 看零点取在哪里 |')
  expect(text).toContain('- **原书例题：** [合成资料 p.2](cite:')

  // The lessons share the file; each paragraph knows its lesson, the chapter's own parts none.
  const files = lessons.map(lesson => h.ctx.learnCurriculum.lesson(lesson.id)!.textbookFile)
  expect(new Set(files)).toEqual(new Set([handoutFile(h.ctx.learnCurriculum.stage(course.stage.id)!.folder)]))
  const blocks = h.ctx.learnTextbook.blocks(courseId, files[0])
  expect(blocks.slice(0, 3).map(block => block.lessonId)).toEqual([undefined, undefined, undefined])
  expect(blocks.at(-1)!.lessonId).toBeUndefined()
  for (const lesson of lessons) expect(blocks.filter(block => block.lessonId === lesson.id)).toHaveLength(2)
  // The reader opens a lesson at its section and puts 读完了 at its end.
  const view = await h.endpoint('textbook', 'lesson', { lessonId: lessons[1]!.id })
  expect(view).toMatchObject({ handout: true, ends: { [lessons[1]!.id]: blocks.filter(block => block.lessonId === lessons[1]!.id).at(-1)!.id } })

  // The stage waits for the whole handout; the teacher hears once.
  expect(seen).toEqual([expect.objectContaining({ state: 'running', stage: 'designing', draft: expect.stringContaining('### 1.2.2 压强的几种表示') })])
  for (const lesson of lessons) expect(h.ctx.learnTextbook.status(lesson.id)).toMatchObject({ state: 'ready', unverified: 0 })
  expect(h.ctx.learnCurriculum.stage(course.stage.id)?.status).toBe('ready')
  await h.settle()
  expect(h.delivered.filter(item => item.text.includes('讲义 静止流体 已生成'))).toHaveLength(1)
  // The run counts its calls and their tokens, for measuring.
  const writing = h.calls.filter(call => call.purpose.startsWith('learning-textbook'))
  const run = JSON.parse((h.ctx.learnCore.db.sqlite.prepare('SELECT data FROM textbook_handouts WHERE stage_id = ?').get(course.stage.id) as { data: string }).data)
  expect(run.usage).toEqual({ calls: writing.length, input: writing.reduce((sum, call) => sum + call.system.length + call.prompt.length, 0), output: expect.any(Number) })
  // 本课资料 lists the lessons under the source they cite.
  expect(await h.endpoint('textbook', 'sourceUses', { courseId })).toEqual([
    { sourceId: start.sourceId, lessons: lessons.map(lesson => ({ id: lesson.id, number: lesson.number, title: lesson.title })) },
  ])
})

it('gives the knowledge sidebar the points the paragraphs of a lesson\'s section are linked to', async () => {
  course = await handoutCourse(call => (isSection(call) ? sectionReply(call, '静力学基本方程用于这一节') : usual(call)), {
    lessons: THREE,
    // Sourced in 1.2.3's material: before the handout is written, that is how it is found.
    nodes: [{ title: '静力学基本方程', source: chunk => chunk.section.at(-1)?.startsWith('1.2.3') === true && chunk.kind === 'text' }],
  })
  const { h, courseId, lessons, ids } = course
  const node = ids['静力学基本方程']!
  const about = { id: lessons[1]!.id, number: '1.2.3', title: '静力学基本方程' }
  expect(await h.endpoint('textbook', 'lessonNodes', { courseId, lessonId: lessons[1]!.id })).toEqual({ lesson: about, nodeIds: [node], from: 'material' })
  expect(await confirm(course)).toBe('ready')
  // Written: the points its own section's paragraphs are linked to; the other sections' paragraphs name it too.
  expect(await h.endpoint('textbook', 'lessonNodes', { courseId, lessonId: lessons[1]!.id })).toEqual({ lesson: about, nodeIds: [node], from: 'textbook' })
  expect(await h.endpoint('textbook', 'lessonNodes', { courseId, lessonId: lessons[0]!.id })).toMatchObject({ nodeIds: [node], from: 'textbook' })
})

it('does not bind handout blocks to every same-name identity', async () => {
  course = await handoutCourse(call => (isSection(call) ? sectionReply(call, '静力学基本方程用于这一节') : usual(call)), { nodes: [{ title: '静力学基本方程' }] })
  const { h, courseId } = course
  // The teacher may not repeat a name in a course; the learner may, deliberately.
  const duplicate = await h.ctx.learnKnowledge.add(courseId, { nodes: [{ title: '静力学基本方程', kind: 'skill', domain: '不同能力' }] }, { actor: 'user', reason: '同名异义' })
  expect(await confirm(course)).toBe('ready')
  expect(h.ctx.learnTextbook.blocks(courseId).length).toBeGreaterThan(0)
  expect(h.ctx.learnTextbook.blocks(courseId).every(block => block.nodeIds.length === 0)).toBe(true)
  expect(duplicate.nodes.every(item => h.ctx.learnKnowledge.links(item.id).length === 0)).toBe(true)
})

it('writes a cut-off section again as two halves, the second going on without an opening', async () => {
  let cut = false
  course = await handoutCourse(call => {
    if (!cut && isSection(call)) {
      cut = true
      return { finish: 'max-tokens' }
    }
    return usual(call)
  })
  expect(await confirm(course)).toBe('ready')
  const again = course.h.calls.filter(isSection)
  // 1 cut-off attempt + 2 halves, under one heading.
  expect(again).toHaveLength(3)
  expect(again[1]!.prompt).not.toContain('这是后半部分')
  expect(again[2]!.prompt).toContain('这是后半部分：接着前面写，不要开场白。')
  const text = await handoutText(course)
  expect(text.split('\n').filter(line => line.startsWith('### 1.2 静止流体的压强'))).toHaveLength(1)
  expect(text.match(/这一节用自己的话讲。/g)).toHaveLength(2)
})

it('explains many terms in groups, keeps them in the book\'s order, and names the ones found nowhere', async () => {
  const names = Array.from({ length: 20 }, (_, index) => `第${index + 1}个名词`)
  const termsOf = (call: ModelCall) => [...outline(call).filter(line => line.kind === '正文').slice(0, 20).map((line, index) => ({ name: names[index]!, chunk: line.n })).reverse(), { name: '倾斜压差计', chunk: 0 }]
  course = await handoutCourse(call => (isPlan(call) ? planReply(call, { terms: termsOf(call) }) : usual(call)))
  expect(await confirm(course)).toBe('ready')
  const lists = course.h.calls.filter(isOverview).map(call => [...call.prompt.matchAll(/^\d+\. (第\d+个名词)/gm)].map(match => match[1]))
  // Two groups of ten; the formulas go with the first.
  expect(lists).toEqual([names.slice(0, 10), names.slice(10)])
  expect(course.h.calls.filter(isOverview).map(call => call.prompt.includes('# 要写名称和什么时候用的公式'))).toEqual([true, false])
  const text = await handoutText(course)
  expect([...text.split('#### 名词')[1]!.split('#### 公式')[0]!.matchAll(/\*\*(第\d+个名词)\*\*/g)].map(match => match[1])).toEqual(names)
  // Explained nowhere (no other material, no web here): named under the table, and told to the teacher.
  expect(text).toContain('> [!note] 资料里没有讲到：倾斜压差计。')
  expect(text).not.toContain('**倾斜压差计**')
  expect(course.h.ctx.learnTextbook.status(course.lessons[0]!.id)).toMatchObject({ missing: ['倾斜压差计'] })
})

it('hands a failed handout to the teacher once, then to the learner', async () => {
  course = await handoutCourse(() => ({ finish: 'max-tokens' }))
  const { h, courseId, lessons } = course
  const [lesson] = lessons
  expect(await confirm(course)).toBe('failed')
  await h.settle()
  const status = h.ctx.learnTextbook.status(lesson!.id)
  expect(status).toMatchObject({ state: 'failed', failures: 1 })
  expect(status.message).toContain('超出模型单次能写的长度')
  expect(h.ctx.learnCurriculum.stage(course.stage.id)?.status).toBe('designing')
  expect(await h.ctx.learnPlanner.next(courseId)).toMatchObject({ actor: 'teacher', title: '讲义生成失败' })
  expect(h.delivered.at(-1)).toMatchObject({ mode: 'followup', text: expect.stringContaining('讲义 静止流体 生成失败') })

  // The teacher retries (regenerate_textbook); a second failure goes back to the learner, without waking the teacher.
  const settled = new Promise(done => { const off = h.ctx.on('learning/textbook-failed', () => { off(); done('failed') }) })
  void h.ctx.learnTextbook.generateLesson(lesson!.id).catch(() => {})
  expect(await settled).toBe('failed')
  await h.settle()
  expect(await h.ctx.learnPlanner.next(courseId)).toMatchObject({ actor: 'learner', title: '讲义生成失败' })
  expect(h.delivered.at(-1)).toMatchObject({ mode: 'inject' })
})
