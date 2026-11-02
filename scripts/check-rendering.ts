// Real Chromium regression for the shared HTML publication boundary; no external network.
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
const bundle = await build({ entryPoints: ['packages/shell/src/client/html.ts'], bundle: true, write: false, format: 'iife', globalName: 'Rendering', platform: 'browser' })
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const requests: string[] = []
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  await page.setContent('<main id="render"></main>')
  await page.addScriptTag({ content: bundle.outputFiles![0]!.text })
  const result = await page.evaluate(() => {
    const globals = window as unknown as { Rendering: { toHtml(text: string): string; toInlineHtml(text: string): string }; attacked?: boolean }
    const target = document.getElementById('render')!
    for (const render of [globals.Rendering.toHtml, globals.Rendering.toInlineHtml]) {
      target.innerHTML = render('<img src="https://example.invalid/x" onerror="window.attacked=true"><svg onload="window.attacked=true"></svg><a href="jav&#97;script:window.attacked=true">unsafe</a>\n\n![external](https://example.invalid/x)\n\n$p=\\rho gh$\n\n[x](cite:ck_01K6PQZRB8M3A4T5V6W7X8Y9Z0)')
      if (target.querySelector('img,script,svg,iframe,form,[onerror],[onload]')) throw new Error('Active markup survived')
      if (!target.querySelector('annotation[encoding="application/x-tex"]') || !target.querySelector('[data-cite]')) throw new Error('Formula or citation lost')
    }
    return { attacked: Boolean(globals.attacked), formulas: target.querySelectorAll('.katex').length }
  })
  await page.waitForTimeout(100)
  if (result.attacked || requests.length) throw new Error('Rendering executed content or requested an external resource')
  for (const width of [1440, 1024, 760, 390]) {
    await page.setViewportSize({ width, height: 700 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.screenshot({ path: `.scratch/rendering-${width}-${colorScheme}.png` })
    }
  }
  console.log(JSON.stringify({ browser: 'Chromium', ...result, externalRequests: requests.length, widths: [1440, 1024, 760, 390] }))
} finally { await browser.close() }
