import { expect, it } from 'vitest'
import { SaveQueue } from '../src/save-queue.ts'
it('retains failed revisions for retry and reports failure', async () => {
  let fail = true
  const saved: string[] = [], errors: unknown[] = []
  const queue = new SaveQueue<string>(async (_, value) => { if (fail) throw new Error('offline'); saved.push(value) }, (_, error) => errors.push(error))
  queue.put('a', 'last answer')
  await expect(queue.flushAll()).rejects.toThrow('offline')
  fail = false
  await queue.flushAll()
  expect(saved).toEqual(['last answer'])
  expect(errors[0]).toBeInstanceOf(Error)
})
it('waits for in-flight saves and sends a newer revision after the earlier one', async () => {
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const saved: string[] = []
  const queue = new SaveQueue<string>(async (_, value) => { saved.push(value); if (value === 'first') await barrier })
  queue.put('a', 'first')
  const first = queue.flush('a')
  queue.put('a', 'latest')
  let finished = false
  const all = queue.flushAll().then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(saved).toEqual(['first'])
  release()
  await Promise.all([first, all])
  expect(saved).toEqual(['first', 'latest'])
})
