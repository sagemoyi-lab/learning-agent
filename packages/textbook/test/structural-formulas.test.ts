import { expect, it } from 'vitest'
import { bareTex, precheck } from '../src/check.ts'
it('preserves subscripts, powers, grouping and signs while ignoring harmless typesetting', () => {
  expect(bareTex('p_{2} = p_{1} + \\rho g h')).toBe(bareTex('p_2=p_1+\\rho gh'))
  expect(bareTex('p^2=p^1+\\rho gh')).not.toBe(bareTex('p_2=p_1+\\rho gh'))
  expect(precheck('$p^2=p^1+\\rho gh$', '$p_2=p_1+\\rho gh$', [])?.contradicts).toBe(true)
  expect(bareTex('\\frac{a}{b+c}')).not.toBe(bareTex('\\frac{a}{b}+c'))
  expect(bareTex('a-b')).not.toBe(bareTex('a+b'))
})
