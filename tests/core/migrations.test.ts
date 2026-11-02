import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Migration } from '@learning-agent/contracts'
import { Database } from '../../packages/core/src/db.ts'
import { createHarness } from '../harness.ts'

it('upgrades an independently constructed older database for every persisted unit without losing existing records', () => {
  const definitions = new Map<string, readonly Migration[]>()
  const migrate = Database.prototype.migrate
  const spy = vi.spyOn(Database.prototype, 'migrate').mockImplementation(function (this: Database, unit, steps) {
    definitions.set(unit, steps)
    migrate.call(this, unit, steps)
  })
  const h = createHarness(() => '')
  h.dispose()
  spy.mockRestore()
  expect(definitions.size).toBe(11)
  for (const [unit, steps] of definitions) {
    const root = mkdtempSync(join(tmpdir(), `migration-${unit}-`))
    const file = join(root, 'old.db')
    try {
      const old = new Database(file)
      old.migrate(unit, steps.slice(0, -1))
      old.sqlite.exec("CREATE TABLE fixture_sentinel (value TEXT); INSERT INTO fixture_sentinel VALUES ('preserve old data')")
      old.close()
      const upgraded = new Database(file)
      try {
        upgraded.migrate(unit, steps)
        expect(upgraded.sqlite.prepare('SELECT value FROM fixture_sentinel').get()).toEqual({ value: 'preserve old data' })
        expect(upgraded.sqlite.prepare('SELECT MAX(version) AS v FROM core_migrations WHERE unit = ?').get(unit)).toEqual({ v: steps.length })
        expect(readdirSync(join(root, 'migration-backups')).some(name => name.startsWith(`${unit}-${steps.length - 1}-`))).toBe(true)
      } finally { upgraded.close() }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
