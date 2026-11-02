// core's data: courses, course files with their change log, session links, the evidence log, proposals.
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import {
  COURSE_LAYOUT,
  Change,
  Course,
  DATA_LAYOUT,
  LearningApiError,
  LogEntry,
  Proposal,
  SessionLink,
  newId,
  relativePath,
  safeFileName,
  withFrontmatter,
  type ChangeMeta,
  type ChangeTarget,
  type CourseFile,
  type LearnCore,
  type LogQuery,
  type NewLogEntry,
} from '@learning-agent/contracts'
import { nullable, type Database } from './db.ts'

/** Emits a `learning/*` fact; core passes `ctx.emit`. */
type Emit = (name: string, payload: unknown) => void

/** The workspace registry part core needs (DSH's `ctx.workspaceRegistry`). */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ readonly id: string }>
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Stable lookup key of a change target (accepts plain-string ids from callers). */
function targetKey(target: ChangeTarget | { readonly kind: 'file'; readonly courseId?: string; readonly path: string }): string {
  if (target.kind === 'file') return `file:${target.courseId ?? ''}:${target.path}`
  return `${target.kind}:${target.id}`
}

function now(): string {
  return new Date().toISOString()
}

export class CoreStore {
  constructor(
    private readonly db: Database,
    private readonly dataRoot: string,
    private readonly emit: Emit,
    private readonly workspaces: () => WorkspaceRegistryLike,
  ) { this.recoverPublications() }

  /** Recover durable intents by comparing actual content, never replaying over outside edits. */
  private recoverPublications(courseId?: string, path?: string): void {
    const rows = this.db.sqlite.prepare(`SELECT data FROM core_file_publications WHERE status='pending'${courseId ? ' AND course_id=? AND path=?' : ''}`).all(...(courseId ? [courseId, path!] : [])) as { data: string }[]
    for (const row of rows) {
      const change = Change.parse(JSON.parse(row.data))
      if (change.target.kind !== 'file' || !change.target.courseId) continue
      const full = this.filePath(change.target.courseId, change.target.path)
      const actual = existsSync(full) ? readFileSync(full, 'utf8') : null
      if (actual === change.after) this.finishPublication(change, false)
      else this.db.transaction(() => {
        this.db.sqlite.prepare('UPDATE core_file_publications SET status=? WHERE change_id=?').run(actual === change.before ? 'failed' : 'external', change.id)
      })
    }
  }

  private finishPublication(change: Change, notify: boolean): void {
    if (change.target.kind !== 'file' || !change.target.courseId) throw new Error('not a course file')
    const { courseId, path } = change.target
    this.db.transaction(() => {
      this.db.sqlite.prepare('INSERT OR IGNORE INTO core_changes (id, at, course_id, target_key, data) VALUES (?, ?, ?, ?, ?)').run(change.id, change.at, courseId, targetKey(change.target), JSON.stringify(change))
      this.rememberHash(courseId, path, change.after === null ? undefined : sha256(change.after))
      this.db.sqlite.prepare("UPDATE core_file_publications SET status='published' WHERE change_id=?").run(change.id)
      if (notify) {
        this.db.afterCommit(() => this.emit('learning/change-applied', change))
        this.db.afterCommit(() => this.emit('learning/doc-changed', { courseId, path, changeId: change.id }))
      }
    })
  }

  // ── courses ──────────────────────────────────────────────────────────────

  readonly courses: LearnCore['courses'] = {
    create: async ({ title, slug }) => {
      const base = safeFileName(slug ?? title)
      let candidate = base
      for (let n = 2; this.slugTaken(candidate); n += 1) candidate = `${base}-${n}`
      const folder = join(this.dataRoot, DATA_LAYOUT.courses, candidate)
      mkdirSync(folder, { recursive: true })
      const workspace = await this.workspaces().create(folder, title)
      const course = Course.parse({
        id: newId('course'),
        title,
        slug: candidate,
        workspaceId: workspace.id,
        status: 'active',
        createdAt: now(),
      })
      this.db.transaction(() => {
        this.db.sqlite.prepare('INSERT INTO core_courses (id, slug, data) VALUES (?, ?, ?)')
          .run(course.id, course.slug, JSON.stringify(course))
      })
      await this.files.write(course.id, COURSE_LAYOUT.card, withFrontmatter({ course: course.id, title }, `# ${title}\n`), {
        actor: 'system',
        reason: '新建课程',
      })
      this.emit('learning/course-created', course)
      return course
    },
    list: () => (this.db.sqlite.prepare('SELECT data FROM core_courses ORDER BY id').all() as { data: string }[])
      .map(row => Course.parse(JSON.parse(row.data))),
    get: courseId => {
      const row = this.db.sqlite.prepare('SELECT data FROM core_courses WHERE id = ?').get(courseId) as { data: string } | undefined
      return row ? Course.parse(JSON.parse(row.data)) : undefined
    },
    setStatus: (courseId, status) => {
      const course = this.courses.get(courseId)
      if (!course) throw new LearningApiError('learning/core/no-course', `课程不存在：${courseId}`, { courseId })
      if (course.status === status) return course
      const updated = Course.parse({ ...course, status })
      this.db.sqlite.prepare('UPDATE core_courses SET data = ? WHERE id = ?').run(JSON.stringify(updated), courseId)
      this.emit('learning/course-updated', updated)
      return updated
    },
    folder: courseId => {
      const course = this.courses.get(courseId)
      if (!course) throw new LearningApiError('learning/core/no-course', `课程不存在：${courseId}`, { courseId })
      return join(this.dataRoot, DATA_LAYOUT.courses, course.slug)
    },
  }

  private slugTaken(slug: string): boolean {
    if (this.db.sqlite.prepare('SELECT 1 FROM core_courses WHERE slug = ?').get(slug)) return true
    return existsSync(join(this.dataRoot, DATA_LAYOUT.courses, slug))
  }

  // ── course files + change log ────────────────────────────────────────────

  /** Absolute path of a course file; refuses anything outside the course folder. */
  private filePath(courseId: string, path: string): string {
    const relative = relativePath.parse(path)
    const folder = this.courses.folder(courseId)
    const full = resolve(folder, relative)
    if (!full.startsWith(folder + sep)) throw new LearningApiError('learning/core/bad-path', `路径不在课程文件夹内：${path}`, { path })
    return full
  }

  private knownHash(courseId: string, path: string): string | undefined {
    const row = this.db.sqlite.prepare('SELECT hash FROM core_files WHERE course_id = ? AND path = ?').get(courseId, path) as { hash: string } | undefined
    return row?.hash
  }

  private rememberHash(courseId: string, path: string, hash: string | undefined): void {
    if (hash === undefined) {
      this.db.sqlite.prepare('DELETE FROM core_files WHERE course_id = ? AND path = ?').run(courseId, path)
      return
    }
    this.db.sqlite.prepare(`INSERT INTO core_files (course_id, path, hash, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (course_id, path) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`)
      .run(courseId, path, hash, now())
  }

  /** Text the change log last recorded for a file (its latest `after`). */
  private lastRecordedText(courseId: string, path: string): string | null {
    const row = this.db.sqlite.prepare('SELECT data FROM core_changes WHERE target_key = ? ORDER BY id DESC LIMIT 1')
      .get(targetKey({ kind: 'file', courseId, path })) as { data: string } | undefined
    return row ? Change.parse(JSON.parse(row.data)).after : null
  }

  private insertChange(change: Change, courseId: string | undefined): void {
    this.db.sqlite.prepare('INSERT INTO core_changes (id, at, course_id, target_key, data) VALUES (?, ?, ?, ?, ?)')
      .run(change.id, change.at, nullable(courseId), targetKey(change.target), JSON.stringify(change))
    this.db.afterCommit(() => this.emit('learning/change-applied', change))
  }

  /** Commit intent, replace and sync the file, then complete the ledger; interrupted intents are reconciled. */
  private commitFile(courseId: string, path: string, before: string | null, text: string | null, meta: ChangeMeta & { revertOf?: string }): Change {
    if (this.db.inTransaction) throw new LearningApiError('learning/core/file-in-transaction', '文件发布不能嵌在数据库事务内')
    const full = this.filePath(courseId, path)
    const change = Change.parse({
      id: newId('change'),
      at: now(),
      actor: meta.actor,
      target: { kind: 'file', courseId, path },
      size: meta.size ?? 'minor',
      before,
      after: text,
      reason: meta.reason,
      ...(meta.proposalId ? { proposalId: meta.proposalId } : {}),
      ...(meta.revertOf ? { revertOf: meta.revertOf } : {}),
    })
    this.db.transaction(() => {
      this.db.sqlite.prepare("INSERT INTO core_file_publications (change_id, course_id, path, status, data) VALUES (?, ?, ?, 'pending', ?)").run(change.id, courseId, path, JSON.stringify(change))
    })
    if (text === null) rmSync(full, { force: true })
    else {
      mkdirSync(dirname(full), { recursive: true })
      const temporary = `${full}.${change.id}.tmp`
      try {
        const fd = openSync(temporary, 'wx', 0o600)
        try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
        renameSync(temporary, full)
      } finally { rmSync(temporary, { force: true }) }
    }
    if (process.platform !== 'win32') {
      const fd = openSync(dirname(full), 'r')
      try { fsyncSync(fd) } finally { closeSync(fd) }
    }
    this.finishPublication(change, true)
    return change
  }

  readonly files: LearnCore['files'] = {
    read: async (courseId, path) => this.readFile(courseId, path),
    write: async (courseId, path, text, meta, options) => {
      const current = this.readFile(courseId, path)
      if (options?.ifHash !== undefined && (current?.hash ?? null) !== options.ifHash) {
        throw new LearningApiError('learning/core/conflict', `文件在这期间被修改过，没有覆盖：${path}`, { path })
      }
      return this.commitFile(courseId, path, current?.text ?? null, text, meta)
    },
    append: async (courseId, path, text, meta) => {
      const current = this.readFile(courseId, path)
      return this.commitFile(courseId, path, current?.text ?? null, (current?.text ?? '') + text, meta)
    },
  }

  /** Read a course file. A hash that differs from the last one core saw is logged as the learner's own edit. */
  private readFile(courseId: string, path: string): CourseFile | undefined {
    this.recoverPublications(courseId, path)
    const full = this.filePath(courseId, path)
    if (!existsSync(full)) return undefined
    const text = readFileSync(full, 'utf8')
    const hash = sha256(text)
    const known = this.knownHash(courseId, path)
    if (known === undefined) {
      this.db.transaction(() => this.rememberHash(courseId, path, hash))
    } else if (known !== hash) {
      const change = Change.parse({
        id: newId('change'),
        at: now(),
        actor: 'user',
        target: { kind: 'file', courseId, path },
        size: 'minor',
        before: this.lastRecordedText(courseId, path),
        after: text,
        reason: '在应用外修改',
      })
      this.db.transaction(() => {
        this.insertChange(change, courseId)
        this.rememberHash(courseId, path, hash)
        this.db.afterCommit(() => this.emit('learning/doc-changed', { courseId, path, changeId: change.id }))
      })
    }
    return { text, hash }
  }

  readonly changes: LearnCore['changes'] = {
    list: ({ target, courseId, operationId, limit }) => {
      const where: string[] = []
      const params: string[] = []
      if (target) { where.push('target_key = ?'); params.push(targetKey(target)) }
      if (courseId) { where.push('course_id = ?'); params.push(courseId) }
      if (operationId) { where.push("json_extract(data, '$.operationId') = ?"); params.push(operationId) }
      const sql = `SELECT data FROM core_changes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${Math.max(1, Math.min(limit ?? 100, 1000))}`
      return (this.db.sqlite.prepare(sql).all(...params) as { data: string }[]).map(row => Change.parse(JSON.parse(row.data)))
    },
    get: changeId => {
      const row = this.db.sqlite.prepare('SELECT data FROM core_changes WHERE id = ?').get(changeId) as { data: string } | undefined
      return row ? Change.parse(JSON.parse(row.data)) : undefined
    },
    record: input => {
      const change = Change.parse({ ...input, id: newId('change'), at: now() })
      const courseId = change.target.kind === 'file' ? change.target.courseId : change.courseId
      this.db.transaction(() => this.insertChange(change, courseId))
      return change
    },
    revert: async (changeId, meta) => {
      const row = this.db.sqlite.prepare('SELECT data FROM core_changes WHERE id = ?').get(changeId) as { data: string } | undefined
      if (!row) throw new LearningApiError('learning/core/no-change', `变更不存在：${changeId}`, { changeId })
      const change = Change.parse(JSON.parse(row.data))
      const target = change.target
      if (target.kind !== 'file' || !target.courseId) {
        throw new LearningApiError('learning/core/revert-unsupported', '只有课程文件的变更能由 core 回退；数据库记录由它的主人单元回退', { changeId })
      }
      const current = this.readFile(target.courseId, target.path)
      return this.commitFile(target.courseId, target.path, current?.text ?? null, change.before, { ...meta, revertOf: change.id })
    },
  }

  // ── sessions ─────────────────────────────────────────────────────────────

  readonly sessions: LearnCore['sessions'] = {
    link: input => {
      const link = SessionLink.parse(input)
      this.db.transaction(() => {
        this.db.sqlite.prepare(`INSERT INTO core_sessions (session_id, course_id, role, data) VALUES (?, ?, ?, ?)
          ON CONFLICT (session_id) DO UPDATE SET course_id = excluded.course_id, role = excluded.role, data = excluded.data`)
          .run(link.sessionId, nullable(link.courseId), link.role, JSON.stringify(link))
      })
    },
    get: sessionId => {
      const row = this.db.sqlite.prepare('SELECT data FROM core_sessions WHERE session_id = ?').get(sessionId) as { data: string } | undefined
      return row ? SessionLink.parse(JSON.parse(row.data)) : undefined
    },
    list: ({ courseId, role }) => {
      const where: string[] = []
      const params: string[] = []
      if (courseId) { where.push('course_id = ?'); params.push(courseId) }
      if (role) { where.push('role = ?'); params.push(role) }
      const sql = `SELECT data FROM core_sessions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY rowid`
      return (this.db.sqlite.prepare(sql).all(...params) as { data: string }[]).map(row => SessionLink.parse(JSON.parse(row.data)))
    },
    close: sessionId => {
      const link = this.sessions.get(sessionId)
      if (!link || link.closedAt) return
      this.sessions.link({ ...link, closedAt: now() })
    },
  }

  // ── evidence log ─────────────────────────────────────────────────────────

  readonly log: LearnCore['log'] = {
    append: (input: NewLogEntry) => {
      const entry = LogEntry.parse({ ...input, id: newId('log'), at: input.at ?? now() })
      this.db.transaction(() => {
        this.db.sqlite.prepare('INSERT INTO core_log (id, at, type, course_id, node_ids, data) VALUES (?, ?, ?, ?, ?, ?)')
          .run(entry.id, entry.at, entry.type, nullable(entry.courseId), JSON.stringify(entry.nodeIds), JSON.stringify(entry))
        this.db.afterCommit(() => this.emit('learning/logged', entry))
      })
      return entry
    },
    query: (query: LogQuery) => {
      const where: string[] = []
      const params: string[] = []
      if (query.courseId) { where.push('course_id = ?'); params.push(query.courseId) }
      if (query.since) { where.push('at >= ?'); params.push(query.since) }
      if (query.types?.length) { where.push(`type IN (${query.types.map(() => '?').join(', ')})`); params.push(...query.types) }
      if (query.nodeId) { where.push('EXISTS (SELECT 1 FROM json_each(core_log.node_ids) WHERE value = ?)'); params.push(query.nodeId) }
      if (query.after) { where.push('id > ?'); params.push(query.after) }
      const limit = Math.max(1, Math.min(query.limit ?? 10_000, 100_000))
      const sql = `SELECT data FROM core_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id${query.newest ? ' DESC' : ''} LIMIT ${limit}`
      return (this.db.sqlite.prepare(sql).all(...params) as { data: string }[]).map(row => LogEntry.parse(JSON.parse(row.data)))
    },
    count: () => (this.db.sqlite.prepare('SELECT COUNT(*) AS n FROM core_log').get() as { n: number }).n,
  }

  // ── proposals ────────────────────────────────────────────────────────────

  private saveProposal(proposal: Proposal): void {
    this.db.sqlite.prepare(`INSERT INTO core_proposals (id, course_id, status, data) VALUES (?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET status = excluded.status, data = excluded.data`)
      .run(proposal.id, nullable(proposal.courseId), proposal.status, JSON.stringify(proposal))
  }

  readonly proposals: LearnCore['proposals'] = {
    create: input => {
      const proposal = Proposal.parse({ ...input, id: newId('proposal'), status: 'open', createdAt: now(), changeIds: [] })
      this.db.transaction(() => {
        this.saveProposal(proposal)
        this.db.afterCommit(() => this.emit('learning/proposal-created', proposal))
      })
      return proposal
    },
    get: proposalId => {
      const row = this.db.sqlite.prepare('SELECT data FROM core_proposals WHERE id = ?').get(proposalId) as { data: string } | undefined
      return row ? Proposal.parse(JSON.parse(row.data)) : undefined
    },
    list: ({ courseId, status }) => {
      const where: string[] = []
      const params: string[] = []
      if (courseId) { where.push('course_id = ?'); params.push(courseId) }
      if (status) { where.push('status = ?'); params.push(status) }
      const sql = `SELECT data FROM core_proposals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
      return (this.db.sqlite.prepare(sql).all(...params) as { data: string }[]).map(row => Proposal.parse(JSON.parse(row.data)))
    },
    decide: (proposalId, status, changeIds = [], note) => {
      const current = this.proposals.get(proposalId)
      if (!current) throw new LearningApiError('learning/core/no-proposal', `提案不存在：${proposalId}`, { proposalId })
      const proposal = Proposal.parse({ ...current, status, decidedAt: now(), changeIds: [...current.changeIds, ...changeIds], ...(note ? { decisionNote: note } : {}) })
      this.db.transaction(() => {
        this.saveProposal(proposal)
        this.db.afterCommit(() => this.emit('learning/proposal-decided', proposal))
      })
      return proposal
    },
  }
}
