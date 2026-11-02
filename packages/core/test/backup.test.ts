import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Database } from '../src/db.ts'
import { coreMigrations } from '../src/migrations.ts'
import { createBackup, restoreBackup } from '../src/backup.ts'

let root: string
let home: string
let sessions: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'backup-test-'))
  home = join(root, 'home')
  sessions = join(root, 'sessions')
  mkdirSync(sessions)
  const db = new Database(join(home, '.learning', 'learning.db'))
  db.migrate('core', coreMigrations)
  db.sqlite.exec("CREATE TABLE demo (value TEXT); INSERT INTO demo VALUES ('最后一次 WAL 写入')")
  db.close()
  mkdirSync(join(home, 'courses', '合成课程'), { recursive: true })
  for (const name of ['goal', 'handout', 'answers', 'review', 'notes', 'sidechat']) writeFileSync(join(home, 'courses', '合成课程', `${name}.md`), `合成 ${name}`)
  writeFileSync(join(sessions, 'history.jsonl'), '{"synthetic":true}\n')
  writeFileSync(join(home, '.env'), 'DO_NOT_COPY=synthetic')
  writeFileSync(join(sessions, '.credentials.yaml'), 'DO_NOT_COPY: synthetic')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('backs up the database, course files and session history without credentials and restores to a fresh directory', () => {
  const backup = join(root, 'backup')
  const manifest = createBackup({ learningHome: home, target: backup, sessionRoot: sessions, commit: 'fixture' })
  expect(manifest.migrations).toContainEqual({ unit: 'core', version: 1 })
  expect(manifest.files.some(file => file.path.includes('.env') || file.path.includes('.credentials'))).toBe(false)
  const restored = join(root, 'restored')
  restoreBackup(backup, restored)
  const db = new Database(join(restored, '.learning', 'learning.db'))
  try { expect(db.sqlite.prepare('SELECT value FROM demo').get()).toEqual({ value: '最后一次 WAL 写入' }) } finally { db.close() }
  for (const name of ['goal', 'handout', 'answers', 'review', 'notes', 'sidechat']) expect(readFileSync(join(restored, 'courses', '合成课程', `${name}.md`), 'utf8')).toBe(`合成 ${name}`)
  expect(readFileSync(join(restored, '.dsh-home', 'sessions', 'history.jsonl'), 'utf8')).toContain('synthetic')
  expect(() => restoreBackup(backup, restored)).toThrow(/空目录/)
})

it('rejects damaged, missing or unlisted files before writing any destination', () => {
  const backup = join(root, 'backup')
  const manifest = createBackup({ learningHome: home, target: backup, commit: 'fixture' })
  const entry = manifest.files.find(file => file.path.endsWith('goal.md'))!
  const path = join(backup, entry.path)
  const original = readFileSync(path)
  writeFileSync(path, 'corrupt')
  expect(() => restoreBackup(backup, join(root, 'restore'))).toThrow(/校验/)
  expect(existsSync(join(root, 'restore'))).toBe(false)
  writeFileSync(path, original)
  writeFileSync(join(backup, 'learning', 'extra.txt'), 'unlisted')
  expect(() => restoreBackup(backup, join(root, 'restore'))).toThrow(/不一致/)
  rmSync(join(backup, 'learning', 'extra.txt'))
  rmSync(path)
  expect(() => restoreBackup(backup, join(root, 'restore'))).toThrow()
  expect(existsSync(join(root, 'restore'))).toBe(false)
})

it('refuses maintenance while the library is open and refuses nested backup targets', () => {
  const db = new Database(join(home, '.learning', 'learning.db'))
  try {
    expect(() => createBackup({ learningHome: home, target: join(root, 'backup'), commit: 'fixture' })).toThrow(/正在使用/)
    expect(() => new Database(join(home, '.learning', 'learning.db'))).toThrow(/正在使用/)
  } finally { db.close() }
  expect(() => createBackup({ learningHome: home, target: join(home, 'backup'), commit: 'fixture' })).toThrow(/不能在学习库内/)
})

it('rejects traversal in a manifest without touching the destination', () => {
  const backup = join(root, 'backup')
  const manifest = createBackup({ learningHome: home, target: backup, commit: 'fixture' })
  manifest.files[0]!.path = 'learning/../../escape'
  writeFileSync(join(backup, 'manifest.json'), JSON.stringify(manifest))
  expect(() => restoreBackup(backup, join(root, 'restore'))).toThrow(/不安全路径/)
  expect(existsSync(join(root, 'restore'))).toBe(false)
})

it('refuses newer migration versions and preserves a usable snapshot before a failed upgrade', () => {
  const file = join(home, '.learning', 'learning.db')
  const db = new Database(file)
  try {
    expect(() => db.migrate('core', [])).toThrow(/新版本程序/)
    const before = readdirSync(join(home, '.learning', 'migration-backups'))
    expect(() => db.migrate('core', [...coreMigrations, { version: 2, sql: 'CREATE TABLE broken (' }])).toThrow(/迁移前备份/)
    const snapshots = readdirSync(join(home, '.learning', 'migration-backups')).filter(name => !before.includes(name))
    expect(snapshots).toHaveLength(1)
    const snapshot = new DatabaseSync(join(home, '.learning', 'migration-backups', snapshots[0]!), { readOnly: true })
    try { expect(snapshot.prepare('SELECT value FROM demo').get()).toEqual({ value: '最后一次 WAL 写入' }) } finally { snapshot.close() }
    expect(db.sqlite.prepare('SELECT MAX(version) AS v FROM core_migrations WHERE unit = ?').get('core')).toEqual({ v: 1 })
  } finally { db.close() }
})
