import { Check, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui'

/** The square the cover is cut to (sidebar, headers and forms draw it small; this keeps it sharp on Retina). */
const OUT = 512
const VIEW = 224
const MAX_ZOOM = 5

/**
 * Pick the part of an image a notebook cover shows: drag to move, wheel or the slider to zoom, then Apply cuts a
 * square OUT×OUT JPEG. The whole square is always covered (no empty edges), whatever the zoom and position.
 */
export function CoverCropper({ src, onApply, onCancel }: { src: string; onApply: (file: File) => void; onCancel: () => void }) {
  const { t } = useUI()
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 }) // offset of the image centre from the view centre, in view px
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => setImg(i)
    i.src = src
  }, [src])

  // the image at zoom 1 covers the square exactly (its short side = the view)
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const w = img ? img.naturalWidth * base * zoom : VIEW
  const h = img ? img.naturalHeight * base * zoom : VIEW
  const clamp = (p: { x: number; y: number }, ww = w, hh = h) => ({
    x: Math.max(-(ww - VIEW) / 2, Math.min((ww - VIEW) / 2, p.x)),
    y: Math.max(-(hh - VIEW) / 2, Math.min((hh - VIEW) / 2, p.y)),
  })
  const setZoomTo = (z: number) => {
    const next = Math.max(1, Math.min(MAX_ZOOM, z))
    setZoom(next)
    if (img) setPos((p) => clamp({ x: (p.x * next) / zoom, y: (p.y * next) / zoom }, img.naturalWidth * base * next, img.naturalHeight * base * next))
  }

  function apply() {
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const k = OUT / VIEW
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (VIEW / 2 - w / 2 + pos.x) * k, (VIEW / 2 - h / 2 + pos.y) * k, w * k, h * k)
    canvas.toBlob((blob) => blob && onApply(new File([blob], 'cover.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9)
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative cursor-grab overflow-hidden rounded-xl border border-line-strong bg-raised select-none active:cursor-grabbing"
        style={{ width: VIEW, height: VIEW, touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }))
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setZoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
      >
        {img && (
          <img
            src={src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{ width: w, height: h, left: VIEW / 2 - w / 2 + pos.x, top: VIEW / 2 - h / 2 + pos.y }}
          />
        )}
      </div>
      <div className="flex w-full max-w-[16rem] items-center gap-2 text-muted">
        <button type="button" aria-label={t('library.coverZoomOut')} onClick={() => setZoomTo(zoom / 1.2)} className="hover:text-fg">
          <Icon as={ZoomOut} size={15} />
        </button>
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoomTo(Number(e.target.value))} className="h-1 flex-1 cursor-pointer" aria-label={t('library.coverZoom')} />
        <button type="button" aria-label={t('library.coverZoomIn')} onClick={() => setZoomTo(zoom * 1.2)} className="hover:text-fg">
          <Icon as={ZoomIn} size={15} />
        </button>
      </div>
      <p className="text-[12px] text-dim">{t('library.coverCropHint')}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" icon={Check} disabled={!img} onClick={apply}>{t('library.coverApply')}</Button>
      </div>
    </div>
  )
}
