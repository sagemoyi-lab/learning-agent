import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
let render: typeof import('../../packages/shell/src/client/html.ts')
const dom = new JSDOM('')
beforeAll(async () => {
  vi.stubGlobal('window', dom.window)
  render = await import('../../packages/shell/src/client/html.ts')
})
afterAll(() => { vi.unstubAllGlobals(); dom.window.close() })

it('sanitizes active markup and URL encoding variants at both HTML publication boundaries', () => {
  const attacks = [
    '<img src="https://example.invalid/image" onerror="alert(1)">',
    '<svg onload="alert(1)"><script>alert(1)</script></svg>',
    '<a href="jav&#x61;script:alert(1)">unsafe</a>',
    '<a href="java\nscript:alert(1)">unsafe</a>',
    '[unsafe](javascript:alert(1))',
    '<iframe src="https://example.invalid"></iframe><form action="https://example.invalid"><input></form>',
  ]
  for (const text of attacks) for (const fn of [render.toHtml, render.toInlineHtml]) {
    const html = fn(text)
    const div = dom.window.document.createElement('div')
    div.innerHTML = html
    expect(div.querySelector('script,img,svg,iframe,form,input,object')).toBeNull()
    expect([...div.querySelectorAll('*')].some(element => [...element.attributes].some(attr => attr.name.startsWith('on')))).toBe(false)
    expect(div.querySelector('[href^="javascript:"]')).toBeNull()
  }
})

it('preserves formula source, table frames, source badges and folded quotations; external images become links', () => {
  const html = render.toHtml('$p=\\rho gh$\n\n| A | B |\n|---|---|\n|1|2|\n\n> [!quote]- Source\n> quoted\n\n[x](cite:ck_01K6PQZRB8M3A4T5V6W7X8Y9Z0)\n\n![external](https://example.invalid/image)')
  const div = dom.window.document.createElement('div')
  div.innerHTML = html
  expect(div.querySelector('.katex annotation')?.textContent).toBe('p=\\rho gh')
  expect(div.querySelector('.la-table table')).not.toBeNull()
  expect(div.querySelector('details summary')?.textContent).toBe('Source')
  expect(div.querySelector('[data-cite]')).not.toBeNull()
  expect(div.querySelector('img')).toBeNull()
  expect(div.querySelector('a[href="https://example.invalid/image"]')?.getAttribute('rel')).toBe('noreferrer noopener')
})
