import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Database } from '../src/db.ts'

it('resets state after BEGIN or COMMIT failure and preserves the primary error on rollback failure', () => {
  for (const failed of ['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK']) {
    const root = mkdtempSync(join(tmpdir(), 'transaction-failure-'))
    const db = new Database(join(root, 'learning.db'))
    try {
      db.sqlite.exec('CREATE TABLE fixture (x INTEGER)')
      const exec = db.sqlite.exec.bind(db.sqlite)
      let injected = false
      const spy = vi.spyOn(db.sqlite, 'exec').mockImplementation(sql => {
        if (!injected && sql === failed) { injected = true; throw new Error(`injected ${failed}`) }
        return exec(sql)
      })
      const events: string[] = []
      expect(() => db.transaction(() => {
        db.sqlite.prepare('INSERT INTO fixture VALUES (1)').run()
        db.afterCommit(() => events.push('lost'))
        if (failed === 'ROLLBACK') throw new Error('primary callback failure')
      })).toThrow(failed === 'ROLLBACK' ? 'primary callback failure' : `injected ${failed}`)
      spy.mockRestore()
      expect(() => db.transaction(() => {
        db.sqlite.prepare('INSERT INTO fixture VALUES (2)').run()
        throw new Error('next rollback')
      })).toThrow('next rollback')
      db.transaction(() => {
        db.sqlite.prepare('INSERT INTO fixture VALUES (3)').run()
        db.afterCommit(() => events.push('saved'))
      })
      expect(db.sqlite.prepare('SELECT x FROM fixture').all()).toEqual([{ x: 3 }])
      expect(events).toEqual(['saved'])
    } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
  }
})
