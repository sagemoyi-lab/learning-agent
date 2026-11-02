import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Backend from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { Database } from '../../packages/core/src/db.ts'
import { coreMigrations } from '../../packages/core/src/migrations.ts'
import { createBackup, restoreBackup } from '../../packages/core/src/backup.ts'

it('restores real compressed DSH history, workspace IDs and attachments into a different data directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-restore-'))
  try {
    const home = join(root, 'old')
    const dsh = join(root, 'dsh')
    const course = join(home, 'courses', 'synthetic')
    mkdirSync(course, { recursive: true })
    mkdirSync(join(dsh, 'sessions'), { recursive: true })
    mkdirSync(join(dsh, 'attachments'), { recursive: true })
    mkdirSync(join(dsh, 'storages'), { recursive: true })
    writeFileSync(join(dsh, 'attachments', 'synthetic.bin'), 'synthetic attachment')
    writeFileSync(join(dsh, 'storages', 'workspace.json'), JSON.stringify({ tables: { workspaces: { ws: { path: course } } } }))
    const db = new Database(join(home, '.learning', 'learning.db'))
    db.migrate('core', coreMigrations)
    db.close()
    const reader = new Backend(new Context(), { root: join(dsh, 'sessions') })
    const id = SessionId('synthetic-restored-session')
    const h = await reader.create({ id, version: SESSION_FORMAT_VERSION, createdAt: 0, cwd: course, isSeeded: false })
    // Even an empty conversation is materialized and must keep its identity and cwd.
    await h.flush()
    await h.close()
    const target = join(root, 'new')
    createBackup({ learningHome: home, target: join(root, 'backup'), sessionRoot: join(dsh, 'sessions'), attachmentRoot: join(dsh, 'attachments'), workspaceFile: join(dsh, 'storages', 'workspace.json'), commit: 'fixture' })
    restoreBackup(join(root, 'backup'), target, (staging, final, metadata) => {
      execFileSync(process.execPath, [resolve('scripts/restore-dsh.ts'), staging, final, metadata.learningHome], { stdio: 'pipe' })
    })
    const restored = new Backend(new Context(), { root: join(target, '.dsh-home', 'sessions') })
    const handle = await restored.open(id, 'read')
    try {
      expect(handle.header.cwd).toBe(join(target, 'courses', 'synthetic'))
      expect((await handle.read()).events).toEqual([])
    } finally { await handle.close() }
    expect(JSON.parse(readFileSync(join(target, '.dsh-home', 'storages', 'workspace.json'), 'utf8')).tables.workspaces.ws.path).toBe(join(target, 'courses', 'synthetic'))
    expect(readFileSync(join(target, '.dsh-home', 'attachments', 'synthetic.bin'), 'utf8')).toBe('synthetic attachment')
    expect((await reader.list())[0]?.header.cwd).toBe(course)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
