// textbook unit, agent tools: read, regenerate and revise a stage's handout (讲义).
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { parseFrontmatter } from '@learning-agent/contracts'
import { linkOf, textTool } from '@learning-agent/kit'

export const name = 'learning-textbook-tools'
export const inject = ['tools', 'learnTextbook', 'learnCurriculum', 'learnCore']

/** The lesson's section of a handout, from its `###` heading to the next one; the whole text when it has none. */
function sectionOf(body: string, number: string): string | undefined {
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`^###\\s+${number.replace(/\./g, '\\.')}\\s`).test(line.trim()))
  if (start < 0) return undefined
  const end = lines.findIndex((line, index) => index > start && /^#{1,3}\s/.test(line.trim()))
  return lines.slice(start, end < 0 ? undefined : end).join('\n').trim()
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(textTool({
    name: 'read_lesson_textbook',
    title: '读讲义',
    description: '读取一个课时在讲义里的那一节（带段落编号和出处；"> [!quote]"框里是原样引用的资料原文），末尾列出程序检查时标为待核实的段落。一个阶段的课时共用一份讲义，开头是本章速览（名词表、公式表），末尾是易混点和题型与方法。出小测题、写小结前先读一遍。',
    parameters: {
      lessonId: { type: 'string', required: true },
      whole: { type: 'boolean', description: '读整份讲义（含本章速览、易混点、题型与方法），默认只读这个课时的一节' },
    },
    async execute(args, exec) {
      const { courseId } = linkOf(ctx, exec)
      const lesson = ctx.learnCurriculum.lesson(args.lessonId)
      if (!lesson?.textbookFile) throw new Error(`课时 ${args.lessonId} 不存在`)
      const file = await ctx.learnCore.files.read(courseId, lesson.textbookFile)
      if (!file) return ctx.learnTextbook.running().includes(lesson.id) ? '这个阶段的讲义正在生成，稍后再读。' : '这个阶段的讲义还没有生成。'
      const body = parseFrontmatter(file.text).body
      const part = args.whole ? undefined : sectionOf(body, lesson.number)
      const text = part ?? body
      const flagged = ctx.learnTextbook.blocks(courseId, lesson.textbookFile).filter(block => block.unverified && text.includes(`^${block.id}`)).map(block => `^${block.id}`)
      return [
        text.trimEnd(),
        part ? '（这是讲义里这一节；要看本章速览、易混点和题型与方法，传 whole: true。）' : '',
        flagged.length ? `（待核实的段落：${flagged.join('、')}。它们的式子或数值和资料对不上，可以用 revise_textbook 按原文改。）` : '',
      ].filter(Boolean).join('\n\n')
    },
  })), 'textbook tools: read_lesson_textbook')

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'regenerate_textbook',
    title: '重新生成讲义',
    description: '按当前的阶段设计书生成或重写这个课时所在阶段的整份讲义（旧版本保留在变更日志里，可以回退；学习者在讲义页改过的段落会被替换）。用于：讲义生成失败后重试、学习者要求重写、设计书改过之后。',
    parameters: { lessonId: { type: 'string', required: true } },
    async execute(args, exec) {
      linkOf(ctx, exec)
      if (!ctx.learnCurriculum.lesson(args.lessonId)) throw new Error(`课时 ${args.lessonId} 不存在`)
      void ctx.learnTextbook.generateLesson(args.lessonId).catch(() => { /* reported on the feed */ })
      return '已开始生成整份讲义。生成完或失败时，系统会发来进度通知；在那之前先和学习者做别的，或者告诉学习者稍等。'
    },
  })), 'textbook tools: regenerate_textbook')

  ctx.effect(() => ctx.tools.register(textTool({
    name: 'revise_textbook',
    title: '修改讲义段落',
    description: '只改讲义里的几段，其余段落原样不动；改写只依据资料，程序会再检查改过的段落；"> [!quote]"框是资料原文，表格由程序排，都不能用它改。用于：学习者说某段讲得不清楚或有错，或者某段标了待核实、要按原文改正。要重写整份讲义用 regenerate_textbook。',
    parameters: {
      lessonId: { type: 'string', required: true, description: '讲义所在阶段的任一课时' },
      blocks: { type: 'array', required: true, items: { type: 'string' }, description: '要改的段落编号，1 到 8 个：read_lesson_textbook 里每段末尾 ^ 后面的 6 位编号' },
      instruction: { type: 'string', required: true, description: '怎么改，一两句，例如"把推导拆成三步，每步说明用到的条件"' },
    },
    async execute(args, exec) {
      linkOf(ctx, exec)
      if (!ctx.learnCurriculum.lesson(args.lessonId)) throw new Error(`课时 ${args.lessonId} 不存在`)
      const result = await ctx.learnTextbook.reviseBlocks(args.lessonId, { blockIds: args.blocks, instruction: args.instruction }, { actor: 'teacher', reason: `修改讲义：${args.instruction}` })
      return [
        `已修改 ${result.revised} 段${result.added ? `，多出 ${result.added} 段` : ''}${result.removed ? `，删去 ${result.removed} 段` : ''}。`,
        result.unverified.length ? `改完仍待核实：${result.unverified.join('；')}` : '改过的段落程序检查没有发现问题。',
        ...result.notes,
      ].join('\n')
    },
  })), 'textbook tools: revise_textbook')
}
