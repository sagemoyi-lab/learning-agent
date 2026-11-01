// Handout file format (contracts §3.2): blocks end with ` ^id` (display math, tables and quote boxes: `^id` on a
// line of its own), citations are `[label](cite:ck_…)` or a web page's address, source text copied in is a
// `> [!quote]` box (embed.ts). `finalize` turns a model draft into that format; `indexBlocks` reads it back.
// Files written before 10-15 may still carry `[待核实](cite:unverified)`; it is read, never written.
import { createHash } from 'node:crypto'
import { parseFrontmatter } from '@learning-agent/contracts'
import { EMBED_ANYWHERE, EMBED_LINE, expandEmbed, isOriginal, type EmbedSource } from './embed.ts'

const CITE = /\[([^\]]*)\]\(cite:([^)\s]+)\)/g
const WEB_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g
const TRAILING_ID = /\s\^([0-9a-z]{6})\s*$/
const LONE_ID = /^\^([0-9a-z]{6})\s*$/
/** A comma between two citation links: the reader shows them as tags side by side. */
const BETWEEN_LINKS = /(\]\((?:cite:|https?:\/\/)[^)\s]+\))\s*[、，,；;]\s*(?=\[[^\]]*\]\((?:cite:|https?:\/\/))/g
/** A comma left after the last citation of a paragraph, or before the first after a sentence, once a link next to it was dropped. */
const TRAILING_COMMA = /(\]\((?:cite:|https?:\/\/)[^)\s]+\))\s*[、，,；;]+\s*$/
const LEADING_COMMA = /([。！？.!?])\s*[、，,；;]+\s*(?=\[[^\]]*\]\((?:cite:|https?:\/\/))/g

/** Whether a link's label is only its site's name or address. */
function siteName(label: string, url: string): boolean {
  try {
    const host = new URL(url).host.replace(/^www\./, '')
    return [host, url].includes(label.trim().replace(/^www\./, '').replace(/\/$/, ''))
  } catch {
    return false
  }
}

export interface BlockIndex {
  readonly id: string
  readonly text: string
  readonly hash: string
  readonly citations: string[]
  readonly unverified: boolean
  /** Under a "读完就答" heading: asks the learner, explains nothing. */
  readonly recall: boolean
  /** A quote box of source text the program copied in. */
  readonly original: boolean
}

/** Split Markdown into paragraphs, keeping `$$ … $$` display math whole. */
export function splitPieces(text: string): string[] {
  const pieces: string[] = []
  let current: string[] = []
  let inMath = false
  const flush = () => {
    if (current.some(line => line.trim())) pieces.push(current.join('\n').trim())
    current = []
  }
  for (const line of text.split(/\r?\n/)) {
    // Models may put consecutive headings and body text together without blank lines.
    // Keep headings separate so the following prose gets its own citation check and block id.
    if (!inMath && isHeading(line)) {
      flush()
      pieces.push(line.trim())
      continue
    }
    if (!inMath && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
    const fences = (line.match(/\$\$/g) ?? []).length
    if (fences % 2 === 1) inMath = !inMath
  }
  flush()
  return pieces
}

function isHeading(piece: string): boolean {
  return /^#{1,6}\s/.test(piece)
}

function isDisplayMath(piece: string): boolean {
  return /^\$\$[\s\S]*\$\$$/.test(piece.trim())
}

/** A Markdown table: every line a row of cells, the second the delimiter row. */
export function isTable(piece: string): boolean {
  const lines = piece.trim().split('\n')
  return lines.length >= 2 && lines.every(line => /^\|.*\|$/.test(line.trim())) && /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[1]!.trim())
}

/** Strip code fences and frontmatter a model sometimes wraps its answer in. */
function unwrap(draft: string): string {
  let text = draft.trim()
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)
  if (fenced) text = fenced[1]!
  return parseFrontmatter(text).body.trim()
}

/** `\(…\)` and `\[…\]`, which some replies use, as the `$…$` and `$$…$$` the reader renders and the check reads. */
function dollarMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `$$${tex}$$`)
    .replace(/\\\((.+?)\\\)/g, (_, tex: string) => `$${tex.trim()}$`)
}


/** Headings whose blocks ask the learner questions instead of explaining (files written before 10-31). */
const QUESTION_HEADING = /读完就答/

export interface FinalizeOptions {
  readonly knownChunk: (id: string) => boolean
  /**
   * Web pages the writer was given: true keeps a link, an address puts it on that page instead (a link to
   * the page's site); links to any other address are dropped.
   */
  readonly knownUrl?: (url: string) => boolean | string | undefined
  /** Chunks that `![[…]]` may copy in; without it, embeds are dropped. */
  readonly embed?: EmbedSource
  readonly newBlockId: () => string
  readonly reuse?: (text: string) => string | undefined
  /** Embeds kept, in order; those after are dropped. */
  readonly embedLimit?: number
}

/** A quote box the model wrote itself is not source text: it becomes an ordinary paragraph. */
function unquote(piece: string): string {
  return piece.split('\n').map(line => line.replace(/^>\s?/, '')).join('\n').replace(/^\[!\w+\][+-]?\s*/, '').trim()
}

/**
 * Turn a model draft into a handout body: embeds become quote boxes of source text; every non-heading
 * block gets an id (`reuse` keeps the old id of a block whose text is unchanged); citations to chunks that
 * are not known sources and links to pages not given are dropped, and a source cited twice in one paragraph
 * shows once. `dropped` says what was left out and why.
 */
export function finalize(draft: string, options: FinalizeOptions): { body: string; blocks: BlockIndex[]; dropped: string[] } {
  const dropped: string[] = []
  const out: string[] = []
  // A line holding only citations (models put them after a list or table) belongs to the block before it.
  const pieces: string[] = []
  for (const piece of splitPieces(dollarMath(unwrap(draft)))) {
    const citationsOnly = /\]\(cite:/.test(piece) && piece.replace(CITE, '').replace(/[\s。．.，,、;；]/g, '') === ''
    const previous = pieces.at(-1)
    if (citationsOnly && previous && !isHeading(previous) && !isDisplayMath(previous) && !EMBED_LINE.test(previous.trim())) pieces[pieces.length - 1] = `${previous.replace(TRAILING_ID, '')} ${piece.trim()}`
    else pieces.push(piece)
  }
  const idOf = (text: string) => options.reuse?.(text) ?? options.newBlockId()
  let embeds = 0
  const boxes = (from: string, to: string | undefined) => {
    if (!options.embed) { dropped.push(`嵌入 ${from} 没有可用的资料`); return [] }
    if (options.embedLimit !== undefined && embeds >= options.embedLimit) { dropped.push(`嵌入 ${from} 超过了每节 ${options.embedLimit} 处`); return [] }
    const result = expandEmbed(from, to, options.embed)
    if ('error' in result) { dropped.push(`嵌入：${result.error}`); return [] }
    embeds += 1
    return result.boxes
  }
  /** A paragraph, or a table (its id on a line of its own; a source may be cited on several rows). */
  const prose = (raw: string, table = false) => {
    const seen = new Set<string>()
    let piece = raw.replace(CITE, (link, _label: string, target: string) => {
      if (target !== 'unverified' && options.knownChunk(target)) {
        if (seen.has(target) && !table) return ''
        seen.add(target)
        return link
      }
      if (target !== 'unverified') dropped.push(`出处 ${target} 不在给出的资料里`)
      return ''
    })
    piece = piece.replace(WEB_LINK, (link, label: string, url: string) => {
      const known = options.knownUrl?.(url)
      if (known) return typeof known === 'string' ? `[${label}](${known})` : link
      dropped.push(`网址 ${url} 不是给出的网页`)
      // A label that only names the site says nothing once the link is gone.
      return siteName(label, url) ? '' : label
    }).replace(BETWEEN_LINKS, '$1').replace(TRAILING_COMMA, '$1').replace(LEADING_COMMA, '$1').replace(/([，、,；;])(?:\s*[，、,；;])+/g, '$1').replace(/[ \t]+$/gm, '').trim()
    if (piece) out.push(table ? `${piece}\n\n^${idOf(piece)}` : `${piece} ^${idOf(piece)}`)
  }
  const box = (item: string) => out.push(`${item}\n\n^${idOf(item)}`)
  for (const raw of pieces.map(piece => piece.replace(TRAILING_ID, '')).filter(piece => !LONE_ID.test(piece))) {
    if (isHeading(raw)) { out.push(raw); continue }
    if (isDisplayMath(raw)) { out.push(`${raw}\n^${idOf(raw)}`); continue }
    if (isTable(raw)) { prose(raw, true); continue }
    if (isOriginal(raw)) { prose(unquote(raw)); continue }
    // Embeds on lines of their own split the paragraph; one left inside a sentence goes after it.
    let text: string[] = []
    const flush = () => {
      const after: string[] = []
      const joined = text.join('\n').replace(EMBED_ANYWHERE, (_, from: string, to?: string) => { after.push(...boxes(from, to)); return '' }).trim()
      if (joined) prose(joined)
      after.forEach(box)
      text = []
    }
    for (const line of raw.split('\n')) {
      const embed = EMBED_LINE.exec(line.trim())
      // An embed the program cannot read is left out, not shown as its markup.
      if (!embed && /^!\[\[.*\]\]$/.test(line.trim())) { dropped.push(`嵌入 ${line.trim()} 的写法不对`); continue }
      if (!embed) { text.push(line); continue }
      flush()
      boxes(embed[1]!, embed[2]).forEach(box)
    }
    flush()
  }
  const body = `${out.join('\n\n')}\n`
  return { body, blocks: indexBlocks(body), dropped }
}

/**
 * Read the blocks of a textbook file (with or without frontmatter). A formula takes the citations of the
 * paragraph right after it, so it is linked to what that paragraph explains.
 */
export function indexBlocks(text: string): BlockIndex[] {
  const blocks: BlockIndex[] = []
  const pieces = splitPieces(parseFrontmatter(text).body)
  let formula: { -readonly [K in keyof BlockIndex]: BlockIndex[K] } | undefined
  let recall = false
  const settle = (next: BlockIndex | undefined) => {
    if (formula && formula.citations.length === 0 && next && !isDisplayMath(next.text)) formula.citations = next.citations
    formula = undefined
  }
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i]!
    if (isHeading(piece)) { settle(undefined); recall = QUESTION_HEADING.test(piece); continue }
    const lastLine = piece.split('\n').at(-1)!.trim()
    let id: string | undefined
    let body = piece
    const lone = LONE_ID.exec(lastLine)
    if (lone && piece.includes('\n')) {
      id = lone[1]
      body = piece.split('\n').slice(0, -1).join('\n')
    } else {
      const trailing = TRAILING_ID.exec(piece)
      if (trailing) {
        id = trailing[1]
        body = piece.slice(0, trailing.index)
      } else {
        // `^id` alone after a table, math block or quote box that ended the previous piece.
        const next = pieces[i + 1]
        const loneNext = next ? LONE_ID.exec(next.trim()) : null
        if (loneNext) {
          id = loneNext[1]
          i += 1
        }
      }
    }
    if (!id) continue
    const citations = [...body.matchAll(CITE)].map(match => match[2]!).filter(target => target !== 'unverified')
    const block = {
      id,
      text: body.trim(),
      hash: createHash('sha256').update(body.trim()).digest('hex').slice(0, 16),
      citations: [...new Set(citations)],
      unverified: body.includes('(cite:unverified)'),
      recall,
      original: isOriginal(body),
    }
    settle(block)
    blocks.push(block)
    if (isDisplayMath(block.text)) formula = block
  }
  settle(undefined)
  return blocks
}

/**
 * A writer's reply without the headings it should not have written (the program writes the handout's) and
 * without recall questions (10-31). `keep` is the heading level the reply may use, as the types do (`####`);
 * deeper headings become that level.
 */
export function replyBody(reply: string, keep?: number): string {
  const lines = unwrap(reply).split(/\r?\n/)
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (heading) {
      skipping = /读完就答/.test(heading[2]!)
      if (!skipping && keep && heading[1]!.length >= keep) out.push(`${'#'.repeat(keep)} ${heading[2]!.trim()}`)
      continue
    }
    if (!skipping) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Halve a part that was still too long for one reply, cutting at the heading nearest the middle. */
export function halve<T extends { readonly kind: string }>(part: readonly T[]): [T[], T[]] {
  const middle = Math.floor(part.length / 2)
  let cut = middle
  for (let offset = 0; offset < middle; offset += 1) {
    if (part[middle + offset]?.kind === 'heading') { cut = middle + offset; break }
    if (middle - offset > 0 && part[middle - offset]?.kind === 'heading') { cut = middle - offset; break }
  }
  return [part.slice(0, cut), part.slice(cut)]
}

/**
 * The stage design without its assessment sections, so quiz problems cannot leak into the textbook.
 * Drops every heading section that names a test, blueprint or exercises, with its subsections.
 */
export function teachingPartOf(design: string): string {
  const out: string[] = []
  let skipDepth = 0
  for (const line of design.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const depth = heading[1]!.length
      if (skipDepth && depth > skipDepth) continue
      skipDepth = /测试|蓝图|小测|考核|考试|测验|习题/.test(heading[2]!) ? depth : 0
      if (skipDepth) continue
    } else if (skipDepth) {
      continue
    }
    out.push(line)
  }
  return out.join('\n').trim()
}
