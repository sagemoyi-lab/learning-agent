import { expect, it } from 'vitest'
import { locateQuote, placeAnnotation } from '../src/anchor.ts'
it('requires confirmation when a former paragraph boundary gains any text', () => {
  const quote = { exact: '能忽略摩擦损失。', prefix: '', suffix: '', atStart: true, atEnd: true }
  expect(locateQuote(quote.exact, quote).status).toBe('anchored')
  for (const text of ['不能忽略摩擦损失。', '非能忽略摩擦损失。', '能忽略摩擦损失。但要满足条件。']) expect(locateQuote(text, quote).status).toBe('needs-confirmation')
})
it('keeps unchanged legacy notes but requests confirmation for ambiguous empty context after changes', () => {
  const quote = { exact: '压力', prefix: '', suffix: '' }
  expect(placeAnnotation(quote, [{ blockId: 'aaa111', hash: 'h1', text: '压力随深度增加。' }], { anchorHash: 'h1', at: 'now' }).status).toBe('anchored')
  expect(placeAnnotation(quote, [{ blockId: 'aaa111', hash: 'h2', text: '压力随深度减少。' }], { anchorHash: 'h1', at: 'now' }).status).toBe('needs-confirmation')
})
