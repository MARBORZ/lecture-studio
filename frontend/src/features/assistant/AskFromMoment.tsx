import { MessageSquarePlus, MessageSquareQuote } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Segment } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { AnimatePresence, m } from '@/components/motion'
import { Button } from '@/components/ui'
import { player, usePlayer } from '@/features/player/store'
import { collapse } from '@/lib/motion'
import { formatTc } from '@/lib/time'
import type { AskState } from './AssistantPanel'
import { QUOTE_MAX } from './SelectionAsk'

/** How much of the lecture before the moment goes with the question (and a little after, to finish the phrase). */
const BEFORE_SEC = 45
const AFTER_SEC = 8

/**
 * "[12:34]" + what was said in the seconds up to that moment: the quote a question from the paused player carries.
 * The model gets the timecode (it cites it back) and the words, the history shows both.
 */
export function momentQuote(segments: Segment[], t: number): string {
  const said = segments
    .filter((s) => s.clean_end > t - BEFORE_SEC && s.clean_start < t + AFTER_SEC)
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ')
  const head = `[${formatTc(t)}]`
  const room = QUOTE_MAX - head.length - 2
  const text = said.length > room ? '…' + said.slice(said.length - room + 1) : said // keep the end: it is the moment
  return text ? `${head} ${text}` : head
}

/**
 * Under the lesson player while it is paused: ask about this moment in the current session, or start a new session
 * from it. Both open the assistant tab with the moment quoted; the new one also gets its own session named by the time.
 */
export function AskFromMoment({ lessonId, segments }: { lessonId: string; segments: Segment[] }) {
  const { t } = useUI()
  const navigate = useNavigate()
  const ours = usePlayer((s) => s.lessonId === lessonId)
  const paused = usePlayer((s) => !s.playing && s.currentTime > 0.5)
  const show = ours && paused && segments.length > 0

  const go = (newSession: boolean) => {
    const at = player.getState().currentTime
    const state: AskState = { quote: momentQuote(segments, at), newSession, at }
    navigate(`/lessons/${lessonId}/assistant`, { state })
  }

  return (
    <AnimatePresence initial={false}>
      {show && (
        <m.div key="ask-moment" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={MessageSquareQuote} onClick={() => go(false)}>
              {t('player.askHere')}
            </Button>
            <Button size="sm" variant="ghost" icon={MessageSquarePlus} onClick={() => go(true)}>
              {t('player.askNewSession')}
            </Button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
