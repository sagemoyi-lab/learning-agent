import { expect, it } from 'vitest'
import { create, all } from 'mathjs'
import { equivalent } from '../src/grading.ts'
import { calculate } from '../src/calculator.ts'
import { expressionRefusal } from '../src/safe-expression.ts'
import { unitOf } from '../src/units.ts'

const parser = create(all!)
it('rejects active and unbounded syntax before evaluation in both entry points', () => {
  for (const attack of ['createUnit("evil", "1 kg")', 'ones(1000,1000)', 'f(x)=x', '1:1e9', 'a[1]', 'evaluate("2")', 'import("x")', 'x!']) {
    expect(expressionRefusal(parser.parse(attack))).toBeDefined()
    expect(equivalent(attack, '1')).toBeUndefined()
    expect(() => calculate(attack)).toThrow()
  }
  expect(unitOf('evil')).toBeUndefined()
  expect(calculate('x=2\ny=x^2', ['y']).values.y?.value).toBe(4)
  expect(equivalent('2*x', 'x+x')).toBe(true)
})
it('limits tree size, depth, variables and input length', () => {
  expect(equivalent(Array(300).fill('x').join('+'), '1')).toBeUndefined()
  expect(equivalent('('.repeat(40) + 'x' + ')'.repeat(40), 'x')).toBeUndefined()
  expect(equivalent(Array.from({ length: 17 }, (_, i) => `x${i}`).join('+'), '1')).toBeUndefined()
  expect(equivalent('x'.repeat(4001), '1')).toBeUndefined()
})
