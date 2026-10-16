import { useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { m } from '@/components/motion'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { cn } from '@/lib/cn'
import { fadeIn } from '@/lib/motion'

/**
 * The hybrid diary entry: one sheet, two states, like cells in Jupyter or a note in Obsidian. The entry is cut into
 * blocks (a blank line or a heading starts one; a fenced code block is never cut); every block shows rendered, and the
 * block you click turns into its own Markdown source in place. ↑ at its start / ↓ at its end move to the next block,
 * Esc or a click elsewhere renders it again. The text is the same file: blocks are joined back with a blank line.
 */

export function splitBlocks(text: string): string[] {
  const blocks: string[] = []
  let cur: string[] = []
  let fence = false
  const flush = () => {
    while (cur.length && !cur[cur.length - 1].trim()) cur.pop()
    if (cur.length) blocks.push(cur.join('\n'))
    cur = []
  }
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && !line.trim()) {
      flush()
      continue
    }
    if (!fence && /^#{1,6}\s/.test(line) && cur.length) flush() // a heading opens its own block
    cur.push(line)
  }
  flush()
  return blocks
}

export const joinBlocks = (blocks: string[]) => blocks.filter((b) => b.trim()).join('\n\n')

const rowsFor = (text: string) => Math.max(1, text.split('\n').length)

export function BlockEditor({
  value,
  onChange,
  onEditing,
  className,
}: {
  value: string
  onChange: (text: string) => void
  onEditing: (editing: boolean) => void
  className?: string
}) {
  const { t } = useUI()
  // while a block is open the blocks are held as they were split, so typing a blank line does not re-cut them under the caret
  const [edit, setEdit] = useState<{ i: number; blocks: string[] } | null>(null)
  const blocks = edit?.blocks ?? splitBlocks(value)

  const open = (i: number, from = blocks) => {
    if (!edit) onEditing(true)
    setEdit({ i, blocks: i >= from.length ? [...from, ''] : from })
  }
  const close = () => {
    setEdit(null)
    onEditing(false)
  }
  const change = (text: string) => {
    if (!edit) return
    const next = edit.blocks.map((b, j) => (j === edit.i ? text : b))
    setEdit({ ...edit, blocks: next })
    onChange(joinBlocks(next))
  }

  return (
    <div
      className={cn('flex flex-col gap-3', className)}
      // a click on the empty space under the last block starts a new one there
      onClick={(e) => e.target === e.currentTarget && open(blocks.length)}
    >
      {blocks.map((block, i) =>
        edit?.i === i ? (
          <m.textarea
            key={`edit-${i}`}
            variants={fadeIn}
            initial="hidden"
            animate="show"
            autoFocus
            value={block}
            rows={rowsFor(block)}
            onChange={(e) => change(e.target.value)}
            onBlur={(e) => {
              // moving to another block of the same entry opens it; anywhere else renders everything
              if (!(e.relatedTarget as Element | null)?.closest?.('[data-block]')) close()
            }}
            onKeyDown={(e) => {
              const ta = e.currentTarget
              if (e.key === 'Escape') {
                e.preventDefault()
                ta.blur()
              } else if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0 && i > 0) {
                e.preventDefault()
                setEdit({ ...edit, i: i - 1 })
              } else if (e.key === 'ArrowDown' && ta.selectionStart === block.length && i < edit.blocks.length - 1) {
                e.preventDefault()
                setEdit({ ...edit, i: i + 1 })
              }
            }}
            data-block
            className="read-14 -mx-2 w-[calc(100%+1rem)] resize-none rounded-lg bg-raised px-2 py-1.5 font-mono leading-relaxed text-fg focus:outline-none"
          />
        ) : (
          <div
            key={`view-${i}`}
            role="button"
            tabIndex={0}
            data-block
            title={t('diary.clickToEdit')}
            onClick={(e) => {
              if ((e.target as Element).closest('a, button, input')) return // links and checkboxes keep working
              open(i)
            }}
            onKeyDown={(e) => e.key === 'Enter' && open(i)}
            className="-mx-2 cursor-text rounded-lg px-2 py-0.5 transition-colors hover:bg-hover/60 focus:outline-none focus-visible:bg-hover"
          >
            <MarkdownView content={block} compact className="read-15" />
          </div>
        ),
      )}
    </div>
  )
}
