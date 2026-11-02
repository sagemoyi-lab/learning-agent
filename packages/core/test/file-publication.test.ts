import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Database } from '../src/db.ts'
import { coreMigrations } from '../src/migrations.ts'
import { CoreStore } from '../src/store.ts'
import { newId } from '@learning-agent/contracts'

it('reconciles a replaced file after final publication COMMIT fails without attributing it to the learner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'file-publication-'))
  let db = new Database(join(root, 'learning.db'))
  const events: string[] = []
  const storeOf = () => new CoreStore(db, root, event => events.push(event), () => ({ create: async () => ({ id: 'ws' }) }))
  try {
    db.migrate('core', coreMigrations)
    let store = storeOf()
    const course = await store.courses.create({ title: '合成发布恢复' })
    const meta = { actor: 'teacher' as const, reason: 'synthetic publication' }
    await store.files.write(course.id, 'goal.md', 'old', meta)
    const exec = db.sqlite.exec.bind(db.sqlite)
    let commits = 0
    const spy = vi.spyOn(db.sqlite, 'exec').mockImplementation(sql => {
      if (sql === 'COMMIT' && ++commits === 2) throw new Error('injected final COMMIT')
      return exec(sql)
    })
    await expect(store.files.write(course.id, 'goal.md', 'new', meta)).rejects.toThrow('injected final COMMIT')
    spy.mockRestore()
    expect(readFileSync(join(store.courses.folder(course.id), 'goal.md'), 'utf8')).toBe('new')
    db.close()
    db = new Database(join(root, 'learning.db'))
    db.migrate('core', coreMigrations)
    store = storeOf()
    expect((await store.files.read(course.id, 'goal.md'))?.text).toBe('new')
    const changes = store.changes.list({ target: { kind: 'file', courseId: course.id, path: 'goal.md' } })
    expect(changes[0]).toMatchObject({ actor: 'teacher', before: 'old', after: 'new' })
    expect(changes.filter(change => change.actor === 'user')).toHaveLength(0)
  } finally { vi.restoreAllMocks(); db.close(); rmSync(root, { recursive: true, force: true }) }
})

it('leaves the old file untouched when the intent COMMIT fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'intent-failure-'))
  const db = new Database(join(root, 'learning.db'))
  try {
    db.migrate('core', coreMigrations)
    const store = new CoreStore(db, root, () => {}, () => ({ create: async () => ({ id: 'ws' }) }))
    const course = await store.courses.create({ title: '合成意图失败' })
    const meta = { actor: 'system' as const, reason: 'fixture' }
    await store.files.write(course.id, 'goal.md', 'old', meta)
    const exec = db.sqlite.exec.bind(db.sqlite)
    let injected = false
    const spy = vi.spyOn(db.sqlite, 'exec').mockImplementation(sql => {
      if (sql === 'COMMIT' && !injected) { injected = true; throw new Error('intent COMMIT') }
      return exec(sql)
    })
    await expect(store.files.write(course.id, 'goal.md', 'new', meta)).rejects.toThrow('intent COMMIT')
    spy.mockRestore()
    expect((await store.files.read(course.id, 'goal.md'))?.text).toBe('old')
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM core_file_publications WHERE status='pending'").get()).toEqual({ n: 0 })
  } finally { vi.restoreAllMocks(); db.close(); rmSync(root, { recursive: true, force: true }) }
})

it('reconciles interrupted intents from old, new, absent and externally edited files without replaying', async () => {
  for (const actual of ['old', 'new', 'outside', null]) {
    const root = mkdtempSync(join(tmpdir(), 'publication-recovery-'))
    let db = new Database(join(root, 'learning.db'))
    try {
      db.migrate('core', coreMigrations)
      const storeOf = () => new CoreStore(db, root, () => {}, () => ({ create: async () => ({ id: 'ws' }) }))
      let store = storeOf()
      const course = await store.courses.create({ title: '合成中断恢复' })
      await store.files.write(course.id, 'goal.md', 'old', { actor: 'teacher', reason: 'fixture' })
      const change = { id: newId('change'), at: new Date().toISOString(), actor: 'teacher', target: { kind: 'file', courseId: course.id, path: 'goal.md' }, size: 'minor', before: 'old', after: 'new', reason: 'fixture intent' }
      db.sqlite.prepare("INSERT INTO core_file_publications VALUES (?, ?, ?, 'pending', ?)").run(change.id, course.id, 'goal.md', JSON.stringify(change))
      const full = join(store.courses.folder(course.id), 'goal.md')
      if (actual === null) rmSync(full)
      else writeFileSync(full, actual)
      db.close()
      db = new Database(join(root, 'learning.db'))
      db.migrate('core', coreMigrations)
      store = storeOf()
      expect((await store.files.read(course.id, 'goal.md'))?.text ?? null).toBe(actual)
      expect(db.sqlite.prepare('SELECT status FROM core_file_publications WHERE change_id=?').get(change.id)).toEqual({ status: actual === 'new' ? 'published' : actual === 'old' ? 'failed' : 'external' })
      if (actual === 'new') expect(store.changes.list({ courseId: course.id })[0]?.actor).toBe('teacher')
      if (actual === 'outside') expect(store.changes.list({ courseId: course.id })[0]?.actor).toBe('user')
    } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
  }
})
