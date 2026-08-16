import { useEffect, useCallback } from 'react'
import { DownloadImageButton } from './DownloadImageButton'

interface ImageLightboxProps {
  images: string[]
  index: number
  onClose: () => void
  onIndexChange: (index: number) => void
}

export function ImageLightbox({
  images,
  index,
  onClose,
  onIndexChange
}: ImageLightboxProps): React.JSX.Element | null {
  const total = images.length
  const current = images[index]
  const hasPrev = index > 0
  const hasNext = index < total - 1

  const goPrev = useCallback((): void => {
    if (index > 0) onIndexChange(index - 1)
  }, [index, onIndexChange])

  const goNext = useCallback((): void => {
    if (index < total - 1) onIndexChange(index + 1)
  }, [index, onIndexChange, total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, goPrev, goNext])

  if (!current || total === 0) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-[#0a0e14]/92 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-mono text-sm tabular-nums text-[#8b9aab]">
          {index + 1} / {total}
        </span>
        <div className="flex items-center gap-2">
          <DownloadImageButton src={current} />
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2a3a4d] bg-[#121820] text-[#c5d0dc] hover:bg-[#1a2430] hover:text-[#f0f4f8]"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
        {hasPrev && (
          <button
            type="button"
            title="Previous image"
            onClick={(e) => {
              e.stopPropagation()
              goPrev()
            }}
            className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#2a3a4d] bg-[#121820]/90 text-[#e7ecf1] hover:bg-[#1a3050]"
          >
            ‹
          </button>
        )}

        <img
          src={current}
          alt={`Image ${index + 1} of ${total}`}
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />

        {hasNext && (
          <button
            type="button"
            title="Next image"
            onClick={(e) => {
              e.stopPropagation()
              goNext()
            }}
            className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#2a3a4d] bg-[#121820]/90 text-[#e7ecf1] hover:bg-[#1a3050]"
          >
            ›
          </button>
        )}
      </div>
    </div>
  )
}
