// Offline, checksummed snapshots. No network calls, keys, WAL copies or overwrite restores.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { acquireLease } from './lease.ts'

interface Entry { path: string; size: number; sha256: string }
interface Manifest {
  format: 1
  learningHome: string
  createdAt: string
  commit: string
  migrations: unknown[]
  excluded: string[]
  sessionsIncluded: boolean
  files: Entry[]
}
const excluded = ['.env', '.credentials.yaml', 'learning.db-wal', 'learning.db-shm', 'learning.db.run-lock']
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function safePath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`备份清单含不安全路径：${path}`)
  }
  const full = resolve(root, path)
  if (!full.startsWith(resolve(root) + sep)) throw new Error(`备份路径越界：${path}`)
  let cursor = resolve(root)
  for (const part of path.split('/')) {
    cursor = join(cursor, part)
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`备份不允许符号链接：${path}`)
  }
  return full
}

function walk(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    if (excluded.includes(entry.name) || entry.name.startsWith('.env.')) return []
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`备份不允许符号链接：${path}`)
    if (entry.isDirectory()) return walk(root, path)
    if (!entry.isFile()) throw new Error(`备份不允许特殊文件：${path}`)
    return [path]
  }).sort()
}

function ensureEmpty(path: string): void {
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || readdirSync(path).length)) {
    throw new Error(`目标必须是空目录：${path}`)
  }
}

export function createBackup(input: { learningHome: string; target: string; sessionRoot?: string; attachmentRoot?: string; workspaceFile?: string; commit: string }): Manifest {
  const home = resolve(input.learningHome)
  const target = resolve(input.target)
  if (target === home || target.startsWith(home + sep)) throw new Error('备份目标不能在学习库内')
  if (input.sessionRoot && (target === resolve(input.sessionRoot) || target.startsWith(resolve(input.sessionRoot) + sep))) throw new Error('备份目标不能在会话目录内')
  ensureEmpty(target)
  const dbFile = join(home, '.learning', 'learning.db')
  if (!existsSync(dbFile)) throw new Error(`学习库数据库不存在：${dbFile}`)
  const release = acquireLease(`${dbFile}.run-lock`)
  const staging = `${target}.pending-${randomUUID()}`
  try {
    mkdirSync(join(staging, 'learning', '.learning'), { recursive: true })
    const db = new DatabaseSync(dbFile, { readOnly: true })
    let migrations: unknown[]
    try {
      db.prepare('VACUUM INTO ?').run(join(staging, 'learning', '.learning', 'learning.db'))
      migrations = db.prepare('SELECT unit, MAX(version) AS version FROM core_migrations GROUP BY unit ORDER BY unit').all()
    } finally { db.close() }
    for (const path of walk(home)) {
      if (path === '.learning/learning.db') continue
      const dest = safePath(join(staging, 'learning'), path)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, readFileSync(safePath(home, path)), { mode: 0o600 })
    }
    if (input.sessionRoot) {
      if (!existsSync(input.sessionRoot)) throw new Error('DSH 会话目录不存在；请确认 DSH_HOME 或 --sessions')
      for (const path of walk(input.sessionRoot)) {
        const dest = safePath(join(staging, 'sessions'), path)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, readFileSync(safePath(input.sessionRoot, path)), { mode: 0o600 })
      }
    }
    if (input.workspaceFile && existsSync(input.workspaceFile)) {
      mkdirSync(join(staging, 'dsh', 'storages'), { recursive: true })
      writeFileSync(join(staging, 'dsh', 'storages', 'workspace.json'), readFileSync(input.workspaceFile), { mode: 0o600 })
    }
    if (input.attachmentRoot && existsSync(input.attachmentRoot)) {
      for (const path of walk(input.attachmentRoot)) {
        const dest = safePath(join(staging, 'dsh', 'attachments'), path)
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, readFileSync(safePath(input.attachmentRoot, path)), { mode: 0o600 })
      }
    }
    const manifest: Manifest = {
      format: 1, learningHome: home, createdAt: new Date().toISOString(), commit: input.commit, migrations,
      excluded, sessionsIncluded: Boolean(input.sessionRoot),
      files: walk(staging).map(path => {
        const bytes = readFileSync(safePath(staging, path))
        return { path, size: bytes.length, sha256: digest(bytes) }
      }),
    }
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
    ensureEmpty(target)
    if (existsSync(target)) rmdirSync(target)
    renameSync(staging, target)
    return manifest
  } finally {
    rmSync(staging, { recursive: true, force: true })
    release()
  }
}

export function restoreBackup(backup: string, destination: string, prepare?: (staging: string, target: string, manifest: Manifest) => void): Manifest {
  const source = resolve(backup)
  const target = resolve(destination)
  if (source === target || target.startsWith(source + sep) || source.startsWith(target + sep)) throw new Error('备份与恢复目录不能重叠')
  ensureEmpty(target)
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8')) as Manifest
  if (manifest.format !== 1 || !Array.isArray(manifest.files)) throw new Error('不支持的备份清单')
  const entries = new Map<string, Buffer>()
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || entries.has(file.path) || !/^(learning|sessions|dsh)\//.test(file.path)) throw new Error('备份清单路径无效或重复')
    if (file.path.split('/').some(part => excluded.includes(part) || part.startsWith('.env.'))) throw new Error('备份清单包含禁止恢复的文件')
    const bytes = readFileSync(safePath(source, file.path))
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error(`备份校验失败：${file.path}`)
    entries.set(file.path, bytes)
  }
  if (!entries.has('learning/.learning/learning.db')) throw new Error('备份缺少数据库')
  const actual = walk(source).filter(path => path !== 'manifest.json')
  if (actual.length !== entries.size || actual.some(path => !entries.has(path))) throw new Error('备份目录与清单不一致')
  const staging = `${target}.pending-${randomUUID()}`
  try {
    mkdirSync(staging, { recursive: true })
    for (const [path, bytes] of entries) {
      const restored = path.startsWith('learning/') ? path.slice(9) : path.startsWith('dsh/') ? `.dsh-home/${path.slice(4)}` : `.dsh-home/${path}`
      const full = safePath(staging, restored)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, bytes, { mode: 0o600 })
    }
    const db = new DatabaseSync(join(staging, '.learning', 'learning.db'), { readOnly: true })
    try {
      const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      if (result.integrity_check !== 'ok') throw new Error('备份数据库完整性校验失败')
    } finally { db.close() }
    prepare?.(staging, target, manifest)
    ensureEmpty(target)
    if (existsSync(target)) rmdirSync(target)
    mkdirSync(dirname(target), { recursive: true })
    renameSync(staging, target)
    return manifest
  } finally { rmSync(staging, { recursive: true, force: true }) }
}
