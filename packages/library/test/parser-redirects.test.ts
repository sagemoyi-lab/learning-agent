import { afterEach, expect, it, vi } from 'vitest'
import { MineruParser } from '../src/parser.ts'

afterEach(() => vi.unstubAllGlobals())
it('rejects redirect cycles and caps the chain', async () => {
  let calls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => { calls++; return new Response(null, { status: 302, headers: { location: url.href } }) }))
  await expect(new MineruParser('http://localhost:3184').check()).rejects.toThrow('循环')
  expect(calls).toBe(1)
  calls = 0
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: `/hop${++calls}` } })))
  await expect(new MineruParser('http://localhost:3184').check()).rejects.toThrow('超过 5')
  expect(calls).toBe(6)
})
it('does not send the service key to redirected object storage and shares the deadline signal', async () => {
  const seen: { auth: string | null; signal: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => {
    seen.push({ auth: new Headers(init.headers).get('Authorization'), signal: init.signal })
    return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://storage.example/result' } }) : Response.json({})
  }))
  await new MineruParser('https://parser.example/api', 'synthetic-key').check()
  expect(seen.map(item => item.auth)).toEqual(['Bearer synthetic-key', null])
  expect(seen[0]!.signal === seen[1]!.signal).toBe(true)
})

it.each([307, 308])('preserves the method and body on a %s redirect', async status => {
  const seen: RequestInit[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, init: RequestInit) => {
    seen.push(init)
    return seen.length === 1 ? new Response(null, { status, headers: { location: '/continued' } }) : Response.json({})
  }))
  // Exercise the internal transport without submitting a real parsing job.
  const parser = new MineruParser('https://parser.example/api', 'synthetic-key') as unknown as { request(path: string, init: RequestInit): Promise<Response> }
  await parser.request('/fixture', { method: 'POST', body: 'synthetic-body' })
  expect(seen.map(item => [item.method, item.body])).toEqual([['POST', 'synthetic-body'], ['POST', 'synthetic-body']])
})
