import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// DSH runtime packages resolve to the pinned install in .tools/dsh, as they do inside DSH.
const DSH = resolve(import.meta.dirname, '.tools/dsh/node_modules/@deepseek-ai')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@deepseek-ai\/(cordis|dsh-llm|dsh-tools|dsh-session|dsh-session-persistence-jsonl)$/, replacement: `${DSH}/$1/lib/index.js` },
      { find: /^@deepseek-ai\/schemastery$/, replacement: `${DSH}/schemastery/lib/index.mjs` },
    ],
  },
  test: {
    // Tests never reach paid online services: the harness gives the library local parsing and no
    // semantic search, and parser and embedding tests use fake endpoints.
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    // Test files in one worker share the loaded units instead of loading all of them again per file,
    // which took more time than the tests themselves. A test that changes a global puts it back
    // (docs/development.md, 测试); stubbed globals and env vars are put back automatically.
    isolate: false,
    unstubGlobals: true,
    unstubEnvs: true,
    // `pnpm coverage`: what the tests never run, read as candidates for deletion (docs/development.md).
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      reporter: ['text-summary', 'json-summary', 'json'],
    },
  },
})
