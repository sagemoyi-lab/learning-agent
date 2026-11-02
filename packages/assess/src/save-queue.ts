/** Per-answer serialized persistence; only an acknowledgement of the latest revision clears dirty state. */
export class SaveQueue<T> {
  private readonly latest = new Map<string, { version: number; value: T }>()
  private readonly running = new Map<string, Promise<void>>()
  private version = 0

  constructor(private readonly save: (key: string, value: T) => Promise<unknown>, private readonly changed: (key: string, error?: unknown) => void = () => {}) {}

  put(key: string, value: T): void { this.latest.set(key, { version: ++this.version, value }) }

  async flush(key: string): Promise<void> {
    const pending = this.running.get(key)
    if (pending) { await pending; return this.flush(key) }
    const current = this.latest.get(key)
    if (!current) return
    const work = this.save(key, current.value).then(() => {
      if (this.latest.get(key)?.version === current.version) this.latest.delete(key)
      this.changed(key)
    }, error => { this.changed(key, error); throw error }).finally(() => this.running.delete(key))
    this.running.set(key, work)
    await work
    if (this.latest.has(key)) await this.flush(key)
  }

  async flushAll(): Promise<void> { await Promise.all([...new Set([...this.latest.keys(), ...this.running.keys()])].map(key => this.flush(key))) }
}
