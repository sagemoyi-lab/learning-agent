// Shared execution boundary: validate the entire syntax tree before compilation.
import type { MathNode } from 'mathjs'

const FUNCTIONS = new Set(['sqrt', 'cbrt', 'exp', 'log', 'log10', 'log2', 'pow', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'number'])
const OPERATORS = new Set(['add', 'subtract', 'multiply', 'divide', 'pow', 'unaryMinus', 'unaryPlus'])
const NODES = new Set(['ConstantNode', 'SymbolNode', 'OperatorNode', 'ParenthesisNode', 'FunctionNode'])

/** Optional root assignment is for the calculator only, never learner expressions. */
export function expressionRefusal(root: MathNode, assignment = false): string | undefined {
  let count = 0
  let reason: string | undefined
  const variables = new Set<string>()
  const visit = (node: MathNode, depth: number, parent?: MathNode) => {
    if (reason) return
    if (++count > 256 || depth > 32) { reason = '算式超出节点或嵌套预算'; return }
    if (node.type === 'AssignmentNode' && assignment && !parent) {
      const target = node as unknown as { object: MathNode; index?: unknown }
      if (target.object.type !== 'SymbolNode' || target.index) reason = '只能给变量赋值'
    } else if (!NODES.has(node.type)) { reason = `不支持这种写法（${node.type}）`; return }
    if (node.type === 'ConstantNode') {
      const value = (node as unknown as { value: unknown }).value
      if (typeof value !== 'number' || !Number.isFinite(value)) reason = '只允许有限数值常量'
    }
    if (node.type === 'OperatorNode' && !OPERATORS.has((node as unknown as { fn: string }).fn)) reason = '只允许四则、乘方和正负号'
    if (node.type === 'FunctionNode') {
      const fn = (node as unknown as { fn: MathNode; args: MathNode[] })
      if (fn.fn.type !== 'SymbolNode' || !FUNCTIONS.has((fn.fn as unknown as { name: string }).name)) reason = '不允许调用这个函数'
      if (fn.args.length > 8) reason = '函数参数太多'
    }
    if (node.type === 'SymbolNode' && !(parent?.type === 'FunctionNode' && (parent as unknown as { fn: MathNode }).fn === node)) {
      const name = (node as unknown as { name: string }).name
      if (['__proto__', 'prototype', 'constructor'].includes(name)) reason = '不允许这个变量名'
      variables.add(name)
      if (variables.size > 16) reason = '算式变量超过 16 个'
    }
    node.forEach(child => visit(child, depth + 1, node))
  }
  visit(root, 0)
  return reason
}
