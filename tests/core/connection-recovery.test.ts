import { expect, it, vi } from 'vitest'
import { createHarness } from '../harness.ts'

it('all host storage services remain usable after a rollback forces a connection reopen', async () => {
  const h = createHarness(() => '')
  try {
    const db = h.ctx.learnCore.db
    const before = db.sqlite
    const exec = before.exec.bind(before)
    let injected = false
    vi.spyOn(before, 'exec').mockImplementation(sql => {
      if (sql === 'ROLLBACK' && !injected) { injected = true; throw new Error('injected rollback') }
      return exec(sql)
    })
    expect(() => db.transaction(() => { throw new Error('primary') })).toThrow('primary')
    expect(db.sqlite !== before).toBe(true)
    const course = await h.endpoint<{ id: string }>('core', 'createCourse', { title: '连接恢复合成课程' })
    expect(h.ctx.learnCore.courses.get(course.id)?.title).toBe('连接恢复合成课程')
    expect(h.ctx.learnCurriculum.stages(course.id)).toEqual([])
    expect(h.ctx.learnLibrary.sources()).toEqual([])
    expect(h.ctx.learnLibrary.courseSources(course.id)).toEqual([])
    expect(h.ctx.learnAssess.tests(course.id)).toEqual([])
  } finally { vi.restoreAllMocks(); h.dispose() }
})
