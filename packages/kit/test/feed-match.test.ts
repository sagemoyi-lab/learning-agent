import { expect, it } from 'vitest'
import { feedMatches } from '../src/feed-match.ts'
it('does not interpret an empty refresh list as a wildcard', () => {
  expect(feedMatches('learning/doc-changed', '')).toBe(false)
  expect(feedMatches('learning/doc-changed', 'learning/')).toBe(true)
  expect(feedMatches('learning/annotation-changed', 'learning/doc-changed')).toBe(false)
  expect(feedMatches('learning/doc-changed', '|unrelated')).toBe(false)
})
