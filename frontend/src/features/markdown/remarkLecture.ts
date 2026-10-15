import type { Heading, InlineCode, Parent, PhrasingContent, Root, Text } from 'mdast'
import { visit, SKIP } from 'unist-util-visit'
import { parseTc } from '@/lib/time'

/**
 * remark plugin:
 *  - [MM:SS] / [HH:MM:SS] (also legacy `[..]` code spans) -> <tc data-t>
 *  - [[lesson_id@MM:SS]] notebook citations             -> <tc data-t data-lesson>
 *  - emoji removed from all text (monochrome UI rule)
 *  - headings get stable ids for the outline
 */
const TOKEN_RE = /\[\[([A-Za-z0-9_-]+)@(\d{1,2}:\d{2}(?::\d{2})?)\]\]|\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g
const INLINE_TC_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/
const EMOJI_RE = /(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u200D)+\s?/gu

type TimecodeNode = { type: 'timecode'; data: { hName: 'tc'; hProperties: Record<string, string>; hChildren: [] } }

function tcNode(seconds: number, lesson?: string): TimecodeNode {
  const props: Record<string, string> = { dataT: String(seconds) }
  if (lesson) props.dataLesson = lesson
  return { type: 'timecode', data: { hName: 'tc', hProperties: props, hChildren: [] } }
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 64) || 'section'
}

function plainText(node: Parent): string {
  let out = ''
  visit(node, (n) => {
    if (n.type === 'text' || n.type === 'inlineCode') out += (n as Text).value
  })
  return out
}

export function remarkLecture() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return
      const value = node.value.replace(EMOJI_RE, '')
      const parts: Array<PhrasingContent | TimecodeNode> = []
      let last = 0
      for (const m of value.matchAll(TOKEN_RE)) {
        if (m.index! > last) parts.push({ type: 'text', value: value.slice(last, m.index) })
        parts.push(m[1] ? tcNode(parseTc(m[2]), m[1]) : tcNode(parseTc(m[3])))
        last = m.index! + m[0].length
      }
      if (!parts.length) {
        node.value = value
        return
      }
      if (last < value.length) parts.push({ type: 'text', value: value.slice(last) })
      parent.children.splice(index, 1, ...(parts as PhrasingContent[]))
      return [SKIP, index + parts.length]
    })

    visit(tree, 'inlineCode', (node: InlineCode, index, parent) => {
      const m = INLINE_TC_RE.exec(node.value.trim())
      if (m && parent && index !== undefined) parent.children.splice(index, 1, tcNode(parseTc(m[1])) as unknown as PhrasingContent)
    })

    const used = new Map<string, number>()
    visit(tree, 'heading', (node: Heading) => {
      const base = slugify(plainText(node))
      const n = used.get(base) ?? 0
      used.set(base, n + 1)
      node.data = { ...node.data, hProperties: { id: n ? `${base}-${n}` : base } }
    })
  }
}
