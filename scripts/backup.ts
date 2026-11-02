import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createBackup, restoreBackup } from '../packages/core/src/backup.ts'

const [mode, source, destination] = process.argv.slice(2)
try {
  if (mode === 'backup' && source && !destination) {
    const home = process.env.LEARNING_HOME || join(homedir(), 'Documents', '学习库')
    const dsh = process.env.DSH_HOME
    if (!dsh) throw new Error('请设置 DSH_HOME，以便备份 DSH 会话（不包含密钥）')
    const manifest = createBackup({ learningHome: home, target: source, sessionRoot: join(dsh, 'sessions'), attachmentRoot: join(dsh, 'attachments'), workspaceFile: join(dsh, 'storages', 'workspace.json'), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() })
    console.log(`备份已创建：${source}（${manifest.files.length} 个文件，不包含密钥）`)
  } else if (mode === 'restore' && source && destination) {
    const manifest = restoreBackup(source, destination, (staging, target, metadata) => {
      if (metadata.sessionsIncluded) execFileSync(process.execPath, [resolve('scripts/restore-dsh.ts'), staging, target, metadata.learningHome], { stdio: 'pipe' })
    })
    console.log(`校验并恢复了 ${manifest.files.length} 个文件到 ${destination}。请手动设置 LEARNING_HOME；会话副本在 .dsh-home/sessions。`)
  } else throw new Error('用法：pnpm backup <备份目录> 或 pnpm restore <备份目录> <空学习库目录>')
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}
