import { Check, Copy } from 'lucide-react'
import { isValidElement, memo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '@/components/Icon'
import { Timecode } from '@/features/player/Timecode'
import { cn } from '@/lib/cn'
import { remarkLecture } from './remarkLecture'
import '@/styles/markdown.scss'

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const lang = isValidElement<{ className?: string }>(children) ? /language-(\w+)/.exec(children.props.className ?? '')?.[1] : undefined
  return (
    <div className="md-pre">
      {lang && <span className="md-pre-lang">{lang}</span>}
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(ref.current?.innerText ?? '')
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md text-dim hover:bg-hover hover:text-fg"
      >
        <Icon as={copied ? Check : Copy} size={14} />
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}

const components = {
  tc: (props: Record<string, string>) => <Timecode seconds={Number(props['data-t'])} lessonId={props['data-lesson']} />,
  pre: ({ children }: ComponentProps<'pre'>) => <CodeBlock>{children}</CodeBlock>,
  table: (props: ComponentProps<'table'>) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
  a: ({ href, ...props }: ComponentProps<'a'>) => <a href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer" {...props} />,
} as unknown as Components

/** The only Markdown renderer: audits, assistant answers, notes. */
export const MarkdownView = memo(function MarkdownView({ content, compact, className }: { content: string; compact?: boolean; className?: string }) {
  return (
    <div className={cn('md', compact && 'md-compact', className)}>
      <Markdown remarkPlugins={[remarkGfm, remarkLecture]} components={components}>
        {content}
      </Markdown>
    </div>
  )
})
