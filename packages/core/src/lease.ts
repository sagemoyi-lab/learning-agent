// A maintenance command and the workbench must not write the same library together.
import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export function acquireLease(file: string): () => void {
  mkdirSync(dirname(file), { recursive: true })
  const token = randomUUID()
  const data = JSON.stringify({ pid: process.pid, token })
  try {
    writeFileSync(file, data, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const owner = JSON.parse(readFileSync(file, 'utf8')) as { pid: number }
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error(`无法确认运行锁的所有者：${file}`)
    try {
      process.kill(owner.pid, 0)
    } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error(`无法确认程序已停止：${file}`)
      // Serialize stale-lock reclaimers so a second reclaimer cannot unlink a new owner.
      const guard = `${file}.reclaim`
      mkdirSync(guard)
      try {
        const previous = readFileSync(file, 'utf8')
        if ((JSON.parse(previous) as { pid: number }).pid !== owner.pid) throw new Error(`运行锁刚被更换：${file}`)
        unlinkSync(file)
        writeFileSync(file, data, { flag: 'wx', mode: 0o600 })
      } finally { rmdirSync(guard) }
      return release
    }
    throw new Error(`学习库正在使用中（进程 ${owner.pid}），请先停止 DSH 或维护命令：${file}`)
  }
  return release

  function release(): void {
    try {
      if ((JSON.parse(readFileSync(file, 'utf8')) as { token: string }).token === token) unlinkSync(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
