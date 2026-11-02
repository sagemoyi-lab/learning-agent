// Restore into a NEW DSH store using its public persistence API. Never edit an original log.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { Context as ContextType } from '@deepseek-ai/cordis'

const [staging, target, original] = process.argv.slice(2) as [string, string, string]
if (!staging || !target || !original) throw new Error('Missing restore directories')
const requireDSH = createRequire(new URL('../.tools/dsh/package.json', import.meta.url))
const { Context } = requireDSH('@deepseek-ai/cordis') as { Context: new () => ContextType }
const { default: Backend } = await import(requireDSH.resolve('@deepseek-ai/dsh-session-persistence-jsonl')) as { default: typeof JsonlSessionPersistence }
const originalPath = resolve(original)
const relocated = (path: string) => path === originalPath ? target : path.startsWith(originalPath + sep) ? target + path.slice(originalPath.length) : path
const dsh = join(staging, '.dsh-home')
const sessions = join(dsh, 'sessions')
if (existsSync(sessions)) {
  const output = join(dsh, 'relocated-sessions')
  mkdirSync(output)
  const reader = new Backend(new Context(), { root: sessions })
  const writer = new Backend(new Context(), { root: output })
  for (const entry of await reader.list()) {
    const handle = await reader.open(entry.header.id, 'read')
    try {
      const header: SessionHeader = { ...handle.header, ...(handle.header.cwd ? { cwd: relocated(handle.header.cwd) } : {}) }
      const copy = await writer.create(header, { inheritedEventCount: handle.inheritedEventCount })
      try {
        const { events } = await handle.read()
        await copy.append(events)
        await copy.flush()
      } finally { await copy.close() }
    } finally { await handle.close() }
  }
  // The byte-identical backup remains in the source; only the new restored store is replaced.
  rmSync(sessions, { recursive: true })
  renameSync(output, sessions)
}
const workspace = join(dsh, 'storages', 'workspace.json')
if (existsSync(workspace)) {
  const state = JSON.parse(readFileSync(workspace, 'utf8')) as { tables: { workspaces: Record<string, { path: string }> } }
  for (const record of Object.values(state.tables.workspaces)) record.path = relocated(record.path)
  writeFileSync(workspace, JSON.stringify(state, null, 2), { mode: 0o600 })
}
writeFileSync(join(staging, '.learning', 'restore-location.json'), JSON.stringify({ original: originalPath, restored: target, at: new Date().toISOString() }))
